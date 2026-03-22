# Substack Note Scheduler — Chrome Extension

Schedule your Substack notes for future publishing, directly from the Substack website.

---

## Features

- Adds a **Schedule** button next to the **Post** button in the Substack Notes composer
- Pick any future date and time for your note to go live
- Popup shows all your scheduled and sent notes
- Notes are posted automatically in the background using Chrome's Alarms API
- Fully local — no accounts, no servers, no data sent anywhere

---

## Installation (Developer Mode)

Chrome extensions can be loaded unpacked without submitting to the Web Store:

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder from this repository

The extension icon (a clock) will appear in your Chrome toolbar.

---

## How to schedule a note

1. Go to [substack.com/notes](https://substack.com/notes)
2. Click the compose area and write your note
3. Click the orange **Schedule** button (appears next to the Post button)
4. Pick your desired date and time in the modal
5. Click **Schedule** — the note is saved and will post automatically

> **Tip:** Keep Chrome running at the scheduled time. The extension uses Chrome's background service worker, which only runs while Chrome is open. If Chrome is closed, posting will happen when you next open Chrome.

---

## Managing scheduled notes

Click the extension icon in the Chrome toolbar to open the popup, which shows:

- **Pending** — notes waiting to be posted (with scheduled time)
- **Posted** — notes that have been successfully published
- **Failed** — notes that couldn't be posted (hover for error detail)

You can delete individual notes with the × button, or clear all sent notes with the **Clear sent** button.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Schedule button doesn't appear | Make sure you're on `substack.com/notes` and fully logged in; refresh the page |
| Note didn't post | Chrome may have been closed — click the extension icon to see the status; if "Failed", re-schedule it |
| "Could not find the note editor" error | Substack may have updated its UI; [open an issue](https://github.com/your-repo/issues) with details |
| Post button not found | Same as above — check for a UI update |

---

## Notes & Limitations

- **Chrome must be running** at the scheduled time for automatic posting to work.
- Substack's Notes editor is built with ProseMirror. The extension uses `document.execCommand('insertText')` to fill text, which works in current Chrome but may require updating if Substack changes their editor.
- The extension does not store your Substack password or session token — it uses Chrome's tab + scripting permissions to interact with a logged-in Substack tab in your browser.
