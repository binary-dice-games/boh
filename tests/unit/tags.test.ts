// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { TagError } from '../../web/src/errors';
import {
  applyTagChange,
  derivedTags,
  globToRegExp,
  isTagRule,
  matchRules,
  MAX_TAG_BYTES,
  MAX_TAGS,
  normalizeTag,
  parseTagList,
  tagKey,
  tagOfKey,
  type TagRule,
} from '../../web/src/tags';

describe('normalizeTag', () => {
  it('lowercases, trims and joins white space with "-"', () => {
    expect(normalizeTag('  Work  Notes ')).toBe('work-notes');
    expect(normalizeTag('API/v2')).toBe('api/v2');
    expect(normalizeTag('snake_case.x')).toBe('snake_case.x');
  });

  it('keeps letters of any script, in NFC', () => {
    expect(normalizeTag('Canción')).toBe('canción');
    expect(normalizeTag('canción')).toBe('canción'); // decomposed input
    expect(normalizeTag('日本語')).toBe('日本語');
    expect(normalizeTag('हिन्दी')).toBe('हिन्दी'); // combining marks
  });

  it('refuses empty tags, reserved characters and a leading "-"', () => {
    for (const bad of ['', '   ', 'a:b', 'a,b', '"q"', '#x', '-x', 'a<b', 'tab\u0000']) {
      expect(() => normalizeTag(bad), bad).toThrow(TagError);
    }
    try {
      normalizeTag('a:b');
    } catch (e) {
      expect((e as TagError).reason).toBe('invalid_tag');
    }
  });

  it('limits the length in UTF-8 bytes', () => {
    expect(normalizeTag('a'.repeat(MAX_TAG_BYTES))).toHaveLength(MAX_TAG_BYTES);
    expect(() => normalizeTag('a'.repeat(MAX_TAG_BYTES + 1))).toThrow(TagError);
    expect(() => normalizeTag('ñ'.repeat(MAX_TAG_BYTES / 2 + 1))).toThrow(TagError);
  });
});

describe('parseTagList', () => {
  it('splits on commas and new lines, dropping duplicates and keeping the invalid apart', () => {
    expect(parseTagList('Work, notes\nwork,, a:b ,  ')).toEqual({
      tags: ['work', 'notes'],
      invalid: ['a:b'],
    });
  });
});

describe('applyTagChange', () => {
  it('removes, then adds, and sorts', () => {
    expect(applyTagChange(['b', 'a'], { add: ['c', 'a'], remove: ['b'] })).toEqual(['a', 'c']);
  });

  it('refuses more than the limit but lets an over-full paste shrink', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(() => applyTagChange(full, { add: ['one-more'] })).toThrow(TagError);
    const over = [...full, 'x', 'y'];
    expect(applyTagChange(over, { remove: ['x'] })).toHaveLength(MAX_TAGS + 1);
  });
});

describe('tag keys', () => {
  it('round-trips any tag and stays within Drive limits', () => {
    for (const tag of ['work', 'canción', '日本語', 'a/b.c_d-e', 'ñ'.repeat(MAX_TAG_BYTES / 2)]) {
      const key = tagKey(tag);
      expect(key).toMatch(/^t\.[A-Za-z0-9_-]+$/);
      expect(key.length + 1).toBeLessThanOrEqual(124);
      expect(tagOfKey(key)).toBe(tag);
    }
  });

  it('ignores other keys and damaged or non-normal tags', () => {
    expect(tagOfKey('other')).toBeUndefined();
    expect(tagOfKey('t.')).toBeUndefined();
    expect(tagOfKey('t.%%%')).toBeUndefined();
    expect(tagOfKey(tagKey('Upper'))).toBeUndefined();
    expect(tagOfKey(tagKey('a:b'))).toBeUndefined();
  });
});

describe('derivedTags', () => {
  it('gives format, kind and, for code, language', () => {
    expect(derivedTags({ name: 'notes.md' })).toEqual(['format:md', 'kind:markdown']);
    expect(derivedTags({ name: 'main.py' })).toEqual(['format:py', 'kind:text', 'lang:python']);
    expect(derivedTags({ name: 'a.txt' })).toEqual(['format:txt', 'kind:text']);
    expect(derivedTags({ name: 'cat.PNG' })).toEqual(['format:png', 'kind:image']);
    expect(derivedTags({ name: 'song.mp3' })).toEqual(['format:mp3', 'kind:audio']);
    expect(derivedTags({ name: 'clip.webm' })).toEqual(['format:webm', 'kind:video']);
    expect(derivedTags({ name: 'doc.pdf' })).toEqual(['format:pdf', 'kind:pdf']);
    expect(derivedTags({ name: 'page.html' })).toEqual(['format:html', 'kind:html']);
    expect(derivedTags({ name: 'blob.xyz' })).toEqual(['format:xyz', 'kind:download']);
  });

  it('uses the MIME type when there is no extension, and never looks at contents', () => {
    expect(derivedTags({ name: 'README' })).toEqual(['format:none', 'kind:download']);
    expect(derivedTags({ name: 'README', mime: 'text/markdown' })).toEqual([
      'format:none',
      'kind:markdown',
    ]);
    expect(derivedTags({ name: 'a.b c' })[0]).toBe('format:b-c');
  });
});

describe('tag rules', () => {
  const rule = (r: Partial<TagRule>): TagRule => ({
    id: r.id ?? 'r',
    bins: r.bins ?? [],
    match: r.match ?? {},
    tags: r.tags ?? [],
  });

  it('matches by bin, format, kind and name glob; all given fields must match', () => {
    const rules = [
      rule({ bins: ['notes'], tags: ['notes'] }),
      rule({ match: { name: '*.log' }, tags: ['logs'] }),
      rule({ match: { format: ['json'] }, tags: ['data'] }),
      rule({ match: { kind: ['image'] }, tags: ['pictures'] }),
      rule({ match: { format: ['json'], name: 'cfg-*' }, tags: ['config'] }),
      rule({ bins: ['other'], match: { name: '*' }, tags: ['never'] }),
    ];
    expect(matchRules(rules, 'notes', { name: 'a.txt' })).toEqual(['notes']);
    expect(matchRules(rules, 'x', { name: 'Server.LOG' })).toEqual(['logs']);
    expect(matchRules(rules, 'x', { name: 'cfg-a.json' })).toEqual(['config', 'data']);
    expect(matchRules(rules, 'x', { name: 'a.json' })).toEqual(['data']);
    expect(matchRules(rules, 'notes', { name: 'p.png' })).toEqual(['notes', 'pictures']);
  });

  it('drops rule tags that are not valid and deduplicates', () => {
    const rules = [rule({ tags: ['ok', 'Not:ok'] }), rule({ tags: ['ok'] })];
    expect(matchRules(rules, 'b', { name: 'x' })).toEqual(['ok']);
  });

  it('treats glob characters literally except * and ?', () => {
    expect(globToRegExp('a.(b)?*').test('a.(b)x-anything')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('validates rules read from a settings file', () => {
    expect(isTagRule(rule({ tags: ['a'], match: { kind: ['image'] } }))).toBe(true);
    expect(isTagRule({ id: 'r', bins: [], tags: [], match: { kind: ['nope'] } })).toBe(false);
    expect(isTagRule({ id: '', bins: [], tags: [], match: {} })).toBe(false);
    expect(isTagRule({ id: 'r', bins: 'x', tags: [], match: {} })).toBe(false);
    expect(isTagRule(null)).toBe(false);
  });
});
