import type { HistorySet, TabSnapshot } from '../tab-manager/types';

export type RefreshedTabMetadata = {
  title?: string;
  favIconUrl?: string;
};

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function shouldRefreshTabMetadata(tab: Pick<TabSnapshot, 'title' | 'url' | 'favIconUrl'>) {
  const title = normalizeString(tab.title);
  const url = normalizeString(tab.url);
  const favIconUrl = normalizeString(tab.favIconUrl);

  const needsTitle = !title || (url !== null && title === url);
  const needsFavicon = !favIconUrl;
  return needsTitle || needsFavicon;
}

export function mergeRefreshedTabMetadata(
  set: HistorySet,
  refreshedByUid: Map<string, RefreshedTabMetadata>,
) {
  let updatedCount = 0;
  const nextTabs = set.tabs.map((tab) => {
    const refreshed = refreshedByUid.get(tab.uid);
    if (!refreshed) {
      return tab;
    }

    const nextTitle = normalizeString(refreshed.title);
    const nextFavIconUrl = normalizeString(refreshed.favIconUrl);

    const hasTitleUpdate = nextTitle !== null && nextTitle !== tab.title;
    const hasFaviconUpdate = nextFavIconUrl !== null && nextFavIconUrl !== tab.favIconUrl;
    if (!hasTitleUpdate && !hasFaviconUpdate) {
      return tab;
    }

    updatedCount += 1;
    return {
      ...tab,
      ...(hasTitleUpdate ? { title: nextTitle } : {}),
      ...(hasFaviconUpdate ? { favIconUrl: nextFavIconUrl } : {}),
    };
  });

  if (updatedCount === 0) {
    return { set, updatedCount };
  }
  return {
    set: {
      ...set,
      tabs: nextTabs,
    },
    updatedCount,
  };
}
