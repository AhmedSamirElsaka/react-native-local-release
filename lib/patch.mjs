import path from 'node:path';
import { exists, readText, writeText, backupFile } from './fs.mjs';

const BEGIN = '# >>> rn-local-release';
const END = '# <<< rn-local-release';
const BEGIN_JSON = '/* >>> rn-local-release';
const END_JSON = '<<< rn-local-release */';

export function upsertMarkedBlock(content, block, begin = BEGIN, end = END) {
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

export function mergePackageScripts(packageJson, scripts) {
  const next = { ...packageJson, scripts: { ...(packageJson.scripts || {}) } };
  for (const [key, value] of Object.entries(scripts)) {
    next.scripts[key] = value;
  }
  if (!next.scripts.typecheck) {
    next.scripts.typecheck = 'tsc --noEmit';
  }
  return next;
}

export function mergeGemfile(content) {
  let next = content;
  if (!/ruby\s+".*<\s*4\.0/.test(next) && /ruby\s+"/.test(next)) {
    next = next.replace(
      /ruby\s+"([^"]+)"/,
      'ruby ">= 2.6.10", "< 4.0"',
    );
  }
  if (!/gem ['"]fastlane['"]/.test(next)) {
    next = upsertMarkedBlock(
      next,
      "gem 'fastlane'",
    );
  }
  return next;
}

/** Default ignore rules written into every installed project's `.gitignore`. */
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
  'secrets/*',
  '!secrets/.gitignore',
  '!secrets/README.md',
  'credentials.txt',
  '**/credentials.txt',
  '**/AuthKey_*.p8',
  '**/play-store-*.json',
  '**/google-play-*.json',
  '**/*-service-account*.json',
  'build/ios/',
  'build/release-manifest.json',
  '*.rn-local-release.bak',
];

export function mergeGitignore(content) {
  const block = DEFAULT_GITIGNORE_ENTRIES.join('\n');
  return upsertMarkedBlock(content || '', block);
}

/**
 * Always create or update `.gitignore` so credentials cannot be committed by default.
 */
export function ensureProjectGitignore(projectRoot, { dryRun = false } = {}) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const existing = exists(gitignorePath) ? readText(gitignorePath) : '';
  const merged = mergeGitignore(existing);
  if (dryRun) {
    return { path: gitignorePath, wrote: false, dryRun: true, created: !exists(gitignorePath) };
  }
  if (!exists(gitignorePath)) {
    writeText(gitignorePath, merged.endsWith('\n') ? merged : `${merged}\n`);
    return { path: gitignorePath, wrote: true, created: true };
  }
  return writeWithBackup(gitignorePath, merged.endsWith('\n') ? merged : `${merged}\n`, {
    dryRun: false,
  });
}

const SIGNING_HELPER = `
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
`.trim();

const RELEASE_GUARD = `
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
            "Release signing is not configured. Set MYAPP_UPLOAD_STORE_FILE, " +
            "MYAPP_UPLOAD_STORE_PASSWORD, MYAPP_UPLOAD_KEY_ALIAS, and " +
            "MYAPP_UPLOAD_KEY_PASSWORD via environment variables, " +
            "android/keystore.properties, or Gradle properties."
        )
    }
}
`.trim();

export function patchAndroidBuildGradle(content) {
  let next = content;

  if (!next.includes('def loadKeystoreProperties()')) {
    next = next.replace(
      /def jscFlavor[^\n]*\n/,
      (match) => `${match}\n${SIGNING_HELPER}\n\n`,
    );
  }

  // Soften release signingConfig to conditional if it still uses bare MYAPP_UPLOAD_*
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

  if (!next.includes('gradle.taskGraph.whenReady')) {
    next = next.replace(
      /\n(dependencies\s*\{)/,
      `\n${RELEASE_GUARD}\n\n$1`,
    );
  }

  if (!/reactNativeArchitectures=/.test(next)) {
    // handled in gradle.properties
  }

  return next;
}

export function patchGradleProperties(content) {
  let next = content;
  if (/reactNativeArchitectures=/.test(next)) {
    next = next.replace(
      /reactNativeArchitectures=.*/,
      'reactNativeArchitectures=armeabi-v7a,arm64-v8a',
    );
  } else {
    next = `${next.trimEnd()}\nreactNativeArchitectures=armeabi-v7a,arm64-v8a\n`;
  }
  if (!/android\.enableR8\.fullMode=/.test(next)) {
    next = `${next.trimEnd()}\nandroid.enableR8.fullMode=false\n`;
  }

  // Never leave upload passwords in tracked gradle.properties.
  next = next
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('MYAPP_UPLOAD_STORE_PASSWORD=') &&
        !line.startsWith('MYAPP_UPLOAD_KEY_PASSWORD='),
    )
    .join('\n');

  if (!/MYAPP_UPLOAD_STORE_FILE=/.test(next)) {
    next = `${next.trimEnd()}\nMYAPP_UPLOAD_STORE_FILE=keystore.jks\nMYAPP_UPLOAD_KEY_ALIAS=key0\n`;
  }
  return next.endsWith('\n') ? next : `${next}\n`;
}

export function writeWithBackup(filePath, contents, { dryRun = false } = {}) {
  if (dryRun) {
    return { path: filePath, wrote: false, dryRun: true };
  }
  const backup = backupFile(filePath);
  writeText(filePath, contents);
  return { path: filePath, wrote: true, backup };
}

export function ensureRubyVersion(root, version, { dryRun = false } = {}) {
  const filePath = path.join(root, '.ruby-version');
  if (exists(filePath)) {
    return { path: filePath, wrote: false };
  }
  if (dryRun) {
    return { path: filePath, wrote: false, dryRun: true };
  }
  writeText(filePath, `${version}\n`);
  return { path: filePath, wrote: true };
}
