// MIT License © 2026 Binary Dice Games
/**
 * @file HTTP for the providers: timeouts, aborts, bounded retries on rate limits, and the mapping
 * of statuses and network failures to `ProviderError`.
 */
import { ProviderError, TooLargeError } from './errors';

/** `fetch` as the providers use it (tests pass their own). */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Options of `send`. */
export interface SendOptions extends RequestInit {
  /** Overall time for one attempt; default 30 s. */
  timeoutMs?: number;
  /** Attempts on 429 and 503; default 3. */
  attempts?: number;
}

const MAX_RETRY_DELAY_MS = 8000;

/** Waits `ms`, or rejects when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** How long a 429/503 asks to wait: `Retry-After` seconds, else exponential, at most 8 s. */
export function retryDelay(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt;
  return Math.min(ms, MAX_RETRY_DELAY_MS);
}

/**
 * Sends one request. Retries 429 and 503 with bounded backoff; other statuses come back as they
 * are (map them with `statusError`).
 * @throws {ProviderError} `network` when the request fails or times out, `rate_limited` when
 *   every attempt was refused with 429
 * @throws the caller's abort reason when `init.signal` aborts
 */
export async function send(
  fetchFn: FetchFn,
  url: string,
  init: SendOptions = {},
): Promise<Response> {
  const { timeoutMs = 30000, attempts = 3, signal, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    let res: Response;
    try {
      res = await fetchFn(url, { ...rest, signal: AbortSignal.any(signals) });
    } catch (e) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      throw new ProviderError('network', e instanceof Error ? e.message : String(e));
    }
    if ((res.status === 429 || res.status === 503) && attempt + 1 < attempts) {
      await sleep(retryDelay(res, attempt), signal);
      continue;
    }
    if (res.status === 429) {
      throw new ProviderError('rate_limited', 'the service asks to slow down', 429);
    }
    return res;
  }
}

/** The `ProviderError` of an unsuccessful response. */
export function statusError(res: Response, what = 'request'): ProviderError {
  const reason =
    res.status === 401
      ? 'needs_sign_in'
      : res.status === 403
        ? 'forbidden'
        : res.status === 404 || res.status === 410
          ? 'not_found'
          : res.status === 429
            ? 'rate_limited'
            : 'failed';
  return new ProviderError(reason, `${what}: HTTP ${res.status}`, res.status);
}

/**
 * The body of `res` as a `Blob` of `type`, read in chunks so a body over `maxBytes` is cut off
 * without being held in memory.
 * @throws {TooLargeError} when the body is over `maxBytes`
 * @throws {ProviderError} `network` when the body stops arriving
 */
export async function readLimited(res: Response, maxBytes: number, type: string): Promise<Blob> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new TooLargeError(declared, maxBytes);
  }
  if (!res.body) {
    return new Blob([], { type });
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TooLargeError(total, maxBytes);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof TooLargeError || (e instanceof DOMException && e.name === 'AbortError')) {
      throw e;
    }
    throw new ProviderError('network', e instanceof Error ? e.message : String(e));
  }
  return new Blob(chunks as BlobPart[], { type });
}

/** Reads a JSON body, or throws `ProviderError('failed')` when it is not JSON. */
export async function jsonOf<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(
      'failed',
      'the service answered with something that is not JSON',
      res.status,
    );
  }
}
