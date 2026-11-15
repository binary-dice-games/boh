# boh — Manual testing

The automated tests use fakes of the three services. These checks need real
accounts and the real provider apps ([providers.md](providers.md)); record the
date, browser and result when you run them. Checks 5 to 9 are needed only
before Dropbox or OneDrive is switched on. Spec step 1 of
`spec/01_core_features/PLAN.md` starts here; checks 12 to 16 are step 1 of
`spec/02_tags_and_shared_bins/PLAN.md`.

| # | Check | Result |
|---|---|---|
| 1 | Google sign-in popup completes and closes on Chrome, Firefox, Safari | open |
| 2 | Picker: choosing a folder lets boh list and upload; files **others** add to it are listed (folder grant covers children?) | open |
| 3 | Drive public paste opens signed out (API key, CORS) | open |
| 4 | Drive members paste: a member signs in, picks the file in the Picker, it opens | open |
| 5 | Dropbox PKCE sign-in, refresh after 4 hours | open |
| 6 | Dropbox public link opens signed out (raw download CORS from the browser) | open |
| 7 | Dropbox members link (`no_one`) opens for a shared-folder member; Basic account fallback to the file id | open |
| 8 | OneDrive personal account: sign-in, app folder, anonymous link opened by another account | open |
| 9 | OneDrive work account: consent for `Files.Read.All`, organization link policies | open |
| 10 | Each service: the folder's sharing shown in the bin list matches the service's UI | open |
| 11 | Mobile Safari and Chrome on Android: sign-in popups, paste upload from the clipboard | open |
| 12 | Drive tags: keys `t.<base64url>` accepted; 30 properties and 124 bytes enforced; another boh user who can read the file sees the tags | open |
| 13 | Drive tags: a writer (not the owner) of a shared folder can change a paste's tags; a reader gets 403 | open |
| 14 | Picker "Shared with me" and shared-drives views list folders shared with the user; a picked shared folder lists the owner's pastes (else shared bins show only opened pastes) | open |
| 15 | Bin link: a member opens it, grants the folder in the Picker, adds the bin; someone outside the folder is refused | open |
| 16 | Dropbox file properties and OneDrive per-app metadata: readable by other members? (decides tags there) | open |
