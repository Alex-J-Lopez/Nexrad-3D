import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Nexrad 3D",
  description: "Volumetric radar — globe or local 3D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/_next/static/cesium/Widgets/widgets.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
