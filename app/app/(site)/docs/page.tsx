import type { Metadata } from "next";
import Link from "next/link";
import { Cases, Eq, Frac, Sub, V } from "@/components/site/formula";
import { SiteChrome } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "Docs — Catch",
  description:
    "Catch protocol: a stability pool of bidders, the market ceiling, partial liquidation, and the kinked interest split.",
};

const toc = [
  ["pool", "Stability pool"],
  ["market", "Isolated market"],
  ["roles", "Three roles"],
  ["ceiling", "The ceiling"],
  ["limits", "Two limits"],
  ["price", "Price"],
  ["parameters", "Parameters"],
  ["liquidation", "Liquidation"],
  ["interest", "Interest"],
  ["example", "Worked example"],
  ["live", "On devnet"],
];

const roles = [
  ["Borrower", "The token, as collateral", "A USDC loan", "Partial liquidation if LTV crosses the threshold"],
  ["Senior lender", "USDC that is lent out", "A scarcity-weighted share of interest, with a 5% floor", "A gap deeper than the bids, after the reserve"],
  ["Bidder", "USDC escrowed in the stability pool", "Lock yield on the engaged part, and the token at their discount", "First loss, if the token falls through their price"],
];

const params = [
  ["Max LTV", "30%", "Highest debt / collateral at origination"],
  ["Liquidation threshold", "40%", "LTV at which a position can be cranked"],
  ["Target LTV", "30%", "A liquidation sells only enough to restore this"],
  ["Base rate", "10%", "Borrow rate when the senior vault is idle"],
  ["Kink", "80%", "Senior utilization where the curve steepens"],
  ["Kink rate", "15%", "Borrow rate at the kink"],
  ["Max rate", "30%", "Borrow rate when the senior vault is full"],
  ["Reserve factor", "10%", "Share of gross interest that fills the reserve"],
  ["Senior floor", "5%", "Minimum senior share of net interest"],
  ["Origination fee", "0.5%", "Protocol fee on each new loan"],
];

export default function DocsPage() {
  return (
    <SiteChrome active="docs">
      <main className="mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-6 lg:grid-cols-[13rem_1fr] lg:py-20">
        <nav className="hidden lg:block">
          <div className="sticky top-24 space-y-2 text-sm">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block text-slate-400 hover:text-white">
                {label}
              </a>
            ))}
          </div>
        </nav>

        <article className="max-w-3xl">
          <p className="mono text-[11px] uppercase tracking-[0.28em] text-[#d4af37]">Docs</p>
          <h1 className="mt-3 text-4xl tracking-tight sm:text-5xl">How a Catch market works</h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-300">
            Catch unlocks credit against long-tail and private-market tokens, backed by a stability
            pool of bidders, so every loan is secured by committed exit liquidity.
          </p>
          <Link href="/app" className="mt-6 inline-flex text-sm font-semibold text-[#e7c96a] hover:text-white">
            Open the app →
          </Link>

          <Section id="pool" title="Stability pool">
            <p>
              Holders borrow against a low-liquidity token because buyers commit first. A bidder
              locks USDC at a discount they choose. That cash sits in escrow. It is the standby
              purchase: if a loan has to be closed, the pool buys the collateral at that discount.
              The lender is repaid in USDC. The holder borrowed without selling.
            </p>
            <p>
              A bid is a position in that market: the mint, the discount, the USDC locked, the time
              it was placed, and whether it is engaged. Engaged bids are the ones that would fill
              first — lowest discount, then the earliest lock. They earn lock yield. Idle bids earn
              nothing and can leave.
            </p>
            <p>
              In options terms the bidder is short a cash-secured put struck at the mark minus
              their discount. In market terms it is a binding offer to buy.
            </p>
          </Section>

          <Section id="market" title="Isolated market">
            <p>
              Each market is one pre-IPO mint, one senior vault, one stability pool, and one
              reserve. Nothing is shared between markets. A loss in one mint stays there.
            </p>
          </Section>

          <Section id="roles" title="Three roles">
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="mono text-[11px] uppercase tracking-widest text-slate-500">
                  <tr className="border-b border-white/10">
                    {["Role", "Puts in", "Gets", "Risk"].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((row) => (
                    <tr key={row[0]} className="border-b border-white/5 align-top last:border-0">
                      {row.map((cell, i) => (
                        <td key={cell} className={`px-4 py-3 ${i === 0 ? "text-white" : "text-slate-300"}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>In the ordinary path the senior lender receives USDC. The token goes to the bidder who bought it.</p>
          </Section>

          <Section id="ceiling" title="The ceiling">
            <p>The market can lend only as much as the stability pool has already locked. An empty pool means the ceiling is zero.</p>
            <Eq caption="Sum of USDC locked in bids for this mint.">
              <span>
                Market ceiling <span className="mx-2 text-slate-500">=</span> Σ USDC in the stability pool
              </span>
            </Eq>
          </Section>

          <Section id="limits" title="Two limits">
            <p>A new borrow has to satisfy both. The smaller one binds. Extra collateral only lowers LTV.</p>
            <Eq caption="Position limit. Debt against this collateral.">
              <span>
                Debt <span className="mx-2 text-slate-500">≤</span> Max LTV <span className="mx-2 text-slate-500">×</span> collateral value
              </span>
            </Eq>
            <Eq caption="Market limit. Room left under the pool, including interest still to accrue.">
              <span>
                Market debt + interest headroom <span className="mx-2 text-slate-500">≤</span> ceiling
              </span>
            </Eq>
          </Section>

          <Section id="price" title="Price">
            <p>
              The price used to value collateral is the lower of the issuer mark and the DEX token
              price. If those two diverge by more than the tightest discount in the pool, new loans
              and liquidations pause. A stale price pauses the same way.
            </p>
            <Eq>
              <span>
                Price <span className="mx-2 text-slate-500">=</span> min(issuer mark, DEX token)
              </span>
            </Eq>
          </Section>

          <Section id="parameters" title="Parameters">
            <p>Defaults are the starting point for a market. A multisig can set them per mint.</p>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="mono text-[11px] uppercase tracking-widest text-slate-500">
                  <tr className="border-b border-white/10">
                    {["Parameter", "Default", "Meaning"].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {params.map(([name, value, meaning]) => (
                    <tr key={name} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3 text-white">{name}</td>
                      <td className="serif px-4 py-3 italic text-[#e7c96a]">{value}</td>
                      <td className="px-4 py-3 text-slate-300">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="liquidation" title="Liquidation">
            <p>
              Liquidation is partial and atomic. One transaction sells only enough collateral to
              bring the position back to the target LTV. The stability pool is the buyer.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Anyone may crank a position once its LTV crosses the liquidation threshold. The cranker receives a fixed keeper fee.</li>
              <li>The program computes the USDC required to restore the target LTV.</li>
              <li>The pool fills by price, then time: lowest discount first, then the earliest lock. A bid at the end of the fill can be taken in part.</li>
              <li>USDC from those bids repays senior. The matching tokens move to each bidder at that bidder’s own discount.</li>
              <li>If the pool cannot cover the whole amount, what filled is settled and the rest of the position stays liquidatable.</li>
            </ol>
            <p>
              The fill stays inside the pool, so the liquidation itself does not push the DEX price.
              Bidders absorb the first loss by holding the token they agreed to buy. A remaining
              shortfall is paid from that market’s reserve, and only then shared across senior.
            </p>
            <p>
              Worked fill. Debt to close $10,000. The pool has $4,000 at 10%, another $3,000 at 10%
              placed later, and $20,000 at 25%. Both 10% bids fill in full, then $3,000 of the 25%
              bid. Three buyers each receive tokens at their own price. Senior receives $10,000.
            </p>
          </Section>

          <Section id="interest" title="Interest">
            <p>
              Each market prices its own debt with a kinked curve on senior utilization, then splits
              net interest toward whichever side is scarcer. Interest compounds into the borrower’s
              debt. Senior yield and lock yield are paid in cash when debt is repaid or liquidated.
            </p>
            <p>Three inputs: active debt, USDC in the senior vault, and USDC locked in the stability pool.</p>
            <Eq caption="Senior utilization and stability-pool utilization.">
              <span className="inline-flex items-center gap-8">
                <span>
                  <V>U</V>
                  <Sub>senior</Sub>
                  <span className="mx-2 text-slate-500">=</span>
                  <Frac num={<><V>D</V><Sub>active</Sub></>} den={<><V>S</V><Sub>total</Sub></>} />
                </span>
                <span>
                  <V>U</V>
                  <Sub>junior</Sub>
                  <span className="mx-2 text-slate-500">=</span>
                  <Frac num={<><V>D</V><Sub>active</Sub></>} den={<><V>J</V><Sub>total</Sub></>} />
                </span>
              </span>
            </Eq>
            <p>The borrow rate follows senior utilization. Below the kink it rises gently. Above it, the slope steepens so a full vault pulls deposits back in.</p>
            <Eq>
              <span className="inline-flex items-center gap-3">
                <span>
                  <V>R</V>
                  <Sub>borrow</Sub>
                  <span className="mx-2 text-slate-500">=</span>
                </span>
                <Cases
                  lines={[
                    {
                      when: "when senior utilization ≤ kink",
                      expr: (
                        <>
                          <V>R</V>
                          <Sub>base</Sub>
                          <span className="mx-1.5 text-slate-500">+</span>
                          <Frac
                            num={<><V>U</V><Sub>senior</Sub></>}
                            den={<V>K</V>}
                          />
                          <span className="ml-1">
                            (<V>R</V>
                            <Sub>kink</Sub>
                            <span className="mx-1 text-slate-500">−</span>
                            <V>R</V>
                            <Sub>base</Sub>)
                          </span>
                        </>
                      ),
                    },
                    {
                      when: "when senior utilization > kink",
                      expr: (
                        <>
                          <V>R</V>
                          <Sub>kink</Sub>
                          <span className="mx-1.5 text-slate-500">+</span>
                          <Frac
                            num={
                              <>
                                <V>U</V>
                                <Sub>senior</Sub>
                                <span className="mx-1 text-slate-500">−</span>
                                <V>K</V>
                              </>
                            }
                            den={
                              <>
                                1 <span className="mx-1 text-slate-500">−</span> <V>K</V>
                              </>
                            }
                          />
                          <span className="ml-1">
                            (<V>R</V>
                            <Sub>max</Sub>
                            <span className="mx-1 text-slate-500">−</span>
                            <V>R</V>
                            <Sub>kink</Sub>)
                          </span>
                        </>
                      ),
                    },
                  ]}
                />
              </span>
            </Eq>
            <p>The reserve takes its share first. What remains splits by scarcity, with a floor for senior.</p>
            <Eq>
              <span>
                <V>R</V>
                <Sub>net</Sub>
                <span className="mx-2 text-slate-500">=</span>
                <V>R</V>
                <Sub>borrow</Sub>
                <span className="mx-2 text-slate-500">×</span>(1 <span className="mx-1 text-slate-500">−</span>
                <V>F</V>
                <Sub>reserve</Sub>)
              </span>
            </Eq>
            <Eq caption="Senior keeps the larger of its scarcity share and the floor, and never more than the net rate. Junior receives the rest.">
              <span className="flex flex-col items-start gap-4 text-left">
                <span>
                  <V>R</V>
                  <Sub>senior</Sub>
                  <span className="mx-2 text-slate-500">=</span>
                  max
                  <span className="text-slate-500">(</span>
                  <V>R</V>
                  <Sub>net</Sub>
                  <span className="mx-1 text-slate-500">×</span>
                  <Frac
                    num={<><V>U</V><Sub>senior</Sub></>}
                    den={
                      <>
                        <V>U</V>
                        <Sub>senior</Sub>
                        <span className="mx-1 text-slate-500">+</span>
                        <V>U</V>
                        <Sub>junior</Sub>
                      </>
                    }
                  />
                  <span className="mx-1 text-slate-500">,</span>
                  min
                  <span className="text-slate-500">(</span>
                  <V>S</V>
                  <Sub>floor</Sub>
                  <span className="mx-1 text-slate-500">,</span>
                  <V>R</V>
                  <Sub>net</Sub>
                  <span className="text-slate-500">))</span>
                </span>
                <span>
                  <V>R</V>
                  <Sub>junior</Sub>
                  <span className="mx-2 text-slate-500">=</span>
                  <V>R</V>
                  <Sub>net</Sub>
                  <span className="mx-2 text-slate-500">−</span>
                  <V>R</V>
                  <Sub>senior</Sub>
                </span>
              </span>
            </Eq>
            <p>
              Lock yield goes only to the engaged part of the pool — the bids actually covering
              open debt — in proportion to the USDC they have locked. The same dollars earn the
              same rate. The idle tail earns nothing.
            </p>
            <p>
              The split corrects itself. When bids are scarce, bidders earn more. When the pool is
              deep, they earn less. When lenders are scarce, the borrow rate and their share both
              rise. Bidders have to arrive first: with an empty pool the ceiling is zero, so there
              is no loan to price.
            </p>
          </Section>

          <Section id="example" title="Worked example">
            <p>
              Base 10%, kink 80%, kink rate 15%, max 30%, reserve 10%, senior floor 5%. Senior
              vault $100,000, stability pool $300,000, debt $80,000. Senior utilization is 80%,
              exactly the kink. Pool utilization is 26.7%. The borrow rate is 15%.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="mono text-[11px] uppercase tracking-widest text-slate-500">
                  <tr className="border-b border-white/10">
                    {["Slice of the 15%", "Rate", "Share", "Per year on $80k"].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Reserve", "1.5%", "10%", "$1,200"],
                    ["Senior vault", "10.1%", "67.5%", "$8,100 · 8.1% on $100k"],
                    ["Lock yield", "3.4%", "22.5%", "$2,700 · 3.4% on $80k engaged"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-white/5 last:border-0">
                      {row.map((cell, i) => (
                        <td key={cell} className={`px-4 py-3 ${i === 0 ? "text-white" : "text-slate-300"}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              The rate is one number for every borrower in the market. A full senior vault means
              everyone pays the max rate, 30%. A deposit or a repayment brings it down at once: a
              $10,000 vault that is fully lent charges 30%; at 90% used, 22.5%; after another
              $5,000 of deposits, about 14.2%.
            </p>
          </Section>

          <Section id="live" title="On devnet">
            <p>
              The open market is USDC / ANTHROPIC. Further mints open when a stability pool exists
              for them. Catch takes 0.5% on each new loan. Ten percent of interest fills that
              market’s reserve.
            </p>
            <p>
              <Link href="/app?pool=anthropic" className="font-semibold text-[#e7c96a] hover:text-white">
                Open the Anthropic market →
              </Link>
            </p>
          </Section>
        </article>
      </main>
    </SiteChrome>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-24 border-t border-white/10 pt-10">
      <h2 className="text-2xl tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}
