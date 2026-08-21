export type PackageManager = 'yarn' | 'npm' | 'pnpm';

export type IosBuildNumberStrategy =
  | { mode: 'increment' }
  | { mode: 'fixed'; value: number };

export type VersionSourceKind =
  | 'packageJson'
  | 'androidGradle'
  | 'androidGradleKts'
  | 'iosPbxproj'
  | 'stringLiteral';

export type CredentialProviderKind = 'keychain' | 'file' | 'env';

export type ReleaseConfig = {
  schemaVersion: number;
  app: {
    displayName: string;
    packageName: string;
    bundleIdentifier: string;
  };
  ios: {
    enabled: boolean;
    workspace: string;
    project: string;
    scheme: string;
    teamId: string;
    exportMethod: 'app-store' | 'ad-hoc' | 'enterprise' | 'development';
    buildNumberStrategy: IosBuildNumberStrategy;
    outputIpaName: string;
    exportOptionsPath: string;
  };
  android: {
    enabled: boolean;
    module: string;
    buildGradlePath: string;
    dsl: 'groovy' | 'kotlin';
    playTrackBeta: string;
    playTrackPromote: string;
    aabPath: string;
    releaseStatus: string;
  };
  version: {
    sources: Array<{
      path: string;
      kind: VersionSourceKind;
      pattern?: string;
      targets?: string[];
    }>;
    defaultBump: 'patch' | 'minor' | 'major';
    extraFiles: Array<{
      path: string;
      kind: 'stringLiteral';
      pattern?: string;
    }>;
  };
  verify: {
    install: string;
    commands: string[];
  };
  build: {
    iosOutputDir: string;
    typecheckCommand: string;
    maxAabSizeMb: number | null;
    maxIpaSizeMb: number | null;
  };
  gates: {
    requireCleanGitForPromote: boolean;
    requireCompileBeforeUpload: boolean;
  };
  credentials: {
    provider: CredentialProviderKind;
  };
  logging: {
    enabled: boolean;
    directory: string;
  };
  archives: {
    storeUploadedVersions: boolean;
    directory: string;
  };
  ruby: {
    version: string;
  };
};

export type InstallManifest = {
  kitVersion: string;
  installedAt: string;
  projectRoot: string;
  managedPaths: Array<{
    path: string;
    kind: 'created' | 'patched' | 'copied';
    originalHash: string | null;
    installedHash: string;
  }>;
  configHash: string;
};

export type CliOptions = {
  command: string;
  project: string;
  dryRun: boolean;
  nonInteractive: boolean;
  force: boolean;
  yes: boolean;
  setupCredentials: boolean | null;
  credentialsOnly: boolean;
  purgeCredentials: boolean;
  teamId?: string;
  packageName?: string;
  bundleIdentifier?: string;
  displayName?: string;
  iosWorkspace?: string;
  iosScheme?: string;
  fixedIosBuild?: string;
  storeUploadedVersions?: boolean | null;
  help: boolean;
  version: boolean;
};

export type DetectionResult = {
  root: string;
  packageManager: PackageManager;
  packageJsonVersion: string;
  displayName: string;
  installCommand: string;
  runPrefix: string;
  android: {
    supported: boolean;
    reason?: string;
    dsl?: 'groovy' | 'kotlin';
    buildGradlePath?: string;
    applicationId?: string | null;
    versionCode?: number | null;
    versionName?: string | null;
    aabPath?: string;
  };
  ios: {
    supported: boolean;
    reason?: string;
    ambiguous?: boolean;
    workspace?: string | null;
    project?: string | null;
    scheme?: string | null;
    bundleIdentifier?: string | null;
    teamId?: string | null;
    marketingVersion?: string | null;
    currentProjectVersion?: number | null;
    exportOptionsPath?: string;
    workspaces?: string[];
    projects?: string[];
  };
  versionExtra: {
    path: string;
    kind: 'stringLiteral';
    pattern: string;
  } | null;
  workspaceRoot: string | null;
};
