// Get the base URL from environment variable or default
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

// Get WebSocket base URL, defaulting to window.location.host
const getWsBaseUrl = () => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
};

export const config = {
  api: {
    base: API_BASE_URL,
    endpoints: {
      tunnels: `${API_BASE_URL}/api/tunnels`,
      tunnel: (id: string) => `${API_BASE_URL}/api/tunnels/${id}`,
      tunnelStats: (id: string) => `${API_BASE_URL}/api/tunnels/${id}/stats`,
    },
  },
  ws: {
    url: `${getWsBaseUrl()}/ws`,
  },
} as const;
