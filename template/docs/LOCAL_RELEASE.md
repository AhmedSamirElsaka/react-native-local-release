# Local Fastlane release (laptop CI/CD)

This project uses **react-native-local-release**: a copyable local Fastlane kit for
React Native iOS + Android. There is no remote CI requirement. Uploads are deliberate.

## Split of concerns

| Kind | Where | Examples |
|------|-------|----------|
| Tracked metadata | `fastlane/release.config.json` | package name, team ID, scheme, tracks, version sources |
| Local credentials | `fastlane/.env`, `android/keystore.properties`, `secrets/` | ASC `.p8`, Play JSON, keystore passwords |

Never paste private keys, passwords, or JSON credentials into Git, chat, docs, or screenshots.

## Install into another RN app

From a machine that already has this kit:

```bash
node /path/to/tools/react-native-local-release/install.mjs --project /path/to/YourApp
```

Useful flags:

```bash
--dry-run
--team-id YOURTEAMID
--package-name com.example.app
--ios-scheme YourScheme
--fixed-ios-build 1          # fixed CFBundleVersion policy
--non-interactive            # fail instead of prompting when detection is incomplete
```

Then copy credentials and validate:

```bash
cp fastlane/.env.example fastlane/.env
cp android/keystore.properties.example android/keystore.properties
# place secrets/*.p8 and Play JSON under secrets/
yarn release:doctor
yarn release:credentials
```

## Prerequisites

- macOS with Xcode (iOS archive/export)
- Android SDK / JDK used by the project Gradle wrapper
- Node 18+, Yarn/npm/pnpm
- Ruby 3.2.x via rbenv (Ruby 4 is not supported by current Fastlane gems yet)
- App Store Connect API key + Play Console service account
- Existing Android upload keystore (local only)

```bash
rbenv install -s 3.2.2
rbenv local 3.2.2
bundle install
```

## Signing notes

- App Store Connect API keys authorize **upload/metadata** actions.
- Local Apple **code signing** still needs a valid Distribution certificate and App Store
  provisioning profile in the login keychain (automatic signing + `-allowProvisioningUpdates`).
- Optional `match` support is not included in this kit yet.

## Daily commands

| Goal | Command |
|------|---------|
| Config / path doctor | `yarn release:doctor` |
| Validate Apple + Google keys | `yarn release:credentials` |
| JS checks | `yarn release:verify` |
| Bump versions | `yarn release:bump` |
| Compile both (no upload) | `yarn release:compile` |
| Upload from compile manifest | `yarn release:upload` |
| Bump + compile + upload both | `yarn release:beta` |
| App Review (explicit) | `bundle exec fastlane ios promote version:X.Y.Z build:N` |
| Play promote (explicit) | `bundle exec fastlane android promote version_code:N` |

`compile` does **not** bump versions. `beta` bumps by default unless `skip_bump:true`.

Recommended flow:

1. `yarn release:compile`
2. Inspect `build/release-manifest.json` and artifact sizes
3. `yarn release:upload` **or** `yarn release:beta`
4. Install from TestFlight / Play internal and confirm launch
5. Promote with explicit version/build inputs

## Versioning

- Marketing version stays aligned across configured sources (`package.json`, Android Gradle, iOS pbxproj, optional string literals).
- Android `versionCode` increments on bump.
- iOS build number follows `ios.buildNumberStrategy`:
  - `increment` (default template): mirrors Android build
  - `fixed` with `value: 1`: each TestFlight upload needs a new marketing version

## Size and crash symbols

- Phone ABIs only (`armeabi-v7a`, `arm64-v8a`) are recommended for store builds.
- R8 full mode should stay off for React Native unless you have proven keep rules.
- Compile prints IPA/AAB sizes; optional budgets live under `build.maxIpaSizeMb` / `build.maxAabSizeMb`.
- Android Crashlytics mapping upload is project-specific; keep it disabled until the Gradle plugin is compatible, then re-enable carefully.
- Compile cannot prove there is no runtime crash. Optional physical-device smoke tests remain the only useful launch gate.

## What this kit does not do

- No GitHub Actions / Bitrise / remote runners
- No automatic production publish on every build
- No automatic store metadata / screenshot sync
- No `match` certificate repo (uses local Xcode automatic signing)

## Planned / optional enhancements

- Optional physical-device Release smoke test before upload (compile cannot prove launch safety)
- Re-enable Crashlytics Android mapping upload after Gradle plugin compatibility is verified
- Optional `bundletool` get-size estimates and stricter size budgets in `release.config.json`
- Optional `match` for multi-machine Apple signing
- Publish the kit as a versioned npm package once it has been reused across several apps
