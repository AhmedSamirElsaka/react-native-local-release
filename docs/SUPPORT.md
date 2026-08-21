# Support policy

| Component | Support window |
|-----------|----------------|
| Toolkit 2.x | Current major |
| Toolkit 1.x | Security fixes until 2026-12-31 |
| React Native | Versions listed in CI fixtures (0.8x bare) |
| Fastlane | Compatible with `~> 2.234` |
| Node | 18, 20, 22 |

Unsupported (won't be fixed as product bugs):

- Expo managed / EAS
- Arbitrary custom native layouts without standard `android/app/build.gradle(.kts)` + `ios/*.xcworkspace`
- Remote CI orchestration (this toolkit is laptop-local by design)

When React Native, Xcode, Gradle, or Fastlane break detection, open an issue with fixture repro. Deprecation notices land in CHANGELOG before major bumps.
