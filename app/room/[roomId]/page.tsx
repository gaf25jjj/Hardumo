'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import ReactPlayer from 'react-player/youtube';
import { io, Socket } from 'socket.io-client';
import { toYouTubeUrl } from '@/lib/youtube';

type ChatMessage = { id: string; user: string; text: string; ts: number; system?: boolean };

type PresenceUser = { id: string; name: string };

const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const roomId = params.roomId;

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [videoId, setVideoId] = useState(search.get('videoId') ?? '');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const playerRef = useRef<ReactPlayer>(null);
  const socketRef = useRef<Socket | null>(null);
  const isRemoteSync = useRef(false);

  const videoUrl = useMemo(() => (videoId ? toYouTubeUrl(videoId) : ''), [videoId]);

  useEffect(() => {
    if (!joined) return;
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.emit('room:join', { roomId, name, videoId });

    socket.on('room:state', ({ videoId, users, messages }) => {
      setVideoId(videoId);
      setUsers(users);
      setMessages(messages);
    });

    socket.on('presence:update', (users) => setUsers(users));
    socket.on('chat:new', (msg) => setMessages((prev) => [...prev, msg]));

    socket.on('video:play', ({ time, videoId }) => {
      isRemoteSync.current = true;
      if (videoId) setVideoId(videoId);
      playerRef.current?.seekTo(time, 'seconds');
    });

    socket.on('video:pause', ({ time }) => {
      isRemoteSync.current = true;
      playerRef.current?.seekTo(time, 'seconds');
    });

    socket.on('video:seek', ({ time }) => {
      isRemoteSync.current = true;
      playerRef.current?.seekTo(time, 'seconds');
    });

    return () => {
      socket.disconnect();
    };
  }, [joined, name, roomId, videoId]);

  const emitSync = (event: 'video:play' | 'video:pause', seconds: number) => {
    if (isRemoteSync.current) {
      // Prevent host/client event ping-pong loops after a remote state update.
      isRemoteSync.current = false;
      return;
    }
    socketRef.current?.emit(event, { roomId, time: seconds, videoId });
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    socketRef.current?.emit('chat:send', { roomId, text: chatInput });
    setChatInput('');
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
  };

  if (!joined) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="panel p-6 w-full max-w-md space-y-4">
          <h2 className="text-2xl font-bold">Join Room {roomId}</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-black/30 border border-white/20 px-3 py-2" placeholder="Display name" />
          <button onClick={() => name.trim() && setJoined(true)} className="w-full rounded bg-accent py-2 font-semibold">Enter Watch Party</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-black to-slate-900">
      <div className="max-w-7xl mx-auto grid gap-4 md:grid-cols-[1fr_360px]">
        <section className="panel p-3 md:p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-sm">Room: <span className="font-bold">{roomId}</span></p>
            <button onClick={copyInvite} className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20">Copy Invite Link</button>
          </div>
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            {videoUrl ? (
              <ReactPlayer
                ref={playerRef}
                url={videoUrl}
                controls
                width="100%"
                height="100%"
                onPlay={() => emitSync('video:play', playerRef.current?.getCurrentTime() ?? 0)}
                onPause={() => emitSync('video:pause', playerRef.current?.getCurrentTime() ?? 0)}
                onSeek={(seconds) => socketRef.current?.emit('video:seek', { roomId, time: seconds })}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-white/60">No video set yet.</div>
            )}
          </div>
          <p className="text-xs text-white/60">Connected users: {users.length}</p>
        </section>

        <aside className="panel p-3 md:p-4 flex flex-col h-[70vh] md:h-auto">
          <h3 className="font-semibold mb-2">Chat</h3>
          <div className="text-xs mb-2 text-white/70">Users: {users.map((u) => u.name).join(', ') || 'None'}</div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {messages.map((m) => (
              <div key={m.id} className="rounded bg-black/30 p-2 text-sm">
                <div className="text-xs text-white/60">{m.user} • {new Date(m.ts).toLocaleTimeString()}</div>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="flex-1 rounded bg-black/30 border border-white/20 px-3 py-2" placeholder="Type a message" />
            <button onClick={sendChat} className="rounded bg-accent px-4">Send</button>
          </div>
        </aside>
      </div>
    </main>
  );
}
