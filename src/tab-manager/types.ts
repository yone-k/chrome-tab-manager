export type GroupSnapshot = {
  uid: string;
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  index: number;
  locked: boolean;
};

export type LayoutItem = { type: 'group'; uid: string } | { type: 'tab'; uid: string };

export type TabSnapshot = {
  uid: string;
  title: string;
  url: string;
  favIconUrl?: string;
  index: number;
  groupId: number | null;
  locked: boolean;
};

export type ManagerBinding = {
  managerTabId: number;
  managerWindowId: number;
};

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export type HistorySet = {
  id: string;
  name: string;
  createdAt: number;
  windowId: number;
  locked: boolean;
  managerBinding: ManagerBinding | null;
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
  themeMode: ThemeMode;
  cardHeight: number | null;
};
