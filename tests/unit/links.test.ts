// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { base64UrlToText, textToBase64Url } from '../../web/src/b64';
import { LinkError } from '../../web/src/errors';
import { formatLink, linkFragment, parseFragment } from '../../web/src/links';

describe('boh links', () => {
  it('formats and parses a link round trip', () => {
    const ref = textToBase64Url('https://www.dropbox.com/scl/fi/x/a b.txt?rlkey=k');
    const link = formatLink('https://example.github.io/boh/?x=1#old', {
      provider: 'db',
      ref,
      renderer: 'markdown',
      name: 'a b.md',
    });
    expect(link).toBe(`https://example.github.io/boh/#v1/db/${ref}?r=markdown&n=a+b.md`);
    const parsed = parseFragment(new URL(link).hash);
    expect(parsed).toEqual({
      kind: 'paste',
      link: { provider: 'db', ref, renderer: 'markdown', name: 'a b.md' },
    });
    expect(base64UrlToText(ref)).toContain('a b.txt');
  });

  it('formats a link without hints', () => {
    expect(linkFragment({ provider: 'gd', ref: 'abc' })).toBe('v1/gd/abc');
  });

  it('treats app routes and empty fragments as other', () => {
    expect(parseFragment('')).toEqual({ kind: 'other' });
    expect(parseFragment('#bin/x')).toEqual({ kind: 'other' });
    expect(parseFragment('#')).toEqual({ kind: 'other' });
  });

  it('recognizes links of a later version', () => {
    expect(parseFragment('#v2/gd/abc')).toEqual({ kind: 'newer', version: 2 });
  });

  it.each([
    ['#v1/xx/abc', 'unknown provider'],
    ['#v1/gd/a+b', 'reference'],
    ['#v1/gd', 'form'],
    ['#v1/gd/abc/def', 'form'],
    ['#v1/gd/abc?r=exe', 'renderer'],
    ['#v1/gd/abc?z=1', 'parameter'],
    ['#v1/gd/abc?n=', 'name'],
    ['#v0/gd/abc', 'version'],
  ])('rejects %s', (fragment, message) => {
    expect(() => parseFragment(fragment)).toThrow(LinkError);
    expect(() => parseFragment(fragment)).toThrow(message);
  });
});
