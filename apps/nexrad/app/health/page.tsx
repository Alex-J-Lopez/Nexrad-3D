"use client";

import { useEffect, useState, useMemo } from "react";
import bytes from "bytes";
import { 
  Activity, 
  Server, 
  Clock, 
  Database, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  ArrowLeft
} from "lucide-react";
import Link from "next/link";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell
} from "recharts";
import styles from "./health.module.css";

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
    
    const handleEvent = (type: string) => (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        const logEntry = {
          eventType: type,
          emittedAtMs: Date.now(),
          data: parsed
        };
        setLogs((prev) => [logEntry, ...prev].slice(0, 100));
      } catch (e) {}
    };

    const onReady = handleEvent("volume.ready");
    const onError = handleEvent("volume.error");

    eventSource.addEventListener("volume.ready", onReady);
    eventSource.addEventListener("volume.error", onError);

    return () => {
      eventSource.removeEventListener("volume.ready", onReady);
      eventSource.removeEventListener("volume.error", onError);
      eventSource.close();
    };
  }, []);

  const chartData = useMemo(() => {
    if (!metrics?.avgTimes) return [];
    return Object.entries(metrics.avgTimes)
      .map(([site, time]) => ({
        site,
        time: Math.round(time as number),
      }))
      .filter((d) => d.time > 0)
      .sort((a, b) => b.time - a.time)
      .slice(0, 15);
  }, [metrics]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Activity color="#60a5fa" size={28} /> System Health
          </h1>
          <p className={styles.headerSubtitle}>
            Real-time monitoring of NEXRAD ingest pipelines and storage.
          </p>
        </div>
        <Link href="/" className={styles.backLink}>
          <ArrowLeft size={16} /> Back to Map
        </Link>
      </header>

      <main className={styles.main}>
        {!metrics ? (
          <div className={styles.loadingState}>
            <div className={styles.grid4}>
              <div className={styles.skeletonBox} />
              <div className={styles.skeletonBox} />
              <div className={styles.skeletonBox} />
              <div className={styles.skeletonBox} />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.grid4}>
              <div className={styles.card}>
                <div className={`${styles.iconWrapper} ${styles.iconBlue}`}>
                  <Server size={24} />
                </div>
                <div>
                  <h2 className={styles.cardTitle}>Sites Active</h2>
                  <p className={styles.cardValue}>
                    {metrics.sitesActive} <span className={styles.cardSub}>/ {metrics.totalSites}</span>
                  </p>
                </div>
              </div>

              <div className={styles.card}>
                <div className={`${styles.iconWrapper} ${styles.iconGreen}`}>
                  <Activity size={24} />
                </div>
                <div>
                  <h2 className={styles.cardTitle}>Recently Updated</h2>
                  <p className={styles.cardValue}>{metrics.mostRecentSite || "N/A"}</p>
                  <p className={styles.cardHint}>
                    {metrics.mostRecentTime ? new Date(metrics.mostRecentTime).toLocaleTimeString() : "--:--"}
                  </p>
                </div>
              </div>

              <div className={styles.card}>
                <div className={`${styles.iconWrapper} ${styles.iconRed}`}>
                  <Clock size={24} />
                </div>
                <div>
                  <h2 className={styles.cardTitle}>Global Avg Time</h2>
                  <p className={styles.cardValue}>
                    {Math.round(metrics.globalAvgTime || 0)} <span className={styles.cardSub}>ms</span>
                  </p>
                </div>
              </div>

              <div className={styles.card}>
                <div className={`${styles.iconWrapper} ${styles.iconPurple}`}>
                  <Database size={24} />
                </div>
                <div>
                  <h2 className={styles.cardTitle}>S3 Storage</h2>
                  <p className={styles.cardValue}>{bytes(metrics.s3TotalBytes || 0)}</p>
                </div>
              </div>
            </div>

            <div className={styles.chartSection}>
              <h2 className={styles.sectionTitle}>
                <Clock size={20} /> Top 15 Longest Ingest Times
              </h2>
              <div style={{ height: "250px", width: "100%" }}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis 
                        dataKey="site" 
                        stroke="var(--text-muted)" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke="var(--text-muted)" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(value) => `${value}ms`}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                        contentStyle={{ backgroundColor: '#081321', border: '1px solid rgba(148, 197, 255, 0.25)', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#5ad3ff' }}
                      />
                      <Bar dataKey="time" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.time > 3000 ? '#fb7185' : entry.time > 1500 ? '#fcd34d' : '#34d399'} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
                    Not enough data collected
                  </div>
                )}
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                    <Server size={20} /> Detailed Site Status
                  </h2>
                </div>
                <div className={styles.panelBody}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Site ID</th>
                        <th>Status</th>
                        <th>Avg Time</th>
                        <th style={{ textAlign: "right" }}>Last Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.states?.map((state: any) => (
                        <tr key={state.siteId}>
                          <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{state.siteId}</td>
                          <td>
                            {state.consecutiveFailures > 0 ? (
                              <span className={`${styles.statusTag} ${styles.statusOffline}`}>
                                <AlertTriangle size={14} /> Failed ({state.consecutiveFailures})
                              </span>
                            ) : (
                              <span className={`${styles.statusTag} ${styles.statusOnline}`}>
                                <CheckCircle size={14} /> Online
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={styles.timeTag}>
                              {metrics.avgTimes?.[state.siteId] ? Math.round(metrics.avgTimes[state.siteId]) + "ms" : "-"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--text-muted)" }}>
                            {state.lastPolledAtMs ? new Date(state.lastPolledAtMs).toLocaleTimeString() : "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                    <Activity size={20} /> Live Event Stream
                  </h2>
                  <div className={styles.indicator}>
                    <div className={styles.dot} />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Listening</span>
                  </div>
                </div>
                <div className={`${styles.panelBody} ${styles.logStream}`}>
                  {logs.length === 0 && <div style={{ opacity: 0.5 }}>Waiting for incoming events...</div>}
                  {logs.map((log, i) => (
                    <div key={i} className={styles.logLine}>
                      <span className={styles.logTime}>
                        {new Date(log.emittedAtMs || Date.now()).toLocaleTimeString()}
                      </span>
                      <span className={log.eventType === "volume.error" ? styles.logTypeError : styles.logTypeSuccess}>
                        [{log.eventType}]
                      </span>
                      <span className={styles.logMsg}>
                        <span className={styles.logSite}>{log.data?.siteId}</span>
                        <span style={{ margin: "0 0.5rem", opacity: 0.5 }}>→</span>
                        {log.data?.product || log.data?.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
