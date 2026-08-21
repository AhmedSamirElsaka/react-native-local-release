import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a path and ensure it stays within the project root (no traversal).
 */
export function resolveWithinRoot(projectRoot: string, inputPath: string): string {
  const rootReal = fs.realpathSync(path.resolve(projectRoot));
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(projectRoot, inputPath);

  let resolved = absolute;
  if (fs.existsSync(absolute)) {
    resolved = fs.realpathSync(absolute);
  }

  const relative = path.relative(rootReal, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${inputPath}`);
  }
  if (inputPath.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(inputPath)) {
    // Allow absolute paths outside check already handled; relative .. already rejected.
  }
  return resolved;
}

export function toPosixRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

export function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.trim() !== relativePath) {
    throw new Error(`Invalid path: ${relativePath}`);
  }
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(`Absolute or invalid path not allowed: ${relativePath}`);
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new Error(`Path traversal rejected: ${relativePath}`);
  }
  if (!/^[\w./@+-]+$/.test(normalized)) {
    throw new Error(`Path contains unsupported characters: ${relativePath}`);
  }
}

export const TEAM_ID_RE = /^[A-Z0-9]{6,12}$/;
export const BUNDLE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?$/;

export function assertTeamId(value: string): void {
  if (!TEAM_ID_RE.test(value)) {
    throw new Error(`Invalid Apple Team ID: ${value}`);
  }
}

export function assertBundleId(value: string): void {
  if (!BUNDLE_ID_RE.test(value)) {
    throw new Error(`Invalid bundle/package identifier: ${value}`);
  }
}

export function assertSemver(value: string): void {
  if (!SEMVER_RE.test(value)) {
    throw new Error(`Invalid marketing version (expected SemVer): ${value}`);
  }
}

export function rejectControlChars(value: string, label: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains control characters`);
  }
}
