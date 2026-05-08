import { NormalizedVideo } from './types';

const VK_VIDEO_EMBED_BASE = 'https://vkvideo.ru/video_ext.php';

function buildVkEmbedUrl(oid: string, id: string, hash?: string) {
  const params = new URLSearchParams({
    oid,
    id,
    hd: '2',
    js_api: '1',
  });

  if (hash) params.set('hash', hash);

  return `${VK_VIDEO_EMBED_BASE}?${params.toString()}`;
}

export function parseVideoUrl(input: string): NormalizedVideo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return parseYouTube(trimmed) ?? parseVk(trimmed);
}

function parseYouTube(urlStr: string): NormalizedVideo | null {
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

function parseVk(urlStr: string): NormalizedVideo | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace(/^www\./, '');
    if (!['vk.com', 'm.vk.com', 'vkvideo.ru', 'm.vkvideo.ru'].includes(host)) return null;

    if (url.pathname.includes('video_ext.php')) {
      const oid = url.searchParams.get('oid');
      const id = url.searchParams.get('id');
      if (!oid || !id) return null;
      const hash = url.searchParams.get('hash') ?? '';
      const embedUrl = buildVkEmbedUrl(oid, id, hash || undefined);
      return { provider: 'vk', videoId: `${oid}_${id}`, embedUrl, originalUrl: urlStr };
    }

    const normalized = `${url.pathname}${url.search}`;
    const match = normalized.match(/(?:video|clip)(-?\d+)_(\d+)/);
    if (!match) return null;

    const oid = match[1];
    const id = match[2];
    const hash = url.searchParams.get('hash') ?? '';
    const embedUrl = buildVkEmbedUrl(oid, id, hash || undefined);

    return { provider: 'vk', videoId: `${oid}_${id}`, embedUrl, originalUrl: urlStr };
  } catch {
    return null;
  }
}
