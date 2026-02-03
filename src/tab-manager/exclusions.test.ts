import { describe, expect, it } from 'vitest';

import { filterSavableTabs, matchesExclusion, normalizeExclusions } from './exclusions';

describe('normalizeExclusions', () => {
  it('trims, removes empty entries, and deduplicates case-insensitively', () => {
    const result = normalizeExclusions([
      ' chrome:// ',
      '',
      'example.com',
      'EXAMPLE.com',
      'chrome://',
    ]);

    expect(result).toEqual(['chrome://', 'example.com']);
  });
});

describe('matchesExclusion', () => {
  it('matches by prefix when scheme-like entries are provided', () => {
    const exclusions = normalizeExclusions(['chrome://', 'chrome-extension://']);

    expect(matchesExclusion('chrome://settings', exclusions)).toBe(true);
    expect(matchesExclusion('chrome-extension://abc/manager.html', exclusions)).toBe(true);
  });

  it('matches by domain for host entries', () => {
    const exclusions = normalizeExclusions(['example.com']);

    expect(matchesExclusion('https://example.com', exclusions)).toBe(true);
    expect(matchesExclusion('https://sub.example.com/path', exclusions)).toBe(true);
    expect(matchesExclusion('https://example.org', exclusions)).toBe(false);
  });

  it('is case-insensitive', () => {
    const exclusions = normalizeExclusions(['Example.com']);

    expect(matchesExclusion('HTTPS://EXAMPLE.COM/page', exclusions)).toBe(true);
  });
});

describe('filterSavableTabs', () => {
  it('excludes pinned and excluded URLs', () => {
    const exclusions = normalizeExclusions(['chrome://', 'example.com']);
    const tabs = [
      { id: 1, url: 'https://example.com', pinned: false },
      { id: 2, url: 'https://ok.com', pinned: true },
      { id: 3, url: 'https://ok.com', pinned: false },
      { id: 4, url: 'chrome://settings', pinned: false },
      { id: 5, pendingUrl: 'https://ok.com', pinned: false },
      { id: 6, url: '', pinned: false },
    ];

    expect(filterSavableTabs(tabs, exclusions)).toEqual([
      { id: 3, url: 'https://ok.com', pinned: false },
      { id: 5, pendingUrl: 'https://ok.com', pinned: false },
    ]);
  });
});
