// MIT License © 2026 Binary Dice Games
/**
 * @file What boh remembers in this browser only (never synced): recent pastes and preferences.
 */
import { isProviderId, type ProviderId } from './providers/provider';
import type { SafeStore } from './storage';

/** A paste created or opened in this browser. */
export interface RecentPaste {
  link: string;
  name: string;
  provider: ProviderId;
  /** Epoch ms. */
  at: number;
  /** Created here (rather than opened from a link). */
  own: boolean;
}

/** Display and sign-in preferences. */
export interface Prefs {
  /** Keep sign-ins in `localStorage`. */
  stay: boolean;
  /** The bin last uploaded to. */
  lastBin?: string;
  /** Wrap long lines in the text renderer. */
  wrap: boolean;
}

/** How many recent pastes are kept. */
export const MAX_RECENT = 50;

const RECENT = 'boh.recent';
const PREFS = 'boh.prefs';

/** Recent pastes and preferences. */
export class LocalState {
  constructor(private readonly store: SafeStore) {}

  /** Recent pastes, newest first. */
  recent(): RecentPaste[] {
    const list = this.store.getJson<RecentPaste[]>(RECENT);
    return Array.isArray(list)
      ? list.filter(
          (p) =>
            p &&
            typeof p.link === 'string' &&
            typeof p.name === 'string' &&
            isProviderId(p.provider) &&
            typeof p.at === 'number',
        )
      : [];
  }

  /** Records a paste (moving it to the top if already there). */
  addRecent(paste: RecentPaste): void {
    const others = this.recent().filter((p) => p.link !== paste.link);
    const own = paste.own || this.recent().some((p) => p.link === paste.link && p.own);
    this.store.setJson(RECENT, [{ ...paste, own }, ...others].slice(0, MAX_RECENT));
  }

  /** Forgets one recent paste. */
  removeRecent(link: string): void {
    this.store.setJson(
      RECENT,
      this.recent().filter((p) => p.link !== link),
    );
  }

  /** Forgets every recent paste. */
  clearRecent(): void {
    this.store.removeItem(RECENT);
  }

  /** The preferences, with defaults. */
  prefs(): Prefs {
    const stored = this.store.getJson<Partial<Prefs>>(PREFS) ?? {};
    return {
      stay: typeof stored.stay === 'boolean' ? stored.stay : true,
      wrap: typeof stored.wrap === 'boolean' ? stored.wrap : false,
      lastBin: typeof stored.lastBin === 'string' ? stored.lastBin : undefined,
    };
  }

  /** Changes some preferences. */
  setPrefs(patch: Partial<Prefs>): void {
    this.store.setJson(PREFS, { ...this.prefs(), ...patch });
  }
}
