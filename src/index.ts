export { detectProject, buildReleaseConfig } from './detect.js';
export {
  loadReleaseConfig,
  validateReleaseConfig,
  migrateConfig,
  SCHEMA_VERSION,
} from './config.js';
export { redact, ProjectLogger, writeCrashLog } from './logging.js';
export { runArgv, parseTrustedCommand } from './process.js';
export {
  patchAndroidBuildGradle,
  patchGradleProperties,
  mergeGitignore,
  mergeGemfile,
  mergePackageScripts,
  upsertMarkedBlock,
  renderTemplate,
} from './patch.js';
export type { ReleaseConfig, DetectionResult, CliOptions } from './types.js';
