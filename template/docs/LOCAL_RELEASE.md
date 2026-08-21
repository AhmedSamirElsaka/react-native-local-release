# Local Fastlane release (laptop CI/CD)

This project uses **[@ahmedsamirelsaka/react-native-local-release](https://www.npmjs.com/package/@ahmedsamirelsaka/react-native-local-release)** v2:
a security-first local Fastlane kit for bare React Native iOS + Android.

## Split of concerns

| Kind | Where | Examples |
|------|-------|----------|
| Tracked metadata | `fastlane/release.config.json` | package name, team ID, scheme, tracks, version sources, logging, archives |
| Managed install state | `.rn-local-release/manifest.json` | hashes of managed files (non-secret) |
| Local credentials | Keychain/vault (default macOS) or `fastlane/.env` + `secrets/` | ASC `.p8`, Play JSON, keystore passwords |
| Crash logs | `logs/` (gitignored, redacted) | installer / Fastlane failures |
| Optional upload archive | `versions/` (gitignored, opt-in) | copies of uploaded IPA/AAB |

Never paste private keys, passwords, or JSON credentials into Git, chat, docs, or screenshots.

How to create credentials: see [RELEASE_CREDENTIALS.md](./RELEASE_CREDENTIALS.md).

## Install / reinstall

Prefer an **exact npm version** (do not run floating `github:` HEAD in daily workflows):

```bash
npx @ahmedsamirelsaka/react-native-local-release@2.0.0 install --project .
```

Useful flags:

```bash
--dry-run
--team-id YOURTEAMID
--package-name com.example.app
--ios-scheme YourScheme
--fixed-ios-build 1
--store-uploaded-versions / --no-store-uploaded-versions
--setup-credentials / --skip-credentials
--credentials-only
--non-interactive
```

Interactive install asks:

1. Configure Apple / Play / keystore now?
2. Store uploaded IPA/AAB copies under `versions/`?

Reinstall merges existing `release.config.json` instead of wiping custom tracks/gates.

## Prerequisites

- macOS with Xcode (iOS)
- Android SDK / JDK for Gradle
- Node 18+, Yarn/npm/pnpm
- Ruby compatible with Fastlane (`bundle install`)
- ASC API key + Play service account + upload keystore

## Daily commands

```bash
bundle install
yarn release:doctor
yarn release:credentials
yarn release:compile     # typecheck + IPA + AAB (no bump, no upload)
yarn release:upload      # upload last compile
yarn release:beta        # bump + compile + upload
```

Promote to production requires confirmation:

```bash
RN_LOCAL_RELEASE_YES=1 yarn release:ios:promote version:x.y.z build:n
RN_LOCAL_RELEASE_YES=1 yarn release:android:promote version_code:n
```

## Uninstall

```bash
npx @ahmedsamirelsaka/react-native-local-release@2.0.0 uninstall --project . --yes
```

## Troubleshooting

- Check redacted files under `logs/`
- Run `rn-local-release audit --project .` if credentials look tracked
- Partial dual-upload failures leave `build/upload-journal.json` describing which store succeeded
