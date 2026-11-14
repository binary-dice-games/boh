// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { ProviderError, reasonOf, TooLargeError } from '../../web/src/errors';
import { readLimited, retryDelay, send, statusError } from '../../web/src/http';

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : 'x', { status, headers });

describe('send', () => {
  it('retries 429 and 503, then gives up with rate_limited', async () => {
    const statuses = [503, 429, 200];
    const calls: number[] = [];
    const res = await send(async () => {
      calls.push(1);
      return answer(statuses.shift()!, { 'retry-after': '0.001' });
    }, 'u');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    await expect(
      send(async () => answer(429, { 'retry-after': '0.001' }), 'u'),
    ).rejects.toMatchObject({ reason: 'rate_limited' });
  });

  it('maps network failures and timeouts to network', async () => {
    await expect(send(() => Promise.reject(new TypeError('down')), 'u')).rejects.toMatchObject({
      reason: 'network',
    });
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_ok, fail) =>
        init?.signal?.addEventListener('abort', () => fail(init.signal!.reason)),
      );
    await expect(send(hang, 'u', { timeoutMs: 20 })).rejects.toMatchObject({ reason: 'network' });
  });

  it('passes the caller abort through', async () => {
    const controller = new AbortController();
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_ok, fail) =>
        init?.signal?.addEventListener('abort', () => fail(init.signal!.reason)),
      );
    const pending = send(hang, 'u', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toSatisfy((e) => reasonOf(e) === 'aborted');
  });

  it('bounds the retry delay', () => {
    expect(retryDelay(answer(429, { 'retry-after': '120' }), 0)).toBe(8000);
    expect(retryDelay(answer(429), 2)).toBe(2000);
  });
});

describe('statusError', () => {
  it.each([
    [401, 'needs_sign_in'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [410, 'not_found'],
    [429, 'rate_limited'],
    [500, 'failed'],
  ])('%i is %s', (status, reason) => {
    const e = statusError(answer(status));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ reason, status });
  });
});

describe('readLimited', () => {
  it('reads a body under the limit with the given type', async () => {
    const blob = await readLimited(new Response('hello'), 10, 'text/plain');
    expect(await blob.text()).toBe('hello');
    expect(blob.type).toBe('text/plain');
  });

  it('stops at the declared or the real size', async () => {
    await expect(
      readLimited(new Response('hello', { headers: { 'content-length': '5' } }), 4, ''),
    ).rejects.toBeInstanceOf(TooLargeError);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(3));
        c.enqueue(new Uint8Array(3));
        c.close();
      },
    });
    await expect(readLimited(new Response(stream), 4, '')).rejects.toMatchObject({
      size: 6,
      limit: 4,
    });
  });
});
