use crate::constants::{BPS_DENOMINATOR, E18, SECONDS_PER_YEAR};
use crate::error::PreLendError;
use anchor_lang::prelude::*;

/// Convert a raw token amount into USDC base units (6 decimals) given a USD price with 6 decimals.
pub fn collateral_value_usdc(amount: u64, decimals: u8, price_e6: u64) -> Result<u64> {
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(PreLendError::MathOverflow)?;
    let value = (amount as u128)
        .checked_mul(price_e6 as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(scale)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PreLendError::MathOverflow.into())
}

/// LTV in basis points: debt / collateral_value * 10_000.
pub fn ltv_bps(debt_usdc: u64, collateral_value_usdc: u64) -> Result<u64> {
    require!(collateral_value_usdc > 0, PreLendError::MathOverflow);
    let bps = (debt_usdc as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(collateral_value_usdc as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(bps).map_err(|_| PreLendError::MathOverflow.into())
}

pub fn bps_of(amount: u64, bps: u16) -> Result<u64> {
    let value = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PreLendError::MathOverflow.into())
}

/// Simple interest: principal * rate_bps * elapsed / (10000 * seconds_per_year)
pub fn accrued_interest(principal: u64, rate_bps: u16, elapsed_secs: i64) -> Result<u64> {
    if principal == 0 || elapsed_secs <= 0 || rate_bps == 0 {
        return Ok(0);
    }
    let interest = (principal as u128)
        .checked_mul(rate_bps as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_mul(elapsed_secs as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div((BPS_DENOMINATOR as u128).saturating_mul(SECONDS_PER_YEAR as u128))
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(interest).map_err(|_| PreLendError::MathOverflow.into())
}

// ─── New index-based helpers ────────────────────────────────────────────────

/// Actual outstanding debt = scaled_debt × borrow_index / 1e18.
pub fn actual_debt(scaled_debt: u64, borrow_index_e18: u128) -> Result<u64> {
    if scaled_debt == 0 {
        return Ok(0);
    }
    let debt = (scaled_debt as u128)
        .checked_mul(borrow_index_e18)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(E18)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(debt).map_err(|_| PreLendError::MathOverflow.into())
}

/// Lender share mint: `amount * total_shares / pool_value`.
/// First depositor (no shares or empty pool) receives 1:1 shares.
pub fn shares_for_deposit(amount: u64, total_shares: u64, pool_value: u64) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    if total_shares == 0 || pool_value == 0 {
        return Ok(amount);
    }
    let shares = (amount as u128)
        .checked_mul(total_shares as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(pool_value as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(shares).map_err(|_| PreLendError::MathOverflow.into())
}

/// Redeem value of `shares` against `pool_value / total_shares`.
pub fn assets_from_shares(shares: u64, total_shares: u64, pool_value: u64) -> Result<u64> {
    if shares == 0 || total_shares == 0 {
        return Ok(0);
    }
    let assets = (shares as u128)
        .checked_mul(pool_value as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(assets).map_err(|_| PreLendError::MathOverflow.into())
}

/// Shares to burn for an `amount` withdrawal at the current exchange rate.
pub fn shares_for_withdraw(amount: u64, total_shares: u64, pool_value: u64) -> Result<u64> {
    if amount == 0 || total_shares == 0 || pool_value == 0 {
        return Ok(0);
    }
    let shares = (amount as u128)
        .checked_mul(total_shares as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(pool_value as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(shares).map_err(|_| PreLendError::MathOverflow.into())
}

/// Convert a nominal USDC amount into index-scaled units.
/// scaled = amount × 1e18 / borrow_index_e18.
pub fn scaled_amount(amount: u64, borrow_index_e18: u128) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let scaled = (amount as u128)
        .checked_mul(E18)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(borrow_index_e18)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(scaled).map_err(|_| PreLendError::MathOverflow.into())
}

/// Collateral to seize during liquidation.
/// seize = debt × (10000 + bonus_bps) × 10^decimals / (10000 × price_e6)
pub fn seize_amount(debt: u64, bonus_bps: u16, price_e6: u64, decimals: u8) -> Result<u64> {
    require!(price_e6 > 0, PreLendError::MathOverflow);
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(PreLendError::MathOverflow)?;
    let numerator = (debt as u128)
        .checked_mul((BPS_DENOMINATOR as u128) + (bonus_bps as u128))
        .ok_or(PreLendError::MathOverflow)?
        .checked_mul(scale)
        .ok_or(PreLendError::MathOverflow)?;
    let denominator = (BPS_DENOMINATOR as u128)
        .checked_mul(price_e6 as u128)
        .ok_or(PreLendError::MathOverflow)?;
    let seize = numerator
        .checked_div(denominator)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(seize).map_err(|_| PreLendError::MathOverflow.into())
}

/// Validate oracle freshness and return the effective price = min(mark, twap).
/// If `test_mode_price_e6 != 0` the test override is returned unconditionally.
pub fn oracle_price_valid(
    mark_price_e6: u64,
    twap_price_e6: u64,
    mark_updated_at: i64,
    twap_updated_at: i64,
    now: i64,
    staleness_secs: i64,
    test_mode_price_e6: u64,
) -> Result<u64> {
    if test_mode_price_e6 != 0 {
        return Ok(test_mode_price_e6);
    }
    require!(mark_price_e6 > 0, PreLendError::StaleOracle);
    require!(twap_price_e6 > 0, PreLendError::StaleOracle);
    require!(
        now.saturating_sub(mark_updated_at) <= staleness_secs,
        PreLendError::StaleOracle
    );
    require!(
        now.saturating_sub(twap_updated_at) <= staleness_secs,
        PreLendError::StaleOracle
    );
    Ok(std::cmp::min(mark_price_e6, twap_price_e6))
}

// ─── Stability pool product–sum (Liquity) ───────────────────────────────────

/// Compounded USDC remaining after offsets since the depositor's snapshot.
pub fn sp_compounded_usdc(
    initial_usdc: u64,
    snapshot_p_e18: u128,
    snapshot_epoch: u64,
    p_e18: u128,
    epoch: u64,
) -> Result<u64> {
    if initial_usdc == 0 || snapshot_p_e18 == 0 {
        return Ok(0);
    }
    if snapshot_epoch != epoch {
        return Ok(0);
    }
    let value = (initial_usdc as u128)
        .checked_mul(p_e18)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(snapshot_p_e18)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PreLendError::MathOverflow.into())
}

/// Collateral earned from liquidations after the depositor's snapshot (not including `pending`).
pub fn sp_collateral_gain(
    initial_usdc: u64,
    snapshot_p_e18: u128,
    snapshot_s_e18: u128,
    snapshot_epoch: u64,
    s_e18: u128,
    epoch: u64,
    prev_s_e18: u128,
    prev_epoch: u64,
) -> Result<u64> {
    if initial_usdc == 0 || snapshot_p_e18 == 0 {
        return Ok(0);
    }
    let (s, matched) = if snapshot_epoch == epoch {
        (s_e18, true)
    } else if snapshot_epoch == prev_epoch {
        (prev_s_e18, true)
    } else {
        (0, false)
    };
    if !matched || s <= snapshot_s_e18 {
        return Ok(0);
    }
    let value = (initial_usdc as u128)
        .checked_mul(s.saturating_sub(snapshot_s_e18))
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(snapshot_p_e18)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PreLendError::MathOverflow.into())
}

/// Apply a liquidation offset: burn `debt` USDC from the pool and credit `seize` collateral to S.
/// Returns the remaining snapshot-bucket USDC.
pub fn sp_apply_offset(
    total_usdc: u64,
    p_e18: u128,
    s_e18: u128,
    epoch: u64,
    debt: u64,
    seize: u64,
) -> Result<(u64, u128, u128, u64, u128, u64)> {
    require!(total_usdc > 0, PreLendError::StabilityPoolInsufficient);
    require!(total_usdc >= debt, PreLendError::StabilityPoolInsufficient);
    let p = if p_e18 == 0 { E18 } else { p_e18 };
    let add_s = (seize as u128)
        .checked_mul(p)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(total_usdc as u128)
        .ok_or(PreLendError::MathOverflow)?;
    let s_new = s_e18
        .checked_add(add_s)
        .ok_or(PreLendError::MathOverflow)?;
    let remaining = total_usdc.saturating_sub(debt);
    if remaining == 0 {
        return Ok((0, E18, 0, epoch.saturating_add(1), s_new, epoch));
    }
    let p_new = p
        .checked_mul(remaining as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(total_usdc as u128)
        .ok_or(PreLendError::MathOverflow)?;
    let p_new = if p_new == 0 { 1 } else { p_new };
    Ok((remaining, p_new, s_new, epoch, 0, 0))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_one_whole_token() {
        let value = collateral_value_usdc(1_000_000, 6, 100_000_000).unwrap();
        assert_eq!(value, 100_000_000);
    }

    #[test]
    fn fifty_percent_ltv_is_5000_bps() {
        let value = collateral_value_usdc(2_000_000, 6, 100_000_000).unwrap();
        let ltv = ltv_bps(100_000_000, value).unwrap();
        assert_eq!(ltv, 5_000);
    }

    #[test]
    fn origination_fee() {
        assert_eq!(bps_of(1_000_000, 50).unwrap(), 5_000);
    }

    #[test]
    fn one_year_eight_percent() {
        let interest = accrued_interest(1_000_000, 800, SECONDS_PER_YEAR as i64).unwrap();
        assert_eq!(interest, 80_000);
    }

    #[test]
    fn scaled_debt_roundtrip() {
        let index = E18;
        let amount = 1_000_000u64;
        let scaled = scaled_amount(amount, index).unwrap();
        assert_eq!(scaled, amount);
        let actual = actual_debt(scaled, index).unwrap();
        assert_eq!(actual, amount);
    }

    #[test]
    fn actual_debt_with_accrued_interest() {
        let index = E18 + E18 / 10; // 1.1e18 → 10 % accrued
        let scaled = 1_000_000u64;
        let actual = actual_debt(scaled, index).unwrap();
        assert_eq!(actual, 1_100_000);
    }

    #[test]
    fn seize_with_ten_pct_bonus() {
        // debt 100 USDC, price $10, 6 dec, 10 % bonus → 11 tokens
        let seize = seize_amount(100_000_000, 1_000, 10_000_000, 6).unwrap();
        assert_eq!(seize, 11_000_000);
    }

    #[test]
    fn oracle_test_mode_override() {
        let price = oracle_price_valid(0, 0, 0, 0, 100, 300, 42_000_000).unwrap();
        assert_eq!(price, 42_000_000);
    }

    #[test]
    fn oracle_returns_min() {
        let price =
            oracle_price_valid(50_000_000, 40_000_000, 100, 100, 100, 300, 0).unwrap();
        assert_eq!(price, 40_000_000);
    }

    #[test]
    fn first_lender_is_one_to_one() {
        assert_eq!(shares_for_deposit(5_000_000, 0, 0).unwrap(), 5_000_000);
    }

    #[test]
    fn later_lender_pays_accrued_rate() {
        // Pool is $110 of assets on 100 shares after interest lands.
        let shares = shares_for_deposit(11_000_000, 100_000_000, 110_000_000).unwrap();
        assert_eq!(shares, 10_000_000);
        assert_eq!(
            assets_from_shares(100_000_000, 110_000_000, 121_000_000).unwrap(),
            110_000_000
        );
    }

    #[test]
    fn sp_offset_splits_collateral_only_to_incumbents() {
        // $30k in pool, $5k depositor (1/6). Offset $29,798, seize 53.89e9 atoms.
        let total = 30_000_000_000u64;
        let (remaining, p, s, epoch, prev_s, prev_epoch) =
            sp_apply_offset(total, E18, 0, 0, 29_798_010_000, 53_893_698_409).unwrap();
        assert_eq!(remaining, 201_990_000);
        assert_eq!(epoch, 0);
        assert_eq!(prev_s, 0);
        assert_eq!(prev_epoch, 0);
        let five_k = 5_000_000_000u64;
        let left = sp_compounded_usdc(five_k, E18, 0, p, epoch).unwrap();
        let gain = sp_collateral_gain(five_k, E18, 0, 0, s, epoch, prev_s, prev_epoch).unwrap();
        assert!((left as i64 - 33_665_000).abs() < 2_000);
        assert!((gain as i64 - 8_982_283_068).abs() < 5_000);
        // Late $100 deposit is a new initial at current P/S — no past gain.
        let late = sp_collateral_gain(100_000_000, p, s, epoch, s, epoch, prev_s, prev_epoch).unwrap();
        assert_eq!(late, 0);
    }

    #[test]
    fn sp_empty_pool_wipes_usdc_keeps_gain_on_prev_s() {
        let (remaining, p, s, epoch, prev_s, prev_epoch) =
            sp_apply_offset(1_000_000, E18, 0, 0, 1_000_000, 50).unwrap();
        assert_eq!(remaining, 0);
        assert_eq!(p, E18);
        assert_eq!(s, 0);
        assert_eq!(epoch, 1);
        let gain = sp_collateral_gain(1_000_000, E18, 0, 0, s, epoch, prev_s, prev_epoch).unwrap();
        assert_eq!(gain, 50);
        assert_eq!(
            sp_compounded_usdc(1_000_000, E18, 0, p, epoch).unwrap(),
            0
        );
    }
}
