# React Native Local Release

[![CI](https://github.com/AhmedSamirElsaka/react-native-local-release/actions/workflows/ci.yml/badge.svg)](https://github.com/AhmedSamirElsaka/react-native-local-release/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](package.json)

An interactive, zero-runtime-dependency toolkit that adds a secure local
[Fastlane](https://fastlane.tools/) release pipeline to an existing React Native
iOS and Android application.

It automates signed IPA/AAB builds, TestFlight and Play internal uploads, explicit
production promotion, version synchronization, credential validation, and artifact
integrity checks—without requiring a hosted CI service.

## Why I built it

Release setup is often copied between React Native projects with hardcoded bundle
IDs, signing passwords, schemes, and store tracks. This toolkit detects project
metadata, keeps credentials outside Git, and generates one configurable workflow
that can be reused safely.

## Features

- Interactive project detection for Android and iOS metadata
- **Always updates `.gitignore`** so credentials, keystores, IPA/AAB, and secrets stay untracked
- **Interactive credential setup during install** (optional, gitignored files only)
- Config-driven Fastlane lanes with no app-specific IDs in lane code
- Build both platforms before uploading either
- SHA-256 release manifest to prevent stale artifact uploads
- Independent marketing, Android, and iOS build-number strategies
- Explicit internal/beta upload and production promotion phases
- Local signing validation with secret-safe examples
- IPA/AAB size reporting and optional size budgets
- Idempotent installer with `--dry-run`, backups, and fixture tests
- Yarn, npm, and pnpm project detection

## Release flow

```text
detect project → generate config → optional credential setup → doctor
              → prepare version → compile IPA + AAB → checksum manifest
              → TestFlight + Play internal → explicit production promotion
```

Compilation validates types, native bundling, signing, and export. It cannot prove
that an application will not crash at runtime; install the internal build on a real
device before promoting it.

## Installation

### From Git (easiest)

```bash
npx github:AhmedSamirElsaka/react-native-local-release --project /path/to/YourReactNativeApp
```

Or clone once and reuse:

```bash
git clone https://github.com/AhmedSamirElsaka/react-native-local-release.git
node react-native-local-release/install.mjs --project /path/to/YourReactNativeApp
```

### From GitHub Packages

```bash
# One-time: PAT with read:packages
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc
npm config set @ahmedsamirelsaka:registry https://npm.pkg.github.com

npx @ahmedsamirelsaka/react-native-local-release --project /path/to/YourReactNativeApp
```

The installer:

1. Detects package name, workspace/scheme, team ID, and versions
2. Writes Fastlane config + scripts
3. Asks: **Configure Apple / Play / keystore credentials now?**
4. If you choose **yes**, prompts for keys/paths/passwords and writes gitignored files
5. Copies key material into `secrets/` (and keystore into `android/app/` when needed)

Useful options:

```bash
rn-local-release --project . --dry-run
rn-local-release --project . --team-id YOURTEAMID
rn-local-release --project . --ios-scheme YourScheme
rn-local-release --project . --fixed-ios-build 1
rn-local-release --project . --setup-credentials   # force credential prompts
rn-local-release --project . --skip-credentials    # never prompt for secrets
rn-local-release --project . --credentials-only    # only write secrets
rn-local-release --project . --non-interactive
```

Kotlin DSL (`android/app/build.gradle.kts`) is intentionally rejected for now;
the Android installer currently supports the default React Native Groovy layout.

## How to get credentials

Step-by-step creation of App Store Connect API keys, Play service accounts, and
Android upload keystores:

**→ [CREDENTIALS.md](./CREDENTIALS.md)**

After install, the same guide is copied into the app as
`docs/RELEASE_CREDENTIALS.md`.

## Credential setup

### Interactive (recommended)

Say **yes** when the installer asks, or run later:

```bash
cd /path/to/YourReactNativeApp
npx @ahmedsamirelsaka/react-native-local-release --project . --credentials-only
```

### Manual

```bash
cp fastlane/.env.example fastlane/.env
cp android/keystore.properties.example android/keystore.properties
# place secrets/*.p8 and Play JSON under secrets/
```

Then validate:

```bash
bundle install
yarn release:doctor
yarn release:credentials
```

On every install (and on `--credentials-only`), the toolkit creates or updates
`.gitignore` with a marked `rn-local-release` block covering `.env`, keystores,
`secrets/*`, IPA/AAB, and release manifests. The installer never prints credential
values after entry.

## Commands installed in the target project

```bash
yarn release:doctor       # validate config and project paths
yarn release:verify       # install, lint, typecheck, and test
yarn release:prepare      # bump/set versions only
yarn release:compile      # build IPA + AAB, no bump and no upload
yarn release:upload       # upload checksummed artifacts from the manifest
yarn release:beta         # bump + compile + upload both internal builds
```

Platform-specific build, upload, beta, and promote commands are also generated.
Production promotion always requires explicit version/build inputs and a clean Git
working tree.

## Generated files

- `fastlane/release.config.json` — tracked, non-secret project metadata
- `fastlane/Fastfile` and `fastlane/lib/rn_local_release.rb`
- `fastlane/.env.example`
- `android/keystore.properties.example`
- `ios/exportOptions.plist`
- `docs/LOCAL_RELEASE.md`
- `docs/RELEASE_CREDENTIALS.md`
- `scripts/print-android-signing-fingerprints.sh`
- secure `.gitignore` rules and `secrets/` layout

Project-specific entitlements, SDK initialization, and ProGuard rules remain owned
by the target application. The installer does not overwrite them.

## Versioning

The default policy increments the marketing patch version and Android/iOS build
numbers. A project can configure fixed iOS build numbers when every upload uses a
new marketing version:

```json
{
  "ios": {
    "buildNumberStrategy": {
      "mode": "fixed",
      "value": 1
    }
  }
}
```

## Development

```bash
npm test
npm run pack:check
node install.mjs --project /path/to/app --dry-run
```

Tests cover detection, config validation, fixed/incrementing version strategies,
idempotent patches, dry runs, secret stripping, and generated output.

## Roadmap

- Kotlin DSL Android projects
- Optional physical-device release smoke test
- Firebase Crashlytics mapping/dSYM upload adapters
- `bundletool` delivered-size estimates
- Optional Fastlane `match` support for multi-machine Apple signing

## Author

Created by [Ahmed Samir Elsaka](https://github.com/AhmedSamirElsaka), React Native
and Android developer.

## License

[MIT](LICENSE)
