import { darkTheme, type Theme } from "@rainbow-me/rainbowkit";

/**
 * PINELY Dark Crimson Theme for RainbowKit.
 * Blends seamlessly with the PINELY Dark Brutalist aesthetics, rounded 24px glass cards,
 * and burgundy surfaces. The accent is the lighter site pink: RainbowKit paints link text with the
 * accent color, and burgundy (#6d001a) on the #0b0b0b modal is only 1.56:1 (WCAG AA needs 4.5:1).
 * Pink on near-black is 4.98:1, and accent buttons carry dark text (#0b0b0b on pink is 4.98:1).
 */
export function getPinelyTheme(): Theme {
  const baseDark = darkTheme({
    accentColor: "#e0486b",
    accentColorForeground: "#0b0b0b",
    borderRadius: "medium",
    fontStack: "system",
    overlayBlur: "large",
  });

  return {
    ...baseDark,
    colors: {
      ...baseDark.colors,
      modalBackground: "#0b0b0b",
      modalBorder: "rgba(255, 255, 255, 0.12)",
      modalText: "#ffffff",
      modalTextSecondary: "#d8d2d4",
      actionButtonBorder: "rgba(255, 255, 255, 0.12)",
      actionButtonSecondaryBackground: "#1c0007",
      profileForeground: "#0b0b0b",
      selectedOptionBorder: "#e0486b",
      standby: "#e0486b",
    },
    radii: {
      actionButton: "99px",
      connectButton: "99px",
      menuButton: "99px",
      modal: "24px",
      modalMobile: "24px",
    },
    shadows: {
      ...baseDark.shadows,
      dialog: "0 0 0 1px rgba(255, 255, 255, 0.12), 0 24px 60px rgba(0, 0, 0, 0.9)",
      profileDetailsAction: "none",
      selectedOption: "0 0 0 1px #e0486b",
      selectedWallet: "0 0 0 1px #e0486b",
    },
  };
}
