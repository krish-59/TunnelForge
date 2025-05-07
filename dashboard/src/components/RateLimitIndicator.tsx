import React from "react";

interface RateLimitIndicatorProps {
  remaining: number;
  total: number;
  resetTime: string;
}

export const RateLimitIndicator: React.FC<RateLimitIndicatorProps> = ({
  remaining,
  total,
  resetTime,
}) => {
  const percentage = Math.round((remaining / total) * 100);

  // Format reset time for display
  const formatResetTime = (resetTime: string): string => {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return "Reset now";

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffHour > 0) {
      return `Resets in ${diffHour}h ${diffMin % 60}m`;
    } else if (diffMin > 0) {
      return `Resets in ${diffMin}m ${diffSec % 60}s`;
    } else {
      return `Resets in ${diffSec}s`;
    }
  };

  const statusColor = () => {
    if (percentage >= 75)
      return {
        bg: "bg-emerald-100",
        text: "text-emerald-800",
        bar: "bg-emerald-500",
      };
    if (percentage >= 40)
      return { bg: "bg-blue-100", text: "text-blue-800", bar: "bg-blue-500" };
    if (percentage >= 15)
      return {
        bg: "bg-amber-100",
        text: "text-amber-800",
        bar: "bg-amber-500",
      };
    return { bg: "bg-red-100", text: "text-red-800", bar: "bg-red-500" };
  };

  const { bg, text, bar } = statusColor();

  return (
    <div className={`${bg} rounded-lg p-4 relative overflow-hidden`}>
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-6 -translate-y-6 opacity-10">
        <svg className="w-full h-full" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <div className="flex justify-between items-center mb-3">
        <h4 className={`font-medium ${text}`}>Rate Limit Status</h4>
        <span
          className={`text-xs font-semibold px-2 py-1 rounded-full ${text} bg-opacity-20 ${bg}`}
        >
          {formatResetTime(resetTime)}
        </span>
      </div>

      <div className="flex justify-between items-baseline mb-2">
        <div className="flex items-center gap-1">
          <span className={`text-2xl font-bold ${text}`}>{percentage}%</span>
          <span className="text-sm text-gray-600">remaining</span>
        </div>
        <div className="text-sm text-gray-600">
          {remaining.toLocaleString()} of {total.toLocaleString()} requests
        </div>
      </div>

      <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full ${bar} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {percentage < 15 && (
        <div className="mt-3 flex items-start text-sm text-red-700">
          <svg
            className="h-5 w-5 flex-shrink-0 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            Rate limit nearly exhausted! Consider reducing request frequency.
          </span>
        </div>
      )}
    </div>
  );
};
