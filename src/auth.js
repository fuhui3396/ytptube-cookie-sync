// Shared authentication parsing and storage migration helpers.
(function (root) {
    const browserApi = root.chrome || root.browser;
    const encodeBase64Utf8 = value => {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        return btoa(binary);
    };

    const parse = value => {
        if (!value) {
            return { value: '', header: null };
        }
        if (value.startsWith('ytp_')) {
            return { value, header: `Bearer ${value}` };
        }

        const separator = value.indexOf(':');
        if (separator > 0) {
            return { value, header: `Basic ${encodeBase64Utf8(value)}` };
        }
        throw new Error((root.t || (key => key))('auth_parse_error'));
    };

    const getAuth = async () => {
        const local = await browserApi.storage.local.get('auth');
        if (local.auth) {
            return local.auth;
        }

        // Migrate any legacy value previously kept in sync storage.
        const legacy = await browserApi.storage.sync.get(['auth', 'username', 'password']);
        let value = '';
        if (legacy.auth) {
            value = legacy.auth;
        } else if (legacy.username && legacy.password) {
            value = `${legacy.username}:${legacy.password}`;
        }

        if (value) {
            await browserApi.storage.local.set({ auth: value });
            await browserApi.storage.sync.remove(['auth', 'username', 'password']);
        }
        return value;
    };

    const setAuth = async value => {
        if (value) {
            await browserApi.storage.local.set({ auth: value });
        } else {
            await browserApi.storage.local.remove('auth');
        }
        await browserApi.storage.sync.remove(['auth', 'username', 'password']);
    };

    const clearAuth = async () => {
        await browserApi.storage.local.remove('auth');
        await browserApi.storage.sync.remove(['auth', 'username', 'password']);
    };

    root.YTPAuth = { parse, getAuth, setAuth, clearAuth };
})(typeof globalThis !== 'undefined' ? globalThis : window);
