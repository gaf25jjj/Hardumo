import { NormalizedVideo, ProviderState, VideoAdapter } from './types';

declare global {
  interface Window {
    VK?: any;
  }
}

export class VkVideoAdapter implements VideoAdapter {
  provider = 'vk' as const;

  private iframe: HTMLIFrameElement | null = null;
  private player: any = null;
  private fallbackMode = false;
  private readyCb: (() => void) | null = null;
  private stateCb: ((s: ProviderState) => void) | null = null;
  private autoplayBlockedCb: (() => void) | null = null;

  private lastKnownTime = 0;
  private lastKnownDuration = 0;
  private syntheticPlaying = false;
  private syntheticStartedAt = 0;
  private syntheticBaseTime = 0;
  private hasNativeTimeApi = false;
  private hasNativeControlApi = false;
  private hasNativeEvents = false;

  async load(container: HTMLElement, video: NormalizedVideo) {
    container.innerHTML = '';
    this.iframe = document.createElement('iframe');
    this.iframe.src = video.embedUrl ?? video.originalUrl;
    this.iframe.allow = 'autoplay; fullscreen';
    this.iframe.className = 'w-full h-full border-0';
    container.appendChild(this.iframe);

    await this.loadApi();

    if (window.VK?.VideoPlayer) {
      try {
        this.player = window.VK.VideoPlayer(this.iframe);
        console.log('[VK] VideoPlayer created');
      } catch (err) {
        console.error('[VK] failed to create VideoPlayer', err);
        this.enableFallback();
      }
    } else {
      this.enableFallback();
    }

    console.log('[VK] player object', this.player);
    console.log('[VK] available keys', Object.keys(this.player ?? {}));
    this.detectCapabilities();
    this.bindVkEvents();

    if (!this.hasNativeEvents || !this.hasNativeTimeApi) {
      this.enableFallback();
    }

    this.readyCb?.();
  }

  private async loadApi() {
    await new Promise<void>((resolve) => {
      const ex = document.querySelector('script[data-vk-video-api]') as HTMLScriptElement | null;
      if (ex) return resolve();
      const s = document.createElement('script');
      s.src = 'https://vk.com/js/api/videoplayer.js';
      s.dataset.vkVideoApi = '1';
      s.onload = () => {
        console.log('[VK] API script loaded');
        resolve();
      };
      s.onerror = () => resolve();
      document.body.appendChild(s);
    });
  }

  private enableFallback() {
    this.fallbackMode = true;
    console.warn('[VK] fallback synthetic clock enabled');
  }

  private detectCapabilities() {
    this.hasNativeControlApi = this.hasAnyMethod(['play']) && this.hasAnyMethod(['pause']) && this.hasAnyMethod(['seek', 'seekTo', 'setCurrentTime']);
    this.hasNativeTimeApi = this.hasAnyMethod(['getCurrentTime', 'getTime', 'currentTime', 'getPosition']);
    console.log('[VK] native control available', this.hasNativeControlApi);
    console.log('[VK] native time available', this.hasNativeTimeApi);
  }

  private hasAnyMethod(methodNames: string[]) {
    return methodNames.some((name) => typeof this.player?.[name] === 'function');
  }

  private bindVkEvents() {
    if (!this.player || typeof this.player.on !== 'function') {
      console.warn('[VK] player.on is not available');
      console.log('[VK] native events available', false);
      return;
    }

    this.hasNativeEvents = true;
    console.log('[VK] native events available', true);

    const on = (eventName: string, handler: (...args: any[]) => void) => {
      try {
        this.player.on(eventName, handler);
        console.log('[VK] subscribed event', eventName);
      } catch (err) {
        console.warn('[VK] failed to subscribe event', eventName, err);
      }
    };

    ['started', 'resumed', 'play', 'playing'].forEach((event) => {
      on(event, () => {
        console.log('[VK] playing event', event);
        this.syntheticPlaying = true;
        this.syntheticBaseTime = this.lastKnownTime;
        this.syntheticStartedAt = Date.now();
        this.stateCb?.('playing');
      });
    });

    ['paused', 'pause'].forEach((event) => {
      on(event, () => {
        console.log('[VK] paused event', event);
        this.lastKnownTime = this.getCurrentTimeSync();
        this.syntheticPlaying = false;
        this.syntheticBaseTime = this.lastKnownTime;
        this.stateCb?.('paused');
      });
    });

    ['ended', 'finish'].forEach((event) => {
      on(event, () => {
        console.log('[VK] ended event', event);
        this.syntheticPlaying = false;
        this.stateCb?.('ended');
      });
    });

    ['timeupdate', 'progress', 'seek', 'seeked'].forEach((event) => {
      on(event, (payload: any) => {
        console.log('[VK] time event', event, payload);
        const t = this.extractTimeFromPayload(payload);
        if (Number.isFinite(t)) {
          this.lastKnownTime = t;
          this.syntheticBaseTime = t;
          if (this.syntheticPlaying) this.syntheticStartedAt = Date.now();
        }
      });
    });

    ['autoplaySoundProhibited', 'autoplayBlocked'].forEach((event) => {
      on(event, () => {
        console.warn('[VK] autoplay blocked event', event);
        this.autoplayBlockedCb?.();
      });
    });

    on('error', (err: any) => {
      console.error('[VK] player error', err);
    });
  }

  private extractTimeFromPayload(payload: any): number {
    if (typeof payload === 'number') return payload;
    if (payload && typeof payload.time === 'number') return payload.time;
    if (payload && typeof payload.currentTime === 'number') return payload.currentTime;
    if (payload && typeof payload.position === 'number') return payload.position;
    return Number.NaN;
  }

  private callFirstAvailable(methodNames: string[], ...args: any[]) {
    for (const name of methodNames) {
      const fn = this.player?.[name];
      if (typeof fn === 'function') {
        try {
          return fn.apply(this.player, args);
        } catch (err) {
          console.warn('[VK] method failed', name, err);
        }
      }
    }
    return undefined;
  }

  private async readNativeTime() {
    const result = this.callFirstAvailable(['getCurrentTime', 'getTime', 'currentTime', 'getPosition']);
    if (typeof result === 'number' && Number.isFinite(result)) return result;
    if (result && typeof result.then === 'function') {
      const awaited = await result;
      if (typeof awaited === 'number' && Number.isFinite(awaited)) return awaited;
    }
    return Number.NaN;
  }

  private getCurrentTimeSync() {
    return this.getSyntheticTime();
  }

  private getSyntheticTime() {
    if (!this.syntheticPlaying) return this.syntheticBaseTime;
    return this.syntheticBaseTime + (Date.now() - this.syntheticStartedAt) / 1000;
  }

  async play() {
    await this.callFirstAvailable(['play']);
    const base = this.lastKnownTime || this.getSyntheticTime();
    this.syntheticPlaying = true;
    this.syntheticBaseTime = base;
    this.syntheticStartedAt = Date.now();
    this.stateCb?.('playing');
  }

  async pause() {
    this.lastKnownTime = this.getSyntheticTime();
    await this.callFirstAvailable(['pause']);
    this.syntheticPlaying = false;
    this.syntheticBaseTime = this.lastKnownTime;
    this.stateCb?.('paused');
  }

  async seekTo(seconds: number) {
    await this.callFirstAvailable(['seek', 'seekTo', 'setCurrentTime'], seconds);
    this.lastKnownTime = seconds;
    this.syntheticBaseTime = seconds;
    this.syntheticStartedAt = Date.now();
  }

  async getCurrentTime() {
    const native = await this.readNativeTime();
    if (Number.isFinite(native)) {
      this.lastKnownTime = native;
      this.syntheticBaseTime = native;
      if (this.syntheticPlaying) this.syntheticStartedAt = Date.now();
      return native;
    }
    return this.getSyntheticTime();
  }

  onReady(callback: () => void) { this.readyCb = callback; }
  onStateChange(callback: (state: ProviderState) => void) { this.stateCb = callback; }
  onAutoplayBlocked(callback: () => void) { this.autoplayBlockedCb = callback; }

  isFallback() { return this.fallbackMode; }
  isPlaying() { return this.syntheticPlaying; }
  hasNativeControls() { return this.hasNativeControlApi; }
  hasNativeEventsApi() { return this.hasNativeEvents; }
  hasNativeTime() { return this.hasNativeTimeApi; }
  getDebugState() {
    return {
      fallbackMode: this.fallbackMode,
      syntheticPlaying: this.syntheticPlaying,
      lastKnownTime: this.lastKnownTime,
      lastKnownDuration: this.lastKnownDuration,
      hasNativeTimeApi: this.hasNativeTimeApi,
      hasNativeControlApi: this.hasNativeControlApi,
      hasNativeEvents: this.hasNativeEvents,
      syntheticTime: this.getSyntheticTime(),
    };
  }

  destroy() {
    this.iframe?.remove();
    this.player = null;
  }
}
