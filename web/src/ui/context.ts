// MIT License © 2026 Binary Dice Games
/** @file What every view gets from the app. */
import type { BinEntry, BinStore } from '../bin-store';
import type { LocalState } from '../local-state';
import type { PasteMeta, Provider, ProviderId, Sharing, Visibility } from '../providers/provider';

/** The app's services, as the views use them. */
export interface AppContext {
  readonly providers: Record<ProviderId, Provider>;
  readonly store: BinStore;
  readonly local: LocalState;
  /** The site's address, without query or fragment. */
  readonly siteUrl: string;
  /**
   * Signs in to a provider. Call it synchronously from a click (it opens a popup).
   * @returns whether the account is now connected; failures are shown, not thrown
   */
  connect(id: ProviderId): Promise<boolean>;
  /** Signs out and forgets the account's bins in this browser. */
  disconnect(id: ProviderId): Promise<void>;
  /** The connected providers. */
  connected(): Provider[];
  /** Shows a short message in the status line. */
  notify(text: string, kind?: 'info' | 'error'): void;
  /** A bin's real sharing, read once per page load. */
  sharing(entry: BinEntry): Promise<Sharing>;
  /** The boh link of a paste in a bin of `visibility` (made once per paste and page load). */
  linkFor(meta: PasteMeta, visibility: Visibility): Promise<string>;
}

/** A view: draws into `root`, returns its cleanup. */
export type View = (ctx: AppContext, root: HTMLElement) => () => void;
