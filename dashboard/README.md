# TunnelForge Dashboard

React-based monitoring dashboard for TunnelForge tunnel server.

## Features

- Real-time tunnel status monitoring
- Request count and rate limit tracking
- Clean, modern UI

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

## Structure

```
src/
├── App.tsx           # Root component
├── components/       # React components
├── pages/           # Route pages
├── api/             # API utilities
└── __tests__/       # Unit tests
```

## Configuration

The dashboard runs on port 4040 by default and proxies API requests to the tunnel server on port 3000. To change these settings, edit `vite.config.ts`.

See root README for complete documentation. 