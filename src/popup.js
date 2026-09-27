// noinspection JSUnresolvedReference

const $ = s => document.querySelector(s)

if (typeof chrome === 'undefined') {
    let chrome = browser;
}

const getOption = async (key, default_data) => {
    let item = await chrome.storage.sync.get(key);
    return Object.prototype.hasOwnProperty.call(item, key) ? item[key] : default_data;
}

const defaultPreset = { name: 'default', default: true, priority: 0 };
let presetItems = [];
let selectedPreset = 'default';
let selectedCookiePreset = 'default';
let onlyCustomPresets = false;

const notify = message => chrome.notifications.create({
    "type": "basic",
    "iconUrl": chrome.runtime.getURL("icons/icon-128.png"),
    "title": t('extension_name'),
    "message": message
});

const showLoading = (isLoading) => {
    const submitBtn = $('#submit-btn')

    if (isLoading) {
        submitBtn.disabled = true
        submitBtn.classList.add('is-loading')
    } else {
        submitBtn.disabled = false
        submitBtn.classList.remove('is-loading')
    }
}

const showStatusMessage = (message, isSuccess = true) => {
    const statusDiv = $('#status-message')
    statusDiv.textContent = message
    statusDiv.className = `ytp-status ${isSuccess ? 'is-success' : 'is-danger'}`
    statusDiv.classList.remove('is-hidden')

    // Hide the message after 3 seconds
    setTimeout(() => {
        statusDiv.classList.add('is-hidden')
    }, 3000)
}

$("#ytptube_popup").addEventListener("submit", async (e) => {
    e.preventDefault()
    const url = $('#user_url').value
    const preset = $('#preset').value || 'default'
    if (!url) {
        showStatusMessage(t('url_required'), false)
        return
    }

    showLoading(true)

    try {
        const response = await chrome.runtime.sendMessage({ command: 'send-to-ytptube', url: url, preset: preset })

        if (response && response.success) {
            showStatusMessage(t('request_success'), true)
        } else {
            showStatusMessage(response?.message || t('request_failed'), false)
        }
    } catch (error) {
        showStatusMessage(t('error_sending'), false)
        console.error('Error:', error)
    } finally {
        showLoading(false)
    }
})

const getCurrentUrl = async () => (await chrome.tabs.query({ currentWindow: true, active: true }))[0].url

addEventListener('DOMContentLoaded', async _ => {
    initializeDocumentLocale()
    await YTPTheme.init($('#theme-toggle'))
    await YTPBackground.init()
    let url = await getCurrentUrl()

    if (url && !url.startsWith('http')) {
        url = ""
    }

    $('#user_url').value = url || ''

    selectedPreset = await getOption("preset", 'default')
    selectedCookiePreset = await getOption("cookiePreset", 'default')
    onlyCustomPresets = await getOption("onlyCustomPresets", false)
    await loadPresetCache(false)

    const inferredPreset = inferPresetByUrl(url, presetItems)
    if (inferredPreset) {
        selectedPreset = inferredPreset
        await chrome.storage.sync.set({ preset: inferredPreset })
        if (presetItems.some(p => !p.default && p.name === inferredPreset)) {
            selectedCookiePreset = inferredPreset
            await chrome.storage.sync.set({ cookiePreset: inferredPreset })
        }
    }

    renderPresets()
    await renderCookiePresets()
    // 启动实时状态更新（WebSocket，失败自动回退轮询）
    startLiveUpdates();
})

$('#go-to-options').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});

$('#go-to-backend').addEventListener('click', async () => {
    const instanceUrl = await getOption('instance_url');
    if (!instanceUrl) {
        showStatusMessage(t('backend_not_configured'), false);
        return;
    }

    try {
        let backendUrl = instanceUrl;
        // 确保我们有完整的 URL
        if (!backendUrl.startsWith('http://') && !backendUrl.startsWith('https://')) {
            backendUrl = 'http://' + backendUrl;
        }

        // 移除末尾的斜杠
        if (backendUrl.endsWith('/')) {
            backendUrl = backendUrl.slice(0, -1);
        }

        // 打开新标签页
        chrome.tabs.create({ url: backendUrl });
    } catch (error) {
        console.error('Error opening backend:', error);
        showStatusMessage(t('backend_open_failed'), false);
    }
});

$('#open-history').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

// 读取 Cookie 前按需申请该站点的主机权限（可选权限，见 manifest）
const ensureOriginPermission = async (url) => {
    try {
        const origin = `${new URL(url).origin}/*`;
        if (!chrome.permissions) return true;
        if (await chrome.permissions.contains({ origins: [origin] })) return true;
        return await chrome.permissions.request({ origins: [origin] });
    } catch (error) {
        console.error('Permission request failed:', error);
        return false;
    }
};

$('#send-batch-btn').addEventListener('click', async () => {
    const btn = $('#send-batch-btn');
    const textarea = $('#batch-urls');
    const urls = (textarea.value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^https?:\/\//i.test(line));

    if (urls.length === 0) {
        showStatusMessage(t('batch_no_urls'), false);
        return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
        const preset = $('#preset').value || 'default';
        const result = await YTPApi.request('/api/history/', {
            method: 'POST',
            body: urls.map(url => ({ url, preset })),
            timeout: 30000,
        });
        if (result.ok) {
            showStatusMessage(t('batch_sent', [String(urls.length)]), true);
            textarea.value = '';
        } else {
            showStatusMessage(result.data?.error || result.data?.message || t('request_failed'), false);
        }
    } catch (error) {
        console.error('Batch send error:', error);
        showStatusMessage(t('request_failed_error', [error.message]), false);
    } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
    }
});

$('#preset').addEventListener('change', async e => {
    selectedPreset = e.target.value
    await chrome.storage.sync.set({ preset: selectedPreset })
})

$('#toggle-presets').addEventListener('click', async () => {
    onlyCustomPresets = !onlyCustomPresets
    await chrome.storage.sync.set({ onlyCustomPresets })
    renderPresets()
})

$('#refresh-presets').addEventListener('click', async () => {
    const button = $('#refresh-presets')
    button.disabled = true
    try {
        await loadPresetCache(true)
        renderPresets()
        showStatusMessage(t('presets_refreshed'))
    } catch (error) {
        console.error(error)
        showStatusMessage(t('unable_refresh'), false)
    } finally {
        button.disabled = false
    }
})

const getPresets = async () => {
    const instanceUrl = await getOption("instance_url");
    if (!instanceUrl) {
        return []
    }

    let headers = {};

    let auth;
    try {
        auth = YTPAuth.parse(await YTPAuth.getAuth());
    } catch (error) {
        console.error(error)
        return null
    }
    if (auth.header) {
        headers['Authorization'] = auth.header;
    }

    const url = new URL(instanceUrl);
    url.pathname = '/api/presets/';
    url.search = 'per_page=100';

    try {
        const req = await fetch(url, { method: 'GET', headers: { ...headers, 'Accept': 'application/json' } });
        if (200 !== req.status) {
            console.error(`Error fetching presets from YTPTube: ${req.status}`)
            return null
        }

        const data = await req.json()
        const items = Array.isArray(data.items) ? data.items : data
        return Array.isArray(items) ? items.filter(p => p && p.name).map(p => ({
            name: p.name,
            default: p.default === true,
            priority: Number.isFinite(p.priority) ? p.priority : 0,
            description: p.description || ''
        })) : []
    } catch (error) {
        console.error('Error fetching presets from YTPTube:', error)
        return null
    }
};

const normalizePresets = items => {
    if (!Array.isArray(items)) {
        return []
    }

    // The old cache stored names only. Treat those entries as server presets.
    return items.filter(item => typeof item === 'string' || (item && item.name)).map(item =>
        typeof item === 'string' ? { name: item, default: item === 'default', priority: 0 } : item
    )
}

const loadPresetCache = async force => {
    const cache = await getOption('presets', { items: [], last_updated: 0 })
    if (force || Date.now() - cache.last_updated > 1000 * 60 * 60) {
        const freshPresets = await getPresets()
        if (freshPresets !== null) {
            cache.items = freshPresets
            cache.last_updated = Date.now()
        }
        await chrome.storage.sync.set({ presets: cache })
    }
    presetItems = normalizePresets(cache.items ?? cache.presets)
}

const renderPresets = async () => {
    const s = $('#preset')
    while (s.firstChild) {
        s.removeChild(s.lastChild)
    }

    const visibleItems = onlyCustomPresets ? presetItems.filter(p => !p.default) : [...presetItems]
    const customItems = visibleItems.filter(p => !p.default)
    const builtInItems = visibleItems.filter(p => p.default)

    appendPresetGroup(s, t('custom_presets'), customItems)
    appendPresetGroup(s, t('default_presets'), builtInItems)
    if (customItems.length === 0 && builtInItems.length === 0) {
        appendPreset(s, defaultPreset, selectedPreset)
    }

    const selected = [...s.options].find(option => option.value === selectedPreset)
    if (selected) {
        selected.selected = true
    } else {
        s.options[0].selected = true
        selectedPreset = s.options[0].value
        await chrome.storage.sync.set({ preset: selectedPreset })
    }

    const toggle = $('#toggle-presets')
    toggle.textContent = onlyCustomPresets ? t('show_all') : t('custom_only')
    toggle.classList.toggle('is-active', onlyCustomPresets)
}

const appendPreset = (select, preset, selectedPreset) => {
    const option = document.createElement('option')
    option.value = preset.name
    option.textContent = preset.name
    if (preset.description) {
        option.title = preset.description
    }
    option.selected = preset.name === selectedPreset
    select.appendChild(option)
}

const appendPresetGroup = (select, label, presets) => {
    if (presets.length === 0) {
        return
    }

    const group = document.createElement('optgroup')
    group.label = label
    presets
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name))
        .forEach(preset => appendPreset(group, preset, null))
    select.appendChild(group)
}

const getDomainKeyword = (url) => {
    const domain = YTPCookies.extractDomain(url);
    if (!domain) return null;
    const parts = domain.toLowerCase().split('.');
    if (parts.length === 1) return parts[0];
    const ignored = new Set(['www', 'm', 'mobile', 'mp', 'api', 'app', 'play', 'music', 'music-tv']);
    let idx = 0;
    while (idx < parts.length - 2 && ignored.has(parts[idx])) {
        idx++;
    }
    return parts[idx] || parts[0];
};

const inferPresetByUrl = (url, presets) => {
    const keyword = getDomainKeyword(url);
    if (!keyword || !Array.isArray(presets) || presets.length === 0) return null;

    const candidates = [];
    for (const preset of presets) {
        if (!preset || typeof preset.name !== 'string' || preset.default) continue;
        const name = preset.name.toLowerCase();
        if (name === keyword) {
            candidates.push({ preset, score: 100 });
        } else if (name.includes(keyword)) {
            candidates.push({ preset, score: 60 - name.length });
        } else if (keyword.includes(name)) {
            candidates.push({ preset, score: 30 - name.length });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].preset.name;
};

// --- Cookie Sync ---

const showCookieStatus = (message, isSuccess = true) => {
    const statusDiv = $('#cookie-status')
    statusDiv.textContent = message
    statusDiv.className = `ytp-status ${isSuccess ? 'is-success' : 'is-danger'}`
    statusDiv.classList.remove('is-hidden')
    setTimeout(() => {
        statusDiv.classList.add('is-hidden')
    }, 4000)
}

const renderCookiePresets = async () => {
    const s = $('#cookie-preset')
    while (s.firstChild) {
        s.removeChild(s.lastChild)
    }

    // Cookie presets exclude "default" because default presets cannot be modified on the server
    const customItems = presetItems.filter(p => !p.default)

    if (customItems.length === 0) {
        const option = document.createElement('option')
        option.value = ''
        option.textContent = t('cookie_no_custom_presets')
        option.disabled = true
        s.appendChild(option)
        return
    }

    const group = document.createElement('optgroup')
    group.label = t('custom_presets')
    customItems
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name))
        .forEach(preset => {
            const option = document.createElement('option')
            option.value = preset.name
            option.textContent = preset.name
            if (preset.description) option.title = preset.description
            option.selected = preset.name === selectedCookiePreset
            group.appendChild(option)
        })
    s.appendChild(group)

    // Ensure selected preset still exists
    const selected = [...s.options].find(o => o.value === selectedCookiePreset)
    if (selected) {
        selected.selected = true
    } else if (s.options.length > 0) {
        s.options[0].selected = true
        selectedCookiePreset = s.options[0].value
        await chrome.storage.sync.set({ cookiePreset: selectedCookiePreset })
    }
}

$('#cookie-preset').addEventListener('change', async e => {
    selectedCookiePreset = e.target.value
    await chrome.storage.sync.set({ cookiePreset: selectedCookiePreset })
})

$('#sync-cookies-btn').addEventListener('click', async () => {
    const btn = $('#sync-cookies-btn')
    const url = $('#user_url').value || await getCurrentUrl()

    if (!url) {
        showCookieStatus(t('cookie_no_url'), false)
        return
    }

    if (!selectedCookiePreset || selectedCookiePreset === 'default') {
        showCookieStatus(t('cookie_select_custom_preset'), false)
        return
    }

    if (!await ensureOriginPermission(url)) {
        showCookieStatus(t('permission_denied'), false)
        return
    }

    btn.disabled = true
    btn.classList.add('is-loading')

    try {
        const response = await chrome.runtime.sendMessage({
            command: 'sync-cookies-to-preset',
            url: url,
            presetName: selectedCookiePreset,
        })

        if (response && response.success) {
            showCookieStatus(response.message, true)
        } else {
            showCookieStatus(response?.message || t('cookie_sync_failed_generic'), false)
        }
    } catch (error) {
        console.error('Cookie sync error:', error)
        showCookieStatus(t('cookie_sync_failed_generic'), false)
    } finally {
        btn.disabled = false
        btn.classList.remove('is-loading')
    }
})

$('#preview-cookies-btn').addEventListener('click', async () => {
    const btn = $('#preview-cookies-btn')
    const url = $('#user_url').value || await getCurrentUrl()
    const preview = $('#cookie-preview')
    const content = $('#cookie-preview-content')

    if (!url) {
        showCookieStatus(t('cookie_no_url'), false)
        return
    }

    if (!await ensureOriginPermission(url)) {
        showCookieStatus(t('permission_denied'), false)
        return
    }

    btn.disabled = true
    btn.classList.add('is-loading')

    try {
        const response = await chrome.runtime.sendMessage({
            command: 'get-cookies-for-url',
            url: url,
        })

        if (response && response.success && response.data) {
            const { domain, cookies, netscape } = response.data
            if (cookies.length === 0) {
                content.textContent = t('cookie_no_cookies', [domain || url])
                preview.classList.remove('is-hidden')
            } else {
                content.textContent = netscape
                preview.classList.remove('is-hidden')
            }
        } else {
            showCookieStatus(response?.message || t('cookie_preview_failed'), false)
        }
    } catch (error) {
        console.error('Cookie preview error:', error)
        showCookieStatus(t('cookie_preview_failed'), false)
    } finally {
        btn.disabled = false
        btn.classList.remove('is-loading')
    }
})

// 复制当前预览的 Cookie 到剪贴板
$('#copy-cookies-btn').addEventListener('click', async () => {
    const content = $('#cookie-preview-content').textContent;
    if (!content) {
        showCookieStatus(t('cookie_no_cookies', ['']), false)
        return
    }
    try {
        await navigator.clipboard.writeText(content)
        showCookieStatus(t('copied'), true)
    } catch (error) {
        console.error('Copy failed:', error)
        showCookieStatus(t('copy_failed'), false)
    }
})

// ==================== 实时状态：WebSocket + 轮询兜底 ====================
let liveTimer = null;
let liveSocket = null;
let refreshTimer = null;
let liveInFlight = false;
let failedInFlight = false;
let liveSignature = '';
let failedSignature = '';
let failedFilter = 'failed';

const ACTIVE_STATUSES = new Set(['queued', 'started', 'preparing', 'downloading', 'postprocessing']);

const scheduleRefresh = () => {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    await loadLiveQueue();
    await loadFailedList();
  }, 400);
};

// 速度：字节/秒 -> 带单位（与 YTPTube Web UI 一致）
const formatSpeed = value => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value ? String(value) : '0 B/s';
  if (num <= 0) return '0 B/s';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  const i = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024))));
  return `${parseFloat((num / 1024 ** i).toFixed(2))} ${units[i]}/s`;
};

// 剩余时间：秒 -> 带单位（与 YTPTube Web UI 一致）
const formatEta = value => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value ? String(value) : '-';
  if (num <= 0) return '-';
  if (num < 60) return `${Math.round(num)}s`;
  if (num < 3600) return `${Math.floor(num / 60)}m ${Math.round(num % 60)}s`;
  const h = Math.floor(num / 3600);
  const rest = num % 3600;
  return `${h}h ${Math.floor(rest / 60)}m ${Math.round(rest % 60)}s`;
};

// 状态标签，未知状态回退为原始文案
const statusLabel = status => {
  if (!status) return t('status_queued');
  const value = t('status_' + status);
  if (value.startsWith('[Missing translation')) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
  return value;
};

const liveAction = async (action, id) => {
  try {
    const result = await YTPApi.request(`/api/history/${action}`, {
      method: 'POST',
      body: { ids: [id] },
      timeout: 15000,
    });
    if (!result.ok) {
      showStatusMessage(result.data?.error || result.data?.message || t('request_failed'), false);
    }
    liveSignature = '';
    failedSignature = '';
    await loadLiveQueue(true);
    await loadFailedList(true);
  } catch (error) {
    console.error(`Live action '${action}' failed:`, error);
    showStatusMessage(t('request_failed_error', [error.message]), false);
  }
};

// 渲染实时队列项
const renderLiveItem = item => {
  const li = document.createElement('li');
  li.className = 'ytp-live-item';
  const id = item._id || item.id;
  li.dataset.id = id;
  const title = document.createElement('span');
  title.textContent = item.title || item.url;
  const badge = document.createElement('span');
  badge.className = 'ytp-status-badge';
  badge.textContent = statusLabel(item.status);
  const progress = document.createElement('div');
  progress.className = 'ytp-progress';
  const fill = document.createElement('div');
  const percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
  fill.style.width = `${percent}%`;
  progress.appendChild(fill);
  const extra = document.createElement('small');
  extra.textContent = `${t('speed')}: ${formatSpeed(item.speed)} | ${t('eta')}: ${formatEta(item.eta)}`;
  li.appendChild(title);
  li.appendChild(badge);
  li.appendChild(progress);
  li.appendChild(extra);

  if (ACTIVE_STATUSES.has(item.status)) {
    const controls = document.createElement('div');
    controls.className = 'ytp-live-controls';
    if (item.status === 'downloading') {
      const pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'ytp-button ytp-button-secondary';
      pauseBtn.textContent = t('pause');
      pauseBtn.addEventListener('click', () => liveAction('pause', id));
      controls.appendChild(pauseBtn);
    }
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ytp-button ytp-button-secondary';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => liveAction('cancel', id));
    controls.appendChild(cancelBtn);
    li.appendChild(controls);
  }

  return li;
};

// 加载实时队列（签名未变则不重绘）
const loadLiveQueue = async (force = false) => {
  if (liveInFlight) return;
  liveInFlight = true;
  try {
    const result = await YTPApi.request('/api/history/live', { timeout: 15000 });
    if (!result.ok || !result.data) return;
    const queue = Object.values(result.data.queue || {});
    const signature = JSON.stringify(queue.map(i => [i._id || i.id, i.status, i.percent, i.speed, i.eta, i.title]));
    if (!force && signature === liveSignature) return;
    liveSignature = signature;

    const list = $('#live-queue');
    while (list.firstChild) list.removeChild(list.lastChild);
    if (queue.length === 0) {
      $('#no-active').classList.remove('is-hidden');
    } else {
      $('#no-active').classList.add('is-hidden');
      queue.forEach(item => list.appendChild(renderLiveItem(item)));
    }
  } catch (e) {
    console.error('Live queue error', e);
  } finally {
    liveInFlight = false;
  }
};

// 渲染失败项
const renderFailedItem = item => {
  const li = document.createElement('li');
  li.className = 'ytp-failed-item';
  // Retry API expects the history item _id (UUID), not the video id.
  li.dataset.id = item._id || item.id;
  li.dataset.url = item.url || '';
  const txt = document.createElement('span');
  txt.textContent = item.title || item.url;
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'ytp-button ytp-button-secondary';
  retryBtn.textContent = t('retry');
  retryBtn.addEventListener('click', () => retryItems([item._id || item.id], [item.url]));
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'ytp-button ytp-button-secondary';
  openBtn.textContent = t('open_original');
  openBtn.addEventListener('click', () => {
    if (item.url) chrome.tabs.create({ url: item.url });
  });
  li.appendChild(txt);
  li.appendChild(retryBtn);
  li.appendChild(openBtn);
  return li;
};

const matchesFilter = item => {
  if (failedFilter === 'all') return true;
  if (failedFilter === 'failed') return item.status === 'error';
  return item.status === failedFilter;
};

// 加载失败列表（签名未变则不重绘）
const loadFailedList = async (force = false) => {
  if (failedInFlight) return;
  failedInFlight = true;
  try {
    const result = await YTPApi.request('/api/history?type=done&status=!finished&per_page=50&order=DESC', { timeout: 15000 });
    if (!result.ok || !result.data) return;
    const items = (result.data.items || []).filter(matchesFilter);
    const signature = JSON.stringify(items.map(i => [i._id || i.id, i.status, i.title]));
    if (!force && signature === failedSignature) return;
    failedSignature = signature;

    const list = $('#failed-list');
    while (list.firstChild) list.removeChild(list.lastChild);
    if (items.length === 0) {
      $('#no-failed').classList.remove('is-hidden');
      $('#retry-all-failed').classList.add('is-hidden');
    } else {
      $('#no-failed').classList.add('is-hidden');
      $('#retry-all-failed').classList.remove('is-hidden');
      items.forEach(item => list.appendChild(renderFailedItem(item)));
    }
  } catch (e) {
    console.error('Failed list error', e);
  } finally {
    failedInFlight = false;
  }
};

// 重试 API 调用
const retryItems = async (ids, urls = []) => {
  try {
    const result = await YTPApi.request('/api/history/retry', { method: 'POST', body: { ids }, timeout: 20000 });
    if (result.ok) {
      const count = Number(result.data?.count ?? ids.length);
      // 用户主动重试后，短时间内抑制这些 URL 的通知，避免失败再次刷屏
      if (urls.length) {
        chrome.runtime.sendMessage({ command: 'suppress-notifications', urls }).catch(() => {});
      }
      showStatusMessage(count > 0 ? t('retry_success') : t('retry_nothing'), count > 0);
    } else {
      showStatusMessage(result.data?.message || result.data?.error || t('retry_failed'), false);
    }
    failedSignature = '';
    await loadFailedList(true);
  } catch (e) {
    console.error('Retry error', e);
    showStatusMessage(t('retry_failed'), false);
  }
};

// ==================== 连接管理 ====================
const startPolling = () => {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    loadLiveQueue();
    loadFailedList();
  }, 3000);
};

const stopUpdates = () => {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (liveSocket) {
    try { liveSocket.close(); } catch (_) { /* ignore */ }
    liveSocket = null;
  }
};

const connectSocket = async () => {
  let base;
  try {
    base = await YTPApi.getInstanceUrl();
  } catch (_) {
    base = '';
  }
  if (!base) {
    startPolling();
    return;
  }

  let ticket = '';
  try {
    const result = await YTPApi.request('/api/auth/ws-ticket', { method: 'POST', timeout: 8000 });
    if (result.ok && result.data?.ticket) {
      ticket = result.data.ticket;
    }
  } catch (_) {
    // Authentication disabled or older server; connect without a ticket.
  }

  try {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
    url.search = `?_=${Date.now()}${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ''}`;

    liveSocket = new WebSocket(url.toString());
    liveSocket.addEventListener('open', () => {
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
    });
    liveSocket.addEventListener('message', event => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload && typeof payload.event === 'string') {
        scheduleRefresh();
      }
    });
    const fallback = () => {
      if (liveSocket) {
        try { liveSocket.close(); } catch (_) { /* ignore */ }
        liveSocket = null;
      }
      startPolling();
    };
    liveSocket.addEventListener('close', fallback);
    liveSocket.addEventListener('error', fallback);
  } catch (error) {
    console.error('WebSocket connect failed:', error);
    startPolling();
  }
};

const startLiveUpdates = async () => {
  await loadLiveQueue(true);
  await loadFailedList(true);
  connectSocket();
};

$('#failed-filter').addEventListener('change', e => {
  failedFilter = e.target.value;
  failedSignature = '';
  loadFailedList(true);
});

// 全部重试按钮绑定
$('#retry-all-failed').addEventListener('click', async () => {
  const nodes = Array.from(document.querySelectorAll('.ytp-failed-item'));
  const ids = nodes.map(el => el.dataset.id).filter(Boolean);
  const urls = nodes.map(el => el.dataset.url).filter(Boolean);
  if (ids.length) await retryItems(ids, urls);
});

// 页面关闭时停止实时更新
addEventListener('pagehide', stopUpdates);
