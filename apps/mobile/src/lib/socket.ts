import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './api';

let socket: Socket | null = null;

function getSocketBaseUrl(): string {
  return API_URL.replace(/\/api\/?$/, '');
}

/** Cria (ou reaproveita) a conexão WebSocket autenticada com o namespace /tickets. */
export async function getTicketsSocket(): Promise<Socket> {
  if (socket) return socket;

  const token = await AsyncStorage.getItem('token');

  socket = io(`${getSocketBaseUrl()}/tickets`, {
    auth: { token },
    // Start with polling and upgrade when WebSocket is available. Some mobile
    // networks allow the HTTP API but block a direct WebSocket connection.
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    timeout: 20_000,
  });

  return socket;
}

export function disconnectTicketsSocket() {
  socket?.disconnect();
  socket = null;
}
