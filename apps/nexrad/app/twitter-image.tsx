import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 600,
};

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(145deg, #061019 0%, #0d2230 55%, #112d40 100%)",
          color: "#dcf9ff",
          display: "flex",
          height: "100%",
          justifyContent: "space-between",
          width: "100%",
          padding: "72px 84px",
          fontFamily: "Helvetica",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
          <div
            style={{
              color: "#7ee7ff",
              fontSize: 28,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Weather Intelligence
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
              marginTop: 10,
            }}
          >
            Nexrad 3D
          </div>
          <div
            style={{
              color: "#9eefff",
              fontSize: 34,
              marginTop: 16,
            }}
          >
            Globe and local volumetric radar rendering
          </div>
        </div>

        <div
          style={{
            width: 210,
            height: 210,
            borderRadius: 56,
            border: "2px solid rgba(125,240,206,0.82)",
            background: "#07121a",
            alignItems: "center",
            justifyContent: "center",
            display: "flex",
            boxShadow: "0 0 34px rgba(99,255,197,0.25)",
          }}
        >
          <div
            style={{
              width: 130,
              height: 130,
              borderRadius: 999,
              border: "3px solid rgba(125,240,206,0.82)",
              boxShadow: "inset 0 0 24px rgba(99,255,197,0.2)",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
