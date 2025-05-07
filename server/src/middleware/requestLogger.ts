import morgan from "morgan";
import { stream } from "../utils/logger";

// Create custom Morgan format
const morganFormat =
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms';

// Export the middleware
export const requestLogger = morgan(morganFormat, { stream });

// Export a more detailed request logger for debugging
export const detailedRequestLogger = morgan(
  (tokens, req, res) => {
    return JSON.stringify(
      {
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: tokens.status(req, res),
        contentLength: tokens.res(req, res, "content-length"),
        responseTime: tokens["response-time"](req, res),
        userAgent: tokens["user-agent"](req, res),
        remoteAddr: tokens["remote-addr"](req, res),
        remoteUser: tokens["remote-user"](req, res),
        date: tokens.date(req, res, "clf"),
        referrer: tokens.referrer(req, res),
        httpVersion: tokens["http-version"](req, res),
      },
      null,
      2
    );
  },
  { stream }
);
