# Changelog

## 2.0.0-rc.3

- Fix: Fastlane now materializes Android signing passwords from macOS Keychain when `credentials.provider` is `keychain`.
  `yarn release:beta` (direct Fastlane) no longer fails with `Missing MYAPP_UPLOAD_STORE_PASSWORD` after a Keychain install.
- Treat literal empty quotes in `.env` / `keystore.properties` as empty values.

## 2.0.0-rc.2

- Remove maintainer-only `docs/PUBLISHING.md` from the published package and GitHub tree.
- README / docs scrubbed for public launch (no local paths or token-setup checklists).

## 2.0.0-rc.1

Security-first rewrite for bare React Native apps (release candidate).

### Breaking
- CLI rewritten in TypeScript (`rn-local-release <command>`). Publish target is npmjs with provenance.
- `release.config.json` schema version 2 (credentials/logging/archives/platform DSL fields).
- Install no longer forces `reactNativeArchitectures` or `android.enableR8.fullMode`.
- Verify/build commands are argv-allowlisted (no shell metacharacters).
- Production promote requires `RN_LOCAL_RELEASE_YES=1` (or CI).
- Default credential provider on macOS is Keychain + vault (not plaintext `.env` passwords).

### Added
- Commands: `install`, `configure`, `doctor`, `verify`, `build`, `upload`, `beta`, `promote`, `migrate`, `uninstall`, `audit`.
- Transactional install with `.rn-local-release/manifest.json` and safe uninstall.
- Groovy **and** Kotlin DSL Android adapters.
- Platform-specific release manifests + resumable upload journal.
- Crash/issue logs under `logs/` (redacted).
- Optional `versions/` archive of uploaded IPA/AAB (asked during install).
- Hidden password prompts, `0600`/`0700` secret files, credential audit.
- CI: SHA-pinned actions, npm provenance publish workflow, Dependabot.

### Migration
1. Install `2.0.0-rc.3` (or newer) from npm (dist-tag `next`).
2. Run `rn-local-release migrate --project .` (or reinstall; existing config is merged).
3. Prefer Keychain credentials: `rn-local-release configure --project .`
4. Confirm `.gitignore` includes `logs/`, `versions/`, and the marked credential block.

## 1.1.x

Initial interactive Fastlane toolkit published to GitHub Packages.
