// noinspection JSUnresolvedReference

const str_keys = ["instance_url"]
let storedOriginPattern = null;

if (typeof chrome === 'undefined') {
    let chrome = browser
}

const notify = (message, no_inline) => {
    if (!no_inline) {
        document.querySelector('#error_msg').innerText = message;
    }

    chrome.notifications.create({
        "type": "basic",
        "iconUrl": chrome.runtime.getURL("icons/icon-128.png"),
        "title": t('extension_name'),
        "message": message,
    });
}

const buildOriginPattern = (instanceUrl) => {
    try {
        const url = new URL(instanceUrl);
        return `${url.protocol}//${url.host}/*`;
    } catch (error) {
        return null;
    }
};

const ensureOriginPermission = async (originPattern) => {
    if (!originPattern) {
        return false;
    }

    if (!chrome.permissions || !chrome.permissions.request) {
        return true;
    }

    return await chrome.permissions.request({ origins: [originPattern] });
};

const removeOriginPermission = async (originPattern) => {
    if (!originPattern) {
        return;
    }

    const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
    if (!hasPermission) {
        return;
    }

    await chrome.permissions.remove({ origins: [originPattern] });
};

const readJson = async response => {
    try {
        return await response.json();
    } catch (_) {
        return {};
    }
};

const testConfig = async (requestPermission = true) => {
    document.querySelector('#error_msg').innerText = "";

    let instance_url = document.querySelector("#instance_url").value.trim();
    if (!instance_url) {
        notify(t('valid_instance_url'));
        return false;
    }

    if (instance_url.endsWith('/')) {
        instance_url = instance_url.slice(0, -1);
    }

    document.querySelector("#instance_url").value = instance_url;

    const originPattern = buildOriginPattern(instance_url);
    if (!originPattern) {
        notify(t('valid_instance_url'));
        return false;
    }

    if (requestPermission) {
        const granted = await ensureOriginPermission(originPattern);
        if (!granted) {
            notify(t('permission_denied'));
            return false;
        }
    }

    const authValue = document.querySelector("#auth").value;
    let auth;
    try {
        auth = YTPAuth.parse(authValue);
    } catch (error) {
        notify(error.message);
        return false;
    }

    try {
        const headers = auth.header ? { Authorization: auth.header } : {};
        let req = await fetch(`${instance_url}/api/auth/status`, {
            method: 'GET',
            headers
        });

        // Older YTPTube versions predate the full authentication API.
        if (req.status === 404) {
            req = await fetch(`${instance_url}/api/ping`, {
                method: 'GET',
                headers
            });

            if (req.status === 200) {
                notify(t('connection_success'), true);
                return true;
            }
        }

        const json = await readJson(req);
        if (200 === req.status && (json.disabled === true || json.authenticated === true)) {
            notify(t('connection_success'), true);
            return true;
        }

        const errorCode = String(json.error || json.code || '');
        const message = (json.setup_required === true || errorCode === 'setup_required') ? t('setup_required') :
            (json.authenticated === false || req.status === 401 || /invalid|missing credential/i.test(errorCode) ? t('invalid_credentials') : (json.error ?? t('auth_check_failed')));
        notify(message);
    } catch (e) {
        notify(t('error_prefix', [e]));
    }
    return false;
}

document.addEventListener("DOMContentLoaded", () => {
    initializeDocumentLocale();
    YTPTheme.init(document.querySelector('#theme-toggle'));
    function onError(error) {
        console.log(`Error: ${error}`);
    }

    const markEdited = event => {
        event.currentTarget.dataset.userEdited = 'true';
    };
    const backgroundOpacity = document.querySelector('#backgroundOpacity');
    const backgroundOpacityValue = document.querySelector('#backgroundOpacityValue');
    const backgroundOpacityField = document.querySelector('#backgroundOpacityField');
    const showBackground = document.querySelector('#showBackground');
    const shellOpacity = () => 1 - Number(backgroundOpacity.value) / 100;
    const updateOpacityValue = () => {
        backgroundOpacityValue.value = `${backgroundOpacity.value}%`;
        if (document.body.classList.contains('ytp-with-background')) {
            YTPBackground.setOpacity(shellOpacity());
        }
    };
    const updateBackgroundPreview = async () => {
        backgroundOpacityField.hidden = !showBackground.checked;
        if (showBackground.checked) {
            await YTPBackground.show(shellOpacity());
        } else {
            YTPBackground.hide();
        }
    };
    backgroundOpacity.addEventListener('input', updateOpacityValue);
    showBackground.addEventListener('change', updateBackgroundPreview);
    updateOpacityValue();

    document.querySelectorAll('#instance_url, #auth, #showContextMenu, #showBackground, #backgroundOpacity')
        .forEach(input => input.addEventListener('input', markEdited));
    document.querySelectorAll('#showContextMenu, #showBackground')
        .forEach(input => input.addEventListener('change', markEdited));

    const setIfUntouched = (selector, value) => {
        const input = document.querySelector(selector);
        if (input.dataset.userEdited !== 'true') {
            input.value = value;
        }
    };

    chrome.storage.sync.get(str_keys).then(async r => {
        setIfUntouched("#instance_url", r.instance_url || "");
        setIfUntouched("#auth", await YTPAuth.getAuth());
    }, onError);

    chrome.storage.sync.get(["showContextMenu", "showBackground", "backgroundOpacity", "instance_origin"]).then(async r => {
        const showContextMenu = document.querySelector("#showContextMenu");
        showContextMenu.closest('.ytp-check').classList.toggle('is-hidden', !chrome.contextMenus);
        if (showContextMenu.dataset.userEdited !== 'true') {
            showContextMenu.checked = r.showContextMenu || false;
        }
        if (showBackground.dataset.userEdited !== 'true') {
            showBackground.checked = r.showBackground ?? true;
        }
        if (backgroundOpacity.dataset.userEdited !== 'true') {
            backgroundOpacity.value = Math.round((1 - (r.backgroundOpacity ?? .95)) * 100);
            updateOpacityValue();
        }
        storedOriginPattern = r.instance_origin || null;
        await updateBackgroundPreview();
    }, onError);
});

document.getElementById("ytptube_options").addEventListener("submit", async e => {
    e.preventDefault();

    document.querySelector('#error_msg').innerText = "";
    let instance_url = document.querySelector("#instance_url").value.trim();
    if (!instance_url) {
        notify(t('valid_instance_url'));
        return false;
    }

    if (instance_url.endsWith('/')) {
        instance_url = instance_url.slice(0, -1);
    }

    const newOriginPattern = buildOriginPattern(instance_url);
    if (!newOriginPattern) {
        notify(t('valid_instance_url'));
        return false;
    }

    if (!await ensureOriginPermission(newOriginPattern)) {
        notify(t('permission_denied'));
        return false;
    }

    const data = {
        instance_url,
        showContextMenu: document.querySelector("#showContextMenu").checked,
        showBackground: document.querySelector("#showBackground").checked,
        backgroundOpacity: 1 - Number(document.querySelector("#backgroundOpacity").value) / 100,
        instance_origin: newOriginPattern
    };

    try {
        const authValue = document.querySelector("#auth").value;
        const previous = await chrome.storage.sync.get(["instance_url"]);
        const previousAuth = await YTPAuth.getAuth();
        const sourceChanged = (previous.instance_url || '') !== instance_url || previousAuth !== authValue;

        await chrome.storage.sync.set(data);
        await YTPAuth.setAuth(authValue);
        if (sourceChanged) {
            await chrome.storage.sync.remove("presets");
        }

        if (storedOriginPattern && storedOriginPattern !== newOriginPattern) {
            await removeOriginPermission(storedOriginPattern);
        }
        storedOriginPattern = newOriginPattern;
        if (chrome.contextMenus) {
            chrome.contextMenus.update("send-to-ytptube", { visible: data.showContextMenu });
        }

        if (!await testConfig(false)) {
            return;
        }

        notify(t('options_saved'), true);
    } catch (error) {
        notify(t('unable_save', [error.message]));
    }
});

document.getElementById("test_config").addEventListener("click", async e => {
    e.preventDefault();
    await testConfig();
});

document.getElementById("toggle_auth").addEventListener("click", e => {
    const input = document.getElementById("auth");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    e.currentTarget.textContent = visible ? t('show') : t('hide');
    e.currentTarget.setAttribute("aria-pressed", String(!visible));
    e.currentTarget.setAttribute("aria-label", t(visible ? 'show_auth' : 'hide_auth'));
});

// ==================== Notification settings ====================
const NOTIFY_DEFAULTS = { notifyEnabled: true, notifyFinished: true, notifyFailed: true };

const initNotifications = async () => {
    const stored = await chrome.storage.sync.get(Object.keys(NOTIFY_DEFAULTS));
    for (const [key, fallback] of Object.entries(NOTIFY_DEFAULTS)) {
        const el = document.getElementById(key);
        if (!el) continue;
        el.checked = stored[key] ?? fallback;
        el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
    }
};

// ==================== Presets ====================
const fetchPresetList = async () => {
    try {
        const result = await YTPApi.request('/api/presets/?per_page=100', { timeout: 20000 });
        if (!result.ok || !result.data) return null;
        return Array.isArray(result.data.items) ? result.data.items : result.data;
    } catch (error) {
        console.error('Failed to load presets:', error);
        return null;
    }
};

const saveCookiesToPreset = async (id, cookies) => {
    const result = await YTPApi.request(`/api/presets/${id}`, {
        method: 'PATCH',
        body: { cookies },
        timeout: 20000,
    });
    if (result.ok) {
        notify(t('preset_cookies_saved'), true);
        return true;
    }
    notify(result.data?.error || result.data?.message || t('operation_failed'));
    return false;
};

const downloadPresetCookies = preset => {
    const blob = new Blob([preset.cookies || ''], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${preset.name}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
};

const renderPresetRow = preset => {
    const li = document.createElement('li');
    li.className = 'ytp-preset-item';

    const head = document.createElement('div');
    head.className = 'ytp-preset-head';
    const name = document.createElement('strong');
    name.textContent = preset.name;
    if (preset.default) {
        const badge = document.createElement('span');
        badge.className = 'ytp-status-badge';
        badge.textContent = t('default_presets');
        name.appendChild(document.createTextNode(' '));
        name.appendChild(badge);
    }
    head.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'ytp-preset-actions';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ytp-button ytp-button-secondary';
    exportBtn.textContent = t('export');
    exportBtn.addEventListener('click', () => downloadPresetCookies(preset));
    actions.appendChild(exportBtn);

    if (!preset.default) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ytp-button ytp-button-secondary';
        deleteBtn.textContent = t('delete');
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(t('confirm_delete'))) return;
            const result = await YTPApi.request(`/api/presets/${preset.id}`, { method: 'DELETE', timeout: 20000 });
            if (result.ok) {
                notify(t('preset_deleted'), true);
                await initPresets();
            } else {
                notify(result.data?.error || result.data?.message || t('operation_failed'));
            }
        });
        actions.appendChild(deleteBtn);
    }
    head.appendChild(actions);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = t('cookies');
    details.appendChild(summary);

    const textarea = document.createElement('textarea');
    textarea.className = 'ytp-cookies-editor ytp-control';
    textarea.rows = 6;
    textarea.value = preset.cookies || '';
    details.appendChild(textarea);

    if (!preset.default) {
        const editorActions = document.createElement('div');
        editorActions.className = 'ytp-preset-actions';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.txt,text/plain';
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (file) textarea.value = await file.text();
        });

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'ytp-button ytp-button-secondary';
        importBtn.textContent = t('import');
        importBtn.addEventListener('click', () => fileInput.click());

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'ytp-button ytp-button-secondary';
        saveBtn.textContent = t('save');
        saveBtn.addEventListener('click', () => saveCookiesToPreset(preset.id, textarea.value));

        editorActions.appendChild(importBtn);
        editorActions.appendChild(saveBtn);
        editorActions.appendChild(fileInput);
        details.appendChild(editorActions);
    }

    li.appendChild(head);
    li.appendChild(details);
    return li;
};

const initPresets = async () => {
    const list = document.getElementById('preset-list');
    if (!list) return;
    const presets = await fetchPresetList();
    while (list.firstChild) list.removeChild(list.lastChild);
    if (!presets) {
        notify(t('unable_refresh'));
        return;
    }
    presets.forEach(preset => list.appendChild(renderPresetRow(preset)));

    const select = document.getElementById('auto-sync-preset');
    if (select) {
        const current = select.value;
        while (select.firstChild) select.removeChild(select.lastChild);
        presets.filter(p => !p.default).forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            select.appendChild(option);
        });
        if (current) select.value = current;
    }
};

// ==================== Automatic cookie sync ====================
const getAutoTargets = async () => (await chrome.storage.sync.get('autoSyncTargets')).autoSyncTargets || [];

const renderAutoTargets = async () => {
    const list = document.getElementById('auto-sync-list');
    if (!list) return;
    const targets = await getAutoTargets();
    while (list.firstChild) list.removeChild(list.firstChild);
    targets.forEach((target, index) => {
        const li = document.createElement('li');
        li.className = 'ytp-auto-sync-item';
        li.textContent = `${target.preset} - ${target.url} `;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'ytp-button ytp-button-secondary';
        removeBtn.textContent = t('delete');
        removeBtn.addEventListener('click', async () => {
            const current = await getAutoTargets();
            current.splice(index, 1);
            await chrome.storage.sync.set({ autoSyncTargets: current });
            await renderAutoTargets();
        });
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
};

const AUTO_SYNC_DEFAULT_INTERVAL = 360;

const renderAutoSyncLast = async () => {
    const el = document.getElementById('auto-sync-last');
    if (!el) return;
    const { autoSyncLast } = await chrome.storage.local.get('autoSyncLast');
    if (!autoSyncLast || !autoSyncLast.time) {
        el.textContent = `${t('auto_sync_last')}: ${t('auto_sync_never')}`;
        return;
    }
    const when = new Date(autoSyncLast.time).toLocaleString();
    const summary = t('auto_sync_summary', [
        String(autoSyncLast.success ?? 0),
        String(autoSyncLast.failed ?? 0),
        String(autoSyncLast.skipped ?? 0),
    ]);
    let text = `${t('auto_sync_last')}: ${when} - ${summary}`;
    const problems = (autoSyncLast.results || []).filter(r => r.status !== 'ok');
    if (problems.length) {
        text += '\n' + problems.map(r => `- ${r.preset}: ${r.message || r.status}`).join('\n');
    }
    el.textContent = text;
    el.style.whiteSpace = 'pre-line';
};

const initAutoSync = async () => {
    const enabled = document.getElementById('autoSyncEnabled');
    if (enabled) {
        enabled.checked = (await chrome.storage.sync.get('autoSyncEnabled')).autoSyncEnabled ?? false;
        enabled.addEventListener('change', () => chrome.storage.sync.set({ autoSyncEnabled: enabled.checked }));
    }

    const interval = document.getElementById('autoSyncInterval');
    if (interval) {
        const stored = await chrome.storage.sync.get('autoSyncInterval');
        interval.value = String(Math.max(5, Number(stored.autoSyncInterval) || AUTO_SYNC_DEFAULT_INTERVAL));
        interval.addEventListener('change', () => {
            const value = Math.max(5, Number(interval.value) || AUTO_SYNC_DEFAULT_INTERVAL);
            interval.value = String(value);
            chrome.storage.sync.set({ autoSyncInterval: value });
        });
    }

    await renderAutoSyncLast();
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.autoSyncLast) {
            renderAutoSyncLast();
        }
    });

    const addBtn = document.getElementById('auto-sync-add');
    if (!addBtn) return;
    addBtn.addEventListener('click', async () => {
        const preset = document.getElementById('auto-sync-preset').value;
        const url = document.getElementById('auto-sync-url').value.trim();
        if (!preset || !/^https?:\/\//i.test(url)) {
            notify(t('auto_sync_invalid'));
            return;
        }
        try {
            const origin = `${new URL(url).origin}/*`;
            if (chrome.permissions?.request) {
                await chrome.permissions.request({ origins: [origin] });
            }
        } catch (_) { /* ignore permission errors */ }
        const current = await getAutoTargets();
        if (!current.some(t => t.preset === preset && t.url === url)) {
            current.push({ preset, url });
            await chrome.storage.sync.set({ autoSyncTargets: current });
        }
        document.getElementById('auto-sync-url').value = '';
        await renderAutoTargets();
    });

    await renderAutoTargets();
};

document.addEventListener('DOMContentLoaded', async () => {
    await initNotifications();
    await initAutoSync();
    await initPresets();
    document.getElementById('create-preset')?.addEventListener('click', async () => {
        const input = document.getElementById('new-preset-name');
        const name = (input.value || '').trim();
        if (!name) {
            notify(t('preset_name_required'));
            return;
        }
        const result = await YTPApi.request('/api/presets/', {
            method: 'POST',
            body: { name },
            timeout: 20000,
        });
        if (result.ok) {
            input.value = '';
            notify(t('preset_created'), true);
            await initPresets();
        } else {
            notify(result.data?.error || result.data?.message || t('operation_failed'));
        }
    });
});
