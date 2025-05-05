# TunnelForge

A lightweight ngrok-like HTTP tunneling service with rate limiting and a real-time dashboard.

## Features

- 🚇 HTTP tunneling from local ports to public URLs
- 🔒 Built-in request rate limiting
- 📊 Real-time monitoring dashboard
- 🚀 Easy-to-use CLI interface

## Quick Start

### Prerequisites

- Node.js ≥ 18.x
- npm ≥ 9.x

### Installation

```bash
npm install -g tunnelforge
```

Or use without installing:

```bash
npx tunnelforge ...
```

### Usage

1. Start the tunnel server:
```bash
tunnelforge-server --port 3000
```

2. In another terminal, expose your local service:
```bash
tunnelforge connect --port 8080
```

Your local service will be available at the URL shown in the CLI output.

3. Monitor traffic at `http://localhost:4040`

## Development

This is a monorepo with two main components:

- [`server/`](server/README.md) - Express/WebSocket tunnel server and CLI
- [`dashboard/`](dashboard/README.md) - React-based monitoring UI

### Setup

```bash
# Install dependencies
npm install

# Start development servers
npm run dev        # Starts server on :3000
npm run dashboard  # Starts dashboard on :4040
```

See component READMEs for detailed development instructions.

## License

MIT 