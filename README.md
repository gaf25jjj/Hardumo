# Hardumo Watch Party MVP

A simple Rave-style watch party app where friends can watch embedded YouTube videos together in synchronized rooms.

## Tech stack
- Next.js + TypeScript + Tailwind CSS
- Express + Socket.IO backend

## Install
```bash
npm install
```

## Run locally
```bash
npm run dev
```
- Frontend: your deployed Next.js URL
- Socket backend: `https://hardumo.onrender.com`

## Environment variables
Optional:
- `NEXT_PUBLIC_SOCKET_URL` (default: `https://hardumo.onrender.com`)
- `SOCKET_PORT` (default: `4000`)

## MVP behavior
- Home page lets users create or join room IDs.
- Create room requires a valid YouTube URL.
- Room URL is shareable (`/room/[roomId]`).
- Playback play/pause/seek events are synchronized with Socket.IO.
- Chat and user presence updates are real-time.

## Deployment notes
- Deploy frontend (Next.js) and socket backend (Express) as separate services.
- Set `NEXT_PUBLIC_SOCKET_URL` to your deployed socket service URL.
- Keep CORS restricted in production.
- Only YouTube embeds are supported; no video hosting or piracy features are included.
