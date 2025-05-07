import React, { useState } from "react";
import { StatsDisplay } from "./StatsDisplay";
import { RateLimitIndicator } from "./RateLimitIndicator";

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

interface TunnelCardProps {
  tunnel: Tunnel;
  onDelete: (id: string) => void;
}

export const TunnelCard: React.FC<TunnelCardProps> = ({ tunnel, onDelete }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(tunnel.id);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  return (
    <div
      className={`bg-white rounded-lg shadow-md transition-all duration-200 ${
        showDeleteConfirm ? "ring-2 ring-red-500" : "hover:shadow-lg"
      }`}
    >
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <h3
                className="text-lg font-semibold text-gray-900 truncate"
                title={tunnel.id}
              >
                {tunnel.id.slice(0, 8)}...
              </h3>
              <button
                onClick={() => copyToClipboard(tunnel.id)}
                className="text-gray-400 hover:text-gray-600"
                title="Copy ID"
              >
                {showCopied ? (
                  <svg
                    className="w-5 h-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </div>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                tunnel.status === "active"
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {tunnel.status}
            </span>
          </div>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Delete tunnel"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-gray-600 hover:text-gray-800"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="text-red-600 hover:text-red-800 font-medium"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <span className="flex items-center space-x-1">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>Deleting...</span>
                  </span>
                ) : (
                  "Confirm Delete"
                )}
              </button>
            </div>
          )}
        </div>

        {/* Port Information */}
        <div className="grid grid-cols-2 gap-4 py-3 border-t border-b border-gray-100">
          <div>
            <p className="text-sm text-gray-500">Local Port</p>
            <p className="text-lg font-medium text-gray-900">
              {tunnel.localPort}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Remote Port</p>
            <p className="text-lg font-medium text-gray-900">
              {tunnel.remotePort}
            </p>
          </div>
        </div>

        {/* Stats */}
        <StatsDisplay stats={tunnel.stats} />

        {/* Rate Limit */}
        <RateLimitIndicator
          remaining={tunnel.stats.rateLimit.remaining}
          total={tunnel.stats.rateLimit.total}
          resetTime={tunnel.stats.rateLimit.resetTime}
        />

        {/* Creation Time */}
        <div className="text-sm text-gray-500">
          Created: {new Date(tunnel.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
};
