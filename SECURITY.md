# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| 1.x     | Security fixes only until 2026-12-31 |

## Reporting a vulnerability

Please open a private GitHub Security Advisory on this repository, or email the maintainer via the contact listed on the GitHub profile.

Do **not** open a public issue for credential leaks, RCE, or path-traversal reports.

Include:
- Affected version / commit
- Reproduction steps (without real secrets)
- Impact assessment

We aim to acknowledge reports within 7 days.

## Threat model (summary)

This toolkit runs on a developer machine and writes Fastlane/Gradle/Xcode release config into an app repository.

Trusted:
- The local developer
- The target app repository they choose with `--project`

Untrusted:
- Values inside `release.config.json` command fields (must be allowlisted argv)
- Paths supplied for credentials and version files (must stay within project root or an explicit external vault)
- Network responses from Apple / Google APIs

Secrets must never appear in:
- git history
- install manifests
- crash logs
- generated docs
- process argv
- CI artifacts

Default credential storage on macOS is Keychain + per-user vault (`~/.rn-local-release/vault`) with `0700` / `0600` permissions. Plaintext project files are an explicit fallback.
