// noinspection JSUnresolvedReference

const $ = selector => document.querySelector(selector);

if (typeof chrome === 'undefined') {
    let chrome = browser;
}

const PAGE_SIZE = 25;
let currentPage = 1;
let totalPages = 1;
let isLoading = false;

const showMessage = (message, isSuccess = true) => {
    const el = $('#history-status-message');
    el.textContent = message;
    el.className = `ytp-status ${isSuccess ? 'is-success' : 'is-danger'}`;
    el.classList.remove('is-hidden');
    setTimeout(() => el.classList.add('is-hidden'), 3000);
};

const itemKey = item => item._id || item.id;

const renderItem = item => {
    const li = document.createElement('li');
    li.className = 'ytp-failed-item';
    li.dataset.id = itemKey(item);
    li.dataset.url = item.url || '';

    const info = document.createElement('span');
    info.className = 'ytp-history-info';
    const title = document.createElement('strong');
    title.textContent = item.title || item.url;
    const meta = document.createElement('small');
    meta.textContent = `${item.status || ''} - ${item.datetime || ''}`;
    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'ytp-history-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'ytp-button ytp-button-secondary';
    openBtn.textContent = t('open_original');
    openBtn.addEventListener('click', () => {
        if (item.url) chrome.tabs.create({ url: item.url });
    });

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'ytp-button ytp-button-secondary';
    retryBtn.textContent = t('retry');
    retryBtn.addEventListener('click', () => retry([itemKey(item)]));

    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'ytp-button ytp-button-secondary';
    archiveBtn.textContent = item.is_archived ? t('unarchive') : t('archive');
    archiveBtn.addEventListener('click', () => archive(item, !item.is_archived));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ytp-button ytp-button-secondary';
    deleteBtn.textContent = t('delete');
    deleteBtn.addEventListener('click', () => remove(itemKey(item)));

    actions.appendChild(openBtn);
    actions.appendChild(retryBtn);
    actions.appendChild(archiveBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(info);
    li.appendChild(actions);
    return li;
};

const applySearch = items => {
    const term = ($('#history-search').value || '').trim().toLowerCase();
    if (!term) return items;
    return items.filter(item =>
        (item.title || '').toLowerCase().includes(term) || (item.url || '').toLowerCase().includes(term)
    );
};

const load = async () => {
    if (isLoading) return;
    isLoading = true;
    const list = $('#history-list');
    try {
        const status = $('#history-status').value;
        const params = new URLSearchParams({
            type: 'done',
            page: String(currentPage),
            per_page: String(PAGE_SIZE),
            order: 'DESC',
        });
        if (status) params.set('status', status);

        const result = await YTPApi.request(`/api/history?${params.toString()}`, { timeout: 20000 });
        if (!result.ok || !result.data) {
            showMessage(t('request_failed'), false);
            return;
        }

        const items = applySearch(result.data.items || []);
        totalPages = result.data.pagination?.total_pages || 1;

        while (list.firstChild) list.removeChild(list.lastChild);
        if (items.length === 0) {
            $('#history-empty').classList.remove('is-hidden');
        } else {
            $('#history-empty').classList.add('is-hidden');
            items.forEach(item => list.appendChild(renderItem(item)));
        }

        $('#history-page-info').textContent = t('page_info', [String(currentPage), String(totalPages)]);
        $('#history-prev').disabled = currentPage <= 1;
        $('#history-next').disabled = currentPage >= totalPages;
    } catch (error) {
        console.error('History load error:', error);
        showMessage(t('request_failed_error', [error.message]), false);
    } finally {
        isLoading = false;
    }
};

const post = async (path, body, method = 'POST') => {
    const result = await YTPApi.request(path, { method, body, timeout: 20000 });
    if (!result.ok) {
        showMessage(result.data?.error || result.data?.message || t('operation_failed'), false);
        return false;
    }
    return true;
};

const retry = async ids => {
    if (await post('/api/history/retry', { ids })) {
        showMessage(t('retry_success'), true);
        await load();
    }
};

const archive = async (item, shouldArchive) => {
    const path = `/api/history/${encodeURIComponent(itemKey(item))}/archive`;
    if (await post(path, undefined, shouldArchive ? 'POST' : 'DELETE')) {
        showMessage(shouldArchive ? t('archived') : t('unarchived'), true);
        await load();
    }
};

const remove = async id => {
    if ($('#history-search') && !confirm(t('confirm_delete'))) return;
    if (await post('/api/history', { type: 'done', ids: [id], remove_file: false }, 'DELETE')) {
        showMessage(t('delete_success'), true);
        await load();
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    initializeDocumentLocale();
    await YTPTheme.init($('#theme-toggle'));

    $('#history-refresh').addEventListener('click', load);
    $('#history-search').addEventListener('input', load);
    $('#history-status').addEventListener('change', () => {
        currentPage = 1;
        load();
    });
    $('#history-prev').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage -= 1;
            load();
        }
    });
    $('#history-next').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage += 1;
            load();
        }
    });

    await load();
});