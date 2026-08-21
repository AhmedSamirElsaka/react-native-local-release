#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInstall, runUninstall } from './install.js';
import { setupCredentialsInteractively, defaultCredentialProvider, purgeCredentials } from './credentials.js';
import { createReadline, askYesNo } from './prompt.js';
import { writeCrashLog } from './logging.js';
import { loadReleaseConfig, validateReleaseConfig, validateProjectPaths } from './config.js';
import { detectProject } from './detect.js';
import { exists } from './fs.js';
import { materializeKeychainPasswords } from './credentials.js';
import { runArgv } from './process.js';
import type { CliOptions } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

function printHelp(): void {
  console.log(`
${pkg.name} v${pkg.version}

Usage:
  rn-local-release <command> [options]
  rn-local-release --project <path>   # v1 alias for install

Commands:
  install       Install/update the local release toolkit
  configure     Interactive credential setup
  doctor        Detect project health and print summary
  verify        Run configured verify commands via Fastlane
  migrate       Migrate release.config.json to schema v2
  uninstall     Remove managed files (safe restore)
  credentials   Alias for configure
  audit         Audit credential file permissions / tracking
  help          Show this help

Options:
  --project <path>           Target React Native app root (default: .)
  --dry-run                  Plan only; write nothing
  --force                    Overwrite protected managed files
  --yes                      Confirm destructive actions
  --non-interactive          Never prompt
  --setup-credentials        Force credential prompts during install
  --skip-credentials         Skip credential prompts during install
  --credentials-only         Only run credential setup
  --purge-credentials        With uninstall, also wipe Keychain/vault
  --team-id <id>
  --package-name <id>
  --bundle-identifier <id>
  --display-name <name>
  --ios-workspace <path>
  --ios-scheme <name>
  --fixed-ios-build <n>
  --store-uploaded-versions  Enable versions/ archive
  --no-store-uploaded-versions
  --version
  --help
`);
}

function requireFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: 'install',
    project: '.',
    dryRun: false,
    nonInteractive: false,
    force: false,
    yes: false,
    setupCredentials: null,
    credentialsOnly: false,
    purgeCredentials: false,
    storeUploadedVersions: null,
    help: false,
    version: false,
  };

  let i = 0;
  // v1 alias: `rn-local-release --project .` means install
  if (argv[0] && !argv[0].startsWith('-')) {
    options.command = argv[0];
    i = 1;
  } else {
    options.command = 'install';
  }

  for (; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--project':
        options.project = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--non-interactive':
        options.nonInteractive = true;
        break;
      case '--setup-credentials':
        options.setupCredentials = true;
        break;
      case '--skip-credentials':
        options.setupCredentials = false;
        break;
      case '--credentials-only':
        options.credentialsOnly = true;
        options.command = 'configure';
        break;
      case '--purge-credentials':
        options.purgeCredentials = true;
        break;
      case '--team-id':
        options.teamId = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--package-name':
        options.packageName = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--bundle-identifier':
        options.bundleIdentifier = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--display-name':
        options.displayName = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--ios-workspace':
        options.iosWorkspace = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--ios-scheme':
        options.iosScheme = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--fixed-ios-build':
        options.fixedIosBuild = requireFlagValue(argv, i, arg);
        i += 1;
        break;
      case '--store-uploaded-versions':
        options.storeUploadedVersions = true;
        break;
      case '--no-store-uploaded-versions':
        options.storeUploadedVersions = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
      case '-V':
        options.version = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function runDoctor(project: string): Promise<void> {
  const root = path.resolve(project);
  const detection = detectProject(root);
  console.log('Doctor');
  console.log('------');
  console.log(`Root: ${root}`);
  console.log(`Package manager: ${detection.packageManager}`);
  console.log(
    `Android: ${detection.android.supported ? detection.android.dsl : detection.android.reason}`,
  );
  console.log(
    `iOS: ${detection.ios.supported ? `${detection.ios.scheme} / ${detection.ios.teamId}` : detection.ios.reason}`,
  );
  if (exists(path.join(root, 'fastlane', 'release.config.json'))) {
    const { config } = loadReleaseConfig(root);
    const errors = validateReleaseConfig(config);
    const missing = validateProjectPaths(root, config);
    console.log(`Config schema: ${errors.length ? 'INVALID' : 'ok'} (v${config.schemaVersion})`);
    if (errors.length) for (const e of errors) console.log(`  - ${e}`);
    if (missing.length) {
      console.log('Missing paths:');
      for (const m of missing) console.log(`  - ${m}`);
    }
    console.log(`Credentials provider: ${config.credentials.provider}`);
    console.log(`Logs: ${config.logging.enabled ? config.logging.directory : 'disabled'}`);
    console.log(
      `Versions archive: ${config.archives.storeUploadedVersions ? config.archives.directory : 'disabled'}`,
    );
  } else {
    console.log('No fastlane/release.config.json yet — run install.');
  }
}

async function runAudit(project: string): Promise<void> {
  const root = path.resolve(project);
  const candidates = [
    'fastlane/.env',
    'android/keystore.properties',
    'secrets',
  ];
  console.log('Credential audit');
  for (const rel of candidates) {
    const absolute = path.join(root, rel);
    if (!exists(absolute)) {
      console.log(`  missing: ${rel}`);
      continue;
    }
    const tracked = runArgv('git', ['ls-files', '--error-unmatch', rel], { cwd: root });
    const ignored = runArgv('git', ['check-ignore', '-q', rel], { cwd: root });
    console.log(
      `  ${rel}: tracked=${tracked.status === 0} ignored=${ignored.status === 0}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.command === 'help') {
    printHelp();
    return;
  }
  if (options.version) {
    console.log(pkg.version);
    return;
  }

  const projectRoot = path.resolve(options.project);
  try {
    switch (options.command) {
      case 'install':
        await runInstall(options);
        break;
      case 'configure':
      case 'credentials': {
        const rl = createReadline();
        try {
          await setupCredentialsInteractively(rl, projectRoot, {
            dryRun: options.dryRun,
            provider: defaultCredentialProvider(),
          });
        } finally {
          rl.close();
        }
        break;
      }
      case 'doctor':
        await runDoctor(options.project);
        break;
      case 'audit':
        await runAudit(options.project);
        break;
      case 'migrate': {
        const { config, configPath } = loadReleaseConfig(projectRoot);
        const { writeText } = await import('./fs.js');
        const { jsonPretty } = await import('./config.js');
        writeText(configPath, jsonPretty(config));
        console.log(`Migrated ${configPath} to schemaVersion ${config.schemaVersion}`);
        break;
      }
      case 'uninstall':
        await runUninstall(options);
        break;
      case 'verify':
      case 'build':
      case 'upload':
      case 'beta':
      case 'promote': {
        materializeKeychainPasswords(projectRoot);
        const lane =
          options.command === 'verify'
            ? 'verify'
            : options.command === 'build'
              ? 'build_all'
              : options.command === 'upload'
                ? 'upload_all'
                : options.command === 'beta'
                  ? 'beta_all'
                  : 'promote';
        const result = runArgv('bundle', ['exec', 'fastlane', lane], { cwd: projectRoot });
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        if (result.status !== 0) process.exit(result.status || 1);
        break;
      }
      default:
        // v1 alias: bare flags mean install
        if (options.command.startsWith('--')) {
          throw new Error(`Unknown command: ${options.command}`);
        }
        throw new Error(`Unknown command: ${options.command}`);
    }
  } catch (error) {
    const logFile = writeCrashLog(projectRoot, error);
    console.error((error as Error).message || error);
    console.error(`Log: ${logFile}`);
    process.exitCode = 1;
  }
}

main();
