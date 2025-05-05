import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TunnelManager } from "./services/tunnelManager";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";

interface TunnelServerOptions {
  httpServer: HttpServer;
  port: number;
}

interface TunnelRequest {
  type: "request";
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  requestId: string;
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
                const { res, timeout } = pendingResponse;
                clearTimeout(timeout); // Clear timeout since we got a response
                res.status(response.statusCode);
                Object.entries(response.headers).forEach(([key, value]) => {
                  res.setHeader(key, value);
                });
                res.end(response.body);
                this.pendingResponses.delete(response.requestId);
              }
            } catch (err) {
              console.error("Failed to handle tunnel response:", err);
            }
          });

          socket.on("close", () => {
            console.log(`Tunnel ${tunnel.id} disconnected`);
            // Clean up any pending responses for this tunnel
            for (const [
              requestId,
              { res },
            ] of this.pendingResponses.entries()) {
              res.status(504).json({ error: "Tunnel disconnected" });
              this.pendingResponses.delete(requestId);
            }
          });
        } catch (err) {
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

    try {
      // Create a unique ID for this request
      const requestId = uuidv4();

      // Prepare the tunnel request
      const tunnelRequest: TunnelRequest = {
        type: "request",
        requestId,
        method: req.method,
        path: req.path.replace(`/${tunnelId}`, ""), // Remove tunnel ID from path
        headers: req.headers as Record<string, string>,
        body: req.body,
      };

      // Set a timeout for the response
      const timeout = setTimeout(() => {
        const pending = this.pendingResponses.get(requestId);
        if (pending) {
          pending.res.status(504).json({ error: "Request timeout" });
          this.pendingResponses.delete(requestId);
        }
      }, 30000); // 30 second timeout

      // Store the response object and timeout
      this.pendingResponses.set(requestId, { res, timeout });

      // Send the request through the tunnel
      tunnel.socket.send(JSON.stringify(tunnelRequest));
    } catch (error: unknown) {
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

  public getPort(): number {
    return this.port;
  }
}
