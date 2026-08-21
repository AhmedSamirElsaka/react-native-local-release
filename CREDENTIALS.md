# Credentials guide (v2)

This toolkit stores **references** in the repo and keeps secret material out of Git.

## Providers

### 1. Keychain + vault (default on macOS)

- Scalar secrets (ASC key id, issuer id, keystore passwords) → macOS Keychain service `rn-local-release:<project-folder>`
- File material (`.p8`, Play JSON) → `~/.rn-local-release/vault/<project>/` with directory mode `0700` and files `0600`
- `fastlane/.env` contains **non-secret path references** only (no passwords)

### 2. File fallback (explicit)

Use when Keychain is unavailable (Linux/Windows) or you opt in during configure.

Writes (all `0600`, directories `0700`):

- `fastlane/.env`
- `android/keystore.properties`
- `secrets/AuthKey_*.p8`
- `secrets/play-store-service-account.json`

These paths are gitignored by the installer marker block. The CLI refuses to write if Git already tracks them.

## Least privilege

### Apple App Store Connect API

Prefer an **App Manager** or custom role limited to the single app — not Account Holder / Admin — with keys scoped to that app.

### Google Play

Use a dedicated service account with **Release Manager** (or narrower) on one app. Do not reuse organization-wide Owner keys.

### Android upload keystore

Keep one upload keystore per app. Store the file outside VCS. Rotate only with Google Play App Signing support.

## Interactive setup

```bash
rn-local-release configure --project .
# or during install (default prompt)
rn-local-release install --project .
```

Passwords are hidden (no echo). Values are never printed back.

## Audit

```bash
rn-local-release audit --project .
```

Checks whether credential paths are tracked/ignored.

## Rotation / revocation

1. Rotate ASC API key in App Store Connect; delete old Keychain entries / vault files.
2. Rotate Play service-account key in Google Cloud; replace vault/file copy.
3. Change keystore passwords only if your org policy requires it; update Keychain or `keystore.properties`.
4. Run `rn-local-release uninstall --project . --purge-credentials --yes` only when intentionally wiping local secrets.

## Leak response

1. Revoke the exposed key immediately (ASC / Google Cloud / keystore).
2. Rotate related passwords.
3. Search git history for the secret; if found, treat the repository as compromised for that credential.
4. Open a private security advisory if the leak originated from this toolkit.

## Permissions checklist

```bash
chmod 700 secrets ~/.rn-local-release/vault
chmod 600 fastlane/.env android/keystore.properties secrets/* ~/.rn-local-release/vault/**/*
```

Never commit `credentials.txt`, `.p8`, Play JSON, or keystores.
