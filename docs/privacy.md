# boh — Privacy

The privacy policy users see is `web/src/site/privacy.html`, published as
`privacy.html` and linked from the page footer and from each provider app's
consent screen. Keep it in step with what the code does.

The site offers Google Drive only; the policy says so. Switching on Dropbox or
OneDrive needs the policy updated first.

In short: boh has no server; it reads and writes only the folders the user
registers as bins, the files they open, and one settings file in each service's
app area (bins and tag rules). Tags are private file properties of boh on each
paste's file. Tokens, a copy of the settings, recent pastes, the library's list
of paste names and tags (IndexedDB, at most 30 days) and preferences stay in the
browser; disconnecting deletes them. No analytics. Remote images inside a paste load only on request.
