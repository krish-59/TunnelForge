import React, { useState } from "react";
import { config } from "../config";

interface CreateTunnelFormProps {
  onSuccess: () => void;
}

export const CreateTunnelForm: React.FC<CreateTunnelFormProps> = ({
  onSuccess,
}) => {
  const [localPort, setLocalPort] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [successAnimation, setSuccessAnimation] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(config.api.endpoints.tunnels, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ localPort: parseInt(localPort, 10) }),
      });

      if (!response.ok) {
        throw new Error("Failed to create tunnel");
      }

      setSuccessAnimation(true);
      setTimeout(() => {
        setSuccessAnimation(false);
        setLocalPort("");
        setIsFormVisible(false);
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tunnel");
    } finally {
      setLoading(false);
    }
  };

  if (!isFormVisible) {
    return (
      <button
        onClick={() => setIsFormVisible(true)}
        className="w-full p-6 border-2 border-dashed border-blue-200 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 hover:text-blue-700 hover:border-blue-300 hover:shadow-md transition-all duration-300 flex items-center justify-center space-x-3"
      >
        <div className="relative">
          <svg
            className="w-7 h-7"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M12 4v16m8-8H4"></path>
          </svg>
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
        </div>
        <span className="text-lg font-medium">Create New Tunnel</span>
      </button>
    );
  }

  return (
    <div
      className={`bg-white rounded-xl shadow-lg p-6 mb-6 transition-all duration-500 transform ${
        successAnimation ? "scale-105 ring-4 ring-green-300" : ""
      }`}
    >
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-xl font-semibold text-gray-800 flex items-center">
          <svg
            className="w-5 h-5 mr-2 text-blue-500"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Create New Tunnel
        </h3>
        <button
          onClick={() => setIsFormVisible(false)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="relative">
          <label
            htmlFor="localPort"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Local Port
          </label>
          <div className="relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                ></path>
              </svg>
            </div>
            <input
              type="number"
              id="localPort"
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              className="pl-10 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Enter local port (e.g. 3000, 8080)"
              required
              min="1"
              max="65535"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
                ></path>
              </svg>
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            The local port on your machine to expose through the tunnel
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 p-4 rounded-md flex items-start">
            <svg
              className="h-5 w-5 text-red-500 mr-2 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              ></path>
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-3">
          <button
            type="button"
            onClick={() => setIsFormVisible(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || successAnimation}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors ${
              loading || successAnimation
                ? "bg-indigo-400 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {loading ? (
              <span className="flex items-center space-x-2">
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span>Creating...</span>
              </span>
            ) : successAnimation ? (
              <span className="flex items-center space-x-2">
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
                <span>Success!</span>
              </span>
            ) : (
              "Create Tunnel"
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
