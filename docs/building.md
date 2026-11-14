# boh — Building

boh is TypeScript/JavaScript. CMake is the entry point and calls npm.
It runs on **Linux, macOS and Windows**.

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 | with npm |
| CMake | 3.14 | entry point for check and test |
| Google Chrome | recent | the browser tests in `tests/e2e/` |

Configuring runs `npm ci` (or `npm install` without a lock file) when
`node_modules/` is missing or `package-lock.json` is newer than what was installed (after a pull
or a branch switch that changed the dependencies).

## Build, check and test

```
cmake -S . -B build
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target web          # the page in web/dist
cmake --build build --target site         # the whole Pages site in site/
ctest --test-dir build -C Debug --output-on-failure --parallel
```

`-C Debug` matters with multi-config generators (Visual Studio, Xcode).

Without CMake, from the repository root:

```
npm run check          # eslint, tsc, prettier --check
npm run format         # prettier --write
npm run build:web      # web/dist (the page)
npm run build:site     # site/ (the app, render frame, sign-in page, privacy, 404)
npm test               # unit tests (Vitest, project "unit")
npm run test:e2e       # browser tests (project "e2e"), needs Chrome
```

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `BOH_BUILD_TESTS` | ON when top level | Register the tests with ctest |

| Environment variable | Meaning |
|----------------------|---------|
| `BOH_CHROME` | Path of the Chrome executable for the browser tests (otherwise standard install paths, then Playwright's `chrome` channel) |
| `BOH_GOOGLE_CLIENT_ID`, `BOH_GOOGLE_API_KEY`, `BOH_GOOGLE_APP_ID` | Google OAuth client id, API key and Cloud project number, over `web/boh.config.json` |
| `BOH_DROPBOX_APP_KEY` | Dropbox app key, over `web/boh.config.json` |
| `BOH_MS_CLIENT_ID` | Microsoft application (client) id, over `web/boh.config.json` |

## Build configuration

`web/boh.config.json` lists the providers the page offers (`providers`, default
`["gd"]`, see [providers.md](providers.md)) and the public ids of their apps; the
`BOH_*` variables above override the ids for a fork or a development build. A
provider that is off is not bundled; one without an id is shown as not
configured. Nothing in the configuration is secret: it ships in `main.js`.

`scripts/config.mjs` merges the file, the environment and the overrides the
tests pass (which point every endpoint at a loopback fake), and
`scripts/csp.mjs` derives each page's Content-Security-Policy from it.

To try the real services locally, register `http://localhost:<port>/auth.html`
as a redirect URI of each app, build with `npm run build:site`, and serve
`site/` on that port with any static file server.

## Layout

| Path | Contents |
|------|----------|
| `web/boh.config.json` | Enabled providers and the public client ids of their apps |
| `web/src/` | The app: `index.html` + `main.ts`, `app.css`, the core modules (links, formats, bins, HTTP, OAuth) |
| `web/src/providers/` | The provider contract and Google Drive, Dropbox and OneDrive |
| `web/src/render/` | The render frame (`render.html` + `frame.ts`, bundled into `render.js`) |
| `web/src/ui/` | The app's views |
| `web/src/site/` | Pages of the site that are not the app: `404.html`, `privacy.html` |
| `scripts/` | Build scripts: `build-web`, `build-site`, `smoke-site`, `config`, `csp` |
| `tests/unit/` | Vitest tests run in Node |
| `tests/e2e/` | Chrome tests (Playwright) |
| `tests/support/` | Fakes of the three providers, the app harness, browser launcher, loopback site server, `until` |
