# Catch (program: prelend)

Lending against pre-IPO tokens is not blocked by missing code. It is blocked by liquidation capacity: a few hundred thousand dollars of DEX liquidity per asset, and until 17 September 2026 no oracle at all. PreLend addresses both.

A Stability Pool recruits and funds buyers *before* they are needed, so liquidations never hit the order book. Debt is capped by what the system can actually absorb. Collateral is valued at `min(PreStocks markPrice, DEX TWAP)` so a token trading at a discount is valued at the discount.

Built for the Stocklana hackathon: PreStocks collateral, Stability Pool liquidation, Pyth-ready oracle panel.

## Day-0 oracle decision (22 Sep 2026)

```
ANTHROPIC market class : restricted (pyth-indices key needed for Class A)
pyth feed id           : 0x5da511a7c68b17a3bc94380cab4756bc83ab87f86307af10ea58467a64b6689d
unit scale             : unknown (price data gated — cannot verify)
staleness limit        : 300s (enforced on posted prices)
max confidence         : untestable
TWAP source            : posted (Meteora DLMM ANTHROPIC/SOL $204k liq)
dex pool               : EZyszDEx1LZDt7TsSFV8xdPi49sDKC3mdfv2MVMEQLtU
initial depth          : $171,258 (171 tokens at ≤5% impact via Jupiter)
admin debt cap         : 25,000 USDC (restricted)
max LTV                : 30%
liquidation LTV        : 40%
```

`Equity.Index.ANTHROPIC/USD` exists on Hermes but is paywalled (`pyth-indices` group). The old push oracle has no live equity/index prices. Until a key upgrade, markets run **restricted**: posted PreStocks mark + posted DEX TWAP, LTV 25/35.

Script: `npx tsx scripts/verify-oracle.ts`

## Repo

```
programs/prelend   Anchor 1.1 program
app                Next.js dashboard + metadata API
scripts            oracle verification
DEPLOY.md          deploy + bootstrap
```

### Program instructions (target)

| Instruction | Who | What |
|---|---|---|
| `initialize_pool` | admin | GlobalConfig + risk params + USDC vault |
| `update_oracle` | admin/keeper | Post markPrice and/or DEX TWAP |
| `update_depth` | admin/keeper | Post Jupiter ≤5% impact depth |
| `deposit_liquidity` / `withdraw_liquidity` | lenders | USDC in/out of the lender vault |
| `borrow_usdc` | borrower | lock PreStocks, borrow ≤ max LTV, check debt cap |
| `repay_and_withdraw` | borrower | repay USDC + accrued interest, unlock collateral |
| `init_stability_pool` | admin | per-mint Stability Pool |
| `deposit_stability` | anyone | deposit USDC, receive shares |
| `request_withdrawal` / `claim_withdrawal` | depositor | cooldown then in-kind USDC + collateral |
| `liquidate` | anyone | partial seize, surplus to borrower, SP absorbs |
| `external_liquidate` | anyone | same math, liquidator pays USDC if SP is short |
| `claim_surplus_collateral` | borrower | withdraw leftover collateral after liquidation |
| `set_test_price` | admin | on-chain test-mode price override (devnet) |
| `set_paused` | admin | block new borrows (IPO / conversion window) |

Loan-health card metadata: `/api/nft/metadata?position=…&ltv=…&symbol=ANTHROPIC`.

Thresholds: Chad VC &lt; 30%, Anxious 30–35%, McPepe 35–40%, Rekt at 40% (liquidated).

Post-hackathon roadmap: [`../IMPROVEMENTS.md`](../IMPROVEMENTS.md).

## Run the demo

```bash
cd prelend/app
npm install
npm run dev
# open http://localhost:3000
```

Connect Phantom on the same cluster as `NEXT_PUBLIC_SOLANA_RPC_URL`. Default is **devnet**.

To make **Pool USDC** the on-chain `usdc-vault` balance, follow [`DEPLOY.md`](DEPLOY.md).

## Limitations (stated plainly)

- An empty Stability Pool with no external liquidator can still produce bad debt.
- Pyth pre-IPO indices exist but are gated; this build uses posted PreStocks mark + DEX TWAP.
- Depth measurement is trusted (posted by admin/keeper).
- Only two PreStocks assets have Pyth Index feeds (ANTHROPIC, OPENAI); neither is readable with a crypto-only key.
- The code is unaudited.

## Architecture

Lending, Stability Pool, and liquidation are the **same program**. Diagrams: [`ARCHITECTURE.md`](ARCHITECTURE.md). Change request: [`../doc1.md`](../doc1.md).
