import express, { Request, Response } from "express";
import { TunnelServer } from "./tunnelServer";
import { createApiRouter } from "./api";

const PORT = process.env.TUNNEL_SERVER_PORT
  ? Number(process.env.TUNNEL_SERVER_PORT)
  : 3000;

async function bootstrap() {
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Initialize core tunnel server logic (WebSocket / proxy etc.)
  const httpServer = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`TunnelForge server listening on port ${PORT}`);
  });

  const tunnelServer = new TunnelServer({ httpServer, port: PORT });
  tunnelServer.start();

  // Attach API routes
  app.use("/api", createApiRouter(tunnelServer));

  // Apply rate limiting to tunnel requests
  app.use(tunnelServer.getRateLimiter());

  // Handle tunnel requests - all paths except /api and /health
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health") {
      next();
      return;
    }
    tunnelServer.handleTunnelRequest(req, res);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
