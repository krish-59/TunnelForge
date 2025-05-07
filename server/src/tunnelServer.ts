import { WebSocketServer, WebSocket } from "ws";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { TunnelManager } from "./services/tunnelManager";
import { logger } from "./utils/logger";
import { APIError } from "./middleware/errorHandler";
import { Server } from "http";

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

interface TunnelServerOptions {
  httpServer: Server;
  port: number;
}

export class TunnelServer {
  private readonly wss: WebSocketServer;
  private readonly tunnelManager: TunnelManager;
  private readonly pendingResponses: Map<string, PendingResponse>;
  private readonly port: number;

  constructor(options: TunnelServerOptions) {
    this.wss = new WebSocketServer({
      server: options.httpServer,
      path: "/ws",
      clientTracking: true,
    });
    this.tunnelManager = new TunnelManager();
    this.pendingResponses = new Map();
    this.port = options.port;
    this.setupWebSocketServer();
  }

  public getPort(): number {
    return this.port;
  }

  private setupWebSocketServer() {
    this.wss.on("connection", (socket: WebSocket) => {
      logger.info("New WebSocket connection established");

      socket.once("message", (data: Buffer) => {
        try {
          const { port } = JSON.parse(data.toString());
          if (!port || typeof port !== "number") {
            logger.warn("Invalid port received in connection data", { port });
            socket.close(1008, "Invalid port");
            return;
          }

          const tunnel = this.tunnelManager.createTunnel(socket, port);
          logger.info(`Tunnel created`, {
            tunnelId: tunnel.id,
            localPort: port,
          });

          // Send tunnel URL to client
          const tunnelUrl = `${
            process.env.PUBLIC_URL || "http://localhost:3000"
          }/${tunnel.id}`;
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
                clearTimeout(timeout);
                res.status(response.statusCode);
                Object.entries(response.headers).forEach(([key, value]) => {
                  res.setHeader(key, value);
                });
                res.end(response.body);
                this.pendingResponses.delete(response.requestId);

                logger.debug("Tunnel response sent", {
                  tunnelId: tunnel.id,
                  requestId: response.requestId,
                  statusCode: response.statusCode,
                });
              }
            } catch (err) {
              logger.error("Failed to handle tunnel response", {
                error: err,
                tunnelId: tunnel.id,
              });
            }
          });

          socket.on("close", () => {
            logger.info(`Tunnel disconnected`, { tunnelId: tunnel.id });
            // Clean up any pending responses for this tunnel
            for (const [
              requestId,
              { res },
            ] of this.pendingResponses.entries()) {
              res.status(504).json({ error: "Tunnel disconnected" });
              this.pendingResponses.delete(requestId);
            }
            this.tunnelManager.removeTunnel(tunnel.id);
          });

          socket.on("error", (error) => {
            logger.error("WebSocket error", {
              error,
              tunnelId: tunnel.id,
            });
          });
        } catch (err) {
          logger.error("Failed to parse tunnel connection data", {
            error: err,
          });
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
      handler: (req: Request) => {
        const tunnelId = this.getTunnelIdFromRequest(req);
        throw new APIError(429, "Rate limit exceeded", { tunnelId });
      },
    });
  }

  // Handle incoming HTTP requests to tunnels
  public async handleTunnelRequest(req: Request, res: Response) {
    const tunnelId = this.getTunnelIdFromRequest(req);
    if (!tunnelId) {
      throw new APIError(404, "Invalid tunnel URL");
    }

    const tunnel = this.tunnelManager.getTunnel(tunnelId);
    if (!tunnel) {
      throw new APIError(404, "Tunnel not found", { tunnelId });
    }

    // Check if tunnel has exceeded rate limit
    if (tunnel.stats.rateLimitRemaining <= 0) {
      throw new APIError(429, "Rate limit exceeded", {
        tunnelId,
        resetTime: tunnel.stats.rateLimitReset,
      });
    }

    // Increment request count
    this.tunnelManager.incrementRequestCount(tunnelId);

    try {
      const requestId = uuidv4();
      const tunnelRequest: TunnelRequest = {
        type: "request",
        requestId,
        method: req.method,
        path: req.path.replace(`/${tunnelId}`, ""),
        headers: req.headers as Record<string, string>,
        body: req.body,
      };

      // Set a timeout for the response
      const timeout = setTimeout(() => {
        const pending = this.pendingResponses.get(requestId);
        if (pending) {
          pending.res.status(504).json({ error: "Request timeout" });
          this.pendingResponses.delete(requestId);
          logger.warn("Request timeout", {
            tunnelId,
            requestId,
          });
        }
      }, 30000); // 30 second timeout

      // Store the response object and timeout
      this.pendingResponses.set(requestId, { res, timeout });

      // Send the request through the tunnel
      tunnel.socket.send(JSON.stringify(tunnelRequest));

      logger.debug("Tunnel request sent", {
        tunnelId,
        requestId,
        method: req.method,
        path: req.path,
      });
    } catch (error: unknown) {
      logger.error("Failed to handle tunnel request", {
        error,
        tunnelId,
      });
      throw new APIError(500, "Failed to process tunnel request", { tunnelId });
    }
  }

  private getTunnelIdFromRequest(req: Request): string | null {
    const match = req.path.match(/^\/([^\/]+)(\/.*)?$/);
    return match ? match[1] : null;
  }

  public getTunnelManager(): TunnelManager {
    return this.tunnelManager;
  }
}
