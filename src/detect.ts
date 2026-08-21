import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './fs.js';
import { SCHEMA_VERSION } from './config.js';
import type { CliOptions, DetectionResult, ReleaseConfig } from './types.js';

function firstMatch(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[1] ?? null;
}

function detectPackageManager(root: string): DetectionResult['packageManager'] {
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'package-lock.json'))) return 'npm';
  return 'yarn';
}

function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (
      exists(path.join(current, 'pnpm-workspace.yaml')) ||
      exists(path.join(current, 'lerna.json')) ||
      (exists(path.join(current, 'package.json')) &&
        (() => {
          try {
            const pkg = JSON.parse(readText(path.join(current, 'package.json'))) as {
              workspaces?: unknown;
            };
            return Boolean(pkg.workspaces);
          } catch {
            return false;
          }
        })())
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function detectAndroid(root: string): DetectionResult['android'] {
  const groovy = path.join(root, 'android', 'app', 'build.gradle');
  const kts = path.join(root, 'android', 'app', 'build.gradle.kts');
  if (exists(groovy)) {
    const gradle = readText(groovy);
    return {
      supported: true,
      dsl: 'groovy',
      buildGradlePath: 'android/app/build.gradle',
      applicationId: firstMatch(gradle, /applicationId\s+["']([^"']+)["']/),
      versionCode: (() => {
        const value = firstMatch(gradle, /versionCode\s+(\d+)/);
        return value ? Number(value) : null;
      })(),
      versionName: firstMatch(gradle, /versionName\s+["']([^"']+)["']/),
      aabPath: 'android/app/build/outputs/bundle/release/app-release.aab',
    };
  }
  if (exists(kts)) {
    const gradle = readText(kts);
    return {
      supported: true,
      dsl: 'kotlin',
      buildGradlePath: 'android/app/build.gradle.kts',
      applicationId:
        firstMatch(gradle, /applicationId\s*=\s*["']([^"']+)["']/) ||
        firstMatch(gradle, /applicationId\s+["']([^"']+)["']/),
      versionCode: (() => {
        const value =
          firstMatch(gradle, /versionCode\s*=\s*(\d+)/) ||
          firstMatch(gradle, /versionCode\s+(\d+)/);
        return value ? Number(value) : null;
      })(),
      versionName:
        firstMatch(gradle, /versionName\s*=\s*["']([^"']+)["']/) ||
        firstMatch(gradle, /versionName\s+["']([^"']+)["']/),
      aabPath: 'android/app/build/outputs/bundle/release/app-release.aab',
    };
  }
  return {
    supported: false,
    reason: 'Missing android/app/build.gradle or build.gradle.kts',
  };
}

function detectIos(root: string): DetectionResult['ios'] {
  const iosRoot = path.join(root, 'ios');
  if (!exists(iosRoot)) {
    return { supported: false, reason: 'Missing ios/ directory' };
  }
  const workspaces = fs
    .readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcworkspace'))
    .map((entry) => path.join('ios', entry.name));
  const projects = fs
    .readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'))
    .map((entry) => path.join('ios', entry.name));

  if (workspaces.length === 0 && projects.length === 0) {
    return { supported: false, reason: 'No iOS .xcworkspace or .xcodeproj found' };
  }
  if (workspaces.length > 1 || projects.length > 1) {
    return {
      supported: false,
      ambiguous: true,
      reason:
        'Multiple iOS workspaces/projects found. Pass --ios-workspace and --ios-scheme explicitly.',
      workspaces,
      projects,
    };
  }

  const workspace = workspaces[0] || null;
  const project =
    projects[0] || (workspace ? workspace.replace(/\.xcworkspace$/, '.xcodeproj') : null);
  const scheme = project
    ? path.basename(project, '.xcodeproj')
    : path.basename(workspace || '', '.xcworkspace');

  let bundleIdentifier: string | null = null;
  let teamId: string | null = null;
  let marketingVersion: string | null = null;
  let currentProjectVersion: number | null = null;
  if (project && exists(path.join(root, project, 'project.pbxproj'))) {
    const pbx = readText(path.join(root, project, 'project.pbxproj'));
    // Prefer Release configuration values when present.
    const releaseBlock =
      pbx.match(
        /\/\* Release \*\/\s*=\s*\{[\s\S]*?buildSettings\s*=\s*\{([\s\S]*?)\};\s*\};/,
      )?.[1] || pbx;
    bundleIdentifier = firstMatch(
      releaseBlock,
      /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/,
    );
    teamId = firstMatch(releaseBlock, /DEVELOPMENT_TEAM = ([^;]+);/);
    marketingVersion = firstMatch(releaseBlock, /MARKETING_VERSION = ([^;]+);/);
    const cpv = firstMatch(releaseBlock, /CURRENT_PROJECT_VERSION = (\d+);/);
    if (bundleIdentifier) bundleIdentifier = bundleIdentifier.replace(/"/g, '').trim();
    if (teamId) teamId = teamId.replace(/"/g, '').trim();
    if (marketingVersion) marketingVersion = marketingVersion.replace(/"/g, '').trim();
    currentProjectVersion = cpv ? Number(cpv) : null;
  }

  return {
    supported: true,
    workspace: workspace || project,
    project,
    scheme,
    bundleIdentifier,
    teamId,
    marketingVersion,
    currentProjectVersion,
    exportOptionsPath: 'ios/exportOptions.plist',
  };
}

function detectVersionUtils(root: string): DetectionResult['versionExtra'] {
  const candidate = path.join(root, 'src', 'utils', 'versionUtils.ts');
  if (!exists(candidate)) return null;
  const text = readText(candidate);
  if (!/return\s+'[^']+'/.test(text) && !/return\s+"[^"]+"/.test(text)) return null;
  return {
    path: 'src/utils/versionUtils.ts',
    kind: 'stringLiteral',
    pattern: "return 'VERSION';",
  };
}

export function detectProject(root: string, options: Partial<CliOptions> = {}): DetectionResult {
  const packageJsonPath = path.join(root, 'package.json');
  if (!exists(packageJsonPath)) {
    throw new Error(`No package.json found in ${root}`);
  }
  const packageJson = JSON.parse(readText(packageJsonPath)) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const hasReactNative =
    Boolean(packageJson.dependencies?.['react-native']) ||
    Boolean(packageJson.devDependencies?.['react-native']);
  if (!hasReactNative) {
    throw new Error('package.json does not list react-native');
  }

  const android = detectAndroid(root);
  const ios = detectIos(root);

  if (options.iosWorkspace) {
    ios.workspace = options.iosWorkspace;
    ios.supported = true;
    ios.ambiguous = false;
    if (!exists(path.join(root, options.iosWorkspace))) {
      throw new Error(`iOS workspace not found: ${options.iosWorkspace}`);
    }
  }
  if (options.iosScheme) ios.scheme = options.iosScheme;
  if (options.teamId) ios.teamId = options.teamId;
  if (options.packageName) android.applicationId = options.packageName;

  const packageManager = detectPackageManager(root);
  const installCommand =
    packageManager === 'yarn'
      ? 'yarn install --frozen-lockfile'
      : packageManager === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : 'npm ci';
  const runPrefix =
    packageManager === 'yarn' ? 'yarn' : packageManager === 'pnpm' ? 'pnpm' : 'npm run';

  return {
    root,
    packageManager,
    packageJsonVersion: packageJson.version || '1.0.0',
    displayName: options.displayName || ios.scheme || packageJson.name || 'App',
    android,
    ios,
    versionExtra: detectVersionUtils(root),
    installCommand,
    runPrefix,
    workspaceRoot: findWorkspaceRoot(root),
  };
}

export function buildReleaseConfig(
  detection: DetectionResult,
  overrides: Partial<CliOptions> & {
    storeUploadedVersions?: boolean | null;
    credentialProvider?: 'keychain' | 'file' | 'env';
  } = {},
): ReleaseConfig {
  if (!detection.android.supported && !detection.ios.supported) {
    throw new Error(
      [detection.android.reason, detection.ios.reason].filter(Boolean).join(' | ') ||
        'Unsupported React Native layout',
    );
  }
  if (detection.android.supported === false && detection.android.reason) {
    // Android required for this toolkit's Play path; allow ios-only later via enabled flags.
  }
  if (!detection.android.supported) {
    throw new Error(detection.android.reason || 'Android project not supported');
  }
  if (!detection.ios.supported) {
    throw new Error(detection.ios.reason || 'iOS project not supported');
  }
  if (!detection.ios.teamId && !overrides.teamId) {
    throw new Error(
      'Could not detect iOS DEVELOPMENT_TEAM. Pass --team-id or set it in Xcode first.',
    );
  }

  const packageName =
    overrides.packageName ||
    detection.android.applicationId ||
    detection.ios.bundleIdentifier;
  if (!packageName) {
    throw new Error('Could not detect Android applicationId / iOS bundle id');
  }
  const bundleIdentifier =
    overrides.bundleIdentifier || detection.ios.bundleIdentifier || packageName;
  const teamId = overrides.teamId || detection.ios.teamId || '';
  const scheme = overrides.iosScheme || detection.ios.scheme || 'App';
  const workspace = overrides.iosWorkspace || detection.ios.workspace || '';
  const project =
    detection.ios.project || workspace.replace(/\.xcworkspace$/, '.xcodeproj');
  const dsl = detection.android.dsl || 'groovy';
  const buildGradlePath = detection.android.buildGradlePath || 'android/app/build.gradle';

  const iosBuildStrategy = overrides.fixedIosBuild
    ? ({ mode: 'fixed', value: Number(overrides.fixedIosBuild) } as const)
    : ({ mode: 'increment' } as const);

  const sources: ReleaseConfig['version']['sources'] = [
    { path: 'package.json', kind: 'packageJson' },
    {
      path: buildGradlePath,
      kind: dsl === 'kotlin' ? 'androidGradleKts' : 'androidGradle',
    },
    {
      path: path.posix.join(project.replace(/\\/g, '/'), 'project.pbxproj'),
      kind: 'iosPbxproj',
      targets: [scheme],
    },
  ];
  const extraFiles: ReleaseConfig['version']['extraFiles'] = [];
  if (detection.versionExtra) {
    extraFiles.push(detection.versionExtra);
  }

  const typecheck =
    detection.runPrefix === 'yarn' ? 'yarn tsc --noEmit' : `${detection.runPrefix} typecheck`;

  const credentialProvider =
    overrides.credentialProvider ||
    (process.platform === 'darwin' ? 'keychain' : 'file');

  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      displayName: overrides.displayName || detection.displayName,
      packageName,
      bundleIdentifier,
    },
    ios: {
      enabled: true,
      workspace,
      project,
      scheme,
      teamId,
      exportMethod: 'app-store',
      buildNumberStrategy: iosBuildStrategy,
      outputIpaName: `${scheme}.ipa`,
      exportOptionsPath: detection.ios.exportOptionsPath || 'ios/exportOptions.plist',
    },
    android: {
      enabled: true,
      module: 'app',
      buildGradlePath,
      dsl,
      playTrackBeta: 'internal',
      playTrackPromote: 'production',
      aabPath: detection.android.aabPath || 'android/app/build/outputs/bundle/release/app-release.aab',
      releaseStatus: 'completed',
    },
    version: {
      sources,
      defaultBump: 'patch',
      extraFiles,
    },
    verify: {
      install: detection.installCommand,
      commands: [
        detection.runPrefix === 'yarn' ? 'yarn lint' : `${detection.runPrefix} lint`,
        typecheck,
        detection.runPrefix === 'yarn'
          ? 'yarn test --runInBand'
          : `${detection.runPrefix} test -- --runInBand`,
      ],
    },
    build: {
      iosOutputDir: 'build/ios',
      typecheckCommand: typecheck,
      maxAabSizeMb: null,
      maxIpaSizeMb: null,
    },
    gates: {
      requireCleanGitForPromote: true,
      requireCompileBeforeUpload: true,
    },
    credentials: {
      provider: credentialProvider,
    },
    logging: {
      enabled: true,
      directory: 'logs',
    },
    archives: {
      storeUploadedVersions: overrides.storeUploadedVersions === true,
      directory: 'versions',
    },
    ruby: {
      version: '3.2.2',
    },
  };
}
