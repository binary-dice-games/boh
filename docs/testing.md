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

## What each test covers

| ctest name | File | What it checks |
|---|---|---|
| `site_build` | `tests/unit/site-build.test.ts` | The Pages site: its files, the version and base path filled in, the smoke check, base path validation |
| `site` | `tests/e2e/site.test.ts` | The site in Chrome: the page loads without errors, an unknown path gives the 404 page, which links home |

## Writing a test

Put the file in `tests/unit/` or `tests/e2e/` and register it in
`tests/CMakeLists.txt` with `boh_add_test(<name> <file> [PROJECT e2e])`. See
"Testing Style" in [CLAUDE.md](../CLAUDE.md).
