import type { Metadata, Viewport } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Nexrad 3D",
  description: "Volumetric radar — globe or local 3D",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon" }],
  },
  openGraph: {
    title: "Nexrad 3D",
    description: "Volumetric radar — globe or local 3D",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nexrad 3D",
    description: "Volumetric radar — globe or local 3D",
    images: ["/twitter-image"],
  },
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
