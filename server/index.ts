import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

type Message = { id: string; userId: string; user: string; text: string; ts: number; system?: boolean };
type User = { id: string; name: string };
type VideoProvider = 'youtube' | 'vk';
type PlaybackState = { provider: VideoProvider; videoId: string; embedUrl?: string; isPlaying: boolean; position: number; updatedAt: number; seq: number };
type Room = { id: string; hostSocketId: string; playback: PlaybackState; users: User[]; messages: Message[] };

const app = express();
app.use(cors({ origin: '*' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const rooms = new Map<string, Room>();

function safePosition(position: unknown): number {
  const n = Number(position);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 86400);
}

function resolvePlaybackState(playback: PlaybackState): PlaybackState {
  if (!playback.isPlaying) return playback;
  return { ...playback, position: safePosition(playback.position + (Date.now() - playback.updatedAt) / 1000), updatedAt: Date.now() };
}

const getRoom = (roomId: string): Room => {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      hostSocketId: '',
      users: [],
      messages: [],
      playback: { provider: 'youtube', videoId: '', isPlaying: false, position: 0, updatedAt: Date.now(), seq: 0 },
    };
    rooms.set(roomId, room);
  }
  return room;
};

const makeMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, name, provider, videoId, embedUrl }) => {
    const room = getRoom(roomId);
    socket.join(roomId);
    socket.data.roomId = roomId;

    if (!room.hostSocketId) room.hostSocketId = socket.id;

    const normalizedName = typeof name === 'string' && name.trim() ? name.trim() : 'Гость';
    socket.data.name = normalizedName;
    const existing = room.users.find((u) => u.id === socket.id);
    if (!existing) {
      room.users.push({ id: socket.id, name: normalizedName });
      const joinMessage: Message = {
        id: makeMessageId(),
        userId: socket.id,
        user: normalizedName,
        text: `${normalizedName} вошёл в комнату`,
        ts: Date.now(),
        system: true,
      };
      room.messages.push(joinMessage);
      io.to(roomId).emit('chat:new', joinMessage);
    }

    if (videoId && !room.playback.videoId) room.playback = { ...room.playback, provider: provider ?? 'youtube', videoId, embedUrl, updatedAt: Date.now() };

    socket.emit('room:state', {
      roomId,
      isHost: socket.id === room.hostSocketId,
      hostId: room.hostSocketId,
      users: room.users,
      messages: room.messages,
      playback: resolvePlaybackState(room.playback),
    });
    io.to(roomId).emit('presence:update', { users: room.users, hostId: room.hostSocketId });

    socket.on('room:update-video', ({ provider, videoId, embedUrl }) => {
      if (socket.id !== room.hostSocketId) {
        socket.emit('control:denied', { reason: 'Only the room creator can control playback' });
        return;
      }
      room.playback = { provider, videoId, embedUrl, isPlaying: false, position: 0, updatedAt: Date.now(), seq: room.playback.seq + 1 };
      socket.to(roomId).emit('room:playback-state', resolvePlaybackState(room.playback));
    });

    socket.on('video:control', ({ roomId: rid, type, position }: { roomId: string; type: 'play' | 'pause' | 'seek'; position: number }) => {
      const current = rooms.get(rid);
      if (!current) return;
      if (socket.id !== current.hostSocketId) {
        socket.emit('control:denied', { reason: 'Only the room creator can control playback' });
        return;
      }
      const p = safePosition(position);
      if (type === 'play') current.playback = { ...current.playback, isPlaying: true, position: p, updatedAt: Date.now(), seq: current.playback.seq + 1 };
      if (type === 'pause') current.playback = { ...current.playback, isPlaying: false, position: p, updatedAt: Date.now(), seq: current.playback.seq + 1 };
      if (type === 'seek') current.playback = { ...current.playback, position: p, updatedAt: Date.now(), seq: current.playback.seq + 1 };
      socket.to(rid).emit('room:playback-state', resolvePlaybackState(current.playback));
    });

    socket.on('host:heartbeat', ({ roomId: rid, position, isPlaying }: { roomId: string; position: number; isPlaying: boolean }) => {
      const current = rooms.get(rid);
      if (!current) return;
      if (socket.id !== current.hostSocketId) return;
      current.playback = { ...current.playback, isPlaying: Boolean(isPlaying), position: safePosition(position), updatedAt: Date.now(), seq: current.playback.seq + 1 };
      socket.to(rid).emit('room:sync-pulse', resolvePlaybackState(current.playback));
    });

    socket.on('room:request-playback-state', ({ roomId: rid }) => {
      const r = rooms.get(rid);
      if (!r) return;
      socket.emit('room:playback-state', resolvePlaybackState(r.playback));
    });

    socket.on('chat:send', ({ text }: { text?: string | null }) => {
      const raw = typeof text === 'string' ? text : '';
      const trimmed = raw.trim();
      if (!trimmed) return;
      const normalized = trimmed.slice(0, 500);
      const sender = room.users.find((u) => u.id === socket.id);
      if (!sender) return;
      const message: Message = { id: makeMessageId(), userId: sender.id, user: sender.name, text: normalized, ts: Date.now(), system: false };
      room.messages.push(message);
      io.to(roomId).emit('chat:new', message);
    });

    socket.on('disconnect', () => {
      const leavingUser = room.users.find((u) => u.id === socket.id);
      room.users = room.users.filter((u) => u.id !== socket.id);
      if (room.hostSocketId === socket.id) room.hostSocketId = room.users[0]?.id ?? '';

      if (leavingUser) {
        const leaveMessage: Message = {
          id: makeMessageId(),
          userId: socket.id,
          user: leavingUser.name,
          text: `${leavingUser.name} вышел из комнаты`,
          ts: Date.now(),
          system: true,
        };
        room.messages.push(leaveMessage);
        io.to(roomId).emit('chat:new', leaveMessage);
      }

      io.to(roomId).emit('presence:update', { users: room.users, hostId: room.hostSocketId });
      if (!room.users.length) rooms.delete(roomId);
    });
  });
});

setInterval(() => {
  for (const [roomId, room] of rooms.entries()) io.to(roomId).except(room.hostSocketId).emit('room:sync-pulse', resolvePlaybackState(room.playback));
}, 2500);

app.get('/health', (_, res) => res.json({ ok: true }));
server.listen(Number(process.env.SOCKET_PORT ?? 4000), () => console.log('Socket server listening'));
