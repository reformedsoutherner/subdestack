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

from playwright.sync_api import sync_playwright


INBOX_URL = "https://substack.com/inbox"

# Verified selectors from community reverse-engineering of the Substack reader DOM.
# The action menu is always present in the DOM (no hover required).
# Source: https://gist.github.com/davfive/5597fecf10d54ac3dcb54b063ac4700f
ARCHIVE_BTN_JS = (
    "document.querySelectorAll('div.inbox-item-actions-menu')"
    "  .length"
)

# Click all currently-visible archive buttons; returns the count clicked.
CLICK_ALL_JS = """
() => {
    const menus = document.querySelectorAll('div.inbox-item-actions-menu');
    let clicked = 0;
    menus.forEach(menu => {
        const btn = menu.querySelector('button:has(svg.lucide-archive)');
        if (btn) { btn.click(); clicked++; }
    });
    return clicked;
}
"""

# Same but skip saved/bookmarked items (the ones with an active bookmark icon).
CLICK_UNSAVED_JS = """
() => {
    const menus = document.querySelectorAll(
        'div.inbox-item-actions-menu:not(:has(button>svg[class*="activeSave-"]))'
    );
    let clicked = 0;
    menus.forEach(menu => {
        const btn = menu.querySelector('button:has(svg.lucide-archive)');
        if (btn) { btn.click(); clicked++; }
    });
    return clicked;
}
"""

# Collect titles of visible items (for --dry-run reporting).
COLLECT_TITLES_JS = """
() => {
    const titles = [];
    document.querySelectorAll('div.inbox-item-actions-menu').forEach(menu => {
        // Walk up to the inbox item container and grab any heading text
        const item = menu.closest('div[class*="inbox"]') || menu.parentElement;
        const heading = item && (
            item.querySelector('h2, h3, [class*="title"], [class*="subject"]')
        );
        titles.push(heading ? heading.innerText.trim() : '(unknown title)');
    });
    return titles;
}
"""


def load_cookies(cookies_path: str) -> list[dict]:
    path = Path(cookies_path)
    if not path.exists():
        print(f"Error: Cookie file not found: {cookies_path}")
        sys.exit(1)
    with open(path) as f:
        raw = json.load(f)

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
        raw_ss = c.get("sameSite") or c.get("SameSite", "")
        if raw_ss in ("Strict", "Lax", "None"):
            cookie["sameSite"] = raw_ss
        normalised.append(cookie)
    return normalised


def login_with_email(page, email: str):
    """Open the Substack sign-in page and wait for the user to click the magic link."""
    print(f"Opening sign-in page for {email} ...")
    page.goto("https://substack.com/sign-in", wait_until="networkidle")

    page.locator('input[type="email"], input[name="email"]').first.fill(email)
    page.locator('button[type="submit"], button:has-text("Continue")').first.click()

    print(
        "\nSubstack has sent a magic link to your email.\n"
        "Click it in your email client — the script will continue automatically.\n"
        "(Waiting up to 5 minutes...)\n"
    )
    page.wait_for_url("**/inbox**", timeout=300_000)
    print("Logged in successfully.")


def archive_inbox(page, skip_saved: bool, dry_run: bool) -> int:
    """
    Archive all inbox items using Substack's DOM.

    Substack renders a virtualised list, so items are loaded in batches as
    the user scrolls. We click all visible archive buttons, scroll to load
    more, and repeat until nothing new appears.
    """
    click_js = CLICK_UNSAVED_JS if skip_saved else CLICK_ALL_JS
    total_archived = 0
    rounds_with_nothing = 0

    while True:
        # How many archive buttons are currently in the DOM?
        visible = page.evaluate(ARCHIVE_BTN_JS)

        if visible == 0:
            rounds_with_nothing += 1
            if rounds_with_nothing >= 2:
                # Scrolled twice and still nothing — we're done.
                break
            # Scroll down to trigger lazy-loading of more items.
            page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
            page.wait_for_timeout(1500)
            continue

        rounds_with_nothing = 0

        if dry_run:
            titles = page.evaluate(COLLECT_TITLES_JS)
            for t in titles:
                print(f"  [dry-run] Would archive: {t!r}")
            total_archived += len(titles)
            # Scroll to reveal the next batch without archiving.
            page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
            page.wait_for_timeout(1500)
            # Stop after two scroll-loads so dry-run doesn't run forever.
            if rounds_with_nothing >= 1:
                break
            rounds_with_nothing += 1
            continue

        clicked = page.evaluate(click_js)
        total_archived += clicked
        print(f"  Archived {clicked} item(s) (total so far: {total_archived})")

        # Brief pause to let the DOM update and Substack's API calls settle.
        page.wait_for_timeout(800)

        # Scroll to load the next batch.
        page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        page.wait_for_timeout(1500)

    return total_archived


def run(args):
    with sync_playwright() as p:
        headless = args.headless
        if args.email and headless:
            print("Note: --headless is ignored with --email (browser needed for magic link).")
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
            print("Error: provide either --cookies FILE or --email EMAIL.")
            sys.exit(1)

        # ── Navigate to Inbox ───────────────────────────────────────────────
        print(f"\nNavigating to {INBOX_URL} ...")
        page.goto(INBOX_URL, wait_until="domcontentloaded", timeout=30_000)

        if "sign-in" in page.url or "login" in page.url:
            print(
                "\nError: Not logged in after loading cookies.\n"
                "Your cookie file may be expired. Please re-export it from your browser."
            )
            browser.close()
            sys.exit(1)

        # Wait for inbox items to appear in the DOM.
        try:
            page.wait_for_selector("div.inbox-item-actions-menu", timeout=15_000)
        except Exception:
            print(
                "\nNo inbox items found — your inbox appears to be empty, "
                "or Substack's UI has changed."
            )
            browser.close()
            return

        print(f"Inbox loaded.\n")

        # ── Archive ─────────────────────────────────────────────────────────
        print(
            f"Starting {'dry run' if args.dry_run else 'archive'}"
            f"{' (skipping saved/bookmarked items)' if args.skip_saved else ''} ...\n"
        )
        total = archive_inbox(page, skip_saved=args.skip_saved, dry_run=args.dry_run)

        # ── Summary ─────────────────────────────────────────────────────────
        if total == 0:
            print("\nNo items to archive — inbox is already clear!")
        else:
            verb = "Would have archived" if args.dry_run else "Archived"
            print(f"\n{verb} {total} item(s).")

        # Persist refreshed cookies for next time.
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
        "--skip-saved",
        action="store_true",
        default=False,
        help="Skip items you have bookmarked/saved — archive everything else.",
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
