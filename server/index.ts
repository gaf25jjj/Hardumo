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
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = new Map<string, RoomState>();

const ensureRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      videoUrl: '',
      users: [],
      messages: [],
      playback: { time: 0, isPlaying: false, updatedAt: Date.now() },
      hostId: null
    });
  }
  return rooms.get(roomId)!;
};

const resolvePlaybackState = (room: RoomState): PlaybackState => {
  if (!room.playback.isPlaying) return room.playback;
  const elapsed = Math.max(0, (Date.now() - room.playback.updatedAt) / 1000);
  return {
    ...room.playback,
    time: room.playback.time + elapsed
  };
};

const emitRoomState = (roomId: string, room: RoomState) => {
  io.to(roomId).emit('presence:update', { users: room.users, hostId: room.hostId });
};

io.on('connection', (socket) => {
  console.log(`[socket] connected id=${socket.id}`);

  socket.on('room:join', ({ roomId, name, videoUrl }) => {
    console.log(`[socket] room:join id=${socket.id} room=${roomId} user=${name}`);
    socket.join(roomId);
    const room = ensureRoom(roomId);
    if (videoUrl && !room.videoUrl) room.videoUrl = videoUrl;

    const existing = room.users.find((u) => u.id === socket.id);
    if (!existing) {
      room.users.push({ id: socket.id, name });
    }
    if (!room.hostId) room.hostId = socket.id;

    const joinMsg = { id: crypto.randomUUID(), user: 'Система', text: `Пользователь ${name} вошёл`, ts: Date.now(), system: true };
    room.messages.push(joinMsg);

    socket.emit('room:state', {
      ...room,
      playback: resolvePlaybackState(room)
    });
    emitRoomState(roomId, room);
    io.to(roomId).emit('chat:new', joinMsg);

    socket.on('video:play', (payload) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(payload?.time ?? 0), isPlaying: true, updatedAt: Date.now() };
      socket.to(roomId).emit('video:play', payload);
    });

    socket.on('video:pause', (payload) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(payload?.time ?? 0), isPlaying: false, updatedAt: Date.now() };
      socket.to(roomId).emit('video:pause', payload);
    });

    socket.on('video:seek', (payload) => {
      if (room.hostId !== socket.id) return;
      room.playback = { time: Number(payload?.time ?? 0), isPlaying: room.playback.isPlaying, updatedAt: Date.now() };
      socket.to(roomId).emit('video:seek', payload);
    });

    socket.on('room:request-playback-state', () => {
      socket.emit('room:playback-state', resolvePlaybackState(room));
    });

    socket.on('chat:send', ({ text }) => {
      const msg = { id: crypto.randomUUID(), user: name, text, ts: Date.now() };
      room.messages.push(msg);
      io.to(roomId).emit('chat:new', msg);
    });

    socket.on('disconnect', () => {
      const currentRoom = rooms.get(roomId);
      if (!currentRoom) return;

      currentRoom.users = currentRoom.users.filter((u) => u.id !== socket.id);
      if (currentRoom.hostId === socket.id) {
        currentRoom.hostId = currentRoom.users[0]?.id ?? null;
      }

      const leaveMsg = { id: crypto.randomUUID(), user: 'Система', text: `Пользователь ${name} вышел`, ts: Date.now(), system: true };
      currentRoom.messages.push(leaveMsg);

      emitRoomState(roomId, currentRoom);
      io.to(roomId).emit('chat:new', leaveMsg);

      if (!currentRoom.users.length) rooms.delete(roomId);
    });
  });
});

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.SOCKET_PORT ?? 4000);
server.listen(port, () => {
  console.log(`Socket server listening on :${port}`);
});
