import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type CodexProviderWebRetrievalErrorCode =
  | 'external_web_access_disabled'
  | 'http_error'
  | 'invalid_url'
  | 'max_bytes_exceeded'
  | 'max_redirects_exceeded'
  | 'ssrf_blocked'
  | 'timeout'
  | 'unsupported_content_type';

export class CodexProviderWebRetrievalError extends Error {
  constructor(
    message: string,
    readonly code: CodexProviderWebRetrievalErrorCode,
    readonly status: number | null = null,
    readonly retryable: boolean | null = null,
  ) {
    super(message);
    this.name = 'CodexProviderWebRetrievalError';
  }
}

export interface CodexProviderWebRetrievalSafetyOptions {
  allowPrivateHosts?: boolean | null;
  allowedProtocols?: string[] | null;
  resolver?: CodexProviderNetworkResolver | null;
}

export interface CodexProviderNetworkAddress {
  address: string;
  family: 4 | 6;
}

export interface CodexProviderNetworkResolver {
  lookup(hostname: string): Promise<CodexProviderNetworkAddress[]>;
}

const DEFAULT_ALLOWED_PROTOCOLS = ['http:', 'https:'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'metadata.google.internal',
  'metadata',
]);

export function assertSafeRetrievalUrl(
  value: string | URL,
  options: CodexProviderWebRetrievalSafetyOptions = {},
): URL {
  const url = parseRetrievalUrl(value);
  const allowedProtocols = normalizeAllowedProtocols(options.allowedProtocols);
  if (!allowedProtocols.has(url.protocol)) {
    throw new CodexProviderWebRetrievalError(
      `Blocked retrieval URL with unsupported protocol: ${url.protocol}`,
      'invalid_url',
      null,
      false,
    );
  }
  if (url.username || url.password) {
    throw new CodexProviderWebRetrievalError(
      'Blocked retrieval URL containing credentials.',
      'invalid_url',
      null,
      false,
    );
  }
  if (!options.allowPrivateHosts && isPrivateRetrievalHostname(url.hostname)) {
    throw new CodexProviderWebRetrievalError(
      `Blocked retrieval URL targeting a private or local host: ${url.hostname}`,
      'ssrf_blocked',
      null,
      false,
    );
  }
  return url;
}

export async function assertSafeRetrievalUrlWithDns(
  value: string | URL,
  options: CodexProviderWebRetrievalSafetyOptions = {},
): Promise<URL> {
  const url = assertSafeRetrievalUrl(value, options);
  if (options.allowPrivateHosts) {
    return url;
  }
  const addresses = await resolveHostname(url.hostname, options.resolver);
  for (const address of addresses) {
    if (isPrivateRetrievalHostname(address.address)) {
      throw new CodexProviderWebRetrievalError(
        `Blocked retrieval URL whose hostname resolves to a private or reserved address: ${url.hostname} -> ${address.address}`,
        'ssrf_blocked',
        null,
        false,
      );
    }
  }
  return url;
}

export function isPrivateRetrievalHostname(value: string): boolean {
  const hostname = normalizeHostname(value);
  if (!hostname) {
    return true;
  }
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return true;
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateIpv4(hostname);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(hostname);
  }
  return false;
}

async function resolveHostname(
  hostname: string,
  resolver: CodexProviderNetworkResolver | null | undefined,
): Promise<CodexProviderNetworkAddress[]> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new CodexProviderWebRetrievalError(
      'Blocked retrieval URL with an empty hostname.',
      'invalid_url',
      null,
      false,
    );
  }
  let addresses: CodexProviderNetworkAddress[];
  try {
    addresses = await (resolver ?? DEFAULT_NETWORK_RESOLVER).lookup(normalized);
  } catch (error) {
    throw new CodexProviderWebRetrievalError(
      `Blocked retrieval URL whose hostname could not be resolved: ${hostname}`,
      'ssrf_blocked',
      null,
      error instanceof Error && ['EAI_AGAIN', 'ETIMEOUT'].includes((error as NodeJS.ErrnoException).code ?? '')
        ? true
        : false,
    );
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new CodexProviderWebRetrievalError(
      `Blocked retrieval URL whose hostname did not resolve: ${hostname}`,
      'ssrf_blocked',
      null,
      false,
    );
  }
  return addresses;
}

const DEFAULT_NETWORK_RESOLVER: CodexProviderNetworkResolver = {
  async lookup(hostname: string) {
    const addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
    return addresses
      .filter((entry): entry is { address: string; family: 4 | 6 } => entry.family === 4 || entry.family === 6)
      .map((entry) => ({
        address: entry.address,
        family: entry.family,
      }));
  },
};

export function normalizeRetrievalUrlForCache(value: string | URL): string {
  const url = parseRetrievalUrl(value);
  url.hash = '';
  return url.toString();
}

function parseRetrievalUrl(value: string | URL): URL {
  try {
    return value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  } catch {
    throw new CodexProviderWebRetrievalError(
      `Invalid retrieval URL: ${String(value)}`,
      'invalid_url',
      null,
      false,
    );
  }
}

function normalizeAllowedProtocols(value: string[] | null | undefined): Set<string> {
  const protocols = Array.isArray(value) && value.length > 0 ? value : DEFAULT_ALLOWED_PROTOCOLS;
  return new Set(protocols.map((protocol) => protocol.endsWith(':') ? protocol : `${protocol}:`));
}

function normalizeHostname(value: string): string {
  return value.trim().replace(/^\[/u, '').replace(/\]$/u, '').toLowerCase();
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('100:')
    || normalized.startsWith('2001:db8')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('ff')
  ) {
    return true;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}
