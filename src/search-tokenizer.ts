export interface CodexProviderSearchTokenizerOptions {
  unique?: boolean;
  minWordLength?: number;
}

export function tokenizeSearchText(
  value: string,
  options: CodexProviderSearchTokenizerOptions = {},
): string[] {
  const unique = options.unique !== false;
  const minWordLength = normalizeMinWordLength(options.minWordLength);
  const tokens: string[] = [];
  let wordRun = '';
  let cjkRun = '';

  const flushWordRun = () => {
    if (!wordRun) {
      return;
    }
    tokens.push(...tokensForWordRun(wordRun, minWordLength));
    wordRun = '';
  };
  const flushCjkRun = () => {
    if (!cjkRun) {
      return;
    }
    tokens.push(...tokensForCjkRun(cjkRun));
    cjkRun = '';
  };

  for (const char of String(value ?? '').toLowerCase()) {
    if (isCjkChar(char)) {
      flushWordRun();
      cjkRun += char;
      continue;
    }
    if (isWordChar(char)) {
      flushCjkRun();
      wordRun += char;
      continue;
    }
    flushWordRun();
    flushCjkRun();
  }

  flushWordRun();
  flushCjkRun();

  return unique ? uniqueInOrder(tokens) : tokens;
}

function tokensForWordRun(run: string, minWordLength: number): string[] {
  const normalized = run.replace(/^[-_]+|[-_]+$/gu, '');
  if (!normalized) {
    return [];
  }
  const tokens = normalized.length >= minWordLength ? [normalized] : [];
  if (/[-_]/u.test(normalized)) {
    tokens.push(...normalized
      .split(/[-_]+/u)
      .filter((part) => part.length >= minWordLength));
  }
  return tokens;
}

function tokensForCjkRun(run: string): string[] {
  const chars = [...run];
  if (chars.length <= 1) {
    return chars;
  }
  const tokens: string[] = [chars.join('')];
  for (const size of [2, 3]) {
    if (chars.length < size) {
      continue;
    }
    for (let index = 0; index <= chars.length - size; index += 1) {
      tokens.push(chars.slice(index, index + size).join(''));
    }
  }
  return tokens;
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    tokens.push(value);
  }
  return tokens;
}

function isWordChar(char: string): boolean {
  return /^[\p{L}\p{N}_-]$/u.test(char);
}

function isCjkChar(char: string): boolean {
  return /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]$/u.test(char);
}

function normalizeMinWordLength(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return 2;
  }
  return Math.min(10, number);
}
