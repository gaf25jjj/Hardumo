export type VideoProvider = 'youtube' | 'vk';
export type NormalizedVideo = { provider: VideoProvider; videoId: string; embedUrl?: string; originalUrl: string };
export type ProviderState = 'playing' | 'paused' | 'buffering' | 'ended';
export interface VideoAdapter { provider: VideoProvider; load(container: HTMLElement, video: NormalizedVideo): Promise<void>; play(): Promise<void>|void; pause(): Promise<void>|void; seekTo(seconds:number): Promise<void>|void; getCurrentTime(): number|Promise<number>; setPlaybackRate?(rate:number): void; destroy?(): void; onReady(callback:()=>void): void; onStateChange(callback:(state:ProviderState)=>void): void; onAutoplayBlocked?(callback:()=>void): void; }
export type PlaybackState = { provider: VideoProvider; videoId: string; embedUrl?: string; isPlaying: boolean; position: number; updatedAt: number; seq: number };
