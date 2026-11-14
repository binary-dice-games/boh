// MIT License © 2026 Binary Dice Games
/**
 * @file Runs the providers in Node against the fakes: a configuration pointing at them, memory
 * storage, and a popup that follows the fake authorization redirect and posts the answer on the
 * broadcast channel the way `auth.html` does.
 */
import { resolveConfig, type ConfigOverrides } from '../../scripts/config.mjs';
import type { BohConfig } from '../../web/src/config';
import { AUTH_CHANNEL } from '../../web/src/oauth';
import type { ProviderEnv } from '../../web/src/providers/provider';
import { MemoryStore, SafeStore } from '../../web/src/storage';
import { TokenStore } from '../../web/src/token-store';

export const REDIRECT_URI = 'http://127.0.0.1:9/auth.html';

/** A stand-in for the popup window: setting its address runs the redirect and answers. */
function fakePopup(): Window {
  const popup = {
    closed: false,
    close() {
      popup.closed = true;
    },
    location: {
      set href(url: string) {
        if (url === 'about:blank') {
          return;
        }
        void (async () => {
          const res = await fetch(url, { redirect: 'manual' });
          const target = new URL(res.headers.get('location') ?? '');
          const params: Record<string, string> = {};
          for (const source of [target.search.slice(1), target.hash.slice(1)]) {
            for (const [k, v] of new URLSearchParams(source)) {
              params[k] = v;
            }
          }
          const channel = new BroadcastChannel(AUTH_CHANNEL);
          channel.postMessage({ type: 'boh-auth', params });
          channel.close();
        })();
      },
    },
  };
  return popup as unknown as Window;
}

/** A provider environment against fakes. */
export function testEnv(
  overrides: ConfigOverrides,
  now?: () => number,
): ProviderEnv & { config: BohConfig; local: SafeStore; session: SafeStore } {
  const local = new SafeStore(new MemoryStore());
  const session = new SafeStore(new MemoryStore());
  return {
    config: resolveConfig(overrides, {}) as BohConfig,
    fetch: (input, init) => fetch(input, init),
    tokens: new TokenStore(local, session),
    popup: { openPopup: () => fakePopup(), redirectUri: REDIRECT_URI },
    now,
    local,
    session,
  };
}
