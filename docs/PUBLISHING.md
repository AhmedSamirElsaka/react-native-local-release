# Publishing to npm (`@ahmedsamirelsaka/react-native-local-release`)

CI and GitHub Releases already work. npm publish fails with **`ENEEDAUTH`** until **you** add registry credentials. This cannot be done by the CI bot alone.

Choose **Path A** (fastest) or **Path B** (OIDC, no long-lived token).

---

## Path A — Automation token (recommended for first publish)

### 1. Create / sign in to npm

1. Open https://www.npmjs.com/signup (or https://www.npmjs.com/login).
2. Prefer username **`ahmedsamirelsaka`** so the scope `@ahmedsamirelsaka` matches the package name.  
   If you already use another username, either:
   - change `package.json` `"name"` to `@YOUR_NPM_USER/react-native-local-release`, or
   - create an npm **Organization** named `ahmedsamirelsaka` and add yourself as owner.

### 2. Enable 2FA (required for publishing)

npm → **Account** → **Access Tokens** / Security → enable 2FA (auth-and-writes or auth-only + granular tokens).

### 3. Create an Automation token

1. https://www.npmjs.com/settings/~/tokens  
   (or Organization → Access Tokens if publishing under an org)
2. **Generate New Token** → **Granular Access Token** (preferred) or classic **Automation**.
3. Settings that work:
   - **Type:** Automation (classic) **or** Granular with permission **Read and write** on packages
   - **Packages:** allow `@ahmedsamirelsaka/react-native-local-release` (or entire `@ahmedsamirelsaka` scope)
   - **Organizations:** your org if applicable
4. Copy the token once (`npm_…`). Store it in a password manager.

### 4. Add the token to GitHub

**Option 1 — Environment secret (matches the workflow):**

1. https://github.com/AhmedSamirElsaka/react-native-local-release/settings/environments  
2. Open environment **`npm-publish`** (already created).  
3. **Environment secrets** → **Add secret**  
   - Name: `NPM_TOKEN`  
   - Value: paste the npm token  

**Option 2 — Repository secret:**

1. https://github.com/AhmedSamirElsaka/react-native-local-release/settings/secrets/actions  
2. **New repository secret** → `NPM_TOKEN` → paste token  

> The workflow reads `${{ secrets.NPM_TOKEN }}`. Environment secrets are visible only to jobs that use `environment: npm-publish` (this one does).

### 5. Re-run publish

Either:

- Actions → failed **Publish npm + GitHub Release assets** run → **Re-run failed jobs**

Or from a terminal:

```bash
cd /Users/ahmedsamir/work/react-native-local-release
git push origin :refs/tags/v2.0.0-rc.1
git tag -f -a v2.0.0-rc.1 -m "2.0.0-rc.1"
git push origin v2.0.0-rc.1
```

### 6. Verify

```bash
npm view @ahmedsamirelsaka/react-native-local-release version --tag next
npx @ahmedsamirelsaka/react-native-local-release@next --help
```

RC is published under dist-tag **`next`** (not `latest`) until you cut a stable `2.0.0`.

---

## Path B — Trusted Publishing (OIDC, no `NPM_TOKEN`)

Best after the package exists once, or if npm allows first-time trusted publish for your account.

1. Publish **once** with Path A (creates the package), **or** follow npm’s current “Trusted Publisher” UI for new packages.
2. Open the package on npm → **Settings** → **Trusted Publisher** / **Provenance**:
   - **Repository:** `AhmedSamirElsaka/react-native-local-release`
   - **Workflow:** `publish.yml` (file under `.github/workflows/publish.yml`)
   - **Environment:** `npm-publish`
3. Remove `NPM_TOKEN` later if you want OIDC-only.
4. Re-run the tag workflow. Job already has `permissions.id-token: write`.

Docs: https://docs.npmjs.com/trusted-publishers

---

## Optional: publish once from your laptop

```bash
cd /Users/ahmedsamir/work/react-native-local-release
npm login          # or: npm login --auth-type=web
npm whoami
npm test
npm publish --access public --tag next --provenance
```

Use the same version already in `package.json` (`2.0.0-rc.1`). Do **not** re-publish the same version if CI already succeeded.

---

## Checklist

| Step | Status |
|------|--------|
| CI green on `main` | Done by repo |
| GitHub Release `v2.0.0-rc.1` + tarball | Done |
| npm account + `@ahmedsamirelsaka` scope | **You** |
| `NPM_TOKEN` on `npm-publish` env (or Trusted Publisher) | **You** |
| Re-run publish workflow | **You** |
| `npm view …@next` works | Confirm |

---

## After it works

Consumers:

```bash
npx @ahmedsamirelsaka/react-native-local-release@next install --project .
# or pin exactly:
npm i -D @ahmedsamirelsaka/react-native-local-release@2.0.0-rc.1
```
