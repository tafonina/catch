use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    /// CHECK: original borrower, used as PDA seed only.
    pub borrower: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [ORACLE_SEED, collateral_mint.key().as_ref()],
        bump = oracle.bump,
        constraint = oracle.mint == collateral_mint.key(),
    )]
    pub oracle: Box<Account<'info, OraclePrice>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        constraint = position.borrower == borrower.key() @ PreLendError::Unauthorized,
        has_one = collateral_mint,
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
        constraint = stability_pool.version == BID_BOOK_VERSION @ PreLendError::MintNotAdmitted,
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
    )]
    pub sp_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = usdc_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program,
    )]
    pub caller_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_liquidate(ctx: Context<Liquidate>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Active,
        PreLendError::InvalidPositionStatus
    );

    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    let price = crate::math::oracle_price_valid(
        ctx.accounts.oracle.mark_price_e6,
        ctx.accounts.oracle.twap_price_e6,
        ctx.accounts.oracle.mark_updated_at,
        ctx.accounts.oracle.twap_updated_at,
        now,
        ctx.accounts.config.risk_params.price_staleness_secs,
        ctx.accounts.config.test_mode_price_e6,
    )?;
    crate::math::assert_spread_ok(
        ctx.accounts.oracle.mark_price_e6,
        ctx.accounts.oracle.twap_price_e6,
        ctx.accounts.stability_pool.min_discount_bps(),
        ctx.accounts.config.test_mode_price_e6,
    )?;

    let mut debt = crate::math::actual_debt(
        ctx.accounts.position.scaled_debt,
        ctx.accounts.config.borrow_index_e18,
    )?;
    let mut collat = ctx.accounts.position.collateral_amount;
    let decimals = ctx.accounts.collateral_mint.decimals;
    let mut value = crate::math::collateral_value_usdc(collat, decimals, price)?;
    let ltv = crate::math::ltv_bps(debt, value)?;
    require!(
        ltv >= ctx.accounts.config.risk_params.liquidation_ltv_bps as u64,
        PreLendError::PositionStillHealthy
    );

    let pool_key = ctx.accounts.stability_pool.key();
    let mint_key = ctx.accounts.collateral_mint.key();
    let bids_needed = ctx.accounts.stability_pool.bid_count as usize;
    require!(
        ctx.remaining_accounts.len() >= bids_needed,
        PreLendError::BidOrderInvalid
    );

    let mut repaid = 0u64;
    let mut seized = 0u64;
    let target = ctx.accounts.config.risk_params.target_ltv_bps;
    let dust = ctx.accounts.config.risk_params.dust_usdc;
    let insolvent = value < debt;

    for i in 0..bids_needed {
        if !insolvent {
            value = crate::math::collateral_value_usdc(collat, decimals, price)?;
            if value > 0 && crate::math::ltv_bps(debt, value)? <= target as u64 {
                break;
            }
        }
        if ctx.accounts.stability_pool.bid_usdc[i] == 0 {
            continue;
        }
        let owner = ctx.accounts.stability_pool.owners[i];
        let (expected, _) = Pubkey::find_program_address(
            &[
                STABILITY_DEPOSIT_SEED,
                owner.as_ref(),
                pool_key.as_ref(),
            ],
            ctx.program_id,
        );
        require_keys_eq!(
            ctx.remaining_accounts[i].key(),
            expected,
            PreLendError::BidOrderInvalid
        );

        let discount = ctx.accounts.stability_pool.discount_bps[i];
        let want = if insolvent || debt <= dust {
            debt.min(ctx.accounts.stability_pool.bid_usdc[i])
        } else {
            crate::math::repay_to_target(debt, value, target, discount)?
                .min(ctx.accounts.stability_pool.bid_usdc[i])
                .min(debt)
        };
        if want == 0 {
            continue;
        }
        let mut tokens =
            crate::math::tokens_at_discount(want, discount, price, decimals)?;
        tokens = tokens.min(collat);
        if tokens == 0 {
            continue;
        }

        let pool_seeds: &[&[u8]] = &[
            STABILITY_POOL_SEED,
            mint_key.as_ref(),
            &[ctx.accounts.stability_pool.bump],
        ];
        crate::token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.sp_usdc_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.stability_pool.to_account_info(),
            want,
            ctx.accounts.usdc_mint.decimals,
            &[pool_seeds],
        )?;

        {
            let mut data = ctx.remaining_accounts[i].try_borrow_mut_data()?;
            let mut bid = StabilityDeposit::try_deserialize(&mut &data[..])?;
            bid.pending_collateral = bid
                .pending_collateral
                .checked_add(tokens)
                .ok_or(PreLendError::MathOverflow)?;
            bid.initial_usdc = bid.initial_usdc.saturating_sub(want);
            let mut w: &mut [u8] = &mut data;
            bid.try_serialize(&mut w)?;
        }

        ctx.accounts.stability_pool.remove_usdc(i, want)?;
        ctx.accounts.stability_pool.collateral_held = ctx
            .accounts
            .stability_pool
            .collateral_held
            .checked_add(tokens)
            .ok_or(PreLendError::MathOverflow)?;

        debt = debt.saturating_sub(want);
        collat = collat.saturating_sub(tokens);
        repaid += want;
        seized += tokens;
        // remove_usdc may shift the array; re-find this owner next loop from 0
        // so we always fill current best remaining bid.
        break;
    }

    // Fill remaining bids in subsequent passes (price-time queue mutates).
    let mut guard = 0;
    while guard < MAX_BIDS {
        guard += 1;
        if repaid == 0 && seized == 0 && guard == 1 {
            break;
        }
        value = if collat == 0 {
            0
        } else {
            crate::math::collateral_value_usdc(collat, decimals, price)?
        };
        let healthy = value > 0 && crate::math::ltv_bps(debt, value)? <= target as u64;
        if (!insolvent && healthy) || debt == 0 || ctx.accounts.stability_pool.bid_count == 0 {
            break;
        }
        if guard > 1 {
            // continue filling from the new head
            let i = 0usize;
            if ctx.accounts.stability_pool.bid_usdc[i] == 0 {
                break;
            }
            let owner = ctx.accounts.stability_pool.owners[i];
            let (expected, _) = Pubkey::find_program_address(
                &[STABILITY_DEPOSIT_SEED, owner.as_ref(), pool_key.as_ref()],
                ctx.program_id,
            );
            let acc = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key() == expected)
                .ok_or(PreLendError::BidOrderInvalid)?;
            let discount = ctx.accounts.stability_pool.discount_bps[i];
            value = crate::math::collateral_value_usdc(collat, decimals, price)?;
            let want = if insolvent || debt <= dust {
                debt.min(ctx.accounts.stability_pool.bid_usdc[i])
            } else {
                crate::math::repay_to_target(debt, value, target, discount)?
                    .min(ctx.accounts.stability_pool.bid_usdc[i])
                    .min(debt)
            };
            if want == 0 {
                break;
            }
            let mut tokens = crate::math::tokens_at_discount(want, discount, price, decimals)?;
            tokens = tokens.min(collat);
            if tokens == 0 {
                break;
            }
            let pool_seeds: &[&[u8]] = &[
                STABILITY_POOL_SEED,
                mint_key.as_ref(),
                &[ctx.accounts.stability_pool.bump],
            ];
            crate::token_utils::transfer_checked_signed(
                ctx.accounts.token_program.key(),
                ctx.accounts.sp_usdc_vault.to_account_info(),
                ctx.accounts.usdc_mint.to_account_info(),
                ctx.accounts.usdc_vault.to_account_info(),
                ctx.accounts.stability_pool.to_account_info(),
                want,
                ctx.accounts.usdc_mint.decimals,
                &[pool_seeds],
            )?;
            {
                let mut data = acc.try_borrow_mut_data()?;
                let mut bid = StabilityDeposit::try_deserialize(&mut &data[..])?;
                bid.pending_collateral = bid
                    .pending_collateral
                    .checked_add(tokens)
                    .ok_or(PreLendError::MathOverflow)?;
                bid.initial_usdc = bid.initial_usdc.saturating_sub(want);
                let mut w: &mut [u8] = &mut data;
                bid.try_serialize(&mut w)?;
            }
            ctx.accounts.stability_pool.remove_usdc(i, want)?;
            ctx.accounts.stability_pool.collateral_held = ctx
                .accounts
                .stability_pool
                .collateral_held
                .checked_add(tokens)
                .ok_or(PreLendError::MathOverflow)?;
            debt = debt.saturating_sub(want);
            collat = collat.saturating_sub(tokens);
            repaid += want;
            seized += tokens;
        }
    }

    require!(repaid > 0, PreLendError::StabilityPoolInsufficient);

    let keeper = ctx.accounts.config.risk_params.keeper_fee_usdc.min(repaid);
    if keeper > 0 {
        let mint = ctx.accounts.collateral_mint.key();
        let config_seeds: &[&[u8]] = &[CONFIG_SEED, mint.as_ref(), &[ctx.accounts.config.bump]];
        crate::token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.caller_usdc.to_account_info(),
            ctx.accounts.config.to_account_info(),
            keeper,
            ctx.accounts.usdc_mint.decimals,
            &[config_seeds],
        )?;
    }

    let principal_cut = repaid.min(ctx.accounts.position.usdc_amount);
    ctx.accounts.config.total_borrowed = ctx
        .accounts
        .config
        .total_borrowed
        .saturating_sub(principal_cut);
    ctx.accounts.config.senior_assets = ctx
        .accounts
        .config
        .senior_assets
        .saturating_add(repaid.saturating_sub(principal_cut))
        .saturating_sub(keeper);

    let close_full = debt <= dust || collat == 0 || insolvent;
    {
        let position = &mut ctx.accounts.position;
        if close_full {
            position.borrower_claimable_collateral = collat;
            position.collateral_amount = 0;
            position.usdc_amount = 0;
            position.scaled_debt = 0;
            position.status = PositionStatus::Liquidated;
        } else {
            position.collateral_amount = collat;
            position.usdc_amount = debt;
            position.scaled_debt =
                crate::math::scaled_amount(debt, ctx.accounts.config.borrow_index_e18)?;
            position.status = PositionStatus::Active;
        }
    }

    emit!(PositionLiquidated {
        borrower: ctx.accounts.position.borrower,
        position: ctx.accounts.position.key(),
        debt_repaid: repaid,
        collateral_seized: seized,
        surplus_collateral: if close_full { collat } else { 0 },
    });
    Ok(())
}

#[event]
pub struct PositionLiquidated {
    pub borrower: Pubkey,
    pub position: Pubkey,
    pub debt_repaid: u64,
    pub collateral_seized: u64,
    pub surplus_collateral: u64,
}

#[derive(Accounts)]
pub struct ClaimSurplusCollateral<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        has_one = borrower @ PreLendError::Unauthorized,
        has_one = collateral_mint,
        constraint = position.status == PositionStatus::Liquidated @ PreLendError::InvalidPositionStatus,
        close = borrower,
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program,
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_surplus_collateral(ctx: Context<ClaimSurplusCollateral>) -> Result<()> {
    let surplus = ctx.accounts.position.borrower_claimable_collateral;
    if surplus > 0 {
        let mint = ctx.accounts.collateral_mint.key();
        let config_seeds: &[&[u8]] = &[CONFIG_SEED, mint.as_ref(), &[ctx.accounts.config.bump]];
        crate::token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.collateral_vault.to_account_info(),
            ctx.accounts.collateral_mint.to_account_info(),
            ctx.accounts.borrower_collateral.to_account_info(),
            ctx.accounts.config.to_account_info(),
            surplus,
            ctx.accounts.collateral_mint.decimals,
            &[config_seeds],
        )?;
    }
    Ok(())
}
