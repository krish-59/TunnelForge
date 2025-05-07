#!/usr/bin/env node
import WebSocket from "ws";
import { program } from "commander";
import http from "http";
import chalk from "chalk";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

interface TunnelOptions {
  port: number;
  server: string;
}

interface TunnelRequest {
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

program
  .name("tunnelforge")
  .description("Create a secure tunnel to your local server")
  .option("-p, --port <number>", "Local port to tunnel", parseInt)
  .option(
    "-s, --server <url>",
    "TunnelForge server URL",
    "ws://localhost:3000/ws"
  )
  .version("0.1.0");

program.parse();

const options = program.opts<TunnelOptions>();

if (!options.port) {
  console.error(chalk.red("Error: Port number is required"));
  program.help();
}

async function handleTunnelRequest(
  request: TunnelRequest,
  localPort: number
): Promise<TunnelResponse> {
  try {
    // Forward the request to local server
    const response = await axios({
      method: request.method,
      url: `http://localhost:${localPort}${request.path}`,
      headers: request.headers,
      data: request.body,
      validateStatus: () => true, // Accept any status code
    });

    // Prepare tunnel response
    const tunnelResponse: TunnelResponse = {
      requestId: request.requestId,
      statusCode: response.status,
      headers: response.headers as Record<string, string>,
      body:
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data),
    };

    return tunnelResponse;
  } catch (error: any) {
    console.error(chalk.red(`Error forwarding request: ${error.message}`));
    // Return error response
    return {
      requestId: request.requestId,
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "Failed to forward request to local server",
      }),
    };
  }
}

async function startTunnel(options: TunnelOptions) {
  const ws = new WebSocket(options.server);

  ws.on("open", () => {
    console.log(chalk.green("Connected to TunnelForge server"));
    // Send initial connection data
    ws.send(JSON.stringify({ port: options.port }));
  });

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "tunnel_created") {
        console.log(
          chalk.green(`\nTunnel established! Your URL is: ${message.url}`)
        );
        console.log(chalk.gray("\nPress Ctrl+C to stop the tunnel\n"));
      } else if (message.type === "request") {
        // Handle incoming tunnel request
        console.log(chalk.blue(`→ ${message.method} ${message.path}`));

        const response = await handleTunnelRequest(message, options.port);

        // Send response back through tunnel
        ws.send(JSON.stringify(response));

        console.log(chalk.green(`← ${response.statusCode} ${message.path}`));
      }
    } catch (err) {
      console.error(chalk.red("Failed to handle message:", err));
    }
  });

  ws.on("close", () => {
    console.log(chalk.yellow("\nTunnel connection closed"));
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error(chalk.red("WebSocket error:", err));
    process.exit(1);
  });

  // Check if local server is running
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${options.port}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      req.on("error", reject);
    });
    console.log(
      chalk.green(`✓ Local server is running on port ${options.port}`)
    );
  } catch (err) {
    console.warn(
      chalk.yellow(
        `! Warning: Could not connect to local server on port ${options.port}`
      )
    );
    console.log(
      chalk.gray(
        "  Make sure your local server is running before using the tunnel"
      )
    );
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log(chalk.yellow("\nShutting down tunnel..."));
  process.exit(0);
});

startTunnel(options).catch((err) => {
  console.error(chalk.red("Failed to start tunnel:", err));
  process.exit(1);
});
