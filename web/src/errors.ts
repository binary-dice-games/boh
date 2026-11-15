// MIT License © 2026 Binary Dice Games
/**
 * @file The errors boh throws. Each carries a stable `reason` the app branches on; the app never
 * parses messages.
 */

/** Base class: an error with a stable machine-readable `reason`. */
export class BohError extends Error {
  /**
   * @param reason stable code
   * @param message text for logs and, where nothing better exists, for the user
   */
  constructor(
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = new.target.name;
  }
}

/** Why a sign-in failed. */
export type AuthReason = 'cancelled' | 'popup_blocked' | 'denied' | 'expired' | 'failed';

/** A sign-in did not complete. */
export class AuthError extends BohError {
  constructor(
    override readonly reason: AuthReason,
    message?: string,
  ) {
    super(reason, message);
  }
}

/** Why a provider call failed. */
export type ProviderReason =
  | 'not_found'
  | 'forbidden'
  | 'needs_sign_in'
  | 'needs_grant'
  | 'rate_limited'
  | 'network'
  | 'unsupported'
  | 'not_configured'
  | 'failed';

/** A provider call failed. `status` is the HTTP status when there was one. */
export class ProviderError extends BohError {
  constructor(
    override readonly reason: ProviderReason,
    message?: string,
    readonly status?: number,
  ) {
    super(reason, message);
  }
}

/** A configuration write lost against a newer revision. */
export class ConflictError extends BohError {
  constructor(message = 'the file changed since it was read') {
    super('conflict', message);
  }
}

/** A paste is larger than the limit given. */
export class TooLargeError extends BohError {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super('too_large', `${size} bytes is over the limit of ${limit}`);
  }
}

/** A boh link could not be parsed. */
export class LinkError extends BohError {
  constructor(message: string) {
    super('invalid_link', message);
  }
}

/** Why a tag was refused. */
export type TagReason = 'invalid_tag' | 'too_many_tags';

/** A tag cannot be used, or a paste would carry too many tags. */
export class TagError extends BohError {
  constructor(
    override readonly reason: TagReason,
    message?: string,
  ) {
    super(reason, message);
  }
}

/** The `reason` of any thrown value: `BohError.reason`, `aborted` for aborts, else `failed`. */
export function reasonOf(error: unknown): string {
  if (error instanceof BohError) {
    return error.reason;
  }
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return 'aborted';
  }
  return 'failed';
}
