import express from "express";
import path from "path";
import { createServer } from "http";
import cors from "cors";
import { TunnelServer } from "./tunnelServer";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";
import { createApiRouter } from "./api";
import {
  requestLogger,
  detailedRequestLogger,
} from "./middleware/requestLogger";

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin:
    process.env.NODE_ENV === "development"
      ? true // Allow all origins in development
      : false, // Disable CORS in production (serving frontend from same origin)
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Apply CORS middleware before other middleware
app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
if (process.env.NODE_ENV === "development") {
  app.use(detailedRequestLogger);
} else {
  app.use(requestLogger);
}

// Create HTTP server
const server = createServer(app);

// Initialize tunnel server
const tunnelServer = new TunnelServer({
  httpServer: server,
  port: Number(port),
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../../dashboard/dist")));

// API routes
app.use("/api", createApiRouter(tunnelServer));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Handle tunnel requests
app.use("/:tunnelId", (req, res, next) => {
  const tunnelId = req.params.tunnelId;
  const isTunnelRequest =
    tunnelId && tunnelId !== "api" && tunnelId !== "health";

  if (isTunnelRequest) {
    // Forward to tunnel handler
    return tunnelServer.handleTunnelRequest(req, res);
  }

  // Not a tunnel request, continue to next middleware
  next();
});

// Serve React app for any other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../dashboard/dist/index.html"));
});

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// Start the server
server.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(`WebSocket server running on ws://localhost:${port}/ws`);
  logger.info(`Dashboard available at http://localhost:${port}`);
});
