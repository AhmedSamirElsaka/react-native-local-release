#!/usr/bin/env bash
# Print SHA-256 fingerprints for Android signing keys used by this project.
# For Play Store builds, assetlinks.json must include the Play App Signing SHA-256
# from Play Console (App integrity → Play app signing), not only these local keys.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../android/app" && pwd)"
ANDROID_ROOT="$(cd "$(dirname "$0")/../android" && pwd)"
DEBUG_KEYSTORE="$ROOT/debug.keystore"
UPLOAD_KEYSTORE="$ROOT/keystore.jks"

load_prop() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}"
    return
  fi
  if [[ -f "$ANDROID_ROOT/keystore.properties" ]]; then
    local value
    value="$(grep -E "^${name}=" "$ANDROID_ROOT/keystore.properties" | tail -n1 | cut -d= -f2- || true)"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
  fi
  printf ''
}

print_fingerprint() {
  local label="$1"
  local keystore="$2"
  local alias="$3"
  local storepass="$4"

  if [[ ! -f "$keystore" ]]; then
    echo "[$label] keystore not found: $keystore"
    return
  fi

  if [[ -z "$storepass" ]]; then
    echo "[$label] missing store password. Set MYAPP_UPLOAD_STORE_PASSWORD or android/keystore.properties."
    return
  fi

  echo "=== $label ==="
  keytool -list -v \
    -keystore "$keystore" \
    -alias "$alias" \
    -storepass "$storepass" \
    -keypass "${MYAPP_UPLOAD_KEY_PASSWORD:-$storepass}" 2>/dev/null | grep -E "Alias name:|SHA1:|SHA256:"
  echo
}

UPLOAD_ALIAS="$(load_prop MYAPP_UPLOAD_KEY_ALIAS)"
UPLOAD_ALIAS="${UPLOAD_ALIAS:-key0}"
UPLOAD_PASS="$(load_prop MYAPP_UPLOAD_STORE_PASSWORD)"

print_fingerprint "Debug (debug.keystore)" "$DEBUG_KEYSTORE" androiddebugkey android
print_fingerprint "Upload (keystore.jks)" "$UPLOAD_KEYSTORE" "$UPLOAD_ALIAS" "$UPLOAD_PASS"

echo "Play App Signing SHA-256 must come from Play Console (App integrity → Play app signing)."
