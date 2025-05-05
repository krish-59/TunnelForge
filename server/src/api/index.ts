import { Router } from "express";
import { TunnelServer } from "../tunnelServer";

export function createApiRouter(tunnelServer: TunnelServer) {
  const apiRouter = Router();

  // GET /api/tunnels - List all active tunnels
  apiRouter.get("/tunnels", (_req, res) => {
    try {
      const tunnels = tunnelServer.getTunnelManager().getAllTunnels();
      res.json({
        tunnels: tunnels.map((tunnel) => ({
          ...tunnel,
          url: `http://localhost:${tunnelServer.getPort()}/${tunnel.id}`,
          status: "connected",
        })),
      });
    } catch (error) {
      console.error("Error fetching tunnels:", error);
      res.status(500).json({ error: "Failed to fetch tunnels" });
    }
  });

  // GET /api/tunnels/:id - Get specific tunnel info
  apiRouter.get("/tunnels/:id", (req, res) => {
    try {
      const tunnel = tunnelServer.getTunnelManager().getTunnel(req.params.id);
      if (!tunnel) {
        res.status(404).json({ error: "Tunnel not found" });
        return;
      }

      res.json({
        id: tunnel.id,
        localPort: tunnel.localPort,
        url: `http://localhost:${tunnelServer.getPort()}/${tunnel.id}`,
        status: "connected",
        stats: tunnel.stats,
      });
    } catch (error) {
      console.error(`Error fetching tunnel ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to fetch tunnel info" });
    }
  });

  // GET /api/tunnels/:id/stats - Get tunnel statistics
  apiRouter.get("/tunnels/:id/stats", (req, res) => {
    try {
      const tunnel = tunnelServer.getTunnelManager().getTunnel(req.params.id);
      if (!tunnel) {
        res.status(404).json({ error: "Tunnel not found" });
        return;
      }

      const now = Date.now();
      const uptime = now - tunnel.stats.createdAt;
      const lastRequestAgo = tunnel.stats.lastRequestTime
        ? now - tunnel.stats.lastRequestTime
        : null;

      res.json({
        id: tunnel.id,
        stats: {
          ...tunnel.stats,
          uptime,
          lastRequestAgo,
          status: "connected",
          rateLimitReset: now + 15 * 60 * 1000, // 15 minutes from now
        },
      });
    } catch (error) {
      console.error(`Error fetching tunnel stats ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to fetch tunnel stats" });
    }
  });

  // DELETE /api/tunnels/:id - Close a tunnel
  apiRouter.delete("/tunnels/:id", (req, res) => {
    try {
      const success = tunnelServer
        .getTunnelManager()
        .removeTunnel(req.params.id);
      if (!success) {
        res.status(404).json({ error: "Tunnel not found" });
        return;
      }
      res.json({ message: "Tunnel closed successfully" });
    } catch (error) {
      console.error(`Error closing tunnel ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to close tunnel" });
    }
  });

  return apiRouter;
}
