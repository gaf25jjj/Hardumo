'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import ReactPlayer from 'react-player/youtube';
import { io, Socket } from 'socket.io-client';
import { parseVideoInput } from '@/lib/video';

type PlaybackState = { time: number; isPlaying: boolean; updatedAt: number };
type PresenceUser = { id: string; name: string };
const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'https://hardumo.onrender.com';

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [videoInput, setVideoInput] = useState(search.get('video') ?? '');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [vkBrowserMode, setVkBrowserMode] = useState(false);
  const [vkBrowserUrl, setVkBrowserUrl] = useState('https://vk.com/video');
  const [vkSyncAvailable, setVkSyncAvailable] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [pendingPlayback, setPendingPlayback] = useState<PlaybackState | null>(null);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [directPlaying, setDirectPlaying] = useState(false);
  const [directTime, setDirectTime] = useState(0);
  const [vkFallbackTime, setVkFallbackTime] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const isHostRef = useRef(false);
  const remoteRef = useRef(false);
  const playerRef = useRef<ReactPlayer>(null);
  const directRef = useRef<HTMLVideoElement>(null);
  const video = useMemo(() => parseVideoInput(videoInput), [videoInput]);

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  useEffect(() => {
    if (!joined) return;
    const socket = io(SERVER_URL, { transports: ['polling', 'websocket'] });
    socketRef.current = socket;
    socket.emit('room:join', { roomId, name, videoUrl: videoInput });

    socket.on('room:state', ({ videoUrl, users, hostId, playback }) => {
      if (videoUrl) setVideoInput(videoUrl);
      setUsers(users);
      setIsHost(hostId === socket.id);
      setPendingPlayback(playback);
    });
    socket.on('presence:update', ({ users, hostId }) => { setUsers(users); setIsHost(hostId === socket.id); });
    socket.on('room:video-updated', ({ videoUrl, playback }) => { setVideoInput(videoUrl); setPendingPlayback(playback); });
    socket.on('video:play', ({ time }) => applySync(time, true));
    socket.on('video:pause', ({ time }) => applySync(time, false));
    socket.on('video:seek', ({ time }) => applySync(time, currentPlaying()));
    socket.on('video:heartbeat', (state: PlaybackState) => {
      if (isHostRef.current) return;
      const diff = Math.abs(currentTime() - state.time);
      if (diff > 1.5) applySync(state.time, state.isPlaying);
    });
    return () => { socket.disconnect(); };
  }, [joined, roomId, name]);

  useEffect(() => {
    if (!isHost) return;
    const timer = setInterval(() => {
      socketRef.current?.emit('video:heartbeat', { roomId, time: currentTime(), isPlaying: currentPlaying() });
    }, 5000);
    return () => clearInterval(timer);
  }, [isHost, video?.source]);

  useEffect(() => {
    if (!pendingPlayback || isHost || !playerReady) return;
    applySync(pendingPlayback.time, pendingPlayback.isPlaying);
    setPendingPlayback(null);
  }, [pendingPlayback, isHost, playerReady]);

  const currentTime = () => video?.source === 'youtube' ? playerRef.current?.getCurrentTime() ?? 0 : video?.source === 'direct' ? directRef.current?.currentTime ?? 0 : vkFallbackTime;
  const currentPlaying = () => video?.source === 'youtube' ? ytPlaying : video?.source === 'direct' ? directPlaying : false;

  const applySync = (time: number, shouldPlay: boolean) => {
    if (isHostRef.current) return;
    remoteRef.current = true;
    if (video?.source === 'youtube') {
      playerRef.current?.seekTo(time, 'seconds');
      setYtPlaying(shouldPlay);
    } else if (video?.source === 'direct' && directRef.current) {
      directRef.current.currentTime = time;
      shouldPlay ? directRef.current.play() : directRef.current.pause();
    } else {
      setVkFallbackTime(time);
    }
  };

  const emitControl = (event: 'video:play' | 'video:pause' | 'video:seek', time: number) => {
    if (!isHostRef.current) return;
    if (remoteRef.current) { remoteRef.current = false; return; }
    socketRef.current?.emit(event, { roomId, time, videoUrl: videoInput });
  };

  const onVkUrlChange = (url: string) => {
    setVkBrowserUrl(url);
    if (!isHostRef.current) return;
    if (/vk\.com\/video|vkvideo\.ru\/video/i.test(url)) {
      setVideoInput(url);
      socketRef.current?.emit('room:update-video', { roomId, videoUrl: url });
    }
  };

  if (!joined) return <main className='min-h-screen flex items-center justify-center'><div className='panel p-6'><input value={name} onChange={(e) => setName(e.target.value)} placeholder='Имя' className='px-3 py-2 bg-black/30 rounded' /><button onClick={() => setJoined(true)} className='ml-2 bg-accent px-3 py-2 rounded'>Войти</button></div></main>;

  return <main className='min-h-screen p-4 space-y-3'>
    <div className='panel p-3 flex gap-2 flex-wrap'>
      <button className='rounded bg-white/15 px-3 py-1' onClick={() => setVkBrowserMode((v) => !v)}>VK Browser mode</button>
      <input value={videoInput} onChange={(e) => setVideoInput(e.target.value)} className='flex-1 min-w-56 rounded bg-black/30 px-3 py-1' placeholder='URL видео' />
      {isHost ? <button className='rounded bg-accent px-3 py-1' onClick={() => socketRef.current?.emit('room:update-video', { roomId, videoUrl: videoInput })}>Обновить комнату</button> : null}
      <span className='text-xs text-white/70'>Участники: {users.length}</span>
    </div>

    {vkBrowserMode ? <div className='panel p-3 space-y-2'>
      <p className='text-sm'>Rave-like VK Browser: войдите в VK и откройте видео внутри встроенного браузера.</p>
      <input value={vkBrowserUrl} onChange={(e) => onVkUrlChange(e.target.value)} className='w-full rounded bg-black/30 px-3 py-2' />
      <iframe src={vkBrowserUrl} className='w-full h-[60vh] rounded' title='VK Browser' />
      <p className='text-xs text-white/70'>Если JS-инъекция к video недоступна, fallback: URL + timestamp + кнопка синхронизации.</p>
      {!vkSyncAvailable ? <button className='rounded bg-white/20 px-3 py-1' onClick={() => socketRef.current?.emit('room:request-playback-state')}>Синхронизироваться</button> : null}
    </div> : null}

    <div className='aspect-video bg-black rounded overflow-hidden'>
      {video?.source === 'youtube' ? <ReactPlayer ref={playerRef} url={video.embedUrl} width='100%' height='100%' controls={isHost} playing={ytPlaying}
        onReady={() => setPlayerReady(true)}
        onPlay={() => { setYtPlaying(true); emitControl('video:play', currentTime()); }}
        onPause={() => { setYtPlaying(false); emitControl('video:pause', currentTime()); }}
        onSeek={(s) => emitControl('video:seek', s)}
      /> : video?.source === 'direct' ? <video ref={directRef} src={video.embedUrl} controls={isHost} className='w-full h-full' onLoadedData={() => setPlayerReady(true)} onTimeUpdate={() => setDirectTime(directRef.current?.currentTime ?? 0)} onPlay={() => { setDirectPlaying(true); emitControl('video:play', currentTime()); }} onPause={() => { setDirectPlaying(false); emitControl('video:pause', currentTime()); }} onSeeked={() => emitControl('video:seek', currentTime())} /> : video?.source === 'vk' ? <iframe src={video.watchUrl} className='w-full h-full border-0' allow='autoplay; fullscreen' /> : <div className='h-full grid place-items-center'>Выберите видео</div>}
    </div>
    <p className='text-xs text-white/70'>Fallback VK time: {Math.floor(vkFallbackTime)}s • Direct time: {Math.floor(directTime)}s</p>
  </main>;
}
