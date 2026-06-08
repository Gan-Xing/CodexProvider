export function canonicalSearchResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    const entries = [...url.searchParams.entries()]
      .filter(([key]) => !isTrackingQueryParam(key))
      .sort(([left], [right]) => left.localeCompare(right));
    url.search = '';
    for (const [key, entryValue] of entries) {
      url.searchParams.append(key, entryValue);
    }
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '');
    return `${url.protocol}//${url.host}${pathname}${url.search}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export function hostnameFromSearchUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function domainMatchesSearchFilter(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function searchUrlMatchesDomainFilters(
  value: string,
  allowedDomains: string[],
  blockedDomains: string[],
): boolean {
  const hostname = hostnameFromSearchUrl(value);
  if (!hostname) {
    return false;
  }
  if (allowedDomains.length > 0 && !allowedDomains.some((domain) => domainMatchesSearchFilter(hostname, domain))) {
    return false;
  }
  return !blockedDomains.some((domain) => domainMatchesSearchFilter(hostname, domain));
}

function isTrackingQueryParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === 'fbclid'
    || normalized === 'gclid'
    || normalized === 'mc_cid'
    || normalized === 'mc_eid'
    || normalized.startsWith('utm_');
}
