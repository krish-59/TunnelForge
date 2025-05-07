# TLS-Based Implementation Changes Plan

## Overview

This document outlines the necessary changes to transform TunnelForge from a WebSocket-based implementation to a more accurate ngrok-like tunneling service using direct TLS connections. This aligns with ngrok's actual approach of using "secure, outbound persistent TLS connections" instead of WebSockets.

## Architectural Changes Summary

### Current Architecture (WebSocket-based)
- Single WebSocket connection per tunnel
- WebSocket protocol handles framing, keepalive, etc.
- Path-based routing (`http://server:3000/{tunnelId}/...`)
- JSON messages for both control and data
- Limited connection pooling

### Proposed Architecture (TLS-based)
- Direct TLS connections for both control and data channels
- Custom message framing protocol
- Multiple pooled data connections per tunnel
- DNS-based subdomain routing
- Binary-efficient protocol for data transfers
- Connection health monitoring and resilience

## Server-Side Changes

### 1. Replace WebSocket Server with TLS Server

**Current Code:**
```typescript
// tunnelServer.ts
import { WebSocketServer, WebSocket } from "ws";

export class TunnelServer {
  private readonly wss: WebSocketServer;
  
  constructor(options: TunnelServerOptions) {
    this.wss = new WebSocketServer({
      server: options.httpServer,
      path: "/ws",
      clientTracking: true,
    });
    
    this.setupWebSocketServer();
  }
}
```

**New Implementation:**
```typescript
// tunnelServer.ts
import * as tls from 'tls';
import * as net from 'net';
import * as fs from 'fs';

export class TunnelServer {
  private readonly tlsServer: tls.Server;
  private readonly controlConnections: Map<string, ControlConnection>;
  private readonly dataConnectionPools: Map<string, DataConnection[]>;
  
  constructor(options: TunnelServerOptions) {
    this.tlsServer = tls.createServer({
      key: fs.readFileSync(options.keyPath),
      cert: fs.readFileSync(options.certPath),
      requestCert: false,
      rejectUnauthorized: false
    });
    
    this.controlConnections = new Map();
    this.dataConnectionPools = new Map();
    
    this.setupTLSServer();
  }
  
  private setupTLSServer() {
    this.tlsServer.on('secureConnection', (socket) => {
      console.log('New TLS connection established');
      
      // Set up message handling
      this.handleNewConnection(socket);
    });
    
    this.tlsServer.on('error', (err) => {
      console.error('TLS server error:', err);
    });
  }
  
  private handleNewConnection(socket: tls.TLSSocket) {
    readMessage(socket)
      .then(data => {
        const message = JSON.parse(data.toString());
        
        // Route based on message type
        if (message.type === 'register_tunnel') {
          this.handleTunnelRegistration(socket, message);
        } else if (message.type === 'data_connection') {
          this.handleDataConnection(socket, message);
        } else {
          console.warn('Unknown initial message type:', message.type);
          socket.destroy();
        }
      })
      .catch(err => {
        console.error('Error handling initial message:', err);
        socket.destroy();
      });
  }
}
```

### 2. Implement Message Framing

Add utility functions for the custom message framing protocol:

```typescript
// messageFraming.ts
import * as tls from 'tls';

export function readMessage(socket: tls.TLSSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    socket.once('readable', () => {
      const lengthBuffer = socket.read(4);
      if (!lengthBuffer) {
        socket.once('readable', () => readMessage(socket).then(resolve).catch(reject));
        return;
      }
      
      const messageLength = lengthBuffer.readUInt32BE(0);
      
      // Read message body
      const messageBuffer = socket.read(messageLength);
      if (!messageBuffer) {
        // Not enough data available yet, wait for more
        socket.once('readable', () => {
          const fullMessage = socket.read(messageLength);
          if (fullMessage) {
            resolve(fullMessage);
          } else {
            // In real implementation, handle partial reads more gracefully
            socket.once('readable', () => readMessage(socket).then(resolve).catch(reject));
          }
        });
        return;
      }
      
      resolve(messageBuffer);
    });
  });
}

export function writeMessage(socket: tls.TLSSocket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);
    
    const canContinue = socket.write(Buffer.concat([lengthBuffer, data]), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
    
    if (!canContinue) {
      socket.once('drain', resolve);
    }
  });
}
```

### 3. Connection Pool Management

Implement connection pooling for data connections:

```typescript
// connectionPool.ts
import * as tls from 'tls';
import { writeMessage } from './messageFraming';

export class ConnectionPool {
  private readonly tunnelId: string;
  private readonly connections: DataConnection[] = [];
  private readonly minPoolSize: number = 3;
  private readonly maxPoolSize: number = 10;
  
  constructor(tunnelId: string, controlConnection: ControlConnection) {
    this.tunnelId = tunnelId;
    this.controlConnection = controlConnection;
  }
  
  public addConnection(socket: tls.TLSSocket, connectionId: string): DataConnection {
    const conn: DataConnection = {
      socket,
      connectionId,
      inUse: false,
      established: Date.now(),
      lastUsed: Date.now()
    };
    
    this.connections.push(conn);
    
    // Set up cleanup on socket close
    socket.on('close', () => {
      this.removeConnection(connectionId);
      this.ensureMinimumPoolSize();
    });
    
    return conn;
  }
  
  public getConnection(): DataConnection | null {
    // Find an available connection
    const conn = this.connections.find(c => !c.inUse);
    
    if (conn) {
      conn.inUse = true;
      conn.lastUsed = Date.now();
      return conn;
    }
    
    // No available connection, request more if not at max
    if (this.connections.length < this.maxPoolSize) {
      this.requestNewConnection();
    }
    
    return null;
  }
  
  public releaseConnection(connectionId: string): void {
    const conn = this.connections.find(c => c.connectionId === connectionId);
    if (conn) {
      conn.inUse = false;
      conn.lastUsed = Date.now();
    }
  }
  
  private removeConnection(connectionId: string): void {
    const index = this.connections.findIndex(c => c.connectionId === connectionId);
    if (index !== -1) {
      this.connections.splice(index, 1);
    }
  }
  
  private ensureMinimumPoolSize(): void {
    const availableCount = this.connections.filter(c => !c.inUse).length;
    const totalCount = this.connections.length;
    
    // Request new connections if we're below minimum
    const neededConnections = Math.min(
      this.minPoolSize - availableCount,
      this.maxPoolSize - totalCount
    );
    
    for (let i = 0; i < neededConnections; i++) {
      this.requestNewConnection();
    }
  }
  
  private requestNewConnection(): void {
    if (this.controlConnection.socket.readyState === 'open') {
      const message = {
        type: 'open_data_connection',
        tunnel_id: this.tunnelId
      };
      
      writeMessage(
        this.controlConnection.socket, 
        Buffer.from(JSON.stringify(message))
      ).catch(err => {
        console.error('Error requesting new data connection:', err);
      });
    }
  }
}
```

### 4. HTTP Request Handling

Update the HTTP request handling to work with TLS connections instead of WebSockets:

```typescript
// tunnelServer.ts (additional method)
public async handleTunnelRequest(req: Request, res: Response) {
  // Get tunnel ID from hostname
  const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
  const tunnelId = this.getTunnelIdFromHostname(hostname);
  
  if (!tunnelId) {
    throw new APIError(404, "Invalid tunnel hostname");
  }
  
  // Get a connection from the pool
  const pool = this.connectionPools.get(tunnelId);
  if (!pool) {
    throw new APIError(404, "Tunnel not found");
  }
  
  const dataConn = pool.getConnection();
  if (!dataConn) {
    // Queue request for when a connection becomes available
    return this.queueRequest(req, res, tunnelId);
  }
  
  // Process the request
  const requestId = uuidv4();
  
  try {
    // Prepare headers and request message
    const headers = { ...req.headers } as Record<string, string>;
    const bodyBuffer = req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0);
    
    // Create the request message header
    const requestHeader = {
      type: "request",
      request_id: requestId,
      method: req.method,
      path: req.path,
      headers: headers,
      body_length: bodyBuffer.length
    };
    
    // Set up response tracking
    const timeout = setTimeout(() => {
      const pending = this.pendingResponses.get(requestId);
      if (pending) {
        pending.res.status(504).json({ error: "Request timeout" });
        this.pendingResponses.delete(requestId);
        pool.releaseConnection(dataConn.connectionId);
      }
    }, 30000);
    
    this.pendingResponses.set(requestId, { 
      res, 
      timeout, 
      connectionId: dataConn.connectionId,
      tunnelId
    });
    
    // Send the request header followed by body
    const headerBuffer = Buffer.from(JSON.stringify(requestHeader));
    await writeMessage(dataConn.socket, headerBuffer);
    
    // If there's a body, write it directly to the socket
    if (bodyBuffer.length > 0) {
      await new Promise<void>((resolve, reject) => {
        dataConn.socket.write(bodyBuffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  } catch (error) {
    pool.releaseConnection(dataConn.connectionId);
    throw new APIError(500, "Failed to process tunnel request");
  }
}
```

### 5. Response Handling

Implement response handling for data connections:

```typescript
// tunnelServer.ts (part of handleDataConnection method)
private handleDataConnection(socket: tls.TLSSocket, initialMessage: any) {
  const tunnelId = initialMessage.tunnel_id;
  const connectionId = initialMessage.connection_id;
  
  const tunnel = this.tunnelManager.getTunnel(tunnelId);
  if (!tunnel) {
    socket.destroy();
    return;
  }
  
  // Add to connection pool
  const pool = this.getOrCreateConnectionPool(tunnelId);
  const dataConn = pool.addConnection(socket, connectionId);
  
  // Set up response message handling
  const messageHandler = async () => {
    try {
      while (socket.readable) {
        // Read response header
        const headerData = await readMessage(socket);
        const responseHeader = JSON.parse(headerData.toString());
        
        if (responseHeader.type === 'response') {
          const requestId = responseHeader.request_id;
          const bodyLength = responseHeader.body_length || 0;
          
          // Read response body if any
          let bodyBuffer = Buffer.alloc(0);
          if (bodyLength > 0) {
            bodyBuffer = Buffer.alloc(bodyLength);
            await new Promise<void>((resolve, reject) => {
              socket.read(bodyLength, (err, data) => {
                if (err) reject(err);
                else {
                  bodyBuffer = data;
                  resolve();
                }
              });
            });
          }
          
          // Find the pending response
          const pendingResponse = this.pendingResponses.get(requestId);
          if (pendingResponse) {
            const { res, timeout, tunnelId } = pendingResponse;
            
            // Clear timeout and delete from pending
            clearTimeout(timeout);
            this.pendingResponses.delete(requestId);
            
            // Send response to client
            res.status(responseHeader.status_code);
            
            // Set headers
            Object.entries(responseHeader.headers || {}).forEach(([key, value]) => {
              res.setHeader(key, value);
            });
            
            // Send body
            res.end(bodyBuffer);
            
            // Release the connection back to the pool
            const pool = this.connectionPools.get(tunnelId);
            if (pool) {
              pool.releaseConnection(dataConn.connectionId);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error handling data message:', err);
      socket.destroy();
    }
  };
  
  messageHandler();
}
```

## Client-Side Changes

### 1. Replace WebSocket Client with TLS Client

**Current Code:**
```typescript
// connect.ts
import WebSocket from "ws";

async function startTunnel(options: TunnelOptions) {
  const ws = new WebSocket(options.server);
  
  ws.on("open", () => {
    console.log(chalk.green("Connected to TunnelForge server"));
    // Send initial connection data
    ws.send(JSON.stringify({ port: options.port }));
  });
  
  // Rest of WebSocket handling...
}
```

**New Implementation:**
```typescript
// connect.ts
import * as tls from 'tls';
import * as net from 'net';
import { readMessage, writeMessage } from './messageFraming';

async function startTunnel(options: TunnelOptions) {
  let tunnelId: string | null = null;
  let reconnectAttempts = 0;
  
  // Function to establish control connection
  const connectControl = async (): Promise<tls.TLSSocket> => {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: options.server,
        port: options.port || 443,
        rejectUnauthorized: options.rejectUnauthorized !== false,
        // Add CA certificate if provided
        ...(options.ca ? { ca: [options.ca] } : {})
      });
      
      socket.on('secureConnect', () => {
        if (socket.authorized || options.rejectUnauthorized === false) {
          console.log(chalk.green("TLS connection established"));
          
          // Send registration message
          const regMessage = {
            type: 'register_tunnel',
            auth_token: options.authToken,
            protocol: options.protocol || 'http',
            local_port: options.localPort,
            options: {
              subdomain: options.subdomain
            }
          };
          
          writeMessage(socket, Buffer.from(JSON.stringify(regMessage)))
            .then(() => resolve(socket))
            .catch(reject);
        } else {
          console.error(chalk.red('TLS authorization failed:', socket.authorizationError));
          socket.destroy();
          reject(new Error(`TLS auth failed: ${socket.authorizationError}`));
        }
      });
      
      socket.on('error', (err) => {
        reject(err);
      });
    });
  };
  
  // Function to open data connection
  const openDataConnection = async (tunnelId: string): Promise<void> => {
    try {
      const socket = tls.connect({
        host: options.server,
        port: options.port || 443,
        rejectUnauthorized: options.rejectUnauthorized !== false,
        ...(options.ca ? { ca: [options.ca] } : {})
      });
      
      socket.on('secureConnect', () => {
        if (socket.authorized || options.rejectUnauthorized === false) {
          // Register as data connection
          const connectionId = uuidv4();
          const dataConnMessage = {
            type: 'data_connection',
            tunnel_id: tunnelId,
            connection_id: connectionId
          };
          
          writeMessage(socket, Buffer.from(JSON.stringify(dataConnMessage)))
            .catch(err => {
              console.error(chalk.red('Failed to register data connection:', err));
              socket.destroy();
            });
          
          // Set up message handler for this data connection
          handleDataMessages(socket, connectionId);
        } else {
          console.error(chalk.red('Data connection TLS authorization failed'));
          socket.destroy();
        }
      });
      
      socket.on('error', (err) => {
        console.error(chalk.red('Data connection error:', err));
        // Try to open a replacement after delay
        setTimeout(() => openDataConnection(tunnelId), 1000);
      });
      
      socket.on('close', () => {
        console.log(chalk.yellow('Data connection closed, opening replacement'));
        // Open a replacement
        setTimeout(() => openDataConnection(tunnelId), 1000);
      });
    } catch (err) {
      console.error(chalk.red('Failed to open data connection:', err));
      // Retry with longer backoff
      setTimeout(() => openDataConnection(tunnelId), 5000);
    }
  };
  
  // Handle messages on data connections
  const handleDataMessages = async (socket: tls.TLSSocket, connectionId: string) => {
    try {
      while (socket.readable) {
        // Read request header
        const headerData = await readMessage(socket);
        const requestHeader = JSON.parse(headerData.toString());
        
        if (requestHeader.type === 'request') {
          const requestId = requestHeader.request_id;
          const bodyLength = requestHeader.body_length || 0;
          
          // Read request body if any
          let bodyBuffer = Buffer.alloc(0);
          if (bodyLength > 0) {
            bodyBuffer = Buffer.alloc(bodyLength);
            await new Promise<void>((resolve, reject) => {
              socket.read(bodyLength, (err, data) => {
                if (err) reject(err);
                else {
                  bodyBuffer = data;
                  resolve();
                }
              });
            });
          }
          
          // Forward to local server
          try {
            // Convert body buffer to string or parsed JSON if appropriate
            let body = bodyBuffer;
            if (bodyBuffer.length > 0) {
              const contentType = requestHeader.headers['content-type'];
              if (contentType && contentType.includes('application/json')) {
                body = JSON.parse(bodyBuffer.toString());
              } else {
                body = bodyBuffer.toString();
              }
            }
            
            // Forward request to local server
            const response = await axios({
              method: requestHeader.method,
              url: `http://localhost:${options.localPort}${requestHeader.path}`,
              headers: requestHeader.headers,
              data: body,
              responseType: 'arraybuffer', // Get response as buffer
              validateStatus: () => true, // Accept any status code
            });
            
            // Prepare response header
            const responseHeader = {
              type: 'response',
              request_id: requestId,
              status_code: response.status,
              headers: response.headers,
              body_length: response.data.length
            };
            
            // Send response header
            await writeMessage(socket, Buffer.from(JSON.stringify(responseHeader)));
            
            // Send response body
            if (response.data.length > 0) {
              await new Promise<void>((resolve, reject) => {
                socket.write(response.data, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            }
          } catch (err) {
            // Handle errors in local server communication
            console.error(chalk.red(`Error forwarding request: ${err.message}`));
            
            // Send error response
            const errorResponse = {
              type: 'response',
              request_id: requestId,
              status_code: 502,
              headers: { 'content-type': 'application/json' },
              body_length: 0
            };
            
            const errorBody = JSON.stringify({
              error: 'Failed to forward request to local server'
            });
            
            errorResponse.body_length = Buffer.byteLength(errorBody);
            
            await writeMessage(socket, Buffer.from(JSON.stringify(errorResponse)));
            
            if (errorBody.length > 0) {
              await new Promise<void>((resolve, reject) => {
                socket.write(errorBody, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error in data message handler: ${err.message}`));
      socket.destroy();
    }
  };
  
  // Main connection logic
  try {
    const controlSocket = await connectControl();
    
    // Set up heartbeat
    const heartbeatInterval = setInterval(() => {
      if (controlSocket.writable && tunnelId) {
        writeMessage(controlSocket, Buffer.from(JSON.stringify({
          type: 'keep_alive',
          tunnel_id: tunnelId
        }))).catch(err => {
          console.error(chalk.red('Failed to send heartbeat:', err));
        });
      }
    }, 30000);
    
    // Handle control messages
    const controlMessageHandler = async () => {
      try {
        while (controlSocket.readable) {
          const data = await readMessage(controlSocket);
          const message = JSON.parse(data.toString());
          
          switch (message.type) {
            case 'tunnel_registered':
              tunnelId = message.tunnel_id;
              console.log(chalk.green(`\nTunnel established! Your URL is: ${message.url}`));
              console.log(chalk.gray("\nPress Ctrl+C to stop the tunnel\n"));
              
              // Set up initial data connections
              for (let i = 0; i < 3; i++) {
                await openDataConnection(tunnelId);
              }
              break;
              
            case 'open_data_connection':
              if (tunnelId) {
                openDataConnection(tunnelId);
              }
              break;
              
            case 'error':
              console.error(chalk.red(`Server error: ${message.message} (${message.code})`));
              break;
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error in control message handler: ${err.message}`));
        controlSocket.destroy();
      }
    };
    
    controlMessageHandler();
    
    // Handle control connection close
    controlSocket.on('close', () => {
      clearInterval(heartbeatInterval);
      console.log(chalk.yellow("\nControl connection closed"));
      
      // Implement reconnection with exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;
      
      console.log(chalk.yellow(`Reconnecting in ${backoffTime/1000}s...`));
      setTimeout(() => startTunnel(options), backoffTime);
    });
    
    // Handle control connection errors
    controlSocket.on('error', (err) => {
      console.error(chalk.red(`Control connection error: ${err.message}`));
      // The 'close' handler will handle reconnection
    });
    
  } catch (err) {
    console.error(chalk.red(`Failed to start tunnel: ${err.message}`));
    
    // Implement reconnection with exponential backoff
    const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    
    console.log(chalk.yellow(`Reconnecting in ${backoffTime/1000}s...`));
    setTimeout(() => startTunnel(options), backoffTime);
  }
}
```

## Infrastructure Changes

### 1. Update Nginx Configuration

The Nginx configuration remains largely the same, but we need to add TCP stream configuration for the TLS server:

```nginx
# Add stream context outside http context
stream {
    upstream tunnel_server {
        server localhost:8443;
    }
    
    # TLS server for tunneling
    server {
        listen 443 ssl;
        ssl_certificate /etc/letsencrypt/live/tunnelforge.io/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/tunnelforge.io/privkey.pem;
        
        proxy_pass tunnel_server;
    }
}

# Existing HTTP/HTTPS configuration remains the same
http {
    # Server blocks for main site and subdomains
    # ...
}
```

### 2. Update Package Dependencies

Replace WebSocket dependencies with TLS-related ones:

```diff
// package.json
{
  "dependencies": {
-   "ws": "^8.x",
+   "@types/node": "^16.x", // Ensure Node.js types for TLS/TCP
    "express": "^4.x",
    "axios": "^0.x",
    // other dependencies...
  }
}
```

## Security Enhancements

### 1. TLS Configuration

Ensure proper TLS configuration for security:

```typescript
// securityUtils.ts
import * as tls from 'tls';
import * as crypto from 'crypto';

export function getSecureTLSOptions(): tls.TLSSocketOptions {
  return {
    minVersion: 'TLSv1.2',
    ciphers: [
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-CHACHA20-POLY1305',
      'ECDHE-RSA-CHACHA20-POLY1305',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256'
    ].join(':'),
    honorCipherOrder: true,
    ecdhCurve: 'secp384r1'
  };
}

export function generateAuthToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
```

### 2. Certificate Validation

Add proper certificate validation for clients:

```typescript
// clientUtils.ts
import * as tls from 'tls';
import * as fs from 'fs';

export function getTLSClientOptions(options: ClientOptions): tls.ConnectionOptions {
  return {
    host: options.host,
    port: options.port || 443,
    rejectUnauthorized: true,
    // Load specified CA or system CAs
    ca: options.ca ? [fs.readFileSync(options.ca)] : undefined,
    // Optional certificate pinning
    checkServerIdentity: (hostname, cert) => {
      // Perform additional checks on certificate
      if (options.pinnedCertificateFingerprint) {
        const fingerprint = crypto
          .createHash('sha256')
          .update(cert.raw)
          .digest('hex');
          
        if (fingerprint !== options.pinnedCertificateFingerprint) {
          return new Error('Certificate fingerprint mismatch');
        }
      }
      
      // Perform standard hostname check
      return tls.checkServerIdentity(hostname, cert);
    }
  };
}
```

## Testing Strategy

### 1. Unit Testing TLS Components

```typescript
// messageFraming.test.ts
import * as tls from 'tls';
import * as net from 'net';
import { readMessage, writeMessage } from '../src/messageFraming';

describe('Message Framing', () => {
  let serverSocket: tls.TLSSocket;
  let clientSocket: tls.TLSSocket;
  
  beforeEach((done) => {
    // Set up test TLS server and client
    // ...
    done();
  });
  
  afterEach(() => {
    serverSocket.destroy();
    clientSocket.destroy();
  });
  
  test('should write and read message correctly', async () => {
    const testMessage = Buffer.from('{"test":"data"}');
    
    // Write from client to server
    await writeMessage(clientSocket, testMessage);
    
    // Read on server
    const receivedMessage = await readMessage(serverSocket);
    
    expect(receivedMessage.toString()).toBe(testMessage.toString());
  });
  
  test('should handle large messages', async () => {
    // Test with a large buffer
    // ...
  });
});
```

### 2. Integration Testing

```typescript
// tunnelFlow.test.ts
describe('End-to-end Tunnel Flow', () => {
  let server: TunnelServer;
  let client: any;
  let localServer: http.Server;
  
  beforeAll(async () => {
    // Start local test server
    localServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Hello from local server' }));
    });
    
    await new Promise<void>(resolve => {
      localServer.listen(8080, () => resolve());
    });
    
    // Start tunnel server
    server = new TunnelServer({
      // Test configuration
    });
    
    // Start tunnel client
    client = await startTestClient({
      server: 'localhost',
      port: 8443,
      localPort: 8080,
      // Test configuration
    });
  });
  
  afterAll(async () => {
    // Clean up
    await new Promise(resolve => localServer.close(resolve));
    await server.close();
    await client.close();
  });
  
  test('should forward HTTP request through tunnel', async () => {
    // Make a request to the tunnel
    const response = await axios.get('https://test.tunnelforge.test/');
    
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ message: 'Hello from local server' });
  });
});
```

## Conclusion

The changes outlined in this document will transform TunnelForge from a WebSocket-based implementation to a TLS-based tunneling service that more accurately mirrors ngrok's approach. The key differences include:

1. Using direct TLS connections instead of WebSockets
2. Implementing custom message framing
3. More efficient binary handling for request/response bodies
4. Proper connection pooling for better concurrency
5. Improved security with proper TLS configuration

These changes will result in a more performant, secure, and accurate implementation of ngrok-like functionality. 