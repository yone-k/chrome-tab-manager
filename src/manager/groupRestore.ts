const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isGroupApplied(
  group: chrome.tabGroups.TabGroup,
  expectedTitle: string,
  expectedColor: chrome.tabGroups.ColorEnum,
) {
  return group.title === expectedTitle && group.color === expectedColor;
}

async function groupTabs(windowId: number, tabIds: number[]) {
  return new Promise<number>((resolve, reject) => {
    chrome.tabs.group({ createProperties: { windowId }, tabIds }, (groupId: number) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(groupId);
    });
  });
}

async function updateTabGroup(groupId: number, title: string, color: chrome.tabGroups.ColorEnum) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabGroups.update(groupId, { title, color }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function getTabGroup(groupId: number) {
  return new Promise<chrome.tabGroups.TabGroup>((resolve, reject) => {
    chrome.tabGroups.get(groupId, (group) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(group);
    });
  });
}

async function moveTabGroup(groupId: number, index: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabGroups.move(groupId, { index }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export async function restoreGroupWithRetry(
  windowId: number,
  tabIds: number[],
  title: string,
  color: chrome.tabGroups.ColorEnum,
  index: number,
) {
  let groupId: number;
  try {
    groupId = await groupTabs(windowId, tabIds);
  } catch (err) {
    console.error('Failed to create tab group', err);
    return null;
  }

  let applied = false;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await updateTabGroup(groupId, title, color);
      const updatedGroup = await getTabGroup(groupId);
      if (isGroupApplied(updatedGroup, title, color)) {
        applied = true;
        break;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.warn('Failed to update tab group after retries', err);
        break;
      }
    }

    if (attempt < MAX_RETRIES) {
      await delay(RETRY_DELAY_MS);
      continue;
    }

    console.warn('Tab group restore verification did not match expected state', {
      groupId,
      expectedTitle: title,
      expectedColor: color,
    });
  }

  if (!applied) {
    console.warn('Continuing after tab group restore retries were exhausted', {
      groupId,
      title,
      color,
    });
  }

  try {
    await moveTabGroup(groupId, index);
  } catch (err) {
    console.warn('Failed to move tab group', err);
  }

  return groupId;
}
