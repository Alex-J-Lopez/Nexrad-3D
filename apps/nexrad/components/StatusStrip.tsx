"use client";

interface StatusStripProps {
  statusText: string;
  renderSource: "artifact" | "synthetic" | null;
  decodeStatusText: string;
  isApproximateDecode: boolean;
  frameCount: number;
}

export function StatusStrip(props: StatusStripProps) {
  const { statusText, renderSource, decodeStatusText, isApproximateDecode, frameCount } = props;

  return (
    <section className="status-strip">
      <span className="status-pill">{statusText}</span>
      <span className="status-pill">Source: {renderSource ?? "none"}</span>
      <span className={isApproximateDecode ? "status-pill status-pill-warning" : "status-pill"}>
        {decodeStatusText}
      </span>
      <span className="status-pill">Frames: {frameCount}</span>
    </section>
  );
}
