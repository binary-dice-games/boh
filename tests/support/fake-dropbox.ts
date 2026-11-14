// MIT License © 2026 Binary Dice Games
/**
 * @file A fake Dropbox (OAuth code + PKCE with refresh tokens, API v2 RPC and content endpoints,
 * shared folders, shared links and their raw downloads) on loopback. Only what the Dropbox
 * provider calls is implemented.
 */
import {
  FakeServer,
  mimeOf,
  randomId,
  redirect,
  s256,
  type FakeRequest,
  type FakeResponse,
} from './fake-http';

/** A file or folder. */
export interface DropboxNode {
  id: string;
  name: string;
  tag: 'file' | 'folder';
  children: Map<string, DropboxNode>;
  parent?: DropboxNode;
  content: Buffer;
  rev: string;
  modified: string;
  owner: string;
  sharedFolderId?: string;
  members?: Set<string>;
}

interface Link {
  url: string;
  node: DropboxNode;
  audience: 'public' | 'no_one';
}

const fail = (summary: string, extra: Record<string, unknown> = {}): FakeResponse => ({
  status: 409,
  json: { error_summary: summary, error: { '.tag': summary.split('/')[0], ...extra } },
});

/** The fake. */
export class FakeDropbox {
  readonly server = new FakeServer();
  readonly roots = new Map<string, DropboxNode>();
  readonly index = new Map<string, DropboxNode>();
  readonly tokens = new Map<string, { user: string; expires: number }>();
  readonly refreshTokens = new Map<string, string>();
  readonly links = new Map<string, Link>();
  /** Accounts that cannot make members-only links (Dropbox Basic). */
  readonly basicAccounts = new Set<string>();
  readonly appKey = 'test-app-key';
  nextUser = 'alice';
  private readonly codes = new Map<string, { user: string; challenge: string; redirect: string }>();
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private revs = 0;

  constructor() {
    const s = this.server;
    s.route('GET', /^\/oauth2\/authorize$/, (r) => this.authorize(r));
    s.route('POST', /^\/oauth2\/token$/, (r) => this.token(r));
    s.route('POST', /^\/2\/auth\/token\/revoke$/, (r) => {
      this.tokens.delete(r.token ?? '');
      return { json: null };
    });
    const rpc = (
      path: string,
      fn: (
        user: string,
        args: Record<string, unknown>,
        r: FakeRequest,
      ) => FakeResponse | Promise<FakeResponse>,
    ) =>
      s.route('POST', new RegExp(`^/2/${path}$`), (r) =>
        this.withUser(r, (u) => {
          const arg = r.headers['dropbox-api-arg'];
          return fn(u, arg ? JSON.parse(String(arg)) : (r.json() ?? {}), r);
        }),
      );
    rpc('users/get_current_account', (u) => ({
      json: {
        account_id: `dbid:${u}`,
        name: { display_name: `${u[0]!.toUpperCase()}${u.slice(1)}` },
        email: `${u}@example.com`,
      },
    }));
    rpc('files/list_folder', (u, a) =>
      this.listFolder(u, String(a.path), Number(a.limit ?? 100), 0),
    );
    rpc('files/list_folder/continue', (u, a) => {
      const [path, offset, limit] = JSON.parse(
        Buffer.from(String(a.cursor), 'base64url').toString(),
      ) as [string, number, number];
      return this.listFolder(u, path, limit, offset);
    });
    rpc('files/get_metadata', (u, a) => {
      const n = this.resolve(u, String(a.path));
      return n ? { json: this.meta(u, n) } : fail('path/not_found/');
    });
    rpc('files/create_folder_v2', (u, a) => this.createFolder(u, String(a.path)));
    rpc('files/delete_v2', (u, a) => this.remove(u, String(a.path)));
    rpc('files/download', (u, a) => this.download(u, String(a.path)));
    rpc('files/upload', (u, a, r) => this.upload(u, a, r.body));
    rpc('sharing/create_shared_link_with_settings', (u, a) => this.createLink(u, a));
    rpc('sharing/list_shared_links', (u, a) => {
      const n = this.resolve(u, String(a.path));
      return {
        json: {
          links: n
            ? [...this.links.values()].filter((l) => l.node === n).map((l) => this.linkMeta(u, l))
            : [],
          has_more: false,
        },
      };
    });
    rpc('sharing/get_shared_link_metadata', (u, a) =>
      this.linkFor(u, String(a.url), (l) => ({ json: this.linkMeta(u, l) })),
    );
    rpc('sharing/get_shared_link_file', (u, a) =>
      this.linkFor(u, String(a.url), (l) => ({
        body: l.node.content,
        headers: { 'dropbox-api-result': JSON.stringify(this.linkMeta(u, l)) },
      })),
    );
    rpc('sharing/list_folder_members', (_u, a) => {
      const folder = [...this.index.values()].find((n) => n.sharedFolderId === a.shared_folder_id);
      return folder
        ? {
            json: {
              users: [folder.owner, ...folder.members!].map((m) => ({
                user: { account_id: `dbid:${m}` },
              })),
              groups: [],
            },
          }
        : fail('access_error/invalid_id/');
    });
    s.route('GET', /^\/scl\/fi\/.+$/, (r) => this.raw(r));
  }

  start(): Promise<string> {
    return this.server.start();
  }

  close(): Promise<void> {
    return this.server.close();
  }

  /** A token for `user`, as a sign-in would give. */
  issueToken(user: string, lifetimeMs = 4 * 3600 * 1000): string {
    const token = `db-${user}-${randomId()}`;
    this.tokens.set(token, { user, expires: Date.now() + lifetimeMs });
    return token;
  }

  /** A refresh token for `user`. */
  issueRefreshToken(user: string): string {
    const token = `dbr-${user}-${randomId()}`;
    this.refreshTokens.set(token, user);
    return token;
  }

  private rootOf(user: string): DropboxNode {
    let root = this.roots.get(user);
    if (!root) {
      root = this.node(user, '', 'folder');
      this.roots.set(user, root);
    }
    return root;
  }

  private node(
    owner: string,
    name: string,
    tag: 'file' | 'folder',
    parent?: DropboxNode,
    content: Buffer = Buffer.alloc(0),
  ): DropboxNode {
    const n: DropboxNode = {
      id: `id:${randomId(16)}`,
      name,
      tag,
      children: new Map(),
      parent,
      content,
      rev: `${(++this.revs).toString(16).padStart(9, '0')}`,
      modified: new Date((this.clock += 1000)).toISOString().replace(/\.\d+Z$/, 'Z'),
      owner,
    };
    this.index.set(n.id, n);
    parent?.children.set(name.toLowerCase(), n);
    return n;
  }

  /** Adds a folder or file at `path` of `user`'s Dropbox (parents created as needed). */
  add(user: string, path: string, content?: string | Buffer): DropboxNode {
    const parts = path.split('/').filter(Boolean);
    let at = this.rootOf(user);
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      at =
        at.children.get(part.toLowerCase()) ??
        this.node(
          user,
          part,
          last && content !== undefined ? 'file' : 'folder',
          at,
          last && content !== undefined ? Buffer.from(content) : undefined,
        );
    });
    return at;
  }

  /** Shares `user`'s folder at `path` with `members`, mounting it in their roots. */
  share(user: string, path: string, members: string[]): DropboxNode {
    const folder = this.add(user, path);
    folder.sharedFolderId = randomId(10);
    folder.members = new Set(members);
    for (const m of members) {
      this.rootOf(m).children.set(folder.name.toLowerCase(), folder);
    }
    return folder;
  }

  /** The node at `path` of `user`, if any. */
  at(user: string, path: string): DropboxNode | undefined {
    return this.resolve(user, path);
  }

  private reachable(user: string, n: DropboxNode): boolean {
    for (let at: DropboxNode | undefined = n; at; at = at.parent) {
      if (at === this.roots.get(user) || at.members?.has(user)) {
        return true;
      }
    }
    return false;
  }

  private resolve(user: string, path: string): DropboxNode | undefined {
    if (path.startsWith('id:')) {
      const n = this.index.get(path);
      return n && this.reachable(user, n) ? n : undefined;
    }
    let at: DropboxNode | undefined = this.rootOf(user);
    for (const part of path.split('/').filter(Boolean)) {
      at = at?.children.get(part.toLowerCase());
    }
    return at;
  }

  private pathOf(user: string, n: DropboxNode): string {
    const names: string[] = [];
    for (let at: DropboxNode | undefined = n; at && at !== this.roots.get(user); at = at.parent) {
      names.unshift(at.name);
      if (at.members?.has(user)) {
        break;
      }
    }
    return `/${names.join('/')}`;
  }

  private meta(user: string, n: DropboxNode) {
    const inShared = (() => {
      for (let at = n.parent; at; at = at.parent) {
        if (at.sharedFolderId) {
          return at.sharedFolderId;
        }
      }
      return undefined;
    })();
    return {
      '.tag': n.tag,
      id: n.id,
      name: n.name,
      path_display: this.pathOf(user, n),
      path_lower: this.pathOf(user, n).toLowerCase(),
      ...(n.tag === 'file'
        ? { size: n.content.length, rev: n.rev, server_modified: n.modified }
        : {}),
      ...(n.sharedFolderId
        ? { sharing_info: { shared_folder_id: n.sharedFolderId, read_only: false } }
        : inShared
          ? { sharing_info: { parent_shared_folder_id: inShared, read_only: false } }
          : {}),
    };
  }

  private withUser(
    r: FakeRequest,
    fn: (user: string) => FakeResponse | Promise<FakeResponse>,
  ): FakeResponse | Promise<FakeResponse> {
    const entry = r.token ? this.tokens.get(r.token) : undefined;
    if (!entry || entry.expires < Date.now()) {
      return { status: 401, json: { error_summary: 'expired_access_token/' } };
    }
    return fn(entry.user);
  }

  private authorize(r: FakeRequest): FakeResponse {
    const code = randomId();
    this.codes.set(code, {
      user: this.nextUser,
      challenge: r.query.get('code_challenge') ?? '',
      redirect: r.query.get('redirect_uri') ?? '',
    });
    const target = new URL(r.query.get('redirect_uri') ?? '');
    target.search = new URLSearchParams({ code, state: r.query.get('state') ?? '' }).toString();
    return redirect(target.toString());
  }

  private async token(r: FakeRequest): Promise<FakeResponse> {
    const form = r.form();
    if (form.get('client_id') !== this.appKey) {
      return { status: 400, json: { error: 'invalid_client' } };
    }
    let user: string | undefined;
    let refresh: string | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      const pending = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? '');
      if (
        !pending ||
        pending.redirect !== form.get('redirect_uri') ||
        (await s256(form.get('code_verifier') ?? '')) !== pending.challenge
      ) {
        return { status: 400, json: { error: 'invalid_grant' } };
      }
      user = pending.user;
      refresh = this.issueRefreshToken(user);
    } else if (form.get('grant_type') === 'refresh_token') {
      user = this.refreshTokens.get(form.get('refresh_token') ?? '');
    }
    if (!user) {
      return { status: 400, json: { error: 'invalid_grant' } };
    }
    return {
      json: {
        access_token: this.issueToken(user),
        token_type: 'bearer',
        expires_in: 14400,
        account_id: `dbid:${user}`,
        ...(refresh ? { refresh_token: refresh } : {}),
      },
    };
  }

  private listFolder(user: string, path: string, limit: number, offset: number): FakeResponse {
    const folder = this.resolve(user, path);
    if (!folder || folder.tag !== 'folder') {
      return fail('path/not_found/');
    }
    const all = [...folder.children.values()];
    const entries = all.slice(offset, offset + limit).map((n) => this.meta(user, n));
    const more = offset + limit < all.length;
    return {
      json: {
        entries,
        cursor: Buffer.from(JSON.stringify([path, offset + limit, limit])).toString('base64url'),
        has_more: more,
      },
    };
  }

  private split(user: string, path: string): { parent?: DropboxNode; name: string } {
    const at = path.lastIndexOf('/');
    return { parent: this.resolve(user, path.slice(0, at)), name: path.slice(at + 1) };
  }

  private createFolder(user: string, path: string): FakeResponse {
    const { parent, name } = this.split(user, path);
    if (!parent) {
      return fail('path/not_found/');
    }
    if (parent.children.has(name.toLowerCase())) {
      return fail('path/conflict/folder/');
    }
    return { json: { metadata: this.meta(user, this.node(user, name, 'folder', parent)) } };
  }

  private remove(user: string, path: string): FakeResponse {
    const n = this.resolve(user, path);
    if (!n || !n.parent) {
      return fail('path_lookup/not_found/');
    }
    const meta = this.meta(user, n);
    n.parent.children.delete(n.name.toLowerCase());
    this.index.delete(n.id);
    return { json: { metadata: meta } };
  }

  private download(user: string, path: string): FakeResponse {
    const n = this.resolve(user, path);
    if (!n || n.tag !== 'file') {
      return fail('path/not_found/');
    }
    return {
      body: n.content,
      headers: {
        'dropbox-api-result': JSON.stringify(this.meta(user, n)),
        'content-type': 'application/octet-stream',
      },
    };
  }

  private upload(user: string, a: Record<string, unknown>, body: Buffer): FakeResponse {
    const path = String(a.path);
    const mode =
      typeof a.mode === 'string'
        ? { '.tag': a.mode }
        : (a.mode as { '.tag': string; update?: string });
    let { parent, name } = this.split(user, path);
    if (path.startsWith('/Apps/boh/') && !parent) {
      parent = this.add(user, '/Apps/boh');
    }
    if (!parent) {
      return fail('path/not_found/');
    }
    const existing = parent.children.get(name.toLowerCase());
    if (mode['.tag'] === 'update') {
      if (!existing || existing.rev !== mode.update) {
        return fail('path/conflict/file/');
      }
      existing.content = body;
      existing.rev = `${(++this.revs).toString(16).padStart(9, '0')}`;
      return { json: this.meta(user, existing) };
    }
    if (existing) {
      if (!a.autorename) {
        return fail('path/conflict/file/');
      }
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 1;
      while (parent.children.has(`${stem} (${i})${ext}`.toLowerCase())) {
        i++;
      }
      name = `${stem} (${i})${ext}`;
    }
    return { json: this.meta(user, this.node(user, name, 'file', parent, body)) };
  }

  private linkMeta(user: string, l: Link) {
    return {
      '.tag': l.node.tag,
      url: l.url,
      name: l.node.name,
      id: l.node.id,
      size: l.node.content.length,
      server_modified: l.node.modified,
      path_lower: this.reachable(user, l.node)
        ? this.pathOf(user, l.node).toLowerCase()
        : undefined,
      link_permissions: {
        resolved_visibility: { '.tag': l.audience === 'public' ? 'public' : 'no_one' },
      },
    };
  }

  private createLink(user: string, a: Record<string, unknown>): FakeResponse {
    const n = this.resolve(user, String(a.path));
    if (!n) {
      return fail('path/not_found/');
    }
    const existing = [...this.links.values()].find((l) => l.node === n);
    if (existing) {
      return fail('shared_link_already_exists/metadata/', {
        shared_link_already_exists: { '.tag': 'metadata', metadata: this.linkMeta(user, existing) },
      });
    }
    const audience = ((a.settings as { audience?: { '.tag': string } })?.audience?.['.tag'] ??
      'public') as Link['audience'];
    if (audience === 'no_one' && this.basicAccounts.has(user)) {
      return fail('settings_error/not_authorized/');
    }
    const url = `${this.server.url}/scl/fi/${randomId(20)}/${encodeURIComponent(n.name)}?rlkey=${randomId(16)}&dl=0`;
    const link: Link = { url, node: n, audience };
    this.links.set(url, link);
    return { json: this.linkMeta(user, link) };
  }

  /** The link at `url` (matched by path and `rlkey`, ignoring the host and `dl`). */
  private findLink(url: string): Link | undefined {
    const wanted = new URL(url);
    return this.findByPath(decodeURIComponent(wanted.pathname), wanted.searchParams.get('rlkey'));
  }

  private findByPath(path: string, rlkey: string | null): Link | undefined {
    return [...this.links.values()].find((l) => {
      const u = new URL(l.url);
      return decodeURIComponent(u.pathname) === path && u.searchParams.get('rlkey') === rlkey;
    });
  }

  private linkFor(user: string, url: string, fn: (l: Link) => FakeResponse): FakeResponse {
    const l = this.findLink(url);
    if (!l || !this.index.has(l.node.id)) {
      return fail('shared_link_not_found/');
    }
    if (l.audience !== 'public' && !this.reachable(user, l.node)) {
      return fail('shared_link_access_denied/');
    }
    return fn(l);
  }

  private raw(r: FakeRequest): FakeResponse {
    const l = this.findByPath(r.path, r.query.get('rlkey'));
    if (!l || !this.index.has(l.node.id)) {
      return { status: 404, body: 'not found' };
    }
    if (l.audience !== 'public') {
      return { status: 403, body: 'forbidden' };
    }
    return {
      body: l.node.content,
      headers: {
        'content-type': mimeOf(l.node.name),
        'content-length': String(l.node.content.length),
      },
    };
  }
}
