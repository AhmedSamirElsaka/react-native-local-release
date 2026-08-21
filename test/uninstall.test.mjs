import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'cli.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'minimal-rn');

function copyFixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-uninstall-'));
  fs.cpSync(fixtureRoot, temp, { recursive: true });
  return temp;
}

test('install → uninstall removes managed manifest', () => {
  const temp = copyFixture();
  const install = spawnSync(
    process.execPath,
    [
      cli,
      'install',
      '--project',
      temp,
      '--non-interactive',
      '--team-id',
      'ABCD123456',
      '--skip-credentials',
      '--force',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(install.status, 0, install.stderr || install.stdout);
  assert.ok(fs.existsSync(path.join(temp, '.rn-local-release', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(temp, 'fastlane', 'Fastfile')));

  const uninstall = spawnSync(
    process.execPath,
    [cli, 'uninstall', '--project', temp, '--yes'],
    { encoding: 'utf8' },
  );
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  assert.equal(fs.existsSync(path.join(temp, '.rn-local-release')), false);
});

test('cli rejects missing flag values', () => {
  const result = spawnSync(process.execPath, [cli, 'install', '--team-id'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Missing value/);
});
