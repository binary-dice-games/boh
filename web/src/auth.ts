// MIT License © 2026 Binary Dice Games
/**
 * @file Entry of `auth.html`, the OAuth redirect target: posts the redirect's parameters to the
 * boh page that started the sign-in, removes them from the address bar and closes the window.
 */
import { AUTH_CHANNEL, type AuthMessage } from './oauth';

const params: Record<string, string> = {};
for (const source of [location.search.slice(1), location.hash.slice(1)]) {
  for (const [k, v] of new URLSearchParams(source)) {
    params[k] = v;
  }
}
history.replaceState(null, '', location.pathname);
const channel = new BroadcastChannel(AUTH_CHANNEL);
channel.postMessage({ type: 'boh-auth', params } satisfies AuthMessage);
channel.close();
window.close();
