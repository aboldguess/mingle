<#
File: setup_mingle_env.ps1
Mini README:
- Purpose: install Node.js dependencies and prepare the Mingle environment on Windows.
- Structure:
  1. Install Node modules defined in package.json.
  2. Display a reminder about starting the server.
- Notes: intended for Windows PowerShell; Linux and Raspberry Pi users should run setup_mingle_env.sh.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Installing node modules..."
npm install
Write-Host "Setup complete. Run 'npm start' to launch the server."

