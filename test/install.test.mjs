import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'minimal-rn');
const cli = path.join(root, 'dist', 'cli.js');

spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

const {
  detectProject,
  buildReleaseConfig,
  validateReleaseConfig,
  mergeGitignore,
  mergePackageScripts,
  patchGradleProperties,
  upsertMarkedBlock,
  mergeGemfile,
  renderTemplate,
} = await import('../dist/index.js');
const { assertValidReleaseConfig } = await import('../dist/config.js');
const { setupCredentialsInteractively } = await import('../dist/credentials.js');

function copyFixtureToTemp() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-local-release-'));
  fs.cpSync(fixtureRoot, temp, { recursive: true });
  return temp;
}

test('detectProject reads android + ios metadata', () => {
  const detection = detectProject(fixtureRoot);
  assert.equal(detection.android.applicationId, 'com.example.minimal');
  assert.equal(detection.ios.scheme, 'MyApp');
  assert.equal(detection.ios.teamId, 'ABCD123456');
  assert.equal(detection.packageJsonVersion, '1.2.3');
});

test('buildReleaseConfig defaults to incrementing iOS builds', () => {
  const config = buildReleaseConfig(detectProject(fixtureRoot));
  assert.equal(config.ios.buildNumberStrategy.mode, 'increment');
  assert.equal(config.app.packageName, 'com.example.minimal');
  assertValidReleaseConfig(config);
});

test('buildReleaseConfig supports fixed iOS builds', () => {
  const config = buildReleaseConfig(detectProject(fixtureRoot), {
    fixedIosBuild: '1',
  });
  assert.deepEqual(config.ios.buildNumberStrategy, { mode: 'fixed', value: 1 });
});

test('validateReleaseConfig rejects missing fields', () => {
  const errors = validateReleaseConfig({ app: {} });
  assert.ok(errors.length > 0);
});

test('renderTemplate replaces placeholders', () => {
  assert.equal(renderTemplate('hi {{name}}', { name: 'Ada' }), 'hi Ada');
  assert.throws(() => renderTemplate('{{missing}}', {}));
});

test('patch helpers are idempotent and do not force ABI/R8', () => {
  const once = mergeGitignore('node_modules/\n');
  const twice = mergeGitignore(once);
  assert.equal(once, twice);
  assert.match(once, /fastlane\/\.env/);
  assert.match(once, /\*\.rn-local-release\.bak/);

  const gemOnce = mergeGemfile('source "https://rubygems.org"\nruby ">= 2.6.10"\n');
  const gemTwice = mergeGemfile(gemOnce);
  assert.equal(gemOnce, gemTwice);
  assert.match(gemOnce, /fastlane/);

  const props = patchGradleProperties(
    'reactNativeArchitectures=x86_64\nMYAPP_UPLOAD_STORE_PASSWORD=secret\n',
  );
  assert.match(props, /reactNativeArchitectures=x86_64/);
  assert.doesNotMatch(props, /STORE_PASSWORD/);
  assert.doesNotMatch(props, /enableR8\.fullMode/);
});

test('mergePackageScripts adds release commands', () => {
  const merged = mergePackageScripts(
    { name: 'x', scripts: {} },
    {
      'release:compile': 'bundle exec fastlane compile',
    },
  );
  assert.equal(merged.scripts['release:compile'], 'bundle exec fastlane compile');
  assert.equal(merged.scripts.typecheck, 'tsc --noEmit');
});

test('upsertMarkedBlock replaces existing markers', () => {
  const first = upsertMarkedBlock('a\n', 'one');
  const second = upsertMarkedBlock(first, 'two');
  assert.match(second, /two/);
  assert.doesNotMatch(second, /one/);
});

test('installer dry-run succeeds on fixture', () => {
  const temp = copyFixtureToTemp();
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'install',
      '--project',
      temp,
      '--non-interactive',
      '--dry-run',
      '--team-id',
      'ABCD123456',
      '--skip-credentials',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dry run only/);
});

test('installer writes config and Fastlane files', () => {
  const temp = copyFixtureToTemp();
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'install',
      '--project',
      temp,
      '--non-interactive',
      '--team-id',
      'ABCD123456',
      '--fixed-ios-build',
      '1',
      '--force',
      '--skip-credentials',
      '--store-uploaded-versions',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(
    fs.readFileSync(path.join(temp, 'fastlane', 'release.config.json'), 'utf8'),
  );
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.ios.buildNumberStrategy.value, 1);
  assert.equal(config.archives.storeUploadedVersions, true);
  assert.equal(config.logging.directory, 'logs');
  assert.ok(fs.existsSync(path.join(temp, 'fastlane', 'Fastfile')));
  assert.ok(fs.existsSync(path.join(temp, 'fastlane', 'lib', 'rn_local_release.rb')));
  assert.ok(fs.existsSync(path.join(temp, 'ios', 'exportOptions.plist')));
  assert.ok(fs.existsSync(path.join(temp, '.rn-local-release', 'manifest.json')));
  const packageJson = JSON.parse(fs.readFileSync(path.join(temp, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['release:upload'], 'bundle exec fastlane upload_all');
  const gitignore = fs.readFileSync(path.join(temp, '.gitignore'), 'utf8');
  assert.match(gitignore, /# >>> rn-local-release/);
  assert.match(gitignore, /logs\//);
  assert.match(gitignore, /versions\//);
});

test('credentials helper writes file-provider secrets without echoing passwords', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-creds-'));
  fs.mkdirSync(path.join(temp, 'android', 'app'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'fastlane'), { recursive: true });
  // Ensure .gitignore so assertNotGitTracked allows writes
  fs.writeFileSync(
    path.join(temp, '.gitignore'),
    'fastlane/.env\nandroid/keystore.properties\nsecrets/\n',
  );
  const p8 = path.join(temp, 'AuthKey_TESTKEY.p8');
  const json = path.join(temp, 'play.json');
  const jks = path.join(temp, 'android', 'app', 'keystore.jks');
  fs.writeFileSync(p8, 'fake-p8');
  fs.writeFileSync(json, '{"type":"service_account"}');
  fs.writeFileSync(jks, 'fake-jks');

  const answers = [
    'y',
    'KEYID123',
    'ISSUER-UUID',
    p8,
    '',
    'y',
    json,
    'y',
    jks,
    'key0',
  ];
  const secrets = ['store-pass', 'key-pass'];
  const rl = {
    question: async () => {
      if (answers.length === 0) throw new Error('Unexpected extra prompt');
      return answers.shift();
    },
  };

  const result = await setupCredentialsInteractively(rl, temp, {
    dryRun: false,
    provider: 'file',
    allowExternalPaths: true,
    readSecret: async () => {
      if (secrets.length === 0) throw new Error('Unexpected secret prompt');
      return secrets.shift();
    },
  });
  assert.equal(result.configured, true);
  const env = fs.readFileSync(path.join(temp, 'fastlane', '.env'), 'utf8');
  assert.match(env, /ASC_KEY_ID="KEYID123"/);
  assert.match(env, /MYAPP_UPLOAD_STORE_PASSWORD="store-pass"/);
  assert.ok(fs.existsSync(path.join(temp, 'secrets', 'AuthKey_KEYID123.p8')));
  const mode = fs.statSync(path.join(temp, 'fastlane', '.env')).mode & 0o777;
  assert.equal(mode, 0o600);
});
