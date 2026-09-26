"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";
import {
  phantomInjected,
  phantomPublicKey,
  notifyWalletChange,
  reconnectTrustedPhantom,
  setWalletIntent,
  walletIntent,
} from "@/lib/active-wallet";

export function WalletConnect() {
  const { disconnect, select } = useWallet();
  const { setVisible } = useWalletModal();
  const [ready, setReady] = useState(false);
  const [injected, setInjected] = useState<string | null>(null);
  const [detached, setDetached] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setReady(true);
    const closed = walletIntent() === "disconnected";
    setDetached(closed);
    if (closed) return;
    void reconnectTrustedPhantom().then((key) => setInjected(key?.toBase58() ?? null));
    const phantom = phantomInjected();
    const sync = () => {
      if (walletIntent() === "disconnected") {
        setInjected(null);
        setDetached(true);
        setPending(false);
        return;
      }
      const key = phantomPublicKey()?.toBase58() ?? null;
      setDetached(!key);
      setInjected(key);
      if (key) setPending(false);
    };
    phantom?.on?.("connect", sync);
    phantom?.on?.("accountChanged", sync);
    phantom?.on?.("disconnect", sync);
    return () => {
      phantom?.off?.("connect", sync);
      phantom?.off?.("accountChanged", sync);
      phantom?.off?.("disconnect", sync);
    };
  }, []);

  async function onDisconnect() {
    setWalletIntent("disconnected");
    setDetached(true);
    setPending(false);
    setInjected(null);
    try {
      await phantomInjected()?.disconnect?.();
    } catch {
      // already disconnected
    }
    try {
      await disconnect();
    } catch {
      // adapter was not connected
    }
    select(null);
    notifyWalletChange();
  }

  async function onConnectClick() {
    setWalletIntent("connected");
    setDetached(false);
    const phantom = phantomInjected();
    if (!phantom) {
      setVisible(true);
      return;
    }
    setPending(true);
    try {
      if (!phantom.isConnected || !phantomPublicKey()) {
        await phantom.connect();
      }
      const key = phantomPublicKey()?.toBase58() ?? null;
      setInjected(key);
      if (!key) setDetached(true);
      notifyWalletChange();
    } catch {
      setWalletIntent("disconnected");
      setDetached(true);
      setInjected(null);
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return (
      <button
        type="button"
        className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black"
        disabled
      >
        Connect wallet
      </button>
    );
  }

  if (pending && !injected) {
    return (
      <button
        type="button"
        onClick={() => void onDisconnect()}
        className="rounded-full bg-amber-400/20 px-4 py-2 text-sm font-semibold text-amber-200"
      >
        Connecting… (click to cancel)
      </button>
    );
  }

  const shown = detached ? null : injected;
  if (shown) {
    const short = `${shown.slice(0, 4)}…${shown.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={() => void onDisconnect()}
        className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black"
        title="Phantom"
      >
        {short} · Disconnect
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void onConnectClick()}
      className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black"
    >
      Connect wallet
    </button>
  );
}
