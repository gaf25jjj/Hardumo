import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

type ChatMessage = { id: string; user: string; text: string; ts: number; system?: boolean };
type User = { id: string; name: string };
type VideoProvider = 'youtube' | 'vk';
type PlaybackState = { provider: VideoProvider; videoId: string; embedUrl?: string; hostSocketId: string | null; isPlaying: boolean; position: number; updatedAt: number; seq: number };
type RoomState = { users: User[]; messages: ChatMessage[]; playback: PlaybackState };

const app = express();
app.use(cors({ origin: '*' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const rooms = new Map<string, RoomState>();

const ensureRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) rooms.set(roomId, { users: [], messages: [], playback: { provider: 'youtube', videoId: '', hostSocketId: null, isPlaying: false, position: 0, updatedAt: Date.now(), seq: 0 } });
  return rooms.get(roomId)!;
};
const resolvePlaybackState = (room: RoomState) => {
  const pb = room.playback;
  const position = pb.isPlaying ? pb.position + Math.max(0, (Date.now() - pb.updatedAt) / 1000) : pb.position;
  return { ...pb, position };
};
const emitState = (roomId: string, room: RoomState) => io.to(roomId).emit('room:playback-state', resolvePlaybackState(room));

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, name, provider, videoId, embedUrl }) => {
    console.log('join room', roomId);
    socket.join(roomId);
    const room = ensureRoom(roomId);
    if (!room.users.find((u) => u.id === socket.id)) room.users.push({ id: socket.id, name });
    if (!room.playback.hostSocketId) room.playback.hostSocketId = socket.id;
    if (videoId && !room.playback.videoId) Object.assign(room.playback, { provider: provider ?? 'youtube', videoId, embedUrl });
    socket.emit('room:state', { users: room.users, hostId: room.playback.hostSocketId, playback: resolvePlaybackState(room), messages: room.messages });
    io.to(roomId).emit('presence:update', { users: room.users, hostId: room.playback.hostSocketId });

    socket.on('room:update-video', ({ provider, videoId, embedUrl }) => {
      if (socket.id !== room.playback.hostSocketId) return socket.emit('control:denied');
      room.playback = { ...room.playback, provider, videoId, embedUrl, isPlaying: false, position: 0, updatedAt: Date.now(), seq: room.playback.seq + 1 };
      io.to(roomId).emit('room:video-updated', resolvePlaybackState(room));
      emitState(roomId, room);
    });
    socket.on('video:control', ({ action, position }) => {
      if (socket.id !== room.playback.hostSocketId) return socket.emit('control:denied');
      const resolved = resolvePlaybackState(room);
      const nextPosition = Number(position ?? resolved.position ?? 0);
      if (action === 'play') room.playback = { ...room.playback, isPlaying: true, position: nextPosition, updatedAt: Date.now(), seq: room.playback.seq + 1 };
      if (action === 'pause') room.playback = { ...room.playback, isPlaying: false, position: nextPosition, updatedAt: Date.now(), seq: room.playback.seq + 1 };
      if (action === 'seek') room.playback = { ...room.playback, position: nextPosition, updatedAt: Date.now(), seq: room.playback.seq + 1 };
      emitState(roomId, room);
    });
    socket.on('room:request-playback-state', () => socket.emit('room:playback-state', resolvePlaybackState(room)));
    socket.on('chat:send', ({ text }: { text?: string }) => {
      const normalizedText = (text ?? '').trim(); if (!normalizedText) return;
      const sender = room.users.find((u) => u.id === socket.id); if (!sender) return;
      const message: ChatMessage = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, user: sender.name, text: normalizedText, ts: Date.now() };
      room.messages.push(message); io.to(roomId).emit('chat:new', message);
    });
    socket.on('disconnect', () => {
      room.users = room.users.filter((u) => u.id !== socket.id);
      if (room.playback.hostSocketId === socket.id) room.playback.hostSocketId = room.users[0]?.id ?? null;
      io.to(roomId).emit('presence:update', { users: room.users, hostId: room.playback.hostSocketId });
      if (!room.users.length) rooms.delete(roomId);
    });
  });
});

setInterval(() => {
  for (const [roomId, room] of rooms) emitState(roomId, room);
}, 2000);

app.get('/health', (_, res) => res.json({ ok: true }));
server.listen(Number(process.env.SOCKET_PORT ?? 4000), () => console.log('Socket server listening'));
