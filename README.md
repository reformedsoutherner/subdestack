# Substack Bulk Inbox Archiver

Archives all unread newsletters in your Substack inbox in one go — no more swiping one at a time.

---

## What you'll need

- A Mac (macOS 12 or newer)
- Google Chrome installed
- Python 3.10 or newer — check by opening Terminal and typing `python3 --version`
  - If you don't have it, download from [python.org/downloads](https://www.python.org/downloads/) and install it, then come back here.

---

## Step 1 — Download this project

If you received this as a zip file, unzip it and note where the folder is (e.g. your Desktop or Downloads folder).

If you cloned it with git, it's already on your machine.

---

## Step 2 — Open Terminal in the project folder

1. Open **Finder** and navigate to the project folder (`subdestack`).
2. Right-click (or Control-click) the folder and choose **"New Terminal at Folder"**.
   - If you don't see that option, open Terminal from Applications → Utilities → Terminal, then type `cd ` (with a space after it), drag the folder onto the Terminal window, and press Enter.

You should see a prompt that ends with the folder name, something like:
```
yourname@Mac subdestack %
```

---

## Step 3 — Run the setup script (once only)

In Terminal, type exactly this and press Enter:

```
./setup.sh
```

This will:
- Create a sandboxed Python environment
- Install the required packages
- Download a copy of the Chromium browser (~150 MB, one-time only)

When it finishes you'll see **"Setup complete!"**

---

## Step 4 — Export your Substack cookies

The script needs to log in to Substack as you. The easiest way is to give it a copy of your browser's login cookie.

1. Open **Google Chrome** and go to [substack.com](https://substack.com). Make sure you are logged in.

2. Install the **Cookie-Editor** extension:
   - Go to [chromewebstore.google.com](https://chromewebstore.google.com) and search for **Cookie-Editor** (by cgagnier).
   - Click **Add to Chrome**.

3. Once installed, click the Cookie-Editor icon in your browser toolbar (top right — it looks like a cookie 🍪).

4. Click **Export**, then **Export as JSON**.

5. A JSON file will be copied to your clipboard. Open a plain text editor (TextEdit works — but make sure it's in plain text mode: Format → Make Plain Text), paste the contents, and save the file as **`cookies.json`** inside the `subdestack` folder.

> **Keep this file private.** It acts like a password. Don't share it or upload it anywhere.

---

## Step 5 — Preview first (optional but recommended)

Before archiving anything, do a dry run to see what the script would archive:

```
./run.sh --dry-run
```

This opens a browser, checks your inbox, and lists the items — without actually archiving them.

---

## Step 6 — Archive your inbox

When you're happy, run:

```
./run.sh
```

The script will run invisibly in the background (no browser window) and archive all your unread inbox items. You'll see a count at the end, e.g.:

```
Archived 47 item(s).
```

---

## Running it again in future

Your cookies are refreshed automatically each run, so they stay valid. Just run `./run.sh` whenever your inbox fills up again.

If you ever get a **"Not logged in"** error, your session has expired. Go back to Step 4 and re-export fresh cookies.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: python3` | Install Python from [python.org/downloads](https://www.python.org/downloads/) |
| `./setup.sh: Permission denied` | Run `chmod +x setup.sh run.sh` first |
| `cookies.json not found` | Re-read Step 4 — make sure the file is in the `subdestack` folder |
| `Not logged in after loading cookies` | Re-export cookies from Chrome (Step 4) |
| `No unread items found` | Your inbox is already clear — nothing to do! |
| Script seems stuck | Let it run — a very large inbox can take a few minutes |

---

## Security notes

- `cookies.json` contains your Substack session — treat it like a password.
- It's listed in `.gitignore` so it won't be accidentally committed if you use git.
- The script only ever reads your inbox and archives items — it never posts, subscribes, or changes your account settings.
