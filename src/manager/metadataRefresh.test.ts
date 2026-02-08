import { describe, expect, it } from 'vitest';

import type { HistorySet } from '../tab-manager/types';
import { mergeRefreshedTabMetadata, shouldRefreshTabMetadata } from './metadataRefresh';

function createSet(): HistorySet {
  return {
    id: 'set-1',
    name: 'window',
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [],
    tabs: [
      {
        uid: 't-1',
        title: 'https://example.com',
        url: 'https://example.com',
        index: 0,
        groupId: null,
        locked: false,
      },
      {
        uid: 't-2',
        title: 'GitHub',
        url: 'https://github.com',
        favIconUrl: 'https://github.com/favicon.ico',
        index: 1,
        groupId: null,
        locked: false,
      },
    ],
    layout: [
      { type: 'tab', uid: 't-1' },
      { type: 'tab', uid: 't-2' },
    ],
  };
}

describe('shouldRefreshTabMetadata', () => {
  it('title が URL と同じ、または favicon が空なら再取得対象', () => {
    expect(
      shouldRefreshTabMetadata({
        title: 'https://example.com',
        url: 'https://example.com',
      }),
    ).toBe(true);

    expect(
      shouldRefreshTabMetadata({
        title: 'GitHub',
        url: 'https://github.com',
        favIconUrl: ' ',
      }),
    ).toBe(true);
  });

  it('title と favicon が十分なら再取得対象外', () => {
    expect(
      shouldRefreshTabMetadata({
        title: 'GitHub',
        url: 'https://github.com',
        favIconUrl: 'https://github.com/favicon.ico',
      }),
    ).toBe(false);
  });
});

describe('mergeRefreshedTabMetadata', () => {
  it('title/favIconUrl のみ更新し、URLは変更しない', () => {
    const set = createSet();
    const refreshedByUid = new Map([
      [
        't-1',
        {
          title: 'Example Domain',
          favIconUrl: 'https://example.com/favicon.ico',
        },
      ],
    ]);

    const { set: merged, updatedCount } = mergeRefreshedTabMetadata(set, refreshedByUid);

    expect(updatedCount).toBe(1);
    expect(merged.tabs[0]).toMatchObject({
      title: 'Example Domain',
      favIconUrl: 'https://example.com/favicon.ico',
      url: 'https://example.com',
    });
  });

  it('空の取得結果は既存値を維持し、部分成功のみ反映する', () => {
    const set = createSet();
    const refreshedByUid = new Map([
      ['t-1', { title: '   ', favIconUrl: '   ' }],
      ['t-2', { favIconUrl: 'https://github.com/new-favicon.ico' }],
    ]);

    const { set: merged, updatedCount } = mergeRefreshedTabMetadata(set, refreshedByUid);

    expect(updatedCount).toBe(1);
    expect(merged.tabs[0]).toEqual(set.tabs[0]);
    expect(merged.tabs[1]?.title).toBe('GitHub');
    expect(merged.tabs[1]?.favIconUrl).toBe('https://github.com/new-favicon.ico');
  });
});
