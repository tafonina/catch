"use client";

export function tokenLabel(name: string) {
  return name.replace(/\s+PreStocks$/i, "").trim() || name;
}

export function quotePrices(mark: number, token: number) {
  const markPx = Number.isFinite(mark) && mark > 0 ? mark : 0;
  const tokenPx = Number.isFinite(token) && token > 0 ? token : markPx;
  const used = Math.min(markPx || tokenPx, tokenPx || markPx);
  return { mark: markPx, token: tokenPx, used };
}

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function PriceQuote({
  name,
  mark,
  token,
  display,
  test = false,
  className = "",
}: {
  name?: string;
  mark: number;
  token: number;
  display?: number;
  test?: boolean;
  className?: string;
}) {
  const q = quotePrices(mark, token);
  const shown = display != null && display > 0 ? display : q.used;
  const explain = q.mark > 0 && q.token > 0;
  return (
    <span className={`group relative inline-block ${className}`}>
      <span className={explain ? "cursor-help border-b border-dotted border-current" : ""}>
        {shown > 0 ? money(shown) : "—"}
      </span>
      {explain ? (
        <span
          className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-64 rounded-2xl border border-white/20 p-3 text-left shadow-2xl group-hover:grid group-focus-within:grid"
          style={{ backgroundColor: "#12161f", opacity: 1 }}
        >
          <span className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-400">PreStocks mark</span>
            <span className="mono text-right text-white">{money(mark)}</span>
            <span className="text-slate-400">DEX token</span>
            <span className="mono text-right text-white">{money(token)}</span>
          </span>
          <span className="mt-2 block border-t border-white/15 pt-2 text-[11px] leading-snug text-slate-200">
            min(mark, token) = {money(q.used)}
          </span>
          {test ? (
            <span className="mt-1 block text-[11px] text-red-300">Test price {money(shown)}</span>
          ) : null}
          {name ? <span className="mt-1 block text-[11px] text-slate-500">{name}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
