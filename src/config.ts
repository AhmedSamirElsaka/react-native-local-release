import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText } from './fs.js';
import type { ReleaseConfig } from './types.js';
import { assertSafeRelativePath, assertSemver, assertTeamId, assertBundleId } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = 2;

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  minLength?: number;
  minimum?: number;
  minItems?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(actual: string, allowed: string[]): boolean {
  if (allowed.includes(actual)) return true;
  if (actual === 'integer' && allowed.includes('number')) return true;
  return false;
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  pathLabel = '$',
): string[] {
  const errors: string[] = [];
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (
      !matchesType(actual, allowed) &&
      !(actual === 'number' && allowed.includes('integer') && Number.isInteger(value))
    ) {
      errors.push(`${pathLabel}: expected ${allowed.join('|')}, got ${actual}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathLabel}: value must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.minLength != null && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${pathLabel}: string too short`);
  }
  if (schema.minimum != null && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${pathLabel}: number below minimum ${schema.minimum}`);
  }
  if (schema.minItems != null && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${pathLabel}: array too short`);
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (!(key in obj)) errors.push(`${pathLabel}: missing required property "${key}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push(`${pathLabel}: unexpected property "${key}"`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(obj[key], childSchema, `${pathLabel}.${key}`));
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, schema.items!, `${pathLabel}[${index}]`));
    });
  }
  return errors;
}

export function loadSchema(): JsonSchema {
  const schemaPath = path.join(__dirname, '..', 'schema', 'release.config.schema.json');
  return JSON.parse(readText(schemaPath)) as JsonSchema;
}

export function validateReleaseConfig(config: unknown): string[] {
  const errors = validateAgainstSchema(config, loadSchema());
  if (!config || typeof config !== 'object') {
    return errors;
  }
  const cfg = config as ReleaseConfig;
  if (cfg.ios?.buildNumberStrategy?.mode === 'fixed') {
    if (!('value' in cfg.ios.buildNumberStrategy) || !cfg.ios.buildNumberStrategy.value) {
      errors.push('$.ios.buildNumberStrategy: fixed mode requires value >= 1');
    }
  }
  try {
    if (cfg.ios?.teamId) assertTeamId(cfg.ios.teamId);
  } catch (error) {
    errors.push(`$.ios.teamId: ${(error as Error).message}`);
  }
  try {
    if (cfg.app?.packageName) assertBundleId(cfg.app.packageName);
  } catch (error) {
    errors.push(`$.app.packageName: ${(error as Error).message}`);
  }
  try {
    if (cfg.app?.bundleIdentifier) assertBundleId(cfg.app.bundleIdentifier);
  } catch (error) {
    errors.push(`$.app.bundleIdentifier: ${(error as Error).message}`);
  }
  for (const source of cfg.version?.sources || []) {
    try {
      assertSafeRelativePath(source.path);
    } catch (error) {
      errors.push(`version.source ${source.path}: ${(error as Error).message}`);
    }
  }
  return errors;
}

export function assertValidReleaseConfig(config: unknown): asserts config is ReleaseConfig {
  const errors = validateReleaseConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid release.config.json:\n- ${errors.join('\n- ')}`);
  }
}

export function loadReleaseConfig(root: string): { config: ReleaseConfig; configPath: string } {
  const configPath = path.join(root, 'fastlane', 'release.config.json');
  if (!exists(configPath)) {
    throw new Error(`Missing ${configPath}`);
  }
  const config = JSON.parse(readText(configPath)) as unknown;
  const migrated = migrateConfig(config);
  assertValidReleaseConfig(migrated);
  return { config: migrated, configPath };
}

export function migrateConfig(raw: unknown): ReleaseConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Config must be an object');
  }
  const input = raw as Record<string, unknown>;
  const schemaVersion = Number(input.schemaVersion || 1);
  let next = { ...input };
  if (schemaVersion < 2) {
    const ios = (next.ios || {}) as Record<string, unknown>;
    const android = (next.android || {}) as Record<string, unknown>;
    next = {
      ...next,
      schemaVersion: SCHEMA_VERSION,
      ios: {
        enabled: true,
        exportOptionsPath: 'ios/exportOptions.plist',
        ...ios,
      },
      android: {
        enabled: true,
        dsl: String(android.buildGradlePath || '').endsWith('.kts') ? 'kotlin' : 'groovy',
        ...android,
      },
      credentials: (next.credentials as object) || {
        provider: process.platform === 'darwin' ? 'keychain' : 'file',
      },
      logging: (next.logging as object) || { enabled: true, directory: 'logs' },
      archives: (next.archives as object) || {
        storeUploadedVersions: false,
        directory: 'versions',
      },
      version: {
        extraFiles: [],
        ...((next.version as object) || {}),
      },
      gates: {
        requireCompileBeforeUpload: true,
        ...((next.gates as object) || {}),
      },
    };
  }
  return next as ReleaseConfig;
}

export function deepMergeConfig(
  detected: ReleaseConfig,
  existing: ReleaseConfig,
): ReleaseConfig {
  return {
    ...detected,
    ...existing,
    schemaVersion: SCHEMA_VERSION,
    app: { ...detected.app, ...existing.app },
    ios: { ...detected.ios, ...existing.ios },
    android: { ...detected.android, ...existing.android },
    version: {
      ...detected.version,
      ...existing.version,
      sources: existing.version.sources?.length
        ? existing.version.sources
        : detected.version.sources,
      extraFiles: existing.version.extraFiles ?? detected.version.extraFiles,
    },
    verify: { ...detected.verify, ...existing.verify },
    build: { ...detected.build, ...existing.build },
    gates: { ...detected.gates, ...existing.gates },
    credentials: { ...detected.credentials, ...existing.credentials },
    logging: { ...detected.logging, ...existing.logging },
    archives: { ...detected.archives, ...existing.archives },
    ruby: { ...detected.ruby, ...existing.ruby },
  };
}

export function validateProjectPaths(root: string, config: ReleaseConfig): string[] {
  const missing: string[] = [];
  const requiredPaths: string[] = [];
  if (config.ios.enabled) {
    requiredPaths.push(
      config.ios.workspace,
      config.ios.project,
      path.posix.join(config.ios.project, 'project.pbxproj'),
      config.ios.exportOptionsPath,
    );
  }
  if (config.android.enabled) {
    requiredPaths.push(config.android.buildGradlePath);
  }
  for (const relative of requiredPaths) {
    if (!exists(path.join(root, relative))) missing.push(relative);
  }
  for (const source of config.version.sources || []) {
    if (!exists(path.join(root, source.path))) missing.push(source.path);
  }
  for (const extra of config.version.extraFiles || []) {
    if (!exists(path.join(root, extra.path))) missing.push(extra.path);
  }
  return missing;
}

export function jsonPretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export { assertSemver };
