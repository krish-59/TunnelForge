import React from "react";

interface TunnelStats {
  requestCount: number;
  rateLimit: {
    remaining: number;
    total: number;
    resetTime: string;
  };
  uptime: number; // in seconds
  bytesTransferred: number;
}

interface StatsDisplayProps {
  stats: TunnelStats;
}

export const StatsDisplay: React.FC<StatsDisplayProps> = ({ stats }) => {
  // Format bytes to human-readable format
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Format seconds to human-readable duration
  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m ${Math.floor(seconds % 60)}s`;
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-gray-700 pb-1 border-b border-gray-100">
        Tunnel Statistics
      </h4>

      <div className="grid grid-cols-2 gap-4">
        {/* Request Count */}
        <div className="bg-blue-50 rounded-lg p-3 flex items-center">
          <div className="rounded-full bg-blue-100 p-2 mr-3">
            <svg
              className="h-5 w-5 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 16l-4-4m0 0l4-4m-4 4h18"
              />
            </svg>
          </div>
          <div>
            <div className="text-xs text-blue-600 font-medium">
              Total Requests
            </div>
            <div className="text-xl font-semibold text-blue-800">
              {stats.requestCount.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Bytes Transferred */}
        <div className="bg-green-50 rounded-lg p-3 flex items-center">
          <div className="rounded-full bg-green-100 p-2 mr-3">
            <svg
              className="h-5 w-5 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </div>
          <div>
            <div className="text-xs text-green-600 font-medium">
              Data Transferred
            </div>
            <div className="text-xl font-semibold text-green-800">
              {formatBytes(stats.bytesTransferred)}
            </div>
          </div>
        </div>

        {/* Uptime */}
        <div className="bg-purple-50 rounded-lg p-3 flex items-center">
          <div className="rounded-full bg-purple-100 p-2 mr-3">
            <svg
              className="h-5 w-5 text-purple-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <div className="text-xs text-purple-600 font-medium">Uptime</div>
            <div className="text-xl font-semibold text-purple-800">
              {formatUptime(stats.uptime)}
            </div>
          </div>
        </div>

        {/* Rate Limit Usage */}
        <div className="bg-yellow-50 rounded-lg p-3">
          <div className="flex items-center mb-1">
            <div className="rounded-full bg-yellow-100 p-2 mr-3">
              <svg
                className="h-5 w-5 text-yellow-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <div className="text-xs text-yellow-600 font-medium">
                Rate Limit
              </div>
              <div className="text-lg font-semibold text-yellow-800">
                {stats.rateLimit.remaining} / {stats.rateLimit.total}
              </div>
            </div>
          </div>

          {/* Rate Limit Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1.5">
            <div
              className="bg-yellow-400 h-2.5 rounded-full"
              style={{
                width: `${Math.round(
                  (stats.rateLimit.remaining / stats.rateLimit.total) * 100
                )}%`,
                transition: "width 0.5s ease-in-out",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
