// MIT License © 2026 Binary Dice Games
/**
 * @file A fake Google Drive (OAuth implicit grant, Drive API v3, the Picker grant) on loopback,
 * with the `drive.file` rule: a user's token reaches only files boh created for them and files or
 * folders they picked. Only what the Drive provider calls is implemented.
 */
import {
  FakeServer,
  mimeOf,
  randomId,
  redirect,
  type FakeRequest,
  type FakeResponse,
} from './fake-http';

const FOLDER = 'application/vnd.google-apps.folder';

/** A file or folder. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Buffer;
  owner: string;
  appData: boolean;
  anyone: boolean;
  members: Set<string>;
  version: number;
  trashed: boolean;
  createdTime: string;
  createdByApp: boolean;
}

/** The fake. */
export class FakeDrive {
  readonly server = new FakeServer();
  readonly files = new Map<string, DriveFile>();
  readonly tokens = new Map<string, string>();
  readonly grants = new Map<string, Set<string>>();
  readonly apiKey = 'test-api-key';
  /** Who signs in next. */
  nextUser = 'alice';
  /** The next sign-in is refused. */
  denyNext = false;
  /** Whether a Picker grant on a folder covers the files in it (an open question, step 1). */
  folderGrantCoversChildren = true;
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private readonly uploads = new Map<string, object>();

  constructor() {
    const s = this.server;
    s.route('GET', /^\/o\/oauth2\/v2\/auth$/, (r) => this.authorize(r));
    s.route('POST', /^\/revoke$/, (r) => {
      this.tokens.delete(r.query.get('token') ?? '');
      return { json: {} };
    });
    s.route('GET', /^\/drive\/v3\/about$/, (r) =>
      this.withUser(r, (u) => ({ json: { user: this.userInfo(u) } })),
    );
    s.route('GET', /^\/drive\/v3\/files$/, (r) => this.withUser(r, (u) => this.list(r, u)));
    s.route('GET', /^\/drive\/v3\/files\/([^/]+)\/permissions$/, (r, m) =>
      this.withUser(r, (u) => this.permissions(u, m[1]!)),
    );
    s.route('GET', /^\/drive\/v3\/files\/([^/]+)$/, (r, m) => this.get(r, m[1]!));
    s.route('POST', /^\/drive\/v3\/files$/, (r) =>
      this.withUser(r, (u) => this.createMeta(u, r.json())),
    );
    s.route('PATCH', /^\/drive\/v3\/files\/([^/]+)$/, (r, m) =>
      this.withUser(r, (u) => this.patch(u, m[1]!, r.json())),
    );
    s.route('POST', /^\/upload\/drive\/v3\/files$/, (r) =>
      this.withUser(r, (u) => this.upload(r, u)),
    );
    s.route('PUT', /^\/upload\/session\/([^/]+)$/, (r, m) => this.finishResumable(r, m[1]!));
    s.route('PATCH', /^\/upload\/drive\/v3\/files\/([^/]+)$/, (r, m) =>
      this.withUser(r, (u) => this.replace(u, m[1]!, r.body)),
    );
    s.route('POST', /^\/__picker$/, (r) =>
      this.withUser(r, (u) => this.pick(u, r.json<{ id: string }>().id)),
    );
  }

  /** Starts the server; returns its base URL. */
  start(): Promise<string> {
    return this.server.start();
  }

  close(): Promise<void> {
    return this.server.close();
  }

  /** A token for `user`, as a sign-in would give. */
  issueToken(user: string): string {
    const token = `gd-${user}-${randomId()}`;
    this.tokens.set(token, user);
    return token;
  }

  /** Adds a file or folder directly (as if made in Drive's own UI). */
  add(spec: {
    name: string;
    owner: string;
    parent?: string;
    folder?: boolean;
    content?: string | Buffer;
    anyone?: boolean;
    members?: string[];
    createdByApp?: boolean;
  }): string {
    const id = randomId(20);
    this.files.set(id, {
      id,
      name: spec.name,
      mimeType: spec.folder ? FOLDER : mimeOf(spec.name),
      parents: spec.parent ? [spec.parent] : [],
      content: Buffer.from(spec.content ?? ''),
      owner: spec.owner,
      appData: false,
      anyone: spec.anyone ?? false,
      members: new Set(spec.members ?? []),
      version: 1,
      trashed: false,
      createdTime: this.tick(),
      createdByApp: spec.createdByApp ?? false,
    });
    return id;
  }

  /** Grants `user`'s boh access to `id`, as the Picker does. */
  grant(user: string, id: string): void {
    const set = this.grants.get(user) ?? new Set<string>();
    set.add(id);
    this.grants.set(user, set);
  }

  /** The config file of `user`, if any. */
  configOf(user: string): DriveFile | undefined {
    return [...this.files.values()].find(
      (f) => f.appData && f.owner === user && f.name === 'boh-config.json',
    );
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private userInfo(user: string) {
    return {
      displayName: `${user[0]!.toUpperCase()}${user.slice(1)}`,
      emailAddress: `${user}@example.com`,
      permissionId: `perm-${user}`,
    };
  }

  private withUser(r: FakeRequest, fn: (user: string) => FakeResponse): FakeResponse {
    const user = r.token ? this.tokens.get(r.token) : undefined;
    return user ? fn(user) : { status: 401, json: { error: { code: 401 } } };
  }

  private authorize(r: FakeRequest): FakeResponse {
    const target = new URL(r.query.get('redirect_uri') ?? '');
    const state = r.query.get('state') ?? '';
    if (this.denyNext) {
      this.denyNext = false;
      target.hash = new URLSearchParams({ error: 'access_denied', state }).toString();
      return redirect(target.toString());
    }
    target.hash = new URLSearchParams({
      access_token: this.issueToken(this.nextUser),
      token_type: 'Bearer',
      expires_in: '3599',
      scope: r.query.get('scope') ?? '',
      state,
    }).toString();
    return redirect(target.toString());
  }

  private parentsOf(f: DriveFile): DriveFile[] {
    return f.parents.map((p) => this.files.get(p)).filter((p): p is DriveFile => p !== undefined);
  }

  private hasPermission(user: string, f: DriveFile): boolean {
    return (
      f.owner === user ||
      f.anyone ||
      f.members.has(user) ||
      this.parentsOf(f).some((p) => this.hasPermission(user, p))
    );
  }

  private appAccess(user: string, f: DriveFile): boolean {
    if ((f.owner === user && f.createdByApp) || this.grants.get(user)?.has(f.id)) {
      return true;
    }
    return this.folderGrantCoversChildren && this.parentsOf(f).some((p) => this.appAccess(user, p));
  }

  canRead(user: string, f: DriveFile): boolean {
    if (f.trashed) {
      return false;
    }
    if (f.appData) {
      return f.owner === user;
    }
    return this.hasPermission(user, f) && this.appAccess(user, f);
  }

  private anyoneUp(f: DriveFile): boolean {
    return f.anyone || this.parentsOf(f).some((p) => this.anyoneUp(p));
  }

  private meta(f: DriveFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.mimeType === FOLDER ? undefined : String(f.content.length),
      modifiedTime: f.createdTime,
      webViewLink: `https://drive.example/file/${f.id}`,
      version: String(f.version),
    };
  }

  private list(r: FakeRequest, user: string): FakeResponse {
    const q = r.query.get('q') ?? '';
    let found = [...this.files.values()];
    if (r.query.get('spaces') === 'appDataFolder') {
      found = found.filter((f) => f.appData && f.owner === user);
    } else {
      found = found.filter((f) => !f.appData && this.canRead(user, f));
    }
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent) {
      found = found.filter((f) => f.parents.includes(parent));
    }
    const name = /name = '([^']*)'/.exec(q)?.[1];
    if (name !== undefined) {
      found = found.filter((f) => f.name === name);
    }
    if (q.includes('trashed = false')) {
      found = found.filter((f) => !f.trashed);
    }
    if (q.includes(`mimeType != '${FOLDER}'`)) {
      found = found.filter((f) => f.mimeType !== FOLDER);
    }
    found.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    const size = Number(r.query.get('pageSize') ?? 100);
    const start = Number(r.query.get('pageToken') ?? 0);
    const page = found.slice(start, start + size);
    const next = start + size < found.length ? String(start + size) : undefined;
    return {
      json: { files: page.map((f) => this.meta(f)), ...(next ? { nextPageToken: next } : {}) },
    };
  }

  private get(r: FakeRequest, id: string): FakeResponse {
    const f = this.files.get(id);
    let allowed: boolean;
    if (r.token) {
      const user = this.tokens.get(r.token);
      if (!user) {
        return { status: 401, json: {} };
      }
      allowed = f !== undefined && this.canRead(user, f);
    } else if (r.query.get('key') === this.apiKey) {
      allowed = f !== undefined && !f.trashed && !f.appData && this.anyoneUp(f);
    } else {
      return { status: 403, json: { error: 'no key' } };
    }
    if (!f || !allowed) {
      return { status: 404, json: { error: { code: 404 } } };
    }
    if (r.query.get('alt') === 'media') {
      return {
        body: f.content,
        headers: { 'content-type': f.mimeType, 'content-length': String(f.content.length) },
      };
    }
    return { json: this.meta(f) };
  }

  private permissions(user: string, id: string): FakeResponse {
    const f = this.files.get(id);
    if (!f || !this.canRead(user, f)) {
      return { status: 404, json: {} };
    }
    if (f.owner !== user) {
      return { status: 403, json: {} };
    }
    return {
      json: {
        permissions: [
          { type: 'user', role: 'owner' },
          ...(f.anyone ? [{ type: 'anyone', role: 'reader' }] : []),
          ...[...f.members].map(() => ({ type: 'user', role: 'writer' })),
        ],
      },
    };
  }

  private canWriteInto(user: string, parentId: string | undefined): boolean {
    if (!parentId || parentId === 'appDataFolder') {
      return true;
    }
    const parent = this.files.get(parentId);
    return (
      parent !== undefined &&
      this.canRead(user, parent) &&
      (parent.owner === user ||
        parent.members.has(user) ||
        this.parentsOf(parent).some((p) => p.members.has(user)))
    );
  }

  private create(
    user: string,
    metadata: { name?: string; mimeType?: string; parents?: string[] },
    content: Buffer,
  ): FakeResponse {
    const parent = metadata.parents?.[0];
    if (!this.canWriteInto(user, parent)) {
      return { status: 404, json: { error: 'parent not found' } };
    }
    const id = randomId(20);
    const file: DriveFile = {
      id,
      name: metadata.name ?? 'Untitled',
      mimeType: metadata.mimeType ?? mimeOf(metadata.name ?? ''),
      parents: parent && parent !== 'appDataFolder' ? [parent] : [],
      content,
      owner: user,
      appData: parent === 'appDataFolder',
      anyone: false,
      members: new Set(),
      version: 1,
      trashed: false,
      createdTime: this.tick(),
      createdByApp: true,
    };
    this.files.set(id, file);
    return { json: this.meta(file) };
  }

  private createMeta(
    user: string,
    body: { name?: string; mimeType?: string; parents?: string[] },
  ): FakeResponse {
    return this.create(user, body, Buffer.alloc(0));
  }

  private patch(user: string, id: string, body: { trashed?: boolean }): FakeResponse {
    const f = this.files.get(id);
    if (!f || !this.canRead(user, f)) {
      return { status: 404, json: {} };
    }
    if (f.owner !== user) {
      return { status: 403, json: {} };
    }
    if (body.trashed !== undefined) {
      f.trashed = body.trashed;
    }
    return { json: this.meta(f) };
  }

  private upload(r: FakeRequest, user: string): FakeResponse {
    const type = r.query.get('uploadType');
    if (type === 'resumable') {
      const session = randomId();
      this.uploads.set(session, { user, metadata: r.json() });
      return { headers: { location: `${this.server.url}/upload/session/${session}` } };
    }
    const boundary = /boundary=([^;]+)/.exec(String(r.headers['content-type']))?.[1];
    if (type !== 'multipart' || !boundary) {
      return { status: 400, json: { error: 'bad upload' } };
    }
    const delimiter = Buffer.from(`--${boundary}`);
    const parts: Buffer[] = [];
    let at = r.body.indexOf(delimiter);
    while (at >= 0) {
      const next = r.body.indexOf(delimiter, at + delimiter.length);
      if (next < 0) {
        break;
      }
      parts.push(r.body.subarray(at + delimiter.length + 2, next - 2));
      at = next;
    }
    const bodyOf = (part: Buffer) => part.subarray(part.indexOf('\r\n\r\n') + 4);
    if (parts.length !== 2) {
      return { status: 400, json: { error: 'bad multipart' } };
    }
    return this.create(
      user,
      JSON.parse(bodyOf(parts[0]!).toString('utf8')),
      Buffer.from(bodyOf(parts[1]!)),
    );
  }

  private finishResumable(r: FakeRequest, session: string): FakeResponse {
    const pending = this.uploads.get(session) as
      { user: string; metadata: { name?: string; parents?: string[] } } | undefined;
    if (!pending) {
      return { status: 404, json: {} };
    }
    this.uploads.delete(session);
    return this.create(pending.user, pending.metadata, r.body);
  }

  private replace(user: string, id: string, content: Buffer): FakeResponse {
    const f = this.files.get(id);
    if (!f || !this.canRead(user, f)) {
      return { status: 404, json: {} };
    }
    f.content = content;
    f.version++;
    return { json: this.meta(f) };
  }

  private pick(user: string, id: string): FakeResponse {
    const f = this.files.get(id);
    if (!f || !this.hasPermission(user, f)) {
      return { status: 404, json: {} };
    }
    this.grant(user, id);
    return { json: { id: f.id, name: f.name } };
  }
}
