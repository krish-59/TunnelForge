import { Router } from "express";

export const apiRouter = Router();

// Placeholder: GET /api/tunnels
apiRouter.get("/tunnels", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});
