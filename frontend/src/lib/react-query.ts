import { QueryClient } from "@tanstack/react-query";

/**
 * Default QueryClient for the application.
 *
 * Note: never put sensitive data (private keys, seed phrases,
 * signatures) into the react-query cache, because this cache is sent to the browser.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // On-chain data changes once a transaction is confirmed, so refetching
      // when the window regains focus is useful.
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
