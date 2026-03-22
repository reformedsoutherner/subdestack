# Substack Bulk Inbox Archiver

A Python script that archives all unread newsletters in your Substack reader inbox in one go — no more swiping one at a time in the app.

## How it works

The script opens a Chromium browser (via [Playwright](https://playwright.dev/python/)) and authenticates as you. It first attempts to archive items via Substack's internal JSON API (fast, no UI interaction needed). If that fails it falls back to driving the web UI directly.

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
playwright install chromium
```

> **Python 3.10+** is required.

---

## Authentication

You have two options:

### Option A — Cookie file (recommended)

This is faster and doesn't require you to click a magic link every time.

1. Log in to [substack.com](https://substack.com) in your browser.
2. Install a cookie-export extension:
   - **Chrome/Edge**: [Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   - **Firefox**: [Cookie-Editor](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)
3. Navigate to `substack.com`.
4. Open Cookie-Editor, click **Export → Export as JSON**, and save the file as `cookies.json` in this directory.

> **Important**: The `substack.sid` cookie is your session token. Keep `cookies.json` private and out of version control — add it to `.gitignore`.

### Option B — Email magic link

```bash
python archive_inbox.py --email you@example.com
```

A browser window will open, Substack will email you a magic link, and the script will continue once you click it.

---

## Usage

```bash
# Archive everything using saved cookies (headless — no browser window)
python archive_inbox.py --cookies cookies.json --headless

# Archive everything using saved cookies (visible browser window)
python archive_inbox.py --cookies cookies.json

# Preview what would be archived without changing anything
python archive_inbox.py --cookies cookies.json --dry-run

# Authenticate via email magic link (browser window required)
python archive_inbox.py --email you@example.com
```

### Options

| Flag | Description |
|------|-------------|
| `--cookies FILE` | Path to JSON cookie file |
| `--email EMAIL` | Account email; opens browser for magic-link login |
| `--headless` | Run without a visible browser window (cookies only) |
| `--dry-run` | List items that would be archived; make no changes |

---

## Troubleshooting

**"Not logged in after loading cookies"**
Your `substack.sid` cookie has expired. Re-export cookies from your browser after a fresh login.

**"Could not find Archive button"**
Substack may have updated their UI. Run without `--headless` to see what the browser is doing, then open a GitHub issue with a screenshot.

**Rate limiting**
The script pauses 300 ms between archive actions. If you have a very large inbox and hit rate limits, increase `REQUEST_DELAY` at the top of `archive_inbox.py`.

---

## Security notes

- Never commit `cookies.json` to a public repository.
- Add it to `.gitignore`:
  ```
  cookies.json
  ```
- The script only ever reads your inbox and archives items — it never posts, subscribes, or modifies anything else.
