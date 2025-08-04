# PowerShell script to generate a self-signed certificate for the Mingle prototype.
# Requires OpenSSL to be installed and available in the PATH.
New-Item -ItemType Directory -Path certs -Force | Out-Null
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/mingle.key -out certs/mingle.cert -subj "/CN=localhost"
Write-Host "Certificate and key generated in certs\"
