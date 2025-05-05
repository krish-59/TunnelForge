# TunnelForge Server

Express/WebSocket-based tunnel server and CLI implementation.

## Structure

```
src/
├── index.ts          # Server entry point
├── tunnelServer.ts   # WebSocket tunnel logic
├── api/             # Dashboard API routes
├── utils/           # Shared utilities
└── __tests__/       # Unit tests
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## API Routes

- `GET /health` - Server health check
- `GET /api/tunnels` - List active tunnels
- `ws://localhost:3000/connect` - WebSocket tunnel endpoint

## CLI Usage

```bash
# Start tunnel server
npm run dev

# In another terminal, connect to tunnel:
node bin/connect.js --port 8080
```

See root README for complete documentation. 