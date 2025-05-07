import winston, { Logger } from "winston";
import path from "path";

interface LogInfo {
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
} as const;

// Define colors for each level
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
} as const;

// Tell winston about our colors
winston.addColors(colors);

// Custom format for logging
const format = winston.format.combine(
  // Add timestamp
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  // Add colors
  winston.format.colorize({ all: true }),
  // Custom format
  winston.format.printf((info) => {
    const { timestamp, level, message, ...metadata } = info;
    return `${timestamp} ${level}: ${message}${
      Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : ""
    }`;
  })
);

// Create the logger
const logger: Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  levels,
  format,
  transports: [
    // Console transport
    new winston.transports.Console(),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(__dirname, "../../logs/error.log"),
      level: "error",
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(__dirname, "../../logs/combined.log"),
    }),
  ],
});

// Create a stream object for Morgan HTTP logging
const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

export { logger, stream };
