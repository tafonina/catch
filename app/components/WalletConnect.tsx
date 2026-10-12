"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import {
  notifyWalletChange,
  phantomInjected,
  phantomPublicKey,
  reconnectTrustedPhantom,
  setWalletIntent,
  signerKey,
  walletIntent,
} from "@/lib/active-wallet";
import {
  DEMO_ROLE_LABEL,
  FAUCET_ANTH,
  FAUCET_ANTH_MAX,
  FAUCET_SOL,
  FAUCET_USDC,
  FAUCET_USDC_MAX,
  type DemoRole,
  activeDemoRole,
  ensureDemoKeypair,
  exportActiveDemoSecret,
  setActiveDemoRole,
} from "@/lib/demo-wallets";

type Props = {
  usdc: number;
  anthropic: number;
  onChanged?: () => void;
  onRole?: (role: DemoRole) => void;
};

function shortKey(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function fmt(n: number, digits = 0) {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

async function faucet(wallet: string, token: "usdc" | "anthropic" | "sol", amount?: number) {
  const res = await fetch("/api/prelend/faucet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, token, amount }),
  });
  const data = (await res.json()) as {
    error?: string;
    skipped?: boolean;
    solSent?: number;
    mintedUi?: number;
    balanceUi?: number;
  };
  if (!res.ok) throw new Error(data.error ?? "Faucet failed");
  return data;
}

export function WalletConnect({ usdc, anthropic, onChanged, onRole }: Props) {
  const { disconnect, select, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [role, setRole] = useState<DemoRole | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  function sync() {
    setRole(activeDemoRole());
    setShown(signerKey(publicKey)?.toBase58() ?? null);
  }

  useEffect(() => {
    setReady(true);
    if (walletIntent() === "disconnected") {
      setShown(null);
      return;
    }
    void reconnectTrustedPhantom().then(() => sync());
    const phantom = phantomInjected();
    const onEvt = () => sync();
    phantom?.on?.("connect", onEvt);
    phantom?.on?.("accountChanged", onEvt);
    phantom?.on?.("disconnect", onEvt);
    window.addEventListener("prelend-wallet", onEvt);
    return () => {
      phantom?.off?.("connect", onEvt);
      phantom?.off?.("accountChanged", onEvt);
      phantom?.off?.("disconnect", onEvt);
      window.removeEventListener("prelend-wallet", onEvt);
    };
  }, [publicKey]);

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

  async function onDisconnect() {
    setWalletIntent("disconnected");
    setShown(null);
    setRole(null);
    setOpen(false);
    setExported(null);
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
    onChanged?.();
  }

  async function onConnectPhantom() {
    setActiveDemoRole(null);
    setWalletIntent("connected");
    setExported(null);
    const phantom = phantomInjected();
    if (!phantom) {
      setVisible(true);
      return;
    }
    try {
      if (!phantom.isConnected || !phantomPublicKey()) await phantom.connect();
      setShown(phantomPublicKey()?.toBase58() ?? null);
      setRole(null);
      notifyWalletChange();
      onChanged?.();
    } catch {
      setWalletIntent("disconnected");
      setShown(null);
    }
  }

  async function loadRole(next: DemoRole) {
    setBusy(next);
    try {
      const pair = ensureDemoKeypair(next);
      setActiveDemoRole(next);
      setWalletIntent("demo");
      setShown(pair.publicKey.toBase58());
      setRole(next);
      notifyWalletChange();
      onRole?.(next);
      let faucetNote = "";
      try {
        if (next === "borrower") {
          await faucet(pair.publicKey.toBase58(), "anthropic", FAUCET_ANTH);
        } else {
          await faucet(pair.publicKey.toBase58(), "usdc", FAUCET_USDC);
        }
      } catch (faucetErr) {
        faucetNote =
          faucetErr instanceof Error
            ? ` · faucet failed (${faucetErr.message})`
            : " · faucet failed (set SOLANA_KEYPAIR on server)";
      }
      ping(
        (next === "borrower"
          ? `Borrower loaded · ${FAUCET_ANTH} ANTHROPIC`
          : `${DEMO_ROLE_LABEL[next]} loaded · ${fmt(FAUCET_USDC)} USDC`) + faucetNote,
      );
      onChanged?.();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(null);
    }
  }

  async function onFaucet(token: "usdc" | "anthropic" | "sol") {
    const wallet = shown;
    if (!wallet) return ping("Connect Phantom or load a demo account");
    setBusy(token);
    try {
      const amount = token === "usdc" ? FAUCET_USDC : token === "anthropic" ? FAUCET_ANTH : undefined;
      const out = await faucet(wallet, token, amount);
      if (token === "sol") {
        ping(
          out.skipped
            ? `Already has ≥ ${FAUCET_SOL} SOL`
            : `Sent ${(out.solSent ?? FAUCET_SOL).toFixed(4)} SOL`,
        );
      } else if (out.skipped || !out.mintedUi) {
        ping(token === "usdc" ? "Already has ≥ 100,000 USDC" : "Already has ≥ 100 ANTHROPIC");
      } else {
        ping(
          token === "usdc"
            ? `Sent ${fmt(out.mintedUi)} USDC`
            : `Sent ${fmt(out.mintedUi, 2)} ANTHROPIC`,
        );
      }
      onChanged?.();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Faucet failed");
    } finally {
      setBusy(null);
    }
  }

  function onExport() {
    const secret = exportActiveDemoSecret();
    if (!secret) return ping("Load a demo account first");
    setExported(secret.secretBase58);
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

  const label = role ? DEMO_ROLE_LABEL[role] : shown ? "Phantom" : null;

  return (
    <div ref={box} className="relative flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200">
          <span className="font-semibold">{fmt(usdc, 2)} USDC</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span className="font-semibold">{fmt(anthropic, 2)} ANTH</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black"
        >
          {shown ? `${label} · ${shortKey(shown)} ▾` : "Connect / demo ▾"}
        </button>
      </div>
      {note && <div className="mono text-[11px] text-amber-200">{note}</div>}
      {open && (
        <div className="absolute right-0 top-12 z-30 w-max min-w-72 overflow-hidden rounded-xl border border-white/10 bg-[#11151d] py-2 text-sm shadow-2xl">
          <div className="px-3.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Devnet keypairs
          </div>
          {(
            [
              ["borrower", `Load borrower · ${FAUCET_ANTH} ANTH`],
              ["lender", `Load lender · ${fmt(FAUCET_USDC)} USDC`],
              ["bidder", `Load bidder · ${fmt(FAUCET_USDC)} USDC`],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              disabled={busy !== null}
              onClick={() => void loadRole(id)}
              className={`flex w-full whitespace-nowrap px-3.5 py-2 text-left hover:bg-white/5 disabled:opacity-50 ${
                role === id ? "text-amber-300" : "text-slate-200"
              }`}
            >
              {busy === id ? "Loading…" : text}
            </button>
          ))}
          <div className="my-2 h-px bg-white/10" />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onFaucet("usdc")}
            className="flex w-full whitespace-nowrap px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "usdc" ? (
              "Sending…"
            ) : (
              <>
                Faucet {fmt(FAUCET_USDC)} USDC{" "}
                <span className="ml-1.5 text-slate-500">({fmt(FAUCET_USDC_MAX)} USDC max)</span>
              </>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onFaucet("anthropic")}
            className="flex w-full whitespace-nowrap px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "anthropic" ? (
              "Sending…"
            ) : (
              <>
                Faucet {FAUCET_ANTH} ANTHROPIC{" "}
                <span className="ml-1.5 text-slate-500">({FAUCET_ANTH_MAX} ANTHROPIC max)</span>
              </>
            )}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onFaucet("sol")}
            className="flex w-full whitespace-nowrap px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "sol" ? (
              "Sending…"
            ) : (
              <>
                Faucet {FAUCET_SOL} SOL <span className="ml-1.5 text-slate-500">(if below)</span>
              </>
            )}
          </button>
          {role && (
            <button
              type="button"
              onClick={onExport}
              className="flex w-full px-3.5 py-2 text-left text-slate-200 hover:bg-white/5"
            >
              Export private key
            </button>
          )}
          <button
            type="button"
            onClick={() => void onConnectPhantom()}
            className="flex w-full px-3.5 py-2 text-left text-slate-200 hover:bg-white/5"
          >
            Connect Phantom
          </button>
          <div className="my-2 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => void onDisconnect()}
            className="flex w-full px-3.5 py-2 text-left text-slate-300 hover:bg-white/5"
          >
            Disconnect
          </button>
          {exported && (
            <div className="mx-3 mb-2 mt-1 rounded-xl bg-black/50 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                Phantom → Import private key
              </div>
              <textarea
                readOnly
                value={exported}
                className="mono h-20 w-full resize-none bg-transparent text-[10px] text-amber-100"
              />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(exported)}
                className="mt-1 text-[11px] text-amber-300"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
