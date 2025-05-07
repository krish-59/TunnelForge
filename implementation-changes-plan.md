# TunnelForge Implementation Changes Plan

## Overview

This document outlines the comprehensive changes required to transform TunnelForge from its current WebSocket-based implementation to a more sophisticated, ngrok-like tunneling service with both DNS-based subdomain allocation and a more robust tunneling protocol. The changes are organized by component and include code-level modifications.

## High-Level Architectural Changes

### 1. Current vs. Proposed Architecture

**Current Architecture:**
- Single WebSocket connection per tunnel
- Path-based routing (`http://server:3000/{tunnelId}/...`)
- Simplified request/response handling
- Limited error recovery
- HTTP tunneling only

**Proposed Architecture:**
- Separate control and data connections
- Connection pooling for efficient concurrent request handling
- DNS-based subdomain allocation (`xyz.tunnelforge.io`)
- TLS encryption throughout
- Support for HTTP(S) and TCP tunneling
- Robust error handling and reconnection
- Scalable for production use

### 2. Component Changes Summary

1. **Connection Protocol** - Switch from single WebSocket to separate control/data channels
2. **Routing Mechanism** - Replace path-based routing with subdomain-based routing
3. **Encryption** - Implement end-to-end TLS for all connections
4. **Protocol Support** - Add TCP tunneling in addition to HTTP
5. **Server Infrastructure** - Add Nginx as reverse proxy for subdomain handling
6. **Authentication** - Add token-based authentication for tunnels
7. **Scaling & Persistence** - Add shared state management for multi-server support

## Detailed Implementation Changes

### 1. TunnelServer Component

#### Current Issues:
- Single WebSocket for both control and data
- Limited concurrency
- Path-based routing
- No authentication mechanism

#### Required Changes:

```typescript
// tunnelServer.ts

// NEW: Add types for different connection types
interface ControlConnection {
  socket: WebSocket;
  tunnelId: string;
  authenticated: boolean;
  lastHeartbeat: number;
}

interface DataConnection {
  socket: WebSocket;
  tunnelId: string;
  connectionId: string;
  inUse: boolean;
  established: number;
}

export class TunnelServer {
  // NEW: Separate connection tracking
  private readonly controlConnections: Map<string, ControlConnection>;
  private readonly dataConnectionPools: Map<string, DataConnection[]>;
  private readonly subdomainToTunnelMap: Map<string, string>;
  private readonly pendingResponses: Map<string, PendingResponse>;
  
  constructor(options: TunnelServerOptions) {
    // MODIFIED: Create two separate WebSocket servers
    this.controlWss = new WebSocketServer({
      server: options.httpServer,
      path: "/tunnel/control",
      clientTracking: true,
    });
    
    this.dataWss = new WebSocketServer({
      server: options.httpServer,
      path: "/tunnel/data",
      clientTracking: true,
    });
    
    this.controlConnections = new Map();
    this.dataConnectionPools = new Map();
    this.subdomainToTunnelMap = new Map();
    this.pendingResponses = new Map();
    
    this.setupControlWebSocketServer();
    this.setupDataWebSocketServer();
    
    // NEW: Set up connection monitoring
    setInterval(() => this.monitorConnections(), 30000);
  }
  
  // NEW: Connection pool management
  private getAvailableDataConnection(tunnelId: string): DataConnection | null {
    const pool = this.dataConnectionPools.get(tunnelId) || [];
    const conn = pool.find(c => !c.inUse);
    
    if (conn) {
      conn.inUse = true;
      return conn;
    }
    
    // No available connection - request a new one
    this.requestNewDataConnection(tunnelId);
    return null;
  }
  
  private releaseDataConnection(connectionId: string, tunnelId: string): void {
    const pool = this.dataConnectionPools.get(tunnelId) || [];
    const conn = pool.find(c => c.connectionId === connectionId);
    
    if (conn) {
      conn.inUse = false;
    }
  }
  
  private requestNewDataConnection(tunnelId: string): void {
    const control = this.controlConnections.get(tunnelId);
    if (control && control.socket.readyState === WebSocket.OPEN) {
      control.socket.send(JSON.stringify({
        type: "open_data_connection",
        tunnelId
      }));
    }
  }
  
  // NEW: Monitoring active connections
  private monitorConnections(): void {
    const now = Date.now();
    
    // Check control connections for timeouts
    for (const [tunnelId, conn] of this.controlConnections.entries()) {
      if (now - conn.lastHeartbeat > 60000) { // 1 minute timeout
        logger.warn(`Control connection timeout for tunnel ${tunnelId}`);
        // Close the connection
        conn.socket.close(1001, "Connection timeout");
        this.controlConnections.delete(tunnelId);
        
        // Clean up associated resources
        this.closeDataConnections(tunnelId);
        this.cleanupPendingResponses(tunnelId);
      }
    }
    
    // Ensure minimum pool size for each tunnel
    for (const [tunnelId, pool] of this.dataConnectionPools.entries()) {
      const availableCount = pool.filter(c => !c.inUse).length;
      if (availableCount < 3) { // Maintain at least 3 available connections
        // Request more connections
        for (let i = 0; i < 3 - availableCount; i++) {
          this.requestNewDataConnection(tunnelId);
        }
      }
    }
  }
  
  // MODIFIED: Handle tunnel requests with subdomain routing
  public async handleTunnelRequest(req: Request, res: Response) {
    // Get tunnel ID from hostname instead of path
    const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
    const tunnelId = this.getTunnelIdFromHostname(hostname);
    
    if (!tunnelId) {
      throw new APIError(404, "Invalid tunnel hostname");
    }
    
    // Get an available data connection
    const dataConn = this.getAvailableDataConnection(tunnelId);
    
    if (!dataConn) {
      // No available connection, see if we can wait
      if (this.dataConnectionPools.has(tunnelId)) {
        // We have a pool but all connections in use, queue the request
        return this.queueRequest(req, res, tunnelId);
      } else {
        throw new APIError(503, "Tunnel has no active data connections");
      }
    }
    
    // Process the request through the data connection
    const requestId = uuidv4();
    try {
      const tunnelRequest = {
        type: "request",
        requestId,
        method: req.method,
        path: req.path,
        headers: req.headers as Record<string, string>,
        body: req.body
      };
      
      // Set up timeout handler
      const timeout = setTimeout(() => {
        const pending = this.pendingResponses.get(requestId);
        if (pending) {
          pending.res.status(504).json({ error: "Request timeout" });
          this.pendingResponses.delete(requestId);
          this.releaseDataConnection(dataConn.connectionId, tunnelId);
        }
      }, 30000);
      
      this.pendingResponses.set(requestId, { res, timeout, connectionId: dataConn.connectionId });
      dataConn.socket.send(JSON.stringify(tunnelRequest));
    } catch (error) {
      this.releaseDataConnection(dataConn.connectionId, tunnelId);
      throw new APIError(500, "Failed to process tunnel request");
    }
  }
  
  // NEW: Get tunnel ID from hostname
  private getTunnelIdFromHostname(hostname: string): string | null {
    const subdomainMatch = hostname.match(/^([^.]+)\.tunnelforge\.io$/i);
    if (!subdomainMatch) return null;
    
    const subdomain = subdomainMatch[1];
    return this.subdomainToTunnelMap.get(subdomain) || null;
  }
}
```

### 2. Tunnel Agent/Client Changes

#### Current Issues:
- Single connection model
- Limited error recovery
- No authentication
- HTTP only

#### Required Changes:

```typescript
// connect.ts

interface ConnectionOptions extends TunnelOptions {
  tunnelId?: string;
  authToken: string;
  subdomain?: string;
}

// Main tunnel client function
async function startTunnel(options: ConnectionOptions) {
  let tunnelId: string | null = null;
  let reconnectAttempts = 0;
  
  // Authentication token required
  if (!options.authToken) {
    console.error(chalk.red("Error: Authentication token is required"));
    process.exit(1);
  }
  
  // Function to establish control connection
  const connectControl = async (): Promise<WebSocket> => {
    try {
      // Determine proper WebSocket protocol (ws/wss)
      const protocol = options.server.startsWith('https') ? 'wss' : 'ws';
      const serverUrl = options.server.replace(/^https?:\/\//, '');
      const controlUrl = `${protocol}://${serverUrl}/tunnel/control`;
      
      const ws = new WebSocket(controlUrl);
      
      return new Promise((resolve, reject) => {
        ws.on('open', () => {
          console.log(chalk.green("Control channel connected"));
          
          // Register tunnel with server
          ws.send(JSON.stringify({
            type: "register_tunnel",
            auth_token: options.authToken,
            protocol: "http", // or "tcp" if supporting that
            local_port: options.port,
            options: {
              subdomain: options.subdomain
            }
          }));
          
          resolve(ws);
        });
        
        ws.on('error', (err) => {
          reject(err);
        });
      });
    } catch (err) {
      console.error(chalk.red("Failed to establish control connection:", err));
      throw err;
    }
  };
  
  // Function to open data connection
  const openDataConnection = async (tunnelId: string): Promise<void> => {
    try {
      const protocol = options.server.startsWith('https') ? 'wss' : 'ws';
      const serverUrl = options.server.replace(/^https?:\/\//, '');
      const dataUrl = `${protocol}://${serverUrl}/tunnel/data`;
      
      const dataWs = new WebSocket(dataUrl);
      
      // Setup data connection
      dataWs.on('open', () => {
        // Register as data connection for this tunnel
        const connectionId = uuidv4();
        dataWs.send(JSON.stringify({
          type: "data_connection",
          tunnel_id: tunnelId,
          connection_id: connectionId
        }));
        
        // Handle incoming requests
        dataWs.on('message', async (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            
            if (message.type === "request") {
              // Forward request to local server
              const response = await handleTunnelRequest(message, options.port);
              dataWs.send(JSON.stringify(response));
            }
          } catch (err) {
            console.error(chalk.red("Error handling data message:", err));
          }
        });
        
        // Handle data connection closing
        dataWs.on('close', () => {
          console.log(chalk.yellow("Data connection closed, opening replacement"));
          // Open a replacement connection
          setTimeout(() => openDataConnection(tunnelId), 1000);
        });
      });
    } catch (err) {
      console.error(chalk.red("Failed to open data connection:", err));
      // Retry with backoff
      setTimeout(() => openDataConnection(tunnelId), 5000);
    }
  };
  
  // Connect and set up heartbeat
  try {
    const controlWs = await connectControl();
    
    // Setup heartbeat
    const heartbeatInterval = setInterval(() => {
      if (controlWs.readyState === WebSocket.OPEN && tunnelId) {
        controlWs.send(JSON.stringify({
          type: "keep_alive",
          tunnel_id: tunnelId
        }));
      }
    }, 30000);
    
    // Handle control messages
    controlWs.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "tunnel_registered":
            tunnelId = message.tunnel_id;
            console.log(chalk.green(`\nTunnel established! Your URL is: ${message.url}`));
            console.log(chalk.gray("\nPress Ctrl+C to stop the tunnel\n"));
            
            // Set up initial data connections (3-5)
            for (let i = 0; i < 3; i++) {
              await openDataConnection(tunnelId);
            }
            break;
            
          case "open_data_connection":
            if (tunnelId) {
              openDataConnection(tunnelId);
            }
            break;
            
          case "error":
            console.error(chalk.red(`Server error: ${message.message} (${message.code})`));
            break;
        }
      } catch (err) {
        console.error(chalk.red("Failed to handle control message:", err));
      }
    });
    
    // Handle control connection closure
    controlWs.on('close', () => {
      clearInterval(heartbeatInterval);
      console.log(chalk.yellow("\nControl connection closed"));
      
      // Implement reconnection with exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;
      
      console.log(chalk.yellow(`Reconnecting in ${backoffTime/1000}s...`));
      setTimeout(() => startTunnel(options), backoffTime);
    });
    
  } catch (err) {
    console.error(chalk.red("Failed to start tunnel:", err));
    
    // Implement reconnection with exponential backoff
    const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    
    console.log(chalk.yellow(`Reconnecting in ${backoffTime/1000}s...`));
    setTimeout(() => startTunnel(options), backoffTime);
  }
}
```

### 3. API and Dashboard Integration

#### Required Changes:

```typescript
// api/index.ts

export function createApiRouter(tunnelServer: TunnelServer) {
  const apiRouter = Router();
  
  // Modified to include subdomain information
  apiRouter.get("/tunnels", (_req, res) => {
    try {
      const tunnels = tunnelServer.getTunnelManager().getAllTunnels();
      res.json({
        tunnels: tunnels.map((tunnel) => ({
          ...tunnel,
          url: `https://${tunnel.subdomain}.tunnelforge.io`,
          status: "connected",
        })),
      });
    } catch (error) {
      console.error("Error fetching tunnels:", error);
      res.status(500).json({ error: "Failed to fetch tunnels" });
    }
  });
  
  // Add new endpoint for connection pool metrics
  apiRouter.get("/tunnels/:id/connections", (req, res) => {
    try {
      const connectionStats = tunnelServer.getConnectionStats(req.params.id);
      if (!connectionStats) {
        res.status(404).json({ error: "Tunnel not found" });
        return;
      }
      
      res.json(connectionStats);
    } catch (error) {
      console.error(`Error fetching connection stats for ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to fetch connection stats" });
    }
  });
  
  // Add authentication token management
  apiRouter.post("/auth/tokens", authenticateUser, (req, res) => {
    try {
      const { name, permissions } = req.body;
      const token = tunnelServer.createAuthToken(req.user.id, name, permissions);
      res.status(201).json(token);
    } catch (error) {
      console.error(`Error creating auth token:`, error);
      res.status(500).json({ error: "Failed to create auth token" });
    }
  });
  
  return apiRouter;
}
```

### 4. Nginx Configuration and TLS Setup

Create a new file for nginx configuration and setup instructions:

```nginx
# /etc/nginx/sites-available/tunnelforge

# Main domain and www
server {
    listen 80;
    server_name tunnelforge.io www.tunnelforge.io;
    
    # Redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tunnelforge.io www.tunnelforge.io;
    
    ssl_certificate /etc/letsencrypt/live/tunnelforge.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnelforge.io/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/tunnelforge.io/chain.pem;
    
    # Strong SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_ecdh_curve secp384r1;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubdomains; preload" always;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300;
    }
}

# Wildcard subdomains for tunnels
server {
    listen 80;
    server_name ~^(?<subdomain>.+)\.tunnelforge\.io$;
    
    # Redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ~^(?<subdomain>.+)\.tunnelforge\.io$;
    
    ssl_certificate /etc/letsencrypt/live/tunnelforge.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnelforge.io/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/tunnelforge.io/chain.pem;
    
    # Same SSL configuration as above
    
    # Proxy to Node.js application with subdomain
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tunnel-Subdomain $subdomain;
        proxy_buffering off;
        proxy_read_timeout 300;
    }
}
```

### 5. Database Schema Updates (Optional, for persistent tunnels)

If implementing persistent tunnel registration:

```sql
-- Create auth_tokens table
CREATE TABLE auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP
);

-- Create reserved_subdomains table 
CREATE TABLE reserved_subdomains (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  subdomain VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  CONSTRAINT valid_subdomain CHECK (subdomain ~* '^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$')
);

-- Create tunnel_logs table for metrics
CREATE TABLE tunnel_logs (
  id SERIAL PRIMARY KEY,
  tunnel_id VARCHAR(64) NOT NULL,
  subdomain VARCHAR(64) NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0,
  bytes_in BIGINT NOT NULL DEFAULT 0,
  bytes_out BIGINT NOT NULL DEFAULT 0,
  avg_response_time FLOAT
);
```

## Infrastructure Needs

### Production Server Requirements

1. **Web Server**
   - Nginx for SSL termination and subdomain routing
   - Let's Encrypt for SSL certificates

2. **Application Server**
   - Node.js environment (v14+)
   - PM2 or similar for process management
   - 2+ CPU cores, 4GB+ RAM recommended

3. **DNS Configuration**
   - Domain with wildcard DNS support
   - API access to DNS provider for automation
   
4. **Monitoring**
   - Server monitoring (CPU, memory, network)
   - Application monitoring with structured logging
   - Tunnel health monitoring

### Multi-Server Setup (Optional)

For high availability:

1. **Shared State**
   - Redis for distributed connection tracking
   - Database for persistent data

2. **Load Balancing**
   - Nginx or cloud load balancer
   - Sticky sessions required for WebSockets

## Deployment Process

### SSL Certificate Setup

```bash
# Install Certbot
apt-get update
apt-get install certbot python3-certbot-nginx

# Get wildcard certificate (will require DNS verification)
certbot certonly --manual --preferred-challenges dns \
  --server https://acme-v02.api.letsencrypt.org/directory \
  -d tunnelforge.io -d *.tunnelforge.io

# Set up auto-renewal cron job
echo "0 3 * * * /usr/bin/certbot renew --quiet" | crontab -
```

### Nginx Configuration

```bash
# Install Nginx
apt-get install nginx

# Copy configuration
cp nginx/tunnelforge.conf /etc/nginx/sites-available/

# Enable the site
ln -s /etc/nginx/sites-available/tunnelforge.conf /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Reload Nginx
systemctl reload nginx
```

### Application Deployment

```bash
# Clone the repository
git clone https://github.com/username/tunnelforge.git
cd tunnelforge

# Install dependencies
npm install

# Build the application
npm run build

# Set up PM2
npm install -g pm2
pm2 start dist/index.js --name tunnelforge

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

## Testing Procedure

1. **Local Testing**
   - Test control connection establishment
   - Test data connection pooling
   - Test HTTP request forwarding
   - Test connection resilience (disconnect/reconnect)

2. **Subdomain Testing**
   - Test subdomain allocation
   - Test HTTPS with certificates
   - Test request routing by subdomain

3. **Load Testing**
   - Test with concurrent connections
   - Test connection pool scaling
   - Measure latency and throughput 