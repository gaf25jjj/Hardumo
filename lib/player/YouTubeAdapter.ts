import { ProviderState, VideoAdapter } from './types';

declare global { interface Window { YT: any; onYouTubeIframeAPIReady?: () => void; } }

export class YouTubeAdapter implements VideoAdapter {
  provider = 'youtube' as const;
  private player: any;
  private readyCb: (() => void) | null = null;
  private stateCb: ((s: ProviderState) => void) | null = null;
  private autoplayBlockedCb: (() => void) | null = null;

  async load(container: HTMLElement, videoId: string) {
    await this.loadApi();
    this.player = new window.YT.Player(container, {
      videoId,
      playerVars: { autoplay: 0, playsinline: 1 },
      events: {
        onReady: () => this.readyCb?.(),
        onStateChange: (e: any) => {
          const m: Record<number, ProviderState> = { 1: 'playing', 2: 'paused', 3: 'buffering', 0: 'ended' };
          this.stateCb?.(m[e.data] ?? 'paused');
        },
        onAutoplayBlocked: () => this.autoplayBlockedCb?.()
      }
    });
  }
  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seekTo(seconds: number) { this.player?.seekTo(seconds, true); }
  getCurrentTime() { return Number(this.player?.getCurrentTime?.() ?? 0); }
  setPlaybackRate(rate: number) { this.player?.setPlaybackRate?.(rate); }
  destroy() { this.player?.destroy?.(); }
  onReady(cb: () => void) { this.readyCb = cb; }
  onStateChange(cb: (s: ProviderState) => void) { this.stateCb = cb; }
  onAutoplayBlocked(cb: () => void) { this.autoplayBlockedCb = cb; }

  private loadApi(): Promise<void> {
    return new Promise((resolve) => {
      if (window.YT?.Player) return resolve();
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
      window.onYouTubeIframeAPIReady = () => resolve();
    });
  }
}
