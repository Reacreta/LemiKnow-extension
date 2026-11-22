/**
 * Removes query strings (?token=123), hash fragments (#section), and credentials
 * so sensitive user parameters never leave the browser (FR-02 & Section 3.3).
 */
export function sanitizeUrl(rawUrl: string): {
  normalizedUrl: string;
  domain: string;
} | null {
  try {
    const parsed = new URL(rawUrl);

    // Skip internal Chrome URLs like chrome://extensions
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';

    return {
      normalizedUrl: `${parsed.origin}${parsed.pathname}`,
      domain: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Checks whether a requested domain belongs to an external third party (FR-04).
 */
export function isExternalDomain(targetHost: string, requestHost: string): boolean {
  const getRootDomain = (host: string) => host.split('.').slice(-2).join('.');
  return getRootDomain(targetHost) !== getRootDomain(requestHost);
}