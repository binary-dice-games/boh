# boh

boh (bin of holding) is a pastebin without a paste server. Pastes live in
folders of your own Google Drive; boh is a static page on GitHub Pages that
uploads them, makes links to them and shows them. Dropbox and OneDrive are
implemented too but switched off on the site (see
[docs/providers.md](docs/providers.md)).

- **Bins are your folders:** register folders as bins, each public, members-only
  or private. Who can read a paste is whatever the folder's sharing in the
  service says; boh never widens it.
- **Paste anything:** text in a choice of formats, a dropped file, or an image
  from the clipboard. Each paste is an ordinary file.
- **Links that open in boh:** public pastes open without signing in; others ask
  the viewer to sign in with their own Google account.
- **Renderers:** highlighted text, Markdown, HTML, images, audio, video, PDF.
  Text, Markdown and HTML render in a sandboxed frame with no access to boh;
  nothing in a paste runs, and remote pictures load only on request.
- **Tags and a library:** tag pastes by hand or with rules, see automatic
  `format:` and `kind:` tags, and search and filter every bin, your own and
  those shared with you, by tag and name.
- **No server, no tracking:** your list of bins is a small file in each
  service's private app area; everything else stays in your browser.

See [docs/using-boh.md](docs/using-boh.md).

## Quick Start

1. Open the site and press **Connect Google Drive**.
2. **Add bin**: pick or create a folder and choose its visibility.
3. Type, paste or drop something, press **Upload**, and send the link.

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
| `web/boh.config.json` | Enabled providers and the public client ids of their apps |
| `web/src/` | The app (`index.html`, `main.ts`) and its core modules |
| `web/src/providers/` | Google Drive (on), Dropbox and OneDrive (off) behind one `Provider` contract |
| `web/src/render/` | The sandboxed render frame (`render.html`) |
| `web/src/ui/` | The app's views |
| `web/src/site/` | Static pages of the site: privacy policy, 404 |
| `scripts/` | Build scripts: `build-web`, `build-site`, `smoke-site`, `config`, `csp` |
| `tests/` | Unit tests, Chrome tests, fakes of the three services |
| `cmake/` | CMake modules |
| `docs/` | Documentation |
| `spec/` | Design and plan documents, one folder per project |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/using-boh.md](docs/using-boh.md) | Bins, visibility, pastes, links and renderers |
| [docs/building.md](docs/building.md) | Prerequisites, build configuration, build, check and test |
| [docs/providers.md](docs/providers.md) | Enabled providers; registering the Google, Dropbox and Microsoft apps; scopes, limits and costs |
| [docs/testing.md](docs/testing.md) | Running the tests and what each covers |
| [docs/manual-testing.md](docs/manual-testing.md) | Checks with real accounts |
| [docs/publishing.md](docs/publishing.md) | Publishing the Pages site |
| [docs/privacy.md](docs/privacy.md) | Where the privacy policy lives, in short |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |
| [CLAUDE.md](CLAUDE.md) | Coding style and project rules for agents and contributors |

## License

MIT License © 2026 Binary Dice Games. See [LICENSE](LICENSE).
