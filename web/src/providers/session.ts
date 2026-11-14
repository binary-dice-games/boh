// MIT License © 2026 Binary Dice Games
/**
 * @file The signed-in state of one provider: the access token, its renewal with a refresh token,
 * and authenticated requests that turn a lost sign-in into `ProviderError('needs_sign_in')`.
 */
import { AuthError, ProviderError } from '../errors';
import { send, type FetchFn, type SendOptions } from '../http';
import type { TokenAnswer } from '../oauth';
import type { TokenRecord, TokenStore } from '../token-store';
import type { Account, ProviderId } from './provider';

/** Margin before expiry at which a token counts as expired. */
const EARLY_MS = 60000;

/** Tokens and authenticated requests for one provider. */
export class AuthSession {
  private refreshing: Promise<string> | undefined;

  /**
   * @param refresh renews with a refresh token; omitted for providers without one (Google)
   */
  constructor(
    private readonly id: ProviderId,
    private readonly tokens: TokenStore,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
    private readonly refresh?: (refreshToken: string) => Promise<TokenAnswer>,
  ) {}

  /** The stored record. */
  record(): TokenRecord | undefined {
    return this.tokens.load(this.id);
  }

  /** The stored account, or `null`. */
  account(): Account | null {
    return this.record()?.account ?? null;
  }

  /** Whether a token is stored at all (it may be expired). */
  signedIn(): boolean {
    return this.record() !== undefined;
  }

  /** Stores a token answer (and the account) in the store `stay` selects. */
  store(answer: TokenAnswer, stay: boolean, account?: Account): TokenRecord {
    const old = this.record();
    const record: TokenRecord = {
      accessToken: answer.access_token,
      expiresAt: this.now() + (answer.expires_in ?? 3600) * 1000,
      refreshToken: answer.refresh_token ?? old?.refreshToken,
      account: account ?? old?.account,
    };
    this.tokens.save(this.id, record, stay);
    return record;
  }

  /** Sets the account of the stored record. */
  setAccount(account: Account): void {
    const record = this.record();
    if (record) {
      this.tokens.save(this.id, { ...record, account }, this.tokens.stays(this.id));
    }
  }

  /** Moves the record between the stores. */
  setStay(stay: boolean): void {
    const record = this.record();
    if (record) {
      this.tokens.save(this.id, record, stay);
    }
  }

  /** Forgets everything. */
  clear(): void {
    this.tokens.clear(this.id);
  }

  /**
   * A valid access token, renewed when needed.
   * @throws {ProviderError} `needs_sign_in` when there is none and it cannot be renewed
   */
  async accessToken(): Promise<string> {
    const record = this.record();
    if (!record) {
      throw new ProviderError('needs_sign_in', 'not signed in');
    }
    if (record.expiresAt - EARLY_MS > this.now()) {
      return record.accessToken;
    }
    return this.renew(record);
  }

  /** The token, or `undefined` when there is none or it cannot be renewed. */
  async optionalToken(): Promise<string | undefined> {
    try {
      return await this.accessToken();
    } catch (e) {
      if (e instanceof ProviderError && e.reason === 'needs_sign_in') {
        return undefined;
      }
      throw e;
    }
  }

  private renew(record: TokenRecord): Promise<string> {
    if (!this.refresh || !record.refreshToken) {
      return Promise.reject(new ProviderError('needs_sign_in', 'the sign-in expired'));
    }
    const refreshToken = record.refreshToken;
    this.refreshing ??= (async () => {
      try {
        const answer = await this.refresh!(refreshToken);
        return this.store(answer, this.tokens.stays(this.id)).accessToken;
      } catch (e) {
        if (e instanceof AuthError && e.reason === 'expired') {
          // The refresh token is dead; keep the account so the UI can offer to sign in again.
          this.tokens.save(
            this.id,
            { ...record, accessToken: '', expiresAt: 0, refreshToken: undefined },
            this.tokens.stays(this.id),
          );
          throw new ProviderError('needs_sign_in', 'the sign-in expired');
        }
        throw new ProviderError('network', e instanceof Error ? e.message : String(e));
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  /**
   * Sends a request with the access token. On 401 it renews once and retries; when that is not
   * possible the stored token is dropped and `needs_sign_in` thrown.
   */
  async request(url: string, init: SendOptions = {}): Promise<Response> {
    const attempt = async (token: string) =>
      send(this.fetchFn, url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      });
    const res = await attempt(await this.accessToken());
    if (res.status !== 401) {
      return res;
    }
    const record = this.record();
    if (record) {
      this.tokens.save(this.id, { ...record, expiresAt: 0 }, this.tokens.stays(this.id));
    }
    const fresh = record ? await this.renew({ ...record, expiresAt: 0 }) : undefined;
    if (!fresh) {
      throw new ProviderError('needs_sign_in', 'the sign-in expired');
    }
    const again = await attempt(fresh);
    if (again.status === 401) {
      throw new ProviderError('needs_sign_in', 'the sign-in expired');
    }
    return again;
  }
}
