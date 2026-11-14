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
npm run build:site     # site/ (the page, 404)
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

## Layout

| Path | Contents |
|------|----------|
| `web/src/` | The page: `index.html` and its script `main.ts` (bundled by esbuild into `main.js`) |
| `web/src/site/` | Pages of the site that are not the app: `404.html` |
| `scripts/` | Build scripts: `build-web`, `build-site`, `smoke-site` |
| `tests/unit/` | Vitest tests run in Node |
| `tests/e2e/` | Chrome tests (Playwright) |
| `tests/support/` | Browser launcher, loopback site server, `until` |
