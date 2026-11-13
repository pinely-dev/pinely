import { renderOgImage } from "@/lib/og-image";

export const alt = "PINELY: Money for Physical AI on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return renderOgImage();
}
