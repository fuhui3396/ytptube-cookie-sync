"""yt-dlp extractor plugin for RPlay (rplay.live).

Why this exists
---------------
RPlay play pages are an SPA whose real HLS/DASH manifest is requested at runtime,
and the page HTML advertises a ``canonical`` URL pointing at ``localhost``. Feeding
the page URL to yt-dlp's generic extractor therefore fails, and feeding a bare
manifest URL loses all metadata (so YTPTube's NFOMakerPP cannot create an NFO).

This extractor receives the real manifest URL from the browser extension through
``--extractor-args "rplay:manifest=<url-encoded>;type=hls|dash"``, fetches the page
for Open Graph / JSON-LD metadata, and returns a complete info dict (title,
description, thumbnail, upload_date, stable id) plus parsed formats.

Installation (YTPTube)
----------------------
Copy the ``yt_dlp_plugins`` folder next to this file into ``/config/yt-dlp`` so the
final path is ``/config/yt-dlp/yt_dlp_plugins/extractor/rplay.py``, then restart the
container. See https://github.com/yt-dlp/yt-dlp#plugins

Manual usage
------------
    yt-dlp --extractor-args "rplay:manifest=<url>" "https://rplay.live/play/<id>"
"""

import re
from urllib.parse import unquote

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError


class RPlayIE(InfoExtractor):
    IE_NAME = 'rplay'
    IE_DESC = 'rplay.live VOD/replay'
    _VALID_URL = r'https?://(?:www\.)?rplay\.live/play/(?P<id>[0-9a-zA-Z]+)'

    def _real_extract(self, url):
        video_id = self._match_id(url)

        manifest = (self._configuration_arg('manifest', [None]) or [None])[0]
        if not manifest:
            raise ExtractorError(
                'RPlay: missing manifest. Pass '
                '--extractor-args "rplay:manifest=<url>" '
                '(the browser extension adds this automatically).',
                expected=True,
            )
        manifest = unquote(manifest)

        manifest_type = (self._configuration_arg('type', [None]) or [None])[0]
        if manifest_type not in ('hls', 'dash'):
            manifest_type = 'dash' if re.search(r'\.mpd(?:$|\?)', manifest, re.I) else 'hls'

        webpage = self._download_webpage(
            url, video_id, fatal=False, note='Downloading RPlay page')

        title = None
        description = None
        thumbnail = None
        upload_date = None
        if webpage:
            title = (self._og_search_title(webpage, default=None)
                     or self._html_search_meta(('og:title', 'twitter:title'), webpage, default=None))
            description = (self._og_search_description(webpage, default=None)
                           or self._html_search_meta('description', webpage, default=None))
            thumbnail = self._og_search_thumbnail(webpage, default=None)
            match = re.search(r'"uploadDate"\s*:\s*"(\d{4})-(\d{2})-(\d{2})', webpage)
            if match:
                upload_date = ''.join(match.groups())

        if manifest_type == 'dash':
            formats = self._extract_mpd_formats(manifest, video_id, fatal=False)
        else:
            formats = self._extract_m3u8_formats(
                manifest, video_id, 'mp4', m3u8_id='rplay', fatal=False)

        if not formats:
            raise ExtractorError(
                'RPlay: could not parse the supplied manifest '
                '(the signed URL may have expired; play the video again).',
                expected=True,
            )

        return {
            'id': video_id,
            'title': title or video_id,
            'description': description,
            'thumbnail': thumbnail,
            'upload_date': upload_date,
            'formats': formats,
            'webpage_url': url,
        }