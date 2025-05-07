# Ngrok-like Tunneling Protocol Implementation

## Overview

This document outlines the protocol and architectural changes required to transform TunnelForge's current WebSocket-based implementation into a more sophisticated, ngrok-like tunneling system with:

1. Separate control and data channels
2. Connection pooling for efficient handling of concurrent requests
3. Secure TLS connections throughout
4. Heartbeat mechanisms and reconnection logic
5. Support for HTTP(S) and TCP tunneling
6. Multiplexing capabilities

## Core Protocol Components

### 1. Connection Types

The protocol will define two distinct connection types:

#### Control Connection
- **Purpose**: Tunnel management, authentication, and coordination
- **Quantity**: One per tunnel
- **Lifecycle**: Long-lived, persists throughout tunnel lifetime
- **Messaging**: JSON-encoded control messages

#### Data Connection
- **Purpose**: Carrying actual request/response payloads
- **Quantity**: Multiple per tunnel (pool of 3-10 connections)
- **Lifecycle**: Reusable for multiple requests
- **Messaging**: HTTP or TCP data with minimal framing

### 2. Protocol Messages

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

For HTTP tunnels, each request/response will be framed with a small header:

**Server → Client (Request)**:
```json
{
  "type": "request",
  "request_id": "...",
  "method": "GET",
  "path": "/api/endpoint",
  "headers": {...},
  "body": "base64-encoded-optional"
}
```

**Client → Server (Response)**:
```json
{
  "type": "response",
  "request_id": "...",
  "status_code": 200,
  "headers": {...},
  "body": "base64-encoded-optional"
}
```

For TCP tunnels, the data channel will use a simpler binary format with minimal framing to identify the connection.

### 3. Connection Lifecycle

#### Tunnel Establishment
1. Client initiates WebSocket TLS connection to server on the control channel
2. Client sends `register_tunnel` message with authentication and tunnel details
3. Server validates credentials and creates tunnel allocation
4. Server responds with `tunnel_registered` and tunnel URL details
5. Server immediately requests data connections with `open_data_connection` messages
6. Client opens multiple data connections (at least 3) to form initial connection pool

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

#### Connection Management
1. Client sends regular `keep_alive` messages on control channel
2. Server monitors connection health and requests reconnection if needed
3. If control connection drops, client attempts reconnection with exponential backoff
4. Data connections are cycled periodically to avoid proxy timeouts
5. Server maintains connection pool metrics to ensure optimal availability

## Security Considerations

1. **TLS Everywhere**: All connections (control and data) use TLS 1.2+ encryption
2. **Auth Token Validation**: All tunnels require authentication with API tokens
3. **Request Validation**: Headers and payloads are validated before forwarding
4. **Tunnel Isolation**: Strict isolation between different tunnel endpoints
5. **Rate Limiting**: Apply tiered rate limits based on account type
6. **Timeout Handling**: Clear timeouts for pending responses with proper cleanup

## Protocol Efficiency

1. **Connection Reuse**: Data connections are reused for multiple requests
2. **Pooling Strategy**: Maintain minimum pool size and expand under load
3. **Keep-Alive Optimization**: Balancing keep-alive frequency against overhead
4. **Binary Encoding**: Consider binary protocol for data frames to reduce overhead
5. **Compression**: Optional compression for HTTP payloads

## Fault Tolerance

1. **Auto-Reconnection**: Automatic reconnection with exponential backoff
2. **Graceful Degradation**: Function with reduced capacity during partial outages
3. **Duplicate Request Detection**: Guard against duplicate requests during reconnection
4. **Request Idempotency**: Ensure requests can be safely retried

## TLS Configuration

For production-grade security:

1. Strong cipher suites (TLS 1.2+)
2. Certificate validation on both ends
3. Certificate pinning for added security
4. Support for self-signed certificates in private deployments 