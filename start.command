#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Add Homebrew to PATH for Apple Silicon and Intel Macs
eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null

# Install Homebrew if missing
if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null
fi

# Install Node.js if missing
if ! command -v node &>/dev/null; then
    echo "Installing Node.js..."
    brew install node
fi

# Install pnpm if missing
if ! command -v pnpm &>/dev/null; then
    echo "Installing pnpm..."
    if command -v corepack &>/dev/null; then
        corepack enable
        corepack prepare pnpm@11.7.0 --activate 2>/dev/null || npm install -g pnpm@11.7.0
    else
        npm install -g pnpm@11.7.0
    fi
fi

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Build project artifacts if missing
if [ ! -d "apps/web/dist" ]; then
    echo "Building project artifacts..."
    pnpm run build
fi

echo "Starting DeepSeek Harness Web UI..."
pnpm dsh web "$@"
