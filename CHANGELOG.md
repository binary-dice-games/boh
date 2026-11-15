# Changelog

All notable user-facing changes to boh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The site is configured with the Binary Dice Games Google app, so Google
  Drive sign-in works on the published site.
- Project scaffolding: an empty page, the GitHub Pages site build and deploy.
- Google Drive accounts: sign-in in a popup, optionally kept on the browser.
  Dropbox and OneDrive support is built but switched off on the site.
- Bins: register, create, edit and remove cloud folders with a visibility
  (public, members, private); the folder's real sharing is shown with a warning
  on a mismatch. The list of bins is stored in each account's app area.
- Pastes: upload text (with a format), a file, or a clipboard image to a bin;
  list, link, open in the service and delete a bin's pastes.
- boh links (`#v1/<provider>/<ref>`) that open public pastes without signing in
  where the service allows, and ask for a sign-in or Drive's picker otherwise.
- Viewer with text (line numbers, highlighting, wrapping), Markdown, HTML,
  image, audio, video, PDF and download renderers, in a sandboxed frame; remote
  content in a paste loads only on request.
- Recent pastes of this browser.
- Privacy policy and third-party licenses pages.
- Tags on Google Drive pastes: add and remove them when uploading, in the
  viewer, and in bulk from the library; everyone who can open a paste sees them.
- Automatic tags: `format:`, `kind:` and `lang:` tags from each paste's name
  and type, bin default tags, and tag rules (by bin, format, kind or name
  pattern) that preselect tags at upload or are applied to existing pastes.
- Library (`#library`): all pastes of your own and shared bins, with search by
  name and tag (`#tag`, `-#tag`, `format:md`, `bin:`, `from:others`, ...), tag
  facets with counts, and bulk add, remove, rename and apply-rules.
- Shared bins: add a Google Drive folder someone shared with you, or open a
  bin link (`#v1/bin/gd/<ref>`) its owner sent; readers see tags, writers can
  edit them.
- The boh icon beside the name at the top of the page and as the page's icon.
