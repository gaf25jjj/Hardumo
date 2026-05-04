export type VideoSource = 'youtube' | 'vk' | 'direct';

export type ParsedVideo = {
  source: VideoSource;
  videoId: string;
  watchUrl: string;
  embedUrl: string;
};

const VK_EMBED_BASE = 'https://vk.com/video_ext.php';

export function parseVideoInput(input: string): ParsedVideo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const youtube = parseYouTube(trimmed);
  if (youtube) return youtube;

  const vk = parseVk(trimmed);
  if (vk) return vk;

  const direct = parseDirect(trimmed);
  if (direct) return direct;

  return null;
}

function parseYouTube(input: string): ParsedVideo | null {
  try {
    const url = new URL(input);
    let videoId: string | null = null;

    if (url.hostname.includes('youtu.be')) {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (url.hostname.includes('youtube.com')) {
      videoId = url.searchParams.get('v');
      if (!videoId) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'embed' && parts[1]) videoId = parts[1];
        if (parts[0] === 'shorts' && parts[1]) videoId = parts[1];
      }
    }

    if (!videoId) return null;

    return {
      source: 'youtube',
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/watch?v=${videoId}`
    };
  } catch {
    return null;
  }
}

function parseVk(input: string): ParsedVideo | null {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '');
    if (!['vk.com', 'vkvideo.ru'].includes(host)) return null;

    if (url.pathname.includes('video_ext.php')) {
      const oid = url.searchParams.get('oid');
      const id = url.searchParams.get('id');
      const hash = url.searchParams.get('hash');
      if (!oid || !id || !hash) return null;
      const embedUrl = `${VK_EMBED_BASE}?oid=${encodeURIComponent(oid)}&id=${encodeURIComponent(id)}&hash=${encodeURIComponent(hash)}`;
      return { source: 'vk', videoId: `${oid}_${id}`, watchUrl: input, embedUrl };
    }

    const normalized = `${url.pathname}${url.search}`;
    const match = normalized.match(/video(-?\d+)_([\d]+)/);
    if (!match) return null;

    const oid = match[1];
    const id = match[2];
    const hash = url.searchParams.get('hash') ?? '';
    const embedUrl = hash
      ? `${VK_EMBED_BASE}?oid=${encodeURIComponent(oid)}&id=${encodeURIComponent(id)}&hash=${encodeURIComponent(hash)}`
      : `${VK_EMBED_BASE}?oid=${encodeURIComponent(oid)}&id=${encodeURIComponent(id)}`;

    return { source: 'vk', videoId: `${oid}_${id}`, watchUrl: input, embedUrl };
  } catch {
    return null;
  }
}

function parseDirect(input: string): ParsedVideo | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const path = url.pathname.toLowerCase();
    if (!path.endsWith('.mp4') && !path.endsWith('.m3u8')) return null;
    return {
      source: 'direct',
      videoId: url.href,
      watchUrl: url.href,
      embedUrl: url.href
    };
  } catch {
    return null;
  }
}
