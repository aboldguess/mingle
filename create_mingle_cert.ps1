<#
File: create_mingle_cert.ps1
Mini README:
- Purpose: generate a self-signed certificate and key for the Mingle server on Windows.
- Structure:
  1. Verify the PowerShell edition and version.
  2. Prepare output directory.
  3. Create self-signed certificate using Windows cryptography.
  4. Export certificate and private key in PEM format.
  5. Remove the temporary certificate from the user store and report success.
- Notes: requires PowerShell 7+ and no external tools like OpenSSL.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Detect PowerShell edition and version to ensure compatibility. The script
# requires PowerShell 7+ because older versions lack modern certificate APIs.
$edition = $PSVersionTable.PSEdition
$version = $PSVersionTable.PSVersion
if ($edition -eq 'Desktop' -and $version.Major -le 5) {
    Write-Error "Windows PowerShell $version is unsupported. Please install PowerShell 7+ to run this script."
    exit 1
}

$certDir = Join-Path $PSScriptRoot 'certs'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

try {
    # Generate a self-signed certificate valid for one year.
    $cert = New-SelfSignedCertificate -DnsName 'localhost' `
        -CertStoreLocation Cert:\CurrentUser\My `
        -NotAfter (Get-Date).AddDays(365)

    # Export the public certificate in PEM format. Export-Certificate defaults
    # to DER encoding which Node.js cannot parse when it expects PEM, so the
    # certificate bytes are manually Base64 encoded with the appropriate
    # delimiters to produce a valid PEM file.
    $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $certPem = "-----BEGIN CERTIFICATE-----`n" +
        [System.Convert]::ToBase64String($certBytes, [System.Base64FormattingOptions]::InsertLineBreaks) +
        "`n-----END CERTIFICATE-----"
    Set-Content -Path (Join-Path $certDir 'mingle.cert') -Value $certPem

    # Export the private key in PKCS#8 PEM format. PowerShell cannot invoke
    # extension methods using instance syntax, so call the static extension
    # helper to retrieve the RSA key.
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    if (-not $rsa) {
        Write-Error "Certificate does not contain an RSA private key."
        exit 1
    }
    $keyBytes = $rsa.ExportPkcs8PrivateKey()
    $keyPem = "-----BEGIN PRIVATE KEY-----`n" +
        [System.Convert]::ToBase64String($keyBytes, [System.Base64FormattingOptions]::InsertLineBreaks) +
        "`n-----END PRIVATE KEY-----"
    Set-Content -Path (Join-Path $certDir 'mingle.key') -Value $keyPem

    # Clean up the certificate store to avoid clutter.
    Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force

    Write-Host "Certificate and key generated in $certDir"
} catch {
    Write-Error "Failed to generate certificate: $_"
    exit 1
}
