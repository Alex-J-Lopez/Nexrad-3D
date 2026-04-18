import type { Metadata, Viewport } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Nexrad 3D",
  description: "Volumetric radar — globe or local 3D",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
