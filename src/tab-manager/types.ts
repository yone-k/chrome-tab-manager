export type GroupSnapshot = {
  uid: string;
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  index: number;
};

export type LayoutItem = { type: 'group'; uid: string } | { type: 'tab'; uid: string };

export type TabSnapshot = {
  uid: string;
  title: string;
  url: string;
  index: number;
  groupId: number | null;
};

export type HistorySet = {
  id: string;
  name: string;
  createdAt: number;
  windowId: number;
  tabs: TabSnapshot[];
  groups: GroupSnapshot[];
  layout: LayoutItem[];
};

export type TabManagerState = {
  version: 1;
  historySets: HistorySet[];
  exclusions: string[];
  restoreLoadingSuppressionEnabled: boolean;
  removeRestoredTabsEnabled: boolean;
};
