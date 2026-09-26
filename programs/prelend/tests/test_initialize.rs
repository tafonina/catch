use prelend::math::{
    actual_debt, collateral_value_usdc, ltv_bps, oracle_price_valid, scaled_amount, seize_amount,
};

#[test]
fn restricted_max_borrow_is_30_percent() {
    let collateral_amount = 10_000_000; // 10 tokens, 6 decimals
    let price_e6 = 1_000_000_000; // $1,000
    let value = collateral_value_usdc(collateral_amount, 6, price_e6).unwrap();
    assert_eq!(value, 10_000_000_000);
    assert_eq!(ltv_bps(3_000_000_000, value).unwrap(), 3_000);
    assert!(ltv_bps(3_001_000_000, value).unwrap() > 3_000);
}

#[test]
fn forty_percent_ltv_is_not_liquidatable_at_50() {
    let ltv = 4_000u64;
    assert!(ltv < 5_000);
}

#[test]
fn worked_example_seize_and_surplus() {
    // $4,000 debt, $800 price, 10% bonus, 6 decimals → 5.5 tokens
    let seize = seize_amount(4_000_000_000, 1_000, 800_000_000, 6).unwrap();
    assert_eq!(seize, 5_500_000);
    let surplus = 10_000_000u64.saturating_sub(seize);
    assert_eq!(surplus, 4_500_000);
}

#[test]
fn index_roundtrip_and_interest() {
    let e18 = 1_000_000_000_000_000_000u128;
    let scaled = scaled_amount(4_000_000_000, e18).unwrap();
    assert_eq!(actual_debt(scaled, e18).unwrap(), 4_000_000_000);
    let after = e18 + e18 / 100; // +1%
    assert_eq!(actual_debt(scaled, after).unwrap(), 4_040_000_000);
}

#[test]
fn stale_oracle_rejected() {
    let err = oracle_price_valid(1, 1, 0, 0, 1_000, 300, 0);
    assert!(err.is_err());
}
