# 01_core_features — product, architecture and core

Foundation project. It defines what boh is, how the pieces fit, the provider
abstraction, the configuration, the paste link, and the renderers. Plan:
`spec/01_core_features/PLAN.md`. The repository, build and test scaffolding
already exist and are described in `README.md` and `docs/`; this project does
not change them beyond what section 8 lists.

## 1. Purpose and scope

boh (bin of holding) is a pastebin without a paste server. A user keeps pastes
in folders of their own cloud storage (Google Drive, Dropbox, OneDrive). boh is
a static page on GitHub Pages. In v1 the whole paste cycle happens in boh's
own page: the user creates and uploads a paste there, gets the link there, and
the recipient views it there. The provider's own UI is never required, though
pastes stay ordinary files the user can also manage there. boh:

1. Lets the user **connect** cloud accounts and **register folders** as paste
   bins, each with a name and a visibility label (public, members, private).
2. **Creates and uploads pastes** from its own page: text typed or pasted into
   an editor, a file chosen or dropped, or an image from the clipboard. boh
   uploads it as one file into the chosen bin through the provider's API and
   then shows its link. Files that are already in a bin (added through the
   provider's UI or by other members) are listed and can be linked and viewed
   too.
3. **Lists** the pastes in a bin and **deletes** the user's own.
4. **Makes a boh link** to a paste that anyone can open in boh.
5. **Shows** a paste with a renderer picked from its format: highlighted text,
   Markdown, HTML, image, audio, video, PDF, or a download.

The cloud service holds every byte and enforces every permission. boh has no
server, no database and no analytics; the only state it keeps is the user's
configuration (in their own cloud, section 4.3) and conveniences in their
browser.

Non-goals (v1): encryption by boh (the design leaves room: a link can grow a
key in its fragment later); expiry or burn-after-reading (nothing can delete a
file when its owner is offline); editing a paste in place; comments; search
across bins; boh changing a folder's sharing (the user does it in the provider,
boh shows it and links there); several accounts of the same provider at once;
running scripts of HTML pastes; a server of our own, even a token proxy.

**The published site offers Google Drive only** (plan step 11): it is the one
service free at any number of users. Dropbox and OneDrive are implemented and
tested but switched off by the build configuration (section 7.4); everything
below describes all three, as a build that switches them on behaves.

Owned files: `web/boh.config.json`, `web/src/` (the app, `providers/`,
`render/`, `ui/`), `scripts/config.mjs` and `scripts/csp.mjs` (build
configuration and page policies), `scripts/build-web.mjs`,
`scripts/build-site.mjs` and `scripts/smoke-site.mjs` (entry points and
injection), `tests/`, `docs/`.

## 2. Design goals

1. **No boh server.** Everything runs in the browser against the providers'
   public APIs with OAuth public clients (no client secret). GitHub Pages only
   serves static files.
2. **The provider is the authority.** Who can read or write a paste is
   whatever the folder's sharing in the provider says. boh never widens access
   on its own and never pretends a paste is private when it is not.
3. **A paste is an ordinary file.** Pastes are readable and removable in the
   provider's own UI without boh; boh adds no sidecar files and no custom
   container format.
4. **Opening a link is cheap.** A public paste opens with no sign-in (where the
   provider allows it); a members-only paste asks for exactly one sign-in to
   the paste's provider.
5. **Rendering is contained.** Paste content never runs as code with access to
   boh's origin, tokens or configuration.
6. **One provider interface.** The app knows nothing provider-specific beyond
   the `Provider` contract (section 5.1); adding a provider is one module.

## 3. Architecture

```
 Browser, https://<org>.github.io/boh/
┌─────────────────────────────────────────────────────────────────┐
│ index.html + main.js (app, origin O)                            │
│  ┌──────────┐  ┌───────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ views    │─►│ BinStore  │─►│ Provider    │─►│ AuthSession │  │
│  │ (bins,   │  │ (config,  │  │ gd | db | od│  │ (tokens per │  │
│  │ new,     │  │ cache)    │  └──────┬──────┘  │ provider)   │  │
│  │ viewer)  │  └───────────┘         │ fetch   └─────────────┘  │
│  └────┬─────┘                        ▼                          │
│       │ postMessage(bytes,      Drive / Dropbox / Graph APIs    │
│       │ renderer, options)                                      │
│  ┌────▼───────────────────────────────────────────┐             │
│  │ <iframe sandbox="allow-scripts" src=render.html>│ opaque     │
│  │  render.js: markdown, html, highlight           │ origin     │
│  │  ┌──────────────────────────────┐               │            │
│  │  │ <iframe sandbox srcdoc> doc  │ no scripts    │            │
│  │  └──────────────────────────────┘               │            │
│  └─────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

Runtime sequences:

**Owner, first time.** Open boh, press *Connect* on a provider, OAuth in a
popup (section 4.1). boh reads the account's config file (section 4.3); none
exists, so the bins list is empty. *Add bin*: pick an existing folder (Google
Picker; a folder browser over the API for Dropbox and OneDrive) or create a
new one; give it a name and a visibility label. boh reads the folder's real
sharing and shows it next to the label, warning on a mismatch (labelled public
but not shared publicly, labelled private but shared). The config file is
written.

**Owner, new paste.** Choose a bin, type or drop content, optionally a title
and format. boh derives the file name (section 4.5), uploads, then asks the
provider for a share reference suitable for the bin's visibility (section
4.4), and shows the boh link with *Copy*. The paste is added to the browser's
recent list.

**Recipient, open link.** boh parses the fragment (section 4.4), selects the
provider, and tries in order: (1) anonymous fetch if the reference allows it;
(2) the recipient's token if already signed in to that provider; (3) a
*Sign in to <provider>* prompt; (4) for Drive under `drive.file`, a *Grant
access* button that opens the Picker preset to that file; (5) a clear "no
access, ask the owner" page with *Open in <provider>*. Metadata (name, size,
MIME type) arrives first; boh picks the renderer (section 4.6), fetches the
bytes, and renders.

## 4. Core concepts

### 4.1 Accounts and authentication

One account per provider may be connected at a time; Drive, Dropbox and
OneDrive can be connected together. Each provider module owns its sign-in:

| Provider | Flow | Token lifetime | Scopes |
|---|---|---|---|
| Google Drive (`gd`) | OAuth implicit grant (`response_type=token`) in a popup, our own code | Access token ~1 h, no refresh token in the browser; the user signs in again | `drive.file`, `drive.appdata` |
| Dropbox (`db`) | Authorization code + PKCE, popup, `token_access_type=offline` | Short access token + refresh token | `files.metadata.read`, `files.content.read`, `files.content.write`, `sharing.read`, `sharing.write`, `account_info.read` (Full Dropbox app) |
| OneDrive (`od`) | Microsoft identity platform, SPA client, authorization code + PKCE, popup, `common` authority | Access token ~1 h, refresh token (SPA, 24 h rolling) | `Files.ReadWrite`, `Files.Read.All`, `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access` |

Sign-in and PKCE are small modules of our own (`web/src/oauth.ts`,
`web/src/pkce.ts`, Web Crypto), not Google Identity Services, MSAL or the
Dropbox SDK. The popup is opened on `about:blank` inside the click (popup
blockers), then sent to the authorization endpoint once the PKCE challenge is
computed.
Access tokens stay in memory. Refresh tokens are kept in `localStorage` only
when the user ticks *Stay signed in on this browser* (default on); otherwise
in `sessionStorage`. *Disconnect* revokes where the provider has a revoke
endpoint and clears everything stored for that account.

The OAuth redirect target is `auth.html`, a tiny page that posts the redirect's
parameters on the `BroadcastChannel` `boh-auth` and closes. Not
`window.opener`: the providers' cross-origin-opener policies sever it, and for
the same reason boh never trusts `popup.closed`; a sign-in waits at most 5
minutes or until cancelled. The answer is matched by `state`. A provider's
stored account survives an expired token, so the UI can say "sign in again"
rather than forget the bins. Client ids and the Google API key are public
build configuration (section 7.4).

### 4.2 Bins

A **bin** is a provider folder registered in boh:

| Field | Meaning |
|---|---|
| `id` | Random id, stable for the bin's life in the config |
| `name` | Display name chosen by the user |
| `folder` | Provider folder reference (Drive file id; Dropbox path plus namespace id; OneDrive drive id plus item id) |
| `visibility` | `public`, `members` or `private`: the user's intent; drives the share reference made for new pastes |
| `defaultFormat` | Optional format for new text pastes (e.g. `md`) |

The real sharing is read live (`Provider.describeSharing`) and only shown, never
stored as truth. A recipient who has write access to a group folder registers
the same folder as their own bin and can add pastes to it.

### 4.3 Configuration

Each connected account stores the bins of that account in one JSON file in
the provider's app-private area, so the config follows the user to any browser
after sign-in and each provider's bins live with that provider:

| Provider | Location |
|---|---|
| Drive | `appDataFolder/boh-config.json` |
| Dropbox | `/Apps/boh/boh-config.json` |
| OneDrive | `special/approot/boh-config.json` |

Schema (versioned, unknown fields preserved on write):
`{ "format": "boh-config", "version": 1, "bins": Bin[], "defaultBin": id | null }`.

The app shows the union of all connected accounts' bins. A copy of each file
is cached in `localStorage` (keyed by provider and account id) so the bins
list appears before the network answers. Writes are read-modify-write with the
provider's revision (Drive `version`/`modifiedTime`, Dropbox `rev`, Graph
`eTag`): on conflict boh re-reads, reapplies the single change, and retries
once, then reports the conflict. A file that fails to parse is never
overwritten; boh shows it read-only with *Reset*.

Browser-only conveniences, never synced: recent pastes (last 50 boh links
created or opened, with title and time), the last bin used, renderer
preferences, theme.

### 4.4 The boh link

```
https://<org>.github.io/boh/#v1/<provider>/<ref>[?r=<renderer>&n=<name>]
```

- Everything after `#` stays in the browser: it is never sent to GitHub Pages
  and, with `referrer: no-referrer`, never to other sites.
- `<provider>` is `gd`, `db` or `od`. `<ref>` is base64url of a small
  provider-specific value, opaque to the app:

| Provider | `ref` value (before base64url) | Anonymous fetch (if the file allows it) |
|---|---|---|
| Drive | `<file id>` or `<file id>/<resourceKey>` | `files.get?alt=media&key=<API key>` |
| Dropbox | the file's shared link URL, or `id:<file id>` (fallback, below) | `HEAD`/`GET` of the link on `dl.dropboxusercontent.com` (open question, plan step 1) |
| OneDrive | `u:<sharing URL>` (public) or `i:<driveId>/<itemId>` (members, private) | none: Graph needs a token, so every viewer signs in with any Microsoft account |

- `r` overrides the renderer; `n` is a display name used before metadata
  loads. Both are hints; the paste's metadata wins for security decisions.
- Unknown `v` values show "this link needs a newer boh".

Share reference per bin visibility, made right after upload:

| Visibility | Drive | Dropbox | OneDrive |
|---|---|---|---|
| `public` | none needed (the folder's "anyone with the link" permission is inherited) | shared link, audience `public` | sharing link, type `view`, scope `anonymous` |
| `members` | none needed (inherited folder permissions) | shared link, audience `no_one` (existing members only); `id:` ref when the account cannot set an audience (Dropbox Basic) | `i:` ref: the viewer's own token and permissions apply |
| `private` | none | as members | as members |

boh never sets a broader audience than the bin's visibility. If the provider
or the account policy refuses (e.g. work accounts with anonymous links
disabled), `share` throws `unsupported`: the paste stays uploaded and boh says
it could not make a link, with *Open in <provider>*. An existing Dropbox link
of the file is reused as it is (boh did not widen it).

### 4.5 Pastes and formats

A paste is one file in the bin's folder. File name:
`<slug(title)>.<ext>` or, without a title, `paste-<YYYYMMDD-HHMMSS>.<ext>`;
on a name clash the provider's auto-rename is used (never overwrite). Text is
stored as UTF-8 without BOM; uploads keep their bytes and name. The format is
determined, in order, from: the renderer hint chosen at creation (stored as
the extension), the file extension, the MIME type the provider reports, then
content sniffing (valid UTF-8 without NUL in the first 64 KiB means text).

Size limits: text renderers up to 5 MiB, highlighting off above 1 MiB; media
up to 200 MiB fetched to a blob; above that, *Download* only. A paste read
anonymously (with the site's API key, so on the site's quota) is read only up
to 25 MiB (`ANONYMOUS_MAX_BYTES`); above that, and while that read is
rate-limited, the viewer offers *Open in <provider>* and no *Download*. Upload limit is
the provider's simple-upload limit unless the plan adds resumable upload.

### 4.6 Renderers

| Renderer | Formats | Where it runs | Notes |
|---|---|---|---|
| `text` | `txt`, `log`, `csv`, `json`, code extensions | render frame | Line numbers, wrap toggle, highlight.js with the language from the extension; *Copy* |
| `markdown` | `md`, `markdown` | render frame | marked (GFM) then DOMPurify; code blocks highlighted |
| `html` | `html`, `htm` | nested `srcdoc` frame in the render frame | DOMPurify whole-document, then `sandbox=""` (no scripts, no forms, no top navigation) |
| `image` | png, jpg, gif, webp, avif, svg | app | Blob URL in `<img>` (SVG as image cannot run script); fit / 100% toggle |
| `audio` | mp3, ogg, opus, wav, flac, m4a | app | `<audio controls>` |
| `video` | mp4, webm | app | `<video controls>` |
| `pdf` | pdf | app | Blob URL in an `<iframe>` (browser viewer); fallback *Download* |
| `download` | anything else | app | Name, size, type, *Download* |

The app picks every blob's MIME type from the renderer and extension
(`blobType`), never from the provider, so no paste becomes `text/html` on the
app's origin; SVG images use a `data:` URL, not a `blob:` one, so an SVG
opened on its own tab cannot run on boh's origin either. A file of unknown type
up to 5 MiB that looks like UTF-8 text is shown as text.

Text, Markdown and HTML can be switched among one another (*Show as*, e.g.
Markdown source as `text`). Remote resources (images, styles, fonts) in Markdown and HTML are
**blocked by default** (DOMPurify hook rewrites their URLs to a placeholder)
and loaded only after the viewer presses *Load remote content*, because
loading them tells third parties that someone opened the paste. Links open in
a new tab with `rel=noopener noreferrer`.

In the render frame every text, Markdown or HTML paste becomes one sanitized
document shown in a nested `srcdoc` frame sandboxed with `allow-same-origin
allow-popups allow-popups-to-escape-sandbox` and **no** `allow-scripts`
(`allow-same-origin` only shares the render frame's own opaque origin, which
lets the frame count blocked resources). The document carries its own
`<meta>` policy: without *Load remote content* it allows only `data:` images,
fonts and media and inline styles, which also stops CSS `url()` that the
sanitizer cannot see; with it, `https:` as well. Highlighting, Markdown and
sanitizing live in `render.js` only, so the app bundle stays small. The render
frame has a fixed height in the app and scrolls inside.

## 5. Public contracts

### 5.1 `Provider` (web/src/providers/provider.ts)

Every provider module exports a factory (`createDriveProvider(env, picker?)`,
`createDropboxProvider(env)`, `createOneDriveProvider(env)`) returning:

| Member | Contract |
|---|---|
| `id: 'gd' \| 'db' \| 'od'`, `label` | Stable code used in links and config |
| `configured`, `maxUploadBytes` | Whether the build has a client id; the largest upload |
| `signIn({ stay, signal? }): Promise<Account>` | Opens the popup synchronously (call it from the click); rejects `AuthError` (`cancelled`, `popup_blocked`, `denied`, `expired`, `failed`) or `ProviderError('not_configured')` |
| `signOut(): Promise<void>` | Revokes when possible, clears stored tokens; never throws |
| `account(): Account \| null`, `setStay(stay)` | `{ id, name, email? }` of the connected account; move the tokens between `localStorage` and `sessionStorage` |
| `readConfig(): { text, rev }` / `writeConfig(text, rev)` | Section 4.3; `rev` `null` means "must not exist"; rejects `ConflictError` on a revision mismatch |
| `pickFolder?()` | Drive only: Google's Picker; `null` when cancelled |
| `listFolders?(parent \| null)` | Dropbox and OneDrive: folders for boh's browser (top level includes folders shared with the user) |
| `createFolder(name, parent?)` | New folder; returns `FolderRef` |
| `describeSharing(folder): Promise<Sharing>` | `{ kind: 'public' \| 'members' \| 'private' \| 'unknown', members?, manageUrl? }` |
| `list(folder, cursor?)` | `{ items: PasteMeta[], cursor? }`, newest first where the API allows |
| `upload(folder, name, blob)` | `PasteMeta`; never overwrites (the provider's auto-rename) |
| `share(meta, visibility)` | The link `ref` (section 4.4); `unsupported` when refused |
| `remove(meta)` | Deletes (to the provider's trash where it has one) |
| `openRef(ref): Promise<PasteMeta>` | Metadata of a linked paste; anonymous first, then with the viewer's token |
| `grantAccess?(ref): Promise<boolean>` | Drive only: the Picker preset to the file |
| `fetch(meta, { maxBytes, signal })` | `Blob`; rejects `TooLargeError` above `maxBytes`, checked before and while downloading |
| `folderUrl(folder)` | The folder in the provider's UI (`PasteMeta.webUrl` for files) |

Errors are `Error` subclasses with a stable `reason` (`web/src/errors.ts`):
`ProviderError` with `not_found`, `forbidden`, `needs_sign_in`, `needs_grant`,
`rate_limited`, `network`, `unsupported`, `not_configured`, `failed`;
`ConflictError` (`conflict`), `TooLargeError` (`too_large`), `AuthError`,
`LinkError` (`invalid_link`), `ConfigFileError` (`bad_config`,
`newer_config`). The app maps `needs_sign_in` and `needs_grant` to the steps of
the recipient sequence; it never parses provider messages. An anonymous 403/404
becomes `needs_sign_in` when the viewer is signed out; a signed-in Drive 403/404
becomes `needs_grant` (under `drive.file` the file is invisible until picked),
and still `needs_grant` after the Picker means no access.

`env` (`ProviderEnv`) carries the build configuration (endpoints, client ids,
API key), `fetch`, the token store, `openPopup` and the redirect URI, and a
clock, so tests replace each with fakes (section 7.3).

### 5.2 Render frame protocol

`web/src/render/protocol.ts`. The frame posts `{ type: 'ready' }` when loaded.
The app posts `{ type: 'render', id, renderer: 'text' | 'markdown' | 'html',
name, bytes: ArrayBuffer, options: { remote, wrap, highlight, language } }`,
transferring the buffer (with target origin `*`: the frame's origin is opaque
and only the paste's own bytes are sent). The frame answers `{ type:
'rendered', id, blocked }` (remote resources left out) or `{ type: 'error',
id, reason }`; the app waits at most 15 s. Links in a paste open in a new tab
by themselves (`target=_blank`, popups escape the sandbox), so there is no
`open` message. The app accepts messages only from that frame's
`contentWindow`; the frame accepts only from `parent`.

## 6. Design decisions

| Decision | Rejected | Why |
|---|---|---|
| Drive `drive.file` + Picker | `drive.readonly` / `drive` | Restricted scopes need Google's yearly paid security assessment to publish; with `drive.file`, recipients of members-only pastes press *Grant access* once per paste (or per folder, if the Picker grant covers folders: plan step 1) |
| Config per account, in that account | One primary account holds all config | No "which account is primary" choice; signing in to a provider brings its bins; disconnecting one provider leaves the others intact |
| Config in the cloud, cached locally | Browser only | Follows the user to other devices with no boh server |
| boh link through boh, fragment-based | Sharing the provider's own link | One link format, a chosen renderer, an anonymous path where possible; the provider's link is still one click away (*Open in provider*) |
| Our own OAuth popup and PKCE, no SDKs | Google Identity Services, MSAL.js, Dropbox SDK, gapi client | Small, auditable, one flow for three providers, testable end to end against fakes; only Google's Picker script is external (required by Google) |
| Sign-in answer over `BroadcastChannel` | `window.opener.postMessage`, polling `popup.closed` | Cross-origin-opener policies on the providers' pages cut the opener and make `closed` lie |
| OneDrive members links by drive and item id | A Graph "existing access" link | Graph has no such link type for personal accounts; the id works with the viewer's own permissions everywhere |
| Dropbox `id:` ref when `no_one` links are refused | Making a public link instead | Never widen access (goal 2); members open the file by id with their own token |
| Render frame from `render.html` with `sandbox="allow-scripts"`, no `allow-same-origin`; the paste in a nested script-less `srcdoc` frame with its own `<meta>` policy | Rendering in the app's DOM; one `srcdoc` frame | The frame has an opaque origin, so even a sanitizer bypass cannot read tokens or config; it needs scripts for its own renderer, so it is a real page with its own CSP rather than a `srcdoc` that would inherit the app's. The nested document runs nothing and switches remote loading per paste, which a page-wide CSP cannot |
| Drive settings conflict check reads the version, then writes | Conditional write | Drive v3 has no conditional update; the window is milliseconds and a lost update is still caught on the next write by the other device |
| Bundled libraries' licenses in `third-party-licenses.txt` | Keeping their legal comments in `render.js` | One readable file, linked from the footer |
| Anonymous reads capped at 25 MiB, larger public pastes sent to the provider's viewer | Streaming any public paste through the site's key | The project's quota is shared by every public paste; Drive's terms forbid using it as a CDN or for broad video distribution |
| Client ids as repository variables, the config file's fields empty | Committing the ids | They are public anyway, but a fork should not inherit ids that are tied to this site |
| Google Drive only on the site; Dropbox and OneDrive switched off at build time, not deleted | Shipping all three; deleting the two | Drive is the only service free at scale (Dropbox needs production review past 50 users, Microsoft an Entra tenant); the code stays tested so switching one on is a configuration change |
| HTML pastes sanitized and script-free | Running paste scripts in a sandbox | A pastebin shows content; running it invites phishing pages on our origin's name. Can be revisited behind an explicit button |
| Remote content blocked until asked | Always load | Remote images in a paste are a read receipt to their host |
| Visibility label stored, sharing read live | Storing sharing state | The provider is the authority (goal 2); sharing changes outside boh |
| boh does not edit folder sharing | Creating public folders, inviting members | Each provider's sharing model differs and its own UI handles groups, domains and warnings better; boh links to it (`manageUrl`) |
| Never overwrite on upload | Upsert by name | A paste link must keep pointing at what was shared |
| Runtime dependencies highlight.js, marked, DOMPurify (render frame only) | Writing our own | Correctness and security of parsing and sanitizing; justified exception to "no runtime dependencies", bundled, pinned by `package-lock.json` |

## 7. Constraints and invariants

### 7.1 Security

1. The app's CSP: `default-src 'none'`; `script-src 'self'
   https://apis.google.com` (Picker); `connect-src` the provider API origins of
   the build configuration plus OneDrive's download hosts; `frame-src 'self'
   blob: https://docs.google.com` (render frame, PDF, Picker); `img-src 'self'
   blob: data:`; `media-src blob:`; `style-src 'self' 'unsafe-inline'`;
   `base-uri 'none'`; `form-action 'none'`. `scripts/csp.mjs` derives every
   page's policy from the configuration; `build-web` writes it into the page
   and unit tests check it.
2. `render.html` CSP: `script-src 'self'`; no `connect-src`; `img-src`,
   `style-src`, `font-src` and `media-src` allow `https:` as the outer fence;
   the nested document's own policy and the sanitizer hook block remote
   resources until the viewer asks (section 4.6).
3. Tokens and config never enter the render frame; only the paste bytes do.
4. Paste content never becomes HTML in the app's document; the app inserts
   names and metadata as text only.
5. The fragment is parsed strictly; an invalid link shows an error, never a
   partial fetch.

### 7.2 Behavior

1. No polling: listings refresh on user action and after the app's own writes.
2. Every network call has an `AbortSignal` and a timeout; navigation away
   aborts in-flight fetches.
3. Provider rate limits (`429`, `Retry-After`) are honored with bounded
   backoff (3 tries), then surfaced as `rate_limited`.
4. Works on current Chrome, Firefox, Safari and Edge, desktop and mobile;
   popups are opened from the user's click so they are not blocked.
5. Accessible: keyboard reachable, labelled controls, renderer output in a
   titled frame.

### 7.3 Testing

Providers are tested against loopback fakes of the endpoints they use
(`tests/support/fake-drive.ts`, `fake-dropbox.ts`, `fake-graph.ts`), injected
through `env`; no test reaches the internet. The fakes implement the sign-in
too (implicit grant; code with PKCE verification and refresh tokens), so the
real popup flow runs: in Node a stand-in window follows the redirect and posts
on the channel, in Chrome the real `auth.html` does. Browser tests use a build
of the site whose endpoints point at the fakes and whose Google Picker is a
prompt-based stand-in (`tests/support/app-harness.ts`). Security tests check
that a hostile HTML, Markdown or SVG paste does not run script, that the render
frame's origin is opaque, and that remote URLs load only when asked.

### 7.4 Build configuration

`providers` lists the providers a build offers (default `["gd"]`; unknown codes
fail the build). esbuild gets one boolean constant per provider (`__BOH_GD__`,
`__BOH_DB__`, `__BOH_OD__`), so `main.ts` replaces a provider that is off with
`createDisabledProvider` (`web/src/providers/disabled.ts`: not configured,
every call `not_configured`) and its module is tree-shaken out of `main.js`;
`appCsp` leaves its hosts out (`connect-src 'none'` when none is on). The
viewer answers a link to a provider that is off with "this boh site does not
support it", without a sign-in button.

Client ids (Google, Dropbox, Microsoft), the Google API key and the Google
Cloud project number (the Picker's app id) are public (they ship in
`main.js`) but kept out of the repository: `web/boh.config.json` has empty
fields, and `BOH_GOOGLE_CLIENT_ID`, `BOH_GOOGLE_API_KEY`, `BOH_GOOGLE_APP_ID`,
`BOH_DROPBOX_APP_KEY` and `BOH_MS_CLIENT_ID` set them at build time (the Pages
workflow passes repository variables). Anyone can run their own copy with their
own project ("bring your own keys", `docs/providers.md`). A provider
without an id is shown as not configured. `scripts/config.mjs` resolves the
configuration, which esbuild injects as `__BOH_CONFIG__`; the tests override
every endpoint with loopback fakes and swap the Picker for a prompt-based
stand-in (`google.testPicker`). The Google API key is restricted in the Google
console to the Drive and Picker APIs and to the site's referrers.

## 8. Integration boundaries

- **Providers' apps** (registered by Binary Dice Games, outside the repo):
  Google Cloud project with Drive API and Picker API, OAuth consent screen
  (needs a privacy policy page and a verified domain: the `github.io` project
  site may need the org's user site or a custom domain to verify), Dropbox app
  (Full Dropbox, production approval for more than 500 users), Microsoft Entra
  app (SPA platform, personal and work accounts). Redirect URIs: the Pages
  `auth.html` and `http://localhost:<port>/auth.html` for development.
- **Site build** (`scripts/build-web.mjs`, `scripts/build-site.mjs`,
  `scripts/smoke-site.mjs`): entries `auth.html`, `render.html`,
  `privacy.html`, `app.css`, `third-party-licenses.txt`; config and CSP
  injection; the smoke test checks they are served.
- **Docs**: `docs/using-boh.md` (bins, links, renderers), `docs/providers.md`
  (registering the provider apps, scopes, limits), `docs/privacy.md`,
  `docs/manual-testing.md`.
- Nothing depends on boh; the config file format and the link format are its
  external contracts and are versioned.
