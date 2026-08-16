import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "HOMESTEAD SERVICES — Tu espacio en buenas manos.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const logo = await readFile(
    join(process.cwd(), "public/images/homesteadservices.png"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f6f3ee",
          color: "#1f3344",
          padding: "72px 80px",
        }}
      >
        <img
          src={`data:image/png;base64,${logo.toString("base64")}`}
          alt=""
          width={360}
          height={263}
          style={{ width: 360, height: 263, objectFit: "contain" }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 560,
            marginLeft: 48,
          }}
        >
          <div
            style={{
              fontSize: 22,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#c17a4a",
            }}
          >
            Panamá
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 54,
              lineHeight: 1.12,
              fontFamily: "Georgia, serif",
            }}
          >
            Tu espacio en buenas manos.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
