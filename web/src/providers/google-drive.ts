// MIT License © 2026 Binary Dice Games
/**
 * @file Google Drive (`gd`): Drive API v3 with the `drive.file` and `drive.appdata` scopes. Sign-in
 * is OAuth's implicit grant in a popup (Google issues no refresh tokens to browsers). Folders and
 * linked files boh did not create are reached through Google's Picker.
 */
import { textToBase64Url, base64UrlToText } from '../b64';
import {
  AuthError,
  ConflictError,
  LinkError,
  ProviderError,
  TagError,
  TooLargeError,
} from '../errors';
import { jsonOf, readLimited, send, statusError } from '../http';
import { authorizeInPopup, openSignInPopup } from '../oauth';
import { applyTagChange, normalizeTag, sortTags, tagKey, tagOfKey, MAX_TAGS } from '../tags';
import { createGooglePicker, createTestPicker, type GooglePicker } from './google-picker';
import type {
  Account,
  ConfigSnapshot,
  FetchOptions,
  FolderInfo,
  FolderRef,
  ListPage,
  PasteMeta,
  Provider,
  ProviderEnv,
  Sharing,
} from './provider';
import { AuthSession } from './session';

const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CONFIG_NAME = 'boh-config.json';
const FIELDS =
  'id,name,mimeType,size,modifiedTime,webViewLink,resourceKey,version,appProperties,ownedByMe,capabilities/canEdit';
const FOLDER_FIELDS =
  'id,name,ownedByMe,owners(displayName,emailAddress),capabilities/canAddChildren';
/** Above this an upload is resumable instead of multipart. */
const MULTIPART_MAX = 5 * 1024 * 1024;

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  resourceKey?: string;
  version?: string;
  appProperties?: Record<string, string>;
  ownedByMe?: boolean;
  owners?: { displayName?: string; emailAddress?: string }[];
  capabilities?: { canEdit?: boolean; canAddChildren?: boolean };
}

/** The tags stored in a file's `appProperties`; other keys are ignored. */
function tagsOf(f: DriveFile): string[] {
  return sortTags(
    Object.keys(f.appProperties ?? {})
      .map(tagOfKey)
      .filter((t): t is string => t !== undefined),
  );
}

/**
 * Normalized tags for an upload.
 * @throws {TagError} `invalid_tag`, `too_many_tags`
 */
function uploadTags(tags: readonly string[] | undefined): Record<string, string> | undefined {
  if (!tags?.length) {
    return undefined;
  }
  const clean = sortTags(tags.map(normalizeTag));
  if (clean.length > MAX_TAGS) {
    throw new TagError('too_many_tags', `a paste can have at most ${MAX_TAGS} tags`);
  }
  return Object.fromEntries(clean.map((t) => [tagKey(t), '1']));
}

/** A query string literal. */
const quote = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** Creates the Google Drive provider. */
export function createDriveProvider(env: ProviderEnv, picker?: GooglePicker): Provider {
  const cfg = env.config.google;
  const now = env.now ?? Date.now;
  const session = new AuthSession('gd', env.tokens, env.fetch, now);
  const thePicker = picker ?? (cfg.testPicker ? createTestPicker(cfg) : createGooglePicker(cfg));
  const api = `${cfg.apiBase}/drive/v3`;
  const upload = `${cfg.apiBase}/upload/drive/v3`;

  const toMeta = (f: DriveFile, access?: PasteMeta['access']): PasteMeta => ({
    provider: 'gd',
    key: f.id,
    name: f.name,
    size: f.size === undefined ? undefined : Number(f.size),
    mime: f.mimeType,
    modified: f.modifiedTime,
    webUrl: f.webViewLink,
    access,
    source: f.resourceKey,
    tags: tagsOf(f),
    canEdit: access === 'anonymous' ? false : f.capabilities?.canEdit,
    ownedByMe: access === 'anonymous' ? false : f.ownedByMe,
  });

  const keyHeaders = (meta: PasteMeta): Record<string, string> =>
    meta.source ? { 'x-goog-drive-resource-keys': `${meta.key}/${meta.source}` } : {};

  async function call<T>(url: string, init: RequestInit = {}, what = 'Drive'): Promise<T> {
    const res = await session.request(url, init);
    if (!res.ok) {
      throw statusError(res, what);
    }
    return jsonOf<T>(res);
  }

  async function findConfig(): Promise<DriveFile | undefined> {
    const q = `name = ${quote(CONFIG_NAME)} and trashed = false`;
    const list = await call<{ files: DriveFile[] }>(
      `${api}/files?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,version)`,
    );
    return list.files[0];
  }

  function multipart(metadata: object, blob: Blob): { body: Blob; type: string } {
    const boundary = `boh-${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    return { body, type: `multipart/related; boundary=${boundary}` };
  }

  async function createFile(metadata: object, blob: Blob): Promise<DriveFile> {
    if (blob.size <= MULTIPART_MAX) {
      const { body, type } = multipart(metadata, blob);
      return call<DriveFile>(
        `${upload}/files?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`,
        {
          method: 'POST',
          headers: { 'content-type': type },
          body,
        },
      );
    }
    const start = await session.request(
      `${upload}/files?uploadType=resumable&fields=${encodeURIComponent(FIELDS)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': blob.type || 'application/octet-stream',
        },
        body: JSON.stringify(metadata),
      },
    );
    const location = start.headers.get('location');
    if (!start.ok || !location) {
      throw statusError(start, 'Drive upload');
    }
    const res = await send(env.fetch, location, { method: 'PUT', body: blob, timeoutMs: 600000 });
    if (!res.ok) {
      throw statusError(res, 'Drive upload');
    }
    return jsonOf<DriveFile>(res);
  }

  function decodeRef(ref: string): { id: string; resourceKey?: string } {
    let value: string;
    try {
      value = base64UrlToText(ref);
    } catch {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    const [id = '', resourceKey] = value.split('/', 2);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    return { id, resourceKey };
  }

  const provider: Provider = {
    id: 'gd',
    label: 'Google Drive',
    configured: Boolean(cfg.clientId),
    maxUploadBytes: 200 * 1024 * 1024,
    capabilities: { tags: true, binLinks: true },

    async signIn({ stay, signal }) {
      if (!cfg.clientId) {
        throw new ProviderError('not_configured', 'this build has no Google client id');
      }
      const popup = openSignInPopup(env.popup);
      const answer = await authorizeInPopup(
        popup,
        cfg.authUrl,
        {
          client_id: cfg.clientId,
          redirect_uri: env.popup.redirectUri,
          response_type: 'token',
          scope: `${SCOPE_FILE} ${SCOPE_APPDATA}`,
          include_granted_scopes: 'true',
          prompt: 'select_account',
        },
        { signal },
      );
      const granted = (answer.scope ?? '').split(' ');
      if (!answer.access_token) {
        throw new AuthError('failed', 'no access token in the answer');
      }
      if (answer.scope && !(granted.includes(SCOPE_FILE) && granted.includes(SCOPE_APPDATA))) {
        throw new AuthError('denied', 'boh needs access to its own files and its settings file');
      }
      session.store(
        { access_token: answer.access_token, expires_in: Number(answer.expires_in) || 3600 },
        stay,
      );
      const about = await call<{
        user: { displayName: string; emailAddress?: string; permissionId: string };
      }>(`${api}/about?fields=user(displayName,emailAddress,permissionId)`);
      const account: Account = {
        id: about.user.permissionId,
        name: about.user.displayName,
        email: about.user.emailAddress,
      };
      session.setAccount(account);
      return account;
    },

    async signOut() {
      const token = session.record()?.accessToken;
      session.clear();
      if (token) {
        await send(env.fetch, `${cfg.revokeUrl}?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          attempts: 1,
        }).catch(() => undefined);
      }
    },

    account: () => session.account(),
    setStay: (stay) => session.setStay(stay),

    async readConfig(): Promise<ConfigSnapshot> {
      const file = await findConfig();
      if (!file) {
        return { text: null, rev: null };
      }
      const res = await session.request(`${api}/files/${file.id}?alt=media`);
      if (!res.ok) {
        throw statusError(res, 'Drive settings');
      }
      return { text: await res.text(), rev: `${file.id}:${file.version}` };
    },

    async writeConfig(text, rev) {
      const blob = new Blob([text], { type: 'application/json' });
      if (rev === null) {
        if (await findConfig()) {
          throw new ConflictError();
        }
        const file = await createFile({ name: CONFIG_NAME, parents: ['appDataFolder'] }, blob);
        return `${file.id}:${file.version}`;
      }
      const [id = '', version] = rev.split(':');
      const current = await session.request(`${api}/files/${id}?fields=id,version`);
      if (current.status === 404) {
        throw new ConflictError('the settings file was deleted');
      }
      if (!current.ok) {
        throw statusError(current, 'Drive settings');
      }
      if ((await jsonOf<DriveFile>(current)).version !== version) {
        throw new ConflictError();
      }
      const file = await call<DriveFile>(
        `${upload}/files/${id}?uploadType=media&fields=id,version`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: blob },
      );
      return `${file.id}:${file.version}`;
    },

    async pickFolder(options = {}) {
      const picked = await thePicker.pick(
        { kind: 'folder', shared: options.shared, folderId: options.folderId },
        await session.accessToken(),
      );
      return picked ? { id: picked.id, name: picked.name } : null;
    },

    async describeFolder(folder): Promise<FolderInfo> {
      const res = await session.request(
        `${api}/files/${folder.id}?supportsAllDrives=true&fields=${encodeURIComponent(FOLDER_FIELDS)}`,
      );
      if (res.status === 403 || res.status === 404) {
        throw new ProviderError(
          'needs_grant',
          'boh needs permission to open this folder',
          res.status,
        );
      }
      if (!res.ok) {
        throw statusError(res, 'Drive folder');
      }
      const f = await jsonOf<DriveFile>(res);
      const owner = f.owners?.[0];
      return {
        name: f.name,
        owner: owner?.displayName
          ? { name: owner.displayName, email: owner.emailAddress }
          : undefined,
        ownedByMe: f.ownedByMe ?? false,
        canAdd: f.capabilities?.canAddChildren ?? false,
      };
    },

    refOfFolder: (folder) => textToBase64Url(folder.id),

    folderRef(ref) {
      let id: string;
      try {
        id = base64UrlToText(ref);
      } catch {
        throw new LinkError('the folder reference is damaged');
      }
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new LinkError('the folder reference is damaged');
      }
      return { id, name: '' };
    },

    async createFolder(name, parent) {
      const file = await call<DriveFile>(`${api}/files?fields=id,name`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          ...(parent ? { parents: [parent.id] } : {}),
        }),
      });
      return { id: file.id, name: file.name };
    },

    async describeSharing(folder): Promise<Sharing> {
      const manageUrl = provider.folderUrl(folder);
      const res = await session.request(
        `${api}/files/${folder.id}/permissions?supportsAllDrives=true&fields=permissions(type,role)`,
      );
      if (res.status === 403 || res.status === 404) {
        return { kind: 'unknown', manageUrl };
      }
      if (!res.ok) {
        throw statusError(res, 'Drive sharing');
      }
      const { permissions } = await jsonOf<{ permissions: { type: string; role: string }[] }>(res);
      if (permissions.some((p) => p.type === 'anyone')) {
        return { kind: 'public', manageUrl };
      }
      const others = permissions.filter((p) => p.role !== 'owner').length;
      return others > 0
        ? { kind: 'members', members: others, manageUrl }
        : { kind: 'private', manageUrl };
    },

    async list(folder, cursor): Promise<ListPage> {
      const q = `${quote(folder.id)} in parents and trashed = false and mimeType != ${quote(FOLDER_MIME)}`;
      const params = new URLSearchParams({
        q,
        orderBy: 'createdTime desc',
        pageSize: '50',
        fields: `nextPageToken,files(${FIELDS})`,
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (cursor) {
        params.set('pageToken', cursor);
      }
      const page = await call<{ files: DriveFile[]; nextPageToken?: string }>(
        `${api}/files?${params}`,
      );
      return { items: page.files.map((f) => toMeta(f, 'token')), cursor: page.nextPageToken };
    },

    async upload(folder, name, blob, options) {
      const appProperties = uploadTags(options?.tags);
      const file = await createFile(
        { name, parents: [folder.id], ...(appProperties ? { appProperties } : {}) },
        blob,
      );
      return toMeta(file, 'token');
    },

    async setTags(meta, change, signal) {
      const add = (change.add ?? []).map(normalizeTag);
      const remove = (change.remove ?? []).map(normalizeTag);
      const url = `${api}/files/${meta.key}?supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`;
      const current = await session.request(url, { headers: keyHeaders(meta), signal });
      if (!current.ok) {
        throw statusError(current, 'Drive tags');
      }
      const file = await jsonOf<DriveFile>(current);
      const before = tagsOf(file);
      const after = applyTagChange(before, { add, remove }); // checks the limit
      const patch: Record<string, string | null> = {};
      for (const tag of before.filter((t) => !after.includes(t))) {
        patch[tagKey(tag)] = null;
      }
      for (const tag of after.filter((t) => !before.includes(t))) {
        patch[tagKey(tag)] = '1';
      }
      if (Object.keys(patch).length === 0) {
        return { ...toMeta(file, 'token'), source: meta.source };
      }
      const res = await session.request(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...keyHeaders(meta) },
        body: JSON.stringify({ appProperties: patch }),
        signal,
      });
      if (!res.ok) {
        throw statusError(res, 'Drive tags');
      }
      return { ...toMeta(await jsonOf<DriveFile>(res), 'token'), source: meta.source };
    },

    async share(meta) {
      // The folder's permissions are inherited: the file id is all a link needs.
      return textToBase64Url(meta.source ? `${meta.key}/${meta.source}` : meta.key);
    },

    async remove(meta) {
      const res = await session.request(`${api}/files/${meta.key}?supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      if (!res.ok) {
        throw statusError(res, 'Drive delete');
      }
    },

    async openRef(ref) {
      const { id, resourceKey } = decodeRef(ref);
      const headers: Record<string, string> = resourceKey
        ? { 'x-goog-drive-resource-keys': `${id}/${resourceKey}` }
        : {};
      const url = `${api}/files/${id}?supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`;
      if (cfg.apiKey) {
        const res = await send(env.fetch, `${url}&key=${encodeURIComponent(cfg.apiKey)}`, {
          headers,
        });
        if (res.ok) {
          return { ...toMeta(await jsonOf<DriveFile>(res), 'anonymous'), source: resourceKey };
        }
        if (res.status !== 403 && res.status !== 404 && res.status !== 401) {
          throw statusError(res, 'Drive');
        }
      }
      if (!(await session.optionalToken())) {
        throw new ProviderError('needs_sign_in', 'sign in to Google Drive to open this paste');
      }
      const res = await session.request(url, { headers });
      if (res.ok) {
        return { ...toMeta(await jsonOf<DriveFile>(res), 'token'), source: resourceKey };
      }
      if (res.status === 403 || res.status === 404) {
        throw new ProviderError(
          'needs_grant',
          'boh needs permission to open this file',
          res.status,
        );
      }
      throw statusError(res, 'Drive');
    },

    async grantAccess(ref) {
      const { id } = decodeRef(ref);
      const picked = await thePicker.pick(
        { kind: 'file', fileId: id },
        await session.accessToken(),
      );
      return picked !== null;
    },

    async fetch(meta, { maxBytes, signal }: FetchOptions) {
      if (meta.size !== undefined && meta.size > maxBytes) {
        throw new TooLargeError(meta.size, maxBytes);
      }
      const headers = keyHeaders(meta);
      const url = `${api}/files/${meta.key}?alt=media&supportsAllDrives=true`;
      const res =
        meta.access === 'anonymous'
          ? await send(env.fetch, `${url}&key=${encodeURIComponent(cfg.apiKey)}`, {
              headers,
              signal,
              timeoutMs: 300000,
            })
          : await session.request(url, { headers, signal, timeoutMs: 300000 });
      if (!res.ok) {
        throw statusError(res, 'Drive download');
      }
      return readLimited(res, maxBytes, '');
    },

    folderUrl: (folder: FolderRef) => `https://drive.google.com/drive/folders/${folder.id}`,
  };
  return provider;
}
