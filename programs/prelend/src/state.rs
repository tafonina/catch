use crate::constants::*;
use crate::error::PreLendError;
use crate::risk::RiskParams;
use anchor_lang::prelude::*;

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
    pub borrow_index_e18: u128,
    pub last_accrual_ts: i64,
    /// Unused in v1.2 (ceiling is the bid book only). Kept for the optional depth term.
    pub posted_depth: u64,
    pub test_mode_price_e6: u64,
    pub paused: bool,
    pub bump: u8,
    pub usdc_vault_bump: u8,
    /// vault cash + outstanding principal, for utilization without re-reading the vault.
    pub senior_assets: u64,
    /// Slice of the senior vault reserved for bad debt (accounting).
    pub reserve_usdc: u64,
    /// Isolated market id: one pre-IPO mint per config / senior vault / book.
    pub collateral_mint: Pubkey,
}

impl GlobalConfig {
    pub fn accrue_interest(&mut self, now: i64) -> Result<()> {
        let elapsed = now.saturating_sub(self.last_accrual_ts);
        if elapsed <= 0 {
            return Ok(());
        }
        let senior = self.senior_assets.max(1);
        let u_e18 = (self.total_borrowed as u128)
            .saturating_mul(E18)
            .checked_div(senior as u128)
            .unwrap_or(0);
        let rate_bps = crate::math::borrow_rate_bps(u_e18, &self.risk_params)?;
        if rate_bps == 0 {
            self.last_accrual_ts = now;
            return Ok(());
        }
        let denom = (BPS_DENOMINATOR as u128)
            .checked_mul(SECONDS_PER_YEAR as u128)
            .ok_or(PreLendError::MathOverflow)?;
        let delta = self
            .borrow_index_e18
            .checked_mul(rate_bps as u128)
            .ok_or(PreLendError::MathOverflow)?
            .checked_mul(elapsed as u128)
            .ok_or(PreLendError::MathOverflow)?
            .checked_div(denom)
            .ok_or(PreLendError::MathOverflow)?;
        self.borrow_index_e18 = self
            .borrow_index_e18
            .checked_add(delta)
            .ok_or(PreLendError::MathOverflow)?;
        self.last_accrual_ts = now;
        Ok(())
    }

    pub fn current_rate_bps(&self) -> Result<u16> {
        let senior = self.senior_assets.max(1);
        let u_e18 = (self.total_borrowed as u128)
            .saturating_mul(E18)
            .checked_div(senior as u128)
            .unwrap_or(0);
        crate::math::borrow_rate_bps(u_e18, &self.risk_params)
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub usdc_amount: u64,
    pub scaled_debt: u64,
    pub borrower_claimable_collateral: u64,
    pub last_accrued_ts: i64,
    pub status: PositionStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LenderAccount {
    pub owner: Pubkey,
    pub deposited: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct OraclePrice {
    pub mint: Pubkey,
    pub mark_price_e6: u64,
    pub twap_price_e6: u64,
    pub mark_updated_at: i64,
    pub twap_updated_at: i64,
    pub bump: u8,
}

/// Isolated bid book: ceiling = sum of locked yNFT USDC.
#[account]
#[derive(InitSpace)]
pub struct StabilityPool {
    pub version: u8,
    pub total_usdc: u64,
    pub collateral_mint: Pubkey,
    pub collateral_held: u64,
    pub bid_count: u8,
    pub owners: [Pubkey; MAX_BIDS],
    pub bid_usdc: [u64; MAX_BIDS],
    pub discount_bps: [u16; MAX_BIDS],
    pub locked_at: [i64; MAX_BIDS],
    pub bid_yield: [u64; MAX_BIDS],
    pub bump: u8,
}

impl StabilityPool {
    pub fn available_usdc(&self) -> u64 {
        self.total_usdc
    }

    pub fn min_discount_bps(&self) -> u16 {
        if self.bid_count == 0 {
            return 0;
        }
        self.discount_bps[0]
    }

    pub fn insert_bid(
        &mut self,
        owner: Pubkey,
        usdc: u64,
        discount_bps: u16,
        ts: i64,
    ) -> Result<u8> {
        require!(usdc > 0, PreLendError::ZeroAmount);
        if let Some(i) = self.find_owner(owner) {
            require!(
                self.discount_bps[i as usize] == discount_bps,
                PreLendError::BidDiscountMismatch
            );
            self.bid_usdc[i as usize] = self.bid_usdc[i as usize]
                .checked_add(usdc)
                .ok_or(PreLendError::MathOverflow)?;
            self.total_usdc = self
                .total_usdc
                .checked_add(usdc)
                .ok_or(PreLendError::MathOverflow)?;
            return Ok(i);
        }
        require!((self.bid_count as usize) < MAX_BIDS, PreLendError::BidBookFull);
        let mut idx = self.bid_count as usize;
        for i in 0..self.bid_count as usize {
            if crate::math::bid_before(discount_bps, ts, self.discount_bps[i], self.locked_at[i]) {
                idx = i;
                break;
            }
        }
        let n = self.bid_count as usize;
        for j in (idx..n).rev() {
            self.owners[j + 1] = self.owners[j];
            self.bid_usdc[j + 1] = self.bid_usdc[j];
            self.discount_bps[j + 1] = self.discount_bps[j];
            self.locked_at[j + 1] = self.locked_at[j];
            self.bid_yield[j + 1] = self.bid_yield[j];
        }
        self.owners[idx] = owner;
        self.bid_usdc[idx] = usdc;
        self.discount_bps[idx] = discount_bps;
        self.locked_at[idx] = ts;
        self.bid_yield[idx] = 0;
        self.bid_count += 1;
        self.total_usdc = self
            .total_usdc
            .checked_add(usdc)
            .ok_or(PreLendError::MathOverflow)?;
        Ok(idx as u8)
    }

    pub fn find_owner(&self, owner: Pubkey) -> Option<u8> {
        (0..self.bid_count as usize).find(|&i| self.owners[i] == owner).map(|i| i as u8)
    }

    pub fn engaged_usdc(&self, idx: usize, needed: u64) -> u64 {
        let mut covered = 0u64;
        for i in 0..idx.min(self.bid_count as usize) {
            covered = covered.saturating_add(self.bid_usdc[i]);
        }
        if covered >= needed {
            0
        } else {
            needed.saturating_sub(covered).min(self.bid_usdc[idx])
        }
    }

    pub fn credit_lock_yield(&mut self, junior: u64, needed: u64) -> Result<()> {
        if junior == 0 || needed == 0 {
            return Ok(());
        }
        let mut left = junior;
        for i in 0..self.bid_count as usize {
            let eng = self.engaged_usdc(i, needed);
            if eng == 0 {
                continue;
            }
            let cut = (junior as u128)
                .saturating_mul(eng as u128)
                .checked_div(needed as u128)
                .unwrap_or(0) as u64;
            let cut = cut.min(left);
            self.bid_yield[i] = self.bid_yield[i].saturating_add(cut);
            left = left.saturating_sub(cut);
        }
        if left > 0 && self.bid_count > 0 {
            let i = 0usize;
            self.bid_yield[i] = self.bid_yield[i].saturating_add(left);
        }
        Ok(())
    }

    pub fn remove_usdc(&mut self, idx: usize, amount: u64) -> Result<()> {
        require!(idx < self.bid_count as usize, PreLendError::Unauthorized);
        require!(self.bid_usdc[idx] >= amount, PreLendError::InsufficientDeposits);
        self.bid_usdc[idx] -= amount;
        self.total_usdc = self.total_usdc.saturating_sub(amount);
        if self.bid_usdc[idx] == 0 {
            let n = self.bid_count as usize;
            for j in idx..n.saturating_sub(1) {
                self.owners[j] = self.owners[j + 1];
                self.bid_usdc[j] = self.bid_usdc[j + 1];
                self.discount_bps[j] = self.discount_bps[j + 1];
                self.locked_at[j] = self.locked_at[j + 1];
                self.bid_yield[j] = self.bid_yield[j + 1];
            }
            let last = n.saturating_sub(1);
            self.owners[last] = Pubkey::default();
            self.bid_usdc[last] = 0;
            self.discount_bps[last] = 0;
            self.locked_at[last] = 0;
            self.bid_yield[last] = 0;
            self.bid_count = self.bid_count.saturating_sub(1);
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct StabilityDeposit {
    pub depositor: Pubkey,
    pub pool: Pubkey,
    pub discount_bps: u16,
    pub initial_usdc: u64,
    pub pending_collateral: u64,
    pub yield_usdc: u64,
    pub locked_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionStatus {
    Active,
    Liquidated,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_inserts_price_then_time() {
        let mut book = StabilityPool {
            version: BID_BOOK_VERSION,
            total_usdc: 0,
            collateral_mint: Pubkey::default(),
            collateral_held: 0,
            bid_count: 0,
            owners: [Pubkey::default(); MAX_BIDS],
            bid_usdc: [0; MAX_BIDS],
            discount_bps: [0; MAX_BIDS],
            locked_at: [0; MAX_BIDS],
            bid_yield: [0; MAX_BIDS],
            bump: 0,
        };
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let c = Pubkey::new_unique();
        book.insert_bid(a, 4_000, 1_000, 20).unwrap();
        book.insert_bid(b, 20_000, 2_500, 10).unwrap();
        book.insert_bid(c, 3_000, 1_000, 10).unwrap();
        assert_eq!(book.owners[0], c);
        assert_eq!(book.owners[1], a);
        assert_eq!(book.owners[2], b);
        assert_eq!(book.engaged_usdc(0, 5_000), 3_000);
        assert_eq!(book.engaged_usdc(1, 5_000), 2_000);
        assert_eq!(book.engaged_usdc(2, 5_000), 0);
    }
}
