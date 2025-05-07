const express = require("express");
const app = express();
const PORT = 8080;

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Test endpoint
app.get("/", (req, res) => {
  res.send(`<html>
    <head><title>Test Server</title></head>
    <body style="font-family: Arial, sans-serif; margin: 40px;">
      <h1>Hello from Test Server!</h1>
      <p>This request was successfully tunneled through TunnelForge.</p>
      <p>Current time: ${new Date().toISOString()}</p>
      <p>Request headers: <pre>${JSON.stringify(req.headers, null, 2)}</pre></p>
    </body>
  </html>`);
});

// API endpoint
app.get("/api/data", (req, res) => {
  res.json({
    message: "This is test data from the API",
    timestamp: new Date().toISOString(),
    success: true,
  });
});

app.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
});
