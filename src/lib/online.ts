import { io, type Socket } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import type { Ack } from '../shared/types';

export function openConnection(url: string): Socket {
  const base = url.trim() || import.meta.env.VITE_SERVER_URL || '';
  if (Capacitor.isNativePlatform() && !base) throw new Error('Set your hosted HTTPS server address in Settings before playing online on Android. Offline modes work now.');
  if (base) {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error('Use a server origin such as https://play.example.com, without a path or credentials.');
    if (Capacitor.isNativePlatform() && parsed.protocol !== 'https:') throw new Error('The Android app requires an HTTPS server.');
  }
  return io(base || undefined, { autoConnect: false, reconnection: false, timeout: 8000, tryAllTransports: true, transports: ['websocket', 'polling'] });
}

export function connectForRoom(
  client: Pick<Socket, 'connect' | 'disconnect' | 'on' | 'off'>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(retry);
      clearTimeout(deadline);
      client.off('connect', connected);
      client.off('connect_error', failed);
      signal.removeEventListener('abort', aborted);
      if (error) { client.disconnect(); reject(error); }
      else resolve();
    };
    const connected = () => finish();
    const aborted = () => finish(new Error('Connection canceled.'));
    const attempt = () => {
      if (settled) return;
      try { client.connect(); }
      catch { failed(); }
    };
    const failed = () => {
      if (settled) return;
      clearTimeout(retry);
      retry = setTimeout(attempt, 2000);
    };
    if (signal.aborted) { aborted(); return; }
    client.on('connect', connected);
    client.on('connect_error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    deadline = setTimeout(() => finish(new Error('The server did not become available within 90 seconds. Check the server address and try again. Free hosting may be restarting or temporarily unavailable.')), 90_000);
    attempt();
  });
}

export function request(socket: Socket, event: string, payload?: unknown): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, response: Ack) => error ? reject(new Error('The server did not respond. Please try again.')) : response?.ok ? resolve(response) : reject(new Error(response?.error || 'Request was not accepted.'));
    if (payload === undefined) socket.timeout(7000).emit(event, callback); else socket.timeout(7000).emit(event, payload, callback);
  });
}