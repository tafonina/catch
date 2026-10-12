# Catch — further improvements

Hackathon build (v1.2): isolated market, yNFT bid book as the ceiling, kinked rate + scarcity split, partial liquidation that fills bids by price–time. Borrower health NFTs (Chad VC → Rekt) stay.

This file is the post-hackathon map.

---

## 1. Dynamic LTV (stop hardcoding 30 / 40)

Fixed ratios are a demo default. Live markets change depth and volatility every hour; a 30% cap that is safe on a $200k book is either reckless or wasteful on a $2M book.

### Who already does this

| Protocol | What moves | Inputs they actually use |
|---|---|---|
| **Aave** (Chaos Labs / LlamaRisk) | LTV, liquidation threshold, bonus, supply/borrow caps | 30d vol, DEX/CEX depth at typical liq size, oracle quality, market cap, asset correlation, concentration |
| **Compound** (Gauntlet) | Collateral factor | Agent simulations: worst 1-day move × can liquidators clear without insolvency |
| **Morpho Blue** | Isolated LLTV from a discrete set (e.g. 86 / 91.5 / 94.5%) | Higher LLTV only for liquid assets + strong oracles; risk stays per market |
| **Maker / Sky** | Liquidation ratio per vault type | Exotic / thin collateral → higher ratio (lower LTV) |
| **Euler** | Per-vault LLTV + borrow caps | Asset tier, oracle, isolated vs cross |
| **Silo** | Per-silo LTV | Isolation so one thin asset cannot infect another |
| **Liquity** | Fixed 110% CR | Works because ETH is deep — the opposite of PreStocks |

Nobody serious sets one LTV for every listing. Thin RWA is closer to Maker “junk collateral” than to Liquity ETH.

### Factors that should drive Catch LTV

1. **DEX depth at a hard impact bound** (already posted as `update_depth`, ≤5%).  
   `borrow_ltv ↑` only while `depth_5pct / market_debt` stays above a coverage multiple.
2. **Stability Pool coverage** `SP_USDC / outstanding_debt`.  
   If the pool can absorb 100% of debt, you can run a tighter buffer. If coverage is 20%, cut max LTV — the DEX is the backstop.
3. **Oracle quality**  
   Two live sources within a tight basis (Pyth index vs DEX TWAP vs PreStocks mark) → allow a higher LTV. Single posted source or wide basis → haircut.
4. **Realized volatility** of the token *and* of `mark − DEX`.  
   Pre-IPO paper gaps on news. Higher 30d vol → lower LTV, wider gap to liquidation.
5. **Time-to-event / conversion risk**  
   IPO, lockup expiry, issuer pause. Near a known event, drop max LTV or pause new borrows (`set_paused` already exists).
6. **Position concentration**  
   One wallet = 40% of a market → treat that market as riskier than the average LTV table.
7. **Slippage of a typical liquidation**  
   Simulate “seize this size on the current book”. If 5% impact cannot clear a median position, the liquidation LTV is fiction.

### Shape (keeper writes params, program only reads)

```
borrow_ltv  = clamp(base × f_depth × f_coverage × f_oracle × f_vol, 15%, 40%)
liq_ltv     = borrow_ltv + buffer
buffer      = 10% when oracle is dual + liquid; 15–20% when posted-only / thin
```

`f_*` in `[0, 1]`. Debt cap stays: `total_debt ≤ SP + depth_5pct` — LTV is *who* can borrow how much; the cap is *how much the system can absorb*.

Do **not** let a keeper raise LTV without a timelock. Lowering LTV on new borrows can be immediate; existing positions keep their original band until they repay or get trimmed.

---

## 2. Decentralized oracle

Today: a keeper posts PreStocks mark + DEX TWAP. `min()` is correct for a hackathon. It is still a trusted poster.

Next:

1. **Pyth pull** for `Equity.Index.ANTHROPIC/USD` and `OPENAI/USD` once a `pyth-indices` key exists. On-chain: verify the VAA, enforce staleness (300s) and max confidence.
2. **Keep DEX TWAP** as the second leg (Meteora DLMM / Jupiter). Never let a single source inflate collateral.
3. **Price used** stays `min(index, twap, mark)` (or `min` of whatever is live). Show the user which source won — the current panel already does this for posted values.
4. **Switch the market class** restricted → Class A automatically when Pyth is fresh: 30/40 → 40/50.
5. **Kill `set_test_price` on mainnet.** Test-mode override is a demo switch, not a production primitive.

---

## 3. Liquidation branching (guards, not one door)

Today: if the Stability Pool cannot cover the debt, liquidation **fails**. That is how you get bad debt on a thin name.

A waterfall, tried in order, each step size-capped:

```
position LTV ≥ liq_ltv
        │
        ▼
[1] Stability Pool          repay from pre-funded USDC
        │ leftover debt
        ▼
[2] DEX, max 5% impact      Jupiter / Meteora sell of *this step only*
        │ leftover
        ▼
[3] Auction                 Dutch / clipper on the remainder
        │ unsold
        ▼
[4] Halt                    pause new borrows, socialize or recap
```

**Why this order**

- **SP first** — no book, no slippage, buyers already opted in (Liquity / Hubble / Prisma). This is the whole point of Catch.
- **DEX second, not first** — Aave-style close only for the slice the book can take at ≤5%. Never dump the whole bag into a $200k pool.
- **Auction third** — Maker Clipper / crvUSD-style Dutch: price starts at oracle and decays. Attracts discretionary buyers when both the pool and the book are short.


Each branch should emit which path ran, so the NFT / UI can say “caught by pool” vs “trimmed on DEX” vs “in auction”.

---

## 4. Partial liquidation (trim to health)

Today we repay **the whole debt**, seize `debt × 1.10 / price`, and return leftover tokens. The borrower is closed. That is simple and demo-clean. It is also harsher than it needs to be.

Target: repay **only enough** that the remaining position sits at max borrow LTV (30% now, or the dynamic borrow LTV later).

```
need_repay = debt − borrow_ltv × remaining_collateral_value
seize      = need_repay × (1 + bonus) / price
```

Aave’s close factor (often 50%) is a cousin; Spark and Compound also partial-close. Catch should target a **health level**, not a fraction of debt — that is what “trim, don’t destroy” means.

Keep the 10% bonus on the *seized* slice only. Borrower keeps the rest, position stays open, NFT stays Chad/Anxious instead of jumping to Rekt.

---

## 5. Idle capital

Two USDC pots sit still: the **lend vault** (idle cash not borrowed) and the **Stability Pool** (cash waiting for a liquidation).

| Idle pile | Safe use | Do not |
|---|---|---|
| Lend vault excess above a reserve | Short-duration USDC yield (T-bill token, money-market) with instant unstake | Farm the same PreStock you lend against |
| SP above a coverage floor (e.g. 1.2× expected 1-day seize) | Same, but **recall must beat a liquidation** | Lock in a 7-day vault |
| Protocol 0.5% origination | Insurance fund → first-loss on branch [4] | Divert yield away from lenders |

Liquity keeps SP USDC unproductive on purpose — availability is the product. For PreStocks, expected liquidation size is knowable (depth + open LTV). Deploy only the surplus above that.

Lender APY then = borrow interest × utilization + idle yield × (1 − utilization). Show both legs in the UI.

---

## 6. Other

- **On-chain loan history** — do not close the position PDA on repay; add a nonce seed or an event indexer. Session storage is a demo journal.
- **Multi-market** — one program, many PreStocks mints. Isolated SP + isolated LTV table per mint (Silo / Morpho isolation).
- **Utilization kink rate** — replace flat 12% with Aave-style kink so idle vaults do not overpay and full vaults attract more lenders.
- **Permissionless liquidator keepers** — crank that tries [1]→[2]→[3] when LTV crosses. The −10/−40 buttons stay test-only.
- **IPO / conversion window** — already have `set_paused`; wire it to PreStocks corporate-action dates.
- **Update loan NFT metadata on-chain** after each trim, not only at mint.
- **Mainnet** — real PreStocks mints, no mock USDC, no public `set_test_price`.
- **Audit + invariant tests** — especially snapshot P/S, debt cap, and the future waterfall.

---

## What ships today vs this file

| | Now (v1.2) | Next |
|---|---|---|
| Ceiling | Bid book only | Optional DEX depth term |
| Liquidation | Partial fill of yNFTs, no DEX | Optional DEX residual + auction |
| Rate | Kinked 10/15/30 + scarcity split | Fixed-term loans, notice period |
| Borrower NFT | Chad VC health cards (kept) | Transferable position NFT |
| Bids | One yNFT account per wallet (max 8) | Fungible tiers / curated vault |
