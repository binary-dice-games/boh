// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  binToken,
  hasToken,
  matches,
  parseQuery,
  replaceTokens,
  toggleToken,
  tokenize,
  type Searchable,
} from '../../web/src/query';

const item = (s: Partial<Searchable>): Searchable => ({
  name: s.name ?? 'paste.txt',
  tags: s.tags ?? [],
  derived: s.derived ?? ['format:txt', 'kind:text'],
  binName: s.binName ?? 'Notes',
  own: s.own ?? true,
});

const hit = (query: string, s: Partial<Searchable>) => matches(parseQuery(query), item(s));

describe('tokenize', () => {
  it('keeps quoted parts whole', () => {
    expect(tokenize(' a  "two words" bin:"Work notes" -x ')).toEqual([
      'a',
      '"two words"',
      'bin:"Work notes"',
      '-x',
    ]);
    expect(tokenize('"unclosed quote')).toEqual(['"unclosed quote']);
  });
});

describe('matches', () => {
  it('matches everything with an empty query', () => {
    expect(hit('', {})).toBe(true);
    expect(hit('   ', {})).toBe(true);
  });

  it('matches a bare word against tags or the name', () => {
    expect(hit('work', { tags: ['work'] })).toBe(true);
    expect(hit('Work', { tags: ['work'] })).toBe(true);
    expect(hit('plan', { name: 'Big-Plan.md' })).toBe(true);
    expect(hit('wor', { tags: ['work'] })).toBe(false); // tags match whole
    expect(hit('nothing', {})).toBe(false);
  });

  it('matches names without case or accents', () => {
    expect(hit('cancion', { name: 'Canción.txt' })).toBe(true);
    expect(hit('CANCIÓN', { name: 'cancion.txt' })).toBe(true);
  });

  it('matches #tag and tag:a,b against manual tags only', () => {
    expect(hit('#work', { tags: ['work'] })).toBe(true);
    expect(hit('#work', { name: 'work.txt' })).toBe(false);
    expect(hit('tag:a,b', { tags: ['b'] })).toBe(true);
    expect(hit('tag:a,b', { tags: ['c'] })).toBe(false);
  });

  it('matches derived tags with comma OR', () => {
    expect(hit('format:md,txt', {})).toBe(true);
    expect(hit('format:MD', { derived: ['format:md'] })).toBe(true);
    expect(hit('kind:image', {})).toBe(false);
    expect(hit('lang:python', { derived: ['format:py', 'kind:text', 'lang:python'] })).toBe(true);
  });

  it('matches bins by name and from:me / from:others', () => {
    expect(hit('bin:"work notes"', { binName: 'Work Notes' })).toBe(true);
    expect(hit('bin:notes,other', {})).toBe(true);
    expect(hit('bin:other', {})).toBe(false);
    expect(hit('from:me', { own: true })).toBe(true);
    expect(hit('from:others', { own: true })).toBe(false);
    expect(hit('from:others', { own: false })).toBe(true);
  });

  it('negates any term and ANDs them all', () => {
    expect(hit('-#work', { tags: ['work'] })).toBe(false);
    expect(hit('-#work', {})).toBe(true);
    expect(hit('#a #b', { tags: ['a'] })).toBe(false);
    expect(hit('#a -kind:image', { tags: ['a'] })).toBe(true);
    expect(hit('untagged', {})).toBe(true);
    expect(hit('-untagged', { tags: ['x'] })).toBe(true);
  });

  it('matches a quoted phrase against the name', () => {
    expect(hit('"big plan"', { name: 'The Big Plan.txt' })).toBe(true);
    expect(hit('"plan big"', { name: 'The Big Plan.txt' })).toBe(false);
  });

  it('treats unknown prefixes as name text and never throws', () => {
    expect(hit('size:big', { name: 'size:big.txt' })).toBe(true);
    for (const q of ['-', '#', '"', 'tag:', ':', '-"', 'bin:"', '\u0000', '((', '#a:b']) {
      expect(() => parseQuery(q), q).not.toThrow();
      expect(() => hit(q, {}), q).not.toThrow();
    }
  });
});

describe('query tokens', () => {
  it('toggles, detects and replaces tokens', () => {
    expect(toggleToken('a #b', '#c')).toBe('a #b #c');
    expect(toggleToken('a #b', '#b')).toBe('a');
    expect(hasToken('a bin:"x y"', 'bin:"x y"')).toBe(true);
    expect(replaceTokens('a from:me b', ['from:me', 'from:others'], 'from:others')).toBe(
      'a b from:others',
    );
    expect(replaceTokens('from:me', ['from:me'])).toBe('');
  });

  it('quotes bin names with spaces or commas and drops quotes', () => {
    expect(binToken('Notes')).toBe('bin:Notes');
    expect(binToken('Work notes')).toBe('bin:"Work notes"');
    expect(binToken('a "b"')).toBe('bin:"a b"');
    expect(hit(binToken('Work, notes'), { binName: 'Work, notes' })).toBe(true);
  });
});
