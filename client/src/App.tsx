import React, { useState } from 'react';

export function App(): React.JSX.Element {
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const checkApiHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      // Calls /api/health through Vite proxy in development
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setHealthStatus(`Connected: status=${data.status}, time=${data.timestamp}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reach API');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Skip to Content Link for WCAG 2.1 AA Compliance per NR-018 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded"
      >
        Skip to main content
      </a>

      {/* Semantic Header Landmark */}
      <header className="bg-white border-b border-gray-200 shadow-sm" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-lg">
              H
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              HackMatch
            </h1>
          </div>
          <span className="text-xs font-medium px-2.5 py-0.5 rounded bg-blue-100 text-blue-800">
            Sprint 1 Scaffold
          </span>
        </div>
      </header>

      {/* Semantic Main Content Landmark */}
      <main id="main-content" className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <div className="bg-white rounded-lg border border-gray-200 p-6 md:p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Pre-Hackathon Team Formation Platform
          </h2>
          <p className="text-gray-600 mb-6 max-w-2xl">
            Welcome to the HackMatch initial working skeleton. The frontend is built on React 18 with Vite and Tailwind CSS, communicating with a Node.js/Express backend via proxy.
          </p>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              Full-Stack Proxy & API Connection Probe
            </h3>
            <button
              type="button"
              onClick={checkApiHealth}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Checking Health...' : 'Probe /api/health'}
            </button>

            {healthStatus && (
              <div role="status" className="mt-4 p-3 bg-green-50 border border-green-200 text-green-800 text-sm rounded-md">
                {healthStatus}
              </div>
            )}

            {error && (
              <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md">
                Error: {error}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Semantic Footer Landmark */}
      <footer className="bg-white border-t border-gray-200 py-6" role="contentinfo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center text-sm text-gray-500">
          <p>© 2026 HackMatch Team 1. All rights reserved.</p>
          <p className="mt-2 sm:mt-0">COMP 313 Project 2</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
