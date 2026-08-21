import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText } from './fs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'schema', 'release.config.schema.json');

function typeOf(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    // JSON Schema "integer" is a number subtype.
    return 'integer';
  }
  return typeof value;
}

function matchesType(actual, allowed) {
  if (allowed.includes(actual)) {
    return true;
  }
  // Accept integers where number is allowed, and numbers that are integers
  // when integer is required (handled by typeOf).
  if (actual === 'integer' && allowed.includes('number')) {
    return true;
  }
  return false;
}

function validateAgainstSchema(value, schema, pathLabel = '$') {
  const errors = [];

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    // When schema asks for integer, typeOf already returns integer for whole numbers.
    // When schema asks for number, integers are also valid JSON numbers.
    if (!matchesType(actual, allowed) && !(actual === 'number' && allowed.includes('integer') && Number.isInteger(value))) {
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
    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push(`${pathLabel}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push(`${pathLabel}: unexpected property "${key}"`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) {
        errors.push(...validateAgainstSchema(value[key], childSchema, `${pathLabel}.${key}`));
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, schema.items, `${pathLabel}[${index}]`));
    });
  }

  return errors;
}

export function loadSchema() {
  return JSON.parse(readText(schemaPath));
}

export function validateReleaseConfig(config) {
  const schema = loadSchema();
  return validateAgainstSchema(config, schema);
}

export function assertValidReleaseConfig(config) {
  const errors = validateReleaseConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid release.config.json:\n- ${errors.join('\n- ')}`);
  }
}

export function loadReleaseConfig(root) {
  const configPath = path.join(root, 'fastlane', 'release.config.json');
  if (!exists(configPath)) {
    throw new Error(`Missing ${configPath}`);
  }
  const config = JSON.parse(readText(configPath));
  assertValidReleaseConfig(config);
  return { config, configPath };
}

export function validateProjectPaths(root, config) {
  const missing = [];
  const requiredPaths = [
    config.ios.workspace,
    config.ios.project,
    path.posix.join(config.ios.project, 'project.pbxproj'),
    config.android.buildGradlePath,
    config.ios.exportOptionsPath,
  ];
  for (const relative of requiredPaths) {
    if (!exists(path.join(root, relative))) {
      missing.push(relative);
    }
  }
  for (const source of config.version.sources || []) {
    if (!exists(path.join(root, source.path))) {
      missing.push(source.path);
    }
  }
  for (const extra of config.version.extraFiles || []) {
    if (!exists(path.join(root, extra.path))) {
      missing.push(extra.path);
    }
  }
  return missing;
}
