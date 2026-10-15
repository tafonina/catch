"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CatchBrand } from "@/components/CatchMark";
import { PriceQuote, tokenLabel } from "@/components/PriceQuote";
import { WalletConnect } from "@/components/WalletConnect";
import { LIQUIDATION_LTV, MAX_BORROW_LTV, formatAprPct, marketYields } from "@/lib/loan";
import {
  ISOLATED_MARKETS,
  type IsolatedMarket,
  type MarketTab,
} from "@/lib/markets";
import { fetchPreStocks, type PreStock } from "@/lib/prestocks";

type VaultSnap = {
  initialized?: boolean;
  poolValueUi?: number;
  uiAmount?: number;
  totalBorrowedUi?: number;
  usdcWalletUi?: number;
  collateralWalletUi?: number;
  testModePriceE6?: number;
  stability?: { totalUsdc?: number; legacyUsdc?: number };
};

function formatUsd(n: number, digits = 0) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function formatPct(n: number, digits = 2) {
  return `${(n * 100).toFixed(digits)}%`;
}

const COLS =
  "min-w-[76rem] grid-cols-[minmax(8.5rem,1fr)_minmax(8rem,0.9fr)_repeat(4,minmax(5.75rem,1fr))_repeat(3,minmax(6.5rem,1fr))]";

export function Markets({
  onOpen,
}: {
  onOpen: (id: string, tab?: MarketTab) => void;
}) {
  const { publicKey } = useWallet();
  const [vault, setVault] = useState<VaultSnap | null>(null);
  const [usdc, setUsdc] = useState(0);
  const [anth, setAnth] = useState(0);
  const [stocks, setStocks] = useState<PreStock[]>([]);

  useEffect(() => {
    let stop = false;
    const wallet = publicKey?.toBase58();
    const q = wallet ? `?wallet=${wallet}` : "";
    void fetch(`/api/prelend/vault${q}`)
      .then((res) => res.json())
      .then((data: VaultSnap) => {
        if (stop) return;
        setVault(data);
        if (typeof data.usdcWalletUi === "number") setUsdc(data.usdcWalletUi);
        if (typeof data.collateralWalletUi === "number") setAnth(data.collateralWalletUi);
      })
      .catch(() => {
        if (!stop) setVault({});
      });
    return () => {
      stop = true;
    };
  }, [publicKey]);

  useEffect(() => {
    let stop = false;
    void fetchPreStocks()
      .then((rows) => {
        if (!stop) setStocks(rows);
      })
      .catch(() => {
        if (!stop) setStocks([]);
      });
    return () => {
      stop = true;
    };
  }, []);

  const supply = vault?.poolValueUi ?? 0;
  const borrowed = vault?.totalBorrowedUi ?? 0;
  const available = vault?.uiAmount ?? 0;
  const book =
    ((vault?.stability?.totalUsdc ?? 0) + (vault?.stability?.legacyUsdc ?? 0)) / 1e6;
  const testPrice = (vault?.testModePriceE6 ?? 0) / 1e6;
  const yields = marketYields({ borrowed, senior: supply, book });
  const ready = Boolean(vault?.initialized);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <CatchBrand />
        <WalletConnect
          usdc={usdc}
          anthropic={anth}
          onChanged={() => {
            const wallet = publicKey?.toBase58();
            const q = wallet ? `?wallet=${wallet}` : "";
            void fetch(`/api/prelend/vault${q}`)
              .then((res) => res.json())
              .then((data: VaultSnap) => {
                setVault(data);
                if (typeof data.usdcWalletUi === "number") setUsdc(data.usdcWalletUi);
                if (typeof data.collateralWalletUi === "number") setAnth(data.collateralWalletUi);
              })
              .catch(() => undefined);
          }}
        />
      </header>

      <section className="panel overflow-x-auto rounded-3xl">
        <div
          className={`hidden ${COLS} gap-3 border-b border-white/10 px-5 py-3 text-[11px] uppercase tracking-widest text-slate-500 sm:grid`}
        >
          <div>Market</div>
          <div>Price</div>
          <div className="text-right">
            <span className="border-b border-dotted border-slate-500">Deposited</span>
          </div>
          <div className="text-right">Borrowed USDC</div>
          <div className="text-right">
            <span className="border-b border-dotted border-slate-500">Bid book</span>
          </div>
          <div className="text-right">
            <span className="border-b border-dotted border-slate-500">Liq LTV</span>
          </div>
          <div className="text-right">Deposit APY</div>
          <div className="text-right">Borrow APY</div>
          <div className="text-right">Bid APY</div>
        </div>
        {(stocks.length
          ? stocks.map((stock) => {
              const market =
                ISOLATED_MARKETS.find((row) => row.base === stock.symbol) ??
                ({
                  id: stock.symbol.toLowerCase(),
                  quote: "USDC",
                  base: stock.symbol,
                  live: false,
                } satisfies IsolatedMarket);
              return { market, stock };
            })
          : ISOLATED_MARKETS.map((market) => ({ market, stock: null as PreStock | null }))
        )
          .slice()
          .sort((a, b) => Number(b.market.base === "ANTHROPIC") - Number(a.market.base === "ANTHROPIC"))
          .map(({ market, stock }) => (
          <MarketRow
            key={market.id}
            market={market}
            stock={stock}
            ready={market.live && ready}
            supply={market.live ? supply : null}
            borrowed={market.live ? borrowed : null}
            available={market.live ? available : null}
            book={market.live ? book : null}
            util={market.live ? yields.util : null}
            depositApr={market.live ? yields.depositApr : null}
            borrowApr={market.live ? yields.borrowApr : null}
            bidApr={market.live ? yields.bidApr : null}
            testPrice={market.live ? testPrice : 0}
            onOpen={onOpen}
          />
        ))}
      </section>
    </main>
  );
}

function MarketRow({
  market,
  stock,
  ready,
  supply,
  borrowed,
  available,
  book,
  util,
  depositApr,
  borrowApr: borrow,
  bidApr,
  testPrice,
  onOpen,
}: {
  market: IsolatedMarket;
  stock: PreStock | null;
  ready: boolean;
  supply: number | null;
  borrowed: number | null;
  available: number | null;
  book: number | null;
  util: number | null;
  depositApr: number | null;
  borrowApr: number | null;
  bidApr: number | null;
  testPrice: number;
  onOpen: (id: string, tab?: MarketTab) => void;
}) {
  const dash = !market.live || !ready;
  const cap = book ?? 0;
  const filled = cap > 0 ? Math.min(1, (borrowed ?? 0) / cap) : 0;
  return (
    <div
      role={market.live ? "button" : undefined}
      tabIndex={market.live ? 0 : undefined}
      onClick={() => {
        if (market.live) onOpen(market.id, "lend");
      }}
      onKeyDown={(e) => {
        if (market.live && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(market.id, "lend");
        }
      }}
      className={`grid ${COLS} items-center gap-3 border-b border-white/5 px-5 py-4 last:border-0 transition-colors ${
        market.live
          ? "cursor-default hover:bg-white/[0.04]"
          : "cursor-not-allowed"
      }`}
    >
      <div className="text-left">
        <div className="text-sm font-semibold">{market.base}</div>
        <div className={`text-[11px] ${market.live ? "text-emerald-300" : "text-slate-500"}`}>
          {market.live ? "Open" : "Soon"}
        </div>
      </div>
      <div className="text-left">
        <div className="text-sm text-slate-200">
          {stock ? tokenLabel(stock.name) : market.base}
        </div>
        <div className="mono text-[11px] text-slate-300">
          {stock ? (
            <PriceQuote
              mark={stock.markPrice}
              token={stock.tokenPrice}
              display={market.live && testPrice > 0 ? testPrice : stock.tokenPrice}
              before={stock.tokenPrice}
              test={market.live && testPrice > 0}
              name={tokenLabel(stock.name)}
              className="text-sky-300"
            />
          ) : (
            "—"
          )}
        </div>
      </div>
      <HoverValue
        label="Deposited"
        value={dash ? "—" : formatUsd(supply ?? 0, 0)}
        rows={
          dash
            ? []
            : [
                ["Utilization", formatPct(util ?? 0)],
                ["Available USDC", formatUsd(available ?? 0, 0)],
                ["Total supply", formatUsd(supply ?? 0, 0)],
                ["Borrow cap (bid book)", formatUsd(cap, 0)],
                ["Filled vs cap", formatPct(filled)],
              ]
        }
      />
      <Cell label="Borrowed USDC" value={dash ? "—" : formatUsd(borrowed ?? 0, 0)} />
      <HoverValue
        label="Bid book"
        value={dash ? "—" : formatUsd(cap, 0)}
        rows={
          dash
            ? []
            : [
                ["Bid book (debt ceiling)", formatUsd(cap, 0)],
                ["Borrowed USDC", formatUsd(borrowed ?? 0, 0)],
                ["Ceiling used", formatPct(filled)],
                ["Unfilled room", formatUsd(Math.max(0, cap - (borrowed ?? 0)), 0)],
                ["Idle in senior vault", formatUsd(available ?? 0, 0)],
              ]
        }
      />
      <HoverValue
        label="Liq LTV"
        value={dash ? "—" : formatPct(LIQUIDATION_LTV, 0)}
        rows={
          dash
            ? []
            : [
                ["Max LTV", formatPct(MAX_BORROW_LTV, 0)],
                ["Liq LTV", formatPct(LIQUIDATION_LTV, 0)],
                ["Liquidation", "Partial, to Max LTV"],
              ]
        }
      />
      <ApyAction
        label="Deposit APY"
        value={dash || depositApr == null ? "—" : formatAprPct(depositApr)}
        tone="up"
        action="Deposit"
        disabled={!market.live}
        onClick={() => onOpen(market.id, "lend")}
      />
      <ApyAction
        label="Borrow APY"
        value={dash || borrow == null ? "—" : formatAprPct(borrow)}
        tone="down"
        action="Borrow"
        disabled={!market.live}
        onClick={() => onOpen(market.id, "borrow")}
      />
      <ApyAction
        label="Bid APY"
        value={dash || bidApr == null ? "—" : formatAprPct(bidApr)}
        tone="bid"
        action="Bid"
        disabled={!market.live}
        onClick={() => onOpen(market.id, "stability")}
      />
    </div>
  );
}

function Cell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="sm:text-right">
      <div className="text-[11px] text-slate-500 sm:hidden">{label}</div>
      <div className="mono text-sm text-white">{value}</div>
    </div>
  );
}

function HoverValue({
  label,
  value,
  rows,
}: {
  label: string;
  value: string;
  rows: [string, string][];
}) {
  const live = rows.length > 0;
  return (
    <div className="group relative sm:text-right">
      <div className="text-[11px] text-slate-500 sm:hidden">{label}</div>
      <span
        className={`mono text-sm text-white ${
          live ? "border-b border-dotted border-slate-400" : ""
        }`}
      >
        {value}
      </span>
      {live ? (
        <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-2xl border border-white/10 bg-[#0c1018] p-3 text-left shadow-xl group-hover:block group-focus-within:block">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-1 text-xs">
              <span className="text-slate-400">{k}</span>
              <span className="mono text-white">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ApyAction({
  label,
  value,
  tone,
  action,
  disabled,
  onClick,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "bid";
  action: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const color =
    tone === "up" ? "text-emerald-300" : tone === "down" ? "text-sky-300" : "text-amber-200";
  const btn =
    tone === "up"
      ? "bg-emerald-400 text-black"
      : tone === "down"
        ? "bg-sky-400 text-black"
        : "bg-amber-400 text-black";
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="sm:text-right">
        <div className="text-[11px] text-slate-500 sm:hidden">{label}</div>
        <div className={`mono text-sm ${disabled ? "text-slate-500" : color}`}>{value}</div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`rounded-full px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${btn}`}
      >
        {action}
      </button>
    </div>
  );
}
