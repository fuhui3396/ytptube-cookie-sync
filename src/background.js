if (typeof importScripts === 'function') {
    importScripts('i18n.js');
    importScripts('auth.js');
    importScripts('api.js');
    importScripts('cookies.js');
}

const str_keys = ["instance_url", "preset"]
const bool_keys = ["showContextMenu"]

if (typeof chrome === 'undefined') {
    let chrome = browser
}

const notify = message => chrome.notifications.create({
    "type": "basic",
    "iconUrl": chrome.runtime.getURL("icons/icon-128.png"),
    "title": t('extension_name'),
    "message": message,
});

const onMenuCreated = () => {
    if (chrome.runtime.lastError) {
        console.log(`error creating menu item. ${chrome.runtime.lastError}`);
    }
    syncContextMenu().then(_ => '').catch(console.error);
}

const shouldShowContextMenu = async () => {
    let item = await chrome.storage.sync.get("showContextMenu");
    return 'showContextMenu' in item ? item.showContextMenu : true;
};

const syncContextMenu = async () => {
    if (!chrome.contextMenus) {
        return;
    }

    let showContextMenu = await shouldShowContextMenu();
    const preset = (await getOption("preset")) || 'default';
    chrome.contextMenus.update("send-to-ytptube", {
        visible: showContextMenu,
        title: t('context_menu_preset', [preset])
    });
}

if (chrome.contextMenus) {
    chrome.contextMenus.create({
        id: "send-to-ytptube",
        title: t('context_menu_title'),
        contexts: ["link"]
    }, onMenuCreated);

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && (changes.showContextMenu || changes.preset)) {
            syncContextMenu().catch(console.error);
        }
    });
}

const getCurrentUrl = async () => (await chrome.tabs.query({ currentWindow: true, active: true }))[0].url

const getOption = async key => {
    let item = await chrome.storage.sync.get(key);
    if (str_keys.includes(key)) {
        return item[key] ?? '';
    }
    if (bool_keys.includes(key)) {
        return item[key] ?? false;
    }
}

const sendRequest = async (path, data) => {
    const method = Object.keys(data).length > 0 ? 'POST' : 'GET';
    console.debug(`Sending ${method} ${path} to YTPTube.`);
    const result = await YTPApi.request(path, {
        method,
        body: method === 'POST' ? data : undefined,
        timeout: 30000,
    });
    return { status: result.status, statusText: result.statusText, data: result.response };
};

const sendUrl = async (user_url, preset = null) => {
    try {
        const requestData = { url: user_url };
        if (preset) {
            requestData.preset = preset;
        }

        console.debug('Sending request data:', requestData);

        const data = await sendRequest('/api/history', requestData);
        if ([200, 201, 202].includes(data.status)) {
            notify(t('request_success'));
            return { success: true, message: t('request_success') };
        }
        const errorMessage = t('request_failed_status', [data.status, data.statusText]);
        notify(errorMessage);
        return { success: false, message: errorMessage };
    } catch (e) {
        console.error(e);
        const errorMessage = t('request_failed_error', [e.message]);
        notify(errorMessage);
        return { success: false, message: errorMessage };
    }
};

if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info, _) => {
        if (info.menuItemId !== "send-to-ytptube") {
            return;
        }
        if (!info.linkUrl) {
            notify(t('no_link_url'));
            return;
        }

        // Reuse the popup selection; fall back to YTPTube's built-in default.
        const selectedPreset = (await getOption("preset")) || 'default';
        await sendUrl(info.linkUrl, selectedPreset);
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "send-to-ytptube") {
        (async () => {
            try {
                let url = message.url || await getCurrentUrl();

                if (!url) {
                    await notify(t('no_url'));
                    sendResponse({ success: false, message: t('no_url') });
                    return;
                }

                const result = await sendUrl(url, message.preset);
                sendResponse(result);
            } catch (error) {
                console.error('Error in message handler:', error);
                sendResponse({ success: false, message: error.message });
            }
        })();
        return true;
    }

    if (message.command === "sync-cookies-to-preset") {
        (async () => {
            try {
                const result = await syncCookiesToPreset(message.url, message.presetName);
                sendResponse(result);
            } catch (error) {
                console.error('Error syncing cookies:', error);
                sendResponse({ success: false, message: error.message });
            }
        })();
        return true;
    }

    if (message.command === "get-cookies-for-url") {
        (async () => {
            try {
                const result = await YTPCookies.getFormattedCookies(message.url);
                sendResponse({ success: true, data: result });
            } catch (error) {
                console.error('Error getting cookies:', error);
                sendResponse({ success: false, message: error.message });
            }
        })();
        return true;
    }
});

/**
 * Sync browser cookies for a URL to a YTPTube preset.
 *
 * Flow:
 *   1. Extract domain from the URL
 *   2. Read all cookies for that domain via chrome.cookies API
 *   3. Convert to Netscape HTTP Cookie File format
 *   4. Find the preset by name via GET /api/presets/
 *   5. PATCH the preset with the new cookies content
 *
 * @param {string} url - The URL to extract cookies for
 * @param {string} presetName - The preset name to update (e.g., "youtube")
 * @returns {Promise<{success: boolean, message: string, cookies?: string}>}
 */
const syncCookiesToPreset = async (url, presetName, quiet = false) => {
    if (!url) {
        return { success: false, message: t('no_url') };
    }

    const domain = YTPCookies.extractDomain(url);
    if (!domain) {
        return { success: false, message: t('cookie_invalid_url') };
    }

    // 1. Read cookies from browser
    const cookies = await YTPCookies.getCookiesForUrl(url);
    if (cookies.length === 0) {
        return { success: false, message: t('cookie_no_cookies', [domain]) };
    }

    // 2. Convert to Netscape format
    const netscape = YTPCookies.toNetscapeFormat(cookies);
    console.debug(`Syncing ${cookies.length} cookies for domain '${domain}' to preset '${presetName}'`);

    // 3. Find the preset by name
    const list = await YTPApi.request('/api/presets/?per_page=100', {
        headers: { 'Accept': 'application/json' },
        timeout: 20000,
    });

    if (list.status !== 200) {
        return { success: false, message: t('cookie_fetch_presets_failed', [list.status]) };
    }

    const items = Array.isArray(list.data?.items) ? list.data.items : (list.data || []);
    const preset = items.find(p => p && p.name === presetName);

    if (!preset) {
        return { success: false, message: t('cookie_preset_not_found', [presetName]) };
    }

    if (preset.default) {
        return { success: false, message: t('cookie_preset_is_default', [presetName]) };
    }

    // 4. PATCH the preset with the new cookies
    const patch = await YTPApi.request(`/api/presets/${preset.id}`, {
        method: 'PATCH',
        body: { cookies: netscape },
        timeout: 20000,
    });

    if (patch.status === 200) {
        const msg = t('cookie_sync_success', [domain, cookies.length, presetName]);
        if (!quiet) notify(msg);
        return { success: true, message: msg, cookies: netscape };
    }

    const errorMsg = patch.data?.error || patch.data?.message || patch.statusText;
    return { success: false, message: t('cookie_sync_failed', [errorMsg]) };
};

// ============ 后台实时状态轮询与通知 ============
const STATUS_ALARM = 'ytp_status_poll';
const AUTO_SYNC_ALARM = 'ytp_cookie_sync';
const STATUS_STATE_KEY = 'ytpPrevStatuses';
// 状态键格式变化时递增版本号，使旧状态被静默重新播种，避免误报历史记录。
const STATUS_STATE_VERSION_KEY = 'ytpPrevStatusesVersion';
const STATUS_STATE_VERSION = 2;

// 用户手动重试后，短时间内不再对这些 URL 发送通知（避免重试后再次失败刷屏）。
const SUPPRESS_KEY = 'ytpSuppressedUrls';
const SUPPRESS_MS = 10 * 60 * 1000;

// alarms 无法低于 0.5 分钟（Chrome 最小值），后台仅做兜底通知；
// 弹窗打开时由 popup.js 自行刷新（WebSocket 或轮询）。
const AUTO_SYNC_DEFAULT_INTERVAL = 360;
const AUTO_SYNC_MIN_INTERVAL = 5;

const ensureStatusAlarm = () => {
  if (!chrome.alarms) return;
  chrome.alarms.create(STATUS_ALARM, { periodInMinutes: 0.5 });
};

const ensureAutoSyncAlarm = async () => {
  if (!chrome.alarms) return;
  const { autoSyncInterval } = await chrome.storage.sync.get('autoSyncInterval');
  const minutes = Math.max(AUTO_SYNC_MIN_INTERVAL, Number(autoSyncInterval) || AUTO_SYNC_DEFAULT_INTERVAL);
  chrome.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes: minutes });
};

ensureStatusAlarm();
ensureAutoSyncAlarm();
chrome.runtime.onInstalled.addListener(() => {
  ensureStatusAlarm();
  ensureAutoSyncAlarm();
});

// 间隔或开关变化时重建 alarm
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && (changes.autoSyncInterval || changes.autoSyncEnabled)) {
    ensureAutoSyncAlarm();
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === STATUS_ALARM) {
    pollStatusAndNotify();
  } else if (alarm.name === AUTO_SYNC_ALARM) {
    runAutoCookieSync();
  }
});

// 记录上一次状态，避免重复通知
const STATUS_MAX_ENTRIES = 1000;
const prevStatuses = {};
let statusStateReady = false;
let seedSilently = false;

const loadStatusState = async () => {
  if (statusStateReady) return;
  statusStateReady = true;
  try {
    const stored = await chrome.storage.local.get([STATUS_STATE_KEY, STATUS_STATE_VERSION_KEY]);
    if (stored && stored[STATUS_STATE_KEY] && stored[STATUS_STATE_VERSION_KEY] === STATUS_STATE_VERSION) {
      Object.assign(prevStatuses, stored[STATUS_STATE_KEY]);
    } else {
      // 首次运行或状态格式已变化：只记录当前状态，不对历史记录发送通知
      seedSilently = true;
    }
  } catch (e) {
    console.error('Failed to load status state', e);
  }
};

const saveStatusState = () => {
  const keys = Object.keys(prevStatuses);
  if (keys.length > STATUS_MAX_ENTRIES) {
    for (const key of keys.slice(0, keys.length - STATUS_MAX_ENTRIES)) {
      delete prevStatuses[key];
    }
  }
  chrome.storage.local.set({
    [STATUS_STATE_KEY]: prevStatuses,
    [STATUS_STATE_VERSION_KEY]: STATUS_STATE_VERSION,
  }).catch(() => {});
};

// 被手动重试的 URL，在 SUPPRESS_MS 内不再发送通知
const suppressedUrls = {};
let suppressedReady = false;

const loadSuppressedUrls = async () => {
  if (suppressedReady) return;
  suppressedReady = true;
  try {
    const stored = await chrome.storage.local.get(SUPPRESS_KEY);
    const now = Date.now();
    const raw = (stored && stored[SUPPRESS_KEY]) || {};
    for (const [url, expiry] of Object.entries(raw)) {
      if (expiry > now) suppressedUrls[url] = expiry;
    }
  } catch (e) {
    console.error('Failed to load suppressed URLs', e);
  }
};

const suppressUrls = async (urls) => {
  await loadSuppressedUrls();
  const expiry = Date.now() + SUPPRESS_MS;
  let changed = false;
  for (const url of urls || []) {
    if (url && suppressedUrls[url] !== expiry) {
      suppressedUrls[url] = expiry;
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ [SUPPRESS_KEY]: suppressedUrls });
  }
};

const isSuppressed = url => !!url && (suppressedUrls[url] || 0) > Date.now();

// 通知点击跳转与重试按钮所需的映射
const NOTIFY_MAP_KEY = 'ytpNotifyMap';
const notifyMap = {};
let notifyMapReady = false;

const loadNotifyMap = async () => {
  if (notifyMapReady) return;
  notifyMapReady = true;
  try {
    const stored = await chrome.storage.local.get(NOTIFY_MAP_KEY);
    Object.assign(notifyMap, stored[NOTIFY_MAP_KEY] || {});
  } catch (e) {
    console.error('Failed to load notification map', e);
  }
};

const rememberNotify = async (id, info) => {
  await loadNotifyMap();
  // 仅保留最近 50 条，避免无限增长
  const keys = Object.keys(notifyMap);
  if (keys.length > 50) {
    for (const key of keys.slice(0, keys.length - 50)) delete notifyMap[key];
  }
  notifyMap[id] = info;
  chrome.storage.local.set({ [NOTIFY_MAP_KEY]: notifyMap }).catch(() => {});
};

const openBackend = async () => {
  const url = await YTPApi.getInstanceUrl();
  if (url) chrome.tabs.create({ url }).catch(console.error);
};

const getNotifySettings = async () => {
  const stored = await chrome.storage.sync.get(['notifyEnabled', 'notifyFinished', 'notifyFailed']);
  return {
    enabled: stored.notifyEnabled ?? true,
    finished: stored.notifyFinished ?? true,
    failed: stored.notifyFailed ?? true,
  };
};

const sendNotify = async (title, message, url, options = {}) => {
  if (isSuppressed(url)) return;
  const settings = await getNotifySettings();
  if (!settings.enabled) return;
  if (options.kind === 'finished' && !settings.finished) return;
  if (options.kind === 'failed' && !settings.failed) return;

  const buttons = options.retryIds?.length ? [{ title: t('retry') }] : undefined;
  const id = await chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
    buttons,
  });
  await rememberNotify(id, { url, ids: options.retryIds || [] });
};

chrome.notifications.onClicked.addListener(async id => {
  await loadNotifyMap();
  const info = notifyMap[id];
  chrome.notifications.clear(id);
  if (info?.url) {
    chrome.tabs.create({ url: info.url }).catch(console.error);
  } else {
    openBackend();
  }
});

chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
  await loadNotifyMap();
  const info = notifyMap[id];
  chrome.notifications.clear(id);
  if (buttonIndex === 0 && info?.ids?.length) {
    try {
      await YTPApi.request('/api/history/retry', { method: 'POST', body: { ids: info.ids }, timeout: 20000 });
    } catch (error) {
      console.error('Notification retry failed:', error);
    }
  } else if (info?.url) {
    chrome.tabs.create({ url: info.url }).catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.command !== 'suppress-notifications') return;
  (async () => {
    try {
      await suppressUrls(message.urls);
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error suppressing notifications:', error);
      sendResponse({ success: false, message: error.message });
    }
  })();
  return true;
});

const updateBadge = count => {
  if (!chrome.action?.setBadgeText) return;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (count > 0 && chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: '#5965d8' });
  }
};

const pollStatusAndNotify = async () => {
  const instanceUrl = await getOption('instance_url');
  if (!instanceUrl) {
    updateBadge(0);
    return;
  }

  await loadStatusState();
  await loadSuppressedUrls();

  const wasSeeding = seedSilently;
  let received = false;
  let dirty = false;

  // History items expose both a video `id` and a unique `_id`; use `_id` as
  // the stable key so status tracking and retries target the same item.
  const itemKey = item => item._id || item.id;

  // 实时队列
  try {
    const live = await YTPApi.request('/api/history/live', { timeout: 20000 });
    if (live.ok && live.data) {
      received = true;
      const queue = Object.values(live.data.queue || {});
      updateBadge(queue.length);
      queue.forEach(item => {
        const key = itemKey(item);
        const prev = prevStatuses[key];
        if (!seedSilently && prev !== undefined && prev !== item.status) {
          if (item.status === 'finished') {
            sendNotify(t('download_finished'), item.title || item.url, item.url, { kind: 'finished' });
          } else if (item.status === 'error') {
            sendNotify(t('download_failed'), item.title || item.url, item.url, { kind: 'failed', retryIds: [key] });
          }
        }
        if (prev !== item.status) {
          prevStatuses[key] = item.status;
          dirty = true;
        }
      });
    }
  } catch (e) {
    console.error('Polling live queue error', e);
  }

  // 最近失败列表（仅首次出现时提醒）
  try {
    const failed = await YTPApi.request('/api/history?type=done&status=!finished&per_page=20&order=DESC', { timeout: 20000 });
    if (failed.ok && failed.data) {
      received = true;
      const items = failed.data.items || [];
      items.forEach(item => {
        const key = itemKey(item);
        if (prevStatuses[key] === undefined) {
          if (!seedSilently) {
            sendNotify(t('download_failed'), item.title || item.url, item.url, { kind: 'failed', retryIds: [key] });
          }
          prevStatuses[key] = item.status;
          dirty = true;
        }
      });
    }
  } catch (e) {
    console.error('Polling failed list error', e);
  }

  if (received) {
    if (dirty || wasSeeding) saveStatusState();
    seedSilently = false;
  }
};

// ============ 定时 Cookie 自动同步 ============
const AUTO_SYNC_LAST_KEY = 'autoSyncLast';

const runAutoCookieSync = async () => {
  const { autoSyncEnabled } = await chrome.storage.sync.get('autoSyncEnabled');
  if (!autoSyncEnabled) return;

  const { autoSyncTargets = [] } = await chrome.storage.sync.get('autoSyncTargets');
  const results = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const target of autoSyncTargets) {
    if (!target?.preset || !target?.url) continue;
    try {
      const origin = `${new URL(target.url).origin}/*`;
      if (chrome.permissions?.contains) {
        const granted = await chrome.permissions.contains({ origins: [origin] });
        if (!granted) {
          skipped += 1;
          results.push({ preset: target.preset, url: target.url, status: 'skipped', message: t('auto_sync_skipped_permission') });
          continue;
        }
      }
      const result = await syncCookiesToPreset(target.url, target.preset, true);
      if (result.success) {
        success += 1;
        results.push({ preset: target.preset, url: target.url, status: 'ok', message: '' });
      } else {
        failed += 1;
        results.push({ preset: target.preset, url: target.url, status: 'failed', message: result.message });
      }
    } catch (error) {
      failed += 1;
      console.error(`Auto cookie sync failed for '${target.preset}':`, error);
      results.push({ preset: target.preset, url: target.url, status: 'failed', message: error.message });
    }
  }

  await chrome.storage.local.set({
    [AUTO_SYNC_LAST_KEY]: {
      time: Date.now(),
      total: autoSyncTargets.length,
      success,
      failed,
      skipped,
      results: results.slice(0, 20),
    },
  });
};

// ============ 快捷键 ============
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async command => {
    if (command !== 'send-current-tab') return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        notify(t('no_url'));
        return;
      }
      const preset = (await getOption('preset')) || 'default';
      await sendUrl(tab.url, preset);
    } catch (error) {
      console.error('Command send failed:', error);
    }
  });
}
