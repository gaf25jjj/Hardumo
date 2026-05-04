import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

type ChatMessage = { id: string; user: string; text: string; ts: number; system?: boolean };
type User = { id: string; name: string };
type PlaybackState = { time: number; isPlaying: boolean; updatedAt: number };
type RoomState = { videoUrl: string; users: User[]; messages: ChatMessage[]; playback: PlaybackState; hostId: string | null };

const app = express();
app.use(cors({ origin: '*' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const rooms = new Map<string, RoomState>();

const ensureRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { videoUrl: '', users: [], messages: [], playback: { time: 0, isPlaying: false, updatedAt: Date.now() }, hostId: null });
  }
  return rooms.get(roomId)!;
};

const resolvePlaybackState = (room: RoomState): PlaybackState => {
  if (!room.playback.isPlaying) return room.playback;
  const elapsed = Math.max(0, (Date.now() - room.playback.updatedAt) / 1000);
  return { ...room.playback, time: room.playback.time + elapsed };
};

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, name, videoUrl }) => {
    socket.join(roomId);
    const room = ensureRoom(roomId);
    if (videoUrl && !room.videoUrl) room.videoUrl = videoUrl;
    if (!room.users.find((u) => u.id === socket.id)) room.users.push({ id: socket.id, name });
    if (!room.hostId) room.hostId = socket.id;

    socket.emit('room:state', { ...room, playback: resolvePlaybackState(room) });
    io.to(roomId).emit('presence:update', { users: room.users, hostId: room.hostId });

    socket.on('room:update-video', ({ videoUrl }) => {
      if (room.hostId !== socket.id || !videoUrl) return;
      room.videoUrl = videoUrl;
      room.playback = { time: 0, isPlaying: false, updatedAt: Date.now() };
      io.to(roomId).emit('room:video-updated', { videoUrl, playback: room.playback });
    });

    socket.on('video:play', ({ time, videoUrl }) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(time ?? 0), isPlaying: true, updatedAt: Date.now() };
      socket.to(roomId).emit('video:play', { time, videoUrl });
    });
    socket.on('video:pause', ({ time, videoUrl }) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(time ?? 0), isPlaying: false, updatedAt: Date.now() };
      socket.to(roomId).emit('video:pause', { time, videoUrl });
    });
    socket.on('video:seek', ({ time }) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(time ?? 0), isPlaying: room.playback.isPlaying, updatedAt: Date.now() };
      socket.to(roomId).emit('video:seek', { time });
    });
    socket.on('video:heartbeat', ({ time, isPlaying }) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(time ?? 0), isPlaying: Boolean(isPlaying), updatedAt: Date.now() };
      socket.to(roomId).emit('video:heartbeat', room.playback);
    });

    socket.on('room:request-playback-state', () => socket.emit('room:playback-state', resolvePlaybackState(room)));

    socket.on('disconnect', () => {
      const currentRoom = rooms.get(roomId);
      if (!currentRoom) return;
      currentRoom.users = currentRoom.users.filter((u) => u.id !== socket.id);
      if (currentRoom.hostId === socket.id) currentRoom.hostId = currentRoom.users[0]?.id ?? null;
      io.to(roomId).emit('presence:update', { users: currentRoom.users, hostId: currentRoom.hostId });
      if (!currentRoom.users.length) rooms.delete(roomId);
    });
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));
const port = Number(process.env.SOCKET_PORT ?? 4000);
server.listen(port, () => console.log(`Socket server listening on :${port}`));
