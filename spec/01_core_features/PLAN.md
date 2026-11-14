# 01_core_features - plan

Design: `spec/01_core_features/DESIGN.md`. Follow the steps in order; update
this plan before diverging from it and record each step's result.

Order change: steps 1 and 2 need real accounts and the provider apps
registered by Binary Dice Games, which an implementation session cannot do.
Steps 3 to 10 are built first against loopback fakes of the three APIs, with
the open questions of step 1 handled by fallbacks (anonymous fetch failing
means "sign in"); steps 1 and 2 are then done by hand and may change the
providers.

## 1. Provider spike

**Goal:** settle the open questions of the design before building on them.
**Deliverables:** throwaway pages under `spikes/` (not in the site) and a
results section added here, answering: (a) does a Picker grant on a folder
under `drive.file` let boh list and read files others add to it; (b) does an
anonymous Drive `files.get?alt=media&key=` work with CORS for "anyone with the
link" files; (c) can a Dropbox public shared link be downloaded anonymously
from the browser (CORS) and how `sharing/get_shared_link_file` behaves for
`no_one` links with a member's token; (d) can a OneDrive anonymous link be
read without sign-in, and which scopes work for personal and work accounts;
(e) the Google domain verification route for the Pages address.
**Tests:** none (manual, recorded here). Design updated with the answers.
**Result:** open: needs real accounts. The implementation assumes the answers below and falls back where they are no: (a) Picker folder grant covers children (else members grant per file); (b) and (c) anonymous reads fail over to "sign in"; (d) OneDrive always asks for a sign-in. Checks listed in `docs/manual-testing.md`.

## 2. Provider apps and build configuration

**Goal:** the three apps exist and their public ids reach the page.
**Deliverables:** `web/boh.config.json`, env overrides in `build-web`;
`docs/providers.md` (how to register each app, redirect URIs, scopes);
`auth.html` redirect page.
**Tests:** `tests/unit/site-build.test.ts`: config and overrides are injected,
`auth.html` is built.
**Result:** build side done (`web/boh.config.json`, `BOH_*` variables, repository variables in the Pages workflow, `auth.html`, `docs/providers.md`, tested in `site-build.test.ts` and `csp.test.ts`); registering the three apps is open (Binary Dice Games).

## 3. Core types, links and formats

**Goal:** the provider-independent pieces.
**Deliverables:** `web/src/providers/provider.ts` (interface, errors),
`web/src/links.ts` (parse/format of `#v1/...`), `web/src/formats.ts` (format
detection, renderer choice, file names), `web/src/pkce.ts`.
**Tests:** `tests/unit/links.test.ts`, `formats.test.ts`, `pkce.test.ts`.
**Result:** done; also `errors.ts`, `http.ts`, `oauth.ts`, `storage.ts`, `token-store.ts`, `b64.ts`; tests `links`, `formats`, `crypto-utils`, `http`.

## 4. Google Drive provider

**Goal:** `createDriveProvider` meets the full `Provider` contract.
**Deliverables:** `web/src/providers/google-drive.ts` (sign-in with GIS,
Picker, appData config, upload, list, share, remove, open, fetch);
`tests/support/fake-drive.ts`.
**Tests:** `tests/unit/google-drive.test.ts` against the fake, including
conflicts, `needs_grant`, anonymous open and rate limits.
**Result:** done, with our own implicit-grant popup instead of Google Identity Services (design section 4.1) and `google-picker.ts`.

## 5. Configuration store

**Goal:** `BinStore`: union of accounts' bins, cache, conflict handling.
**Deliverables:** `web/src/bin-store.ts`, `web/src/local-state.ts` (recent
pastes and preferences).
**Tests:** `tests/unit/bin-store.test.ts` with a fake provider: cache first,
conflict retry, unparsable file kept, unknown fields preserved.
**Result:** done; `config-file.ts` holds the file format.

## 6. Render frame and renderers

**Goal:** contained rendering of every format of design section 4.6.
**Deliverables:** `web/src/render.html`, `web/src/render/` (text, markdown,
html, remote-content hook), app-side image/audio/video/pdf/download views;
highlight.js, marked and DOMPurify added; CSP of both pages.
**Tests:** `tests/unit/formats.test.ts` (renderer choice); `tests/e2e/render.test.ts`
(each renderer, hostile HTML/Markdown runs no script and cannot touch the
parent, remote content blocked until asked, size limits);
`tests/unit/csp.test.ts`.
**Result:** done; text, Markdown and HTML render in a nested script-less frame with a per-paste policy (design section 4.6); CSP in `scripts/csp.mjs`.

## 7. App views

**Goal:** the usable page with Drive.
**Deliverables:** `web/src/main.ts` and views: accounts, bins (add, pick,
create, sharing shown with mismatch warning), new paste (text, file, drop,
clipboard image), bin listing with delete, viewer with renderer switch, copy
link, download, open in provider, recent pastes; the recipient sequence of
design section 3.
**Tests:** `tests/e2e/app.test.ts` against the test build with the fake Drive:
add a bin, paste, copy the link, open it as a signed-out recipient (public)
and as a signed-in one (members), delete.
**Result:** done (`web/src/ui/`); browser test `app-drive.test.ts`.

## 8. Dropbox provider

**Goal:** `createDropboxProvider` with PKCE and refresh tokens.
**Deliverables:** `web/src/providers/dropbox.ts`, `tests/support/fake-dropbox.ts`.
**Tests:** `tests/unit/dropbox.test.ts`; the app e2e test runs for Dropbox too.
**Result:** done, with the `id:` fallback for accounts that cannot make members-only links; `app-dropbox.test.ts`.

## 9. OneDrive provider

**Goal:** `createOneDriveProvider` over Microsoft Graph.
**Deliverables:** `web/src/providers/onedrive.ts`, `tests/support/fake-graph.ts`.
**Tests:** `tests/unit/onedrive.test.ts`; the app e2e test runs for OneDrive too.
**Result:** done; members links by drive and item id; `app-onedrive.test.ts`.

## 10. Site, documentation and release

**Goal:** a publishable site with the pages providers require.
**Deliverables:** `privacy.html` in `web/src/site/`; `build-site` and
`smoke-site` cover `auth.html`, `render.html`, `privacy.html`;
`docs/using-boh.md`, `docs/privacy.md`, `docs/manual-testing.md` (real
accounts per provider, personal and work); README overview and layout,
"Further Documentation" rows; CHANGELOG; spec index status.
**Tests:** `tests/unit/site-build.test.ts`, `tests/e2e/site.test.ts`.
**Result:** done, plus `third-party-licenses.txt`; manual checks open (`docs/manual-testing.md`).

## Completion Criteria

`cmake --build build --target check` and `ctest` pass on Linux, macOS and
Windows; the built site contains `index.html`, `auth.html`, `render.html`,
`privacy.html` and `404.html`; a public paste and a members paste have been
created and opened through each of the three providers with real accounts and
recorded in `docs/manual-testing.md`; the design matches what was built.
