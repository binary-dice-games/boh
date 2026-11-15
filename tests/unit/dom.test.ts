// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { isWebUrl } from '../../web/src/ui/dom';

describe('isWebUrl', () => {
  it('accepts absolute https and http addresses', () => {
    expect(isWebUrl('https://drive.google.com/file/d/x/view')).toBe(true);
    expect(isWebUrl('http://localhost:8080/x')).toBe(true);
  });

  it('refuses other schemes and relative or broken addresses', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
      'file:///etc/passwd',
      '//evil.example/',
      '/relative',
      '',
      'not a url',
    ]) {
      expect(isWebUrl(href), href).toBe(false);
    }
  });
});
