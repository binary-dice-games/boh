# 02_tags_and_shared_bins - plan

Design: `spec/02_tags_and_shared_bins/DESIGN.md`. Follow the steps in order;
update this plan before diverging from it and record each step's result.

Steps 2 to 9 are built against the loopback fakes (`spec/01_core_features/DESIGN.md`
section 7.3). Step 1 needs real accounts and can run in parallel; its answers
may change step 9 and the Dropbox and OneDrive parts of step 4.

## 1. Provider spike

**Goal:** settle the provider questions this design depends on.
**Deliverables:** answers recorded here and in the design: (a) Drive
`appProperties` keys of the form `t.<base64url>` are accepted, the limits are
30 per app and 124 bytes, and a second user of boh reading the file sees
them; (b) a `drive.file` user with write access to a shared file can patch
its `appProperties`; (c) the Picker's shared-with-me and shared-drives folder
views, and whether a folder grant lists its files (01 plan step 1 (a)); (d)
Dropbox file properties with an app template: readable by other members of a
shared folder?; (e) OneDrive: any per-app file metadata on personal and work
accounts.
**Tests:** none (manual, recorded here and in `docs/manual-testing.md`).

**Result:** open: needs real accounts (Binary Dice Games). Steps 2 to 10 assume (a), (b) and (c) answer yes, as the fake does; if (c) answers no, shared Drive bins list only what the reader opened (design section 4.7). Dropbox and OneDrive have no manual tags and no bin links until (d) and (e) are answered. Checks listed in `docs/manual-testing.md`.

## 2. Tags, derived tags and rules

**Goal:** the provider-independent tag logic.
**Deliverables:** `web/src/tags.ts` (`normalizeTag`, `parseTagList`,
`derivedTags`, `matchRules`, Drive key encoding), `TagError` in
`web/src/errors.ts`.
**Tests:** `tests/unit/tags.test.ts`: normalization (case, NFC, spaces,
rejected characters, byte limit, Unicode letters), derived tags for every
renderer and for names without extension, rule matching (bins, globs,
format, kind, deduplication), key round trip and length bound.

**Result:** done; also `applyTagChange`. 15 tests in `tags.test.ts`.

## 3. Query language

**Goal:** `parseQuery` and `matches` of design section 3.6.
**Deliverables:** `web/src/query.ts`.
**Tests:** `tests/unit/query.test.ts`: every term of the table, negation,
comma OR, quoted phrases, accent-insensitive names, unknown prefixes as text,
hostile and empty input never throws.

**Result:** done, plus token helpers (`toggleToken`, `replaceTokens`, `binToken`) for the facets. 12 tests in `query.test.ts`.

## 4. Provider contract and Drive tags

**Goal:** providers carry tags, edit rights and owners.
**Deliverables:** `provider.ts` additions (design section 5.1); Drive:
`appProperties`, `capabilities(canEdit)` and `owners` in the listing fields,
tags in upload metadata (multipart and resumable), `setTags` as a key patch
with the 25-tag check against the current file, `describeFolder`,
`pickFolder({ shared })`, folder ref encoding; Dropbox, OneDrive and disabled
providers: `capabilities.tags = false`, `describeFolder`, folder refs;
`fake-drive.ts`: `appProperties` with Drive's limits, two accounts, owners,
write and read-only sharing, `drive.file` visibility per account.
**Tests:** `tests/unit/google-drive.test.ts`: upload with tags, add and
remove, concurrent patches from two accounts merge, foreign keys untouched,
`too_many_tags`, read-only member gets `forbidden`, invalid stored keys
dropped; Dropbox and OneDrive tests: `unsupported`, `describeFolder`;
`disabled-provider.test.ts`.

**Result:** done. `describeFolder`, `folderRef` and `refOfFolder` are optional members behind `capabilities.binLinks`, so Dropbox and OneDrive only gained `capabilities` and an `unsupported` `setTags`; `pickFolder` also takes `folderId` (opening a bin link). The fake Drive keeps writers and readers apart and enforces Drive's property limits.

## 5. Config: rules, default tags, shared bins

**Goal:** the config carries design sections 3.3 and 3.4.
**Deliverables:** `config-file.ts` (`rules`, `Bin.shared`, `owner`,
`defaultTags`, still `version: 1`), `BinStore` operations to add, edit and
remove rules and to add a shared bin; removing a bin prunes its rules.
**Tests:** `tests/unit/bin-store.test.ts`: round trip, unknown fields still
preserved, a config written by this build read by the 01 parser, conflicts
retried with rules.

**Result:** done; `BinStore.addRule`, `updateRule`, `removeRule`, `rules`, `findFolder`. The dialog adds and deletes rules; editing one in place is delete and add.

## 6. Library index

**Goal:** `LibraryIndex` of design section 3.5.
**Deliverables:** `web/src/library-index.ts` with IndexedDB cache,
per-bin limits and concurrency, stale bins, `forget` on disconnect.
**Tests:** `tests/unit/library-index.test.ts` (fake provider, `fake-indexeddb`
as a dev dependency only if Node lacks IndexedDB): cache first, 5,000 cap,
one failing bin, facets and counts, updates after writes, cache expiry and
`forget`.

**Result:** done; the cache is a `LibraryCache` interface (IndexedDB in the browser, `MemoryLibraryCache` in Node), so no `fake-indexeddb` dependency. Bulk edits in `web/src/bulk-tags.ts` and `web/src/pool.ts` are tested in `library-index.test.ts`.

## 7. Bin links

**Goal:** `#v1/bin/<provider>/<ref>`.
**Deliverables:** `links.ts` parse and format, *Copy bin link* in the bin
view, the opening sequence of design section 4.6 with *Add to my bins*.
**Tests:** `tests/unit/links.test.ts`: round trip, strict parsing, paste links
unchanged; `tests/e2e/shared-bins.test.ts` (step 9).

**Result:** done for Google Drive (`web/src/ui/bin-link.ts`).

## 8. Tag UI and library

**Goal:** the user-facing features.
**Deliverables:** `web/src/ui/tag-editor.ts` (chips, completion, read-only
mode), tags in the upload form (bin defaults and rules preselected), the
viewer and bin rows; `web/src/ui/library.ts` (search box, facets, *Mine /
Shared with me / All*, selection, bulk add, remove, rename and apply rules
with progress, cancel and retry, `#library?q=`); rules editor in settings;
default tags in the bin dialog. Derived tags styled apart; all text inserted
as text.
**Tests:** `tests/e2e/library.test.ts` against the fake Drive: upload with a
rule's tags, edit tags in the viewer, filter and search, bulk rename with one
forbidden paste skipped, a tag named like HTML shown as text, URL query
restored on reload.

**Result:** done; rules dialog in `web/src/ui/rules-dialog.ts`. `tests/e2e/library.test.ts` also checks the cached library with the service down and that disconnecting empties the cache.

## 9. Shared bins

**Goal:** a second account browses and tags the first account's bin.
**Deliverables:** *Add a folder shared with me* in the bin dialog; the
`drive.file` limited-view notice and *Grant access to more* (design section
4.7); shared bins in the library's *from:* filter.
**Tests:** `tests/e2e/shared-bins.test.ts`: owner shares a folder in the fake
(writer and reader), sends a bin link; the second account opens it, adds the
bin, sees the owner's tags, the writer edits them and the reader cannot; the
owner sees the writer's tags after *Refresh*.

**Result:** done, except *Grant access to more*, which waits for step 1 (c); a shared Drive bin's view says that boh may see only the pastes the reader opened.

## 10. Documentation and release

**Goal:** users and maintainers know the feature.
**Deliverables:** `docs/using-boh.md` (tags, rules, library, search syntax,
shared bins, bin links); `docs/manual-testing.md` (real-account checks of
step 1); `docs/testing.md` (new tests); README feature list; CHANGELOG;
`spec/INDEX.md` status.
**Tests:** every new test file registered with `boh_add_test` in
`tests/CMakeLists.txt`.

**Result:** done.

## Completion Criteria

`cmake --build build --target check` and `ctest` pass on Linux, macOS and
Windows; with real Google accounts, a paste uploaded with tags shows the same
tags to a member of its bin, a writer's tag edit is seen by the owner, a
reader cannot edit tags, and a bin link opens the shared bin for a member
and is refused for someone outside it, recorded in
`docs/manual-testing.md`; the design matches what was built.
