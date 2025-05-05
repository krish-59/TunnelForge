import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

interface TunnelServerOptions {
  httpServer: HttpServer;
}

export class TunnelServer {
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;

  constructor(options: TunnelServerOptions) {
    this.httpServer = options.httpServer;
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: "/connect",
    });
  }

  public start() {
    this.wss.on("connection", (socket: WebSocket) => {
      // TODO: implement tunnel control protocol
      // eslint-disable-next-line no-console
      console.log("Client connected to tunnel server");

      socket.on("close", () => {
        // eslint-disable-next-line no-console
        console.log("Client disconnected");
      });
    });
  }
}
