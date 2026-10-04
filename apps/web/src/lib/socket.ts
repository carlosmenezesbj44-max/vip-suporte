import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** URL base da API, sem o sufixo /api, usada para conectar o WebSocket (ex: http://localhost:3333). */
function getSocketBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';
  return apiUrl.replace(/\/api\/?$/, '');
}

/** Cria (ou reaproveita) a conexão WebSocket autenticada com o namespace /tickets. */
export function getTicketsSocket(): Socket {
  if (socket) return socket;

  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;

  socket = io(`${getSocketBaseUrl()}/tickets`, {
    // Lê o token em cada conexão/reconexão. Assim, o socket não fica preso a
    // uma sessão antiga quando o usuário entra novamente sem recarregar a aba.
    auth: (callback) => callback({
      token: typeof window !== 'undefined' ? window.localStorage.getItem('token') : token,
    }),
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });

  return socket;
}

export function disconnectTicketsSocket() {
  socket?.disconnect();
  socket = null;
}
