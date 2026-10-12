import type { Metadata } from "next";
import Link from "next/link";
import { FlowFilm } from "@/components/site/FlowFilm";
import { SiteChrome } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "Catch — Borrow against tokens nobody else will lend on",
  description:
    "Credit against pre-IPO and long-tail tokens on Solana. Every loan is capped by USDC bidders have already locked.",
};

const roles = [
  {
    n: "01",
    name: "Borrower",
    line: "Puts in the token. Gets USDC, without selling.",
    body: "Lock a pre-IPO token and draw USDC up to 30% of its value, and only up to the cash already waiting in the book. If the loan crosses 40% LTV, a partial liquidation brings it back to 30%.",
  },
  {
    n: "02",
    name: "Lender",
    line: "Puts in USDC. Gets yield, repaid in USDC.",
    body: "Deposits are lent out. Interest follows a kink: 10% when the vault is idle, 15% at 80% used, 30% when it is full. Lenders keep a floor, and they are repaid in USDC.",
  },
  {
    n: "03",
    name: "Bidder",
    line: "The stability pool. USDC at a discount, ready to buy.",
    body: "A bid is escrow, not a deposit that gets lent. Choose the discount. While that cash backs open debt it earns lock yield. If a loan is liquidated, you buy the collateral at your price.",
  },
];

const steps = [
  {
    t: "The book is the ceiling",
    d: "Market debt cannot exceed the USDC locked in bids. An empty book means the ceiling is zero.",
  },
  {
    t: "Two limits, the smaller one binds",
    d: "A position can borrow 30% of collateral. The market can borrow only what the book can buy.",
  },
  {
    t: "A break is a fill",
    d: "At 40% LTV the book buys just enough collateral to restore 30%. Tightest discount first, then the earliest bid.",
  },
];

export default function LandingPage() {
  return (
    <SiteChrome active="home">
      <main>
        <section className="mx-auto grid max-w-6xl items-end gap-14 px-5 pb-8 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:pb-16">
          <div>
            <p className="mono text-[11px] uppercase tracking-[0.28em] text-[#d4af37]">
              Solana · isolated markets
            </p>
            <h1 className="mt-5 max-w-xl text-5xl leading-[0.95] tracking-tight sm:text-7xl">
              Borrow against tokens{" "}
              <span className="serif italic text-[#e7c96a]">nobody else</span> will lend on.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-300">
              Pre-IPO tokens trade on Solana with a mark, and almost no exit. Catch lends against
              them because bidders have already locked the USDC to buy them.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/app"
                className="rounded-full bg-[#d4af37] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#e3c25a]"
              >
                Open the app
              </Link>
              <Link href="/docs" className="text-sm text-slate-300 underline-offset-4 hover:text-white hover:underline">
                How the market works
              </Link>
            </div>
          </div>

          <aside className="panel rounded-3xl p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="mono text-[11px] uppercase tracking-[0.22em] text-[#d4af37]">
                Stability pool
              </div>
              <div className="text-[11px] text-emerald-300">USDC / ANTHROPIC · devnet</div>
            </div>
            <p className="serif mt-4 text-3xl leading-tight italic text-white">
              Buyers commit before the loan.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Holders borrow against a low-liquidity token because bidders have already locked USDC
              to purchase the collateral if the loan has to be closed. The holder keeps the token.
              The lender is repaid in USDC. Every loan is secured by that committed exit.
            </p>
            <Link
              href="/app?pool=anthropic"
              className="mt-6 inline-flex text-sm font-semibold text-[#e7c96a] hover:text-white"
            >
              Enter the Anthropic market →
            </Link>
          </aside>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
          <p className="mono text-[11px] uppercase tracking-[0.28em] text-slate-500">The gap</p>
          <h2 className="mt-4 max-w-3xl text-3xl leading-tight tracking-tight sm:text-5xl">
            Liquidity too thin to borrow against.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            Long-tail and private-market tokens have onchain liquidity too thin for a normal loan.
            A liquidation into that book becomes bad debt. Lenders stay away, and holders sit on
            dead capital.
          </p>
        </section>

        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <p className="mono text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Three sides, one market
            </p>
            <div className="mt-10 divide-y divide-white/10">
              {roles.map((role) => (
                <article key={role.n} className="grid gap-4 py-8 sm:grid-cols-[7rem_1fr_1.2fr] sm:gap-8">
                  <div className="serif text-2xl italic text-[#d4af37]">{role.n}</div>
                  <div>
                    <h3 className="text-2xl font-semibold">{role.name}</h3>
                    <p className="mt-2 text-sm text-slate-400">{role.line}</p>
                  </div>
                  <p className="leading-relaxed text-slate-300">{role.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="mono text-[11px] uppercase tracking-[0.28em] text-[#d4af37]">
              Interest, yield and revenue
            </p>
            <h2 className="mt-4 text-3xl leading-tight tracking-tight sm:text-5xl">
              Interest flows to the <span className="serif italic text-[#e7c96a]">scarcer side.</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              Rates rise as the senior vault fills. After the reserve takes its cut, what remains
              leans toward lenders or bidders — whichever the market is short of — so both sides
              keep a reason to show up.
            </p>
          </div>
          <div className="mt-10 overflow-hidden rounded-3xl border border-[rgba(212,175,55,0.28)] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <FlowFilm />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-500">
            Borrow rate: 10% at an empty vault, 15% at the 80% kink, 30% when lenders are fully
            used. Ten percent of interest fills that market’s reserve. Lenders keep at least a 5%
            floor of the rest. Lock yield is paid only on bids that are actually covering debt.
          </p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-12 px-5 py-8 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-16">
          <div>
            <p className="mono text-[11px] uppercase tracking-[0.28em] text-slate-500">
              When a loan breaks
            </p>
            <h2 className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl">
              The buyer is already in the pool.
            </h2>
            <p className="mt-4 leading-relaxed text-slate-300">
              Senior is repaid in USDC. Each bidder receives tokens at the discount they chose.
              The sale settles in the book, so it does not push the DEX price down.
            </p>
          </div>
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.t} className="panel rounded-2xl px-5 py-5">
                <div className="mono text-[11px] uppercase tracking-[0.2em] text-[#d4af37]">
                  0{i + 1}
                </div>
                <h3 className="mt-2 text-lg font-semibold">{step.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{step.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
          <div className="overflow-hidden rounded-[2rem] border border-[rgba(212,175,55,0.22)] bg-[radial-gradient(800px_300px_at_10%_0%,rgba(212,175,55,0.16),transparent_55%),#0b0e14] px-6 py-14 sm:px-12">
            <h2 className="max-w-xl text-4xl leading-tight tracking-tight sm:text-5xl">
              The Anthropic market is open.
            </h2>
            <p className="mt-4 max-w-lg text-slate-300">
              Lend USDC, borrow against the token, or lock a bid at your discount. Other PreStocks
              markets open when a book exists.
            </p>
            <Link
              href="/app?pool=anthropic"
              className="mt-8 inline-flex rounded-full bg-[#d4af37] px-6 py-3 text-sm font-semibold text-black hover:bg-[#e3c25a]"
            >
              Open the app
            </Link>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
