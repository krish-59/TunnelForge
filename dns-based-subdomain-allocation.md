# DNS-Based Subdomain Allocation System

## Overview

This document outlines how to implement a ngrok-like DNS-based subdomain allocation system in TunnelForge, replacing the current path-based routing with proper subdomain-based endpoints (e.g., `xyz.tunnelforge.io`).

## System Components

### 1. DNS Configuration Requirements

#### Primary Domain Setup
- Acquire a domain for the service (e.g., `tunnelforge.io`)
- Configure DNS provider with:
  - A record for the main domain pointing to the server's IP
  - Wildcard DNS record (`*.tunnelforge.io`) pointing to the same IP

#### DNS Provider Integration
- Choose a DNS provider with API access for automation (options):
  - Cloudflare (recommended for its robust API)
  - Route53 (AWS)
  - DigitalOcean DNS
  - Namecheap with API

#### Required DNS Records
- `A` record for `tunnelforge.io` → Server IP
- `A` record for `*.tunnelforge.io` → Server IP
- `CNAME` record for `www.tunnelforge.io` → `tunnelforge.io`
- Optional: `CNAME` for `api.tunnelforge.io` → `tunnelforge.io`

### 2. Web Server Configuration (Nginx/Reverse Proxy)

Use Nginx as a reverse proxy in front of the Node.js application to handle the hostname-based routing:

```nginx
# Handle wildcard subdomains
server {
    listen 80;
    listen 443 ssl;
    server_name ~^(?<subdomain>.+)\.tunnelforge\.io$;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tunnel-Subdomain $subdomain;
    }
}

# Handle main domain
server {
    listen 80;
    listen 443 ssl;
    server_name tunnelforge.io www.tunnelforge.io;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        # Same proxy headers as above
    }
}
```

### 3. SSL Certificate Management

#### Let's Encrypt Integration
- Use Certbot for automated Let's Encrypt certificate management
- Configure for wildcard certificates with DNS validation
- Set up auto-renewal with cron job

```bash
# Initial setup for wildcard certificate
certbot certonly --manual --preferred-challenges dns \
  --server https://acme-v02.api.letsencrypt.org/directory \
  -d tunnelforge.io -d *.tunnelforge.io
  
# Add to crontab
0 3 * * * /usr/bin/certbot renew --quiet
```

#### Alternative: Use Certificate Service
- For production environments, consider certificate management services:
  - AWS Certificate Manager (if using AWS)
  - Cloudflare SSL

## 4. Application Code Changes

### Backend Changes for Subdomain Routing

#### 1. Modify TunnelServer.ts

```typescript
// Add subdomain handling to TunnelServer
export class TunnelServer {
  private readonly subdomainToTunnelMap: Map<string, string>;
  
  constructor(options: TunnelServerOptions) {
    // existing code...
    this.subdomainToTunnelMap = new Map();
  }
  
  // Generate and register a subdomain for a tunnel
  private registerSubdomain(tunnelId: string, requestedSubdomain?: string): string {
    let subdomain: string;
    
    if (requestedSubdomain && this.isSubdomainAvailable(requestedSubdomain)) {
      subdomain = requestedSubdomain;
    } else {
      // Generate random subdomain if requested is unavailable or not specified
      subdomain = this.generateRandomSubdomain();
    }
    
    this.subdomainToTunnelMap.set(subdomain, tunnelId);
    return subdomain;
  }
  
  private generateRandomSubdomain(): string {
    // Generate a random 8-character alphanumeric string
    // Ensure it's not already taken
    // Return unique subdomain
  }
  
  private isSubdomainAvailable(subdomain: string): boolean {
    return !this.subdomainToTunnelMap.has(subdomain);
  }
  
  // Modified tunnel creation to handle subdomains
  public createTunnel(socket: WebSocket, port: number, options?: { subdomain?: string }): Tunnel {
    const tunnel = this.tunnelManager.createTunnel(socket, port);
    const subdomain = this.registerSubdomain(tunnel.id, options?.subdomain);
    
    // Store subdomain in tunnel info
    tunnel.subdomain = subdomain;
    
    // Update tunnel URL format
    const tunnelUrl = `https://${subdomain}.tunnelforge.io`;
    
    // Return tunnel with URL
    return { ...tunnel, url: tunnelUrl };
  }
  
  // Replace getTunnelIdFromRequest with subdomain-based lookup
  public getTunnelIdFromHostname(hostname: string): string | null {
    // Extract subdomain from hostname (example.tunnelforge.io)
    const subdomainMatch = hostname.match(/^([^.]+)\.tunnelforge\.io$/i);
    if (!subdomainMatch) return null;
    
    const subdomain = subdomainMatch[1];
    return this.subdomainToTunnelMap.get(subdomain) || null;
  }
}
```

#### 2. Update Request Handling Middleware

```typescript
// Middleware to handle subdomain-based routing
app.use((req, res, next) => {
  // Check if this is a tunnel request by looking at hostname
  const hostname = req.hostname || req.headers.host?.split(':')[0];
  
  if (hostname && hostname.endsWith('.tunnelforge.io') && !isReservedSubdomain(hostname)) {
    const tunnelId = tunnelServer.getTunnelIdFromHostname(hostname);
    if (tunnelId) {
      return tunnelServer.handleTunnelRequest(req, res);
    }
    
    // Tunnel not found
    return res.status(404).send("Tunnel not found");
  }
  
  // Not a tunnel request, continue to next middleware
  next();
});

// Function to check for reserved subdomains (www, api, etc.)
function isReservedSubdomain(hostname: string): boolean {
  const reserved = ['www', 'api', 'admin', 'dashboard', 'app'];
  const subdomain = hostname.split('.')[0];
  return reserved.includes(subdomain);
}
```

#### 3. Update TunnelManager.ts and Types

```typescript
// Update types/tunnel.ts
export interface Tunnel {
  id: string;
  localPort: number;
  socket: WebSocket;
  stats: TunnelStats;
  subdomain: string;
  url: string;
}

// Update TunnelManager to handle subdomain tracking
export class TunnelManager {
  // existing code...
  
  public removeTunnel(id: string): boolean {
    const tunnel = this.tunnels.get(id);
    if (tunnel) {
      // Clean up subdomain mapping when removing tunnel
      this.subdomainToTunnelMap.delete(tunnel.subdomain);
      tunnel.socket.close();
      return this.tunnels.delete(id);
    }
    return false;
  }
}
```

### Connection Handling for Subdomains

#### Update WebSocket Server Path Configuration

```typescript
// In tunnelServer.ts
this.wss = new WebSocketServer({
  server: options.httpServer,
  path: "/tunnel/control", // Separate path for control connections
  clientTracking: true,
});

// Create additional WebSocket server for data connections
this.dataWss = new WebSocketServer({
  server: options.httpServer,
  path: "/tunnel/data",
  clientTracking: true,
});
```

## Operational Considerations

### Reserved Subdomains
- Maintain a list of reserved subdomains (`www`, `api`, `mail`, etc.)
- Enforce subdomain restrictions (length, characters, prohibited words)

### Subdomain Management
- Implement cleanup for expired/inactive tunnels to free subdomains
- Add option for persistent reserved subdomains (paid feature)
- Add subdomain validation to prevent abuse

### Local Development & Testing
- Use `localtunnel.me`-style domain for development (avoid wildcard cert issues)
- Configure `/etc/hosts` entries for local testing
- Use a staging environment with a separate test domain

### Metrics & Monitoring
- Track subdomain allocation/usage metrics
- Monitor for subdomain abuse or squatting
- Implement subdomain rate limits per user

## Deployment Considerations

### DNS Propagation
- Plan for DNS propagation delays when making changes
- Implement graceful handling of DNS transition period

### Scaling
- Design for horizontal scaling with shared subdomain registry
- Consider Redis or similar for distributed subdomain mapping storage

### Regional Deployment
- For global deployments, consider region-specific subdomains (e.g., `us.tunnelforge.io`, `eu.tunnelforge.io`)
- Implement geo-routing to nearest server

## Security Considerations

### Subdomain Security
- Implement HSTS for all subdomains
- Protect against subdomain takeover vulnerabilities
- Monitor for suspicious subdomain requests
- Add rate limiting for subdomain creation

### Certificate Management
- Ensure regular certificate renewal
- Implement certificate transparency monitoring
- Handle certificate errors gracefully 