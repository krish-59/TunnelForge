import React from "react";

interface TunnelFiltersProps {
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
}

export const TunnelFilters: React.FC<TunnelFiltersProps> = ({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-100">
      <h3 className="text-sm font-medium text-gray-700 mb-3">
        Filters & Search
      </h3>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label
            htmlFor="search"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Search Tunnels
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <input
              type="text"
              name="search"
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full pl-10 pr-12 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
              placeholder="Search by ID or port"
            />
            {search && (
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <button
                  onClick={() => setSearch("")}
                  className="text-gray-400 hover:text-gray-500 focus:outline-none"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="sm:w-48">
          <label
            htmlFor="status"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Filter by Status
          </label>
          <div className="relative">
            <select
              id="status"
              name="status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md appearance-none transition-colors"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
              <svg
                className="h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
      {(search || statusFilter) && (
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {search && statusFilter ? (
              <span>
                Filtering by status "<strong>{statusFilter}</strong>" and search
                term "<strong>{search}</strong>"
              </span>
            ) : search ? (
              <span>
                Searching for "<strong>{search}</strong>"
              </span>
            ) : (
              <span>
                Filtering by status "<strong>{statusFilter}</strong>"
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setSearch("");
              setStatusFilter("");
            }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
};
