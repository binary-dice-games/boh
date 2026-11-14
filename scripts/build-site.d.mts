// MIT License © 2026 Binary Dice Games
import type { ConfigOverrides } from './config.mjs';
export function normalizeBase(base: string): string;
export function buildSite(
  out: string,
  options?: { base?: string; config?: ConfigOverrides },
): Promise<void>;
