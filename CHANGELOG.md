# Changelog

All notable user-facing changes to boh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding: an empty page, the GitHub Pages site build and deploy.
- Google Drive, Dropbox and OneDrive accounts: sign-in in a popup, optionally
  kept on the browser.
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
