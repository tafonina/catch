use anchor_lang::prelude::*;

// ─── Risk parameters (per-market, stored inside GlobalConfig) ───────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RiskParams {
    /// Max LTV at which a new borrow is allowed (e.g. 3000 = 30 %).
    pub max_borrow_ltv_bps: u16,
    /// LTV at which a position becomes liquidatable (e.g. 4000 = 40 %).
    pub liquidation_ltv_bps: u16,
    /// Bonus awarded to the stability pool on liquidation (e.g. 1000 = 10 %).
    pub liquidation_bonus_bps: u16,
    /// Annual interest rate in bps (e.g. 1200 = 12 % APR).
    pub interest_rate_bps: u16,
    /// Admin-set absolute debt ceiling (USDC base units, 6 decimals).
    pub admin_debt_cap: u64,
    /// Maximum age (seconds) for an oracle price to be considered fresh.
    pub price_staleness_secs: i64,
    /// 0 = restricted, 1 = class A.
    pub market_class: u8,
}

// ─── Global config ──────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_recipient: Pubkey,
    pub protocol_fee_bps: u16,
    pub total_deposits: u64,
    pub total_borrowed: u64,
    pub risk_params: RiskParams,
    /// Borrow index for interest accrual, starts at 1e18.
    pub borrow_index_e18: u128,
    pub last_accrual_ts: i64,
    /// External order-book depth posted by admin (USDC base units).
    pub posted_depth: u64,
    /// Non-zero ⇒ override all oracle reads (test-mode).
    pub test_mode_price_e6: u64,
    /// When true, new borrows are blocked.
    pub paused: bool,
    pub bump: u8,
    pub usdc_vault_bump: u8,
}

impl GlobalConfig {
    /// Advance `borrow_index_e18` to `now`, compounding interest.
    pub fn accrue_interest(&mut self, now: i64) -> anchor_lang::Result<()> {
        let elapsed = now.saturating_sub(self.last_accrual_ts);
        if elapsed <= 0 {
            return Ok(());
        }
        let rate_bps = self.risk_params.interest_rate_bps;
        if rate_bps == 0 {
            self.last_accrual_ts = now;
            return Ok(());
        }
        let denom = (crate::constants::BPS_DENOMINATOR as u128)
            .checked_mul(crate::constants::SECONDS_PER_YEAR as u128)
            .ok_or(crate::error::PreLendError::MathOverflow)?;
        let delta = self
            .borrow_index_e18
            .checked_mul(rate_bps as u128)
            .ok_or(crate::error::PreLendError::MathOverflow)?
            .checked_mul(elapsed as u128)
            .ok_or(crate::error::PreLendError::MathOverflow)?
            .checked_div(denom)
            .ok_or(crate::error::PreLendError::MathOverflow)?;
        self.borrow_index_e18 = self
            .borrow_index_e18
            .checked_add(delta)
            .ok_or(crate::error::PreLendError::MathOverflow)?;
        self.last_accrual_ts = now;
        Ok(())
    }
}

// ─── User position ──────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    /// Original nominal borrow (for reference / events).
    pub usdc_amount: u64,
    /// Debt expressed in index units: `usdc_amount * 1e18 / borrow_index` at borrow time.
    pub scaled_debt: u64,
    /// Surplus collateral credited after liquidation, claimable by the borrower.
    pub borrower_claimable_collateral: u64,
    pub last_accrued_ts: i64,
    pub status: PositionStatus,
    pub bump: u8,
}

// ─── Lender ─────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct LenderAccount {
    pub owner: Pubkey,
    /// Pool shares. Exchange rate = (vault cash + outstanding principal) / total_deposits.
    pub deposited: u64,
    pub bump: u8,
}

// ─── Oracle ─────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct OraclePrice {
    pub mint: Pubkey,
    /// Price posted from the PreStocks API (6 decimal places).
    pub mark_price_e6: u64,
    /// Price derived from a DEX TWAP (6 decimal places).
    pub twap_price_e6: u64,
    pub mark_updated_at: i64,
    pub twap_updated_at: i64,
    pub bump: u8,
}

// ─── Stability pool (Liquity product–sum snapshots) ─────────────────────────

#[account]
#[derive(InitSpace)]
pub struct StabilityPool {
    pub version: u8,
    /// Compounded USDC still in the snapshot bucket (after offsets).
    pub total_usdc: u64,
    pub collateral_mint: Pubkey,
    /// Unclaimed seized collateral attributed via S (plus migrated pending).
    pub collateral_held: u64,
    /// Product P (1e18). Compounded deposit = initial * P / P_t.
    pub p_e18: u128,
    /// Sum S. Collateral gain = initial * (S - S_t) / P_t.
    pub s_e18: u128,
    pub epoch: u64,
    /// S of the epoch that just emptied, so wiped depositors can still claim.
    pub prev_s_e18: u128,
    pub prev_epoch: u64,
    /// Share-era leftovers until each old deposit is migrated.
    pub legacy_usdc: u64,
    pub legacy_coll: u64,
    pub legacy_shares: u64,
    pub bump: u8,
}

impl StabilityPool {
    pub fn available_usdc(&self) -> u64 {
        self.total_usdc.saturating_add(self.legacy_usdc)
    }
}

#[account]
#[derive(InitSpace)]
pub struct StabilityDeposit {
    pub depositor: Pubkey,
    pub pool: Pubkey,
    /// Deposit size at the last snapshot (Liquity `initialValue`).
    pub initial_usdc: u64,
    pub snapshot_p_e18: u128,
    pub snapshot_s_e18: u128,
    pub snapshot_epoch: u64,
    /// Collateral already compounded but not yet transferred out.
    pub pending_collateral: u64,
    pub bump: u8,
}

// ─── Enums ──────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionStatus {
    Active,
    Liquidated,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_account_sizes() {
        assert_eq!(8 + StabilityPool::INIT_SPACE, 146);
        assert_eq!(8 + StabilityDeposit::INIT_SPACE, 129);
    }
}
