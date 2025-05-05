import { WebSocket } from "ws";
import { Tunnel, TunnelInfo, TunnelStats } from "../types/tunnel";
import { generateId } from "../utils";

export class TunnelManager {
  private tunnels: Map<string, Tunnel>;

  constructor() {
    this.tunnels = new Map();
  }

  public createTunnel(socket: WebSocket, localPort: number): Tunnel {
    const id = generateId();
    const stats: TunnelStats = {
      requestCount: 0,
      lastRequestTime: null,
      createdAt: Date.now(),
      rateLimitRemaining: 100, // Default rate limit
    };

    const tunnel: Tunnel = { id, localPort, socket, stats };
    this.tunnels.set(id, tunnel);

    // Clean up when socket closes
    socket.on("close", () => {
      this.removeTunnel(id);
    });

    return tunnel;
  }

  public getTunnel(id: string): Tunnel | undefined {
    return this.tunnels.get(id);
  }

  public removeTunnel(id: string): boolean {
    const tunnel = this.tunnels.get(id);
    if (tunnel) {
      tunnel.socket.close();
      return this.tunnels.delete(id);
    }
    return false;
  }

  public getAllTunnels(): TunnelInfo[] {
    return Array.from(this.tunnels.values()).map(
      ({ id, localPort, stats }) => ({
        id,
        localPort,
        stats,
      })
    );
  }

  public incrementRequestCount(id: string): void {
    const tunnel = this.tunnels.get(id);
    if (tunnel) {
      tunnel.stats.requestCount++;
      tunnel.stats.lastRequestTime = Date.now();
      // Decrease remaining rate limit (simple implementation)
      tunnel.stats.rateLimitRemaining = Math.max(
        0,
        tunnel.stats.rateLimitRemaining - 1
      );
    }
  }
}
