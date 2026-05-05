import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

type Message = { id: string; user: string; text: string; ts: number; system?: boolean };
type User = { id: string; name: string };
type VideoProvider = 'youtube' | 'vk';
type PlaybackState = { provider: VideoProvider; videoId: string; embedUrl?: string; isPlaying: boolean; position: number; updatedAt: number; seq: number };
type Room = { id: string; hostSocketId: string; playback: PlaybackState; users: User[]; messages: Message[] };

const app = express(); app.use(cors({ origin: '*' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const rooms = new Map<string, Room>();

function resolvePlaybackState(playback: PlaybackState): PlaybackState { if (!playback.isPlaying) return playback; return { ...playback, position: playback.position + (Date.now() - playback.updatedAt) / 1000, updatedAt: Date.now() }; }
const getRoom=(roomId:string):Room=>{ let room=rooms.get(roomId); if(!room){ room={id:roomId,hostSocketId:'',users:[],messages:[],playback:{provider:'youtube',videoId:'',isPlaying:false,position:0,updatedAt:Date.now(),seq:0}}; rooms.set(roomId,room); console.log('[ROOM] created', roomId);} return room; };

io.on('connection',(socket)=>{
  socket.on('room:join',({roomId,name,provider,videoId,embedUrl})=>{ const room=getRoom(roomId); socket.join(roomId); if(!room.hostSocketId){ room.hostSocketId=socket.id; console.log('[ROOM] host assigned', socket.id);} if(!room.users.find((u)=>u.id===socket.id)) room.users.push({id:socket.id,name}); if(videoId && !room.playback.videoId) room.playback={...room.playback,provider:provider??'youtube',videoId,embedUrl}; console.log('[ROOM] joined',roomId,socket.id);
    socket.emit('room:state',{roomId,isHost:socket.id===room.hostSocketId,users:room.users,messages:room.messages,playback:resolvePlaybackState(room.playback)});
    io.to(roomId).emit('presence:update',{users:room.users,hostId:room.hostSocketId});

    socket.on('room:update-video',({provider,videoId,embedUrl})=>{ if(socket.id!==room.hostSocketId){ socket.emit('control:denied',{reason:'Only the room creator can control playback'}); console.log('[DENIED] guest tried to control playback',socket.id); return;} room.playback={provider,videoId,embedUrl,isPlaying:false,position:0,updatedAt:Date.now(),seq:room.playback.seq+1}; io.to(roomId).emit('room:playback-state',resolvePlaybackState(room.playback)); });

    socket.on('video:control',({roomId:rid,type,position}:{roomId:string;type:'play'|'pause'|'seek';position:number;seq?:number})=>{ const current=rooms.get(rid); if(!current) return; if(socket.id!==current.hostSocketId){ socket.emit('control:denied',{reason:'Only the room creator can control playback'}); console.log('[DENIED] guest tried to control playback',socket.id); return;} console.log('[SYNC] control from host', type, position);
      if(type==='play') current.playback={...current.playback,isPlaying:true,position,updatedAt:Date.now(),seq:current.playback.seq+1};
      if(type==='pause') current.playback={...current.playback,isPlaying:false,position,updatedAt:Date.now(),seq:current.playback.seq+1};
      if(type==='seek') current.playback={...current.playback,position,updatedAt:Date.now(),seq:current.playback.seq+1};
      const resolved=resolvePlaybackState(current.playback); console.log('[SYNC] resolved state',resolved); io.to(rid).emit('room:playback-state',resolved); console.log('[SYNC] broadcast playback state',rid);
    });

    socket.on('room:request-playback-state',({roomId:rid})=>{ const r=rooms.get(rid); if(!r) return; socket.emit('room:playback-state',resolvePlaybackState(r.playback)); });
    socket.on('chat:send',({text}:{text?:string})=>{ const t=(text??'').trim(); if(!t) return; const s=room.users.find((u)=>u.id===socket.id); if(!s) return; const m={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,user:s.name,text:t,ts:Date.now()}; room.messages.push(m); io.to(roomId).emit('chat:new',m);});
    socket.on('disconnect',()=>{ room.users=room.users.filter((u)=>u.id!==socket.id); if(room.hostSocketId===socket.id){ room.hostSocketId=room.users[0]?.id??''; console.log('[ROOM] host assigned',room.hostSocketId);} io.to(roomId).emit('presence:update',{users:room.users,hostId:room.hostSocketId}); if(!room.users.length) rooms.delete(roomId); });
  });
});

setInterval(()=>{ for(const [roomId,room] of rooms.entries()) io.to(roomId).emit('room:sync-pulse',resolvePlaybackState(room.playback)); },2000);
app.get('/health',(_,res)=>res.json({ok:true}));
server.listen(Number(process.env.SOCKET_PORT??4000),()=>console.log('Socket server listening'));
