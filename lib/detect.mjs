import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './fs.mjs';

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : null;
}

function findFirst(root, relativeGlobParts) {
  // Simple recursive search for one extension under a directory.
  const [dir, ...rest] = relativeGlobParts;
  const base = path.join(root, dir);
  if (!exists(base)) {
    return null;
  }
  const wantedExt = rest[rest.length - 1];
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(wantedExt.replace('*', ''))) {
        return path.relative(root, full);
      }
    }
  }
  return null;
}

function detectPackageManager(root) {
  if (exists(path.join(root, 'yarn.lock'))) {
    return 'yarn';
  }
  if (exists(path.join(root, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (exists(path.join(root, 'package-lock.json'))) {
    return 'npm';
  }
  return 'yarn';
}

function detectAndroid(root) {
  const groovy = path.join(root, 'android', 'app', 'build.gradle');
  const kts = path.join(root, 'android', 'app', 'build.gradle.kts');
  if (exists(kts) && !exists(groovy)) {
    return {
      supported: false,
      reason:
        'Kotlin DSL (build.gradle.kts) is not supported yet. Convert android/app/build.gradle.kts to Groovy or patch signing manually.',
    };
  }
  if (!exists(groovy)) {
    return {
      supported: false,
      reason: 'Missing android/app/build.gradle',
    };
  }

  const gradle = readText(groovy);
  const applicationId = firstMatch(gradle, /applicationId\s+["']([^"']+)["']/);
  const versionCode = firstMatch(gradle, /versionCode\s+(\d+)/);
  const versionName = firstMatch(gradle, /versionName\s+["']([^"']+)["']/);

  return {
    supported: true,
    buildGradlePath: 'android/app/build.gradle',
    applicationId,
    versionCode: versionCode ? Number(versionCode) : null,
    versionName,
    aabPath: 'android/app/build/outputs/bundle/release/app-release.aab',
  };
}

function detectIos(root) {
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
  const project = projects[0] || (workspace ? workspace.replace(/\.xcworkspace$/, '.xcodeproj') : null);
  const scheme = project
    ? path.basename(project, '.xcodeproj')
    : path.basename(workspace, '.xcworkspace');

  let bundleIdentifier = null;
  let teamId = null;
  let marketingVersion = null;
  let currentProjectVersion = null;
  if (project && exists(path.join(root, project, 'project.pbxproj'))) {
    const pbx = readText(path.join(root, project, 'project.pbxproj'));
    bundleIdentifier = firstMatch(pbx, /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/);
    teamId = firstMatch(pbx, /DEVELOPMENT_TEAM = ([^;]+);/);
    marketingVersion = firstMatch(pbx, /MARKETING_VERSION = ([^;]+);/);
    currentProjectVersion = firstMatch(pbx, /CURRENT_PROJECT_VERSION = (\d+);/);
    if (bundleIdentifier) {
      bundleIdentifier = bundleIdentifier.replace(/"/g, '').trim();
    }
    if (teamId) {
      teamId = teamId.replace(/"/g, '').trim();
    }
  }

  return {
    supported: true,
    workspace: workspace || project,
    project,
    scheme,
    bundleIdentifier,
    teamId,
    marketingVersion,
    currentProjectVersion: currentProjectVersion
      ? Number(currentProjectVersion)
      : null,
    exportOptionsPath: 'ios/exportOptions.plist',
  };
}

function detectVersionUtils(root) {
  const candidate = path.join(root, 'src', 'utils', 'versionUtils.ts');
  if (!exists(candidate)) {
    return null;
  }
  const text = readText(candidate);
  if (!/return\s+'[^']+'/.test(text) && !/return\s+"[^"]+"/.test(text)) {
    return null;
  }
  return {
    path: 'src/utils/versionUtils.ts',
    kind: 'stringLiteral',
    pattern: "return 'VERSION';",
  };
}

export function detectProject(root, options = {}) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!exists(packageJsonPath)) {
    throw new Error(`No package.json found in ${root}`);
  }
  const packageJson = JSON.parse(readText(packageJsonPath));
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
  }
  if (options.iosScheme) {
    ios.scheme = options.iosScheme;
  }
  if (options.teamId) {
    ios.teamId = options.teamId;
  }
  if (options.packageName) {
    android.applicationId = options.packageName;
  }

  const packageManager = detectPackageManager(root);
  const installCommand =
    packageManager === 'yarn'
      ? 'yarn install --frozen-lockfile'
      : packageManager === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : 'npm ci';
  const runPrefix =
    packageManager === 'yarn' ? 'yarn' : packageManager === 'pnpm' ? 'pnpm' : 'npm run';

  const extra = detectVersionUtils(root);
  const displayName =
    options.displayName ||
    ios.scheme ||
    packageJson.name ||
    'App';

  return {
    root,
    packageManager,
    packageJsonVersion: packageJson.version || '1.0.0',
    displayName,
    android,
    ios,
    versionExtra: extra,
    installCommand,
    runPrefix,
  };
}

export function buildReleaseConfig(detection, overrides = {}) {
  if (!detection.android.supported) {
    throw new Error(detection.android.reason);
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
  const teamId = overrides.teamId || detection.ios.teamId;
  const scheme = overrides.iosScheme || detection.ios.scheme;
  const workspace = overrides.iosWorkspace || detection.ios.workspace;
  const project = detection.ios.project || workspace.replace(/\.xcworkspace$/, '.xcodeproj');

  const iosBuildStrategy =
    overrides.iosBuildNumberStrategy ||
    (overrides.fixedIosBuild
      ? { mode: 'fixed', value: Number(overrides.fixedIosBuild) }
      : { mode: 'increment' });

  const sources = [
    { path: 'package.json', kind: 'packageJson' },
    { path: detection.android.buildGradlePath, kind: 'androidGradle' },
    {
      path: path.posix.join(project.replace(/\\/g, '/'), 'project.pbxproj'),
      kind: 'iosPbxproj',
    },
  ];

  const extraFiles = [];
  if (detection.versionExtra) {
    extraFiles.push(detection.versionExtra);
  }
  if (Array.isArray(overrides.extraVersionFiles)) {
    extraFiles.push(...overrides.extraVersionFiles);
  }

  const typecheck =
    overrides.typecheckCommand ||
    (detection.runPrefix === 'yarn' ? 'yarn tsc --noEmit' : `${detection.runPrefix} typecheck`);

  return {
    app: {
      displayName: overrides.displayName || detection.displayName,
      packageName,
      bundleIdentifier,
    },
    ios: {
      workspace,
      project,
      scheme,
      teamId,
      exportMethod: overrides.exportMethod || 'app-store',
      buildNumberStrategy: iosBuildStrategy,
      outputIpaName: overrides.outputIpaName || `${scheme}.ipa`,
      exportOptionsPath: detection.ios.exportOptionsPath || 'ios/exportOptions.plist',
    },
    android: {
      module: 'app',
      buildGradlePath: detection.android.buildGradlePath,
      playTrackBeta: overrides.playTrackBeta || 'internal',
      playTrackPromote: overrides.playTrackPromote || 'production',
      aabPath: detection.android.aabPath,
      releaseStatus: overrides.releaseStatus || 'completed',
    },
    version: {
      sources,
      defaultBump: overrides.defaultBump || 'patch',
      extraFiles,
    },
    verify: {
      install: overrides.installCommand || detection.installCommand,
      commands: overrides.verifyCommands || [
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
      maxAabSizeMb: overrides.maxAabSizeMb ?? null,
      maxIpaSizeMb: overrides.maxIpaSizeMb ?? null,
    },
    gates: {
      requireCleanGitForPromote: true,
      requireCompileBeforeUpload: true,
    },
    ruby: {
      version: overrides.rubyVersion || '3.2.2',
    },
  };
}
