import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeText(filePath: string, contents: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode });
  fs.chmodSync(filePath, mode);
}

export function writeSecretText(filePath: string, contents: string): void {
  writeText(filePath, contents, 0o600);
}

export function copyFileSecure(src: string, dest: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, mode);
}

export function ensureDir(dirPath: string, mode = 0o755): void {
  fs.mkdirSync(dirPath, { recursive: true, mode });
  try {
    fs.chmodSync(dirPath, mode);
  } catch {
    // ignore chmod failures on some filesystems
  }
}

export function ensureSecretDir(dirPath: string): void {
  ensureDir(dirPath, 0o700);
}

export function sha256OfFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function sha256OfText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function backupFile(filePath: string): string | null {
  if (!exists(filePath)) {
    return null;
  }
  const backupPath = `${filePath}.rn-local-release.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function removeFile(filePath: string): void {
  if (exists(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

export function fileMode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

export function assertOwnerOnlyReadable(filePath: string): void {
  if (!exists(filePath)) {
    return;
  }
  if (isSymlink(filePath)) {
    throw new Error(`Refusing symlink credential path: ${filePath}`);
  }
  const mode = fileMode(filePath);
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Insecure permissions on ${filePath} (${mode.toString(8)}). Run: chmod 600 ${filePath}`,
    );
  }
}
