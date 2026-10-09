#!/bin/bash

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${CSC_LINK:?CSC_LINK is required}"
: "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD is required}"

signing_dir="$RUNNER_TEMP/hermes-macos-signing"
certificate_path="$signing_dir/developer-id.p12"
keychain_path="$signing_dir/hermes-signing.keychain"
keychain_password="${MACOS_KEYCHAIN_PASSWORD:-$(openssl rand -hex 32)}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
intermediate_path="$script_dir/certificates/developer-id-g2.cer"
keychain_created=false

mkdir -p "$signing_dir"
chmod 700 "$signing_dir"

cleanup_certificate() {
  local status=$?
  rm -f "$certificate_path"
  if [ "$status" -ne 0 ] && [ "$keychain_created" = true ]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup_certificate EXIT

echo "::add-mask::$keychain_password"
printf '%s' "$CSC_LINK" | base64 --decode > "$certificate_path"
chmod 600 "$certificate_path"

security create-keychain -p "$keychain_password" "$keychain_path"
keychain_created=true
security unlock-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"

# Headless workers may lack Xcode's automatically installed G2 intermediate.
# Verify Apple's pinned public certificate without changing system trust.
printf '%s  %s\n' \
  f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a \
  "$intermediate_path" | shasum -a 256 -c - >/dev/null
security verify-cert -c "$intermediate_path" -p basic >/dev/null
security import "$intermediate_path" -k "$keychain_path"

# Keep the temporary keychain in the user search list. On macOS 26.6,
# `security find-identity <keychain>` can see an imported identity while
# `codesign --keychain <keychain>` still rejects it unless it is also listed.
existing_keychains=()
while IFS= read -r existing_keychain; do
  existing_keychain="${existing_keychain#"${existing_keychain%%[![:space:]]*}"}"
  existing_keychain="${existing_keychain#\"}"
  existing_keychain="${existing_keychain%\"}"
  if [ -n "$existing_keychain" ] && [ "$existing_keychain" != "$keychain_path" ]; then
    existing_keychains+=("$existing_keychain")
  fi
done < <(security list-keychains -d user)
if [ "${#existing_keychains[@]}" -gt 0 ]; then
  security list-keychains -d user -s "$keychain_path" "${existing_keychains[@]}"
else
  security list-keychains -d user -s "$keychain_path"
fi

security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/productbuild

# macOS 26.6 requires the keychain password here. Electron Builder 26 passes
# CSC_KEY_PASSWORD (the .p12 password), which leaves the imported key unusable.
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path"

# Consume the full identity list: grep -q can close the pipe early, causing
# security to exit with SIGPIPE and pipefail to reject a valid identity.
if ! security find-identity -v -p codesigning "$keychain_path" | grep "Developer ID Application" > /dev/null; then
  echo "No Developer ID Application identity was imported." >&2
  exit 1
fi

echo "CSC_KEYCHAIN=$keychain_path" >> "$GITHUB_ENV"
