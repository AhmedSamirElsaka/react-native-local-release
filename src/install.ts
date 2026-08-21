import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidReleaseConfig,
  deepMergeConfig,
  jsonPretty,
  loadReleaseConfig,
  migrateConfig,
  validateProjectPaths,
} from './config.js';
import { buildReleaseConfig, detectProject } from './detect.js';
import {
  defaultCredentialProvider,
  setupCredentialsInteractively,
} from './credentials.js';
import { askYesNo, createReadline } from './prompt.js';
import {
  applyPlan,
  ensureRubyVersion,
  mergeGemfile,
  mergeGitignore,
  mergePackageScripts,
  patchAndroidBuildGradle,
  patchGradleProperties,
  releaseScripts,
  renderTemplate,
  type PlannedAction,
} from './patch.js';
import {
  copyFileSecure,
  ensureDir,
  ensureSecretDir,
  exists,
  readText,
  sha256OfText,
  writeText,
} from './fs.js';
import { assertTeamId, assertBundleId } from './paths.js';
import { writeCrashLog } from './logging.js';
import type { CliOptions, InstallManifest, ReleaseConfig } from './types.js';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, '..');
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'template');

function kitVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '2.0.0';
  }
}

function listTemplateFiles(relativeDir: string): string[] {
  const sourceDir = path.join(TEMPLATE_ROOT, relativeDir);
  if (!exists(sourceDir)) return [];
  const out: string[] = [];
  const stack = [sourceDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(path.relative(TEMPLATE_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function runInstall(options: CliOptions): Promise<void> {
  const projectRoot = path.resolve(options.project);
  if (!exists(projectRoot)) {
    throw new Error(`Project path does not exist: ${projectRoot}`);
  }

  const rl = options.nonInteractive ? null : createReadline();
  try {
    if (options.credentialsOnly) {
      if (!rl) {
        throw new Error('--credentials-only requires an interactive terminal');
      }
      ensureSecretDir(path.join(projectRoot, 'secrets'));
      const gitignorePath = path.join(projectRoot, '.gitignore');
      const mergedIgnore = mergeGitignore(exists(gitignorePath) ? readText(gitignorePath) : '');
      if (!options.dryRun) writeText(gitignorePath, mergedIgnore);
      await setupCredentialsInteractively(rl, projectRoot, {
        dryRun: options.dryRun,
        provider: defaultCredentialProvider(),
      });
      return;
    }

    const detection = detectProject(projectRoot, options);
    if (!detection.android.supported) {
      throw new Error(detection.android.reason || 'Unsupported Android layout');
    }
    if (!detection.ios.supported) {
      throw new Error(detection.ios.reason || 'Unsupported iOS layout');
    }

    let teamId = options.teamId || detection.ios.teamId || '';
    if (!teamId) {
      if (!rl) {
        throw new Error('Missing --team-id and none detected');
      }
      const answer = (
        await rl.question(`Apple Team ID [${detection.ios.teamId || 'required'}]: `)
      ).trim();
      teamId = answer || detection.ios.teamId || '';
    }
    if (!teamId) throw new Error('Apple Team ID is required');
    assertTeamId(teamId);

    let packageName = options.packageName || detection.android.applicationId || '';
    if (!packageName && rl) {
      packageName = (await rl.question('Android/Play package name: ')).trim();
    }
    if (!packageName) throw new Error('Android package name is required');
    assertBundleId(packageName);

    let storeUploadedVersions = options.storeUploadedVersions;
    if (storeUploadedVersions == null && rl && !options.nonInteractive) {
      storeUploadedVersions = await askYesNo(
        rl,
        'Store a local copy of each uploaded IPA/AAB under versions/ ?',
        false,
      );
    }

    let detectedConfig = buildReleaseConfig(detection, {
      ...options,
      teamId,
      packageName,
      storeUploadedVersions: storeUploadedVersions === true,
      credentialProvider: defaultCredentialProvider(),
    });

    const existingConfigPath = path.join(projectRoot, 'fastlane', 'release.config.json');
    if (exists(existingConfigPath) && !options.force) {
      const existing = migrateConfig(JSON.parse(readText(existingConfigPath)));
      detectedConfig = deepMergeConfig(detectedConfig, existing);
    }
    assertValidReleaseConfig(detectedConfig);

    const actions: PlannedAction[] = [];
    const alwaysRefresh = new Set([
      'fastlane/Fastfile',
      'fastlane/lib/rn_local_release.rb',
      'fastlane/.env.example',
      'docs/LOCAL_RELEASE.md',
      'android/keystore.properties.example',
      'scripts/print-android-signing-fingerprints.sh',
      'secrets/.gitignore',
      'secrets/README.md',
    ]);

    for (const rootName of ['fastlane', 'docs', 'android', 'ios', 'scripts', 'secrets']) {
      for (const rel of listTemplateFiles(rootName)) {
        const dest = path.join(projectRoot, rel);
        if (exists(dest) && !options.force && !alwaysRefresh.has(rel)) {
          continue;
        }
        actions.push({
          type: 'copy',
          from: path.join(TEMPLATE_ROOT, rel),
          to: rel,
          mode: rel.endsWith('.sh') ? 0o755 : 0o644,
        });
      }
    }

    // CREDENTIALS doc
    const credSrc = path.join(PACKAGE_ROOT, 'CREDENTIALS.md');
    if (exists(credSrc)) {
      actions.push({
        type: 'write',
        path: 'docs/RELEASE_CREDENTIALS.md',
        contents: readText(credSrc),
      });
    }

    const appfileTemplate = readText(path.join(TEMPLATE_ROOT, 'fastlane', 'Appfile'));
    const exportTemplate = readText(path.join(TEMPLATE_ROOT, 'ios', 'exportOptions.plist'));
    const appfile = renderTemplate(appfileTemplate, {
      bundleIdentifier: detectedConfig.app.bundleIdentifier,
      packageName: detectedConfig.app.packageName,
      teamId: detectedConfig.ios.teamId,
    });
    const exportOptions = renderTemplate(exportTemplate, {
      exportMethod: detectedConfig.ios.exportMethod,
      teamId: xmlEscape(detectedConfig.ios.teamId),
    });

    actions.push({
      type: 'write',
      path: 'fastlane/release.config.json',
      contents: jsonPretty(detectedConfig),
    });
    actions.push({ type: 'write', path: 'fastlane/Appfile', contents: appfile });
    actions.push({
      type: 'write',
      path: detectedConfig.ios.exportOptionsPath,
      contents: exportOptions,
    });

    const packageJsonPath = path.join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readText(packageJsonPath)) as Record<string, unknown>;
    const mergedPackage = mergePackageScripts(packageJson, releaseScripts());
    // Pin toolkit as exact optional note via script comment not needed; add setup script
    const scripts = mergedPackage.scripts as Record<string, string>;
    scripts['release:setup'] =
      `npx --yes @ahmedsamirelsaka/react-native-local-release@${kitVersion()} install --project .`;
    actions.push({
      type: 'write',
      path: 'package.json',
      contents: `${JSON.stringify(mergedPackage, null, 2)}\n`,
    });

    const gemfilePath = path.join(projectRoot, 'Gemfile');
    if (exists(gemfilePath)) {
      actions.push({
        type: 'write',
        path: 'Gemfile',
        contents: mergeGemfile(readText(gemfilePath)),
      });
    } else {
      actions.push({
        type: 'write',
        path: 'Gemfile',
        contents: `source 'https://rubygems.org'\nruby ">= 2.6.10", "< 4.0"\ngem 'fastlane', '~> 2.234'\n`,
      });
    }

    const gitignorePath = path.join(projectRoot, '.gitignore');
    actions.push({
      type: 'write',
      path: '.gitignore',
      contents: mergeGitignore(exists(gitignorePath) ? readText(gitignorePath) : ''),
    });

    const gradlePath = path.join(projectRoot, detectedConfig.android.buildGradlePath);
    if (exists(gradlePath)) {
      actions.push({
        type: 'write',
        path: detectedConfig.android.buildGradlePath,
        contents: patchAndroidBuildGradle(
          readText(gradlePath),
          detectedConfig.android.dsl,
        ),
      });
    }
    const propsPath = path.join(projectRoot, 'android', 'gradle.properties');
    if (exists(propsPath)) {
      actions.push({
        type: 'write',
        path: 'android/gradle.properties',
        contents: patchGradleProperties(readText(propsPath)),
      });
    }

    console.log(`Install plan: ${actions.length} actions`);
    for (const action of actions.slice(0, 20)) {
      if (action.type === 'write' || action.type === 'copy') {
        console.log(`  - ${action.type} ${action.type === 'write' ? action.path : action.to}`);
      }
    }
    if (actions.length > 20) console.log(`  ... +${actions.length - 20} more`);

    const managed = applyPlan(projectRoot, actions, options.dryRun);
    if (!options.dryRun) {
      ensureRubyVersion(projectRoot, detectedConfig.ruby.version || '3.2.2');
      ensureDir(path.join(projectRoot, '.rn-local-release'));
      const manifest: InstallManifest = {
        kitVersion: kitVersion(),
        installedAt: new Date().toISOString(),
        projectRoot,
        managedPaths: managed,
        configHash: sha256OfText(jsonPretty(detectedConfig)),
      };
      writeText(
        path.join(projectRoot, '.rn-local-release', 'manifest.json'),
        jsonPretty(manifest),
      );
    }

    const missing = validateProjectPaths(projectRoot, detectedConfig).filter(
      (item) => item !== detectedConfig.ios.exportOptionsPath || !options.dryRun,
    );
    console.log(`Installed react-native-local-release ${kitVersion()} into ${projectRoot}`);
    console.log(`Package: ${detectedConfig.app.packageName}`);
    console.log(
      `iOS: ${detectedConfig.ios.scheme} / team ${detectedConfig.ios.teamId} / ${JSON.stringify(detectedConfig.ios.buildNumberStrategy)}`,
    );
    console.log(`Android DSL: ${detectedConfig.android.dsl}`);
    console.log(`Credential provider: ${detectedConfig.credentials.provider}`);
    console.log(
      `Archive uploaded versions: ${detectedConfig.archives.storeUploadedVersions}`,
    );
    if (missing.length && !options.dryRun) {
      console.warn('Warning: missing paths:');
      for (const item of missing) console.warn(`  - ${item}`);
    }

    if (options.dryRun) {
      console.log('Dry run only — no files were written.');
      return;
    }

    if (options.setupCredentials === false || options.nonInteractive) {
      console.log('Skipped credential setup.');
      console.log('Next: rn-local-release configure --project .');
      return;
    }

    const shouldSetup =
      options.setupCredentials === true ||
      (rl
        ? await askYesNo(
            rl,
            'Configure Apple / Play / keystore credentials now?',
            true,
          )
        : false);
    if (shouldSetup && rl) {
      await setupCredentialsInteractively(rl, projectRoot, {
        provider: detectedConfig.credentials.provider,
      });
    } else {
      console.log('Skipped credential setup. Run: rn-local-release configure --project .');
    }
    console.log('Next: bundle install && yarn release:doctor && yarn release:credentials');
  } catch (error) {
    const logFile = writeCrashLog(projectRoot, error);
    console.error((error as Error).message || error);
    console.error(`Details written to ${logFile}`);
    throw error;
  } finally {
    rl?.close();
  }
}

export async function runUninstall(options: CliOptions): Promise<void> {
  const projectRoot = path.resolve(options.project);
  const manifestPath = path.join(projectRoot, '.rn-local-release', 'manifest.json');
  if (!exists(manifestPath)) {
    throw new Error('No .rn-local-release/manifest.json found. Nothing to uninstall.');
  }
  const manifest = JSON.parse(readText(manifestPath)) as InstallManifest;
  const rl = options.nonInteractive ? null : createReadline();
  try {
    if (!options.yes && rl) {
      const ok = await askYesNo(
        rl,
        `Uninstall managed release files (${manifest.managedPaths.length} paths)?`,
        false,
      );
      if (!ok) {
        console.log('Cancelled.');
        return;
      }
    } else if (!options.yes) {
      throw new Error('Pass --yes for non-interactive uninstall');
    }

    for (const item of [...manifest.managedPaths].reverse()) {
      const absolute = path.join(projectRoot, item.path);
      const backup = `${absolute}.rn-local-release.bak`;
      if (!exists(absolute)) continue;
      // Only restore/remove if hash unchanged from install
      const current = exists(absolute)
        ? (await import('./fs.js')).sha256OfFile(absolute)
        : null;
      if (current && current !== item.installedHash && !options.force) {
        console.warn(`Skipping modified file: ${item.path}`);
        continue;
      }
      if (exists(backup)) {
        writeText(absolute, readText(backup));
        fs.unlinkSync(backup);
      } else if (item.kind === 'created') {
        fs.unlinkSync(absolute);
      }
    }
    fs.rmSync(path.join(projectRoot, '.rn-local-release'), { recursive: true, force: true });
    console.log('Uninstall complete.');
    if (options.purgeCredentials) {
      const { purgeCredentials } = await import('./credentials.js');
      purgeCredentials(projectRoot);
      console.log('Credentials purged.');
    }
  } finally {
    rl?.close();
  }
}

export type { ReleaseConfig };
