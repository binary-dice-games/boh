# boh

boh is a static web page, published on GitHub Pages. The implementation has
not started yet: the repository holds the build, test and publishing
scaffolding, set up like [inksplat](https://github.com/binary-dice-games/inksplat).

## Quick Build

```sh
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target site         # the whole Pages site in site/
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. See
[docs/building.md](docs/building.md).

## Project Layout

| Path | Contents |
|------|----------|
| `web/src/` | The page (`index.html`, `main.ts`) |
| `web/src/site/` | Static pages of the site: 404 |
| `scripts/` | Build scripts: `build-web`, `build-site`, `smoke-site` |
| `tests/` | Unit tests, Chrome tests, helpers |
| `cmake/` | CMake modules |
| `docs/` | Documentation |
| `spec/` | Design and plan documents, one folder per project |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/testing.md](docs/testing.md) | Running the tests and what each covers |
| [docs/publishing.md](docs/publishing.md) | Publishing the Pages site |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |
| [CLAUDE.md](CLAUDE.md) | Coding style and project rules for agents and contributors |

## License

MIT License © 2026 Binary Dice Games. See [LICENSE](LICENSE).
