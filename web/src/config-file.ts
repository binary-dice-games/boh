// MIT License © 2026 Binary Dice Games
/**
 * @file The configuration file each account keeps (design section 4.3): `boh-config.json`, a
 * versioned list of bins. Unknown fields are kept on write so a later boh's additions survive.
 */
import { BohError } from './errors';
import { randomString } from './pkce';
import { VISIBILITIES, type FolderRef, type Visibility } from './providers/provider';
import { isTagRule, type TagRule } from './tags';

/** A registered folder. */
export interface Bin {
  id: string;
  name: string;
  folder: FolderRef;
  visibility: Visibility;
  /** Extension preselected for new text pastes. */
  defaultFormat?: string;
  /** A folder someone else owns and shared with the user. */
  shared?: boolean;
  /** The owner of a shared folder, as the provider reported it when the bin was added. */
  owner?: BinOwner;
  /** Manual tags preselected for new pastes in this bin. */
  defaultTags?: string[];
  [extra: string]: unknown;
}

/** Who owns a shared bin's folder (display only). */
export interface BinOwner {
  name: string;
  email?: string;
}

/** The file's contents. */
export interface ConfigFile {
  format: 'boh-config';
  version: 1;
  bins: Bin[];
  defaultBin: string | null;
  /** Tag rules of this account (spec/02_tags_and_shared_bins/DESIGN.md section 3.3). */
  rules?: TagRule[];
  [extra: string]: unknown;
}

/** The file cannot be used: `bad_config` (not a boh config) or `newer_config` (later version). */
export class ConfigFileError extends BohError {}

/** An empty configuration. */
export function emptyConfig(): ConfigFile {
  return { format: 'boh-config', version: 1, bins: [], defaultBin: null };
}

/** A new random id for a bin or a tag rule. */
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

const isOwner = (v: unknown): v is BinOwner =>
  isObject(v) &&
  typeof v.name === 'string' &&
  (v.email === undefined || typeof v.email === 'string');

function isBin(v: unknown): v is Bin {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    isFolder(v.folder) &&
    (VISIBILITIES as readonly unknown[]).includes(v.visibility) &&
    (v.defaultFormat === undefined || typeof v.defaultFormat === 'string') &&
    (v.shared === undefined || typeof v.shared === 'boolean') &&
    (v.owner === undefined || isOwner(v.owner)) &&
    (v.defaultTags === undefined ||
      (Array.isArray(v.defaultTags) && v.defaultTags.every((t) => typeof t === 'string')))
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
  if (data.rules !== undefined && !(Array.isArray(data.rules) && data.rules.every(isTagRule))) {
    throw new ConfigFileError('bad_config', 'the settings file has a damaged list of tag rules');
  }
  const defaultBin =
    typeof data.defaultBin === 'string' && ids.has(data.defaultBin) ? data.defaultBin : null;
  return { ...data, format: 'boh-config', version: 1, bins: data.bins, defaultBin };
}

/** The text of a configuration file. */
export function serializeConfig(config: ConfigFile): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
