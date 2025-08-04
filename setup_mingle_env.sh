#!/bin/bash
# Simple setup script for Mingle prototype (Linux/Raspberry Pi)
# Installs Node.js dependencies

set -e

# Optional: use Node Version Manager if available
if command -v nvm >/dev/null 2>&1; then
  echo "Using nvm to ensure Node.js LTS"
  nvm install --lts
fi

echo "Installing node modules..."
npm install

echo "Setup complete. Run 'npm start' to launch the server."
