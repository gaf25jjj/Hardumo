import { PlaybackState, VideoAdapter } from './types';

const HARD_SEEK_THRESHOLD_SECONDS = 1.5;
const SOFT_STATE_THROTTLE_MS = 1200;
const APPLYING_REMOTE_GUARD_MS = 900;

type Opts = {
  roomId: string;
  adapter: VideoAdapter;
  isHostRef: { current: boolean };
  playerReadyRef: { current: boolean };
  userActivatedSyncRef: { current: boolean };
  pendingRemoteStateRef: { current: PlaybackState | null };
  applyingRemoteStateRef: { current: boolean };
  lastServerStateRef: { current: PlaybackState | null };
  lastSeqRef: { current: number };
  setShowGuestOverlay: (v: boolean) => void;
  setSyncStatus: (v: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PlayerSyncController {
  private lastAppliedKey = '';
  private lastApplyAt = 0;

  constructor(private o: Opts) {}

  getResolvedTargetTime(state: PlaybackState) {
    if (!state.isPlaying) return state.position;
    return state.position + (Date.now() - state.updatedAt) / 1000;
  }

  queueOrApplyRemoteState = (state: PlaybackState) => {
    this.o.lastServerStateRef.current = state;

    if (this.o.isHostRef.current) return;

    const videoKey = `${state.provider}:${state.videoId}`;
    const lastState = this.o.lastServerStateRef.current;
    const lastKey = lastState ? `${lastState.provider}:${lastState.videoId}` : videoKey;
    const seq = typeof state.seq === 'number' ? state.seq : 0;

    if (videoKey === lastKey && seq < this.o.lastSeqRef.current) return;
    if (seq > this.o.lastSeqRef.current || videoKey !== lastKey) this.o.lastSeqRef.current = seq;

    if (!this.o.playerReadyRef.current) {
      this.o.pendingRemoteStateRef.current = state;
      console.log('[SYNC] queued remote state because player is not ready', state);
      return;
    }

    if (!this.o.userActivatedSyncRef.current) {
      this.o.pendingRemoteStateRef.current = state;
      this.o.setShowGuestOverlay(true);
      console.log('[SYNC] queued remote state because guest has not activated sync', state);
      return;
    }

    void this.applyRemoteState(state);
  };

  applyPendingRemoteState = () => {
    const s = this.o.pendingRemoteStateRef.current;
    if (!s) return;
    this.o.pendingRemoteStateRef.current = null;
    this.queueOrApplyRemoteState(s);
  };

  applyRemoteState = async (state: PlaybackState) => {
    if (this.o.isHostRef.current) return;
    if (!this.o.playerReadyRef.current || !this.o.userActivatedSyncRef.current) {
      this.o.pendingRemoteStateRef.current = state;
      return;
    }

    const now = Date.now();
    const stateKey = `${state.provider}:${state.videoId}:${state.seq}:${state.isPlaying}:${Math.floor(state.position)}`;
    if (stateKey === this.lastAppliedKey && now - this.lastApplyAt < SOFT_STATE_THROTTLE_MS) return;
    this.lastAppliedKey = stateKey;
    this.lastApplyAt = now;

    const target = this.getResolvedTargetTime(state);
    console.log('[SYNC] applying remote state', { targetTime: target, isPlaying: state.isPlaying, seq: state.seq });

    this.o.applyingRemoteStateRef.current = true;
    try {
      const currentTime = await this.o.adapter.getCurrentTime();
      const diff = Math.abs(currentTime - target);

      if (diff > HARD_SEEK_THRESHOLD_SECONDS) {
        await this.o.adapter.seekTo(Math.max(0, target));
        await sleep(120);
      }

      if (state.isPlaying) {
        await this.o.adapter.play();
      } else {
        await this.o.adapter.pause();
      }

      this.o.setSyncStatus('Синхронизировано');
    } catch (err) {
      console.error('[SYNC] failed to apply remote state', err);
      this.o.setSyncStatus('Ошибка синхронизации');
    }

    setTimeout(() => {
      this.o.applyingRemoteStateRef.current = false;
    }, APPLYING_REMOTE_GUARD_MS);
  };
}
