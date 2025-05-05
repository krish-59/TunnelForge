import { Router } from "express";
import { TunnelServer } from "../tunnelServer";

export function createApiRouter(tunnelServer: TunnelServer) {
  const apiRouter = Router();

  // GET /api/tunnels - List all active tunnels
  apiRouter.get("/tunnels", (_req, res) => {
    const tunnels = tunnelServer.getTunnelManager().getAllTunnels();
    res.json({ tunnels });
  });

  // GET /api/tunnels/:id - Get specific tunnel info
  apiRouter.get("/tunnels/:id", (req, res) => {
    const tunnel = tunnelServer.getTunnelManager().getTunnel(req.params.id);
    if (!tunnel) {
      res.status(404).json({ error: "Tunnel not found" });
      return;
    }
    res.json({
      id: tunnel.id,
      localPort: tunnel.localPort,
      stats: tunnel.stats,
    });
  });

  return apiRouter;
}
