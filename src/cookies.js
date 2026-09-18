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
            // Chrome's getAll({ domain }) only matches exact domain.
            // Cookies set on ".bilibili.com" won't show up for "www.bilibili.com".
            // So we get ALL cookies and filter manually.
            const allCookies = await api.cookies.getAll({});
            return (allCookies || []).filter(c => domainMatches(c.domain, domain));
        } catch (err) {
            console.error('Cookie fetch error:', err);
            return [];
        }
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
        const cookies = await getCookiesForDomain(domain);
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
        getFormattedCookies,
        isValidNetscape,
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
