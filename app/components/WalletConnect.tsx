"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { FAUCET_ANTH, FAUCET_ANTH_MAX, FAUCET_USDC, FAUCET_USDC_MAX } from "@/lib/demo-wallets";

type Props = {
  usdc: number;
  anthropic: number;
  onChanged?: () => void;
};

function fmt(n: number, digits = 0) {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

const FAUCET_FETCH_MS = 55_000;

const TOPUP_SOL = 0.001;

async function faucet(wallet: string, token: "usdc" | "anthropic" | "sol", amount: number) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), FAUCET_FETCH_MS);
  try {
    const res = await fetch("/api/prelend/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, token, amount }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as {
      error?: string;
      skipped?: boolean;
      mintedUi?: number;
      solSent?: number;
    };
    if (!res.ok) throw new Error(data.error ?? "Faucet failed");
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Faucet timed out — retry");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export function WalletConnect({ usdc, anthropic, onChanged }: Props) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"usdc" | "anthropic" | "sol" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const address = publicKey?.toBase58() ?? null;

  useEffect(() => {
    function close(ev: MouseEvent) {
      if (!box.current?.contains(ev.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  function ping(message: string) {
    setNote(message);
    window.setTimeout(() => setNote(null), 4000);
  }

  async function onFaucet(token: "usdc" | "anthropic" | "sol") {
    if (!address) {
      setVisible(true);
      return;
    }
    setBusy(token);
    setOpen(false);
    try {
      const amount = token === "usdc" ? FAUCET_USDC : token === "anthropic" ? FAUCET_ANTH : TOPUP_SOL;
      const out = await faucet(address, token, amount);
      if (token === "sol") {
        ping(out.skipped || !out.solSent ? "SOL was not sent" : `Sent ${out.solSent} SOL`);
      } else if (out.skipped || !out.mintedUi) {
        ping(token === "usdc" ? `Already has ≥ ${fmt(FAUCET_USDC_MAX)} USDC` : `Already has ≥ ${FAUCET_ANTH_MAX} ANTHROPIC`);
      } else {
        ping(token === "usdc" ? `Sent ${fmt(out.mintedUi)} USDC` : `Sent ${fmt(out.mintedUi, 2)} ANTHROPIC`);
      }
      onChanged?.();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Faucet failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={box} className="relative flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200">
          <span className="font-semibold">{fmt(usdc, 2)} USDC</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span className="font-semibold">{fmt(anthropic, 2)} ANTH</span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-white/15 bg-black/40 px-3 py-2 text-xs font-semibold text-slate-100"
          >
            {busy ? "Sending…" : "Top up ▾"}
          </button>
          {open && (
            <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#11151d] py-1 text-sm shadow-2xl">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onFaucet("usdc")}
                className="block w-full px-3 py-2 text-left text-slate-100 hover:bg-white/5 disabled:opacity-50"
              >
                {fmt(FAUCET_USDC)} test USDC
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onFaucet("anthropic")}
                className="block w-full px-3 py-2 text-left text-slate-100 hover:bg-white/5 disabled:opacity-50"
              >
                {FAUCET_ANTH} test ANTHROPIC
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onFaucet("sol")}
                className="block w-full px-3 py-2 text-left text-slate-100 hover:bg-white/5 disabled:opacity-50"
              >
                {TOPUP_SOL} test SOL
              </button>
            </div>
          )}
        </div>
        <WalletMultiButton />
      </div>
      {note && <div className="mono text-[11px] text-amber-200">{note}</div>}
    </div>
  );
}
