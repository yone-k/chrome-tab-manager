function normalizePathname(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function normalizeFallbackUrl(raw: string) {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  const hashIndex = trimmed.indexOf('#');
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  return withoutHash.replace(/\/+$/, '');
}

export function normalizeComparableUrl(raw: string) {
  try {
    const url = new URL(raw);
    const normalizedPath = normalizePathname(url.pathname);
    return `${url.protocol}//${url.host}${normalizedPath}${url.search}`;
  } catch {
    return normalizeFallbackUrl(raw);
  }
}

export function matchesExpectedUrl(
  expectedUrl: string,
  tab: chrome.tabs.Tab,
  changeInfo?: chrome.tabs.TabChangeInfo,
) {
  const expected = normalizeComparableUrl(expectedUrl);
  const candidates = [changeInfo?.url, tab.url].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return candidates.some((value) => normalizeComparableUrl(value) === expected);
}
