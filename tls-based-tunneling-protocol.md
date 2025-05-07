# TLS-Based Tunneling Protocol Implementation

## Overview

This document outlines a more accurate ngrok-like tunneling protocol implementation using direct TLS connections rather than WebSockets. As described in the official ngrok documentation, ngrok uses "secure, outbound persistent TLS connections" between the agent and server, with its own lightweight framing protocol for message exchange.

## Core Protocol Components

### 1. Connection Types

The protocol uses two types of direct TLS connections:

#### Control Connection
- **Purpose**: Tunnel management, authentication, and coordination
- **Quantity**: One per tunnel
- **Lifecycle**: Long-lived, persists throughout tunnel lifetime
- **Protocol**: Custom message framing over TLS
- **Port**: 443 (standard HTTPS port for firewall friendliness)

#### Data Connection
- **Purpose**: Carrying actual request/response payloads
- **Quantity**: Multiple per tunnel (pool of 3-10 connections)
- **Lifecycle**: Reusable for multiple requests
- **Protocol**: Custom message framing over TLS
- **Port**: 443 (same as control connection)

### 2. Message Framing Format

Unlike WebSocket's built-in framing, we'll implement a simple length-prefixed message format:

```
[4-byte message length][message payload]
```

Where:
- Message length is encoded as a 32-bit unsigned integer in network byte order (big-endian)
- Message payload is typically JSON for control messages or binary for data messages

### 3. Protocol Messages

#### Control Channel Messages

**Client → Server**:
- `register_tunnel`: Initial authentication and tunnel registration
  ```json
  {
    "type": "register_tunnel",
    "auth_token": "...",
    "protocol": "http|https|tcp",
    "local_port": 8080,
    "options": {
      "subdomain": "optional-requested-subdomain",
      "auth": "username:password"
    }
  }
  ```

- `keep_alive`: Regular heartbeat
  ```json
  {
    "type": "keep_alive",
    "tunnel_id": "..."
  }
  ```

- `close_tunnel`: Graceful tunnel termination
  ```json
  {
    "type": "close_tunnel",
    "tunnel_id": "..."
  }
  ```

**Server → Client**:
- `tunnel_registered`: Tunnel created successfully
  ```json
  {
    "type": "tunnel_registered",
    "tunnel_id": "...",
    "url": "https://xyz.tunnelforge.io",
    "protocol": "http|https|tcp"
  }
  ```

- `open_data_connection`: Request to open a new data channel
  ```json
  {
    "type": "open_data_connection",
    "tunnel_id": "..."
  }
  ```

- `error`: Error notification
  ```json
  {
    "type": "error",
    "code": 403,
    "message": "Authentication failed"
  }
  ```

#### Data Channel Messages

**Client → Server (Connection Initialization)**:
```json
{
  "type": "data_connection",
  "tunnel_id": "...",
  "connection_id": "..."
}
```

For HTTP tunnels, each request/response will be framed with a JSON header:

**Server → Client (Request)**:
```json
{
  "type": "request",
  "request_id": "...",
  "method": "GET",
  "path": "/api/endpoint",
  "headers": {...},
  "body_length": 1024
}
[request body bytes follow immediately after]
```

**Client → Server (Response)**:
```json
{
  "type": "response",
  "request_id": "...",
  "status_code": 200,
  "headers": {...},
  "body_length": 2048
}
[response body bytes follow immediately after]
```

For TCP tunnels, after initial setup, messages are much simpler:

```json
{
  "type": "tcp_data",
  "session_id": "...",
  "data_length": 512
}
[raw TCP bytes follow immediately after]
```

### 4. Connection Lifecycle

#### Tunnel Establishment
1. Client initiates a direct TLS connection to server port 443
2. Client sends `register_tunnel` message with authentication and tunnel details
3. Server validates credentials and creates tunnel allocation
4. Server responds with `tunnel_registered` and tunnel URL details
5. Server immediately requests data connections with `open_data_connection` messages
6. Client opens multiple TLS data connections (at least 3) to form initial connection pool

#### Request Handling (HTTP)
1. Server receives HTTP request on public endpoint
2. Server identifies target tunnel from hostname (subdomain)
3. Server obtains available data connection from pool for that tunnel
4. Server serializes and forwards the request through the data connection
5. Client receives request, forwards to local service
6. Client receives response, serializes and returns through same data connection
7. Server forwards response to original requester
8. Server marks data connection as available again in the pool
9. If pool is below minimum size, server requests new data connection

#### TCP Session Handling
1. Server receives TCP connection on public endpoint port
2. Server identifies target tunnel from port allocation
3. Server obtains data connection from pool for that tunnel
4. Server assigns this data connection to the TCP session and begins relaying bytes
5. When TCP connection ends, server returns data connection to pool or closes it

### 5. Message Processing Implementation

#### Reading Framed Messages:

```typescript
function readMessage(socket: tls.TLSSocket): Promise<Buffer> {
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
            // Handle partial reads (more complex in real implementation)
            reject(new Error("Partial message read not implemented"));
          }
        });
        return;
      }
      
      resolve(messageBuffer);
    });
  });
}
```

#### Writing Framed Messages:

```typescript
function writeMessage(socket: tls.TLSSocket, data: Buffer): Promise<void> {
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

## Security Considerations

1. **TLS Configuration**:
   - Use TLS 1.2+ with strong cipher suites
   - Implement certificate validation on both ends
   - Consider certificate pinning for added security

2. **Authentication**:
   - Implement auth token validation for all connections
   - Apply rate limiting to authentication attempts
   - Consider short-lived tokens or rotation for long-lived tunnels

3. **Connection Security**:
   - Implement timeout handling for stale connections
   - Monitor for abnormal traffic patterns 
   - Apply rate limiting based on client or IP

4. **Data Validation**:
   - Validate message framing and lengths
   - Implement maximum message size limits
   - Validate all JSON payloads against schemas

## Optimizations

1. **Binary Protocol**: For high-performance scenarios, consider a binary protocol instead of JSON for control messages

2. **Compression**: Implement optional compression for HTTP response bodies

3. **Zero-copy Forwarding**: For TCP tunnels, implement zero-copy forwarding when possible

4. **Pooled Buffers**: Use buffer pooling to reduce GC pressure for high-throughput scenarios

## Reconnection and Resilience

1. **Heartbeat Mechanism**:
   - Client sends periodic `keep_alive` messages on control connection
   - Server closes connection if heartbeats are missed (60s timeout typical)
   - Client monitors server heartbeat responses

2. **Exponential Backoff**:
   - Start with short retry interval (e.g., 250ms)
   - Double interval on each failed attempt
   - Cap at maximum interval (e.g., 30s)
   - Add jitter to prevent thundering herd

3. **Connection Health Monitoring**:
   - Server monitors connection latency and errors
   - Client tracks error rates and connection drops
   - Both sides can initiate new connections when quality degrades

## Implementation Notes

### Node.js Implementation

```typescript
import * as tls from 'tls';
import * as net from 'net';
import * as fs from 'fs';

// TLS Server Configuration
const server = tls.createServer({
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem'),
  requestCert: false,
  rejectUnauthorized: false
});

server.on('connection', (socket) => {
  console.log('New TLS connection');
  
  // Process messages
  readMessage(socket)
    .then(data => {
      const message = JSON.parse(data.toString());
      // Handle message based on type
    })
    .catch(err => {
      console.error('Error reading message:', err);
      socket.destroy();
    });
});

server.listen(443, () => {
  console.log('TLS server listening on port 443');
});

// Client Implementation
function connectTunnel(options) {
  const socket = tls.connect({
    host: options.host,
    port: options.port || 443,
    rejectUnauthorized: true,
    ca: [fs.readFileSync('ca-cert.pem')]
  });
  
  socket.on('secureConnect', () => {
    if (socket.authorized) {
      console.log('TLS connection established');
      
      // Send registration message
      const regMessage = {
        type: 'register_tunnel',
        auth_token: options.token,
        protocol: 'http',
        local_port: options.localPort
      };
      
      writeMessage(socket, Buffer.from(JSON.stringify(regMessage)));
    } else {
      console.error('TLS authorization failed:', socket.authorizationError);
      socket.destroy();
    }
  });
  
  // Set up message reading loop
  async function messageLoop() {
    try {
      while (socket.readable) {
        const data = await readMessage(socket);
        const message = JSON.parse(data.toString());
        // Handle message based on type
      }
    } catch (err) {
      console.error('Error in message loop:', err);
      socket.destroy();
    }
  }
  
  messageLoop();
  
  return socket;
}
```

### Go Implementation Excerpt

```go
package main

import (
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net"
)

// readMessage reads a length-prefixed message from conn
func readMessage(conn net.Conn) ([]byte, error) {
	// Read 4-byte length prefix
	var length uint32
	if err := binary.Read(conn, binary.BigEndian, &length); err != nil {
		return nil, err
	}
	
	// Read message body
	message := make([]byte, length)
	if _, err := io.ReadFull(conn, message); err != nil {
		return nil, err
	}
	
	return message, nil
}

// writeMessage writes a length-prefixed message to conn
func writeMessage(conn net.Conn, data []byte) error {
	// Write 4-byte length prefix
	if err := binary.Write(conn, binary.BigEndian, uint32(len(data))); err != nil {
		return err
	}
	
	// Write message body
	_, err := conn.Write(data)
	return err
}

func main() {
	// TLS client configuration
	config := &tls.Config{
		InsecureSkipVerify: false,
		MinVersion:         tls.VersionTLS12,
	}
	
	conn, err := tls.Dial("tcp", "tunnelforge.io:443", config)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()
	
	// Send registration message
	regMessage := map[string]interface{}{
		"type":       "register_tunnel",
		"auth_token": "your-auth-token",
		"protocol":   "http",
		"local_port": 8080,
	}
	
	data, _ := json.Marshal(regMessage)
	if err := writeMessage(conn, data); err != nil {
		log.Fatalf("Failed to send registration: %v", err)
	}
	
	// Read response
	response, err := readMessage(conn)
	if err != nil {
		log.Fatalf("Failed to read response: %v", err)
	}
	
	var responseMsg map[string]interface{}
	if err := json.Unmarshal(response, &responseMsg); err != nil {
		log.Fatalf("Failed to parse response: %v", err)
	}
	
	log.Printf("Received response: %v", responseMsg)
}
``` 