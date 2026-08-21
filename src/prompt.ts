import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function ask(
  rl: readline.Interface,
  question: string,
  defaultValue = '',
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

export async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

/**
 * Hidden password prompt — does not echo characters.
 */
export async function askSecret(question: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    // Non-TTY fallback: still avoid echoing by reading without local echo where possible.
    const rl = readline.createInterface({ input, output: undefined as unknown as NodeJS.WritableStream });
    try {
      return (await rl.question(`${question}: `)).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    output.write(`${question}: `);
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    let value = '';
    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      for (const char of str) {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      if (typeof wasRaw === 'boolean') {
        input.setRawMode?.(wasRaw);
      } else {
        input.setRawMode?.(false);
      }
    };
    input.on('data', onData);
  });
}

export function createReadline(): readline.Interface {
  return readline.createInterface({ input, output });
}
