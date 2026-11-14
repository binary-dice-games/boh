# boh — Provider apps

boh talks to each cloud service as an OAuth **public client**: the browser holds
the tokens and there is no client secret anywhere. Binary Dice Games registers
one app per service and puts its public id in `web/boh.config.json` (or in the
repository variables, see [publishing.md](publishing.md)). A service without an
id is not offered by the page.

Redirect URI for every app: the deployed `auth.html`, e.g.
`https://binary-dice-games.github.io/boh/auth.html`, plus
`http://localhost:<port>/auth.html` for development.

## Google Drive

1. In Google Cloud Console, create a project and enable the **Google Drive
   API** and the **Google Picker API**.
2. **OAuth consent screen**: external, with the scopes
   `https://www.googleapis.com/auth/drive.file` and
   `https://www.googleapis.com/auth/drive.appdata` (both non-restricted, so no
   security assessment). Publishing needs the privacy policy URL (`privacy.html`
   on the site) and a verified domain; a `github.io` project site may need the
   organization's user site or a custom domain to verify (spec step 1 (e)).
3. **Credentials**:
   - an OAuth client of type *Web application* with the site's origin as an
     authorized JavaScript origin and `auth.html` as a redirect URI:
     `google.clientId`;
   - an API key restricted to the Drive and Picker APIs and to the site's HTTP
     referrers: `google.apiKey` (it lets boh read public pastes without a
     sign-in);
   - the project **number** (not id): `google.appId`, needed by the Picker to
     grant `drive.file` access.

boh signs in with OAuth's implicit grant in a popup (Google gives browsers no
refresh token), so a Google sign-in lasts about an hour.

## Dropbox

1. In the Dropbox App Console, create an app with **Scoped access** and **Full
   Dropbox** (so folders others share with the user can be bins).
2. Permissions: `account_info.read`, `files.metadata.read`,
   `files.content.read`, `files.content.write`, `sharing.read`,
   `sharing.write`.
3. Settings: add the redirect URIs; allow public clients (PKCE); the **App
   key** is `dropbox.appKey`. More than 500 users needs production approval.

boh stores its settings in `/Apps/boh/boh-config.json`.

## OneDrive (Microsoft)

1. In Microsoft Entra ID, register an application for **personal Microsoft
   accounts and accounts in any organizational directory**.
2. Platform: **Single-page application**, with the redirect URIs.
3. API permissions (delegated, Microsoft Graph): `Files.ReadWrite`,
   `Files.Read.All`, `Files.ReadWrite.AppFolder`, `User.Read`,
   `offline_access`. Work accounts may need an administrator's consent for
   `Files.Read.All`.
4. The **Application (client) ID** is `microsoft.clientId`.

Graph has no anonymous read, so viewers of OneDrive pastes sign in with any
Microsoft account. Organizations may forbid anonymous links; boh then says the
link only works for people with access.

## Limits

| Service | Largest upload | Notes |
|---|---|---|
| Google Drive | 200 MiB | Resumable upload above 5 MiB |
| Dropbox | 150 MiB | Single upload call |
| OneDrive | 200 MiB | Simple upload |

All three retry rate-limited calls (HTTP 429/503) at most three times.
