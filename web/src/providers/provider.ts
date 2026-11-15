// MIT License © 2026 Binary Dice Games
/**
 * @file The provider contract (spec/01_core_features/DESIGN.md section 5.1): everything the app
 * knows about a cloud storage service. Each provider module implements it; the app never calls a
 * provider API itself.
 */
import type { BohConfig } from '../config';
import type { FetchFn } from '../http';
import type { PopupEnv } from '../oauth';
import type { TagChange } from '../tags';
import type { TokenStore } from '../token-store';

/** Provider codes, as used in links and config. */
export const PROVIDER_IDS = ['gd', 'db', 'od'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Display names. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gd: 'Google Drive',
  db: 'Dropbox',
  od: 'OneDrive',
};

/** Whether `value` is a provider code. */
export function isProviderId(value: unknown): value is ProviderId {
  return (PROVIDER_IDS as readonly unknown[]).includes(value);
}

/** Who may read a bin's pastes, as the user intends it. */
export type Visibility = 'public' | 'members' | 'private';
export const VISIBILITIES: readonly Visibility[] = ['public', 'members', 'private'];

/** A connected account. */
export interface Account {
  id: string;
  name: string;
  email?: string;
}

/**
 * A folder of a provider. `id` is the Drive file id, the Dropbox id (`id:...`) or the OneDrive
 * item id; `path` is the Dropbox path; `driveId` the OneDrive drive.
 */
export interface FolderRef {
  id: string;
  name: string;
  path?: string;
  driveId?: string;
}

/** The real sharing of a folder, as the provider reports it. */
export interface Sharing {
  kind: Visibility | 'unknown';
  /** People or groups with access besides the owner, when known. */
  members?: number;
  /** Where the user changes the sharing in the provider's UI. */
  manageUrl?: string;
}

/** A paste's metadata. */
export interface PasteMeta {
  provider: ProviderId;
  /** Provider-specific identity: Drive file id, Dropbox id, OneDrive `driveId/itemId`. */
  key: string;
  name: string;
  size?: number;
  /** The MIME type the provider reports (a hint only; boh picks the type it renders with). */
  mime?: string;
  /** ISO time of the last change. */
  modified?: string;
  /** The file in the provider's UI. */
  webUrl?: string;
  /** How a linked paste is read: without a token, or with the viewer's. */
  access?: 'anonymous' | 'token';
  /** Provider-specific detail a later call needs (a download URL, a shared link). */
  source?: string;
  /** Normalized manual tags, sorted; absent when the provider has no tag storage. */
  tags?: string[];
  /** Whether the account may change this file; absent: unknown (a write may still be refused). */
  canEdit?: boolean;
  /** Whether the account owns this file. */
  ownedByMe?: boolean;
}

/** What a provider supports beyond the core contract. */
export interface ProviderCapabilities {
  /** Manual tags: `upload` with tags and `setTags`. */
  tags: boolean;
  /** Bin links and shared bins: `describeFolder`, `folderRef` and `refOfFolder`. */
  binLinks: boolean;
}

/** A folder's owner and the account's rights in it. */
export interface FolderInfo {
  name: string;
  owner?: { name: string; email?: string };
  ownedByMe: boolean;
  /** Whether the account may add files to it. */
  canAdd: boolean;
}

/** Options of `Provider.upload`. */
export interface UploadOptions {
  /** Normalized manual tags, set together with the file. */
  tags?: string[];
}

/** Options of `Provider.pickFolder`. */
export interface PickFolderOptions {
  /** Offer the folders shared with the user instead of their own. */
  shared?: boolean;
  /** Preset the picker to this folder (to let boh open a linked bin). */
  folderId?: string;
}

/** A page of a bin's listing. */
export interface ListPage {
  items: PasteMeta[];
  /** Pass to `list` for the next page; absent on the last. */
  cursor?: string;
}

/** The raw configuration file and its revision; both `null` when there is no file yet. */
export interface ConfigSnapshot {
  text: string | null;
  rev: string | null;
}

/** Options of `Provider.fetch`. */
export interface FetchOptions {
  maxBytes: number;
  signal?: AbortSignal;
}

/** One cloud storage service. Every method throws `ProviderError`/`AuthError` subclasses. */
export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  /** False when this build has no client id for the provider. */
  readonly configured: boolean;
  /** The largest paste `upload` accepts. */
  readonly maxUploadBytes: number;
  /** What this provider supports beyond the core contract. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Signs in. Interactive sign-in opens a popup and must be called synchronously from a click.
   * @param stay keep the sign-in in `localStorage`
   * @throws {AuthError} `cancelled`, `popup_blocked`, `denied`, `expired`, `failed`
   */
  signIn(options: { stay: boolean; signal?: AbortSignal }): Promise<Account>;
  /** Revokes where possible and forgets the sign-in. Never throws. */
  signOut(): Promise<void>;
  /** The signed-in account, or `null`. A stored account counts even if its token expired. */
  account(): Account | null;
  /** Moves the stored sign-in to `localStorage` (`true`) or `sessionStorage`. */
  setStay(stay: boolean): void;

  /** Reads the configuration file. */
  readConfig(): Promise<ConfigSnapshot>;
  /**
   * Writes the configuration file if its revision is still `rev` (`null`: must not exist yet).
   * @returns the new revision
   * @throws {ConflictError} when the file changed or appeared since
   */
  writeConfig(text: string, rev: string | null): Promise<string>;

  /** Lets the user pick a folder in the provider's own picker (Drive); `null` when cancelled. */
  pickFolder?(options?: PickFolderOptions): Promise<FolderRef | null>;
  /** The folders in `parent` (`null`: the top level), for boh's folder browser. */
  listFolders?(parent: FolderRef | null): Promise<FolderRef[]>;
  /** Creates a folder in `parent` (default: the top level). */
  createFolder(name: string, parent?: FolderRef | null): Promise<FolderRef>;
  /** The folder's real sharing. Returns kind `unknown` when the provider will not say. */
  describeSharing(folder: FolderRef): Promise<Sharing>;

  /** The pastes in `folder`, newest first where the provider allows. */
  list(folder: FolderRef, cursor?: string): Promise<ListPage>;
  /**
   * Uploads a new file; never overwrites (a clash gets a new name). Tags are set with the file.
   * @throws {ProviderError} `unsupported` when tags are given and `capabilities.tags` is false
   * @throws {TagError} `too_many_tags`
   */
  upload(folder: FolderRef, name: string, blob: Blob, options?: UploadOptions): Promise<PasteMeta>;
  /**
   * Adds and removes manual tags of a paste, touching only those tags, and returns the paste's
   * updated metadata. The limit is checked against the file's current tags.
   * @throws {TagError} `too_many_tags`
   * @throws {ProviderError} `forbidden`, `not_found`, `unsupported` (no tag storage)
   */
  setTags(meta: PasteMeta, change: TagChange, signal?: AbortSignal): Promise<PasteMeta>;
  /**
   * The link reference of a paste for a bin of `visibility` (see the design's section 4.4).
   * @throws {ProviderError} `unsupported` when the provider refuses that kind of link
   */
  share(meta: PasteMeta, visibility: Visibility): Promise<string>;
  /** Deletes the paste (to the provider's trash where it has one). */
  remove(meta: PasteMeta): Promise<void>;

  /**
   * The metadata of a linked paste: anonymously first, then with the viewer's token.
   * @throws {ProviderError} `needs_sign_in`, `needs_grant`, `forbidden`, `not_found`
   */
  openRef(ref: string): Promise<PasteMeta>;
  /** Asks the user to let boh open the linked file (Drive under `drive.file`). */
  grantAccess?(ref: string): Promise<boolean>;
  /**
   * The paste's bytes.
   * @throws {TooLargeError} over `maxBytes`
   */
  fetch(meta: PasteMeta, options: FetchOptions): Promise<Blob>;
  /** The folder in the provider's UI. */
  folderUrl(folder: FolderRef): string | undefined;

  /**
   * The folder's name, owner and the account's rights (`capabilities.binLinks`).
   * @throws {ProviderError} `needs_sign_in`, `needs_grant` (Drive: pick it first), `not_found`
   */
  describeFolder?(folder: FolderRef): Promise<FolderInfo>;
  /** The bin link reference of a folder (`capabilities.binLinks`). */
  refOfFolder?(folder: FolderRef): string;
  /**
   * The folder a bin link reference names; its `name` is empty until `describeFolder`.
   * @throws {LinkError} when the reference is damaged
   */
  folderRef?(ref: string): FolderRef;
}

/** What a provider module needs from its surroundings; the tests replace each part. */
export interface ProviderEnv {
  config: BohConfig;
  fetch: FetchFn;
  tokens: TokenStore;
  popup: PopupEnv;
  /** Epoch ms; default `Date.now`. */
  now?: () => number;
}
