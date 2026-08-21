# Local store credentials (never commit)

Place App Store Connect `.p8` keys and Google Play service-account JSON files here.
Reference them from `fastlane/.env` with relative paths such as:

```bash
ASC_KEY_FILEPATH=secrets/AuthKey_XXXXXXXXXX.p8
PLAY_JSON_KEY_PATH=secrets/play-store-service-account.json
```

Keep Android upload keystores under `android/app/` (for example `keystore.jks`) and
passwords in `android/keystore.properties` or `fastlane/.env`.
