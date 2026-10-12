"use client";

import { useMemo, useState } from "react";
import {
  RATE_BASE,
  RATE_KINK,
  RATE_KINK_UTIL,
  RATE_MAX,
  RESERVE_FACTOR,
  SENIOR_FLOOR,
  borrowApr,
  formatAprPct,
  marketYields,
} from "@/lib/loan";
import { historySeries, type MarketPoint } from "@/lib/market-history";

function formatUsd(n: number, digits = 0) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

const PAD = { l: 44, r: 14, t: 16, b: 28 };

function polyline(
  points: { x: number; y: number }[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  close = false,
) {
  const xs = xMax - xMin || 1;
  const ys = yMax - yMin || 1;
  const xy = (p: { x: number; y: number }) => {
    const x = x0 + ((p.x - xMin) / xs) * w;
    const y = y0 + h - ((p.y - yMin) / ys) * h;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  if (!points.length) return "";
  let d = `M${xy(points[0])}`;
  for (let i = 1; i < points.length; i += 1) d += ` L${xy(points[i])}`;
  if (close) {
    d += ` L${xy({ x: points[points.length - 1].x, y: yMin })} L${xy({ x: points[0].x, y: yMin })} Z`;
  }
  return d;
}

function atY(points: { x: number; y: number }[], x: number) {
  if (!points.length) return null;
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  }
  return best.y;
}

function LineChart({
  series,
  xMin,
  xMax,
  yMin,
  yMax,
  xTicks,
  yTicks,
  formatX,
  formatY,
  markerX,
  height = 220,
  hover,
  onHoverX,
  fill,
}: {
  series: { label: string; color: string; points: { x: number; y: number }[] }[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xTicks: number[];
  yTicks: number[];
  formatX: (n: number) => string;
  formatY: (n: number) => string;
  markerX?: number;
  height?: number;
  hover?: { x: number; label: string; rows: { color: string; text: string }[] } | null;
  onHoverX?: (x: number | null) => void;
  fill?: boolean;
}) {
  const W = 640;
  const H = height;
  const x0 = PAD.l;
  const y0 = PAD.t;
  const w = W - PAD.l - PAD.r;
  const h = H - PAD.t - PAD.b;
  const xs = xMax - xMin || 1;
  const ys = yMax - yMin || 1;
  const mark = markerX == null ? null : x0 + ((markerX - xMin) / xs) * w;
  const hoverX = hover == null ? null : x0 + ((hover.x - xMin) / xs) * w;
  const tipLeft = hoverX == null ? 0 : Math.min(W - 148, Math.max(x0 + 8, hoverX + 10));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`h-auto w-full ${onHoverX ? "cursor-crosshair" : ""}`}
      onMouseMove={
        onHoverX
          ? (e) => onHoverX(xFromPointer(e.currentTarget, e.clientX, xMin, xMax, W))
          : undefined
      }
      onMouseLeave={onHoverX ? () => onHoverX(null) : undefined}
    >
      {yTicks.map((tick) => {
        const y = y0 + h - ((tick - yMin) / ys) * h;
        return (
          <g key={`y-${tick}`}>
            <line x1={x0} x2={x0 + w} y1={y} y2={y} stroke="rgba(255,255,255,0.07)" />
            <text x={x0 - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize="11">
              {formatY(tick)}
            </text>
          </g>
        );
      })}
      {xTicks.map((tick) => {
        const x = x0 + ((tick - xMin) / xs) * w;
        return (
          <text key={`x-${tick}`} x={x} y={H - 8} textAnchor="middle" fill="#64748b" fontSize="11">
            {formatX(tick)}
          </text>
        );
      })}
      {mark != null ? (
        <line x1={mark} x2={mark} y1={y0} y2={y0 + h} stroke="rgba(251,191,36,0.35)" strokeDasharray="4 4" />
      ) : null}
      {series.map((s) => (
        <g key={s.label}>
          {fill ? (
            <path
              d={polyline(s.points, x0, y0, w, h, xMin, xMax, yMin, yMax, true)}
              fill={s.color}
              opacity="0.16"
            />
          ) : null}
          <path
            d={polyline(s.points, x0, y0, w, h, xMin, xMax, yMin, yMax)}
            fill="none"
            stroke={s.color}
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      ))}
      {onHoverX ? <rect x={x0} y={y0} width={w} height={h} fill="transparent" /> : null}
      {hoverX != null && hover
        ? series.map((s) => {
            const yVal = atY(s.points, hover.x);
            if (yVal == null) return null;
            const cy = y0 + h - ((yVal - yMin) / ys) * h;
            return (
              <circle
                key={`dot-${s.label}`}
                cx={hoverX}
                cy={cy}
                r="4"
                fill={s.color}
                stroke="#05070b"
                strokeWidth="1.5"
              />
            );
          })
        : null}
      {hoverX != null && hover ? (
        <g>
          <line x1={hoverX} x2={hoverX} y1={y0} y2={y0 + h} stroke="#f8fafc" strokeWidth="1.2" />
          <rect
            x={tipLeft}
            y={y0 + 6}
            width="136"
            height={20 + hover.rows.length * 16}
            rx="10"
            fill="#0c1018"
            stroke="rgba(255,255,255,0.14)"
          />
          <text x={tipLeft + 10} y={y0 + 20} fill="#94a3b8" fontSize="10">
            {hover.label}
          </text>
          {hover.rows.map((row, i) => (
            <text key={row.text} x={tipLeft + 10} y={y0 + 36 + i * 16} fill={row.color} fontSize="12">
              {row.text}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

function xFromPointer(el: SVGSVGElement, clientX: number, xMin: number, xMax: number, W: number) {
  const box = el.getBoundingClientRect();
  const plot = W - PAD.l - PAD.r;
  const local = ((clientX - box.left) / box.width) * W;
  const t = (local - PAD.l) / plot;
  return xMin + Math.min(1, Math.max(0, t)) * (xMax - xMin);
}

function polar(cx: number, cy: number, r: number, a: number) {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function Donut({
  slices,
}: {
  slices: { label: string; color: string; value: number }[];
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const cx = 88;
  const cy = 88;
  const r = 62;
  const ir = 38;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const span = (s.value / total) * Math.PI * 2;
    const a1 = a0 + span;
    const large = span > Math.PI ? 1 : 0;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const [ix0, iy0] = polar(cx, cy, ir, a1);
    const [ix1, iy1] = polar(cx, cy, ir, a0);
    const d = `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${ix0} ${iy0} A${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`;
    a0 = a1;
    return { ...s, d, pct: s.value / total };
  });
  return (
    <svg viewBox="0 0 176 176" className="h-40 w-40 shrink-0">
      {arcs.map((s) => (
        <path key={s.label} d={s.d} fill={s.color} />
      ))}
      <circle cx={cx} cy={cy} r={ir - 2} fill="#0c1018" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#94a3b8" fontSize="10">
        of interest
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">
        100%
      </text>
    </svg>
  );
}

function Meter({
  label,
  used,
  cap,
  color,
  hint,
}: {
  label: string;
  used: number;
  cap: number;
  color: string;
  hint: string;
}) {
  const pct = cap > 0 ? Math.min(1, used / cap) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="mono text-white">{(pct * 100).toFixed(1)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{formatUsd(used, 0)} used</span>
        <span>{formatUsd(cap, 0)} cap</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

type Section =
  | "general"
  | "supply"
  | "borrow"
  | "utilization"
  | "curve"
  | "split"
  | "history";

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "General stats", icon: "⌂" },
  { id: "supply", label: "Supply overview", icon: "↗" },
  { id: "borrow", label: "Borrow overview", icon: "↘" },
  { id: "utilization", label: "Utilization", icon: "⌁" },
  { id: "curve", label: "Interest rate curve", icon: "∿" },
  { id: "split", label: "Yield split", icon: "◎" },
  { id: "history", label: "APY history", icon: "◷" },
];

export function MarketDetails({
  marketId,
  yields,
  borrowed = 0,
  senior = 0,
  book = 0,
}: {
  marketId: string;
  borrowed?: number;
  senior?: number;
  book?: number;
  yields: ReturnType<typeof marketYields>;
}) {
  const [section, setSection] = useState<Section>("general");
  const [range, setRange] = useState<"1d" | "1w" | "1m">("1w");
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const now = Date.now();

  const model = useMemo(() => {
    const borrow: { x: number; y: number }[] = [];
    for (let i = 0; i <= 80; i += 1) {
      const u = i / 80;
      borrow.push({ x: u, y: borrowApr(u) });
    }
    return { borrow };
  }, []);

  const hoverBorrow = hoverU == null ? null : borrowApr(hoverU);
  const live: MarketPoint = { t: now, util: yields.util, borrowApr: yields.borrowApr };
  const hist = historySeries(marketId, live, range);
  const histBorrow = hist.map((p) => ({ x: p.t, y: p.borrowApr }));
  const histUtil = hist.map((p) => ({ x: p.t, y: p.util }));
  const tMin = hist[0]?.t ?? now;
  const tMax = hist[hist.length - 1]?.t ?? now;
  const apyMin = Math.min(...histBorrow.map((p) => p.y), yields.borrowApr, RATE_BASE) - 0.01;
  const apyMax = Math.max(...histBorrow.map((p) => p.y), yields.borrowApr, RATE_KINK) + 0.02;

  const gross = yields.gross;
  const reserve = yields.reserve;
  const seniorCut = yields.seniorCut;
  const juniorCut = yields.juniorCut;
  const uSenior = senior > 0 ? Math.min(1, borrowed / senior) : 0;
  const uJunior = book > 0 ? Math.min(1, borrowed / book) : 0;
  const available = Math.max(0, senior - borrowed);

  const slices = [
    { label: "Reserve", color: "#94a3b8", value: Math.max(reserve, 0) },
    { label: "Lenders", color: "#34d399", value: Math.max(seniorCut, 0) },
    { label: "Bidders", color: "#7dd3fc", value: Math.max(juniorCut, 0) },
  ];
  const pieTotal = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-56">
        <div className="panel space-y-0.5 rounded-2xl p-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${
                section === item.id
                  ? "bg-white/10 font-medium text-white"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              <span className="w-5 text-center text-slate-500">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <div className="panel min-w-0 flex-1 rounded-3xl p-5 sm:p-6">
        {section === "general" ? (
          <div>
            <h2 className="text-lg font-semibold">General stats</h2>
            <p className="mt-1 text-sm text-slate-400">Isolated pool — rates and LTV apply only here.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Stat k="Total supply" v={formatUsd(senior, 0)} />
              <Stat k="Borrowed" v={formatUsd(borrowed, 0)} />
              <Stat k="Bid book (ceiling)" v={formatUsd(book, 0)} />
              <Stat k="Borrow APY" v={formatAprPct(yields.borrowApr)} />
              <Stat k="Deposit APY" v={formatAprPct(yields.depositApr)} />
              <Stat k="Lock yield" v={formatAprPct(yields.bidApr)} />
            </div>
          </div>
        ) : null}

        {section === "supply" ? (
          <div>
            <h2 className="text-lg font-semibold">Supply overview</h2>
            <p className="mt-1 text-sm text-slate-400">
              Senior USDC in this vault. Idle cash can be withdrawn; lent cash is the borrowed slice.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Stat k="Deposited" v={formatUsd(senior, 0)} />
              <Stat k="Idle in vault" v={formatUsd(available, 0)} />
              <Stat k="Lent out" v={formatUsd(borrowed, 0)} />
            </div>
            <div className="mt-6">
              <Meter
                label="Senior utilization"
                used={borrowed}
                cap={senior}
                color="#34d399"
                hint="This is U_senior — it sets Borrow APY on the kink curve."
              />
            </div>
          </div>
        ) : null}

        {section === "borrow" ? (
          <div>
            <h2 className="text-lg font-semibold">Borrow overview</h2>
            <p className="mt-1 text-sm text-slate-400">
              Debt cannot exceed the bid book. Borrow APY is the same for every loan in this market.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Stat k="Borrowed USDC" v={formatUsd(borrowed, 0)} />
              <Stat k="Debt ceiling" v={formatUsd(book, 0)} />
              <Stat k="Room left" v={formatUsd(Math.max(0, book - borrowed), 0)} />
            </div>
            <div className="mt-6">
              <Meter
                label="Ceiling used"
                used={borrowed}
                cap={book}
                color="#7dd3fc"
                hint="U_junior = debt / bid book. Scarce bids → more lock yield."
              />
            </div>
          </div>
        ) : null}

        {section === "utilization" ? (
          <div>
            <h2 className="text-lg font-semibold">Utilization</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Two caps, two meters. Senior utilization prices the loan. Bid-book utilization is how much
              of the ceiling is already taken.
            </p>
            <div className="mt-6 space-y-6">
              <Meter
                label="Senior vault  ·  borrowed / deposits"
                used={borrowed}
                cap={senior}
                color="#34d399"
                hint={`${formatAprPct(yields.borrowApr)} borrow APY at this U_senior (kink at 80% → 15%).`}
              />
              <Meter
                label="Bid book  ·  borrowed / locked bids"
                used={borrowed}
                cap={book}
                color="#7dd3fc"
                hint={`${formatAprPct(yields.bidApr)} lock yield on the book. Engaged bids earn; idle tail can leave.`}
              />
            </div>
          </div>
        ) : null}

        {section === "curve" ? (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Interest rate curve</h2>
                <p className="mt-1 text-sm text-slate-400">Borrow APY vs senior utilization. Hover the line.</p>
              </div>
              <div className="mono text-sm text-amber-200">
                Now {formatAprPct(yields.borrowApr)} @ {(uSenior * 100).toFixed(0)}%
              </div>
            </div>
            <div className="mt-4">
              <LineChart
                series={[{ label: "Borrow APY", color: "#fcd34d", points: model.borrow }]}
                xMin={0}
                xMax={1}
                yMin={0.08}
                yMax={0.32}
                xTicks={[0, 0.4, RATE_KINK_UTIL, 1]}
                yTicks={[0.1, 0.15, 0.22, 0.3]}
                formatX={(n) => (n === RATE_KINK_UTIL ? "80% kink" : `${Math.round(n * 100)}%`)}
                formatY={(n) => `${Math.round(n * 100)}%`}
                markerX={uSenior}
                height={240}
                fill
                onHoverX={setHoverU}
                hover={
                  hoverBorrow != null && hoverU != null
                    ? {
                        x: hoverU,
                        label: `Utilization ${(hoverU * 100).toFixed(0)}%`,
                        rows: [{ color: "#fcd34d", text: `Borrow APY ${formatAprPct(hoverBorrow)}` }],
                      }
                    : null
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>Base {formatAprPct(RATE_BASE, 0)}</span>
              <span>
                Kink {Math.round(RATE_KINK_UTIL * 100)}% → {formatAprPct(RATE_KINK, 0)}
              </span>
              <span>Max {formatAprPct(RATE_MAX, 0)}</span>
            </div>
          </div>
        ) : null}

        {section === "split" ? (
          <div>
            <h2 className="text-lg font-semibold">Yield split</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Borrowers pay {formatAprPct(yields.borrowApr)} on {formatUsd(borrowed, 0)} debt
              ({formatUsd(gross)} / year). That cash is cut once: {Math.round(RESERVE_FACTOR * 100)}% to the
              market reserve, the rest between lenders and bidders by scarcity (senior floor{" "}
              {Math.round(SENIOR_FLOOR * 100)}% of the net).
            </p>
            <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <Donut slices={pieTotal > 0 ? slices : [{ label: "None", color: "#334155", value: 1 }]} />
              <div className="min-w-0 flex-1 space-y-3 text-sm">
                <SplitRow
                  color="#94a3b8"
                  title="Reserve"
                  share={pieTotal > 0 ? reserve / pieTotal : RESERVE_FACTOR}
                  amount={reserve}
                  note={`${formatAprPct(yields.reserveApr)} of debt — always ${Math.round(RESERVE_FACTOR * 100)}% of borrow interest, for bad debt.`}
                />
                <SplitRow
                  color="#34d399"
                  title="Lenders (senior vault)"
                  share={pieTotal > 0 ? seniorCut / pieTotal : 0}
                  amount={seniorCut}
                  note={`${formatAprPct(yields.depositApr)} APY on ${formatUsd(senior, 0)} deposits. Their cut of leftover interest.`}
                />
                <SplitRow
                  color="#7dd3fc"
                  title="Bidders (lock yield)"
                  share={pieTotal > 0 ? juniorCut / pieTotal : 0}
                  amount={juniorCut}
                  note={`${formatAprPct(yields.bidApr)} APY on ${formatUsd(book, 0)} in the book. Paid on engaged bids, not idle ones.`}
                />
              </div>
            </div>
            <div className="mt-6 space-y-5 border-t border-white/10 pt-5">
              <p className="text-xs text-slate-500">
                The circle is shares of the same dollar pile. The APYs below are that pile divided by
                each side&apos;s capital — so they are not meant to add up to Borrow APY.
              </p>
              <Meter
                label="Senior utilization (prices the loan)"
                used={borrowed}
                cap={senior}
                color="#34d399"
                hint="High → borrow APY rises along the kink."
              />
              <Meter
                label="Bid-book utilization (ceiling)"
                used={borrowed}
                cap={book}
                color="#7dd3fc"
                hint="High → bidders are scarce → larger slice of interest."
              />
            </div>
          </div>
        ) : null}

        {section === "history" ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">APY history</h2>
                <p className="mt-1 text-sm text-slate-400">Borrow APY and senior utilization over time.</p>
              </div>
              <div className="flex gap-1 rounded-full border border-white/10 p-0.5">
                {(["1d", "1w", "1m"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRange(id)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      range === id ? "bg-amber-400 font-semibold text-black" : "text-slate-400"
                    }`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Borrow APY</div>
              <LineChart
                series={[{ label: "Borrow APY", color: "#fcd34d", points: histBorrow }]}
                xMin={tMin}
                xMax={tMax}
                yMin={Math.max(0.08, apyMin)}
                yMax={Math.min(0.32, apyMax)}
                xTicks={[tMin, tMin + (tMax - tMin) / 2, tMax]}
                yTicks={[RATE_BASE, RATE_KINK]}
                formatX={(n) =>
                  new Date(n).toLocaleDateString(
                    "en-US",
                    range === "1d" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
                  )
                }
                formatY={(n) => `${(n * 100).toFixed(0)}%`}
                height={220}
                fill
                onHoverX={setHoverT}
                hover={
                  hoverT != null
                    ? {
                        x: hoverT,
                        label: new Date(hoverT).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: range === "1d" ? "numeric" : undefined,
                        }),
                        rows: [
                          {
                            color: "#fcd34d",
                            text: `APY ${formatAprPct(atY(histBorrow, hoverT) ?? yields.borrowApr)}`,
                          },
                        ],
                      }
                    : null
                }
              />
            </div>
            <div className="mt-6">
              <div className="mb-1 text-[11px] uppercase tracking-widest text-slate-500">Utilization</div>
              <LineChart
                series={[{ label: "Utilization", color: "#34d399", points: histUtil }]}
                xMin={tMin}
                xMax={tMax}
                yMin={0}
                yMax={1}
                xTicks={[tMin, tMin + (tMax - tMin) / 2, tMax]}
                yTicks={[0, RATE_KINK_UTIL, 1]}
                formatX={(n) =>
                  new Date(n).toLocaleDateString(
                    "en-US",
                    range === "1d" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
                  )
                }
                formatY={(n) => `${Math.round(n * 100)}%`}
                height={200}
                fill
                onHoverX={setHoverT}
                hover={
                  hoverT != null
                    ? {
                        x: hoverT,
                        label: new Date(hoverT).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: range === "1d" ? "numeric" : undefined,
                        }),
                        rows: [
                          {
                            color: "#34d399",
                            text: `Util ${((atY(histUtil, hoverT) ?? yields.util) * 100).toFixed(0)}%`,
                          },
                        ],
                      }
                    : null
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="text-[11px] uppercase tracking-widest text-slate-500">{k}</div>
      <div className="mt-1 text-lg text-white">{v}</div>
    </div>
  );
}

function SplitRow({
  color,
  title,
  share,
  amount,
  note,
}: {
  color: string;
  title: string;
  share: number;
  amount: number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium text-white">
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {title}
        </span>
        <span className="mono text-slate-200">
          {(share * 100).toFixed(0)}% · {formatUsd(amount)}/yr
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-slate-500">{note}</p>
    </div>
  );
}
