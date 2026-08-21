# How to get release credentials

This kit never needs credentials in Git. You create Apple, Google, and Android
signing secrets once, then either:

1. Answer **yes** when the installer asks to configure credentials, or
2. Run `rn-local-release --project . --credentials-only`, or
3. Copy the example files and fill them manually.

Written files (gitignored):

| File | Purpose |
|------|---------|
| `fastlane/.env` | ASC + Play paths + optional keystore env mirrors |
| `android/keystore.properties` | Gradle release signing |
| `secrets/*.p8` | App Store Connect API private key |
| `secrets/*.json` | Google Play service-account key |
| `android/app/*.jks` | Upload keystore (keep local) |

On every install (and `--credentials-only`), the toolkit **creates or updates**
`.gitignore` with a `# >>> rn-local-release` block so these paths stay untracked
even if the project had no `.gitignore` yet.

Never commit these files, paste them into chat, or screenshot their contents.

---

## 1. Apple App Store Connect API key

Used by Fastlane to upload IPAs to TestFlight / App Store Connect.

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com/).
2. Open **Users and Access** → **Integrations** → **App Store Connect API**.
3. Click **Generate API Key** (Admin or App Manager role is typical).
4. Name it something like `Local Fastlane`, choose **Admin** or **App Manager**.
5. After creation, copy:
   - **Issuer ID** (top of the page) → `ASC_ISSUER_ID`
   - **Key ID** → `ASC_KEY_ID`
6. Download the **`.p8`** file once (Apple only shows it once).
7. Store it as `secrets/AuthKey_<KEY_ID>.p8` in your app repo (gitignored).

Also ensure this Mac has a valid **Apple Distribution** certificate and an App Store
provisioning profile for the app (Xcode → Settings → Accounts, or automatic signing
with `-allowProvisioningUpdates`). The API key authorizes uploads; local Xcode still
signs the IPA.

Official docs: [Creating API Keys for App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api)

---

## 2. Google Play service account

Used by Fastlane to upload AABs to the Play Console internal (or other) track.

1. Open [Google Play Console](https://play.google.com/console/) → your app.
2. Go to **Setup** → **API access** (or **Users and permissions** → **API access**).
3. Link or create a Google Cloud project if prompted.
4. Create a **service account** in Google Cloud Console with permission to manage
   Play releases (Play Console invites the service-account email).
5. In Play Console, invite that service-account email with at least **Release to
   testing tracks** (or Admin) access.
6. In Google Cloud → IAM → Service Accounts → Keys → **Add key** → JSON.
7. Save the downloaded JSON under `secrets/` (gitignored), e.g.
   `secrets/play-store-service-account.json`.
8. Set `PLAY_JSON_KEY_PATH` in `fastlane/.env` to that relative path.

The first upload for an app often requires the Play app to already exist and the
service account to have accepted access (can take a few minutes).

Official docs: [Getting started with the Google Play Developer API](https://developers.google.com/android-publisher/getting_started)

---

## 3. Android upload keystore

Used by Gradle to sign the release AAB/APK.

If you already ship on Play, use the **same upload keystore** you used before
(otherwise Play will reject the signature).

Create a new one only for a brand-new app:

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore android/app/keystore.jks \
  -alias key0 \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Then set in `android/keystore.properties` (and optionally mirror in `fastlane/.env`):

- `MYAPP_UPLOAD_STORE_FILE` — filename under `android/app/` (e.g. `keystore.jks`)
- `MYAPP_UPLOAD_KEY_ALIAS` — alias (e.g. `key0`)
- `MYAPP_UPLOAD_STORE_PASSWORD` / `MYAPP_UPLOAD_KEY_PASSWORD`

Verify fingerprints (must match Play Console “App signing” upload certificate):

```bash
./scripts/print-android-signing-fingerprints.sh
```

---

## Interactive setup (recommended)

During install:

```bash
npx @ahmedsamirelsaka/react-native-local-release --project .
# When asked: Configure Apple / Play / keystore credentials now? → y
```

Or later:

```bash
npx @ahmedsamirelsaka/react-native-local-release --project . --credentials-only
```

The CLI asks for Key ID, Issuer ID, paths to `.p8` / Play JSON / keystore, alias,
and passwords. It copies key files into `secrets/` (and the keystore into
`android/app/` when needed) and writes gitignored config files.

Skip with `--skip-credentials` or `--non-interactive`.

---

## Validate

```bash
bundle install
yarn release:doctor
yarn release:credentials
```

`release:credentials` checks that files exist and that Apple/Play APIs accept the keys.
It does not print secret values.

---

## Security checklist

- [ ] `fastlane/.env` is gitignored
- [ ] `android/keystore.properties` is gitignored
- [ ] `secrets/` contents (except README / `.gitignore`) are gitignored
- [ ] Keystore is backed up offline (losing it can lock you out of Play updates)
- [ ] API keys can be revoked in App Store Connect / Google Cloud if leaked
