import { ProviderState, VideoAdapter } from './types';

export class VkVideoAdapter implements VideoAdapter {
  provider = 'vk' as const;
  private iframe: HTMLIFrameElement | null = null;
  private readyCb: (() => void) | null = null;
  private stateCb: ((s: ProviderState) => void) | null = null;
  private autoplayBlockedCb: (() => void) | null = null;
  private fallbackMode = true;

  async load(container: HTMLElement, embedUrl: string) {
    console.log('VK iframe created', embedUrl);
    container.innerHTML = '';
    this.iframe = document.createElement('iframe');
    this.iframe.src = embedUrl;
    this.iframe.allow = 'autoplay; fullscreen';
    this.iframe.className = 'w-full h-full border-0';
    container.appendChild(this.iframe);
    setTimeout(() => { console.log('VK adapter ready'); this.readyCb?.(); }, 100);
    console.warn('VK sync fallback mode enabled');
  }
  play() { console.warn('VK play command failed'); }
  pause() { console.warn('VK pause command failed'); }
  seekTo(_seconds: number) { console.warn('VK seek command failed'); }
  getCurrentTime() { return 0; }
  onReady(cb: () => void) { this.readyCb = cb; }
  onStateChange(cb: (s: ProviderState) => void) { this.stateCb = cb; }
  onAutoplayBlocked(cb: () => void) { this.autoplayBlockedCb = cb; }
  isFallback() { return this.fallbackMode; }
}
