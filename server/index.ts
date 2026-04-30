import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

type ChatMessage = { id: string; user: string; text: string; ts: number; system?: boolean };
type User = { id: string; name: string };
type RoomState = { videoId: string; users: User[]; messages: ChatMessage[] };

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const rooms = new Map<string, RoomState>();

const ensureRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) rooms.set(roomId, { videoId: '', users: [], messages: [] });
  return rooms.get(roomId)!;
};

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, name, videoId }) => {
    socket.join(roomId);
    const room = ensureRoom(roomId);
    if (videoId && !room.videoId) room.videoId = videoId;
    room.users.push({ id: socket.id, name });

    const joinMsg = { id: crypto.randomUUID(), user: 'System', text: `${name} joined the room`, ts: Date.now(), system: true };
    room.messages.push(joinMsg);

    socket.emit('room:state', room);
    io.to(roomId).emit('presence:update', room.users);
    io.to(roomId).emit('chat:new', joinMsg);

    socket.on('video:play', (payload) => socket.to(roomId).emit('video:play', payload));
    socket.on('video:pause', (payload) => socket.to(roomId).emit('video:pause', payload));
    socket.on('video:seek', (payload) => socket.to(roomId).emit('video:seek', payload));

    socket.on('chat:send', ({ text }) => {
      const msg = { id: crypto.randomUUID(), user: name, text, ts: Date.now() };
      room.messages.push(msg);
      io.to(roomId).emit('chat:new', msg);
    });

    socket.on('disconnect', () => {
      const room = rooms.get(roomId);
      if (!room) return;
      room.users = room.users.filter((u) => u.id !== socket.id);
      const leaveMsg = { id: crypto.randomUUID(), user: 'System', text: `${name} left the room`, ts: Date.now(), system: true };
      room.messages.push(leaveMsg);
      io.to(roomId).emit('presence:update', room.users);
      io.to(roomId).emit('chat:new', leaveMsg);
      if (!room.users.length) rooms.delete(roomId);
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
