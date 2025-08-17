#!/bin/bash
# setup_mingle_env.sh
# Mini README:
# - Purpose: install Node.js dependencies and prepare the Mingle environment on Linux or Raspberry Pi.
# - Structure:
#   1. Optionally ensure Node.js LTS via nvm if available.
#   2. Install Node dependencies defined in package.json.
#   3. Remind the user how to launch the server.
# - Notes: intended for bash on Linux/Raspberry Pi; Windows users should run setup_mingle_env.ps1 instead.

set -e

# Optional: use Node Version Manager if available
if command -v nvm >/dev/null 2>&1; then
  echo "Using nvm to ensure Node.js LTS"
  nvm install --lts
fi

echo "Installing node modules..."
npm install

echo "Setup complete. Run 'npm start' to launch the server."
