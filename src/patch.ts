import path from 'node:path';
import { exists, readText, writeText, backupFile, sha256OfText, sha256OfFile } from './fs.js';
import type { InstallManifest, ReleaseConfig } from './types.js';

export const BEGIN = '# >>> rn-local-release';
export const END = '# <<< rn-local-release';

export function upsertMarkedBlock(
  content: string,
  block: string,
  begin = BEGIN,
  end = END,
): string {
  const markerStart = content.indexOf(begin);
  const markerEnd = content.indexOf(end);
  const wrapped = `${begin}\n${block.trimEnd()}\n${end}\n`;
  if (markerStart !== -1 && markerEnd !== -1 && markerEnd > markerStart) {
    return (
      content.slice(0, markerStart) +
      wrapped +
      content.slice(markerEnd + end.length).replace(/^\n/, '')
    );
  }
  const trimmed = content.endsWith('\n') ? content : `${content}\n`;
  return `${trimmed}\n${wrapped}`;
}

export function removeMarkedBlock(content: string, begin = BEGIN, end = END): string {
  const markerStart = content.indexOf(begin);
  const markerEnd = content.indexOf(end);
  if (markerStart === -1 || markerEnd === -1 || markerEnd < markerStart) {
    return content;
  }
  return (
    content.slice(0, markerStart) + content.slice(markerEnd + end.length).replace(/^\n/, '')
  );
}

export const DEFAULT_GITIGNORE_ENTRIES = [
  '# Local release credentials + store artifacts (never commit)',
  '**/fastlane/.env',
  '**/fastlane/.env.*',
  '!**/fastlane/.env.example',
  '**/fastlane/README.md',
  '**/fastlane/report.xml',
  '*.ipa',
  '*.dSYM.zip',
  '*.aab',
  '*.apk',
  '!android/app/debug.keystore',
  '*.jks',
  '*.keystore',
  'keystore.properties',
  '**/keystore.properties',
  'secrets/**',
  '!secrets/.gitignore',
  '!secrets/README.md',
  'credentials.txt',
  '**/credentials.txt',
  '**/AuthKey_*.p8',
  '**/play-store-*.json',
  '**/google-play-*.json',
  '**/*-service-account*.json',
  'build/ios/',
  'build/android/',
  'build/release-manifest.json',
  'build/release-manifest-*.json',
  'build/upload-journal.json',
  'logs/',
  'versions/',
  '.rn-local-release/',
  '*.rn-local-release.bak',
];

export function mergeGitignore(content: string): string {
  return upsertMarkedBlock(content || '', DEFAULT_GITIGNORE_ENTRIES.join('\n'));
}

export function mergePackageScripts(
  packageJson: Record<string, unknown>,
  scripts: Record<string, string>,
): Record<string, unknown> {
  const next = {
    ...packageJson,
    scripts: { ...((packageJson.scripts as Record<string, string>) || {}) },
  };
  const scriptBag = next.scripts as Record<string, string>;
  for (const [key, value] of Object.entries(scripts)) {
    scriptBag[key] = value;
  }
  if (!scriptBag.typecheck) {
    scriptBag.typecheck = 'tsc --noEmit';
  }
  return next;
}

export function mergeGemfile(content: string): string {
  let next = content;
  if (!/gem ['"]fastlane['"]/.test(next)) {
    next = upsertMarkedBlock(next, "gem 'fastlane', '~> 2.234'");
  }
  return next;
}

export function ensureRubyVersion(
  root: string,
  version: string,
  { dryRun = false } = {},
): { path: string; wrote: boolean; dryRun?: boolean } {
  const filePath = path.join(root, '.ruby-version');
  if (exists(filePath)) return { path: filePath, wrote: false };
  if (dryRun) return { path: filePath, wrote: false, dryRun: true };
  writeText(filePath, `${version}\n`);
  return { path: filePath, wrote: true };
}

const GROOVY_SIGNING_HELPER = `
// >>> rn-local-release-signing
def loadKeystoreProperties() {
    def props = new Properties()
    def keystorePropertiesFile = rootProject.file("keystore.properties")
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.withInputStream { props.load(it) }
    }
    return props
}

def releaseSigningProperty(String name) {
    def keystoreProps = loadKeystoreProperties()
    def fromFile = keystoreProps.getProperty(name)
    if (fromFile != null && !fromFile.trim().isEmpty()) {
        return fromFile.trim()
    }
    def fromProject = project.findProperty(name)
    if (fromProject != null && !fromProject.toString().trim().isEmpty()) {
        return fromProject.toString().trim()
    }
    def fromEnv = System.getenv(name)
    if (fromEnv != null && !fromEnv.trim().isEmpty()) {
        return fromEnv.trim()
    }
    return null
}

def releaseStoreFileName = releaseSigningProperty("MYAPP_UPLOAD_STORE_FILE")
def releaseStorePassword = releaseSigningProperty("MYAPP_UPLOAD_STORE_PASSWORD")
def releaseKeyAlias = releaseSigningProperty("MYAPP_UPLOAD_KEY_ALIAS")
def releaseKeyPassword = releaseSigningProperty("MYAPP_UPLOAD_KEY_PASSWORD")
def hasReleaseSigning =
    releaseStoreFileName != null &&
    releaseStorePassword != null &&
    releaseKeyAlias != null &&
    releaseKeyPassword != null
// <<< rn-local-release-signing
`.trim();

const GROOVY_RELEASE_GUARD = `
// >>> rn-local-release-guard
gradle.taskGraph.whenReady { graph ->
    if (hasReleaseSigning) {
        return
    }
    def wantsSignedRelease = graph.allTasks.any { task ->
        def name = task.name
        name == "assembleRelease" ||
            name == "bundleRelease" ||
            name == "packageRelease" ||
            name == "packageReleaseBundle" ||
            name == "signReleaseBundle"
    }
    if (wantsSignedRelease) {
        throw new GradleException(
            "Release signing is not configured. Set MYAPP_UPLOAD_* via android/keystore.properties or environment variables."
        )
    }
}
// <<< rn-local-release-guard
`.trim();

export function patchAndroidBuildGradleGroovy(content: string): string {
  let next = content;
  if (!next.includes('rn-local-release-signing')) {
    const anchors = [
      /def jscFlavor[^\n]*\n/,
      /apply plugin: "com\.facebook\.react"[^\n]*\n/,
      /android\s*\{\n/,
    ];
    let inserted = false;
    for (const anchor of anchors) {
      if (anchor.test(next)) {
        next = next.replace(anchor, (match) => `${match}\n${GROOVY_SIGNING_HELPER}\n\n`);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      next = `${GROOVY_SIGNING_HELPER}\n\n${next}`;
    }
  }

  if (
    /signingConfigs\s*\{[\s\S]*release\s*\{[\s\S]*storeFile\s+file\(MYAPP_UPLOAD_STORE_FILE\)/.test(
      next,
    )
  ) {
    next = next.replace(
      /release\s*\{[\s\S]*?storeFile\s+file\(MYAPP_UPLOAD_STORE_FILE\)[\s\S]*?keyPassword\s+MYAPP_UPLOAD_KEY_PASSWORD\s*\}/,
      `release {
            if (hasReleaseSigning) {
                storeFile file(releaseStoreFileName)
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }`,
    );
  }

  if (!next.includes('rn-local-release-guard')) {
    if (/\n(dependencies\s*\{)/.test(next)) {
      next = next.replace(/\n(dependencies\s*\{)/, `\n${GROOVY_RELEASE_GUARD}\n\n$1`);
    } else {
      next = `${next.trimEnd()}\n\n${GROOVY_RELEASE_GUARD}\n`;
    }
  }
  return next;
}

const KTS_SIGNING_HELPER = `
// >>> rn-local-release-signing
fun loadKeystoreProperties(): java.util.Properties {
    val props = java.util.Properties()
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { props.load(it) }
    }
    return props
}

fun releaseSigningProperty(name: String): String? {
    val fromFile = loadKeystoreProperties().getProperty(name)
    if (!fromFile.isNullOrBlank()) return fromFile.trim()
    val fromProject = project.findProperty(name)?.toString()
    if (!fromProject.isNullOrBlank()) return fromProject.trim()
    val fromEnv = System.getenv(name)
    if (!fromEnv.isNullOrBlank()) return fromEnv.trim()
    return null
}

val releaseStoreFileName = releaseSigningProperty("MYAPP_UPLOAD_STORE_FILE")
val releaseStorePassword = releaseSigningProperty("MYAPP_UPLOAD_STORE_PASSWORD")
val releaseKeyAlias = releaseSigningProperty("MYAPP_UPLOAD_KEY_ALIAS")
val releaseKeyPassword = releaseSigningProperty("MYAPP_UPLOAD_KEY_PASSWORD")
val hasReleaseSigning =
    !releaseStoreFileName.isNullOrBlank() &&
        !releaseStorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()
// <<< rn-local-release-signing
`.trim();

const KTS_RELEASE_GUARD = `
// >>> rn-local-release-guard
gradle.taskGraph.whenReady {
    if (hasReleaseSigning) return@whenReady
    val wantsSignedRelease = allTasks.any { task ->
        val name = task.name
        name == "assembleRelease" ||
            name == "bundleRelease" ||
            name == "packageRelease" ||
            name == "packageReleaseBundle" ||
            name == "signReleaseBundle"
    }
    if (wantsSignedRelease) {
        throw GradleException(
            "Release signing is not configured. Set MYAPP_UPLOAD_* via android/keystore.properties or environment variables."
        )
    }
}
// <<< rn-local-release-guard
`.trim();

export function patchAndroidBuildGradleKts(content: string): string {
  let next = content;
  if (!next.includes('rn-local-release-signing')) {
    if (/android\s*\{/.test(next)) {
      next = next.replace(/android\s*\{/, `${KTS_SIGNING_HELPER}\n\nandroid {`);
    } else {
      next = `${KTS_SIGNING_HELPER}\n\n${next}`;
    }
  }
  if (!next.includes('rn-local-release-guard')) {
    next = `${next.trimEnd()}\n\n${KTS_RELEASE_GUARD}\n`;
  }
  return next;
}

export function patchAndroidBuildGradle(content: string, dsl: 'groovy' | 'kotlin'): string {
  return dsl === 'kotlin'
    ? patchAndroidBuildGradleKts(content)
    : patchAndroidBuildGradleGroovy(content);
}

export function patchGradleProperties(content: string): string {
  // Do not force ABI/R8 changes — only strip accidental passwords from tracked file.
  return content
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('MYAPP_UPLOAD_STORE_PASSWORD=') &&
        !line.startsWith('MYAPP_UPLOAD_KEY_PASSWORD='),
    )
    .join('\n')
    .replace(/\n*$/, '\n');
}

export type PlannedAction =
  | { type: 'write'; path: string; contents: string; mode?: number }
  | { type: 'copy'; from: string; to: string; mode?: number }
  | { type: 'skip'; path: string; reason: string };

export function applyPlan(
  projectRoot: string,
  actions: PlannedAction[],
  dryRun: boolean,
): InstallManifest['managedPaths'] {
  const managed: InstallManifest['managedPaths'] = [];
  const backups: Array<{ path: string; backup: string | null }> = [];
  try {
    for (const action of actions) {
      if (action.type === 'skip') continue;
      const target = action.type === 'write' ? action.path : action.to;
      const absolute = path.isAbsolute(target) ? target : path.join(projectRoot, target);
      const originalHash = exists(absolute) ? sha256OfFile(absolute) : null;
      if (dryRun) {
        managed.push({
          path: path.relative(projectRoot, absolute),
          kind: originalHash ? 'patched' : 'created',
          originalHash,
          installedHash: action.type === 'write' ? sha256OfText(action.contents) : 'dry-run',
        });
        continue;
      }
      const backup = backupFile(absolute);
      backups.push({ path: absolute, backup });
      if (action.type === 'write') {
        writeText(absolute, action.contents, action.mode ?? 0o644);
      } else {
        const fromAbs = path.isAbsolute(action.from)
          ? action.from
          : path.join(projectRoot, action.from);
        writeText(
          absolute,
          readText(fromAbs),
          action.mode ?? 0o644,
        );
      }
      managed.push({
        path: path.relative(projectRoot, absolute).split(path.sep).join('/'),
        kind: originalHash ? 'patched' : 'created',
        originalHash,
        installedHash: sha256OfFile(absolute),
      });
    }
  } catch (error) {
    for (const item of backups.reverse()) {
      if (item.backup && exists(item.backup)) {
        writeText(item.path, readText(item.backup));
      }
    }
    throw error;
  }
  return managed;
}

export function releaseScripts(): Record<string, string> {
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

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return values[key]!;
  });
}
