// MIT License © 2026 Binary Dice Games
/** @file base64url of bytes and of UTF-8 text, without padding. */

/** base64url of `bytes`, no padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * The bytes of a base64url (or base64) string.
 * @throws {Error} if `text` is not base64
 */
export function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** base64url of the UTF-8 encoding of `text`. */
export function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

/**
 * The text whose UTF-8 base64url is `b64`.
 * @throws {Error} if `b64` is not base64 or not UTF-8
 */
export function base64UrlToText(b64: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(b64));
}
