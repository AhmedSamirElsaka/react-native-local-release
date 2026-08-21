# Architecture (v2)

```
src/
  cli.ts              command router + argv parsing
  install.ts          transactional install / uninstall
  detect.ts           Android/iOS/package-manager detectors
  config.ts           schema validate + migrate + merge
  credentials.ts      Keychain/vault/file providers
  patch.ts            marker-owned file adapters
  process.ts          argv-only spawn (no shell)
  logging.ts          redacted logs/ under project
  paths.ts            containment + ID validation
  fs.ts               secure modes 0600/0700
  types.ts            shared contracts

template/fastlane/
  Fastfile
  lib/rn_local_release.rb   versioning, manifests, upload journal, archives
schema/release.config.schema.json
```

Dependency direction: CLI → install/detect/config/credentials → fs/paths/process/logging.

Unsupported layouts fail before writes.
