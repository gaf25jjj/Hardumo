'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { parseVideoUrl } from '@/lib/video';
import { ServerPlaybackState } from '@/lib/player/types';
import { YouTubeAdapter } from '@/lib/player/YouTubeAdapter';
import { VkVideoAdapter } from '@/lib/player/VkVideoAdapter';

const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'https://hardumo.onrender.com';

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const [name, setName] = useState(''); const [joined, setJoined] = useState(false);
  const [videoInput, setVideoInput] = useState(search.get('video') ?? '');
  const [users, setUsers] = useState<any[]>([]); const [messages, setMessages] = useState<any[]>([]); const [messageText, setMessageText] = useState('');
  const [isHost, setIsHost] = useState(false); const [playerReady, setPlayerReady] = useState(false); const [userActivatedSync, setUserActivatedSync] = useState(false);
  const [pendingRemoteState, setPendingRemoteState] = useState<ServerPlaybackState | null>(null); const [lastServerState, setLastServerState] = useState<ServerPlaybackState | null>(null);
  const [applyingRemoteState, setApplyingRemoteState] = useState(false); const [autoplayBlocked, setAutoplayBlocked] = useState(false); const [denied, setDenied] = useState(false);
  const socketRef = useRef<Socket | null>(null); const containerRef = useRef<HTMLDivElement>(null); const adapterRef = useRef<any>(null);
  const video = useMemo(() => parseVideoUrl(videoInput), [videoInput]);

  const applyRemoteState = async (state: ServerPlaybackState) => {
    if (!adapterRef.current || !playerReady) return setPendingRemoteState(state);
    const targetTime = state.isPlaying ? state.position + (Date.now() - state.updatedAt) / 1000 : state.position;
    console.log('applying remote state', state.seq, targetTime);
    setApplyingRemoteState(true);
    try { await adapterRef.current.seekTo(targetTime); state.isPlaying ? await adapterRef.current.play() : await adapterRef.current.pause(); } catch {}
    setTimeout(() => setApplyingRemoteState(false), 600);
  };

  useEffect(() => {
    if (!joined) return; const socket = io(SERVER_URL); socketRef.current = socket;
    socket.emit('room:join', { roomId, name, provider: video?.provider, videoId: video?.videoId, embedUrl: video?.embedUrl });
    socket.on('room:state', ({ users, hostId, playback, messages }) => { console.log('host assigned', hostId); setUsers(users); setMessages(messages ?? []); setIsHost(hostId === socket.id); setLastServerState(playback); setPendingRemoteState(playback); });
    socket.on('presence:update', ({ users, hostId }) => { setUsers(users); setIsHost(hostId === socket.id); });
    socket.on('chat:new', (m) => setMessages((p) => [...p, m]));
    socket.on('room:video-updated', (state) => { setLastServerState(state); setPendingRemoteState(state); setPlayerReady(false); if (!isHost) setUserActivatedSync(false); });
    socket.on('room:playback-state', (state) => { console.log('received playback state', state.seq); setLastServerState(state); if (!userActivatedSync && !isHost) return setPendingRemoteState(state); applyRemoteState(state); });
    socket.on('control:denied', () => { console.log('denied guest control'); setDenied(true); });
    return () => { socket.disconnect(); };
  }, [joined, roomId, name]);

  useEffect(() => {
    if (!containerRef.current || !video) return;
    adapterRef.current?.destroy?.();
    const adapter = video.provider === 'youtube' ? new YouTubeAdapter() : new VkVideoAdapter();
    adapterRef.current = adapter;
    adapter.onReady(() => { setPlayerReady(true); if (pendingRemoteState && (isHost || userActivatedSync)) applyRemoteState(pendingRemoteState); });
    adapter.onStateChange(async (state: any) => {
      if (applyingRemoteState || !isHost) return;
      const t = await adapter.getCurrentTime();
      if (state === 'playing') socketRef.current?.emit('video:control', { action: 'play', position: t });
      if (state === 'paused' || state === 'ended') socketRef.current?.emit('video:control', { action: 'pause', position: t });
    });
    adapter.onAutoplayBlocked?.(() => { console.log('autoplay blocked'); setAutoplayBlocked(true); setUserActivatedSync(false); });
    adapter.load(containerRef.current, video.provider === 'youtube' ? video.videoId : (video.embedUrl ?? video.originalUrl));
    console.log('detected provider', video.provider);
  }, [video?.provider, video?.videoId, video?.embedUrl, isHost]);

  useEffect(() => {
    if (isHost || !userActivatedSync) return;
    const timer = setInterval(async () => {
      if (!lastServerState || !adapterRef.current) return;
      const target = lastServerState.isPlaying ? lastServerState.position + (Date.now() - lastServerState.updatedAt) / 1000 : lastServerState.position;
      const current = await adapterRef.current.getCurrentTime();
      const diff = Math.abs(target - current);
      if (diff > 1.25) { console.log('drift correction hard', diff); await adapterRef.current.seekTo(target); }
      else if (diff > 0.35 && adapterRef.current.setPlaybackRate) { console.log('drift correction soft', diff); adapterRef.current.setPlaybackRate(target > current ? 1.05 : 0.95); setTimeout(() => adapterRef.current.setPlaybackRate?.(1), 700); }
    }, 1800);
    return () => clearInterval(timer);
  }, [isHost, userActivatedSync, lastServerState]);

  if (!joined) return <main className='min-h-screen flex items-center justify-center'><div className='panel p-6'><input value={name} onChange={(e) => setName(e.target.value)} placeholder='Имя' className='px-3 py-2 bg-black/30 rounded' /><button onClick={() => setJoined(true)} className='ml-2 bg-accent px-3 py-2 rounded'>Войти</button></div></main>;

  return <main className='min-h-screen p-4 space-y-3'>
    <div className='panel p-3 flex gap-2'><input value={videoInput} disabled={!isHost} onChange={(e) => setVideoInput(e.target.value)} className='flex-1 rounded bg-black/30 px-3 py-1' placeholder='Вставьте ссылку YouTube или VK Видео' />
      {isHost && video ? <button className='rounded bg-accent px-3 py-1' onClick={() => socketRef.current?.emit('room:update-video', { provider: video.provider, videoId: video.videoId, embedUrl: video.embedUrl })}>Обновить комнату</button> : null}
      <span className='text-xs'>{video?.provider === 'vk' ? 'VK Видео' : 'YouTube'}</span>{video?.provider === 'vk' ? <span className='text-xs text-yellow-300'>VK sync: experimental</span> : null}
    </div>
    <div className='aspect-video bg-black rounded overflow-hidden relative'><div ref={containerRef} className='w-full h-full' />
      {!isHost && !userActivatedSync ? <div className='absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2'><button className='rounded bg-accent px-4 py-2' onClick={() => { setUserActivatedSync(true); socketRef.current?.emit('room:request-playback-state'); if (pendingRemoteState) applyRemoteState(pendingRemoteState); }}>Синхронизироваться и начать просмотр</button><p className='text-sm text-white/80'>{autoplayBlocked ? 'Браузер или VK Видео заблокировал автозапуск. Нажмите, чтобы продолжить синхронный просмотр.' : 'Нажмите, чтобы начать синхронный просмотр'}</p></div> : null}
    </div>
    {denied ? <p className='text-xs text-red-300'>Только создатель комнаты может управлять воспроизведением.</p> : null}
    <aside className='panel p-3'><div>Участники: {users.length}</div><form onSubmit={(e: FormEvent) => { e.preventDefault(); socketRef.current?.emit('chat:send', { text: messageText }); setMessageText(''); }} className='mt-2 flex gap-2'><input value={messageText} onChange={(e)=>setMessageText(e.target.value)} className='flex-1 rounded bg-black/30 px-2' /><button className='rounded bg-accent px-3 py-1'>Send</button></form>{messages.map((m:any)=><div key={m.id} className='text-sm'>{m.user}: {m.text}</div>)}</aside>
  </main>;
}
