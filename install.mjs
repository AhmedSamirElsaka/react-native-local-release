#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { detectProject, buildReleaseConfig } from './lib/detect.mjs';
import { assertValidReleaseConfig, validateProjectPaths } from './lib/config.mjs';
import { renderTemplate, jsonPretty } from './lib/render.mjs';
import {
  mergePackageScripts,
  mergeGemfile,
  mergeGitignore,
  patchAndroidBuildGradle,
  patchGradleProperties,
  writeWithBackup,
  ensureRubyVersion,
} from './lib/patch.mjs';
import { copyFile, exists, readText, writeText, ensureDir } from './lib/fs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.join(__dirname, 'template');

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    dryRun: false,
    nonInteractive: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--project':
        options.project = path.resolve(next);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--non-interactive':
        options.nonInteractive = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--team-id':
        options.teamId = next;
        i += 1;
        break;
      case '--package-name':
        options.packageName = next;
        i += 1;
        break;
      case '--bundle-id':
        options.bundleIdentifier = next;
        i += 1;
        break;
      case '--display-name':
        options.displayName = next;
        i += 1;
        break;
      case '--ios-workspace':
        options.iosWorkspace = next;
        i += 1;
        break;
      case '--ios-scheme':
        options.iosScheme = next;
        i += 1;
        break;
      case '--fixed-ios-build':
        options.fixedIosBuild = next;
        i += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }
  return options;
}

function printHelp() {
  console.log(`react-native-local-release installer

Usage:
  node install.mjs --project /path/to/rn-app [options]

Options:
  --project <path>         Target React Native app (default: cwd)
  --team-id <id>           Apple DEVELOPMENT_TEAM
  --package-name <id>      Android applicationId / Play package
  --bundle-id <id>         iOS bundle identifier
  --display-name <name>    App display name
  --ios-workspace <path>   Relative ios/*.xcworkspace path
  --ios-scheme <name>      Xcode scheme
  --fixed-ios-build <n>    Keep iOS CFBundleVersion fixed (e.g. 1)
  --dry-run                Print actions without writing
  --non-interactive        Fail instead of prompting
  --force                  Overwrite generated Fastlane files
  -h, --help               Show help
`);
}

async function promptIfNeeded(rl, options, key, question) {
  if (options[key]) {
    return options[key];
  }
  if (options.nonInteractive) {
    throw new Error(`Missing required value for ${key}. Pass a flag or run interactively.`);
  }
  const answer = (await rl.question(question)).trim();
  if (!answer) {
    throw new Error(`Missing required value for ${key}`);
  }
  return answer;
}

function releaseScripts() {
  return {
    'release:doctor': 'bundle exec fastlane doctor',
    'release:verify': 'bundle exec fastlane verify',
    'release:credentials': 'bundle exec fastlane credentials',
    'release:bump': 'bundle exec fastlane bump_version',
    'release:prepare': 'bundle exec fastlane prepare',
    'release:compile': 'bundle exec fastlane compile',
    'release:upload': 'bundle exec fastlane upload_all',
    'release:ios:build': 'bundle exec fastlane ios build',
    'release:ios:beta': 'bundle exec fastlane ios beta',
    'release:ios:upload': 'bundle exec fastlane ios upload',
    'release:ios:promote': 'bundle exec fastlane ios promote',
    'release:android:build': 'bundle exec fastlane android build',
    'release:android:beta': 'bundle exec fastlane android beta',
    'release:android:upload': 'bundle exec fastlane android upload',
    'release:android:promote': 'bundle exec fastlane android promote',
    'release:build': 'bundle exec fastlane build_all',
    'release:beta': 'bundle exec fastlane beta_all',
  };
}

function copyTemplateTree(relativeDir, projectRoot, { dryRun, force }) {
  const sourceDir = path.join(TEMPLATE_ROOT, relativeDir);
  const actions = [];
  if (!exists(sourceDir)) {
    return actions;
  }
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(relativeDir, entry.name);
    const src = path.join(TEMPLATE_ROOT, rel);
    const dest = path.join(projectRoot, rel.replace(/^template\//, ''));
    // template paths are already relative without "template/"
    const destPath = path.join(projectRoot, relativeDir, entry.name);
    if (entry.isDirectory()) {
      actions.push(...copyTemplateTree(path.join(relativeDir, entry.name), projectRoot, { dryRun, force }));
      continue;
    }
    if (exists(destPath) && !force) {
      // Always refresh Fastlane lib + Fastfile when installing; others skip unless force
      const always = [
        'fastlane/Fastfile',
        'fastlane/lib/rn_local_release.rb',
        'fastlane/.env.example',
        'docs/LOCAL_RELEASE.md',
        'android/keystore.properties.example',
        'android/proguard-rules.rn-local-release.pro',
        'scripts/print-android-signing-fingerprints.sh',
        'secrets/.gitignore',
        'secrets/README.md',
      ];
      const key = path.join(relativeDir, entry.name).replace(/\\/g, '/');
      if (!always.includes(key) && !key.endsWith('release.config.json')) {
        actions.push({ type: 'skip', path: destPath, reason: 'exists' });
        continue;
      }
    }
    if (dryRun) {
      actions.push({ type: 'copy', path: destPath, dryRun: true });
    } else {
      ensureDir(path.dirname(destPath));
      copyFile(src, destPath);
      if (destPath.endsWith('.sh')) {
        fs.chmodSync(destPath, 0o755);
      }
      actions.push({ type: 'copy', path: destPath });
    }
  }
  return actions;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const projectRoot = options.project;
  const rl = options.nonInteractive
    ? null
    : readline.createInterface({ input, output });

  try {
    let detection = detectProject(projectRoot, options);

    if (!detection.android.supported) {
      throw new Error(detection.android.reason);
    }
    if (!detection.ios.supported) {
      throw new Error(detection.ios.reason || 'Unsupported iOS layout');
    }

    options.teamId = await promptIfNeeded(
      rl,
      options,
      'teamId',
      `Apple Team ID [${detection.ios.teamId || 'required'}]: `,
    ).then((value) => value || detection.ios.teamId);

    if (!options.packageName && !detection.android.applicationId) {
      options.packageName = await promptIfNeeded(
        rl,
        options,
        'packageName',
        'Android/Play package name: ',
      );
    }

    const config = buildReleaseConfig(detection, options);
    assertValidReleaseConfig(config);

    const actions = [];

    // Copy static template files
    for (const dir of [
      'fastlane',
      'fastlane/lib',
      'docs',
      'android',
      'ios',
      'scripts',
      'secrets',
    ]) {
      // copy only files under each; recursive helper handles nesting via listing
    }

    const copyRoots = ['fastlane', 'docs', 'android', 'ios', 'scripts', 'secrets'];
    for (const rootName of copyRoots) {
      actions.push(
        ...copyTemplateTree(rootName, projectRoot, {
          dryRun: options.dryRun,
          force: options.force,
        }),
      );
    }

    // Render Appfile + exportOptions + release.config.json
    const appfileTemplate = readText(path.join(TEMPLATE_ROOT, 'fastlane', 'Appfile'));
    const exportTemplate = readText(path.join(TEMPLATE_ROOT, 'ios', 'exportOptions.plist'));
    const appfile = renderTemplate(appfileTemplate, {
      bundleIdentifier: config.app.bundleIdentifier,
      packageName: config.app.packageName,
      teamId: config.ios.teamId,
    });
    const exportOptions = renderTemplate(exportTemplate, {
      exportMethod: config.ios.exportMethod,
      teamId: config.ios.teamId,
    });

    const configPath = path.join(projectRoot, 'fastlane', 'release.config.json');
    const appfilePath = path.join(projectRoot, 'fastlane', 'Appfile');
    const exportPath = path.join(projectRoot, config.ios.exportOptionsPath);

    if (options.dryRun) {
      actions.push({ type: 'write', path: configPath, dryRun: true });
      actions.push({ type: 'write', path: appfilePath, dryRun: true });
      actions.push({ type: 'write', path: exportPath, dryRun: true });
    } else {
      ensureDir(path.join(projectRoot, 'fastlane', 'lib'));
      writeText(configPath, jsonPretty(config));
      writeText(appfilePath, appfile);
      writeText(exportPath, exportOptions);
      actions.push({ type: 'write', path: configPath });
      actions.push({ type: 'write', path: appfilePath });
      actions.push({ type: 'write', path: exportPath });
    }

    // package.json scripts
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readText(packageJsonPath));
    const mergedPackage = mergePackageScripts(packageJson, releaseScripts());
    actions.push(
      writeWithBackup(packageJsonPath, `${JSON.stringify(mergedPackage, null, 2)}\n`, {
        dryRun: options.dryRun,
      }),
    );

    // Gemfile
    const gemfilePath = path.join(projectRoot, 'Gemfile');
    if (exists(gemfilePath)) {
      const mergedGem = mergeGemfile(readText(gemfilePath));
      actions.push(writeWithBackup(gemfilePath, mergedGem, { dryRun: options.dryRun }));
    } else if (!options.dryRun) {
      writeText(
        gemfilePath,
        `source 'https://rubygems.org'\nruby ">= 2.6.10", "< 4.0"\ngem 'fastlane'\n`,
      );
      actions.push({ type: 'write', path: gemfilePath });
    }

    actions.push(
      ensureRubyVersion(projectRoot, config.ruby?.version || '3.2.2', {
        dryRun: options.dryRun,
      }),
    );

    // gitignore
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (exists(gitignorePath)) {
      const mergedIgnore = mergeGitignore(readText(gitignorePath));
      actions.push(writeWithBackup(gitignorePath, mergedIgnore, { dryRun: options.dryRun }));
    }

    // Android patches
    const gradlePath = path.join(projectRoot, config.android.buildGradlePath);
    if (exists(gradlePath)) {
      const patched = patchAndroidBuildGradle(readText(gradlePath));
      actions.push(writeWithBackup(gradlePath, patched, { dryRun: options.dryRun }));
    }
    const propsPath = path.join(projectRoot, 'android', 'gradle.properties');
    if (exists(propsPath)) {
      const patchedProps = patchGradleProperties(readText(propsPath));
      actions.push(writeWithBackup(propsPath, patchedProps, { dryRun: options.dryRun }));
    }

    const missing = validateProjectPaths(projectRoot, config);
    // exportOptions may be newly written; filter in dry-run
    const realMissing = options.dryRun
      ? missing.filter((item) => item !== config.ios.exportOptionsPath)
      : missing.filter((item) => !exists(path.join(projectRoot, item)));

    console.log(`Installed react-native-local-release into ${projectRoot}`);
    console.log(`Package: ${config.app.packageName}`);
    console.log(`iOS scheme: ${config.ios.scheme} / team ${config.ios.teamId}`);
    console.log(`iOS build strategy: ${JSON.stringify(config.ios.buildNumberStrategy)}`);
    console.log(`Actions: ${actions.length}`);
    if (realMissing.length > 0) {
      console.warn('Warning: missing paths after install:');
      for (const item of realMissing) {
        console.warn(`  - ${item}`);
      }
    }
    if (options.dryRun) {
      console.log('Dry run only — no files were written.');
    } else {
      console.log('Next:');
      console.log('  1. cp fastlane/.env.example fastlane/.env  # fill credentials');
      console.log('  2. cp android/keystore.properties.example android/keystore.properties');
      console.log('  3. bundle install && yarn release:doctor && yarn release:credentials');
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
