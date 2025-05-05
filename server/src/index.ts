import express, { Request, Response } from "express";
import { TunnelServer } from "./tunnelServer";

const PORT = process.env.TUNNEL_SERVER_PORT
  ? Number(process.env.TUNNEL_SERVER_PORT)
  : 3000;

async function bootstrap() {
  const app = express();

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Attach API routes
  import("./api").then(({ apiRouter }) => {
    app.use("/api", apiRouter);
  });

  // Start HTTP server
  const httpServer = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`TunnelForge server listening on port ${PORT}`);
  });

  // Initialize core tunnel server logic (WebSocket / proxy etc.)
  const tunnelServer = new TunnelServer({ httpServer });
  tunnelServer.start();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
