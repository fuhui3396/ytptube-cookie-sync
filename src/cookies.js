// Shared cookie reading and Netscape format conversion helpers.
// noinspection JSUnresolvedReference
(function (root) {
    const api = root.chrome || root.browser;

    /**
     * Convert a single browser cookie to Netscape HTTP Cookie File format line.
     *
     * Netscape format: domain  flag  path  secure  expiration  name  value
     *   - domain: cookie domain
     *   - flag: TRUE if domain starts with '.' (applies to all subdomains), FALSE otherwise
     *   - path: cookie path
     *   - secure: TRUE if Secure flag is set, FALSE otherwise
     *   - expiration: Unix timestamp of expiry (0 for session cookies)
     *   - name: cookie name
     *   - value: cookie value
     */
    const cookieToNetscape = (cookie) => {
        const domain = cookie.domain;
        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const path = cookie.path || '/';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
        const name = cookie.name;
        const value = cookie.value || '';
        return `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`;
    };

    /**
     * Convert an array of browser cookies to Netscape HTTP Cookie File format string.
     * @param {Array} cookies - Array of browser cookie objects
     * @param {string} [header] - Optional header comment (default: "# Netscape HTTP Cookie File")
     * @returns {string} Netscape format cookie file content
     */
    const toNetscapeFormat = (cookies, header) => {
        if (!Array.isArray(cookies) || cookies.length === 0) {
            return '';
        }
        const lines = [header || '# Netscape HTTP Cookie File'];
        for (const cookie of cookies) {
            lines.push(cookieToNetscape(cookie));
        }
        return lines.join('\n');
    };

    /**
     * Extract domain from a URL string.
     * @param {string} url
     * @returns {string|null} hostname or null if invalid
     */
    const extractDomain = (url) => {
        try {
            return new URL(url).hostname;
        } catch {
            return null;
        }
    };

    /**
     * Get all cookies for a given domain (including subdomains).
     * @param {string} domain - The domain to fetch cookies for
     * @returns {Promise<Array>} Array of cookie objects
     */
    /**
     * Check if a cookie belongs to the given domain.
     * A cookie on ".bilibili.com" matches "www.bilibili.com".
     * A cookie on "www.bilibili.com" matches "www.bilibili.com".
     */
    const domainMatches = (cookieDomain, targetDomain) => {
        if (!cookieDomain || !targetDomain) return false;
        const cd = cookieDomain.toLowerCase();
        const td = targetDomain.toLowerCase();
        if (cd === td) return true;
        // ".bilibili.com" matches "www.bilibili.com"
        if (cd.startsWith('.')) {
            return td.endsWith(cd) || td === cd.substring(1);
        }
        return false;
    };

    const getCookiesForDomain = async (domain) => {
        if (!domain) return [];
        try {
            // `domain` matches the exact domain and its subdomains, and avoids
            // reading the browser's entire cookie store.
            const cookies = await api.cookies.getAll({ domain });
            return cookies || [];
        } catch (err) {
            console.error('Cookie fetch error:', err);
            return [];
        }
    };

    /**
     * Get all cookies that apply to a specific URL.
     * @param {string} url
     * @returns {Promise<Array>}
     */
    const getCookiesForUrl = async (url) => {
        if (!url) return [];
        try {
            return (await api.cookies.getAll({ url })) || [];
        } catch (err) {
            console.error('Cookie fetch error:', err);
            return [];
        }
    };

    /**
     * Parse a Netscape HTTP Cookie File string into cookie-like objects.
     * @param {string} text
     * @returns {Array<{domain:string,flag:boolean,path:string,secure:boolean,expiration:number,name:string,value:string}>}
     */
    const parseNetscape = (text) => {
        if (!text || typeof text !== 'string') return [];
        const cookies = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const parts = line.split('\t');
            if (parts.length < 7) continue;
            cookies.push({
                domain: parts[0],
                flag: parts[1].toUpperCase() === 'TRUE',
                path: parts[2],
                secure: parts[3].toUpperCase() === 'TRUE',
                expiration: Number(parts[4]) || 0,
                name: parts[5],
                value: parts.slice(6).join('\t'),
            });
        }
        return cookies;
    };

    /**
     * Get all cookies for the given URL and return them in Netscape format.
     * @param {string} url - The URL to get cookies for
     * @returns {Promise<{domain: string, cookies: Array, netscape: string}>}
     */
    const getFormattedCookies = async (url) => {
        const domain = extractDomain(url);
        if (!domain) {
            return { domain: null, cookies: [], netscape: '' };
        }
        const cookies = await getCookiesForUrl(url);
        const netscape = toNetscapeFormat(cookies);
        return { domain, cookies, netscape };
    };

    /**
     * Validate a Netscape cookie string by checking it has the expected format.
     * @param {string} text - Netscape format cookie text
     * @returns {boolean} true if format looks valid
     */
    const isValidNetscape = (text) => {
        if (!text || typeof text !== 'string') return false;
        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        return lines.every(line => {
            const parts = line.split('\t');
            return parts.length >= 7;
        });
    };

    root.YTPCookies = {
        cookieToNetscape,
        toNetscapeFormat,
        extractDomain,
        getCookiesForDomain,
        getCookiesForUrl,
        parseNetscape,
        getFormattedCookies,
        isValidNetscape,
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
