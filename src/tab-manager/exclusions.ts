export type TabLike = {
  url?: string;
  pendingUrl?: string;
  pinned?: boolean;
};

export const DEFAULT_EXCLUSIONS = ['chrome://', 'chrome-extension://'];

export function normalizeExclusions(entries: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const lowered = trimmed.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    normalized.push(lowered);
  }

  return normalized;
}

export function matchesExclusion(url: string, exclusions: string[]) {
  if (!url) {
    return false;
  }

  const loweredUrl = url.toLowerCase();

  for (const pattern of exclusions) {
    if (pattern.includes('://')) {
      if (loweredUrl.startsWith(pattern)) {
        return true;
      }
      continue;
    }

    try {
      const hostname = new URL(loweredUrl).hostname.toLowerCase();
      if (hostname === pattern || hostname.endsWith(`.${pattern}`)) {
        return true;
      }
    } catch {
      // Ignore non-URL strings for host matching.
    }
  }

  return false;
}

export function getTabUrl(tab: TabLike) {
  return tab.url ?? tab.pendingUrl ?? '';
}

export function filterSavableTabs<T extends TabLike>(tabs: T[], exclusions: string[]) {
  return tabs.filter((tab) => {
    if (tab.pinned) {
      return false;
    }
    const url = getTabUrl(tab);
    if (!url) {
      return false;
    }
    return !matchesExclusion(url, exclusions);
  });
}
