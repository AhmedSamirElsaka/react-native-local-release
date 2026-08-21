# Migrating from v1 to v2

1. Install the new CLI:
   ```bash
   npm i -D @ahmedsamirelsaka/react-native-local-release@2.0.0
   npx rn-local-release migrate --project .
   ```
2. Re-run install to refresh Fastlane templates (config is merged, not wiped):
   ```bash
   npx rn-local-release install --project . --skip-credentials
   ```
3. Move secrets to Keychain/vault (macOS):
   ```bash
   npx rn-local-release configure --project .
   ```
4. Confirm gitignore includes `logs/`, `versions/`, and the `# >>> rn-local-release` block.
5. Optionally enable upload archives:
   ```bash
   # set archives.storeUploadedVersions=true in release.config.json
   # or reinstall with --store-uploaded-versions
   ```

## Behavior changes to expect

- Shell-style verify commands with `;` / `|` / `$()` are rejected.
- Promote lanes require `RN_LOCAL_RELEASE_YES=1`.
- Install no longer changes ABI list or R8 fullMode.
- Kotlin DSL projects are supported via `android.dsl=kotlin`.
