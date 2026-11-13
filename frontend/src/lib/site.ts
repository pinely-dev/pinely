/**
 * Public identity of the site: safe to import from client components. The deployed URL lives in
 * `site-url.ts` (server only) because it depends on build-time environment variables.
 */
export const SITE_NAME = "PINELY";
/** Brand name of the network PINELY runs on. Network-specific values (ids, symbols) come from the chain profile. */
export const NETWORK_NAME = "Robinhood Chain";

export const SITE_TITLE = `PINELY · Money for Physical AI on ${NETWORK_NAME}`;
export const SITE_DESCRIPTION = `Money for Physical AI. Wallets for robots, drones, and EV chargers on ${NETWORK_NAME}, with session keys and a kill switch the operator controls.`;

/** Official X account. */
export const X_HANDLE = "@pinely_protocol";
export const X_URL = "https://x.com/pinely_protocol";
