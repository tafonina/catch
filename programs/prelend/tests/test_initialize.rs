use prelend::math::{
    actual_debt, borrow_rate_bps, collateral_value_usdc, ltv_bps, oracle_price_valid,
    scaled_amount, split_interest, tokens_at_discount,
};
use prelend::risk::RiskParams;

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
fn restricted_max_borrow_is_30_percent() {
    let collateral_amount = 10_000_000;
    let price_e6 = 1_000_000_000;
    let value = collateral_value_usdc(collateral_amount, 6, price_e6).unwrap();
    assert_eq!(value, 10_000_000_000);
    assert_eq!(ltv_bps(3_000_000_000, value).unwrap(), 3_000);
}

#[test]
fn kinked_curve_and_scarcity_split() {
    let p = demo_params();
    let e18 = 1_000_000_000_000_000_000u128;
    assert_eq!(borrow_rate_bps(e18 * 8 / 10, &p).unwrap(), 1_500);
    let (res, sen, jun) = split_interest(
        12_000_000_000,
        80_000_000_000,
        100_000_000_000,
        300_000_000_000,
        &p,
    )
    .unwrap();
    assert_eq!(res, 1_200_000_000);
    assert!((sen as i64 - 8_100_000_000).abs() < 20_000_000);
    assert!((jun as i64 - 2_700_000_000).abs() < 20_000_000);
}

#[test]
fn bid_discount_fill() {
    let tokens = tokens_at_discount(4_000_000_000, 1_000, 1_000_000_000, 6).unwrap();
    assert_eq!(tokens, 4_444_444);
}

#[test]
fn index_roundtrip_and_interest() {
    let e18 = 1_000_000_000_000_000_000u128;
    let scaled = scaled_amount(4_000_000_000, e18).unwrap();
    assert_eq!(actual_debt(scaled, e18).unwrap(), 4_000_000_000);
}

#[test]
fn stale_oracle_rejected() {
    assert!(oracle_price_valid(1, 1, 0, 0, 1_000, 300, 0).is_err());
}
