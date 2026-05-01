'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import ReactPlayer from 'react-player/youtube';
import { io, Socket } from 'socket.io-client';
import { parseVideoInput } from '@/lib/video';

type ChatMessage = { id: string; user: string; text: string; ts: number; system?: boolean };
type PresenceUser = { id: string; name: string };
type PlaybackState = { time: number; isPlaying: boolean; updatedAt: number };
type PresenceState = { users: PresenceUser[]; hostId: string | null };

const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'https://hardumo.onrender.com';

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const roomId = params.roomId;

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [videoInput, setVideoInput] = useState(search.get('video') ?? '');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [pendingPlayback, setPendingPlayback] = useState<PlaybackState | null>(null);
  const [vkTime, setVkTime] = useState(0);
  const [vkPlaying, setVkPlaying] = useState(false);
  const playerRef = useRef<ReactPlayer>(null);
  const socketRef = useRef<Socket | null>(null);
  const isRemoteSync = useRef(false);
  const latestVideoInputRef = useRef(videoInput);
  const vkPlayingRef = useRef(vkPlaying);
  const isHostRef = useRef(isHost);

  const video = useMemo(() => parseVideoInput(videoInput), [videoInput]);

  useEffect(() => {
    latestVideoInputRef.current = videoInput;
  }, [videoInput]);

  useEffect(() => {
    vkPlayingRef.current = vkPlaying;
  }, [vkPlaying]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (!joined) return;
    const socket = io(SERVER_URL, {
      transports: ['polling', 'websocket']
    });
    socketRef.current = socket;

    socket.emit('join-room', roomId, name);
    socket.emit('room:join', { roomId, name, videoUrl: latestVideoInputRef.current });

    socket.on('room:state', ({ videoUrl, users, messages, playback, hostId }: { videoUrl: string; users: PresenceUser[]; messages: ChatMessage[]; playback: PlaybackState; hostId: string | null }) => {
      if (videoUrl) setVideoInput(videoUrl);
      setUsers(users);
      setMessages(messages);
      const amHost = users.some((u) => u.id === socket.id) && users.find((u) => u.id === socket.id)?.id === hostId;
      setIsHost(Boolean(amHost));
      setNeedsInteraction(!amHost);
      if (playback) {
        setPendingPlayback(playback);
      }
    });

    socket.on('presence:update', ({ users, hostId }: PresenceState) => {
      setUsers(users);
      const amHost = hostId === socket.id;
      setIsHost(amHost);
      if (amHost) {
        setNeedsInteraction(false);
      }
    });
    socket.on('chat:new', (msg) => setMessages((prev) => [...prev, msg]));

    socket.on('video:play', ({ time, videoUrl }) => {
      if (!isHostRef.current) return;
      isRemoteSync.current = true;
      if (videoUrl) setVideoInput(videoUrl);
      syncToTime(time, true);
    });

    socket.on('video:pause', ({ time, videoUrl }) => {
      if (isHostRef.current) return;
      isRemoteSync.current = true;
      if (videoUrl) setVideoInput(videoUrl);
      syncToTime(time, false);
    });

    socket.on('video:seek', ({ time }) => {
      if (isHostRef.current) return;
      isRemoteSync.current = true;
      syncToTime(time, vkPlayingRef.current);
    });
    socket.on('room:playback-state', (playback: PlaybackState) => {
      setPendingPlayback(playback);
    });

    return () => {
      socket.disconnect();
    };
  }, [joined, name, roomId]);

  useEffect(() => {
    if (!playerReady || isHost || !pendingPlayback) return;
    isRemoteSync.current = true;
    syncToTime(pendingPlayback.time, pendingPlayback.isPlaying);
    setPendingPlayback(null);
  }, [pendingPlayback, playerReady, isHost]);

  const syncToTime = (seconds: number, shouldPlay: boolean) => {
    if (video?.source === 'youtube') {
      playerRef.current?.seekTo(seconds, 'seconds');
      return;
    }
    // VK iframe has no direct JS API in this app, so we keep a synced timeline state.
    setVkTime(seconds);
    setVkPlaying(shouldPlay);
  };

  const emitSync = (event: 'video:play' | 'video:pause', seconds: number) => {
    if (!isHost) return;
    if (isRemoteSync.current) {
      isRemoteSync.current = false;
      return;
    }
    socketRef.current?.emit(event, { roomId, time: seconds, videoUrl: latestVideoInputRef.current });
  };

  const activateGuestSync = () => {
    setNeedsInteraction(false);
    socketRef.current?.emit('room:request-playback-state');
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    socketRef.current?.emit('chat:send', { roomId, text: chatInput });
    setChatInput('');
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
  };

  const vkEmbedUrl = useMemo(() => {
    if (!video || video.source !== 'vk') return '';
    const u = new URL(video.embedUrl);
    if (vkTime > 0) u.searchParams.set('t', String(Math.floor(vkTime)));
    u.searchParams.set('autoplay', vkPlaying ? '1' : '0');
    return u.toString();
  }, [video, vkTime, vkPlaying]);

  const handleVkSeek = (seconds: number) => {
    setVkTime(seconds);
    if (!isHostRef.current) return;
    if (isRemoteSync.current) {
      isRemoteSync.current = false;
      return;
    }
    socketRef.current?.emit('video:seek', { roomId, time: seconds });
  };

  if (!joined) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="panel p-6 w-full max-w-md space-y-4">
          <h2 className="text-2xl font-bold">Присоединиться к комнате {roomId}</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-black/30 border border-white/20 px-3 py-2" placeholder="Введите имя" />
          <button onClick={() => name.trim() && setJoined(true)} className="w-full rounded bg-accent py-2 font-semibold">Войти в комнату</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-black to-slate-900">
      <div className="max-w-7xl mx-auto grid gap-4 md:grid-cols-[1fr_360px]">
        <section className="panel p-3 md:p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-sm">Комната: <span className="font-bold">{roomId}</span></p>
            <button onClick={copyInvite} className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20">Скопировать ссылку</button>
          </div>
          <p className="text-xs text-white/70">Источник: <span className="uppercase font-semibold">{video?.source ?? 'нет'}</span></p>
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            <div className="relative h-full">
              {video?.source === 'youtube' ? (
                <ReactPlayer
                  ref={playerRef}
                  url={video.embedUrl}
                  controls
                  width="100%"
                  height="100%"
                  onReady={() => setPlayerReady(true)}
                  onError={() => setError('Не удалось загрузить это YouTube-видео.')}
                  onPlay={() => emitSync('video:play', playerRef.current?.getCurrentTime() ?? 0)}
                  onPause={() => emitSync('video:pause', playerRef.current?.getCurrentTime() ?? 0)}
                  onSeek={(seconds) => {
                    if (isHostRef.current) return;
                    if (isRemoteSync.current) {
                      isRemoteSync.current = false;
                      return;
                    }
                    socketRef.current?.emit('video:seek', { roomId, time: seconds });
                  }}
                />
              ) : video?.source === 'vk' ? (
                <iframe
                  key={vkEmbedUrl}
                  src={vkEmbedUrl}
                  className="w-full h-full border-0"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  onError={() => setError('Не удалось загрузить это VK-видео. Попробуйте публичную ссылку vk.com/video_ext.php.')}
                  title="VK Video"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-white/60">Видео пока не выбрано.</div>
              )}
              {needsInteraction ? (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <p className="text-sm text-white/85">Нажмите, чтобы начать синхронный просмотр</p>
                  <button onClick={activateGuestSync} className="rounded bg-accent px-4 py-2 font-semibold">
                    Синхронизироваться и начать просмотр
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {video?.source === 'vk' ? (
            <div className="rounded bg-black/30 p-3 space-y-2">
              <p className="text-xs text-white/70">Синхронизация VK {isHost ? '(Вы управляете комнатой)' : '(Управляет создатель комнаты)'}</p>
              <div className="flex gap-2">
                <button className="rounded bg-accent px-3 py-1 text-sm" onClick={() => { setVkPlaying(true); emitSync('video:play', vkTime); }}>Воспроизвести</button>
                <button className="rounded bg-white/20 px-3 py-1 text-sm" onClick={() => { setVkPlaying(false); emitSync('video:pause', vkTime); }}>Пауза</button>
              </div>
              <input type="range" min={0} max={60 * 60 * 3} value={vkTime} onChange={(e) => handleVkSeek(Number(e.target.value))} className="w-full" />
              <p className="text-xs text-white/60">Синхронизированная позиция: {Math.floor(vkTime)}с</p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <p className="text-xs text-white/60">Подключено пользователей: {users.length}</p>
        </section>

        <aside className="panel p-3 md:p-4 flex flex-col h-[70vh] md:h-auto">
          <h3 className="font-semibold mb-2">Чат</h3>
          <div className="text-xs mb-2 text-white/70">Пользователи: {users.map((u) => u.name).join(', ') || 'Нет'}</div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {messages.map((m) => (
              <div key={m.id} className="rounded bg-black/30 p-2 text-sm">
                <div className="text-xs text-white/60">{m.user} • {new Date(m.ts).toLocaleTimeString()}</div>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="flex-1 rounded bg-black/30 border border-white/20 px-3 py-2" placeholder="Введите сообщение" />
            <button onClick={sendChat} className="rounded bg-accent px-4">Отправить</button>
          </div>
        </aside>
      </div>
    </main>
  );
}
