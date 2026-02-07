import type { ResolvedTheme, ThemeMode } from '../tab-manager/types';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ThemeChangeEvent = { matches: boolean };

export type MediaQueryListLike = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: ThemeChangeEvent) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: ThemeChangeEvent) => void) => void;
  addListener?: (listener: (event: ThemeChangeEvent) => void) => void;
  removeListener?: (listener: (event: ThemeChangeEvent) => void) => void;
};

export type MatchMediaLike = (query: string) => MediaQueryListLike;

function getDefaultMatchMedia(): MatchMediaLike {
  return (query) => window.matchMedia(query);
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'light') {
    return 'light';
  }
  if (mode === 'dark') {
    return 'dark';
  }
  return prefersDark ? 'dark' : 'light';
}

export function getSystemPrefersDark(matchMedia: MatchMediaLike = getDefaultMatchMedia()) {
  return matchMedia(DARK_MEDIA_QUERY).matches;
}

export function applyThemeToDocument(theme: ResolvedTheme, doc: Document = document) {
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.style.colorScheme = theme;
}

export function subscribeSystemThemeChange(
  onChange: (prefersDark: boolean) => void,
  matchMedia: MatchMediaLike = getDefaultMatchMedia(),
) {
  const mediaQueryList = matchMedia(DARK_MEDIA_QUERY);
  const listener = (event: ThemeChangeEvent) => {
    onChange(event.matches);
  };

  if (mediaQueryList.addEventListener) {
    mediaQueryList.addEventListener('change', listener);
    return () => {
      mediaQueryList.removeEventListener?.('change', listener);
    };
  }

  mediaQueryList.addListener?.(listener);
  return () => {
    mediaQueryList.removeListener?.(listener);
  };
}
