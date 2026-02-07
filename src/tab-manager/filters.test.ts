import { describe, expect, it } from 'vitest';

import {
  buildSetFilterOptions,
  buildGroupFilterOptions,
  filterHistorySets,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
  SET_FILTER_ALL,
} from './filters';
import type { HistorySet } from './types';
import { buildLayoutFromData } from './layout';

const historySets: HistorySet[] = [
  {
    id: 'set-1',
    name: 'window-1',
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [
      { uid: 'g-1', id: 1, title: 'Work', color: 'blue', index: 0, locked: false },
      { uid: 'g-2', id: 2, title: 'Read', color: 'red', index: 1, locked: false },
      { uid: 'g-9', id: 9, title: 'Empty', color: 'grey', index: 2, locked: false },
    ],
    tabs: [
      {
        uid: 't-1',
        title: 'Docs',
        url: 'https://docs.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-2',
        title: 'Mail',
        url: 'https://mail.example.com',
        index: 1,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-3',
        title: 'News',
        url: 'https://news.example.com',
        index: 2,
        groupId: null,
        locked: false,
      },
    ],
    layout: [],
  },
  {
    id: 'set-2',
    name: 'window-2',
    createdAt: 2,
    windowId: 2,
    locked: false,
    managerBinding: null,
    groups: [{ uid: 'g-3', id: 3, title: 'Read', color: 'green', index: 0, locked: false }],
    tabs: [
      {
        uid: 't-4',
        title: 'Blog',
        url: 'https://blog.example.com',
        index: 0,
        groupId: 3,
        locked: false,
      },
      {
        uid: 't-5',
        title: 'Docs',
        url: 'https://docs.other.com',
        index: 1,
        groupId: null,
        locked: false,
      },
    ],
    layout: [],
  },
];
for (const set of historySets) {
  set.layout = buildLayoutFromData(set.groups, set.tabs);
}

describe('filterHistorySets', () => {
  it('タイトルとURLの両方でクエリを絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: 'docs',
      setFilter: SET_FILTER_ALL,
      groupFilter: GROUP_FILTER_ALL,
    });

    expect(result).toHaveLength(2);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['Docs']);
    expect(result[1].tabs.map((tab) => tab.title)).toEqual(['Docs']);
  });

  it('グループ名で絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      setFilter: SET_FILTER_ALL,
      groupFilter: 'Work',
    });

    expect(result).toHaveLength(1);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['Docs', 'Mail']);
  });

  it('未グループのタブで絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      setFilter: SET_FILTER_ALL,
      groupFilter: GROUP_FILTER_UNGROUPED,
    });

    expect(result).toHaveLength(2);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['News']);
    expect(result[1].tabs.map((tab) => tab.title)).toEqual(['Docs']);
  });
  it('セットIDで絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      setFilter: 'set-2',
      groupFilter: GROUP_FILTER_ALL,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('set-2');
  });

  it('セット内の未グループで絞り込む', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      setFilter: 'set-1',
      groupFilter: GROUP_FILTER_UNGROUPED,
    });

    expect(result).toHaveLength(1);
    expect(result[0].tabs.map((tab) => tab.title)).toEqual(['News']);
  });

  it('存在しないセットIDでは結果が空になる', () => {
    const result = filterHistorySets(historySets, {
      query: '',
      setFilter: 'missing-set',
      groupFilter: GROUP_FILTER_ALL,
    });

    expect(result).toEqual([]);
  });
});

describe('buildSetFilterOptions', () => {
  it('全ウィンドウと名前+件数の候補を返す', () => {
    const options = buildSetFilterOptions(historySets);

    expect(options).toEqual([
      { value: SET_FILTER_ALL, label: 'すべてのウィンドウ' },
      { value: 'set-1', label: 'window-1 (3)' },
      { value: 'set-2', label: 'window-2 (2)' },
    ]);
  });
});

describe('buildGroupFilterOptions', () => {
  it('デフォルトのオプションを含む並び替え済みのグループ名を返す', () => {
    const options = buildGroupFilterOptions(historySets, SET_FILTER_ALL);

    expect(options).toEqual([GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED, 'Read', 'Work']);
  });

  it('セットを選択した場合はそのセット内のグループ候補だけ返す', () => {
    const options = buildGroupFilterOptions(historySets, 'set-2');

    expect(options).toEqual([GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED, 'Read']);
  });

  it('存在しないセットを選択した場合はデフォルト候補のみ返す', () => {
    const options = buildGroupFilterOptions(historySets, 'missing-set');

    expect(options).toEqual([GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED]);
  });
});
