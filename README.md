# Substack Bulk Inbox Archiver

Archives all unread newsletters in your Substack inbox in one go — no more swiping one at a time.

---

## What you'll need

- A Mac running macOS 12 (Monterey) or newer
- Google Chrome installed
- Python 3.10 or newer (see Step 1)

---

## Step 1 — Check (or install) Python

1. Open **Terminal**. You can find it by pressing **Cmd + Space**, typing `Terminal`, and pressing Enter.

2. Type this and press Enter:
   ```
   python3 --version
   ```

3. You should see something like `Python 3.12.0`. Any version `3.10` or higher is fine.

   - If you see `command not found` or a version lower than `3.10`, download the latest installer from **[python.org/downloads](https://www.python.org/downloads/)**, run it, then come back here.

---

## Step 2 — Get the project files onto your Mac

**Option A — Download as a zip (simplest):**
1. On the GitHub page for this project, click the green **Code** button.
2. Click **Download ZIP**.
3. Open your Downloads folder and double-click the zip to unzip it.
4. Move the resulting folder somewhere easy to find, like your Desktop.

**Option B — If you have git installed:**
```
git clone <repo-url>
```
Replace `<repo-url>` with the URL of this repository.

---

## Step 3 — Open Terminal inside the project folder

1. Open **Finder** and navigate to the `subdestack` folder.
2. Right-click (or two-finger click) the folder and choose **"New Terminal at Folder"**.

   > If you don't see that option: open Terminal, type `cd ` (with a space after it), then drag the `subdestack` folder onto the Terminal window and press Enter.

3. Your Terminal prompt should now end with `subdestack`, like:
   ```
   yourname@Mac subdestack %
   ```

---

## Step 4 — Run the setup script (one time only)

Type this exactly and press Enter:

```
./setup.sh
```

If you get `Permission denied`, run this first and then try again:
```
chmod +x setup.sh run.sh
```

The setup script will:
- Create a sandboxed Python environment (nothing installed globally on your Mac)
- Install the required Python package
- Download a copy of Chromium (~150 MB — this is the browser the script controls)

When it finishes you will see:
```
Setup complete!
```

---

## Step 5 — Export your Substack cookies

The script needs proof that you're logged in to Substack. You do this by exporting a "cookie" file from Chrome — think of it as a temporary login pass.

1. Open **Google Chrome** and go to **[substack.com](https://substack.com)**. Make sure you're logged in.

2. Install the **Cookie-Editor** extension:
   - Go to **[chrome.google.com/webstore](https://chrome.google.com/webstore)** and search for **Cookie-Editor** (published by cgagnier).
   - Click **Add to Chrome → Add extension**.

3. While still on **substack.com**, click the Cookie-Editor icon in the Chrome toolbar (puzzle-piece icon top-right → Cookie-Editor).

4. In the Cookie-Editor panel, click **Export** at the bottom, then **Export as JSON**.
   The JSON data is now copied to your clipboard.

5. Save it as a file called `cookies.json` in the `subdestack` folder:
   - Open **TextEdit** (press Cmd + Space, type TextEdit, press Enter).
   - If TextEdit opens in rich-text mode, click **Format → Make Plain Text**.
   - Press **Cmd + V** to paste.
   - Press **Cmd + S** to save. In the save dialog:
     - Set the filename to `cookies.json`
     - Navigate to the `subdestack` folder
     - Make sure **"If no extension is provided, use .txt"** is **unchecked**
   - Click **Save**.

> **Keep `cookies.json` private.** It acts like a password to your Substack account. Never share it or upload it anywhere.

---

## Step 6 — Test with a dry run (recommended)

Before archiving anything, do a preview to see what the script would touch:

```
./run.sh --dry-run
```

It will list the newsletter items it found — without actually archiving them. Check the list looks right.

---

## Step 7 — Archive your inbox

When you're ready, run:

```
./run.sh
```

The script runs a hidden browser in the background, scrolls through your entire inbox, and archives everything. You'll see progress as it runs, and a final count:

```
Archived 47 item(s).
```

---

## Options

| Command | What it does |
|---------|-------------|
| `./run.sh` | Archive everything in your inbox |
| `./run.sh --dry-run` | Preview only — no changes made |
| `./run.sh --skip-saved` | Archive everything *except* items you've bookmarked |
| `./run.sh --dry-run --skip-saved` | Preview the skip-saved behaviour |

---

## Running it again in future

Just open Terminal in the `subdestack` folder and run `./run.sh` again. Your cookies are refreshed automatically each run, so they should stay valid for months.

If you ever see a **"Not logged in"** error, your session has expired — go back to Step 5 and re-export fresh cookies.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: python3` | Install Python from [python.org/downloads](https://www.python.org/downloads/) |
| `./setup.sh: Permission denied` | Run `chmod +x setup.sh run.sh` first |
| `cookies.json not found` | Make sure you saved it *inside* the `subdestack` folder (Step 5) |
| `cookies.json` contains plain text, not JSON | You saved it as `.txt` — re-save it without the `.txt` extension |
| `Not logged in after loading cookies` | Re-export cookies from Chrome while on substack.com (Step 5) |
| `No inbox items found` | Your inbox is already empty — nothing to do! |
| Script seems stuck or slow | A large inbox takes a few minutes — let it run |

---

## Security notes

- `cookies.json` is listed in `.gitignore`, so it won't be accidentally uploaded if you use git.
- The script only archives items in your inbox — it never posts, subscribes, unsubscribes, or changes account settings.
