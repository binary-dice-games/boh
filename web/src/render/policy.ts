// MIT License © 2026 Binary Dice Games
/** @file The render frame's pure rules: the nested document's policy and what counts as remote. */

/** The nested document's policy: no script ever; remote resources only when asked. */
export function documentCsp(remote: boolean): string {
  const remoteSrc = remote ? ' https:' : '';
  return [
    "default-src 'none'",
    `style-src 'unsafe-inline'${remoteSrc}`,
    `img-src data:${remoteSrc}`,
    `font-src data:${remoteSrc}`,
    `media-src data:${remoteSrc}`,
    "form-action 'none'",
  ].join('; ');
}

/** Whether a URL attribute's `value` points at another site (anything with a scheme but data:). */
export function isRemoteUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/.test(v) && !v.startsWith('data:'));
}

/** Whether a `srcset` has any remote candidate. */
export function isRemoteSrcset(value: string): boolean {
  return value.split(',').some((candidate) => isRemoteUrl(candidate.trim().split(/\s+/)[0] ?? ''));
}
