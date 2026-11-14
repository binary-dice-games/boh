// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  base64UrlToText,
  bytesToBase64Url,
  textToBase64Url,
} from '../../web/src/b64';
import { challengeOf, createVerifier, randomString } from '../../web/src/pkce';

describe('base64url', () => {
  it('round-trips bytes and text without padding', () => {
    const bytes = new Uint8Array([0, 251, 255, 63, 62]);
    const b64 = bytesToBase64Url(bytes);
    expect(b64).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(b64)).toEqual(bytes);
    expect(base64UrlToText(textToBase64Url('día ✓'))).toBe('día ✓');
  });

  it('rejects text that is not UTF-8', () => {
    expect(() => base64UrlToText(bytesToBase64Url(new Uint8Array([0xff])))).toThrow();
  });
});

describe('PKCE', () => {
  it('makes the RFC 7636 example challenge', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes random verifiers of the allowed length', () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createVerifier()).not.toBe(v);
    expect(randomString(9)).toHaveLength(12);
  });
});
