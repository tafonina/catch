import { PublicKey } from "@solana/web3.js";
import { demoPublicKey, isDemoWalletActive, setActiveDemoRole } from "@/lib/demo-wallets";

type PhantomInjected = {
  isConnected?: boolean;
  publicKey?: { toBytes(): Uint8Array } | PublicKey;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
  on?: (event: string, fn: (key: PublicKey | null) => void) => void;
  off?: (event: string, fn: (key: PublicKey | null) => void) => void;
};

const INTENT_KEY = "prelend.wallet.intent";

export function walletIntent(): "connected" | "disconnected" | "demo" | null {
  if (typeof window === "undefined") return null;
  const value = sessionStorage.getItem(INTENT_KEY);
  return value === "connected" || value === "disconnected" || value === "demo"
    ? value
    : null;
}

export function setWalletIntent(intent: "connected" | "disconnected" | "demo") {
  if (typeof window === "undefined") return;
  if (intent !== "demo") setActiveDemoRole(null);
  sessionStorage.setItem(INTENT_KEY, intent);
}

export function notifyWalletChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("prelend-wallet"));
}

export function phantomInjected(): PhantomInjected | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    phantom?: { solana?: PhantomInjected };
    solana?: PhantomInjected;
  };
  return w.phantom?.solana ?? w.solana;
}

export function phantomPublicKey(): PublicKey | null {
  if (walletIntent() === "disconnected" || walletIntent() === "demo") return null;
  const key = phantomInjected()?.publicKey;
  if (!key) return null;
  try {
    if ("toBytes" in key) return new PublicKey(key.toBytes());
    return new PublicKey(key);
  } catch {
    return null;
  }
}

export function signerKey(adapterKey: PublicKey | null): PublicKey | null {
  if (isDemoWalletActive()) return demoPublicKey();
  return phantomPublicKey() ?? adapterKey;
}

/** Reconnect Phantom with no popup if this site is already approved. */
export async function reconnectTrustedPhantom() {
  if (walletIntent() === "disconnected" || walletIntent() === "demo") return demoPublicKey();
  const phantom = phantomInjected();
  if (!phantom) return null;
  if (!phantom.isConnected) {
    try {
      await phantom.connect({ onlyIfTrusted: true });
    } catch {
      return phantomPublicKey();
    }
  }
  return phantomPublicKey();
}

export async function disconnectWallets(adapterDisconnect?: () => Promise<void>) {
  setWalletIntent("disconnected");
  if (adapterDisconnect) {
    try {
      await adapterDisconnect();
      return;
    } catch {
      // Adapter was already disconnected.
    }
  }
  try {
    await phantomInjected()?.disconnect?.();
  } catch {
    // Phantom may already be disconnected.
  }
}
