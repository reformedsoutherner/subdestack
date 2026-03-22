#!/bin/bash
# setup.sh — run this once to install everything needed

set -e  # stop on any error

echo ""
echo "======================================"
echo "  Substack Archiver — Setup"
echo "======================================"
echo ""

# ── Check Python ────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo ""
    echo "Install it from https://www.python.org/downloads/"
    echo "Then run this script again."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(sys.version_info.minor)')
if [ "$PYTHON_VERSION" -lt 10 ]; then
    echo "ERROR: Python 3.10 or newer is required."
    echo "You have: $(python3 --version)"
    echo ""
    echo "Download a newer version from https://www.python.org/downloads/"
    exit 1
fi

echo "✓ Python $(python3 --version) found"

# ── Create a virtual environment ─────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi
echo "✓ Virtual environment ready"

# ── Install dependencies ──────────────────────────────────────────────────
echo "Installing Python packages (this may take a minute)..."
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
echo "✓ Python packages installed"

# ── Install the Chromium browser that Playwright needs ───────────────────
echo "Installing Chromium browser for Playwright..."
echo "(This downloads ~150 MB — only needed once)"
.venv/bin/playwright install chromium
echo "✓ Chromium installed"

echo ""
echo "======================================"
echo "  Setup complete!"
echo ""
echo "  Next step: follow the instructions"
echo "  in README.md to export your cookies,"
echo "  then run:  ./run.sh"
echo "======================================"
echo ""
