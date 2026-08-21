# Contributing

1. Use Node 18+.
2. `npm ci && npm test`
3. Keep changes small and typed (`src/`).
4. Never commit secrets, real keystores, or customer app credentials.
5. Add fixtures under `test/fixtures/` for new layout support.
6. Prefer argv-based process execution (`shell: false`).
7. Update `CHANGELOG.md` for user-visible changes.

## Release

1. Bump `package.json` version.
2. Tag `vX.Y.Z` matching that version.
3. GitHub Actions publishes to npmjs with provenance and attaches the tarball + checksums to the Release.
