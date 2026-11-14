// MIT License © 2026 Binary Dice Games
/**
 * @file OneDrive (`od`): Microsoft Graph v1.0 for personal and work accounts. Sign-in is the
 * authorization code grant with PKCE for a single-page app, with a refresh token. Public pastes
 * get an anonymous view link; members-only pastes are opened by drive and item id with the
 * viewer's own sign-in (Graph has no anonymous read, so every viewer signs in).
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

const SCOPES = 'Files.ReadWrite Files.Read.All Files.ReadWrite.AppFolder User.Read offline_access';

interface Item {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  eTag?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string; id?: string };
  remoteItem?: Item;
  '@microsoft.graph.downloadUrl'?: string;
}

interface Permission {
  roles?: string[];
  link?: { scope?: string; type?: string; webUrl?: string };
  grantedTo?: unknown;
  grantedToV2?: unknown;
  grantedToIdentitiesV2?: unknown[];
}

/** Graph's share id of a sharing URL: `u!` + base64url of the URL. */
export function shareIdOf(url: string): string {
  return `u!${textToBase64Url(url)}`;
}

/** Creates the OneDrive provider. */
export function createOneDriveProvider(env: ProviderEnv): Provider {
  const cfg = env.config.microsoft;
  const now = env.now ?? Date.now;
  const graph = cfg.graphBase;
  const tokenUrl = `${cfg.authority}/token`;
  const session = new AuthSession('od', env.tokens, env.fetch, now, (refreshToken) =>
    postTokenForm(env.fetch, tokenUrl, {
      client_id: cfg.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  );
  const configItem = `${graph}/me/drive/special/approot:/boh-config.json`;

  async function call<T>(url: string, init: RequestInit = {}, what = 'OneDrive'): Promise<T> {
    const res = await session.request(url, init);
    if (!res.ok) {
      throw statusError(res, what);
    }
    return jsonOf<T>(res);
  }

  /** Every page of a collection, at most 10. */
  async function collect(url: string): Promise<Item[]> {
    const items: Item[] = [];
    let next: string | undefined = url;
    for (let i = 0; next && i < 10; i++) {
      const page: { value: Item[]; '@odata.nextLink'?: string } = await call(next);
      items.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return items;
  }

  const driveOf = (item: Item, fallback?: string) =>
    item.parentReference?.driveId ?? fallback ?? '';

  const toMeta = (item: Item, driveId?: string): PasteMeta => ({
    provider: 'od',
    key: `${driveOf(item, driveId)}/${item.id}`,
    name: item.name,
    size: item.size,
    mime: item.file?.mimeType,
    modified: item.lastModifiedDateTime,
    webUrl: item.webUrl,
    access: 'token',
    source: item['@microsoft.graph.downloadUrl'],
  });

  const itemUrl = (key: string) => {
    const [driveId = '', itemId = ''] = key.split('/');
    return `${graph}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  };
  const folderUrlOf = (f: FolderRef) => itemUrl(`${f.driveId ?? ''}/${f.id}`);
  const folderOf = (item: Item, driveId?: string): FolderRef => ({
    id: item.id,
    name: item.name,
    driveId: driveOf(item, driveId),
  });

  function decodeRef(ref: string): { kind: 'u' | 'i'; value: string } {
    let text: string;
    try {
      text = base64UrlToText(ref);
    } catch {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    const kind = text.slice(0, 2);
    if (kind !== 'u:' && kind !== 'i:') {
      throw new ProviderError('not_found', 'the link is damaged');
    }
    return { kind: kind[0] as 'u' | 'i', value: text.slice(2) };
  }

  const provider: Provider = {
    id: 'od',
    label: 'OneDrive',
    configured: Boolean(cfg.clientId),
    maxUploadBytes: 200 * 1024 * 1024,

    async signIn({ stay, signal }) {
      if (!cfg.clientId) {
        throw new ProviderError('not_configured', 'this build has no Microsoft client id');
      }
      const popup = openSignInPopup(env.popup);
      const verifier = createVerifier();
      const answer = await authorizeInPopup(
        popup,
        `${cfg.authority}/authorize`,
        {
          client_id: cfg.clientId,
          response_type: 'code',
          response_mode: 'query',
          redirect_uri: env.popup.redirectUri,
          scope: SCOPES,
          code_challenge: await challengeOf(verifier),
          code_challenge_method: 'S256',
          prompt: 'select_account',
        },
        { signal },
      );
      const tokens = await postTokenForm(env.fetch, tokenUrl, {
        client_id: cfg.clientId,
        grant_type: 'authorization_code',
        code: answer.code ?? '',
        redirect_uri: env.popup.redirectUri,
        code_verifier: verifier,
        scope: SCOPES,
      });
      session.store(tokens, stay);
      const me = await call<{
        id: string;
        displayName: string;
        mail?: string;
        userPrincipalName?: string;
      }>(`${graph}/me`);
      const account = { id: me.id, name: me.displayName, email: me.mail ?? me.userPrincipalName };
      session.setAccount(account);
      return account;
    },

    async signOut() {
      session.clear(); // Microsoft has no token revocation for single-page apps
    },

    account: () => session.account(),
    setStay: (stay) => session.setStay(stay),

    async readConfig(): Promise<ConfigSnapshot> {
      const res = await session.request(configItem);
      if (res.status === 404) {
        return { text: null, rev: null };
      }
      if (!res.ok) {
        throw statusError(res, 'OneDrive settings');
      }
      const item = await jsonOf<Item>(res);
      const download = item['@microsoft.graph.downloadUrl'];
      const body = download
        ? await send(env.fetch, download)
        : await session.request(`${configItem}:/content`);
      if (!body.ok) {
        throw statusError(body, 'OneDrive settings');
      }
      return { text: await body.text(), rev: item.eTag ?? null };
    },

    async writeConfig(text, rev) {
      const res = await session.request(`${configItem}:/content`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(rev === null ? { 'if-none-match': '*' } : { 'if-match': rev }),
        },
        body: text,
      });
      if (res.status === 412 || res.status === 409) {
        throw new ConflictError();
      }
      if (!res.ok) {
        throw statusError(res, 'OneDrive settings');
      }
      return (await jsonOf<Item>(res)).eTag ?? '';
    },

    async listFolders(parent) {
      if (parent) {
        const items = await collect(`${folderUrlOf(parent)}/children?$top=200`);
        return items.filter((i) => i.folder).map((i) => folderOf(i, parent.driveId));
      }
      const own = await collect(`${graph}/me/drive/root/children?$top=200`);
      const shared = await collect(`${graph}/me/drive/sharedWithMe`).catch(() => [] as Item[]);
      return [
        ...own.filter((i) => i.folder).map((i) => folderOf(i)),
        ...shared.filter((i) => i.remoteItem?.folder).map((i) => folderOf(i.remoteItem as Item)),
      ].sort((a, b) => a.name.localeCompare(b.name));
    },

    async createFolder(name, parent) {
      const url = parent ? `${folderUrlOf(parent)}/children` : `${graph}/me/drive/root/children`;
      const item = await call<Item>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      });
      return folderOf(item, parent?.driveId);
    },

    async describeSharing(folder): Promise<Sharing> {
      const item = await call<Item>(folderUrlOf(folder)).catch(() => undefined);
      const manageUrl = item?.webUrl;
      const res = await session.request(`${folderUrlOf(folder)}/permissions`);
      if (res.status === 403 || res.status === 404) {
        return { kind: 'unknown', manageUrl };
      }
      if (!res.ok) {
        throw statusError(res, 'OneDrive sharing');
      }
      const { value } = await jsonOf<{ value: Permission[] }>(res);
      if (value.some((p) => p.link?.scope === 'anonymous')) {
        return { kind: 'public', manageUrl };
      }
      const others = value.filter((p) => !p.roles?.includes('owner')).length;
      return others > 0
        ? { kind: 'members', members: others, manageUrl }
        : { kind: 'private', manageUrl };
    },

    async list(folder, cursor): Promise<ListPage> {
      if (cursor && !cursor.startsWith(`${graph}/`)) {
        throw new ProviderError('failed', 'bad listing cursor');
      }
      const page = await call<{ value: Item[]; '@odata.nextLink'?: string }>(
        cursor ?? `${folderUrlOf(folder)}/children?$top=50`,
      );
      const items = page.value
        .filter((i) => i.file)
        .sort((a, b) => (b.lastModifiedDateTime ?? '').localeCompare(a.lastModifiedDateTime ?? ''))
        .map((i) => toMeta(i, folder.driveId));
      return { items, cursor: page['@odata.nextLink'] };
    },

    async upload(folder, name, blob) {
      const item = await call<Item>(
        `${folderUrlOf(folder)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
        {
          method: 'PUT',
          headers: { 'content-type': blob.type || 'application/octet-stream' },
          body: blob,
          timeoutMs: 600000,
        } as RequestInit,
        'OneDrive upload',
      );
      return toMeta(item, folder.driveId);
    },

    async share(meta, visibility) {
      if (visibility !== 'public') {
        return textToBase64Url(`i:${meta.key}`);
      }
      const res = await session.request(`${itemUrl(meta.key)}/createLink`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
      });
      if (res.status === 400 || res.status === 403) {
        throw new ProviderError(
          'unsupported',
          'this OneDrive account does not allow public links',
          res.status,
        );
      }
      if (!res.ok) {
        throw statusError(res, 'OneDrive link');
      }
      const { link } = await jsonOf<{ link: { webUrl: string } }>(res);
      return textToBase64Url(`u:${link.webUrl}`);
    },

    async remove(meta) {
      const res = await session.request(itemUrl(meta.key), { method: 'DELETE' });
      if (!res.ok) {
        throw statusError(res, 'OneDrive delete');
      }
    },

    async openRef(ref) {
      const { kind, value } = decodeRef(ref);
      if (!(await session.optionalToken())) {
        throw new ProviderError(
          'needs_sign_in',
          'sign in with a Microsoft account to open this paste',
        );
      }
      const url = kind === 'u' ? `${graph}/shares/${shareIdOf(value)}/driveItem` : itemUrl(value);
      const item = await call<Item>(url);
      return { ...toMeta(item), webUrl: kind === 'u' ? value : item.webUrl };
    },

    async fetch(meta, { maxBytes, signal }) {
      if (meta.size !== undefined && meta.size > maxBytes) {
        throw new TooLargeError(meta.size, maxBytes);
      }
      const direct = async (url: string) => send(env.fetch, url, { signal, timeoutMs: 300000 });
      let res = meta.source
        ? await direct(meta.source)
        : await session.request(`${itemUrl(meta.key)}/content`, { signal, timeoutMs: 300000 });
      if (meta.source && (res.status === 401 || res.status === 403)) {
        // The pre-authenticated address expired: ask for a fresh one.
        const fresh = (await call<Item>(itemUrl(meta.key)))['@microsoft.graph.downloadUrl'];
        if (fresh) {
          res = await direct(fresh);
        }
      }
      if (!res.ok) {
        throw statusError(res, 'OneDrive download');
      }
      return readLimited(res, maxBytes, '');
    },

    folderUrl: () => undefined,
  };
  return provider;
}
