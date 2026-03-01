import type { TabSnapshot } from '../tab-manager/types';

function normalizeCandidate(candidate: unknown) {
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isBlockedChromeInternalUrl(candidate: string) {
  return candidate.startsWith('chrome://');
}

export function buildFaviconCandidates(tab: Pick<TabSnapshot, 'favIconUrl'>) {
  const savedFavicon = normalizeCandidate(tab.favIconUrl);
  if (savedFavicon && !isBlockedChromeInternalUrl(savedFavicon)) {
    return [savedFavicon];
  }
  return [];
}
