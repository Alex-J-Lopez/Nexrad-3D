import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it Works - Nexrad 3D",
  description: "Learn about the architecture, ingestion, and 3D rendering pipeline behind Nexrad 3D.",
};

export default function InfoPage() {
  return (
    <div className="info-page-shell">
      <header className="info-page-header">
        <div>
          <h1>How Nexrad 3D Works</h1>
          <p>
            Architecture, ingest flow, and WebGL volume rendering pipeline.
          </p>
        </div>
        <div className="info-page-actions">
          <Link href="/" className="back-link">
            Back to Radar
          </Link>
          <Link href="/health" className="back-link">
            Health Dashboard
          </Link>
        </div>
      </header>

      <main className="info-page">
        <section className="info-card info-lead">
          <p>
            Nexrad 3D is a web-native platform that provides real-time, three-dimensional
            weather radar visualization. The platform captures NEXRAD Level II streams,
            processes raw radial moments, and renders atmospheric volume directly in the browser
            using hardware-accelerated ray marching.
          </p>
        </section>

        <section className="info-card">
          <h2>Architecture Overview</h2>
          <ul>
            <li>
              <strong>Ingest Worker:</strong> Background poller for new upstream radar objects.
            </li>
            <li>
              <strong>Radar Parser:</strong> Extracts binary <code>Message 31</code> sweeps and ODIM H5 data.
            </li>
            <li>
              <strong>Frontend + API:</strong> Interactive UI and compact radial artifact delivery.
            </li>
            <li>
              <strong>Redis + Object Storage:</strong> Event fanout, state coordination, and blob persistence.
            </li>
          </ul>
        </section>

        <section className="info-card">
          <h2>1. Data Ingestion &amp; Processing</h2>
          <p>
            Radar sites publish elevation sweeps that are grouped into a single volume. The
            <code> ingest-worker </code>
            discovers new volumes, downloads raw binaries, and parses moments such as
            <code> REF </code>
            and
            <code> VEL</code>.
          </p>
          <p>
            The parser transforms large raw arrays into optimized artifacts, then emits a Redis
            event to signal downstream clients that the newest volume is available.
          </p>
        </section>

        <section className="info-card">
          <h2>2. Transport &amp; Delivery</h2>
          <p>
            Instead of shipping heavy meshes, the API returns dense radial arrays and metadata.
            This reduces transfer cost while preserving volumetric fidelity for GPU-side
            reconstruction.
          </p>
        </section>

        <section className="info-card">
          <h2>3. 3D WebGL Rendering (Volume Ray Marching)</h2>
          <p>
            Nexrad 3D uses a custom ray marching pipeline on top of
            <code> three.js </code>
            and
            <code> maplibre-gl</code>. The atmospheric field is uploaded as texture data and sampled
            per fragment in the shader.
          </p>
          <ol>
            <li>Re-project camera space into radar spherical coordinates.</li>
            <li>Sample radial indices to get localized reflectivity or moment values.</li>
            <li>Map values through product color scales.</li>
            <li>Discard low-value noise with threshold filtering.</li>
          </ol>
        </section>

        <section className="info-card">
          <h2>Globe View vs. Local View</h2>
          <ul>
            <li>
              <strong>Globe View:</strong> Projects radar onto a world map with synchronized map
              interactions.
            </li>
            <li>
              <strong>Local View:</strong> Focused orbital inspection around a single site for
              vertical storm structure analysis.
            </li>
          </ul>
        </section>

        <p className="info-footnote">
          Inspired by <em>OpenStorm</em> and open-source weather analysis tooling.
        </p>
      </main>
    </div>
  );
}