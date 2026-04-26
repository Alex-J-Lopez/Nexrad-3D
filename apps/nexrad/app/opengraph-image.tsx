import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 630,
};

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #081019 0%, #0e2534 45%, #132b3f 100%)",
          color: "#dcf9ff",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
          fontFamily: "Helvetica",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 70% 25%, rgba(115,255,199,0.28), transparent 35%), radial-gradient(circle at 20% 78%, rgba(111,210,255,0.22), transparent 45%)",
          }}
        />

        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 28,
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: 40,
              background: "#07111a",
              border: "2px solid rgba(125,240,206,0.75)",
              alignItems: "center",
              justifyContent: "center",
              display: "flex",
              boxShadow: "0 0 30px rgba(99,255,197,0.25)",
            }}
          >
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 999,
                border: "2px solid rgba(125,240,206,0.75)",
                boxShadow: "inset 0 0 20px rgba(99,255,197,0.2)",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                letterSpacing: -1,
                lineHeight: 1,
              }}
            >
              Nexrad 3D
            </div>
            <div
              style={{
                color: "#8be4ff",
                fontSize: 30,
                marginTop: 10,
              }}
            >
              Real-time volumetric weather radar
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
