import { describe, expect, it } from 'vitest';

import {
  buildGroupFilterOptions,
  filterHistorySets,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from './filters';
import type { HistorySet } from './types';

const historySets: HistorySet[] = [
  {
    id: 'set-1',
    createdAt: 1,
    windowId: 1,
    groups: [
      { id: 1, title: 'Work', color: 'blue', index: 0 },
      { id: 2, title: 'Read', color: 'red', index: 1 },
    ],
    tabs: [
      { title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
      { title: 'Mail', url: 'https://mail.example.com', index: 1, groupId: 1 },
      { title: 'News', url: 'https://news.example.com', index: 2, groupId: null },
    ],
  },
  {
    id: 'set-2',
    createdAt: 2,
    windowId: 2,
    groups: [{ id: 3, title: 'Read', color: 'green', index: 0 }],
    tabs: [
      { title: 'Blog', url: 'https://blog.example.com', index: 0, groupId: 3 },
      { title: 'Docs', url: 'https://docs.other.com', index: 1, groupId: null },
    ],
  },
];

describe('filterHistorySets', () => {
  it('タイトルとURLの両方でクエリを絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: 'docs',
      groupFilter: GROUP_FILTER_ALL,
    });

    expect(result).toHaveLength(2);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['Docs']);
    expect(result[1].tabs.map((tab) => tab.title)).toEqual(['Docs']);
  });

  it('グループ名で絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      groupFilter: 'Work',
    });

    expect(result).toHaveLength(1);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['Docs', 'Mail']);
  });

  it('未グループのタブで絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      groupFilter: GROUP_FILTER_UNGROUPED,
    });

    expect(result).toHaveLength(2);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['News']);
    expect(result[1].tabs.map((tab) => tab.title)).toEqual(['Docs']);
  });
});

describe('buildGroupFilterOptions', () => {
  it('デフォルトのオプションを含む並び替え済みのグループ名を返す', () => {
    const options = buildGroupFilterOptions(historySets);

    expect(options).toEqual([GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED, 'Read', 'Work']);
  });
});
