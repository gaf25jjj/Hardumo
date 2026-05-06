'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { parseVideoUrl } from '@/lib/video/parseVideoUrl';
import { PlaybackState } from '@/lib/video/types';
import { YouTubeAdapter } from '@/lib/video/YouTubeAdapter';
import { VkVideoAdapter } from '@/lib/video/VkVideoAdapter';
import { PlayerSyncController } from '@/lib/video/PlayerSyncController';

const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'https://hardumo.onrender.com';
const DISPLAY_NAME_KEY = 'hardumo_display_name';

type RoomMessage = {
  id: string;
  userId?: string;
  user: string;
  text: string;
  ts: number;
  system?: boolean;
};

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const search = useSearchParams();

  const initialVideo = search.get('video') ?? '';
  const [name, setName] = useState('');
  const [entryError, setEntryError] = useState('');
  const [joined, setJoined] = useState(false);
  const [videoInput, setVideoInput] = useState(initialVideo);
  const [users, setUsers] = useState<any[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [chatError, setChatError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [hostId, setHostId] = useState('');

  const [isHost, setIsHost] = useState(false);
  const [roleReady, setRoleReady] = useState(false);
  const [adapterEpoch, setAdapterEpoch] = useState(0);
  const [showGuestOverlay, setShowGuestOverlay] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState('Синхронизироваться и начать просмотр');
  const [syncStatus, setSyncStatus] = useState('Ожидание синхронизации');

  const socketRef = useRef<Socket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<any>(null);
  const syncRef = useRef<PlayerSyncController | null>(null);
  const lastHostSeekEmitAtRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const playerReadyRef = useRef(false);
  const userActivatedSyncRef = useRef(false);
  const pendingRemoteStateRef = useRef<PlaybackState | null>(null);
  const applyingRemoteStateRef = useRef(false);
  const lastServerStateRef = useRef<PlaybackState | null>(null);
  const isHostRef = useRef(false);
  const lastSeqRef = useRef(0);

  const video = useMemo(() => parseVideoUrl(videoInput), [videoInput]);
  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return videoInput
      ? `${window.location.origin}/room/${roomId}?video=${encodeURIComponent(videoInput)}`
      : `${window.location.origin}/room/${roomId}`;
  }, [roomId, videoInput]);

  useEffect(() => {
    const savedName = localStorage.getItem(DISPLAY_NAME_KEY);
    if (savedName) setName(savedName);
  }, []);

  useEffect(() => {
    if (!copyStatus) return;
    const timeout = setTimeout(() => setCopyStatus(''), 2200);
    return () => clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!joined || !video || !containerRef.current || !roleReady) return;
    playerReadyRef.current = false;
    pendingRemoteStateRef.current = null;
    lastSeqRef.current = 0;
    applyingRemoteStateRef.current = false;
    if (!isHostRef.current) setShowGuestOverlay(true);

    adapterRef.current?.destroy?.();
    const adapter = video.provider === 'youtube' ? new YouTubeAdapter({ isHost: isHostRef.current }) : new VkVideoAdapter();
    adapterRef.current = adapter;

    syncRef.current = new PlayerSyncController({
      roomId,
      adapter,
      isHostRef,
      playerReadyRef,
      userActivatedSyncRef,
      pendingRemoteStateRef,
      applyingRemoteStateRef,
      lastServerStateRef,
      lastSeqRef,
      setShowGuestOverlay,
      setSyncStatus,
    });

    adapter.onReady(() => {
      playerReadyRef.current = true;
      if (isHostRef.current) userActivatedSyncRef.current = true;
      syncRef.current?.applyPendingRemoteState();
    });

    adapter.onStateChange(async (state: any) => {
      if (applyingRemoteStateRef.current || !isHostRef.current) return;
      const t = await adapter.getCurrentTime();
      if (state === 'playing') socketRef.current?.emit('video:control', { roomId, type: 'play', position: t });
      if (state === 'paused' || state === 'ended') socketRef.current?.emit('video:control', { roomId, type: 'pause', position: t });
    });

    adapter.onAutoplayBlocked?.(() => {
      if (!isHostRef.current) {
        userActivatedSyncRef.current = false;
        setShowGuestOverlay(true);
        setOverlayMessage('Браузер заблокировал автозапуск. Нажмите, чтобы продолжить синхронный просмотр');
      }
    });

    adapter.load(containerRef.current, video);
    return () => adapter.destroy?.();
  }, [joined, roleReady, adapterEpoch, video?.provider, video?.videoId, video?.embedUrl, roomId]);

  useEffect(() => {
    if (!joined) return;
    setRoleReady(false);
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.emit('room:join', { roomId, name, provider: video?.provider, videoId: video?.videoId, embedUrl: video?.embedUrl });

    socket.on('room:state', (state) => {
      setUsers(state.users);
      setMessages(state.messages ?? []);
      setHostId(state.hostId ?? state.users?.[0]?.id ?? '');
      isHostRef.current = state.isHost;
      setIsHost(state.isHost);
      setRoleReady(true);
      if (state.isHost) {
        userActivatedSyncRef.current = true;
        setShowGuestOverlay(false);
      } else {
        userActivatedSyncRef.current = false;
        setShowGuestOverlay(true);
      }
      if (state.playback) syncRef.current?.queueOrApplyRemoteState(state.playback);
    });

    socket.on('presence:update', ({ users, hostId }) => {
      setUsers(users);
      setHostId(hostId);
      const host = hostId === socket.id;
      const prevHost = isHostRef.current;
      setIsHost(host);
      isHostRef.current = host;
      if (host !== prevHost) {
        if (host) {
          userActivatedSyncRef.current = true;
          setShowGuestOverlay(false);
        } else {
          userActivatedSyncRef.current = false;
          setShowGuestOverlay(true);
        }
        if (video?.provider === 'youtube') setAdapterEpoch((v) => v + 1);
      }
    });

    socket.on('chat:new', (m) => setMessages((p) => [...p, m]));
    socket.on('room:playback-state', (playback) => syncRef.current?.queueOrApplyRemoteState(playback));
    socket.on('room:sync-pulse', (playback) => {
      lastServerStateRef.current = playback;
    });
    socket.on('control:denied', () => setSyncStatus('Только создатель комнаты может управлять видео'));

    return () => {
      socket.off('room:state');
      socket.off('presence:update');
      socket.off('chat:new');
      socket.off('room:playback-state');
      socket.off('room:sync-pulse');
      socket.off('control:denied');
      socket.disconnect();
    };
  }, [joined, roomId, name, video?.provider, video?.videoId, video?.embedUrl]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (isHostRef.current || !playerReadyRef.current || !userActivatedSyncRef.current || !adapterRef.current) return;
      const state = lastServerStateRef.current;
      if (!state || !state.isPlaying) return;
      const target = syncRef.current?.getResolvedTargetTime(state) ?? state.position;
      const current = await adapterRef.current.getCurrentTime();
      const diff = target - current;
      if (Math.abs(diff) > 1.25) {
        applyingRemoteStateRef.current = true;
        await adapterRef.current.seekTo(target);
        setTimeout(() => {
          applyingRemoteStateRef.current = false;
        }, 700);
        return;
      }
      if (Math.abs(diff) > 0.35) {
        try {
          const rates = adapterRef.current.getAvailablePlaybackRates?.() || [1];
          if (diff > 0 && rates.includes(1.25)) {
            adapterRef.current.setPlaybackRate(1.25);
            setTimeout(() => adapterRef.current?.setPlaybackRate(1), 1500);
          }
          if (diff < 0 && rates.includes(0.75)) {
            adapterRef.current.setPlaybackRate(0.75);
            setTimeout(() => adapterRef.current?.setPlaybackRate(1), 1500);
          }
        } catch {
          // no-op
        }
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!isHostRef.current || !playerReadyRef.current || !adapterRef.current || applyingRemoteStateRef.current) return;
      const socket = socketRef.current;
      const serverState = lastServerStateRef.current;
      if (!socket || !serverState?.isPlaying) return;
      const current = await adapterRef.current.getCurrentTime();
      const expected = syncRef.current?.getResolvedTargetTime(serverState) ?? serverState.position;
      const diff = Math.abs(expected - current);
      if (diff <= 1.25) return;
      const now = Date.now();
      if (now - lastHostSeekEmitAtRef.current < 1000) return;
      lastHostSeekEmitAtRef.current = now;
      socket.emit('video:control', { roomId, type: 'seek', position: current });
    }, 700);

    return () => clearInterval(interval);
  }, [roomId]);

  const copyRoomCode = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopyStatus('Код комнаты скопирован');
  };

  const copyInviteLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopyStatus('Ссылка скопирована');
  };

  const shareInviteLink = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Hardumo Watch Party', text: `Присоединяйся к комнате ${roomId}`, url: inviteUrl });
      return;
    }
    await navigator.clipboard.writeText(inviteUrl);
    setCopyStatus('Ссылка скопирована');
  };

  const handleJoin = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEntryError('Введите имя, чтобы войти в комнату');
      return;
    }
    setName(trimmed);
    localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    setEntryError('');
    setJoined(true);
  };

  const sendMessage = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = messageText.trim();
    if (!trimmed) return;
    if (trimmed.length > 500) {
      setChatError('Сообщение не должно быть длиннее 500 символов');
      return;
    }
    socketRef.current?.emit('chat:send', { text: trimmed });
    setMessageText('');
    setChatError('');
  };

  const onMessageKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!joined) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="panel w-full max-w-md p-6 space-y-4">
          <h1 className="text-2xl font-semibold">Войти в комнату</h1>
          <p className="text-white/70">Комната: {roomId}</p>
          {search.get('video') ? <p className="text-xs text-white/60">Видео уже выбрано создателем комнаты</p> : null}
          <label className="text-sm text-white/80" htmlFor="display-name">Ваше имя</label>
          <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-black/30 px-3 py-2" />
          {entryError ? <p className="text-sm text-red-400">{entryError}</p> : null}
          <button onClick={handleJoin} className="w-full rounded bg-accent px-3 py-2 font-semibold">Войти</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 space-y-4">
          <div className="panel p-3 flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <input value={videoInput} disabled={!isHost} onChange={(e) => setVideoInput(e.target.value)} className="flex-1 w-full rounded bg-black/30 px-3 py-2" placeholder="Вставьте ссылку YouTube или VK Видео" />
            {isHost && video ? <button className="rounded bg-accent px-3 py-2" onClick={() => socketRef.current?.emit('room:update-video', { provider: video.provider, videoId: video.videoId, embedUrl: video.embedUrl })}>Обновить комнату</button> : null}
            <span className="text-xs text-white/70">{video?.provider === 'vk' ? 'VK Видео' : 'YouTube'}</span>
            <span className="text-xs text-white/70">{syncStatus}</span>
          </div>

          <div className="aspect-video bg-black rounded overflow-hidden relative">
            <div ref={containerRef} className="w-full h-full" />
            {showGuestOverlay && !isHost ? (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 px-4 text-center">
                <h3>{overlayMessage}</h3>
                <p className="text-sm text-white/80">Нажмите, чтобы начать синхронный просмотр</p>
                <button
                  className="rounded bg-accent px-4 py-2"
                  onClick={() => {
                    userActivatedSyncRef.current = true;
                    setShowGuestOverlay(false);
                    socketRef.current?.emit('room:request-playback-state', { roomId });
                    syncRef.current?.applyPendingRemoteState();
                  }}
                >
                  Начать просмотр
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel p-3 space-y-2 lg:hidden">
            <p className="text-sm text-white/70">Код комнаты: <span className="font-mono text-white">{roomId}</span></p>
            <div className="flex flex-wrap gap-2">
              <button className="rounded bg-white/15 px-3 py-2 text-sm" onClick={copyRoomCode}>Скопировать код</button>
              <button className="rounded bg-white/15 px-3 py-2 text-sm" onClick={copyInviteLink}>Скопировать ссылку</button>
              <button className="rounded bg-accent px-3 py-2 text-sm" onClick={shareInviteLink}>Поделиться</button>
            </div>
            {copyStatus ? <p className="text-xs text-green-300">{copyStatus}</p> : null}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="panel p-3 space-y-2 hidden lg:block">
            <p className="text-sm text-white/70">Код комнаты: <span className="font-mono text-white">{roomId}</span></p>
            <div className="flex flex-wrap gap-2">
              <button className="rounded bg-white/15 px-3 py-2 text-sm" onClick={copyRoomCode}>Скопировать код</button>
              <button className="rounded bg-white/15 px-3 py-2 text-sm" onClick={copyInviteLink}>Скопировать ссылку</button>
              <button className="rounded bg-accent px-3 py-2 text-sm" onClick={shareInviteLink}>Поделиться</button>
            </div>
            {copyStatus ? <p className="text-xs text-green-300">{copyStatus}</p> : null}
          </div>

          <div className="panel p-3">
            <h2 className="font-semibold">Чат</h2>
            <p className="text-sm text-white/70 mb-3">Участников: {users.length}</p>
            <div className="mb-3 rounded bg-black/20 p-2 space-y-1">
              {users.map((u) => (
                <div key={u.id} className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className="flex gap-1">
                    {u.id === socketRef.current?.id ? <span className="rounded bg-white/15 px-1.5 py-0.5">Вы</span> : null}
                    {u.id === hostId ? <span className="rounded bg-accent/80 px-1.5 py-0.5">Создатель</span> : null}
                  </span>
                </div>
              ))}
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {messages.map((m) => {
                if (m.system) {
                  return <div key={m.id} className="text-center text-xs text-white/50">{m.text}</div>;
                }
                const isMine = m.userId === socketRef.current?.id;
                return (
                  <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded px-2 py-1 text-sm ${isMine ? 'bg-accent/20' : 'bg-white/10'}`}>
                      <div className="text-xs text-white/60 flex gap-2"><span>{m.user}</span><span>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                      <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={sendMessage} className="mt-3 space-y-2">
              <textarea value={messageText} onChange={(e) => setMessageText(e.target.value.slice(0, 500))} onKeyDown={onMessageKeyDown} placeholder="Написать сообщение…" className="w-full rounded bg-black/30 px-2 py-2 min-h-20" />
              {chatError ? <p className="text-xs text-red-400">{chatError}</p> : null}
              <button className="w-full rounded bg-accent px-3 py-2">Отправить</button>
            </form>
          </div>
        </aside>
      </div>
    </main>
  );
}
