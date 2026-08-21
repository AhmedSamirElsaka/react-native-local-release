# react-native-local-release

Security-first local Fastlane release toolkit for **bare** React Native apps (iOS + Android).

Package: `@ahmedsamirelsaka/react-native-local-release`  
Version: **2.0.0-rc.1** (npmjs + GitHub Releases; publish under tag `next` until stable)

## Supported

| Area | Support |
|------|---------|
| Bare React Native | Yes |
| Android Groovy DSL | Yes |
| Android Kotlin DSL (`.kts`) | Yes |
| npm / Yarn / pnpm | Yes |
| Common monorepo layouts | Detected; install into the app package root |
| macOS (iOS + Android) | Yes |
| Linux/Windows (Android-focused) | Android lanes; iOS requires macOS |
| Expo managed / EAS | **Not supported** — stop and use Expo tooling |

## Quick start (npm)

```bash
# From your React Native app root
npx @ahmedsamirelsaka/react-native-local-release@2.0.0-rc.1 install --project .

# Prefer an exact version in package.json so daily commands do not float:
# "devDependencies": { "@ahmedsamirelsaka/react-native-local-release": "2.0.0-rc.1" }
```

Useful flags:

```bash
--dry-run
--non-interactive --skip-credentials
--team-id ABCD123456
--fixed-ios-build 1
--store-uploaded-versions          # keep IPA/AAB copies under versions/
--no-store-uploaded-versions
```

During install you will be asked (interactive mode):

1. Whether to configure Apple / Play / keystore credentials now
2. Whether to archive each uploaded build under `versions/`

## Commands

```bash
rn-local-release install --project .
rn-local-release configure --project .     # credentials
rn-local-release doctor --project .
rn-local-release audit --project .         # credential tracking / ignore checks
rn-local-release migrate --project .
rn-local-release uninstall --project . [--purge-credentials] [--yes]
rn-local-release verify|build|upload|beta|promote --project .
```

After install, app scripts (examples):

```bash
yarn release:doctor
yarn release:credentials
yarn release:compile          # typecheck + IPA + AAB, no bump, no upload
yarn release:upload           # upload previous compile (no bump)
yarn release:beta             # bump + compile + upload
```

Production promote requires an explicit confirmation env:

```bash
RN_LOCAL_RELEASE_YES=1 yarn release:ios:promote version:1.2.3 build:1
RN_LOCAL_RELEASE_YES=1 yarn release:android:promote version_code:42
```

## Security defaults

- macOS: **Keychain** for passwords + per-user vault for `.p8` / Play JSON (`~/.rn-local-release/vault`, `0700`/`0600`)
- Passwords are **never echoed**; secrets are never written to manifests, crash logs, or docs
- Verify/build commands are **argv-allowlisted** (no `;`, `|`, `$()`, etc.)
- Install is transactional with rollback; uninstall restores/removes only unchanged managed files
- Crashes and Fastlane failures write redacted files under `logs/`
- Optional `versions/` archive of uploaded artifacts (gitignored)

See [CREDENTIALS.md](./CREDENTIALS.md) and [SECURITY.md](./SECURITY.md).

## Config

`fastlane/release.config.json` (schema v2) controls platforms, version sources, gates, credential provider, logging, and archives. Reinstall **merges** detected defaults under your existing config unless you pass `--force` carefully.

## Uninstall

```bash
rn-local-release uninstall --project . --yes
# Also wipe Keychain/vault material:
rn-local-release uninstall --project . --yes --purge-credentials
```

## Limitations

- Does not support Expo-managed workflows
- Does not invent signing identities — you must already have Apple/Google release credentials
- Does not replace App Store Connect / Play Console review policies
- Ruby/Fastlane must be installable on the machine (`bundle install`)

## Migration from 1.x

See [CHANGELOG.md](./CHANGELOG.md). Run `rn-local-release migrate --project .` then `configure`.

## License

MIT
