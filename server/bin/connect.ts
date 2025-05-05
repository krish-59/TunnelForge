#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// CLI options definition
const argv = yargs(hideBin(process.argv))
  .option("port", {
    alias: "p",
    describe: "Local port to expose",
    type: "number",
    demandOption: true,
  })
  .option("host", {
    alias: "h",
    describe: "Tunnel server host",
    type: "string",
    default: "http://localhost:3000",
  })
  .strict()
  .help().argv as unknown as { port: number; host: string };

// Placeholder implementation
console.log(
  "Connecting to tunnel server",
  argv.host,
  "to expose local port",
  argv.port
);
// TODO: implement WebSocket connection and tunnel logic
