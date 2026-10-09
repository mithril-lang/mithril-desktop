# Developer ID G2 intermediate

`developer-id-g2.cer` is Apple's public Developer ID G2 intermediate certificate, downloaded from https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer on 2026-10-09. It contains no private key.

SHA-256: `f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a`.

The signing script checks this digest, verifies the certificate against the worker's system roots, and imports it only into the workflow's temporary keychain. Updating it requires reviewing the official Apple PKI source and validity; do not replace it with an unverified mirror or change system trust settings.
