# **Open-Source Tunneling Service (Ngrok-like) – Technical Specification**

## **Introduction**

This document specifies the requirements and architecture for an open-source npm package that replicates and enhances ngrok’s functionality. The project (tentatively called **OpenTunnel**) will allow developers to expose local web services to the internet via secure tunnels. It focuses initially on HTTP and HTTPS tunneling, with a modular design to extend support to TCP, TLS, and WebSocket protocols in the future. The solution is self-hosted and easily configurable, enabling teams or individuals to run their own tunneling service similar to ngrok but with greater extensibility and control.

## **Objectives and Scope**

**Objectives:** OpenTunnel aims to provide a secure, flexible tunneling platform for local development with features on par with or beyond ngrok. Key goals include:

* **Secure Local Tunnels:** Create secure, encrypted tunnels from a local machine to a public endpoint (for testing webhooks, demos, etc.).

* **Domain & Routing Flexibility:** Support both dynamic (random) subdomains and static custom subdomains/domains for tunnel URLs.

* **User Interface & Analytics:** Offer a web-based Dashboard (built with React) for managing tunnels and viewing traffic analytics in real-time.

* **Rate Limiting & Access Control:** Include configurable rate limiting (by IP, endpoint, user, etc.) and access controls to prevent abuse and restrict access.

* **Extensibility:** Design a plugin-based architecture that allows adding new protocols (TCP, TLS, WebSocket) and custom features without major core changes.

* **Developer-Friendly Tools:** Provide a CLI for developers to easily start/stop tunnels, and a REST API for programmatic control and integration.

**In-Scope:** The initial scope covers HTTP/HTTPS tunneling and all associated management features (UI, logging, auth, etc.). Future protocol support (raw TCP, TLS passthrough, WebSockets, etc.) is considered in the design but may be implemented as plugins later.

**Out-of-Scope (Initial Release):** Advanced production features like horizontal scaling across multiple servers, built-in TLS certificate provisioning (beyond configuration), or UDP tunneling are not included in version 1.0. These can be added in future iterations given the extensible design.

## **Architecture Overview**

OpenTunnel follows a client-server model with a modular, Node.js-based backend. The primary components are a **Tunnel Server** (which runs on a public host) and a **Tunnel Client** (which runs on the developer’s local machine). A high-level flow of how the system works is outlined below:

1. **Tunnel Client Initiation:** A developer runs the CLI on their machine (e.g. `opentunnel --port 3000 --subdomain myapp`). The client authenticates with the Tunnel Server (using an API key or credentials) and requests a tunnel. The request includes the desired protocol (HTTP/HTTPS), local port, and optional subdomain name.

2. **Tunnel Setup on Server:** The Tunnel Server assigns a public URL for the tunnel. This could be a random subdomain like `abcd1234.example.com` for dynamic tunnels, or a user-requested name like `myapp.example.com` if available. The server ensures DNS routing (via a wildcard domain) will direct traffic for that subdomain to the server. It then establishes a secure connection with the client for forwarding traffic (e.g. a persistent WebSocket or a custom multiplexed TCP connection).

3. **Traffic Forwarding:** When an external user/browser makes an HTTP/HTTPS request to the public URL, the Tunnel Server accepts the connection. It identifies the target tunnel by the hostname (subdomain) and protocol, then forwards the HTTP request over the secure tunnel connection to the respective Tunnel Client. The client receives the request and proxies it to the local application on the specified port. The response from the local app is sent back through the tunnel and returned to the external user. This process is transparent to the end user, appearing as if they connected directly to the service.

4. **Encryption & Security:** All traffic between the Tunnel Client and Tunnel Server is encrypted (e.g. using TLS over the tunnel connection) to ensure secure transit. For HTTPS tunnels, the Tunnel Server will terminate TLS at the edge (using a wildcard certificate for `*.example.com` or user-provided certificates) and forward the requests to the local client over the encrypted tunnel. This ensures end-to-end encryption from the public endpoint to the local machine.

5. **Management & Monitoring:** The Tunnel Server concurrently logs the traffic and events. The web Dashboard and REST API can be used to monitor active tunnels, view request logs, adjust settings (like access rules), or terminate tunnels. The Tunnel Client also keeps the connection alive (reconnecting if dropped) and can signal the server to close the tunnel when the user stops the client.

**High-Level Architecture Diagram:** *(The architecture consists of a central server and one or more clients. A public domain (or domains) point to the server. Each client maintains a persistent connection to the server. Incoming requests to `*.yourdomain.com` hit the server, which uses a routing layer to map the request to the correct client tunnel. The server includes modules for authentication, routing, rate limiting, and logging, and exposes a REST API and web UI for management. The client is essentially a lightweight agent that forwards traffic to/from a specified local port.)*

## **Core Components**

The system is divided into core components and modules, each responsible for specific functionality. All components are implemented in **Node.js with TypeScript**, enabling type safety and a consistent language across server, client, and tooling.

### **1\. Tunnel Server**

The Tunnel Server is the central component running on a publicly accessible host. Its responsibilities include:

* **Connection Listener:** Listens for incoming Tunnel Client connections on a specified port. This may use WebSocket over HTTPS (wss) or a custom TCP protocol. For HTTP/HTTPS tunnels, the server can listen on ports 80/443 (or behind a proxy) for external HTTP traffic, as well as a separate control port for client connections (if using a distinct channel).

* **Domain & Subdomain Routing:** Manages the mapping of public hostnames to active tunnels. For each active tunnel, the server tracks its assigned subdomain. Incoming HTTP requests are routed based on the `Host` header to the appropriate tunnel. Dynamic subdomains are generated for new tunnels if no specific name is requested. Static subdomains (vanity URLs) are reserved per user or configuration. The server must handle DNS wildcards (the user will configure DNS such that `*.example.com` points to this server) and optionally allow custom domains to be mapped to tunnels in the future.

* **HTTP/HTTPS Proxy:** Acts as an HTTP reverse proxy. It terminates external HTTP/HTTPS connections and forwards the data through the tunnel. For HTTPS, the server uses a wildcard SSL certificate (configured by the hoster) to decrypt incoming traffic, then sends the HTTP data securely to the client. (In a future TLS passthrough mode, it could forward encrypted bytes without terminating, but initial focus is termination for inspection.)

* **Multiplexing & Session Management:** Efficiently manages multiple tunnels and multiple requests per tunnel. The server can support many simultaneous client connections. For each HTTP request arriving for a given tunnel, the server either uses an existing persistent channel to the client or instructs the client to accept a new connection. The design will likely use a single control connection per client (to manage tunnel metadata and health) and separate data connections or streams for each request. For example, a WebSocket connection could carry multiple logical streams, or the client might open additional TCP connections on demand – this is handled by the **Protocol Handler** (see Extensibility section).

* **Security & Authentication:** Verifies that connecting clients are authorized (e.g. checks an auth token or API key presented by the client on connection). It enforces access control policies for each tunnel (such as requiring HTTP basic auth for certain tunnels, IP whitelisting, etc., as configured).

* **Rate Limiting:** Enforces rate limiting rules on incoming requests to each tunnel. This might be done by an internal middleware that checks the origin IP and endpoint of each request against defined rules. For example, if a rule limits `POST /api/*` to 100 requests per minute per IP, the server will track the counts and throttle or block requests exceeding the limit. These rules can be globally configured and also overridden per tunnel or per user.

* **Logging & Traffic Inspection:** Logs each request and response (headers, timestamps, sizes, status codes, etc.) passing through the tunnels. It stores records for real-time inspection and historical analysis. The server exposes these logs via the Dashboard UI and possibly via an API. For real-time needs, the server may stream log events (e.g. over a WebSocket to the UI or CLI when in verbose mode) to allow live monitoring. Logged data can be stored in memory (for recent activity), with options to persist to a database or file for long-term storage.

* **REST API Endpoints:** Exposes a RESTful API (over HTTP, typically authenticated) for managing tunnels and querying status. This includes endpoints to create/close tunnels, list active tunnels, fetch logs, manage users, etc. The Dashboard uses these APIs under the hood. External tools could also use them to integrate with CI/CD or other systems.

* **Administration & Configuration:** Provides internal modules for user management (if multi-user mode is enabled), configuration loading (reading config files or env variables on startup), and plugin management (loading any installed protocol or middleware plugins). Administration tasks like adding a new user or revoking access could be done via config or future admin UI/CLI tools.

In summary, the Tunnel Server is a **Node.js service** running a web server (for both incoming user traffic and management API/UI) and a tunnel coordinator. It ties together routing, security, and performance features to handle numerous tunnels concurrently.

### **2\. Tunnel Client (Developer CLI Agent)**

The Tunnel Client is a command-line tool (and underlying library) that developers run on their local machines to expose a local service. Key aspects of the client:

* **CLI Interface:** A user-friendly CLI (`opentunnel`) that accepts parameters such as local port, optional subdomain, protocol (http/https), and authentication token. For example: `opentunnel --port 3000 --subdomain=myapp --authToken=XYZ`. The CLI provides help, version info, and possibly interactive prompts for common setups. It is distributed via npm (installable globally) so that developers can easily get it running.

* **Secure Connection to Server:** Upon start, the client establishes a secure connection to the configured Tunnel Server. This could be implemented by initiating a WebSocket over HTTPS to the server’s control API (e.g. wss://tunnel.example.com/connect) or a custom TCP socket using TLS. The client authenticates itself (sending credentials or tokens) and requests the creation of a tunnel (including desired subdomain if any). On successful negotiation, it keeps this connection open. This channel is used to carry data or control messages between server and client.

* **Local Proxying:** The client acts as a proxy on the developer’s machine. When it receives an incoming request from the server (over the tunnel connection), it forwards that request to the local target (e.g., [http://localhost:3000](http://localhost:3000/)). This involves opening a connection to the local service, sending the HTTP request data, and reading the response. The client then sends the response back over the tunnel to the server, which relays it to the external user. The client must handle multiple requests potentially in parallel. Depending on the multiplexing strategy, it may handle multiple streams over one connection or manage multiple connections. In any case, it ensures each external request is forwarded to the local app and the response is returned correctly.

* **Protocol Handling:** Initially, for HTTP/HTTPS, the client will parse control messages (like “new HTTP request on tunnel X”) and then stream raw HTTP data. It doesn’t need to deeply inspect HTTP content (the server does that for routing), but it should handle chunked transfer, connection keep-alive, and possibly WebSocket upgrade requests seamlessly. For future protocols (TCP, etc.), the client might open a specific port and simply pipe bytes. The client’s architecture will mirror the server’s plugin system so it can support new protocol handlers as they are added.

* **Resilience:** If the connection to the server drops, the client will attempt to reconnect automatically (with backoff). If the local service goes down (connection refused on localhost), the client can return an appropriate error to the server (so the external user sees a friendly error), and possibly keep the tunnel alive to wait for the service to come back. The client will periodically send heartbeat messages to let the server know it’s still alive, enabling the server to detect stale tunnels.

* **Minimal Footprint:** The client is designed to be lightweight. It may be packaged as an npm binary or even a standalone binary via pkg or similar, for ease of use. It should run on all major OS (Windows, Linux, Mac) under Node.js. The memory and CPU usage should be low when idle (just maintaining a connection) and scale modestly with traffic (most of the heavy lifting is just I/O forwarding).

* **Configuration:** The client can read config (perhaps from a `~/.opentunnel` file) to store default server URL, auth token, or other preferences so that the CLI command can be simple (like just `opentunnel --port 3000` if the rest is pre-configured). This improves developer experience by not requiring long arguments each time.

In essence, the Tunnel Client provides a **developer-friendly front-end** to the tunneling service, wrapping the complexity of connection management into a simple command. It faithfully ferries data between the local server and the Tunnel Server.

### **3\. Web Dashboard (React UI)**

The Dashboard is a web-based user interface for managing tunnels and monitoring traffic. It is built as a single-page application (SPA) in React (TypeScript) and communicates with the Tunnel Server’s REST API and real-time endpoints. Major UI modules and features include:

* **Authentication UI:** If the service requires login (in multi-user mode), the dashboard will present a login page for users to authenticate (username/password or token). Upon login, a user session (JWT or similar) is stored to authorize API requests. For single-user deployments, this can be disabled or simplified.

* **Dashboard Overview:** A homepage showing high-level stats and status. For example, it might display the number of active tunnels, total requests served in the last 24h, current bandwidth usage, etc. Graphs or summary cards can provide at-a-glance analytics (e.g., a chart of requests over time). This gives a quick health check of the system.

* **Tunnels Management Page:** A section listing all active tunnels (and possibly recently closed ones). Each tunnel entry shows details such as the public URL, the target local address, the protocol, the owner (user who started it), start time, and current status. From this page, an authorized user could perform actions: close a tunnel, restart it (if persistent), or copy the public URL. In future, this page might also allow creating new tunnels via the UI (though initially tunnels are typically started from CLI, an admin might want to pre-create a static tunnel).

* **Traffic Inspector (Live):** A real-time feed of requests and responses flowing through the tunnels. This is similar to ngrok’s inspection UI. It lists recent HTTP requests with details like timestamp, method, URL path, response status, and latency. The UI allows clicking on a specific request to view full details: request headers, body (if loggable), response headers, body, and any meta info. This is extremely useful for debugging webhooks and API calls. The live feed can be filtered by tunnel or by search queries (e.g., only show POST requests or a specific endpoint). The dashboard might use WebSockets to get push updates of new requests instantly as they happen.

* **Logs & Historical Analytics:** Beyond the live feed, the UI will provide access to historical logs. Users can query logs by date range, tunnel, or other criteria. There might be an interface to download logs or view aggregated statistics (e.g., total requests per endpoint, distribution of response codes, etc.). Basic visualization (like a chart of traffic volume over time, or pie chart of response statuses) can be included for analytics.

* **Rate Limiting Management:** A configuration UI for rate limiting rules may be provided. This would list all active rate limit rules (with details such as scope, limit, interval, etc.). Admin users could add, edit, or remove rules through the interface. For example, an admin could add a rule: “Limit **GET /api/** for Tunnel X to 50 requests/min per IP”. The UI would allow specifying conditions (IP, endpoint path pattern, HTTP method, user/tunnel) and the limit values. The state of each rule (active, hits, blocks) could also be displayed for monitoring which rules are being triggered. *(If implementing a UI for this is too complex for v1, rate limits might initially be configured via a config file; however, the architecture should allow surfacing this in the UI later.)*

* **User Management (Admin Module):** In a multi-user scenario (if the tunnel service is shared by a team or organization), an admin panel would let administrators manage user accounts. This includes creating users, assigning roles (admin or regular user), generating or revoking API keys, and viewing each user’s usage (e.g., how many tunnels, last active time, etc.). Each user could have profile settings like resetting password or viewing their personal auth token for CLI use. This module ensures secure access control in a shared environment.

* **Settings:** A general settings page for server administrators. This might display configuration info such as the base domain in use, available protocols or plugins installed, log retention policy, etc., and allow editing some of these if applicable. For example, toggling certain experimental features on/off or updating the branding (name/logo) if needed. Not all settings would be editable via UI (some are file-based), but it provides transparency into the running configuration.

* **Feedback & Status:** The UI can show system status notifications (e.g., “Server will restart at 5pm for upgrade” or “New version available”) and possibly allow users to send feedback or report issues (maybe linking to the open-source repository).

The React app will be built and packaged so that the Tunnel Server can serve it (usually as static files) on a route (e.g., `https://tunnel.example.com/dashboard`). It will use modern UI libraries and practices, ensuring a responsive and clean interface. Emphasis is on clarity and developer experience – making it easy to see what’s happening with your tunnels and to configure rules without digging into config files.

### **4\. Rate Limiter & Access Control Engine**

This is an internal module in the server dedicated to enforcing usage policies. It works as follows:

* **Rate Limiting:** A configurable engine that checks each incoming request against a set of rules. The rules can target various scopes: by client IP, by HTTP endpoint (URL path and method), by tunnel (or user who owns the tunnel), or any combination thereof. Each rule defines a maximum allowed number of requests within a time window (e.g., 100 requests per minute) and an action (e.g., block for the remainder of the window, or drop excess requests). The server will come with a default sensible limit (to prevent extremely high load by mistake) and allow customization. Implementation-wise, a token bucket or sliding window counter technique can be used, possibly leveraging existing libraries (like `rate-limiter-flexible` in Node) for efficiency. This engine needs to be high-performance and not introduce significant latency. It will likely run as middleware in the request handling pipeline on the server, incrementing counters and deciding whether to continue processing or respond with an HTTP 429 (Too Many Requests) if a limit is exceeded.

* **Authentication & Authorization:** The server requires that each Tunnel Client provide valid credentials to create a tunnel. This can be an API token issued to the user, or a username/password for logging in (if interactive). The Auth module will validate these against the user database (or a simple config for single-user mode). Additionally, the server can enforce that certain tunnels require end-user authentication: for example, a developer can mark a tunnel as “protected”, requiring a username/password (HTTP Basic Auth) for anyone trying to access the public URL. The server would then challenge incoming requests accordingly. Another aspect is IP-based access control: the system can allow specifying allowed IP ranges or blocked IPs for each tunnel (or globally). If a request comes from a disallowed IP, the server will reject it (e.g., with 403 Forbidden). This provides a security layer on top of the exposed service.

* **User Roles and Permissions:** In multi-user mode, the access control layer ensures users can only manage their own tunnels. Regular users can create/stop their tunnels and view their logs, but cannot see or affect other users’ tunnels. Admin users can view and manage all tunnels and system settings. The REST API endpoints and UI will respect these permissions (e.g., an API call to list all tunnels will return only those belonging to the authenticated user, unless they are admin). This requires the auth system to issue tokens with roles/claims and the server to check them on each operation.

* **Extensibility of Rules:** The design should allow custom rule sets beyond just rate limiting. For instance, in the future one might plug in a module for content filtering (blocking certain URLs or payload patterns) or data quotas (limiting total bytes transferred). The Rate Limiter/ACL engine could be designed in a pluggable way: have a series of “policy check” middleware where each policy (rate limit, IP whitelist, etc.) is a plugin implementing a common interface (with methods like `onRequest(request): PolicyDecision`). This way, new policies can be added without altering the core server loop, just by registering a new policy plugin.

In summary, the Rate Limiter & Access Control Engine guards the tunnels to ensure they are used within intended bounds and only by authorized parties. It protects both the tunnel host (from overload) and the local services (from malicious access), and is fully configurable by the server operator.

### **5\. Logging and Analytics Module**

Logging and analytics are crucial for debugging and understanding usage. This module on the server handles:

* **Request/Response Logging:** Each time a request is forwarded through a tunnel, the server creates a log entry containing details: timestamp, tunnel ID, user, source IP, HTTP method and URL, response status, response time, and possibly the payload sizes. These logs are stored in a structured format (e.g., as JSON objects in memory or in a database table). The logger is careful not to store sensitive data inadvertently; for instance, it might mask authorization headers or large binary payloads unless explicitly configured to capture them (for debugging).

* **Real-Time Stream:** For live monitoring, the module can push log events to subscribers. The Dashboard or CLI (in verbose mode) could subscribe (likely via WebSocket or Server-Sent Events) to receive each log as it happens. This real-time stream enables the “Traffic Inspector” UI to update instantly. It may also allow features like replaying a request: since the server logged the request details, a user could click “replay” in the UI which would instruct the Tunnel Client to resend the same payload to the local server (facilitating quick debugging without re-triggering an external webhook).

* **Storage and Retention:** By default, recent logs are kept in memory (for quick access via the UI). For longer-term storage, the server can output logs to a file or a database. The configuration will allow specifying a log retention policy (e.g., keep last 7 days in memory, older logs optionally saved to disk, auto-purge after 30 days, etc.). The module could integrate with external logging systems as well – e.g., allow a plugin to ship logs to ELK stack or a cloud monitor – but by default a simple local storage is sufficient.

* **Aggregated Analytics:** The analytics part of the module processes the raw logs to generate metrics. This could be done on-the-fly or periodically. Metrics include request rates, error rates (percentage of 4xx/5xx responses), average response time, data transferred, etc., broken down by tunnel or overall. These metrics feed the Dashboard Overview graphs and can also be queried via API (e.g., an endpoint to get the last 1 hour traffic stats). If needed, a simple in-memory time-series or counters can track these, or the data can be computed from logs when requested. Since performance is a concern, heavy analytics computations might be done asynchronously or with caching to avoid slowing down the live traffic handling.

* **Debugging Support:** The logging system can operate in different verbosity levels. In normal mode, it might log only summary info (for performance). In a debug mode (configurable per tunnel or global), it could log full headers and bodies for deeper inspection. The developer can toggle this via config or UI when needed (e.g., to troubleshoot a problematic webhook payload). Caution is taken that enabling verbose logging might impact performance and security (sensitive data in logs), so it’s used only as needed.

By providing both low-level logs and high-level analytics, this module ensures that users have full visibility into what is happening through their tunnels, which is a major advantage for an open-source tunneling tool compared to black-box services.

### **6\. Developer CLI & REST API**

While the Tunnel Client CLI has been described, this section emphasizes the interfaces available to developers and integrators for interacting with the system:

* **CLI Tooling:** The primary CLI (`opentunnel`) is used to start and stop tunnels from the developer’s machine. In addition, we may provide sub-commands for other common tasks. For example, `opentunnel ls` could list active tunnels associated with the user (by querying the server’s API), or `opentunnel stop <id>` to close a specific tunnel. There might also be commands for viewing logs from the terminal (`opentunnel logs <tunnelId>` to tail the logs in console) or for generating a config template. The CLI should have an easily extensible command structure (possibly using a library like Commander.js for parsing). All CLI commands will ultimately use the REST API or direct control channels to perform actions, ensuring that anything possible in the CLI could be done via API as well.

* **Programming Library Usage:** Since the project is an npm package, developers can also use it programmatically. For instance, instead of using the CLI binary, one could `import { createTunnel } from 'opentunnel'` in a Node script and achieve the same effect as the CLI (this might simply call the underlying client logic). This is useful for automated testing or integration scenarios (e.g., spinning up a tunnel during a test run and closing it after tests). The API for such usage should be well-documented, and essentially wrap around the same mechanisms as the CLI.

* **REST API:** The server exposes a RESTful API that covers management operations. Key endpoints include:

  * `POST /api/tunnels` – Request a new tunnel. The client uses this when initiating a tunnel (providing desired subdomain, protocol, etc.), and the server responds with the assigned URL and details.

  * `GET /api/tunnels` – List active tunnels (scoped to the authenticated user, unless admin).

  * `DELETE /api/tunnels/{id}` – Close a specific tunnel. (The server will inform the corresponding client to shut down that tunnel connection.)

  * `GET /api/tunnels/{id}/logs` – Retrieve recent logs for a tunnel (with filtering options like time range, or perhaps offered via WebSocket for live tail).

  * `GET /api/status` – General status of the server (uptime, version, resource usage, etc.) for health checks.

  * `GET /api/users` (admin only) – Manage users, etc. Possibly also endpoints for rate limit rules: `GET/POST /api/rules` to view or add rate limiting and access rules.

* All REST endpoints require authentication (e.g., a header with an API token or a session cookie from logging into the Dashboard). The API will be documented (OpenAPI/Swagger definitions could be provided for ease of use). This allows third-party tools or scripts to automate tasks, like deploying a dev environment and automatically opening a tunnel, or dynamically adjusting access controls.

* **WebSockets/API for Real-time Control:** In addition to REST (request/response), certain interactive features might use WebSockets. For example, the client connection itself might be a WebSocket on a special path (as mentioned for tunneling). Also, the Dashboard could open a WebSocket to stream logs or status updates. We may also allow the CLI to open a WebSocket to follow events. These real-time APIs complement the REST API for use cases that need push notifications (like showing in the UI that a tunnel disconnected unexpectedly).

The combination of CLI, library, and REST API ensures that developers can interact with OpenTunnel in whatever way fits their workflow. The CLI and REST API both aim to be **developer-friendly**, with clear naming, helpful error messages, and consistent behavior, lowering the barrier to adoption.

### **7\. Protocol Extensibility (Plugin Architecture)**

A core requirement is that the system be extensible to support additional protocols (such as raw TCP, TLS tunnels, or others) beyond the initial HTTP/HTTPS. To achieve this, OpenTunnel will employ a plugin-based architecture. The design includes:

* **Protocol Handler Interface:** The server defines an interface (and TypeScript types) for a Protocol Handler module. For example, an HTTP handler might implement methods like `onClientConnected(clientConn, options)` and `onIncomingConnection(serverConn)`. The interface will likely include:

  * Method to initialize the handler (possibly with global config or dependencies like the logger).

  * Handling of new client registration for that protocol (e.g., when a client wants to open a new HTTP tunnel, the HTTP handler will generate a subdomain and set up routing for it).

  * Handling of incoming external connections of that type (for HTTP, this is each new HTTP request; for a TCP plugin, it could be a new TCP socket on a certain port).

  * Any cleanup needed when a tunnel closes.

* By following this interface, new protocol support can be added by writing a module without modifying the core server logic. The core will delegate to the appropriate handler based on the tunnel type.

* **Plugin Registration:** The system can allow plugins to be dynamically loaded. This could be done via configuration (listing the plugin packages to load on startup) or by convention (e.g., any npm package that matches a naming scheme or is placed in a plugins directory is auto-loaded). For instance, a future **TCP Plugin** might be published as `opentunnel-protocol-tcp`. The server config would include it, and on startup the server loads this plugin, which registers itself to handle tunnels of type “tcp”. This decouples the core from needing to know details of every protocol.

* **Core vs Plugin Responsibilities:** The core server still handles common tasks like authentication, generic routing, and connection establishment. Once a connection is handed off to a protocol plugin, the plugin will take over to manage the data flow specifics:

  * For **HTTP/HTTPS (built-in)**: The plugin will manage virtual host routing and HTTP parsing if needed (though Node’s HTTP server can assist). It ensures each HTTP request is forwarded properly through the multiplexing channel.

  * For **TCP (future plugin)**: Perhaps the server listens on a range of ports or uses SNI (for TLS) or a special subdomain to identify a TCP tunnel. The TCP plugin could allow a client to request “I want to expose my local port 5432 as a remote port”. The plugin would then allocate a port on the server or instruct the client/server to treat any connection to a certain address as raw TCP and forward bytes.

  * For **TLS (future)**: Could be treated similarly to TCP but possibly with SNI-based routing. E.g., a TLS plugin might allow forwarding arbitrary TLS services by routing based on the TLS SNI hostname (without decrypting) to the correct tunnel.

  * **WebSocket:** Standard WebSockets over HTTP will already work with the HTTP handler. If we consider raw WebSockets without HTTP (not standard), it’s not needed since WebSocket always starts as an HTTP upgrade. So, no separate plugin required for WS beyond ensuring the HTTP plugin does not interfere with the upgrade and streams data properly (which Node’s HTTP server can handle).

* **Extensible Middleware:** Apart from protocols, other parts of the system are also extensible. The architecture could allow plugins for:

  * **Authentication methods** (e.g., plug in an OAuth2 login instead of basic user/pass, or integrate with an SSO system).

  * **Storage backends** (e.g., a plugin to use Redis or MongoDB for log storage instead of local memory/file, by implementing a logging interface).

  * **Custom Analytics** (a plugin could pull events and do something like send metrics to a third-party service).

* To enable this, the core would have defined extension points or hooks. For instance, a hook on each request (`onRequestHandled`) that any plugin can subscribe to, or a user authentication interface that can be swapped out. The configuration can specify which implementation to use (for example, `authProvider: "local|oauth|ldap"` and then load the respective plugin module).

* **Versioning and API Stability:** The plugin interface should be clearly documented and versioned. As the project evolves, maintaining backward compatibility for plugins is important so that external contributors can develop and maintain plugins independently. If breaking changes are needed, a version negotiation or compatibility layer might be considered (though in early stages, simply documenting changes may suffice).

This plugin-based approach ensures **future protocols and features can be integrated** without bloating the core or risking stability for existing features. It also encourages community contributions (e.g., someone might contribute a plugin for UDP tunneling or a specialized authentication module). Initially, the HTTP/HTTPS support itself can be structured as the first plugin (perhaps built-in), proving that the interface works, and then additional modules (TCP, etc.) can follow the same pattern.

## **Configuration and Deployment**

OpenTunnel is designed to be easily self-hosted and configurable to fit different environments. The configuration model and deployment considerations are as follows:

* **Configuration File:** The server will accept a configuration file (e.g., `config.json` or `config.yaml`) that defines all the key settings. This includes:

  1. **Domain Settings:** The primary domain under which tunnels will be created (e.g., `"domain": "example.com"` for tunnels like `*.example.com`). Also options for any additional domains or subdomain prefixes if needed, and paths to SSL certificates for these domains (or flags to use Let’s Encrypt/ACME for automatic certs, if implemented).

  2. **Network Settings:** Ports to listen on (for the public HTTP/HTTPS interface and for the tunnel control port if separate). Optionally proxy settings if the server is behind another reverse proxy (like if deploying behind Nginx, etc., one might disable direct port 80 listening).

  3. **Authentication & Users:** Definition of users and their credentials/roles if using a simple file-based auth (could be a list of user objects with hashed passwords or API tokens). Alternatively, config for external auth (like OAuth client IDs, etc., if applicable in future).

**Rate Limit Rules:** A section to define default rate limiting rules. For example:

 ```
 rateLimits:
  - scope: "ip" 
    endpoint: "*" 
    limit: 100 
    per: "minute"
  - scope: "user" 
    user: "free-tier" 
    limit: 1000 
    per: "day"
  - scope: "endpoint" 
    match: "POST /api/.*" 
    limit: 50 
    per: "minute"
```

4.  This expresses various rules (the exact format to be finalized in documentation). These rules are loaded at startup and can be modified via API if needed.

   5. **Access Control Rules:** Similar structure for any static access rules like IP allow/deny lists or required authentication on certain tunnels. For instance, one could specify that a particular subdomain requires a HTTP basic auth with given credentials, etc.

   6. **Logging & Storage Config:** Where to store logs (in-memory, file path, database connection string if using one). Log level/verbosity settings. Retention duration for keeping logs.

   7. **Plugin Config:** Enabling or disabling certain plugins or protocols. E.g., `"enableTCP": false` initially to disallow raw TCP until the plugin is added, etc. Or listing plugin modules and any specific settings they need.

   8. **UI/Dashboard Settings:** Basic settings for the Dashboard – for example, enabling the admin panel, or customizing UI branding (logo path, title). Also possibly setting the port or mount path for the dashboard if needed.

   9. **Performance Tuning:** Advanced settings like max number of tunnels, max concurrent connections per tunnel, timeout values for idle connections, etc., with sensible defaults but override capability for high-load scenarios.

* The configuration file can be in a human-editable format (YAML or JSON). The server will load this on startup. Alternatively, environment variables can override certain keys for convenience in container deployments (for instance, `OPENTUNNEL_DOMAIN=example.com` could override the domain setting).

* **Deployment as a Service:** Since it’s an npm package, one can set up a server by installing the package and running, e.g., `npx opentunnel-server -c config.yaml`. To simplify, we might provide a small wrapper or even a Docker image. A Docker image would allow quick self-hosting (`docker run -v ./config.yaml:/app/config.yaml -p80:80 -p443:443 opentunnel`) and could bundle Node, the server, and maybe Caddy or Nginx if needed for TLS. However, given Node can handle TLS itself, it might not need an external proxy unless for performance. Documentation will guide users to:

  1. Obtain a domain and set a wildcard DNS (e.g., `*.example.com` to point to the server’s IP).

  2. Provide SSL certificates (via config path or an automated option).

  3. Run the OpenTunnel server.

  4. Install the CLI and connect to their server.

* **Scalability & Clustering Assumptions:** The initial design assumes a single server node that holds all tunnels. This simplifies implementation (no need for distributed coordination). It’s expected to handle the typical usage of a development tunneling service (dozens of tunnels, hundreds to low thousands of requests per minute in total). If needed, the server could be scaled vertically (since Node can handle quite a bit of I/O) or potentially run multiple instances behind a load balancer with sticky subdomain routing – but multi-instance clustering is a future consideration and not covered in the base spec. We assume one instance is sufficient for the target use (developers in a team or community).

* **Monitoring and Maintenance:** The service should expose some metrics (possibly via an endpoint like `/metrics` for Prometheus, or at least the status API) so that an operator knows it’s healthy. Logging is already described. We assume the operator will take care of running it as a background service (e.g., using systemd or Docker). Regular maintenance like cleaning up old logs or rotating keys can be handled by built-in retention settings or external scripts since the data formats will be open.

* **Client Configuration:** The developer using the CLI might also have a config (e.g., `~/.opentunnelrc`). This could store their default server URL (if they host their own, versus default), and their auth token or credentials (securely). This way, each time they run the CLI, they don’t need to specify `--host` or `--token`. The CLI config should be optional and encrypted or at least protected (especially if storing an auth token). On first use, the CLI can guide the user to set up these defaults for convenience.

By providing a clear configuration model and deployment instructions, we ensure that the open-source project is **easy to adopt and self-host**. A sample configuration with commentary will be included in documentation to help users get started quickly.

## **Assumptions and Constraints**

To clarify the context and ground the design, here are the key assumptions and constraints considered in this specification:

* **Technical Stack:** The entire backend is written in Node.js with TypeScript, targeting a LTS Node version (e.g., Node 18+). This means the environment supports modern JavaScript/TypeScript features and high throughput asynchronous I/O, but it remains single-threaded (aside from using the event loop). Heavy CPU-bound tasks should be avoided or offloaded if possible; however, most work here is I/O. Using Node also implies cross-platform compatibility for the client, and ease of extension via the npm ecosystem for plugins.

* **Security:** We assume the environment is not hostile, but security is a priority since the server is exposed on the internet. All communications between client and server are encrypted (TLS). The server’s domain and certificate management is the responsibility of the deployer (our software will use provided certs, or facilitate ACME if possible, but will not run completely without proper TLS configuration in production mode). We also assume users will secure their dashboard (with auth) if running on a public host to prevent unauthorized access to logs or controls. Passwords or tokens stored in config are kept hashed or encrypted when possible.

* **Domain and DNS:** It’s assumed the user deploying OpenTunnel has control over a domain and can create a wildcard DNS entry. Without this, the dynamic subdomain feature cannot function. (For testing, one could use xip.io or similar trick, but that’s outside scope). We also assume only a few base domains will be configured – the system isn’t intended as a public free service (like serving unlimited random users), but rather for a team or private use. If someone tries to run it as a public service, they’d have to add more monitoring and possibly scale-out, which is beyond our first-phase design.

* **Load and Performance:** The design caters to development and testing workloads. This means occasional bursts of traffic (when demonstrating or testing an app) and periods of idle. It is not initially optimized for extremely high sustained throughput or very low latency beyond what Node can normally handle. Running a heavily trafficked production website through these tunnels continuously is not the primary use case (though it might work to some extent). The assumption is each tunnel handles maybe a few requests per second on average, and the server handles tens of tunnels – which is well within Node’s capability. If our user community later pushes for more, we’d consider performance tuning or recommending beefier hardware.

* **Single Server Node:** As noted, we assume a single server instance. This simplifies session management (since each tunnel lives on one server). In a failure scenario (server down), all tunnels drop – this is acceptable in the context of a dev tool. High availability setups are not addressed in v1. (An advanced user could run a backup server and have clients reconnect there manually). We also assume the server machine has enough resources (memory, bandwidth) to handle the expected load.

* **Client Environment:** We assume developers will run the client on their local machines or CI environments which have outbound internet access to reach the server. Many corporate networks allow outgoing TLS connections on port 443, so using WebSockets over 443 should work in most cases (which is why we lean towards wss as default transport). In cases where websockets aren’t allowed, we might need a fallback (like TLS with a custom ALPN, or long polling) but that’s beyond initial scope.

* **Future Protocol Support:** While the architecture is built to allow TCP, TLS, and maybe other protocols, we assume for now that those are not immediately needed by all users. HTTP/HTTPS covers the majority of use cases (webhooks, web app demos, API testing). That said, we keep in mind things like WebSocket upgrades which are part of HTTP. True raw TCP (for databases, SSH, etc.) will be added later and might introduce additional considerations (like handling half-open connections, TCP resets, etc.). The plugin design is an assumption that this will be easier than building support directly – which we believe given the separation of concerns.

* **Open-Source Collaboration:** As an open-source project, we assume contributions will come from the community. Thus, code should be modular and readable, and the spec’s outlined features might be implemented incrementally. Also, documentation (user guides, contributing guides) will be important but are not detailed here. We assume maintainers will enforce code quality and security reviews for contributions, especially for plugins.

In conclusion, given these assumptions, we expect OpenTunnel to be a **robust development tool** that users can deploy on their own, knowing the limitations (dev/test focus, not a global CDN or a replacement for production API gateways) but enjoying the benefits of control and customization (no arbitrary limits or fees, ability to extend functionality, full visibility into the system). The design balances **feature richness** (matching ngrok and more) with **simplicity** in deployment and usage.

## **Conclusion**

This technical specification outlined the design of OpenTunnel – an open-source, ngrok-like tunneling service with enhanced features. By providing secure tunnels for HTTP/HTTPS, a rich management dashboard, flexible routing, and a plugin-friendly architecture, OpenTunnel is poised to empower developers with their own tunneling solution. The Node.js \+ TypeScript stack ensures a consistent and extensible codebase, while features like rate limiting, authentication, and logging ensure the tunnels remain secure and under control.

With this foundation, the project can be implemented in modules, tested thoroughly in real-world scenarios, and extended to support additional protocols and use-cases. The result will be a community-driven tunneling platform that combines the convenience of ngrok with the transparency and flexibility of open-source software.

