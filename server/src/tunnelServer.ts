import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TunnelManager } from "./services/tunnelManager";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import httpProxy from "http-proxy";

interface TunnelServerOptions {
  httpServer: HttpServer;
  port: number;
}

interface TunnelRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

interface TunnelResponse {
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
}

interface PendingResponse {
  res: Response;
  timeout: NodeJS.Timeout;
}

export class TunnelServer {
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly tunnelManager: TunnelManager;
  private readonly proxy: httpProxy;
  private readonly pendingResponses: Map<string, PendingResponse>;
  private readonly port: number;

  constructor(options: TunnelServerOptions) {
    this.httpServer = options.httpServer;
    this.port = options.port;
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: "/connect",
    });
    this.tunnelManager = new TunnelManager();
    this.proxy = httpProxy.createProxyServer();
    this.pendingResponses = new Map();
  }

  public start() {
    this.wss.on("connection", (socket: WebSocket) => {
      socket.once("message", (data: Buffer) => {
        try {
          const { port } = JSON.parse(data.toString());
          if (!port || typeof port !== "number") {
            socket.close(1008, "Invalid port");
            return;
          }

          const tunnel = this.tunnelManager.createTunnel(socket, port);
          console.log(`Tunnel created: ${tunnel.id} -> localhost:${port}`);

          // Send tunnel URL to client
          const tunnelUrl = `http://localhost:${this.port}/${tunnel.id}`;
          socket.send(
            JSON.stringify({
              type: "tunnel_created",
              url: tunnelUrl,
              id: tunnel.id,
            })
          );

          // Handle tunnel messages
          socket.on("message", (message: Buffer) => {
            try {
              const response: TunnelResponse = JSON.parse(message.toString());
              const pendingResponse = this.pendingResponses.get(
                response.requestId
              );
              if (pendingResponse) {
                const { res } = pendingResponse;
                res.status(response.statusCode);
                Object.entries(response.headers).forEach(([key, value]) => {
                  res.setHeader(key, value);
                });
                res.end(response.body);
                this.pendingResponses.delete(response.requestId);
              }
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error("Failed to handle tunnel response:", err);
            }
          });

          socket.on("close", () => {
            // eslint-disable-next-line no-console
            console.log(`Tunnel ${tunnel.id} disconnected`);
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Failed to parse tunnel connection data:", err);
          socket.close(1008, "Invalid connection data");
        }
      });
    });
  }

  // Rate limiting middleware
  public getRateLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each tunnel to 100 requests per windowMs
      message: "Too many requests from this tunnel, please try again later",
      keyGenerator: (req: Request): string => {
        const tunnelId = this.getTunnelIdFromRequest(req);
        return tunnelId || req.ip || "default";
      },
      skipFailedRequests: true,
    });
  }

  // Handle incoming HTTP requests to tunnels
  public async handleTunnelRequest(req: Request, res: Response) {
    const tunnelId = this.getTunnelIdFromRequest(req);
    if (!tunnelId) {
      res.status(404).json({ error: "Invalid tunnel URL" });
      return;
    }

    const tunnel = this.tunnelManager.getTunnel(tunnelId);
    if (!tunnel) {
      res.status(404).json({ error: "Tunnel not found" });
      return;
    }

    // Check if tunnel has exceeded rate limit
    if (tunnel.stats.rateLimitRemaining <= 0) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    // Increment request count
    this.tunnelManager.incrementRequestCount(tunnelId);

    // Forward request to local target
    const targetUrl = `http://localhost:${tunnel.localPort}`;

    try {
      this.proxy.web(req, res, { target: targetUrl }, (error: Error) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error(`Proxy error for tunnel ${tunnelId}:`, error);
          res.status(502).json({ error: "Failed to proxy request" });
        }
      });
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error(`Failed to handle request for tunnel ${tunnelId}:`, error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  private getTunnelIdFromRequest(req: Request): string | null {
    // Extract tunnel ID from URL path: /:tunnelId/*
    const match = req.path.match(/^\/([^\/]+)(\/.*)?$/);
    return match ? match[1] : null;
  }

  public getTunnelManager(): TunnelManager {
    return this.tunnelManager;
  }
}
