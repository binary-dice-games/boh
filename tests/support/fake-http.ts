// MIT License © 2026 Binary Dice Games
/**
 * @file A tiny loopback HTTP server for the provider fakes: routes, JSON, CORS for the browser
 * tests, bearer tokens, and injected failures. Listens on a free port.
 */
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request as a fake handler sees it. */
export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** The bearer token, if any. */
  token?: string;
  /** The body as JSON (`null` for an empty body). */
  json<T = Record<string, unknown>>(): T;
  /** The body as a form. */
  form(): URLSearchParams;
}

/** A handler's answer. */
export interface FakeResponse {
  status?: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

export type Handler = (
  req: FakeRequest,
  match: RegExpExecArray,
) => FakeResponse | Promise<FakeResponse>;

const EXPOSE = 'dropbox-api-result, location, etag, content-length, content-type, retry-after';

/** A fake service on loopback. */
export class FakeServer {
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  private readonly failures: {
    status: number;
    count: number;
    match: RegExp;
    headers?: Record<string, string>;
  }[] = [];
  private server: Server | undefined;
  /** `http://127.0.0.1:<port>`, once started. */
  url = '';
  /** Every request seen: method and path. */
  readonly log: { method: string; path: string }[] = [];

  /** Adds a route; `pattern` matches the path (without the query). */
  route(method: string, pattern: RegExp, handler: Handler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  /** The next `count` requests whose path matches `match` fail with `status`. */
  failNext(status: number, count = 1, match = /./, headers?: Record<string, string>): void {
    this.failures.push({ status, count, match, headers });
  }

  /** Drops every injected failure not used up yet. */
  clearFailures(): void {
    this.failures.length = 0;
  }

  /** Starts listening on a free loopback port. */
  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void this.handle(
          req.method ?? 'GET',
          req.url ?? '/',
          req.headers,
          Buffer.concat(chunks),
        ).then(
          (answer) => {
            const headers: Record<string, string> = {
              'access-control-allow-origin': '*',
              'access-control-expose-headers': EXPOSE,
              ...answer.headers,
            };
            let body: Buffer | string = answer.body ?? '';
            if (answer.json !== undefined) {
              body = JSON.stringify(answer.json);
              headers['content-type'] ??= 'application/json';
            }
            res.writeHead(answer.status ?? 200, headers);
            res.end(req.method === 'HEAD' ? undefined : body);
          },
          (e: unknown) => {
            res.writeHead(500, { 'access-control-allow-origin': '*' });
            res.end(String(e));
          },
        );
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  /** Stops the server. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => resolve());
    });
  }

  private async handle(
    method: string,
    rawUrl: string,
    headers: IncomingHttpHeaders,
    body: Buffer,
  ): Promise<FakeResponse> {
    const url = new URL(rawUrl, 'http://fake');
    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD',
          'access-control-allow-headers': String(headers['access-control-request-headers'] ?? '*'),
          'access-control-max-age': '600',
        },
      };
    }
    this.log.push({ method, path: url.pathname });
    const failure = this.failures.find((f) => f.count > 0 && f.match.test(url.pathname));
    if (failure) {
      failure.count--;
      return { status: failure.status, json: { error: 'injected' }, headers: failure.headers };
    }
    const auth = String(headers.authorization ?? '');
    const req: FakeRequest = {
      method,
      path: decodeURIComponent(url.pathname),
      query: url.searchParams,
      headers,
      body,
      token: auth.startsWith('Bearer ') ? auth.slice(7) : undefined,
      json: <T>() => (body.length ? JSON.parse(body.toString('utf8')) : null) as T,
      form: () => new URLSearchParams(body.toString('utf8')),
    };
    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (match && (route.method === method || (route.method === 'GET' && method === 'HEAD'))) {
        return route.handler(req, match);
      }
    }
    return { status: 404, json: { error: `no route for ${method} ${url.pathname}` } };
  }
}

/** A random id of letters and digits. */
export function randomId(length = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** The S256 PKCE challenge of a verifier. */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

/** A redirect answer. */
export function redirect(location: string): FakeResponse {
  return { status: 302, headers: { location } };
}

/** The MIME type of a file name, for the fakes' downloads. */
export function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    json: 'application/json',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    pdf: 'application/pdf',
  };
  return types[ext] ?? 'application/octet-stream';
}
