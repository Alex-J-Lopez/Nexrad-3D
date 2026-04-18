import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it Works - Nexrad 3D",
  description: "Learn about the architecture, ingestion, and 3D rendering pipeline behind Nexrad 3D.",
};

export default function InfoPage() {
  return (
    <div className="info-page">
      <Link href="/" className="back-link">
        &larr; Back to Radar
      </Link>

      <h1>How Nexrad 3D Works</h1>
      <p>
        Nexrad 3D is a web-native platform that provides a real-time, three-dimensional volume visualization of weather radar data. The platform captures raw NEXRAD Level II archive streams, processes them, and uses hardware-accelerated Volume Ray Marching within the browser to generate detailed storm cell structures.
      </p>

      <h2>Architecture Overview</h2>
      <p>
        The software stack is designed around distributed microservices using Node.js, Next.js, and WebGL technologies:
      </p>
      <ul>
        <li><strong>Ingest Worker:</strong> A continuously running background service that polls for new radar objects upstream.</li>
        <li><strong>Radar Parser:</strong> A tailored package extracting binary <code>Message 31</code> sweeps from Level II files, alongside ODIM H5 formats.</li>
        <li><strong>Frontend & API (Next.js):</strong> Provides the interactive UI as well as serving processed, quantized byte-maps to the client.</li>
        <li><strong>Redis & Object Storage:</strong> Coordinates real-time events via Pub/Sub and stores large volume blobs for access.</li>
      </ul>

      <h2>1. Data Ingestion & Processing</h2>
      <p>
        Weather radars perform rapid sweeps of the atmosphere at various elevations. These sweeps are packaged into a "Volume", and published by agencies (like NOAA) in real-time.
      </p>
      <p>
        The <code>ingest-worker</code> discovers these new Volume deployments, downloads the raw binaries, and runs them through our portable parser. The parser unpacks radial moments—such as Reflectivity (<code>REF</code>) and Velocity (<code>VEL</code>)—compressing the massive 3D data arrays into optimized artifacts. An event is then emitted over Redis to notify all connected clients that a new volume is ready.
      </p>

      <h2>2. Transport & Delivery</h2>
      <p>
        Instead of shipping heavy Cartesian point clouds or giant mesh models over the wire, Next.js API routes vend raw radial data in dense byte-arrays. This significantly cuts down bandwidth overhead. The browser pulls down the latest radar payload dynamically, preparing it for the WebGL pipeline.
      </p>

      <h2>3. 3D WebGL Rendering (Volume Ray Marching)</h2>
      <p>
        The core of Nexrad 3D's visual fidelity is its custom Volume Ray Marching shader architecture, built on top of <code>three.js</code> and integrated into <code>maplibre-gl</code>.
      </p>
      <p>
        Rather than parsing individual raindrops or reflectivity clusters as millions of vertices natively, the entire atmospheric volume is sent directly to the GPU as 2D data textures. The fragment shader then virtually "steps" (or marches) along the camera's line of sight through physical world coordinates. At every step, it:
      </p>
      <ol>
        <li>Re-projects Cartesian camera space back into spherical radar coordinates (azimuth, range, and elevation).</li>
        <li>Samples the uploaded texture array based on radial index matching to find the localized dBZ value (Reflectivity).</li>
        <li>Interpolates coloring against standard radar palettes dynamically.</li>
        <li>Discards low-value atmospheric noise (via a user-controlled threshold slider) to reveal distinct storm formations.</li>
      </ol>

      <h2>Globe View vs. Local View</h2>
      <p>
        The software ships with two primary modes of observation:
      </p>
      <ul>
        <li><strong>Globe View:</strong> Maps the volumetric data onto a worldwide spherical Mercator map. A custom <code>MaplibreRadarLayer</code> aligns the WebGL context directly onto the Earth's surface, syncing automatically with map interactions.</li>
        <li><strong>Local View:</strong> Provides an unencumbered orbital camera perspective focused on a single radar site, allowing deep inspection of vertical thunderstorm profiles and isolated precipitation gradients.</li>
      </ul>

      <p style={{ marginTop: "3rem", fontSize: "0.9rem" }}>
        Inspired by <em>OpenStorm</em> and open-source weather analysis packages.
      </p>
    </div>
  );
}