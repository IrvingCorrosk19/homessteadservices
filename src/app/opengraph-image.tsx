import { ImageResponse } from "next/og";

export const alt = "HOMESTEAD SERVICES — Tu espacio en buenas manos.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1f3344",
          color: "#f6f3ee",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 22, letterSpacing: 6, textTransform: "uppercase", opacity: 0.7 }}>
            HOMESTEAD SERVICES
          </div>
          <div style={{ fontSize: 72, lineHeight: 1.05, fontFamily: "Georgia, serif" }}>
            Tu espacio en buenas manos.
          </div>
        </div>
        <div style={{ fontSize: 28, opacity: 0.78 }}>
          Repairs • Maintenance • Improvements
        </div>
      </div>
    ),
    size,
  );
}
