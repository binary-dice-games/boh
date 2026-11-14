// MIT License © 2026 Binary Dice Games
/**
 * @file The configuration file each account keeps (design section 4.3): `boh-config.json`, a
 * versioned list of bins. Unknown fields are kept on write so a later boh's additions survive.
 */
import { BohError } from './errors';
import { randomString } from './pkce';
import { VISIBILITIES, type FolderRef, type Visibility } from './providers/provider';

/** A registered folder. */
export interface Bin {
  id: string;
  name: string;
  folder: FolderRef;
  visibility: Visibility;
  /** Extension preselected for new text pastes. */
  defaultFormat?: string;
  [extra: string]: unknown;
}

/** The file's contents. */
export interface ConfigFile {
  format: 'boh-config';
  version: 1;
  bins: Bin[];
  defaultBin: string | null;
  [extra: string]: unknown;
}

/** The file cannot be used: `bad_config` (not a boh config) or `newer_config` (later version). */
export class ConfigFileError extends BohError {}

/** An empty configuration. */
export function emptyConfig(): ConfigFile {
  return { format: 'boh-config', version: 1, bins: [], defaultBin: null };
}

/** A new random bin id. */
export function newBinId(): string {
  return randomString(9);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isFolder(v: unknown): v is FolderRef {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    (v.path === undefined || typeof v.path === 'string') &&
    (v.driveId === undefined || typeof v.driveId === 'string')
  );
}

function isBin(v: unknown): v is Bin {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    isFolder(v.folder) &&
    (VISIBILITIES as readonly unknown[]).includes(v.visibility) &&
    (v.defaultFormat === undefined || typeof v.defaultFormat === 'string')
  );
}

/**
 * Parses and checks a configuration file.
 * @throws {ConfigFileError} `bad_config` when it is not valid, `newer_config` when its version is
 *   later than 1
 */
export function parseConfig(text: string): ConfigFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigFileError('bad_config', 'the settings file is not JSON');
  }
  if (!isObject(data) || data.format !== 'boh-config') {
    throw new ConfigFileError('bad_config', 'the file is not a boh settings file');
  }
  if (typeof data.version !== 'number' || data.version > 1) {
    throw new ConfigFileError('newer_config', 'the settings file was written by a newer boh');
  }
  if (!Array.isArray(data.bins) || !data.bins.every(isBin)) {
    throw new ConfigFileError('bad_config', 'the settings file has a damaged list of bins');
  }
  const ids = new Set(data.bins.map((b) => b.id));
  if (ids.size !== data.bins.length) {
    throw new ConfigFileError('bad_config', 'the settings file has two bins with the same id');
  }
  const defaultBin =
    typeof data.defaultBin === 'string' && ids.has(data.defaultBin) ? data.defaultBin : null;
  return { ...data, format: 'boh-config', version: 1, bins: data.bins, defaultBin };
}

/** The text of a configuration file. */
export function serializeConfig(config: ConfigFile): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
