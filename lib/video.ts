export type VideoProvider = 'youtube' | 'vk';

export type ParsedVideoUrl = {
  provider: VideoProvider;
  videoId: string;
  embedUrl?: string;
  originalUrl: string;
};

const VK_EMBED_BASE = 'https://vk.com/video_ext.php';

export function parseVideoUrl(input: string): ParsedVideoUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const youtube = parseYouTube(trimmed);
  if (youtube) return youtube;

  const vk = parseVk(trimmed);
  if (vk) return vk;

  return null;
}

function parseYouTube(urlStr: string): ParsedVideoUrl | null {
  try {
    const url = new URL(urlStr);
    let videoId: string | null = null;
    if (url.hostname.includes('youtu.be')) videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (url.hostname.includes('youtube.com')) {
      videoId = url.searchParams.get('v');
      if (!videoId) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'embed' && parts[1]) videoId = parts[1];
      }
    }
    if (!videoId) return null;
    return { provider: 'youtube', videoId, originalUrl: urlStr };
  } catch {
    return null;
  }
}

function parseVk(urlStr: string): ParsedVideoUrl | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace(/^www\./, '');
    if (!['vk.com', 'vkvideo.ru'].includes(host)) return null;
    if (url.pathname.includes('video_ext.php') || url.pathname.includes('/video_ext.php')) {
      const oid = url.searchParams.get('oid');
      const id = url.searchParams.get('id');
      if (!oid || !id) return null;
      const hash = url.searchParams.get('hash') ?? '';
      const embedUrl = hash ? `${VK_EMBED_BASE}?oid=${oid}&id=${id}&hash=${hash}` : `${VK_EMBED_BASE}?oid=${oid}&id=${id}`;
      return { provider: 'vk', videoId: `${oid}_${id}`, embedUrl, originalUrl: urlStr };
    }
    const normalized = `${url.pathname}${url.search}`;
    const match = normalized.match(/(?:video|clip)(-?\d+)_([\d]+)/);
    if (!match) return null;
    const oid = match[1];
    const id = match[2];
    const hash = url.searchParams.get('hash') ?? '';
    const embedUrl = hash ? `${VK_EMBED_BASE}?oid=${oid}&id=${id}&hash=${hash}` : `${VK_EMBED_BASE}?oid=${oid}&id=${id}`;
    console.log('parsed VK video URL', { url: urlStr, embedUrl });
    return { provider: 'vk', videoId: `${oid}_${id}`, embedUrl, originalUrl: urlStr };
  } catch {
    return null;
  }
}
