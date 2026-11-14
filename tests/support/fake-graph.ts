// MIT License © 2026 Binary Dice Games
/**
 * @file A fake Microsoft identity platform and Graph (OneDrive) on loopback: code + PKCE with
 * refresh tokens, drives and items, the app folder, sharing links and pre-authenticated download
 * addresses. Only what the OneDrive provider calls is implemented.
 */
import {
  FakeServer,
  randomId,
  redirect,
  s256,
  type FakeRequest,
  type FakeResponse,
} from './fake-http';

/** A drive item. */
export interface GraphItem {
  id: string;
  name: string;
  folder: boolean;
  children: GraphItem[];
  parent?: GraphItem;
  driveId: string;
  content: Buffer;
  version: number;
  modified: string;
  /** Users this item is shared with directly. */
  sharedWith: Set<string>;
  anonymousLink?: string;
}

const owners = (driveId: string) => driveId.replace(/^drive-/, '');

/** The fake. */
export class FakeGraph {
  readonly server = new FakeServer();
  readonly drives = new Map<string, { root: GraphItem; approot: GraphItem }>();
  readonly items = new Map<string, GraphItem>();
  readonly tokens = new Map<string, string>();
  readonly refreshTokens = new Map<string, string>();
  readonly shares = new Map<string, GraphItem>();
  readonly downloads = new Map<string, GraphItem>();
  /** Users whose organization forbids anonymous links. */
  readonly noAnonymousLinks = new Set<string>();
  readonly clientId = 'test-client-id';
  nextUser = 'alice';
  private readonly codes = new Map<string, { user: string; challenge: string; redirect: string }>();
  private clock = Date.parse('2026-01-01T00:00:00Z');

  constructor() {
    const s = this.server;
    s.route('GET', /^\/common\/oauth2\/v2\.0\/authorize$/, (r) => this.authorize(r));
    s.route('POST', /^\/common\/oauth2\/v2\.0\/token$/, (r) => this.token(r));
    const api = (
      method: string,
      pattern: RegExp,
      fn: (user: string, r: FakeRequest, m: RegExpExecArray) => FakeResponse,
    ) =>
      s.route(method, pattern, (r, m) => {
        const user = r.token ? this.tokens.get(r.token) : undefined;
        return user
          ? fn(user, r, m)
          : { status: 401, json: { error: { code: 'InvalidAuthenticationToken' } } };
      });
    api('GET', /^\/v1\.0\/me$/, (u) => ({
      json: {
        id: `ms-${u}`,
        displayName: `${u[0]!.toUpperCase()}${u.slice(1)}`,
        mail: `${u}@example.com`,
      },
    }));
    api('GET', /^\/v1\.0\/me\/drive\/special\/approot:\/([^/:]+)$/, (u, _r, m) => {
      const item = this.drive(u).approot.children.find((c) => c.name === m[1]);
      return item
        ? { json: this.meta(item) }
        : { status: 404, json: { error: { code: 'itemNotFound' } } };
    });
    api('PUT', /^\/v1\.0\/me\/drive\/special\/approot:\/([^/:]+):\/content$/, (u, r, m) =>
      this.writeAppFile(u, m[1]!, r),
    );
    api('GET', /^\/v1\.0\/me\/drive\/root\/children$/, (u, r) =>
      this.children(u, this.drive(u).root, r),
    );
    api('POST', /^\/v1\.0\/me\/drive\/root\/children$/, (u, r) =>
      this.createFolder(u, this.drive(u).root, r),
    );
    api('GET', /^\/v1\.0\/me\/drive\/sharedWithMe$/, (u) => ({
      json: {
        value: [...this.items.values()]
          .filter((i) => i.sharedWith.has(u))
          .map((i) => ({ id: `remote-${i.id}`, name: i.name, remoteItem: this.meta(i) })),
      },
    }));
    const item = (
      u: string,
      m: RegExpExecArray,
      fn: (i: GraphItem) => FakeResponse,
    ): FakeResponse => {
      const i = this.items.get(`${m[1]}/${m[2]}`);
      return i && this.canRead(u, i)
        ? fn(i)
        : { status: 404, json: { error: { code: 'itemNotFound' } } };
    };
    const ITEM = '^/v1\\.0/drives/([^/]+)/items/([^/:]+)';
    api('GET', new RegExp(`${ITEM}$`), (u, _r, m) => item(u, m, (i) => ({ json: this.meta(i) })));
    api('GET', new RegExp(`${ITEM}/children$`), (u, r, m) =>
      item(u, m, (i) => this.children(u, i, r)),
    );
    api('POST', new RegExp(`${ITEM}/children$`), (u, r, m) =>
      item(u, m, (i) => this.createFolder(u, i, r)),
    );
    api('GET', new RegExp(`${ITEM}/permissions$`), (u, _r, m) =>
      item(u, m, (i) => {
        if (owners(i.driveId) !== u) {
          return { status: 403, json: { error: { code: 'accessDenied' } } };
        }
        return {
          json: {
            value: [
              { id: 'owner', roles: ['owner'] },
              ...[...this.sharedUp(i)].map((who) => ({
                id: who,
                roles: ['write'],
                grantedToV2: { user: { id: `ms-${who}` } },
              })),
              ...(i.anonymousLink
                ? [
                    {
                      id: 'link',
                      roles: ['read'],
                      link: { scope: 'anonymous', type: 'view', webUrl: i.anonymousLink },
                    },
                  ]
                : []),
            ],
          },
        };
      }),
    );
    api('GET', new RegExp(`${ITEM}/content$`), (u, _r, m) =>
      item(u, m, (i) => ({ body: i.content })),
    );
    api('PUT', new RegExp(`${ITEM}:/([^/:]+):/content$`), (u, r, m) =>
      item(u, m, (i) => this.upload(u, i, decodeURIComponent(m[3]!), r)),
    );
    api('POST', new RegExp(`${ITEM}/createLink$`), (u, r, m) =>
      item(u, m, (i) => {
        if (this.noAnonymousLinks.has(u) && r.json<{ scope: string }>().scope === 'anonymous') {
          return { status: 403, json: { error: { code: 'accessDenied' } } };
        }
        i.anonymousLink ??= `${this.server.url}/s/${randomId(16)}`;
        this.shares.set(i.anonymousLink, i);
        return {
          status: 201,
          json: { link: { type: 'view', scope: 'anonymous', webUrl: i.anonymousLink } },
        };
      }),
    );
    api('DELETE', new RegExp(`${ITEM}$`), (u, _r, m) =>
      item(u, m, (i) => {
        if (owners(i.driveId) !== u && !this.sharedUp(i).has(u)) {
          return { status: 403, json: {} };
        }
        i.parent!.children = i.parent!.children.filter((c) => c !== i);
        this.items.delete(`${i.driveId}/${i.id}`);
        return { status: 204 };
      }),
    );
    api('GET', /^\/v1\.0\/shares\/u!([^/]+)\/driveItem$/, (_u, _r, m) => {
      const url = Buffer.from(m[1]!, 'base64url').toString('utf8');
      const i = this.shares.get(url);
      return i && this.items.has(`${i.driveId}/${i.id}`)
        ? { json: this.meta(i) }
        : { status: 404, json: { error: { code: 'itemNotFound' } } };
    });
    s.route('GET', /^\/download\/([^/]+)$/, (_r, m) => {
      const i = this.downloads.get(m[1]!);
      return i
        ? { body: i.content, headers: { 'content-length': String(i.content.length) } }
        : { status: 401, body: 'expired' };
    });
  }

  start(): Promise<string> {
    return this.server.start();
  }

  close(): Promise<void> {
    return this.server.close();
  }

  /** A token for `user`, as a sign-in would give. */
  issueToken(user: string): string {
    const token = `od-${user}-${randomId()}`;
    this.tokens.set(token, user);
    return token;
  }

  /** `user`'s drive, created on first use. */
  drive(user: string): { root: GraphItem; approot: GraphItem } {
    let d = this.drives.get(user);
    if (!d) {
      const driveId = `drive-${user}`;
      const root = this.newItem(driveId, 'root', true);
      const approot = this.newItem(driveId, 'boh', true, root);
      d = { root, approot };
      this.drives.set(user, d);
    }
    return d;
  }

  /** Adds a folder or file under `parent` (default: the root) of `user`'s drive. */
  add(
    user: string,
    name: string,
    spec: { parent?: GraphItem; content?: string | Buffer; sharedWith?: string[] } = {},
  ): GraphItem {
    const item = this.newItem(
      `drive-${user}`,
      name,
      spec.content === undefined,
      spec.parent ?? this.drive(user).root,
      spec.content,
    );
    for (const who of spec.sharedWith ?? []) {
      item.sharedWith.add(who);
    }
    return item;
  }

  /** Expires every pre-authenticated download address. */
  expireDownloads(): void {
    this.downloads.clear();
  }

  private newItem(
    driveId: string,
    name: string,
    folder: boolean,
    parent?: GraphItem,
    content?: string | Buffer,
  ): GraphItem {
    const item: GraphItem = {
      id: randomId(16),
      name,
      folder,
      children: [],
      parent,
      driveId,
      content: Buffer.from(content ?? ''),
      version: 1,
      modified: new Date((this.clock += 1000)).toISOString(),
      sharedWith: new Set(),
    };
    parent?.children.push(item);
    this.items.set(`${driveId}/${item.id}`, item);
    return item;
  }

  private sharedUp(i: GraphItem): Set<string> {
    const out = new Set<string>();
    for (let at: GraphItem | undefined = i; at; at = at.parent) {
      at.sharedWith.forEach((w) => out.add(w));
    }
    return out;
  }

  private canRead(user: string, i: GraphItem): boolean {
    return owners(i.driveId) === user || this.sharedUp(i).has(user);
  }

  private meta(i: GraphItem) {
    let download: string | undefined;
    if (!i.folder) {
      download = randomId(20);
      this.downloads.set(download, i);
    }
    return {
      id: i.id,
      name: i.name,
      eTag: `"{${i.id}},${i.version}"`,
      size: i.content.length,
      lastModifiedDateTime: i.modified,
      webUrl: `https://onedrive.example/${i.driveId}/${i.id}`,
      parentReference: { driveId: i.driveId, id: i.parent?.id },
      ...(i.folder
        ? { folder: { childCount: i.children.length } }
        : { file: { mimeType: 'application/octet-stream' } }),
      ...(download
        ? { '@microsoft.graph.downloadUrl': `${this.server.url}/download/${download}` }
        : {}),
    };
  }

  private children(_user: string, i: GraphItem, r: FakeRequest): FakeResponse {
    const top = Number(r.query.get('$top') ?? 200);
    const skip = Number(r.query.get('$skiptoken') ?? 0);
    const page = i.children.slice(skip, skip + top);
    const more = skip + top < i.children.length;
    const next = new URL(`${this.server.url}${r.path}`);
    next.searchParams.set('$top', String(top));
    next.searchParams.set('$skiptoken', String(skip + top));
    return {
      json: {
        value: page.map((c) => this.meta(c)),
        ...(more ? { '@odata.nextLink': next.toString() } : {}),
      },
    };
  }

  private createFolder(user: string, parent: GraphItem, r: FakeRequest): FakeResponse {
    const body = r.json<{ name: string }>();
    if (!this.canRead(user, parent)) {
      return { status: 404, json: {} };
    }
    if (parent.children.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
      return { status: 409, json: { error: { code: 'nameAlreadyExists' } } };
    }
    return { status: 201, json: this.meta(this.newItem(parent.driveId, body.name, true, parent)) };
  }

  private upload(user: string, parent: GraphItem, name: string, r: FakeRequest): FakeResponse {
    if (!this.canRead(user, parent) || !parent.folder) {
      return { status: 404, json: {} };
    }
    let final = name;
    if (r.query.get('@microsoft.graph.conflictBehavior') === 'rename') {
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      for (
        let i = 1;
        parent.children.some((c) => c.name.toLowerCase() === final.toLowerCase());
        i++
      ) {
        final = `${stem} ${i}${ext}`;
      }
    }
    return {
      status: 201,
      json: this.meta(this.newItem(parent.driveId, final, false, parent, r.body)),
    };
  }

  private writeAppFile(user: string, name: string, r: FakeRequest): FakeResponse {
    const approot = this.drive(user).approot;
    const existing = approot.children.find((c) => c.name === name);
    const ifMatch = r.headers['if-match'];
    const ifNoneMatch = r.headers['if-none-match'];
    if (ifNoneMatch === '*' && existing) {
      return { status: 412, json: { error: { code: 'preconditionFailed' } } };
    }
    if (ifMatch !== undefined && (!existing || this.meta(existing).eTag !== ifMatch)) {
      return { status: 412, json: { error: { code: 'preconditionFailed' } } };
    }
    if (existing) {
      existing.content = r.body;
      existing.version++;
      return { json: this.meta(existing) };
    }
    return {
      status: 201,
      json: this.meta(this.newItem(approot.driveId, name, false, approot, r.body)),
    };
  }

  /** The app-folder file of `user`, if any. */
  appFile(user: string, name = 'boh-config.json'): GraphItem | undefined {
    return this.drive(user).approot.children.find((c) => c.name === name);
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
    if (form.get('client_id') !== this.clientId) {
      return { status: 400, json: { error: 'invalid_client' } };
    }
    let user: string | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      const pending = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? '');
      if (
        pending &&
        pending.redirect === form.get('redirect_uri') &&
        (await s256(form.get('code_verifier') ?? '')) === pending.challenge
      ) {
        user = pending.user;
      }
    } else if (form.get('grant_type') === 'refresh_token') {
      user = this.refreshTokens.get(form.get('refresh_token') ?? '');
      this.refreshTokens.delete(form.get('refresh_token') ?? ''); // rotated
    }
    if (!user) {
      return { status: 400, json: { error: 'invalid_grant' } };
    }
    const refresh = `odr-${user}-${randomId()}`;
    this.refreshTokens.set(refresh, user);
    return {
      json: {
        access_token: this.issueToken(user),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refresh,
        scope: form.get('scope'),
      },
    };
  }
}
