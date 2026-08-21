import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeText } from './fs.js';

const SECRET_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/,
  /ASC_KEY_ID=\S+/,
  /MYAPP_UPLOAD_(STORE|KEY)_PASSWORD=\S+/i,
];

export function redact(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, '[REDACTED]');
  }
  return next;
}

export class ProjectLogger {
  constructor(
    private readonly projectRoot: string,
    private readonly enabled: boolean,
    private readonly directory = 'logs',
  ) {}

  private logPath(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.projectRoot, this.directory, `rn-local-release-${stamp}.log`);
  }

  private ensure(): string | null {
    if (!this.enabled) {
      return null;
    }
    const dir = path.join(this.projectRoot, this.directory);
    ensureDir(dir, 0o700);
    return this.logPath();
  }

  write(level: 'info' | 'warn' | 'error', message: string, error?: unknown): string | null {
    const file = this.ensure();
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${redact(message)}`;
    let details = '';
    if (error instanceof Error) {
      details = `\n${redact(error.stack || error.message)}`;
    } else if (error !== undefined) {
      details = `\n${redact(String(error))}`;
    }
    if (file) {
      fs.appendFileSync(file, `${line}${details}\n`, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        // ignore
      }
    }
    return file;
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string, error?: unknown): string | null {
    return this.write('error', message, error);
  }
}

export function writeCrashLog(
  projectRoot: string,
  error: unknown,
  directory = 'logs',
): string {
  const logger = new ProjectLogger(projectRoot, true, directory);
  const file =
    logger.error(error instanceof Error ? error.message : String(error), error) ||
    path.join(projectRoot, directory, 'rn-local-release-crash.log');
  if (!fs.existsSync(file)) {
    ensureDir(path.dirname(file), 0o700);
    writeText(
      file,
      redact(error instanceof Error ? error.stack || error.message : String(error)),
      0o600,
    );
  }
  return file;
}
