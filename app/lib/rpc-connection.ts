import { Connection, type Commitment } from "@solana/web3.js";
import { rpcUrl } from "@/lib/cluster";

const RPC_FETCH_MS = 15_000;

/** Server-side RPC: `SOLANA_RPC_URL` overrides without rebuild (faucet, crank, vault API). */
export function serverRpcUrl() {
  return (
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    rpcUrl()
  );
}

export function appConnection(commitment: Commitment = "confirmed") {
  return new Connection(serverRpcUrl(), {
    commitment,
    disableRetryOnRateLimit: false,
    fetch: async (input, init) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RPC_FETCH_MS);
      try {
        return await fetch(input, {
          ...init,
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`RPC timeout (${RPC_FETCH_MS / 1000}s) — set SOLANA_RPC_URL to Helius devnet`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
