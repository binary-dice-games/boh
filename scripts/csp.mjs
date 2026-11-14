// MIT License © 2026 Binary Dice Games
// The Content-Security-Policy of each page of the site, derived from the build configuration.
//
// The app may talk to the APIs of the enabled providers only; the render frame may talk to nobody (remote
// images in a paste are allowed by this outer policy, and blocked or allowed per paste by the
// frame's own policy and sanitizer); the sign-in redirect page only runs its own script.

const origin = (url) => new URL(url).origin;
const unique = (list) => [...new Set(list)];

/**
 * The app page's policy.
 * @param {import('./config.mjs').DEFAULT_CONFIG} config the resolved build configuration
 * @returns {string}
 */
export function appCsp(config) {
  const on = (id) => config.providers.includes(id);
  const connect = unique([
    ...(on('gd') ? [origin(config.google.apiBase), origin(config.google.revokeUrl)] : []),
    ...(on('db')
      ? [
          origin(config.dropbox.apiBase),
          origin(config.dropbox.contentBase),
          origin(config.dropbox.rawBase),
        ]
      : []),
    ...(on('od')
      ? [
          origin(config.microsoft.authority),
          origin(config.microsoft.graphBase),
          ...config.microsoft.downloadHosts,
        ]
      : []),
  ]);
  const scripts = on('gd') && !config.google.testPicker ? [origin(config.google.pickerScript)] : [];
  return [
    "default-src 'none'",
    ['script-src', "'self'", ...scripts].join(' '),
    connect.length ? ['connect-src', ...connect].join(' ') : "connect-src 'none'",
    "frame-src 'self' blob: https://docs.google.com",
    "img-src 'self' blob: data:",
    'media-src blob:',
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The render frame's policy (`render.html`). */
export function renderCsp() {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'unsafe-inline' https:",
    'img-src data: blob: https:',
    'font-src data: https:',
    'media-src data: blob: https:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The sign-in redirect page's policy (`auth.html`). */
export function authCsp() {
  return "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
}
