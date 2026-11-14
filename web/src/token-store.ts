// MIT License © 2026 Binary Dice Games
/**
 * @file Sign-in tokens per provider, in `localStorage` when the user chose to stay signed in on
 * this browser, else in `sessionStorage`.
 */
import type { Account, ProviderId } from './providers/provider';
import type { SafeStore } from './storage';

/** What boh keeps of one provider's sign-in. */
export interface TokenRecord {
  accessToken: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
  refreshToken?: string;
  account?: Account;
}

const key = (id: ProviderId) => `boh.auth.${id}`;

/** Tokens per provider. */
export class TokenStore {
  constructor(
    private readonly local: SafeStore,
    private readonly session: SafeStore,
  ) {}

  /** The stored record, from either store. */
  load(id: ProviderId): TokenRecord | undefined {
    const record =
      this.session.getJson<TokenRecord>(key(id)) ?? this.local.getJson<TokenRecord>(key(id));
    return record && typeof record.accessToken === 'string' ? record : undefined;
  }

  /** Saves `record` in the store `stay` selects and removes it from the other. */
  save(id: ProviderId, record: TokenRecord, stay: boolean): void {
    (stay ? this.local : this.session).setJson(key(id), record);
    (stay ? this.session : this.local).removeItem(key(id));
  }

  /** Whether the record lives in `localStorage`. */
  stays(id: ProviderId): boolean {
    return this.local.getItem(key(id)) !== null;
  }

  /** Forgets the provider's sign-in. */
  clear(id: ProviderId): void {
    this.local.removeItem(key(id));
    this.session.removeItem(key(id));
  }
}
