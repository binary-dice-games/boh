// MIT License © 2026 Binary Dice Games
/**
 * @file Dropbox (`db`): the Dropbox API v2 as a "Full Dropbox" app, so folders others share with
 * the user can be bins. Sign-in is the authorization code grant with PKCE and a refresh token.
 * A paste link holds a Dropbox shared link (or, where the account cannot make a members-only
 * link, the file id, which members open with their own sign-in).
 */
import { base64UrlToText, textToBase64Url } from '../b64';
import { ConflictError, ProviderError, TooLargeError } from '../errors';
import { jsonOf, readLimited, send, statusError } from '../http';
import { authorizeInPopup, openSignInPopup, postTokenForm } from '../oauth';
import { challengeOf, createVerifier } from '../pkce';
import type {
  ConfigSnapshot,
  FolderRef,
  ListPage,
  PasteMeta,
  Provider,
  ProviderEnv,
  Sharing,
} from './provider';
import { AuthSession } from './session';

const SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.content.read',
  'files.content.write',
  'sharing.read',
  'sharing.write',
].join(' ');
const CONFIG_PATH = '/Apps/boh/boh-config.json';

interface Entry {
  '.tag': 'file' | 'folder' | 'deleted';
  id: string;
  name: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
  rev?: string;
  sharing_info?: { shared_folder_id?: string; parent_shared_folder_id?: string };
}

interface LinkMeta {
  url: string;
  name: string;
  id?: string;
  size?: number;
  server_modified?: string;
  link_permissions?: { resolved_visibility?: { '.tag': string } };
}

/** A Dropbox 409 answer. */
interface DropboxFailure {
  error_summary?: string;
  error?: Record<string, unknown>;
}

/** The `Dropbox-API-Arg` header: JSON with every non-ASCII character escaped. */
export function dropboxArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The anonymous download address of a shared link: the same path and `rlkey` on the raw host.
 * @param rawBase the raw host (`https://dl.dropboxusercontent.com`)
 */
export function rawLinkUrl(link: string, rawBase: string): string {
  const url = new URL(link);
  const raw = new URL(rawBase);
  url.protocol = raw.protocol;
  url.host = raw.host;
  url.searchParams.delete('dl');
  url.searchParams.delete('raw');
  return url.toString();
}

/** The file name in a shared link's path (`/scl/fi/<id>/<name>`). */
function nameOfLink(link: string): string {
  const last = new URL(link).pathname.split('/').filter(Boolean).pop() ?? 'paste';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Creates the Dropbox provider. */
export function createDropboxProvider(env: ProviderEnv): Provider {
  const cfg = env.config.dropbox;
  const now = env.now ?? Date.now;
  const tokenUrl = `${cfg.apiBase}/oauth2/token`;
  const session = new AuthSession('db', env.tokens, env.fetch, now, (refreshToken) =>
    postTokenForm(env.fetch, tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.appKey,
    }),
  );

  async function failure(res: Response): Promise<DropboxFailure> {
    try {
      return (await res.json()) as DropboxFailure;
    } catch {
      return {};
    }
  }

  /** Maps a non-OK answer: 409s by their summary, the rest by status. */
  async function errorOf(res: Response, what: string): Promise<ProviderError> {
    if (res.status !== 409) {
      return statusError(res, what);
    }
    const summary = (await failure(res)).error_summary ?? '';
    const reason = /not_found|not_file|not_folder/.test(summary)
      ? 'not_found'
      : /access_denied|no_permission|insufficient|email_not_verified/.test(summary)
        ? 'forbidden'
        : 'failed';
    return new ProviderError(reason, `${what}: ${summary || 'refused'}`, 409);
  }

  async function rpc<T>(path: string, args: unknown, what = 'Dropbox'): Promise<T> {
    const res = await session.request(`${cfg.apiBase}/2/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? null),
    });
    if (!res.ok) {
      throw await errorOf(res, what);
    }
    return jsonOf<T>(res);
  }

  async function download(path: string, arg: unknown, signal?: AbortSignal): Promise<Response> {
    return session.request(`${cfg.contentBase}/2/${path}`, {
      method: 'POST',
      headers: { 'dropbox-api-arg': dropboxArg(arg) },
      signal,
      timeoutMs: 300000,
    });
  }

  async function uploadTo(arg: object, blob: Blob): Promise<Response> {
    return session.request(`${cfg.contentBase}/2/files/upload`, {
      method: 'POST',
      headers: { 'dropbox-api-arg': dropboxArg(arg), 'content-type': 'application/octet-stream' },
      body: blob,
      timeoutMs: 600000,
    });
  }

  const entryMeta = (e: Entry): PasteMeta => ({
    provider: 'db',
    key: e.id,
    name: e.name,
    size: e.size,
    modified: e.server_modified,
    access: 'token',
    webUrl: e.path_display
      ? `https://www.dropbox.com/preview${encodeURI(e.path_display)}`
      : undefined,
  });

  const folderOf = (e: Entry): FolderRef => ({ id: e.id, name: e.name, path: e.path_display });

  function decodeRef(ref: string): string {
    let value: string;
    try {
      value = base64UrlToText(ref);
    } catch {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    // Shared links are https; a test build (whose raw host is plain http) also takes http.
    const schemes = new URL(cfg.rawBase).protocol === 'http:' ? /^https?:\/\// : /^https:\/\//;
    if (!value.startsWith('id:') && !schemes.test(value)) {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    return value;
  }

  const provider: Provider = {
    id: 'db',
    label: 'Dropbox',
    configured: Boolean(cfg.appKey),
    maxUploadBytes: 150 * 1024 * 1024,
    capabilities: { tags: false, binLinks: false },

    async signIn({ stay, signal }) {
      if (!cfg.appKey) {
        throw new ProviderError('not_configured', 'this build has no Dropbox app key');
      }
      const popup = openSignInPopup(env.popup);
      const verifier = createVerifier();
      const answer = await authorizeInPopup(
        popup,
        cfg.authUrl,
        {
          client_id: cfg.appKey,
          response_type: 'code',
          code_challenge: await challengeOf(verifier),
          code_challenge_method: 'S256',
          redirect_uri: env.popup.redirectUri,
          token_access_type: 'offline',
          scope: SCOPES,
        },
        { signal },
      );
      const tokens = await postTokenForm(env.fetch, tokenUrl, {
        grant_type: 'authorization_code',
        code: answer.code ?? '',
        code_verifier: verifier,
        client_id: cfg.appKey,
        redirect_uri: env.popup.redirectUri,
      });
      session.store(tokens, stay);
      const me = await rpc<{ account_id: string; name: { display_name: string }; email?: string }>(
        'users/get_current_account',
        null,
      );
      const account = { id: me.account_id, name: me.name.display_name, email: me.email };
      session.setAccount(account);
      return account;
    },

    async signOut() {
      const record = session.record();
      session.clear();
      if (record?.accessToken) {
        await send(env.fetch, `${cfg.apiBase}/2/auth/token/revoke`, {
          method: 'POST',
          headers: { authorization: `Bearer ${record.accessToken}` },
          attempts: 1,
        }).catch(() => undefined);
      }
    },

    account: () => session.account(),
    setStay: (stay) => session.setStay(stay),

    async readConfig(): Promise<ConfigSnapshot> {
      const res = await download('files/download', { path: CONFIG_PATH });
      if (res.status === 409) {
        const error = await errorOf(res, 'Dropbox settings');
        if (error.reason === 'not_found') {
          return { text: null, rev: null };
        }
        throw error;
      }
      if (!res.ok) {
        throw statusError(res, 'Dropbox settings');
      }
      const result = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}') as Entry;
      return { text: await res.text(), rev: result.rev ?? null };
    },

    async writeConfig(text, rev) {
      const res = await uploadTo(
        {
          path: CONFIG_PATH,
          mode: rev === null ? { '.tag': 'add' } : { '.tag': 'update', update: rev },
          autorename: false,
          mute: true,
        },
        new Blob([text], { type: 'application/json' }),
      );
      if (res.status === 409) {
        const summary = (await failure(res)).error_summary ?? '';
        if (/conflict/.test(summary)) {
          throw new ConflictError();
        }
        throw new ProviderError('failed', `Dropbox settings: ${summary}`, 409);
      }
      if (!res.ok) {
        throw statusError(res, 'Dropbox settings');
      }
      return (await jsonOf<Entry>(res)).rev ?? '';
    },

    async listFolders(parent) {
      const folders: FolderRef[] = [];
      let page = await rpc<{ entries: Entry[]; cursor: string; has_more: boolean }>(
        'files/list_folder',
        {
          path: parent ? parent.id : '',
          limit: 500,
        },
      );
      for (let i = 0; ; i++) {
        folders.push(...page.entries.filter((e) => e['.tag'] === 'folder').map(folderOf));
        if (!page.has_more || i >= 9) {
          break;
        }
        page = await rpc('files/list_folder/continue', { cursor: page.cursor });
      }
      return folders.sort((a, b) => a.name.localeCompare(b.name));
    },

    async createFolder(name, parent) {
      const dir = parent
        ? (parent.path ??
          (await rpc<Entry>('files/get_metadata', { path: parent.id })).path_display)
        : '';
      const { metadata } = await rpc<{ metadata: Entry }>('files/create_folder_v2', {
        path: `${dir ?? ''}/${name}`,
        autorename: false,
      });
      return folderOf(metadata);
    },

    async describeSharing(folder): Promise<Sharing> {
      const entry = await rpc<Entry>('files/get_metadata', { path: folder.id });
      const manageUrl = provider.folderUrl({ ...folder, path: entry.path_display });
      const { links } = await rpc<{ links: LinkMeta[] }>('sharing/list_shared_links', {
        path: folder.id,
        direct_only: true,
      });
      if (links.some((l) => l.link_permissions?.resolved_visibility?.['.tag'] === 'public')) {
        return { kind: 'public', manageUrl };
      }
      const shared = entry.sharing_info?.shared_folder_id;
      if (shared) {
        const members = await rpc<{ users: unknown[]; groups: unknown[] }>(
          'sharing/list_folder_members',
          { shared_folder_id: shared, limit: 1000 },
        ).catch(() => undefined);
        const count = members ? members.users.length + members.groups.length - 1 : undefined;
        return { kind: 'members', members: count, manageUrl };
      }
      if (entry.sharing_info?.parent_shared_folder_id) {
        return { kind: 'members', manageUrl };
      }
      return { kind: 'private', manageUrl };
    },

    async list(folder, cursor): Promise<ListPage> {
      const page = cursor
        ? await rpc<{ entries: Entry[]; cursor: string; has_more: boolean }>(
            'files/list_folder/continue',
            {
              cursor,
            },
          )
        : await rpc<{ entries: Entry[]; cursor: string; has_more: boolean }>('files/list_folder', {
            path: folder.id,
            limit: 100,
          });
      const items = page.entries
        .filter((e) => e['.tag'] === 'file')
        .sort((a, b) => (b.server_modified ?? '').localeCompare(a.server_modified ?? ''))
        .map(entryMeta);
      return { items, cursor: page.has_more ? page.cursor : undefined };
    },

    async upload(folder, name, blob, options) {
      if (options?.tags?.length) {
        throw new ProviderError('unsupported', 'boh cannot keep tags in Dropbox yet');
      }
      const dir = (await rpc<Entry>('files/get_metadata', { path: folder.id })).path_display ?? '';
      const res = await uploadTo(
        { path: `${dir}/${name}`, mode: 'add', autorename: true, mute: true },
        blob,
      );
      if (!res.ok) {
        throw await errorOf(res, 'Dropbox upload');
      }
      return entryMeta(await jsonOf<Entry>(res));
    },

    async share(meta, visibility) {
      if (!meta.key.startsWith('id:')) {
        return textToBase64Url(meta.key); // already a link
      }
      const audience = visibility === 'public' ? 'public' : 'no_one';
      const res = await session.request(
        `${cfg.apiBase}/2/sharing/create_shared_link_with_settings`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: meta.key, settings: { audience: { '.tag': audience } } }),
        },
      );
      if (res.ok) {
        return textToBase64Url((await jsonOf<LinkMeta>(res)).url);
      }
      if (res.status !== 409) {
        throw statusError(res, 'Dropbox link');
      }
      const fail = await failure(res);
      const summary = fail.error_summary ?? '';
      if (summary.startsWith('shared_link_already_exists')) {
        const existing = (
          fail.error?.shared_link_already_exists as { metadata?: LinkMeta } | undefined
        )?.metadata?.url;
        if (existing) {
          return textToBase64Url(existing);
        }
        const { links } = await rpc<{ links: LinkMeta[] }>('sharing/list_shared_links', {
          path: meta.key,
          direct_only: true,
        });
        if (links[0]) {
          return textToBase64Url(links[0].url);
        }
      }
      if (summary.startsWith('settings_error') && audience === 'no_one') {
        // The account cannot make members-only links: members open the file by id instead.
        return textToBase64Url(meta.key);
      }
      if (summary.startsWith('settings_error')) {
        throw new ProviderError('unsupported', 'Dropbox refused a public link for this file', 409);
      }
      throw new ProviderError(/access_denied/.test(summary) ? 'forbidden' : 'failed', summary, 409);
    },

    setTags() {
      return Promise.reject(
        new ProviderError('unsupported', 'boh cannot keep tags in Dropbox yet'),
      );
    },

    async remove(meta) {
      await rpc('files/delete_v2', { path: meta.key }, 'Dropbox delete');
    },

    async openRef(ref) {
      const value = decodeRef(ref);
      if (!value.startsWith('id:')) {
        const raw = rawLinkUrl(value, cfg.rawBase);
        const head = await send(env.fetch, raw, { method: 'HEAD', attempts: 1 }).catch(
          () => undefined,
        );
        if (head?.ok) {
          const length = Number(head.headers.get('content-length'));
          return {
            provider: 'db',
            key: value,
            name: nameOfLink(value),
            size:
              Number.isFinite(length) && head.headers.has('content-length') ? length : undefined,
            mime: head.headers.get('content-type') ?? undefined,
            webUrl: value,
            access: 'anonymous',
          };
        }
      }
      if (!(await session.optionalToken())) {
        throw new ProviderError('needs_sign_in', 'sign in to Dropbox to open this paste');
      }
      if (value.startsWith('id:')) {
        return {
          ...entryMeta(await rpc<Entry>('files/get_metadata', { path: value })),
          key: value,
        };
      }
      const link = await rpc<LinkMeta>('sharing/get_shared_link_metadata', { url: value });
      return {
        provider: 'db',
        key: value,
        name: link.name,
        size: link.size,
        modified: link.server_modified,
        webUrl: value,
        access: 'token',
      };
    },

    async fetch(meta, { maxBytes, signal }) {
      if (meta.size !== undefined && meta.size > maxBytes) {
        throw new TooLargeError(meta.size, maxBytes);
      }
      let res: Response;
      if (meta.access === 'anonymous') {
        res = await send(env.fetch, rawLinkUrl(meta.key, cfg.rawBase), {
          signal,
          timeoutMs: 300000,
        });
      } else if (meta.key.startsWith('id:')) {
        res = await download('files/download', { path: meta.key }, signal);
      } else {
        res = await download('sharing/get_shared_link_file', { url: meta.key }, signal);
      }
      if (!res.ok) {
        throw await errorOf(res, 'Dropbox download');
      }
      return readLimited(res, maxBytes, '');
    },

    folderUrl: (folder) =>
      folder.path
        ? `https://www.dropbox.com/home${encodeURI(folder.path)}`
        : 'https://www.dropbox.com/home',
  };
  return provider;
}
