// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  blobType,
  chooseRenderer,
  extensionOf,
  formatSize,
  languageOf,
  looksLikeText,
  maxBytesFor,
  pasteFileName,
  rendererChoices,
  slugify,
} from '../../web/src/formats';

describe('format detection', () => {
  it.each([
    ['notes.txt', undefined, 'text'],
    ['main.py', undefined, 'text'],
    ['Makefile', undefined, 'text'],
    ['README.md', undefined, 'markdown'],
    ['page.HTML', undefined, 'html'],
    ['photo.JPG', undefined, 'image'],
    ['logo.svg', undefined, 'image'],
    ['song.mp3', undefined, 'audio'],
    ['clip.webm', undefined, 'video'],
    ['paper.pdf', undefined, 'pdf'],
    ['noext', 'text/markdown', 'markdown'],
    ['noext', 'text/html; charset=utf-8', 'html'],
    ['noext', 'application/json', 'text'],
    ['noext', 'image/heic', 'image'],
    ['noext', 'audio/x-foo', 'audio'],
    ['noext', 'video/x-foo', 'video'],
    ['noext', 'application/pdf', 'pdf'],
    ['archive.zip', 'application/zip', 'download'],
  ])('%s (%s) is %s', (name, mime, renderer) => {
    expect(chooseRenderer(name, mime)).toBe(renderer);
  });

  it('sniffs text from the first bytes', () => {
    expect(chooseRenderer('data', undefined, new TextEncoder().encode('hello ñ'))).toBe('text');
    expect(chooseRenderer('data', undefined, new Uint8Array([0x89, 0x50, 0, 1]))).toBe('download');
    expect(looksLikeText(new Uint8Array([0xc3]))).toBe(true); // a character cut at the end
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });

  it('finds extensions', () => {
    expect(extensionOf('a/b/c.TAR.GZ')).toBe('gz');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('Dockerfile')).toBe('dockerfile');
  });

  it('offers text renderers for text and only download otherwise', () => {
    expect(rendererChoices('markdown')).toEqual(['text', 'markdown', 'html', 'download']);
    expect(rendererChoices('image')).toEqual(['image', 'download']);
  });

  it('never gives a blob a type that runs script on the app origin', () => {
    expect(blobType('image', 'a.png')).toBe('image/png');
    expect(blobType('image', 'a.html')).toBe('application/octet-stream');
    expect(blobType('audio', 'a.wav')).toBe('audio/wav');
    expect(blobType('pdf', 'x')).toBe('application/pdf');
    expect(blobType('html', 'a.html')).toBe('text/plain');
    expect(blobType('download', 'a.html')).toBe('application/octet-stream');
  });

  it('maps languages and limits', () => {
    expect(languageOf('x.ts')).toBe('typescript');
    expect(languageOf('x.unknown')).toBe('plaintext');
    expect(maxBytesFor('text')).toBeLessThan(maxBytesFor('video'));
  });
});

describe('file names', () => {
  it('slugifies titles', () => {
    expect(slugify('  Héllo, Wörld!  ')).toBe('hello-world');
    expect(slugify('日本語')).toBe('');
    expect(slugify('a'.repeat(100))).toHaveLength(60);
  });

  it('names a paste from its title or the time', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5);
    expect(pasteFileName('My notes', 'md', now)).toBe('my-notes.md');
    expect(pasteFileName('', 'TXT', now)).toBe('paste-20260102-030405.txt');
    expect(pasteFileName('!!!', '../x', now)).toBe('paste-20260102-030405.x');
  });

  it('formats sizes', () => {
    expect(formatSize(undefined)).toBe('');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KiB');
    expect(formatSize(30 * 1024 * 1024)).toBe('30 MiB');
  });
});
