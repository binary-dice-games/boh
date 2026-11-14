// MIT License © 2026 Binary Dice Games
/** @file PKCE (RFC 7636) and random strings, with Web Crypto. */
import { bytesToBase64Url } from './b64';

/** A random base64url string of `bytes` random bytes (43 characters for 32). */
export function randomString(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A PKCE code verifier: 43 characters from the unreserved set. */
export function createVerifier(): string {
  return randomString(32);
}

/** The S256 code challenge of `verifier`: base64url(SHA-256(verifier)). */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}
