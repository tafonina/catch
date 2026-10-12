use crate::constants::{BPS_DENOMINATOR, E18, SECONDS_PER_YEAR};
use crate::error::PreLendError;
use crate::risk::RiskParams;
use anchor_lang::prelude::*;

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

/// Tokens bought with `usdc` at `mark * (1 - discount)`.
pub fn tokens_at_discount(
    usdc: u64,
    discount_bps: u16,
    price_e6: u64,
    decimals: u8,
) -> Result<u64> {
    require!(price_e6 > 0, PreLendError::MathOverflow);
    let bid_price = (price_e6 as u128)
        .checked_mul((BPS_DENOMINATOR - discount_bps as u64) as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?;
    require!(bid_price > 0, PreLendError::MathOverflow);
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(PreLendError::MathOverflow)?;
    let tokens = (usdc as u128)
        .checked_mul(scale)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(bid_price)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(tokens).map_err(|_| PreLendError::MathOverflow.into())
}

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

pub fn spread_bps(mark: u64, twap: u64) -> Result<u64> {
    if mark == 0 {
        return Ok(0);
    }
    let hi = mark.max(twap);
    let lo = mark.min(twap);
    let bps = (hi.saturating_sub(lo) as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(mark as u128)
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(bps).map_err(|_| PreLendError::MathOverflow.into())
}

pub fn assert_spread_ok(mark: u64, twap: u64, min_discount_bps: u16, test_mode: u64) -> Result<()> {
    if test_mode != 0 || min_discount_bps == 0 {
        return Ok(());
    }
    require!(
        spread_bps(mark, twap)? <= min_discount_bps as u64,
        PreLendError::SpreadPause
    );
    Ok(())
}

/// Lower discount first, then earlier lock.
pub fn bid_before(d1: u16, t1: i64, d2: u16, t2: i64) -> bool {
    d1 < d2 || (d1 == d2 && t1 < t2)
}

pub fn borrow_rate_bps(u_senior_e18: u128, p: &RiskParams) -> Result<u16> {
    let kink = (p.kink_util_bps as u128)
        .checked_mul(E18)
        .ok_or(PreLendError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    if u_senior_e18 <= kink {
        if kink == 0 {
            return Ok(p.base_rate_bps);
        }
        let span = (p.kink_rate_bps as u128).saturating_sub(p.base_rate_bps as u128);
        let extra = u_senior_e18
            .checked_mul(span)
            .ok_or(PreLendError::MathOverflow)?
            .checked_div(kink)
            .ok_or(PreLendError::MathOverflow)?;
        let rate = (p.base_rate_bps as u128).saturating_add(extra);
        return u16::try_from(rate.min(u16::MAX as u128)).map_err(|_| PreLendError::MathOverflow.into());
    }
    let one = E18;
    let above = u_senior_e18.min(one).saturating_sub(kink);
    let den = one.saturating_sub(kink).max(1);
    let span = (p.max_rate_bps as u128).saturating_sub(p.kink_rate_bps as u128);
    let extra = above
        .checked_mul(span)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(den)
        .ok_or(PreLendError::MathOverflow)?;
    let rate = (p.kink_rate_bps as u128).saturating_add(extra);
    u16::try_from(rate.min(u16::MAX as u128)).map_err(|_| PreLendError::MathOverflow.into())
}

pub fn interest_headroom(debt: u64, rate_bps: u16, secs: i64) -> Result<u64> {
    if debt == 0 || rate_bps == 0 || secs <= 0 {
        return Ok(0);
    }
    let value = (debt as u128)
        .checked_mul(rate_bps as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_mul(secs as u128)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div((BPS_DENOMINATOR as u128).saturating_mul(SECONDS_PER_YEAR as u128))
        .ok_or(PreLendError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PreLendError::MathOverflow.into())
}

/// Returns (reserve, senior, junior) cuts of `gross` interest.
pub fn split_interest(gross: u64, d_active: u64, s_total: u64, j_total: u64, p: &RiskParams) -> Result<(u64, u64, u64)> {
    if gross == 0 {
        return Ok((0, 0, 0));
    }
    let reserve = bps_of(gross, p.reserve_factor_bps)?;
    let net = gross.saturating_sub(reserve);
    if net == 0 || d_active == 0 {
        return Ok((reserve, net, 0));
    }
    let s = s_total.max(1);
    let j = j_total.max(1);
    let u_s = (d_active as u128).saturating_mul(E18) / s as u128;
    let u_j = (d_active as u128).saturating_mul(E18) / j as u128;
    let den = u_s.saturating_add(u_j).max(1);
    let scarcity = (net as u128)
        .checked_mul(u_s)
        .ok_or(PreLendError::MathOverflow)?
        .checked_div(den)
        .ok_or(PreLendError::MathOverflow)?;
    let floor = bps_of(net, p.senior_floor_bps)?.min(net);
    let senior = (scarcity as u64).max(floor).min(net);
    let junior = net.saturating_sub(senior);
    Ok((reserve, senior, junior))
}

/// USDC to repay so remaining LTV ≤ target if collateral is sold at `discount`.
pub fn repay_to_target(
    debt: u64,
    collat_value: u64,
    target_ltv_bps: u16,
    discount_bps: u16,
) -> Result<u64> {
    if collat_value == 0 {
        return Ok(debt);
    }
    let ltv = ltv_bps(debt, collat_value)?;
    if ltv <= target_ltv_bps as u64 {
        return Ok(0);
    }
    let t = target_ltv_bps as u128;
    let live = (BPS_DENOMINATOR - discount_bps as u64) as u128;
    // (D-R) / (C - R / live_frac) = T/10000
    // D - T*C/10000 = R * (1 - T/(10000*live_frac))
    let tc = (t.checked_mul(collat_value as u128).ok_or(PreLendError::MathOverflow)?)
        / BPS_DENOMINATOR as u128;
    let num = (debt as u128).saturating_sub(tc);
    let t_over = t
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?
        / live.max(1);
    let coeff_num = (BPS_DENOMINATOR as u128).saturating_sub(t_over.min(BPS_DENOMINATOR as u128));
    if coeff_num == 0 {
        return Ok(debt);
    }
    let repay = num
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(PreLendError::MathOverflow)?
        / coeff_num;
    Ok(u64::try_from(repay).unwrap_or(debt).min(debt))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_params() -> RiskParams {
        RiskParams {
            max_borrow_ltv_bps: 3_000,
            liquidation_ltv_bps: 4_000,
            target_ltv_bps: 3_000,
            base_rate_bps: 1_000,
            kink_util_bps: 8_000,
            kink_rate_bps: 1_500,
            max_rate_bps: 3_000,
            reserve_factor_bps: 1_000,
            senior_floor_bps: 500,
            interest_headroom_secs: 7 * 86_400,
            price_staleness_secs: 300,
            keeper_fee_usdc: 0,
            dust_usdc: 1_000_000,
            market_class: 0,
        }
    }

    #[test]
    fn kink_at_eighty_is_fifteen() {
        let p = demo_params();
        let u = E18 * 8 / 10;
        assert_eq!(borrow_rate_bps(u, &p).unwrap(), 1_500);
        assert_eq!(borrow_rate_bps(E18, &p).unwrap(), 3_000);
    }

    #[test]
    fn spec_split_pre_spacex() {
        let p = demo_params();
        // 15% on $80k for a year = $12,000 gross
        let (res, sen, jun) = split_interest(12_000_000_000, 80_000_000_000, 100_000_000_000, 300_000_000_000, &p).unwrap();
        assert_eq!(res, 1_200_000_000);
        assert!((sen as i64 - 8_100_000_000).abs() < 20_000_000);
        assert!((jun as i64 - 2_700_000_000).abs() < 20_000_000);
    }

    #[test]
    fn tokens_ten_pct_discount() {
        // $4,000 at $1,000 mark, 10% → $900/token → 4.444… tokens (6 dec)
        let t = tokens_at_discount(4_000_000_000, 1_000, 1_000_000_000, 6).unwrap();
        assert_eq!(t, 4_444_444);
    }
}
