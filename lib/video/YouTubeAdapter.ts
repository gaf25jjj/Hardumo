import { NormalizedVideo, ProviderState, VideoAdapter } from './types';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YouTubeAdapterOptions = {
  isHost?: boolean;
  controlsEnabled?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class YouTubeAdapter implements VideoAdapter {
  provider = 'youtube' as const;

  private player: any;
  private readyCb: (() => void) | null = null;
  private stateCb: ((s: ProviderState) => void) | null = null;
  private autoplayBlockedCb: (() => void) | null = null;

  constructor(private options: YouTubeAdapterOptions = {}) {}

  async load(container: HTMLElement, video: NormalizedVideo) {
    await this.loadApi();

    const controlsEnabled = this.options.controlsEnabled ?? this.options.isHost ?? true;

    this.player = new window.YT.Player(container, {
      videoId: video.videoId,
      playerVars: {
        autoplay: 0,
        playsinline: 1,
        controls: controlsEnabled ? 1 : 0,
        disablekb: controlsEnabled ? 0 : 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          this.readyCb?.();
        },
        onStateChange: (e: any) => {
          const map: Record<number, ProviderState> = {
            1: 'playing',
            2: 'paused',
            3: 'buffering',
            0: 'ended',
          };

          this.stateCb?.(map[e.data] ?? 'paused');
        },
        onAutoplayBlocked: () => {
          this.autoplayBlockedCb?.();
        },
      },
    });
  }

  async play() {
    this.player?.playVideo();
    await sleep(120);
  }

  async pause() {
    this.player?.pauseVideo();
    await sleep(120);
  }

  async seekTo(seconds: number) {
    this.player?.seekTo(seconds, true);
    await sleep(150);
  }

  getCurrentTime() {
    return Number(this.player?.getCurrentTime?.() ?? 0);
  }

  setPlaybackRate(rate: number) {
    this.player?.setPlaybackRate?.(rate);
  }

  destroy() {
    this.player?.destroy?.();
  }

  onReady(cb: () => void) {
    this.readyCb = cb;
  }

  onStateChange(cb: (s: ProviderState) => void) {
    this.stateCb = cb;
  }

  onAutoplayBlocked(cb: () => void) {
    this.autoplayBlockedCb = cb;
  }

  private loadApi(): Promise<void> {
    return new Promise((resolve) => {
      if (window.YT?.Player) {
        resolve();
        return;
      }

      const existing = document.querySelector('script[data-youtube-iframe-api]');

      if (existing) {
        const waitForApi = () => {
          if (window.YT?.Player) {
            resolve();
            return;
          }

          setTimeout(waitForApi, 100);
        };

        waitForApi();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.dataset.youtubeIframeApi = '1';

      document.body.appendChild(script);

      window.onYouTubeIframeAPIReady = () => resolve();
    });
  }
}
