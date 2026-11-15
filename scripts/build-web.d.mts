// MIT License © 2026 Binary Dice Games
import type { ConfigOverrides } from './config.mjs';
export const ASSET_FILES: string[];
export function buildVersion(): string;
export function thirdPartyLicenses(): string;
export function buildWeb(out: string, options?: { config?: ConfigOverrides }): Promise<void>;
