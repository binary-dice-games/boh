// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../scripts/config.mjs';
import { appCsp, authCsp, renderCsp } from '../../scripts/csp.mjs';
import { documentCsp, isRemoteSrcset, isRemoteUrl } from '../../web/src/render/policy';

describe('build configuration', () => {
  it('takes the environment over the file and overrides over both', () => {
    const config = resolveConfig(
      { dropbox: { appKey: 'from-override' } },
      { BOH_GOOGLE_CLIENT_ID: 'from-env', BOH_DROPBOX_APP_KEY: 'env' },
    );
    expect(config.google.clientId).toBe('from-env');
    expect(config.dropbox.appKey).toBe('from-override');
    expect(config.microsoft.graphBase).toBe('https://graph.microsoft.com/v1.0');
  });
});

describe('page policies', () => {
  it('lets the app reach exactly the providers it is configured for', () => {
    const csp = appCsp(resolveConfig({}, {}));
    const connect = csp
      .split('; ')
      .find((d) => d.startsWith('connect-src'))!
      .split(' ')
      .slice(1);
    expect(connect).toEqual([
      'https://www.googleapis.com',
      'https://oauth2.googleapis.com',
      'https://api.dropboxapi.com',
      'https://content.dropboxapi.com',
      'https://dl.dropboxusercontent.com',
      'https://login.microsoftonline.com',
      'https://graph.microsoft.com',
      'https://*.1drv.com',
      'https://*.sharepoint.com',
      'https://*.livefilestore.com',
    ]);
    expect(csp).toContain("script-src 'self' https://apis.google.com");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('follows endpoints moved to fakes and drops the Picker script for the test picker', () => {
    const csp = appCsp(
      resolveConfig({ google: { apiBase: 'http://127.0.0.1:1234', testPicker: true } }, {}),
    );
    expect(csp).toContain('connect-src http://127.0.0.1:1234 ');
    expect(csp).toContain("script-src 'self';");
  });

  it('keeps the render frame and sign-in page closed', () => {
    expect(renderCsp()).toContain("script-src 'self'");
    expect(renderCsp()).not.toContain('connect-src');
    expect(authCsp()).toContain("default-src 'none'");
  });
});

describe('render frame rules', () => {
  it('allows remote resources in a paste only when asked', () => {
    expect(documentCsp(false)).toContain('img-src data:;');
    expect(documentCsp(false)).not.toContain('https:');
    expect(documentCsp(true)).toContain('img-src data: https:');
    expect(documentCsp(true)).not.toContain('script-src');
  });

  it.each([
    ['https://x/a.png', true],
    ['//x/a.png', true],
    [' HTTP://x', true],
    ['javascript:alert(1)', true],
    ['data:image/png;base64,AA', false],
    ['a.png', false],
    ['#top', false],
  ])('%s is remote: %s', (url, remote) => {
    expect(isRemoteUrl(url)).toBe(remote);
  });

  it('checks every srcset candidate', () => {
    expect(isRemoteSrcset('a.png 1x, https://x/b.png 2x')).toBe(true);
    expect(isRemoteSrcset('a.png 1x, data:image/png;base64,AA 2x')).toBe(false);
  });
});
