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

function createExtensionFaviconCandidate(extensionId: string, pageUrl: string) {
  return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=16`;
}

function getOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function resolveExtensionId() {
  if (typeof chrome === 'undefined') {
    return null;
  }
  if (typeof chrome.runtime?.id !== 'string') {
    return null;
  }
  const id = chrome.runtime.id.trim();
  return id.length > 0 ? id : null;
}

function hasFaviconPermission() {
  if (typeof chrome === 'undefined') {
    return false;
  }
  const permissions = chrome.runtime?.getManifest?.().permissions;
  if (!Array.isArray(permissions)) {
    return false;
  }
  return permissions.includes('favicon');
}

type BuildFaviconCandidatesOptions = {
  extensionId?: string | null;
  useExtensionFavicon?: boolean;
};

export function buildFaviconCandidates(
  tab: Pick<TabSnapshot, 'favIconUrl' | 'url'>,
  options?: BuildFaviconCandidatesOptions,
) {
  const candidates: string[] = [];
  const pushUnique = (candidate: string | null) => {
    if (!candidate || candidates.includes(candidate)) {
      return;
    }
    candidates.push(candidate);
  };

  const url = normalizeCandidate(tab.url);
  const origin = url ? getOrigin(url) : null;
  const savedFavicon = normalizeCandidate(tab.favIconUrl);
  const useExtensionFavicon = options?.useExtensionFavicon ?? hasFaviconPermission();
  const extensionId = useExtensionFavicon ? (options?.extensionId ?? resolveExtensionId()) : null;

  if (savedFavicon && !isBlockedChromeInternalUrl(savedFavicon)) {
    pushUnique(savedFavicon);
  }

  pushUnique(extensionId && url ? createExtensionFaviconCandidate(extensionId, url) : null);
  pushUnique(extensionId && origin ? createExtensionFaviconCandidate(extensionId, origin) : null);

  return candidates;
}
