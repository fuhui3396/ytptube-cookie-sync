// Shared YTPTube API helpers: base URL, auth headers, and timeout-aware fetch.
(function (root) {
    const api = root.chrome || root.browser;
    const translate = root.t || (key => key);

    const normalizeBase = url => (url || '').replace(/\/+$/, '');

    const getInstanceUrl = async () => {
        const stored = await api.storage.sync.get('instance_url');
        return normalizeBase(stored.instance_url);
    };

    const getAuthHeader = async () => {
        try {
            const auth = root.YTPAuth.parse(await root.YTPAuth.getAuth());
            return auth.header || null;
        } catch (error) {
            console.error('Failed to parse authentication:', error);
            return null;
        }
    };

    const getHeaders = async extra => {
        const headers = { ...(extra || {}) };
        const header = await getAuthHeader();
        if (header) {
            headers.Authorization = header;
        }
        return headers;
    };

    /**
     * Perform an authenticated request against the configured YTPTube instance.
     * @param {string} path - API path beginning with "/"
     * @param {object} [options]
     * @param {string} [options.method]
     * @param {any} [options.body]
     * @param {object} [options.headers]
     * @param {number} [options.timeout] - milliseconds, 0 disables
     * @param {string} [options.base] - override base URL
     * @returns {Promise<{ok:boolean,status:number,statusText:string,data:any,response:Response}>}
     */
    const request = async (path, options = {}) => {
        const { method = 'GET', body, timeout = 15000, headers: extraHeaders, base: baseOverride } = options;
        const base = baseOverride ?? await getInstanceUrl();
        if (!base) {
            throw new Error(translate('instance_not_configured'));
        }

        const headers = await getHeaders(extraHeaders);
        const controller = new AbortController();
        const timer = timeout > 0 ? setTimeout(() => controller.abort('timeout'), timeout) : null;

        try {
            const init = { method, headers, signal: controller.signal };
            if (body !== undefined) {
                init.body = typeof body === 'string' ? body : JSON.stringify(body);
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }

            const response = await fetch(`${base}${path}`, init);
            let data = null;
            try {
                data = await response.clone().json();
            } catch (_) {
                data = null;
            }

            return { ok: response.ok, status: response.status, statusText: response.statusText, data, response };
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    };

    root.YTPApi = { normalizeBase, getInstanceUrl, getAuthHeader, getHeaders, request };
})(typeof globalThis !== 'undefined' ? globalThis : window);