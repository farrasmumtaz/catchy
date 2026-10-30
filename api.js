import { io } from 'socket.io-client';

export const publicPreview = import.meta.env?.VITE_PUBLIC_PREVIEW === 'true';


export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Respons API tidak valid. Pastikan backend berjalan dan proxy /api sudah aktif.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message || 'Permintaan gagal.');
    error.status = response.status;
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      if (Number.isFinite(seconds) && seconds > 0) error.message += ` Coba lagi dalam ${Math.ceil(seconds)} detik.`;
    }
    throw error;
  }
  return result;
}

export function openRealtime() {
  return io({ autoConnect: false, withCredentials: true, transports: ['websocket', 'polling'], tryAllTransports: true });
}
