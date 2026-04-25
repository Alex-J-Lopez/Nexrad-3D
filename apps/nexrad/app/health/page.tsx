"use client";

import { useEffect, useState } from "react";
import bytes from "bytes";

export default function HealthPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/metrics");
        const data = await res.json();
        setMetrics(data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      setLogs((prev) => [parsed, ...prev].slice(0, 50));
    };
    return () => eventSource.close();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">System Health & Metrics</h1>

      {metrics ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
              <h2 className="text-sm text-gray-400">Total Sites Active</h2>
              <p className="text-2xl font-semibold">
                {metrics.sitesActive} / {metrics.totalSites}
              </p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
              <h2 className="text-sm text-gray-400">Most Recently Updated</h2>
              <p className="text-2xl font-semibold">
                {metrics.mostRecentSite || "N/A"}{" "}
                <span className="text-sm text-gray-400 font-normal">
                  ({metrics.mostRecentTime ? new Date(metrics.mostRecentTime).toLocaleTimeString() : ""})
                </span>
              </p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
              <h2 className="text-sm text-gray-400">Avg Ingest Time</h2>
              <p className="text-2xl font-semibold">
                {Math.round(metrics.globalAvgTime || 0)}ms
              </p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
              <h2 className="text-sm text-gray-400">Total S3 Storage</h2>
              <p className="text-2xl font-semibold">
                {bytes(metrics.s3TotalBytes || 0)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="text-xl font-bold mb-4">Site Status</h2>
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden overflow-y-auto max-h-[500px]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-700 sticky top-0">
                    <tr>
                      <th className="px-4 py-2">Site</th>
                      <th className="px-4 py-2">Last Checked</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Avg Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.states?.map((state: any) => (
                      <tr key={state.siteId} className="border-t border-gray-700 hover:bg-gray-750">
                        <td className="px-4 py-2 font-mono">{state.siteId}</td>
                        <td className="px-4 py-2">
                          {state.lastPolledAtMs
                            ? new Date(state.lastPolledAtMs).toLocaleTimeString()
                            : "N/A"}
                        </td>
                        <td className="px-4 py-2">
                          {state.consecutiveFailures > 0 ? (
                            <span className="text-red-400">
                              Failed ({state.consecutiveFailures})
                            </span>
                          ) : (
                            <span className="text-green-400">Online</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-400">
                          {metrics.avgTimes?.[state.siteId]
                            ? Math.round(metrics.avgTimes[state.siteId]) + "ms"
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold mb-4">Live Event Log</h2>
              <div className="bg-black rounded-lg border border-gray-700 h-[500px] overflow-y-auto p-4 font-mono text-sm space-y-2">
                {logs.length === 0 && <p className="text-gray-500">Waiting for events...</p>}
                {logs.map((log, i) => (
                  <div key={i} className="border-b border-gray-800 pb-2">
                    <span className="text-blue-400">
                      [{new Date(log.emittedAtMs || Date.now()).toLocaleTimeString()}]
                    </span>{" "}
                    <span
                      className={
                        log.eventType === "volume.error"
                          ? "text-red-400"
                          : "text-green-400"
                      }
                    >
                      {log.eventType}
                    </span>{" "}
                    <span className="text-gray-300">
                      {log.data?.siteId} - {log.data?.product || log.data?.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-700 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-700 rounded"></div>
              <div className="h-4 bg-gray-700 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
