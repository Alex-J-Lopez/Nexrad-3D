import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 180,
  height: 180,
};

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "radial-gradient(circle at 30% 30%, #14384d 0%, #071019 70%)",
          borderRadius: "28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            width: 108,
            height: 108,
            borderRadius: 999,
            border: "4px solid #7cf0cf",
            boxShadow: "0 0 20px rgba(97, 255, 198, 0.35)",
          }}
        />
      </div>
    ),
    size
  );
}
