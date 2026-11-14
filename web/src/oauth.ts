// MIT License © 2026 Binary Dice Games
/**
 * @file OAuth sign-in in a popup. The provider redirects the popup to `auth.html`, which hands
 * the answer over a `BroadcastChannel` (the opener link does not survive the providers'
 * cross-origin-opener policies) and closes itself.
 */
import { AuthError, ProviderError } from './errors';
import { send, statusError, jsonOf, type FetchFn } from './http';
import { randomString } from './pkce';

/** The channel `auth.html` posts on. */
export const AUTH_CHANNEL = 'boh-auth';

/** What `auth.html` posts. */
export interface AuthMessage {
  type: 'boh-auth';
  /** The query and fragment parameters of the redirect, merged. */
  params: Record<string, string>;
}

/** What the sign-in needs from the page. */
export interface PopupEnv {
  /** Opens a popup at `url` (synchronously, from the user's click); `null` when blocked. */
  openPopup(url: string): Window | null;
  /** The redirect URI registered with the providers: `auth.html` next to the app. */
  redirectUri: string;
}

/** A popup opened ahead of the sign-in (it must be opened inside the click). */
export interface PendingPopup {
  window: Window;
}

/**
 * Opens the sign-in popup on a blank page; call it synchronously in the click handler and give
 * the result to `authorizeInPopup` once the URL is known.
 * @throws {AuthError} `popup_blocked`
 */
export function openSignInPopup(env: PopupEnv): PendingPopup {
  const window = env.openPopup('about:blank');
  if (!window) {
    throw new AuthError('popup_blocked', 'the browser blocked the sign-in window');
  }
  return { window };
}

/**
 * Sends the popup to the provider's authorization endpoint and waits for the redirect's answer.
 * @param popup from `openSignInPopup`
 * @param endpoint the authorization endpoint
 * @param params its parameters, without `state` (added here and checked on the answer)
 * @param options `signal` cancels; `timeoutMs` (default 5 min) bounds the wait
 * @returns the redirect's parameters
 * @throws {AuthError} `cancelled` (aborted, timed out, or the user said no on a `cancel`-like
 *   error), `denied` (the provider refused), `failed` (anything else)
 */
export async function authorizeInPopup(
  popup: PendingPopup,
  endpoint: string,
  params: Record<string, string>,
  { signal, timeoutMs = 300000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Record<string, string>> {
  const state = randomString(16);
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries({ ...params, state })) {
    url.searchParams.set(k, v);
  }
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  try {
    const answer = await new Promise<Record<string, string>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new AuthError('cancelled', 'the sign-in took too long')),
        timeoutMs,
      );
      const stop = () => clearTimeout(timer);
      signal?.addEventListener(
        'abort',
        () => {
          stop();
          reject(new AuthError('cancelled', 'sign-in cancelled'));
        },
        { once: true },
      );
      channel.onmessage = (event: MessageEvent<AuthMessage>) => {
        const data = event.data;
        if (data?.type !== 'boh-auth' || data.params?.state !== state) {
          return; // another sign-in's answer
        }
        stop();
        resolve(data.params);
      };
      popup.window.location.href = url.toString();
    });
    if (answer.error) {
      const cancelled = answer.error === 'access_denied' || answer.error === 'user_cancelled';
      throw new AuthError(
        cancelled ? 'cancelled' : 'denied',
        answer.error_description || answer.error,
      );
    }
    return answer;
  } finally {
    channel.close();
    try {
      popup.window.close();
    } catch {
      // already gone
    }
  }
}

/** A token endpoint's answer. */
export interface TokenAnswer {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Posts a form to a token endpoint (code exchange or refresh).
 * @throws {AuthError} `expired` when the grant is refused (400/401), `failed` otherwise
 */
export async function postTokenForm(
  fetchFn: FetchFn,
  url: string,
  form: Record<string, string>,
): Promise<TokenAnswer> {
  let res: Response;
  try {
    res = await send(fetchFn, url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new AuthError('failed', e instanceof Error ? e.message : String(e));
  }
  if (res.status === 400 || res.status === 401) {
    throw new AuthError('expired', 'the sign-in is no longer valid');
  }
  if (!res.ok) {
    throw new AuthError('failed', statusError(res, 'token').message);
  }
  const answer = await jsonOf<TokenAnswer>(res).catch((e: ProviderError) => {
    throw new AuthError('failed', e.message);
  });
  if (!answer.access_token) {
    throw new AuthError('failed', 'no access token in the answer');
  }
  return answer;
}
