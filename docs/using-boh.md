# boh — Using boh

## Connect and add bins

1. Press **Connect Google Drive** and sign in in the window that opens.
   **Stay signed in on this browser** keeps the sign-in after the tab is
   closed. (Builds that switch on Dropbox or OneDrive show a button for each;
   several services can be connected at once.)
2. Press **Add bin**. A bin is a folder in your cloud storage:
   - Google Drive: **Choose a folder in Google Drive** opens Google's picker
     (boh only sees what you pick there and what it created itself).
   - Dropbox and OneDrive: browse to a folder (folders shared with you are
     listed too) and press **Use**.
   - Or type a name and press **Create folder**.
3. boh shows the folder's real sharing. Choose the bin's **visibility**:
   - **Public**: anyone with a link can open its pastes.
   - **Members**: only people the folder is shared with.
   - **Private**: only you.

   Visibility decides which links boh makes; it never changes the folder's
   sharing. To share a folder with a group or publicly, use the service's own
   sharing (the sharing text next to a bin links there). boh warns when the two
   disagree.

The list of bins is kept in a small settings file in each service's private
app area, so it appears on any browser where you connect the same account.

## Make a paste

Choose a bin, then type or paste text (pick a format, or leave the bin's
default), choose or drop a file, or paste an image. Give it a title or let boh
name it after the time, and press **Upload**. boh uploads the file, makes a
link that matches the bin's visibility and shows it with **Copy link**.

Pastes are ordinary files: you can also see, rename or delete them in the
service's own app.

## Open a link

A boh link looks like `https://…/boh/#v1/gd/…`. Opening it:

- public pastes open without signing in;
- otherwise boh asks you to sign in to that service, with your own account;
- Google Drive may ask you to confirm, in Google's picker, that boh may open
  the file;
- if your account has no access, boh says so: ask whoever sent the link.

The viewer shows text with line numbers and highlighting, Markdown, HTML,
images, audio, video and PDF. **Show as** switches between text views (e.g.
Markdown source). Pictures and styles linked from inside a paste load only
after **Load remote content**. **Download** saves the file.

## Tags

Tags label pastes so you can find them later. They are kept on the paste's
file in Google Drive, so everyone who can open the paste sees the same tags in
boh (they do not show in Drive's own app). Dropbox and OneDrive pastes have no
tags yet.

- **When uploading**: type tags in **Tags** and press Enter or a comma. The
  bin's default tags and your tag rules' tags are already filled in; remove any
  you do not want.
- **In the viewer**: add or remove tags under the toolbar. If the owner shared
  the folder with you read-only, you see the tags but cannot change them.
- A tag has letters (any language), digits, `-`, `_`, `.` or `/`; spaces become
  `-` and capitals become lower case. A paste has at most 25 tags.

boh also shows **automatic tags** for every paste, worked out from its name
and type: `format:md`, `kind:image`, `lang:python`. They cannot be edited.

**Tag rules** (Library, **Tag rules…**) add tags to new pastes: for example
"files named `*.log` get `logs`", "format `json` gets `data`", or "every paste
in bin Notes gets `notes`". A bin's **Default tags** (in its Edit dialog) do the
same for one bin. Rules never remove tags.

## Library and search

**Library** lists the pastes of all your bins, your own and those shared with
you. Click a tag, type or bin on the left to filter, and **All / Mine / Shared
with me** to choose whose pastes. The search box takes:

| You type | Finds pastes |
|---|---|
| `notes` | tagged `notes`, or with `notes` in the name |
| `#notes`, `tag:a,b` | tagged `notes`; tagged `a` or `b` |
| `-#draft` | not tagged `draft` (`-` turns any term around) |
| `format:md,txt`, `kind:image`, `lang:go` | by automatic tag |
| `bin:"Work notes"`, `from:me`, `from:others` | in that bin; in your own or shared bins |
| `untagged` | without tags |
| `"big plan"` | with that phrase in the name |

All terms must match. The address keeps the search, so you can bookmark it.
Select pastes (or all that match) to **Add tags**, **Remove tags**, **Rename
tag** or **Apply rules** to all of them; pastes you may not change are skipped.

The library is kept in this browser to show quickly; **Refresh** lists the bins
again. Disconnecting an account deletes it.

## Shared bins and bin links

To use a folder someone shared with you, press **Add bin**, then **Choose a
folder shared with me**. Or ask the owner for its **bin link** (in the bin's
page, **Copy bin link**): opening it asks you to sign in and confirm the folder
in Google's picker, shows its pastes, and **Add to my bins** adds it. A bin
link gives nobody access: it works only for people the folder is already
shared with.

Google Drive may let boh see only the pastes of a shared folder that you opened
or added yourself; open the others from their links.

## Bins and recent pastes

Click a bin to list its pastes, copy their links, open them in the service, or
delete them. **Recent pastes** lists what you uploaded or opened in this
browser; it is never synced.
