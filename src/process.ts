import { spawnSync } from 'node:child_process';

export type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

/**
 * Execute a command without a shell — argv only.
 */
export function runArgv(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): SpawnResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
  };
}

const ALLOWED_PACKAGE_MANAGERS = new Set(['yarn', 'npm', 'pnpm', 'bundle', 'node']);

/**
 * Parse a simple package-manager command into argv.
 * Rejects shell metacharacters. Supports: yarn lint, npm run typecheck, etc.
 */
export function parseTrustedCommand(command: string): { command: string; args: string[] } {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error('Empty command');
  }
  if (/[;|&`$()<>]/.test(trimmed) || trimmed.includes('\n')) {
    throw new Error(
      `Refusing shell metacharacters in command: ${trimmed}. Use argv-safe commands only.`,
    );
  }
  const parts = trimmed.split(/\s+/);
  const bin = parts[0];
  if (!bin || !ALLOWED_PACKAGE_MANAGERS.has(bin)) {
    throw new Error(
      `Command binary not allowlisted: ${bin}. Allowed: ${[...ALLOWED_PACKAGE_MANAGERS].join(', ')}`,
    );
  }
  return { command: bin, args: parts.slice(1) };
}

export function runTrustedCommand(
  command: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SpawnResult {
  const parsed = parseTrustedCommand(command);
  return runArgv(parsed.command, parsed.args, options);
}
