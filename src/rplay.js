// RPlay-specific helpers: detect real playable manifests and DRM.
// Mirrors the detection logic of the rplay-downloader extension so the real
// stream URL (not the SPA page URL) can be handed to YTPTube / yt-dlp.
// noinspection JSUnresolvedReference
(function (root) {
    const HOSTS = ['rplay.live', 'rplay-cdn.com'];

    const isRPlayUrl = value => {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return false;
            return HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
        } catch {
            return false;
        }
    };

    /**
     * Map a URL to a source type: 'hls' | 'dash' | 'cmaf' | null.
     * Only HLS/DASH manifests are worth sending to yt-dlp.
     */
    const getSourceType = value => {
        let url;
        try {
            url = new URL(value);
        } catch {
            return null;
        }
        if (!isRPlayUrl(value)) return null;
        if (/\.m3u8$/i.test(url.pathname)) return 'hls';
        // Dedicated RPlay API endpoint that returns an HLS manifest.
        if (url.pathname === '/content/hlsstream') return 'hls';
        if (/\.mpd$/i.test(url.pathname)) return 'dash';
        if (/\.cmfv$/i.test(url.pathname)) return 'cmaf';
        return null;
    };

    /** True only for the manifest kinds yt-dlp can use. */
    const getManifestSourceType = value => {
        const type = getSourceType(value);
        return type === 'hls' || type === 'dash' ? type : null;
    };

    /** RPlay marks DRM assets with a `/drm_` path segment. */
    const isDrmUrl = value => /\/(?:drm|drm_v2)_/i.test(String(value || ''));

    /**
     * Best-effort DRM detection from an HLS master/media playlist or DASH MPD.
     * @returns {string|null} a short reason when DRM is detected, else null
     */
    const detectDrm = text => {
        if (!text || typeof text !== 'string') return null;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!/^#EXT-X-(?:SESSION-)?KEY:/i.test(line)) continue;
            const method = (/METHOD=([^,]+)/i.exec(line) || [])[1] || '';
            const keyFormat = (/KEYFORMAT="?([^",]+)/i.exec(line) || [])[1] || '';
            if (method.toUpperCase() === 'NONE') continue;
            if (keyFormat && keyFormat !== 'identity') return 'hls-keyformat';
            if (/SAMPLE-AES/i.test(method)) return 'hls-sample-aes';
            if (method.toUpperCase() !== 'AES-128') return 'hls-key';
        }
        if (/<ContentProtection\b/i.test(text)
            && /(urn:uuid:edef8ba9|cenc:pssh|widevine)/i.test(text)) {
            return 'dash-contentprotection';
        }
        if (/com\.widevine\.alpha|Widevine/i.test(text)) return 'widevine';
        return null;
    };

    root.YTPRplay = { HOSTS, isRPlayUrl, getSourceType, getManifestSourceType, isDrmUrl, detectDrm };
})(typeof globalThis !== 'undefined' ? globalThis : window);