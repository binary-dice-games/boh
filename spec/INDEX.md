# Specification index

One row per project. Add a row when you create a project folder; update
the status and topics as it progresses. See "spec/" in `CLAUDE.md`.

| Project | Status | Summary | Topics |
|---|---|---|---|
| [01_core_features](01_core_features/) | Implemented against fakes, site offers Google Drive only; Google app and real-account checks (steps 1, 2) open | Product definition and architecture: bins in the user's Google Drive (Dropbox and OneDrive built, switched off), config in each account's app data, boh links, sandboxed renderers. | architecture, providers, OAuth, config, links, renderers, security, testing |
| [02_tags_and_shared_bins](02_tags_and_shared_bins/) | Implemented against fakes for Google Drive; real-account checks (step 1) open, Dropbox and OneDrive without manual tags or bin links | Manual tags stored on the paste's file (Drive `appProperties`), derived tags (format, kind, language) and upload rules, a library that searches and filters pastes by tag across own and shared bins, and bin links. | tags, search, library, shared bins, links, providers, config |
