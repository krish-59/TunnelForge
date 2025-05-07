import React, { useEffect, useState } from "react";
import { TunnelCard } from "./TunnelCard";
import { CreateTunnelForm } from "./CreateTunnelForm";
import { TunnelFilters } from "./TunnelFilters";
import { config } from "../config";

interface Tunnel {
  id: string;
  localPort: number;
  remotePort: number;
  status: "active" | "inactive";
  createdAt: string;
  stats: {
    requestCount: number;
    rateLimit: {
      remaining: number;
      total: number;
      resetTime: string;
    };
    uptime: number;
    bytesTransferred: number;
  };
}

export const TunnelList: React.FC = () => {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchTunnels = async () => {
    try {
      const response = await fetch(config.api.endpoints.tunnels);
      if (!response.ok) {
        throw new Error("Failed to fetch tunnels");
      }
      const data = await response.json();
      setTunnels(Array.isArray(data) ? data : data.tunnels || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setTunnels([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(config.api.endpoints.tunnel(id), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete tunnel");
      }

      setTunnels((prevTunnels) =>
        prevTunnels.filter((tunnel) => tunnel.id !== id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tunnel");
    }
  };

  useEffect(() => {
    fetchTunnels();

    // Set up WebSocket connection for real-time updates
    const setupWebSocket = () => {
      const ws = new WebSocket(config.ws.url);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setWsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "TUNNEL_UPDATE") {
            fetchTunnels();
          }
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        setWsConnected(false);
        setError("WebSocket connection error");
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        setWsConnected(false);
        // Attempt to reconnect after 5 seconds
        setTimeout(setupWebSocket, 5000);
      };

      return ws;
    };

    const ws = setupWebSocket();

    // Poll for updates every 5 seconds as a fallback
    const pollInterval = setInterval(fetchTunnels, 5000);

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      clearInterval(pollInterval);
    };
  }, []);

  const filteredTunnels = tunnels.filter((tunnel) => {
    const matchesSearch =
      search === "" ||
      tunnel.id.toLowerCase().includes(search.toLowerCase()) ||
      tunnel.localPort.toString().includes(search) ||
      tunnel.remotePort.toString().includes(search);

    const matchesStatus = statusFilter === "" || tunnel.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <CreateTunnelForm onSuccess={fetchTunnels} />

      <TunnelFilters
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : error ? (
        <div className="space-y-4">
          <div
            className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
            role="alert"
          >
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
          {!wsConnected && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded relative">
              <strong className="font-bold">Notice: </strong>
              <span className="block sm:inline">
                Real-time updates are currently unavailable. Falling back to
                polling.
              </span>
            </div>
          )}
          {/* Still show the tunnels list even if there's an error */}
          <div className="space-y-6">
            {filteredTunnels.map((tunnel) => (
              <TunnelCard
                key={tunnel.id}
                tunnel={tunnel}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!wsConnected && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded relative">
              <strong className="font-bold">Notice: </strong>
              <span className="block sm:inline">
                Real-time updates are currently unavailable. Falling back to
                polling.
              </span>
            </div>
          )}
          {filteredTunnels.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {search || statusFilter
                ? "No tunnels match your filters"
                : "No active tunnels found"}
            </div>
          ) : (
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {filteredTunnels.map((tunnel) => (
                <TunnelCard
                  key={tunnel.id}
                  tunnel={tunnel}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
