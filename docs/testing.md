# boh — Testing

How to run the automated tests and what each covers. For setting up the
toolchain see [building.md](building.md).

## Running

```
ctest --test-dir build -C Debug --output-on-failure --parallel
ctest --test-dir build -C Debug -R site_build   # one test by name
ctest --test-dir build -C Debug -L e2e          # only browser tests (label: e2e or unit)
npm test                                        # all unit tests, with Vitest directly
npm run test:e2e                                # all browser tests
```

The tests build the site themselves into a temporary directory, so you do not
need to build first. They serve it from a loopback HTTP server on a free port,
the way GitHub Pages serves a project site (under `/boh/`, unknown paths get
`404.html`); they never use the network.

The providers are tested against loopback fakes of the endpoints boh calls
(`tests/support/fake-drive.ts`, `fake-dropbox.ts`, `fake-graph.ts`): sign-in
(including PKCE and refresh tokens), files, sharing and links. The browser tests
build the site with every endpoint pointing at the fakes and with a stand-in for
Google's Picker that asks through `window.prompt`; the real sign-in windows and
picker are checked by hand ([manual-testing.md](manual-testing.md)).

## What each test covers

| ctest name | File | What it checks |
|---|---|---|
| `site_build` | `tests/unit/site-build.test.ts` | The Pages site: its files, the version and base path filled in, the smoke check, base path validation |
| `links` | `tests/unit/links.test.ts` | boh link format and parsing, rejected links |
| `formats` | `tests/unit/formats.test.ts` | Renderer choice, blob types, file names, sizes |
| `crypto_utils` | `tests/unit/crypto-utils.test.ts` | base64url, PKCE (RFC 7636 vector) |
| `http` | `tests/unit/http.test.ts` | Retries, timeouts, aborts, status mapping, size limits |
| `csp` | `tests/unit/csp.test.ts` | Build configuration, page policies, render frame rules |
| `bin_store` | `tests/unit/bin-store.test.ts` | Cache first, conflict retry, broken files, unknown fields |
| `local_state` | `tests/unit/local-state.test.ts` | Recent pastes, preferences, storage that throws, tokens |
| `google_drive` | `tests/unit/google-drive.test.ts` | Drive provider against the fake: sign-in, config, bins, links, grant, limits |
| `dropbox` | `tests/unit/dropbox.test.ts` | Dropbox provider: PKCE and refresh, config, folders, shared links, fallbacks |
| `onedrive` | `tests/unit/onedrive.test.ts` | OneDrive provider: PKCE and rotation, app folder, shared folders, links |
| `site` | `tests/e2e/site.test.ts` | The site in Chrome: the page loads without errors, an unknown path gives the 404 page, which links home |
| `render` | `tests/e2e/render.test.ts` | Every renderer; hostile HTML/SVG runs nothing, the frame's origin is opaque, remote content waits |
| `app_drive` | `tests/e2e/app-drive.test.ts` | The whole cycle with Drive: connect, bins, upload, public and members links, grant, delete |
| `app_dropbox` | `tests/e2e/app-dropbox.test.ts` | Dropbox: folder browser, public and members links, reload, delete |
| `app_onedrive` | `tests/e2e/app-onedrive.test.ts` | OneDrive: shared folder bin, image paste, sign-in to view, config on another browser |

## Writing a test

Put the file in `tests/unit/` or `tests/e2e/` and register it in
`tests/CMakeLists.txt` with `boh_add_test(<name> <file> [PROJECT e2e])`. See
"Testing Style" in [CLAUDE.md](../CLAUDE.md).
