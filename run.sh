#!/bin/bash
# run.sh — archive all unread Substack newsletters

set -e

# Check setup has been run
if [ ! -d ".venv" ]; then
    echo "ERROR: Setup hasn't been run yet."
    echo "Please run:  ./setup.sh"
    exit 1
fi

if [ ! -f "cookies.json" ]; then
    echo "ERROR: cookies.json not found."
    echo ""
    echo "Please export your Substack cookies first:"
    echo "  1. Open Chrome and go to substack.com (make sure you are logged in)"
    echo "  2. Install the Cookie-Editor extension from the Chrome Web Store"
    echo "  3. Click the Cookie-Editor icon, then click 'Export' → 'Export as JSON'"
    echo "  4. Save the file as 'cookies.json' in this folder"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo ""
echo "======================================"
echo "  Substack Archiver — Running"
echo "======================================"
echo ""

# Run with --dry-run first if passed as argument
if [ "$1" = "--dry-run" ]; then
    echo "DRY RUN — no items will actually be archived."
    echo ""
    .venv/bin/python archive_inbox.py --cookies cookies.json --headless --dry-run
else
    .venv/bin/python archive_inbox.py --cookies cookies.json --headless
fi

echo ""
