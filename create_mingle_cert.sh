#!/bin/bash
# Generates a self-signed certificate for the Mingle prototype.
# Useful for enabling HTTPS which some mobile browsers require for sensor access.
# Requires OpenSSL to be installed.
set -e
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/mingle.key -out certs/mingle.cert -subj "/CN=localhost"
echo "Certificate and key generated in certs/"
