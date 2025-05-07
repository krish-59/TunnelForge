import { WebSocket } from "ws";

export interface TunnelStats {
  requestCount: number;
  lastRequestTime: number | null;
  createdAt: number;
  rateLimitRemaining: number;
  rateLimitReset: number;
}

export interface Tunnel {
  id: string;
  localPort: number;
  socket: WebSocket;
  stats: TunnelStats;
}

export interface TunnelInfo {
  id: string;
  localPort: number;
  stats: TunnelStats;
}
