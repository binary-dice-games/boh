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

## Bins and recent pastes

Click a bin to list its pastes, copy their links, open them in the service, or
delete them. **Recent pastes** lists what you uploaded or opened in this
browser; it is never synced.
