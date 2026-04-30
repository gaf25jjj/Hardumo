'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseVideoInput } from '@/lib/video';
import { generateRoomId } from '@/lib/room';

export default function HomePage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const createRoom = () => {
    const parsed = parseVideoInput(videoUrl);
    if (!parsed) {
      setError('Пожалуйста, введите корректную ссылку на YouTube или VK видео.');
      return;
    }
    const roomId = generateRoomId();
    router.push(`/room/${roomId}?video=${encodeURIComponent(parsed.watchUrl)}`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black to-slate-900 px-6">
      <div className="panel w-full max-w-2xl p-8 space-y-6">
        <h1 className="text-4xl font-bold">Hardumo Watch Party</h1>
        <p className="text-white/70">Простая синхронизированная комната для совместного просмотра YouTube и VK.</p>

        <div className="space-y-3">
          <label className="block text-sm text-white/80">Ссылка на видео (YouTube или VK)</label>
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Вставьте ссылку на видео"
            className="w-full rounded-lg bg-black/30 border border-white/15 px-4 py-3 outline-none focus:border-accent"
          />
          <button onClick={createRoom} className="w-full rounded-lg bg-accent py-3 font-semibold hover:opacity-90">
            Создать комнату
          </button>
        </div>

        <div className="border-t border-white/10 pt-4 space-y-3">
          <label className="block text-sm text-white/80">Присоединиться к существующей комнате</label>
          <input
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
            placeholder="Введите ID комнаты"
            className="w-full rounded-lg bg-black/30 border border-white/15 px-4 py-3 outline-none focus:border-accent"
          />
          <button
            onClick={() => joinRoomId && router.push(`/room/${joinRoomId}`)}
            className="w-full rounded-lg bg-white/15 py-3 font-semibold hover:bg-white/20"
          >
            Присоединиться
          </button>
        </div>

        {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      </div>
    </main>
  );
}
