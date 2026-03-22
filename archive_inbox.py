#!/usr/bin/env python3
"""
Substack Bulk Inbox Archiver

Archives all unread newsletters in your Substack reader inbox.

Usage:
    # Recommended: use saved browser cookies
    python archive_inbox.py --cookies cookies.json

    # Or trigger a magic-link login (browser window opens)
    python archive_inbox.py --email you@example.com

    # Preview what would be archived (no changes made)
    python archive_inbox.py --cookies cookies.json --dry-run

See README.md for instructions on exporting cookies from your browser.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout


INBOX_URL = "https://substack.com/inbox"
REQUEST_DELAY = 0.3  # seconds between archive requests


def load_cookies(cookies_path: str) -> list[dict]:
    path = Path(cookies_path)
    if not path.exists():
        print(f"Error: Cookie file not found: {cookies_path}")
        sys.exit(1)
    with open(path) as f:
        raw = json.load(f)

    # Normalise cookies exported by different browser extensions.
    # EditThisCookie / Cookie-Editor / Netscape format all vary slightly.
    normalised = []
    for c in raw:
        cookie: dict = {
            "name": c.get("name") or c.get("Name", ""),
            "value": c.get("value") or c.get("Value", ""),
            "domain": c.get("domain") or c.get("Domain", ".substack.com"),
            "path": c.get("path") or c.get("Path", "/"),
        }
        if "httpOnly" in c:
            cookie["httpOnly"] = bool(c["httpOnly"])
        if "secure" in c:
            cookie["secure"] = bool(c["secure"])
        # Playwright only accepts "Strict", "Lax", or "None"
        raw_ss = c.get("sameSite") or c.get("SameSite", "")
        if raw_ss in ("Strict", "Lax", "None"):
            cookie["sameSite"] = raw_ss
        normalised.append(cookie)
    return normalised


def login_with_email(page, email: str):
    """Open the Substack sign-in page and wait for the user to click the magic link."""
    print(f"Opening sign-in page for {email} ...")
    page.goto("https://substack.com/sign-in", wait_until="networkidle")

    email_input = page.locator('input[type="email"], input[name="email"]').first
    email_input.fill(email)
    page.locator('button[type="submit"], button:has-text("Continue")').first.click()

    print(
        "\nSubstack has sent a magic link to your email.\n"
        "Click it in your email client — the script will continue automatically.\n"
        "(Waiting up to 5 minutes...)\n"
    )
    page.wait_for_url("**/inbox**", timeout=300_000)
    print("Logged in successfully.")


# ---------------------------------------------------------------------------
# Core archiving logic — runs inside the browser via page.evaluate()
# ---------------------------------------------------------------------------

_DISCOVER_JS = """
async () => {
    // Intercept the next fetch call to the reader/inbox API so we can learn
    // the exact URL pattern Substack uses.
    return new Promise((resolve) => {
        const original = window.fetch;
        window.fetch = async (...args) => {
            const url = typeof args[0] === 'string' ? args[0] : args[0].url;
            if (url && url.includes('/api/v1/') && url.includes('inbox')) {
                resolve(url);
                window.fetch = original;
            }
            return original(...args);
        };
        // Trigger a re-fetch by scrolling
        window.dispatchEvent(new Event('scroll'));
        // Fallback timeout
        setTimeout(() => { window.fetch = original; resolve(null); }, 5000);
    });
}
"""

_FETCH_INBOX_JS = """
async (limit, offset) => {
    const resp = await fetch(
        `/api/v1/reader/posts?filter=inbox&unread=true&limit=${limit}&offset=${offset}`,
        { credentials: 'include' }
    );
    if (!resp.ok) return { error: resp.status, posts: [] };
    const data = await resp.json();
    return data;
}
"""

_ARCHIVE_POST_JS = """
async (postId) => {
    // Substack uses the "inbox_item" endpoint for reader archive actions.
    // The post_id in the reader inbox corresponds to the inbox item id.
    const resp = await fetch(`/api/v1/reader/inbox_items/${postId}/archive`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    return { status: resp.status, ok: resp.ok };
}
"""

# Alternative bulk endpoint — some Substack versions support marking all read
_MARK_ALL_READ_JS = """
async () => {
    const resp = await fetch('/api/v1/reader/inbox/mark_all_read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    return { status: resp.status, ok: resp.ok };
}
"""


def try_api_archive(page, dry_run: bool) -> tuple[bool, int]:
    """
    Attempt to archive via Substack's internal JSON API (fastest path).
    Returns (success, count_archived).
    """
    page.wait_for_load_state("networkidle", timeout=15_000)

    # --- Step 1: probe the "fetch unread inbox" endpoint ---
    page_size = 25
    offset = 0
    archived = 0
    api_worked = False

    print("  Probing Substack API for inbox items...")

    while True:
        result = page.evaluate(_FETCH_INBOX_JS, page_size, offset)

        # If we get an error status or unexpected shape, bail out of API path
        if isinstance(result, dict) and result.get("error"):
            print(f"  API returned HTTP {result['error']} — will fall back to UI mode.")
            return False, 0

        # Substack may wrap items under different keys
        posts = (
            result.get("posts")
            or result.get("items")
            or result.get("inbox_items")
            or []
        )

        if not posts:
            # Empty page means we're done
            break

        api_worked = True

        for post in posts:
            item_id = post.get("id") or post.get("inbox_item_id")
            title = post.get("title") or post.get("post", {}).get("title", f"item-{item_id}")

            if dry_run:
                print(f"    [dry-run] Would archive: {title!r}")
                archived += 1
                continue

            result2 = page.evaluate(_ARCHIVE_POST_JS, item_id)
            if result2.get("ok"):
                archived += 1
                print(f"    Archived ({archived}): {title!r}")
            else:
                print(f"    Warning: archive returned HTTP {result2.get('status')} for {title!r}")
            time.sleep(REQUEST_DELAY)

        if dry_run or len(posts) < page_size:
            break  # last page

        offset += page_size

    return api_worked, archived


def ui_archive_all(page, dry_run: bool) -> int:
    """
    Fallback: drive the Substack Reader UI directly to archive each unread item.
    Hovers each inbox item to reveal the Archive button, then clicks it.
    """
    archived = 0

    # Selectors for unread inbox items in the Substack Reader.
    # The reader at substack.com/inbox uses a React-rendered list.
    # We look for the blue unread indicator dot that marks unread items.
    UNREAD_ITEM_SELECTORS = [
        # Standard reader inbox items
        '.reader-inbox-item',
        '[data-testid="inbox-item"]',
        '.inbox-item',
        # Fallback: any article-like card in the inbox view
        'article[data-post-id]',
    ]

    ARCHIVE_BTN_SELECTORS = [
        '[aria-label="Archive"]',
        '[aria-label="archive"]',
        '[title="Archive"]',
        'button:has-text("Archive")',
        '[data-testid="archive-button"]',
    ]

    MORE_BTN_SELECTORS = [
        '[aria-label="More options"]',
        '[aria-label="More"]',
        'button[aria-label="..."]',
        '[data-testid="more-options"]',
        '.more-options-button',
    ]

    print("  Using UI automation to archive items...")

    consecutive_failures = 0
    while consecutive_failures < 3:
        # Find the first unread item that hasn't been archived yet
        item = None
        for sel in UNREAD_ITEM_SELECTORS:
            items = page.locator(sel)
            count = items.count()
            if count > 0:
                item = items.first
                break

        if item is None:
            print("  No inbox items found — stopping.")
            break

        try:
            item.scroll_into_view_if_needed()
            item.hover()
            page.wait_for_timeout(300)
        except Exception as e:
            print(f"  Warning: could not hover item: {e}")
            consecutive_failures += 1
            continue

        if dry_run:
            try:
                text = item.inner_text(timeout=1000)[:80].strip()
            except Exception:
                text = "(unknown)"
            print(f"    [dry-run] Would archive: {text!r}")
            archived += 1
            if archived >= 10:
                print("    [dry-run] Showing first 10 items only.")
                break
            # We can't actually archive in dry_run so we must break after listing
            # what's visible — there's no way to advance without archiving.
            break

        # Try each archive button selector
        archived_this = False
        for sel in ARCHIVE_BTN_SELECTORS:
            btn = page.locator(sel).first
            try:
                btn.wait_for(state="visible", timeout=1500)
                btn.click()
                archived += 1
                print(f"    Archived item #{archived}")
                time.sleep(REQUEST_DELAY)
                archived_this = True
                consecutive_failures = 0
                break
            except PlaywrightTimeout:
                continue

        if not archived_this:
            # Try the "..." more-options menu
            for sel in MORE_BTN_SELECTORS:
                btn = page.locator(sel).first
                try:
                    btn.wait_for(state="visible", timeout=1500)
                    btn.click()
                    archive_opt = page.locator('text="Archive"').first
                    archive_opt.wait_for(state="visible", timeout=2000)
                    archive_opt.click()
                    archived += 1
                    print(f"    Archived item #{archived} (via menu)")
                    time.sleep(REQUEST_DELAY)
                    archived_this = True
                    consecutive_failures = 0
                    break
                except PlaywrightTimeout:
                    continue

        if not archived_this:
            consecutive_failures += 1
            print(
                f"  Warning: could not find Archive button (attempt {consecutive_failures}/3). "
                "The Substack UI may have changed."
            )

    return archived


def run(args):
    with sync_playwright() as p:
        headless = args.headless
        if args.email and headless:
            print("Note: --headless is ignored when using --email (need browser for magic link).")
            headless = False

        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        # ── Authentication ──────────────────────────────────────────────────
        if args.cookies:
            cookies = load_cookies(args.cookies)
            context.add_cookies(cookies)
            print(f"Loaded {len(cookies)} cookies from {args.cookies}")
        elif args.email:
            login_with_email(page, args.email)
        else:
            print("Error: provide either --cookies PATH or --email EMAIL.")
            sys.exit(1)

        # ── Navigate to Inbox ───────────────────────────────────────────────
        print(f"\nNavigating to {INBOX_URL} ...")
        page.goto(INBOX_URL, wait_until="domcontentloaded", timeout=30_000)

        # Check we are actually logged in
        if "sign-in" in page.url or "login" in page.url:
            print(
                "\nError: Not logged in after loading cookies.\n"
                "Your cookie file may be expired. Please re-export it from your browser."
            )
            browser.close()
            sys.exit(1)

        print(f"Inbox loaded: {page.url}\n")

        # ── Archive ─────────────────────────────────────────────────────────
        # Try the fast API path first; fall back to UI automation.
        api_success, total = try_api_archive(page, dry_run=args.dry_run)

        if not api_success:
            print("  Falling back to UI automation ...\n")
            total = ui_archive_all(page, dry_run=args.dry_run)

        # ── Summary ─────────────────────────────────────────────────────────
        if total == 0:
            print("\nNo unread items found — your inbox is already clear!")
        else:
            verb = "Would have archived" if args.dry_run else "Archived"
            print(f"\n{verb} {total} item(s).")

        # Persist updated cookies so the session stays valid next time.
        if args.cookies and not args.dry_run:
            updated = context.cookies()
            with open(args.cookies, "w") as f:
                json.dump(updated, f, indent=2)
            print(f"Saved refreshed cookies to {args.cookies}")

        browser.close()


def main():
    parser = argparse.ArgumentParser(
        description="Bulk-archive all unread newsletters in your Substack inbox.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    auth = parser.add_mutually_exclusive_group()
    auth.add_argument(
        "--cookies",
        metavar="FILE",
        help="JSON cookie file exported from your browser (see README).",
    )
    auth.add_argument(
        "--email",
        metavar="EMAIL",
        help="Your Substack account email; opens browser for magic-link login.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=False,
        help="Run browser in headless mode (no visible window). Only works with --cookies.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be archived without making any changes.",
    )
    args = parser.parse_args()

    if not args.cookies and not args.email:
        parser.error("You must provide either --cookies FILE or --email EMAIL.")

    run(args)


if __name__ == "__main__":
    main()
