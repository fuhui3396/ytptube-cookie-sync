if (typeof importScripts === 'function') {
    importScripts('i18n.js');
    importScripts('auth.js');
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
    let instanceUrl = await getOption("instance_url");
    if (!instanceUrl) {
        throw new Error(t('instance_not_configured'));
    }

    if (instanceUrl.endsWith('/')) {
        instanceUrl = instanceUrl.slice(0, -1);
    }

    let headers = {};

    const auth = YTPAuth.parse(await YTPAuth.getAuth());
    if (auth.header) {
        headers['Authorization'] = auth.header;
    }

    const url = new URL(instanceUrl);
    url.pathname = path;

    const method = Object.keys(data).length > 0 ? 'POST' : 'GET';
    let opts = { method: method, headers: headers };

    if (data) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }

    console.debug(`Sending ${method} ${path} to '${instanceUrl}' (${auth.header ? 'with authentication' : 'without authentication'}).`);

    const req = await fetch(url, opts);
    return { status: req.status, statusText: req.statusText, data: req };
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
const syncCookiesToPreset = async (url, presetName) => {
    if (!url) {
        return { success: false, message: t('no_url') };
    }

    const domain = YTPCookies.extractDomain(url);
    if (!domain) {
        return { success: false, message: t('cookie_invalid_url') };
    }

    // 1. Read cookies from browser
    const cookies = await YTPCookies.getCookiesForDomain(domain);
    if (cookies.length === 0) {
        return { success: false, message: t('cookie_no_cookies', [domain]) };
    }

    // 2. Convert to Netscape format
    const netscape = YTPCookies.toNetscapeFormat(cookies);
    console.debug(`Syncing ${cookies.length} cookies for domain '${domain}' to preset '${presetName}'`);

    // 3. Find the preset by name
    let instanceUrl = await getOption("instance_url");
    if (!instanceUrl) {
        throw new Error(t('instance_not_configured'));
    }
    if (instanceUrl.endsWith('/')) {
        instanceUrl = instanceUrl.slice(0, -1);
    }

    let headers = {};
    const auth = YTPAuth.parse(await YTPAuth.getAuth());
    if (auth.header) {
        headers['Authorization'] = auth.header;
    }

    // GET all presets to find the target preset by name
    const listUrl = new URL(instanceUrl);
    listUrl.pathname = '/api/presets/';
    listUrl.search = 'per_page=100';

    const listResp = await fetch(listUrl, {
        method: 'GET',
        headers: { ...headers, 'Accept': 'application/json' }
    });

    if (listResp.status !== 200) {
        return { success: false, message: t('cookie_fetch_presets_failed', [listResp.status]) };
    }

    const listData = await listResp.json();
    const items = Array.isArray(listData.items) ? listData.items : listData;
    const preset = items.find(p => p && p.name === presetName);

    if (!preset) {
        return { success: false, message: t('cookie_preset_not_found', [presetName]) };
    }

    if (preset.default) {
        return { success: false, message: t('cookie_preset_is_default', [presetName]) };
    }

    // 4. PATCH the preset with the new cookies
    const patchUrl = new URL(instanceUrl);
    patchUrl.pathname = `/api/presets/${preset.id}`;

    const patchResp = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cookies: netscape }),
    });

    if (patchResp.status === 200) {
        const msg = t('cookie_sync_success', [domain, cookies.length, presetName]);
        notify(msg);
        return { success: true, message: msg, cookies: netscape };
    }

    let errorMsg;
    try {
        const errData = await patchResp.json();
        errorMsg = errData.error || errData.message || patchResp.statusText;
    } catch {
        errorMsg = patchResp.statusText;
    }
    return { success: false, message: t('cookie_sync_failed', [errorMsg]) };
};
