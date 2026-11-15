# 02_tags_and_shared_bins — tags, search and shared bins

Tags on pastes, a library view that filters and searches pastes by tag across
bins, and bins that other people shared with the user. Builds on
`spec/01_core_features/DESIGN.md` (called "01" below); everything this
document does not change stays as 01 describes it. Plan:
`spec/02_tags_and_shared_bins/PLAN.md`.

## 1. Purpose and scope

1. **Manual tags.** A user who can write a paste adds and removes tags on it:
   when uploading, in the viewer, and in bulk from the library. Tags are
   stored on the paste's file in the provider, so everyone who can read the
   paste sees them in boh.
2. **Automatic tags.** Two kinds:
   - *Derived tags* (`format:md`, `kind:image`, `lang:python`) are computed
     from each paste's metadata whenever it is listed. They are never stored
     and cannot be edited, so they are never stale.
   - *Tag rules* the user writes in their config ("pastes in bin Notes get
     `notes`", "files named `*.log` get `logs`", "format `json` gets `data`")
     are applied at upload and become ordinary manual tags, visible to
     everyone and editable afterwards.
3. **Library.** One view lists the pastes of many bins together, with a
   search box, tag facets with counts, and *Mine / Shared with me / All*. It
   lifts 01's non-goal "search across bins" for paste names and tags.
4. **Shared bins.** A user registers a folder somebody else owns and shared
   with them, either by picking it from "Shared with me" or by opening a
   *bin link* the owner sent. Its pastes appear in the library next to the
   user's own; tags can be edited where the provider grants write access.

Non-goals: searching paste contents (it would download every file); tags
private to one reader on someone else's paste (a reader without write access
sees tags but cannot change them); tag colors or descriptions; server-side
search; tags in the providers' own UIs; tagging on Dropbox and OneDrive
before their spike (section 6, plan step 1); boh changing anyone's sharing
(unchanged from 01).

Owned and changed files: `web/src/tags.ts` (new: normalization, derived tags,
rules), `web/src/query.ts` (new: search language), `web/src/library-index.ts`
(new: listing cache and filtering), `web/src/ui/library.ts` and
`web/src/ui/tag-editor.ts` (new), `web/src/providers/provider.ts`,
`google-drive.ts`, `google-picker.ts`, `dropbox.ts`, `onedrive.ts`,
`disabled.ts`, `web/src/config-file.ts`, `web/src/bin-store.ts`,
`web/src/links.ts`, the existing views in `web/src/ui/`, tests and fakes in
`tests/`, `docs/using-boh.md`.

## 2. Design goals

1. **Tags travel with the paste, not with the viewer.** Manual tags live in
   the file's own metadata in the provider, so the owner and every member see
   the same tags on any device, and the provider decides who may change them
   (01 goal 2).
2. **A paste stays an ordinary file** (01 goal 3). No sidecar or index files
   in bins; tags are app metadata the provider keeps on the file and removing
   them never touches the bytes.
3. **Automatic means derived or explicit.** boh never guesses tags from
   content. Derived tags come from name and MIME type only; everything else
   comes from rules the user wrote.
4. **Search is local and private.** Filtering runs in the browser over
   listings boh already fetched; queries never leave the browser.
5. **Shared bins are read with the reader's own rights.** Registering a shared
   folder never asks the owner for anything and never widens access.
6. **No new runtime dependencies.**

## 3. Key abstractions

### 3.1 Tag

A manual tag is a short label, normalized by `normalizeTag` (`tags.ts`):

1. Unicode NFC, trimmed, lowercased (`toLowerCase`, locale-independent).
2. Runs of white space become one `-`.
3. Allowed: Unicode letters and digits, `-`, `_`, `.`, `/`. Not allowed: `:`
   (reserved for derived tags), `,`, quotes, a leading `-` or `#` (query
   syntax), control characters.
4. 1 to 48 UTF-8 bytes.

An input that cannot be normalized is rejected with `TagError('invalid_tag')`,
never silently changed beyond rules 1 and 2. Two tags are equal when their
normalized forms are. At most **25 manual tags per paste** (Drive limit,
section 4.1); more is `TagError('too_many_tags')`.

### 3.2 Derived tags

`derivedTags(meta): string[]`, computed from `PasteMeta.name` and `mime` with
01's format resolution minus content sniffing (01 section 4.5):

| Tag | Value | Example |
|---|---|---|
| `format:<ext>` | Lowercase extension; `format:none` without one | `format:md`, `format:png` |
| `kind:<renderer>` | The renderer 01 would pick: `text`, `markdown`, `html`, `image`, `audio`, `video`, `pdf`, `download` | `kind:image` |
| `lang:<language>` | highlight.js language from the extension, only for `kind:text` code files | `lang:typescript` |

Derived tags carry a `:` and so can never collide with a manual tag. They are
shown in a distinct style and are filters only.

### 3.3 Tag rules

Stored in the account's config file (01 section 4.3), per account:

| Field | Meaning |
|---|---|
| `id` | Random id |
| `bins` | Bin ids the rule applies to; empty means every bin of the account |
| `match` | Any of `format` (extensions), `kind` (renderers), `name` (a glob over the file name: `*`, `?`, case-insensitive). All given fields must match |
| `tags` | Manual tags to add (normalized) |

Rules run once, at upload (new paste or file drop), over the file name and
format the paste will have. Their tags are preselected in the upload form, so
the user sees and can remove them before uploading. *Apply rules* in the
library runs them on selected existing pastes as a bulk add (section 4.4).
Rules never remove tags and never run on someone else's bin unless the user
can write it.

### 3.4 Bin, extended

Optional fields on 01's `Bin` (01 section 4.2), so the config stays
`version: 1` (unknown fields are preserved by older builds):

| Field | Meaning |
|---|---|
| `shared` | `true` for a folder the user does not own. Absent means own bin |
| `owner` | `{ name, email? }` of the folder's owner as the provider reported it when added; display only |
| `defaultTags` | Manual tags preselected for new pastes in this bin (a one-bin rule without a match, kept on the bin for the bin dialog) |

A shared bin has a visibility label like any bin (it drives the links boh
makes for pastes the user uploads there) but defaults to `members`. Whether
the user may upload, tag or delete is read live from the provider
(`PasteMeta.canEdit`, `FolderInfo.canAdd`), never stored. The config's
top level gains `rules: TagRule[]`.

### 3.5 Library index

`LibraryIndex` (`library-index.ts`) holds, per bin, the listed `PasteMeta`
(with manual tags) plus derived tags, and answers queries.

- Filled by listing each selected bin to the end, up to **5,000 pastes per
  bin** (beyond that the bin shows "showing the newest 5,000"); pages are
  fetched in sequence per bin, at most 3 bins at once.
- Cached in IndexedDB per provider account (database `boh-library`), so the
  library appears before the network answers, like the config cache (01
  section 4.3). The cache holds names and tags of other people's pastes, so
  *Disconnect* deletes that account's cache, and an entry older than 30 days
  is dropped.
- Refreshed only on user action (opening the library, *Refresh*, a bin's
  view) and after boh's own writes (01 section 7.2 rule 1: no polling).
- A bin whose listing fails keeps its cached entries, marked stale, with the
  error shown on that bin's facet; the other bins still answer.

### 3.6 Query

`parseQuery(text): Query` (`query.ts`). Space-separated terms, all of which
must match (AND):

| Term | Matches |
|---|---|
| `word` | A manual tag equal to `word`, or the name containing `word` |
| `#word` | Manual tag `word` only |
| `-term` | Negation of any other term |
| `format:md,txt`, `kind:image`, `lang:go` | Derived tag; commas mean OR |
| `tag:a,b` | Manual tag `a` or `b` |
| `bin:"Work notes"` | Bins by name (comma OR) |
| `from:me`, `from:others` | Own bins, shared bins |
| `untagged` | No manual tags |
| `"two words"` | Name containing the phrase |

Name matching is case- and accent-insensitive (NFD, combining marks removed).
Unknown `key:` prefixes are treated as name text, never as an error, and the
parser never throws: the worst input matches nothing. The facets in the UI
only edit this text, so every view state is a query and the library URL is
`#library?q=<query>` (bookmarkable, stays in the browser).

## 4. Data flow

### 4.1 Storage of manual tags per provider

| Provider | Where | Read | Write |
|---|---|---|---|
| Drive | File `appProperties`, one per tag: key `t.<base64url(UTF-8 tag)>`, value `1` | `files.list`/`files.get` with `appProperties` in `fields` | `files.update` with `{ appProperties: { <key>: '1' or null } }` patching only the touched keys |
| Dropbox | Open (plan step 1): file properties with an app template, if other members can read them | — | — |
| OneDrive | Open (plan step 1): no per-app file metadata on personal accounts | — | — |

Drive's `appProperties` are visible only to boh (the app that set them) and
to every user of boh who can read the file, which is exactly goal 1. Limits:
30 private properties per app per file and 124 bytes for key plus value; a
48-byte tag encodes to at most 66 characters of key, and 25 tags leave room
for later keys. Keys outside the `t.` prefix are ignored on read and never
removed. One key per tag (not one list value) makes concurrent edits from two
devices or two members merge: each patch only sets or clears its own keys.

Providers without tag storage report `capabilities.tags = false`: their bins
show derived tags, accept filters and search, and hide manual tag editing.

### 4.2 Upload with tags

1. The upload form shows the tag editor preloaded with the bin's
   `defaultTags` and the tags of every rule that matches the name and format.
2. `Provider.upload(folder, name, blob, { tags })`. Drive sends the
   `appProperties` in the same multipart or resumable metadata, so the paste
   never exists untagged.
3. The new `PasteMeta` goes into the library index; recent pastes (01 section
   4.3) keep their shape.

### 4.3 Editing tags of one paste

The viewer and each library row show manual and derived tags. When
`meta.canEdit`, the tag editor offers add (with completion from the tags in
the index) and remove. Each change calls `setTags(meta, { add, remove })` and
updates the index from the returned `PasteMeta`. A `forbidden` answer turns
the editor read-only and says the owner has not given write access.

### 4.4 Bulk edits

In the library the user selects pastes (or *Select all matching*) and chooses
*Add tags*, *Remove tags*, *Apply rules* or *Rename tag* (remove `a`, add `b`
on every selected paste that has `a`). boh runs one `setTags` per paste, at
most 4 at a time, honoring rate limits (01 section 7.2 rule 3), with a
progress line and *Cancel* (aborts the rest; finished pastes stay changed).
Pastes the user cannot edit are skipped up front and counted. The result
lists failures by name with *Retry failed*. There is no transaction across
pastes; every paste is consistent on its own.

### 4.5 Adding a shared bin

From the bin dialog, *Add a folder shared with me*:

- **Drive**: the Picker with the "Shared with me" and shared-drives folder
  views (`DocsView(FOLDERS).setOwnedByMe(false)`, `setEnableDrives(true)`).
  Picking grants boh `drive.file` access to the folder.
- **Dropbox and OneDrive**: 01's folder browser already lists shared folders
  at the top level; the folder is marked `shared` when its owner is not the
  account.

boh reads the folder's metadata (`describeFolder`: name, owner, `canAdd`) and
sharing, and the user names the bin. The bin is written to the user's own
config with `shared: true` and `owner`.

### 4.6 Bin links

The owner of a bin presses *Copy bin link* and sends:

```
https://<org>.github.io/boh/#v1/bin/<provider>/<ref>[?n=<name>]
```

`<ref>` is base64url of the provider's folder reference (Drive: folder id or
`<id>/<resourceKey>`; Dropbox: the folder's shared link or `ns:<namespace
id>`; OneDrive: `<driveId>/<itemId>`). `bin` is not a provider code, so
builds without this project reject the link as invalid instead of opening a
folder as a paste. No new sharing is made: the link only works for people the
folder is already shared with (01 goal 2), and the dialog says so next to the
folder's real sharing.

Opening a bin link follows 01's recipient sequence (01 section 3) with the
folder in place of the file: sign in; for Drive, *Grant access* opens the
Picker preset to the folder; then a read-only preview of the bin's library
with *Add to my bins*. A bin already registered (same provider and folder)
opens directly.

### 4.7 Listing other people's pastes under `drive.file`

A Drive folder picked by a reader lists only the files `drive.file` lets boh
see. Whether a Picker grant on a folder covers the files in it is 01 plan
step 1 (a), still open. If it does not, a shared bin lists only the pastes
the reader opened or granted one by one, and the library says "boh can only
see the pastes you opened from this bin" with *Grant access to more*
(Picker with multi-select over the folder). This is the one known limit of
shared bins on Drive; it needs no design change if step 1 (a) answers yes.

## 5. Public API contract

### 5.1 `Provider` additions (`web/src/providers/provider.ts`)

| Member | Contract |
|---|---|
| `capabilities: { tags: boolean }` | Whether `setTags` and upload tags work |
| `PasteMeta.tags?: string[]` | Normalized manual tags, sorted; absent when the provider has no tag storage. Entries that fail `normalizeTag` are dropped on read |
| `PasteMeta.canEdit?: boolean` | Whether the account may change this file (Drive `capabilities.canEdit`); absent means unknown, treated as yes until a write says `forbidden` |
| `PasteMeta.ownedByMe?: boolean` | For *from:* and display |
| `upload(folder, name, blob, opts?: { tags?: string[] })` | As 01, plus tags set atomically with the file; `unsupported` if tags are given and `capabilities.tags` is false |
| `setTags(meta, change: { add?: string[]; remove?: string[] }, signal?)` | Applies only the given changes and returns the updated `PasteMeta`. Rejects `TagError('too_many_tags')` when the result would exceed 25 (checked against the file's current tags, not the cached ones), `ProviderError` `forbidden`, `not_found`, `unsupported` |
| `describeFolder(folder): Promise<FolderInfo>` | `{ name, owner?: { name, email? }, ownedByMe, canAdd }` |
| `pickFolder?({ shared?: boolean })` | Drive: `shared` shows the shared-with-me and shared-drives views |
| `folderRef(ref: string): FolderRef` / `refOfFolder(folder): string` | Bin link encoding (section 4.6); `LinkError('invalid_link')` on bad input |

`createDisabledProvider` gains the same members, rejecting `not_configured`.

### 5.2 Core modules

| Function | Contract |
|---|---|
| `normalizeTag(input): string` | Section 3.1; throws `TagError('invalid_tag')` |
| `parseTagList(input): { tags, invalid }` | Splits on commas and Enter for the editor; never throws |
| `derivedTags(meta): string[]` | Section 3.2; pure |
| `matchRules(rules, binId, name, ext): string[]` | Section 3.3; pure, deduplicated |
| `parseQuery(text): Query`, `matches(query, entry): boolean` | Section 3.6; never throw |
| `LibraryIndex.load(bins, signal)`, `.query(query)`, `.facets(query)`, `.update(meta)`, `.forget(account)` | Section 3.5; `facets` returns tag counts over the current result |
| `parseFragment` | Also returns `{ kind: 'bin', provider, ref, name? }` (01 section 4.4 grammar plus `bin`) |

`TagError` is a `BohError` with `reason` `invalid_tag` or `too_many_tags`
(`web/src/errors.ts`).

### 5.3 Config file

`{ format: 'boh-config', version: 1, bins: Bin[], defaultBin, rules?:
TagRule[] }`, bins as in section 3.4. Rules naming a bin id that no longer
exists are kept but ignored, and removed when that bin is removed.

## 6. Design decisions

| Decision | Rejected | Why |
|---|---|---|
| Tags in Drive `appProperties` on the file | An index file in the bin; tags in the owner's config; Drive `properties` (public); the file `description` | An index file is a sidecar (goal 2) and races between members; config tags are invisible to members (goal 1); `properties` and `description` are shown and edited by other apps and the Drive UI, so boh could not trust their format |
| One property per tag | One property holding a list | Concurrent edits merge per key; a list value is last-writer-wins and hits the 124-byte limit after a few tags |
| Base64url tag in the key | The tag text as key | Property key characters are restricted; base64url is safe for any normalized tag and keeps the length predictable |
| Derived tags computed, never stored | Writing `format:md` onto files | Never stale, costs nothing, needs no write access, works on providers without tag storage and on other people's pastes |
| Rules applied at upload as real tags | Rules evaluated on every listing | Rules are personal config; stored tags are what members see. Evaluated rules would show the owner tags nobody else sees |
| No content sniffing for tags | Guessing tags from contents | Would download every paste and invents labels the user did not ask for (goal 3) |
| Search in the browser over a cached index | Drive `files.list` queries per search; a search server | Works the same on all providers, across bins and accounts, offline from the cache, and keeps queries private; bins are small enough (5,000 cap) |
| Index in IndexedDB | `localStorage` | Thousands of entries exceed `localStorage`'s few MiB and block the page on parse |
| Read-only tags for readers | Personal tags in the reader's config | Keeps one source of truth per paste; personal tags can be added later as a config field without changing this design |
| Bin link as `#v1/bin/...` | A new version prefix; reusing the paste grammar | Old builds reject it cleanly (`bin` is not a provider); paste links are unchanged |
| Shared bins in the reader's own config | A list of members kept by the owner | The provider already knows who has access; boh keeps no shared state (01 goal 1) |
| Dropbox and OneDrive without manual tags until their spike | Inventing per-provider storage now | Both are off on the site; Dropbox file properties and OneDrive metadata need real-account checks first |

## 7. Constraints and invariants

1. Tags, names and owners are inserted into the DOM as text only (01 section
   7.1 rule 4); they are other people's input.
2. `setTags` never writes keys outside the `t.` prefix and never rewrites the
   file content or name.
3. A tag write is a separate call from any content write; a failed tag write
   after a successful upload (resumable path) leaves the paste uploaded and
   says the tags were not saved, with *Retry*.
4. Every listing and tag call has an `AbortSignal` and a timeout; leaving the
   library aborts its loads (01 section 7.2 rule 2).
5. The library never fetches paste contents.
6. Queries, the index and the library URL never leave the browser.
7. Disconnecting an account deletes its index cache and removes its bins from
   the library at once.
8. Tests use the loopback fakes (01 section 7.3); `fake-drive.ts` gains
   `appProperties` with Drive's limits, `capabilities.canEdit`, owners, the
   shared-with-me state of a second account, and per-account `drive.file`
   visibility.

## 8. Integration boundaries

- **01_core_features**: provider contract (01 section 5.1), config file (01
  section 4.3), link grammar (01 section 4.4), formats and renderers (01
  sections 4.5, 4.6), recipient sequence (01 section 3). This project extends
  them additively; config stays `version: 1`, paste links are unchanged.
- **01 plan step 1 (a)**: decides how much of a shared Drive bin a reader
  sees (section 4.7).
- **Google Picker**: shared-with-me and shared-drives views; no new scopes.
  `drive.file` covers `appProperties` on files boh can see.
- **Docs**: `docs/using-boh.md` gains tags, the library, the search syntax and
  shared bins; `docs/manual-testing.md` gains the real-account checks.
