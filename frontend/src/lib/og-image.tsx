import { ImageResponse } from "next/og";
import { PINELY_LOGO_BASE64 } from "./logo-data";

/**
 * The share image (Open Graph and Twitter). Flat brand colours and the official paperfold P logo mark.
 */
export function renderOgImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px",
        background: "#0b0b0b",
        color: "#ffffff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
        <img
          src={PINELY_LOGO_BASE64}
          alt=""
          width="104"
          height="104"
          style={{ width: "104px", height: "104px", objectFit: "contain" }}
        />
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: "-0.02em" }}>
          PINELY
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>
          Money for Physical AI
        </div>
        <div style={{ display: "flex", fontSize: 32, lineHeight: 1.3, color: "#bdb3b6" }}>
          Wallets for robots, drones, and EV chargers on Robinhood Chain, with session keys and a
          kill switch the operator controls.
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#e0486b" }}>x.com/pinely_protocol</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
