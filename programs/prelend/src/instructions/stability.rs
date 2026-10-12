use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::token_interface::{
    self, CloseAccount, InitializeAccount3, Mint, TokenAccount, TokenInterface,
};

fn transfer_book_usdc<'info>(
    token_program: Pubkey,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    pool: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    collateral_mint: Pubkey,
    bump: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let mint_key = collateral_mint;
    let seeds: &[&[u8]] = &[STABILITY_POOL_SEED, mint_key.as_ref(), &[bump]];
    crate::token_utils::transfer_checked_signed(
        token_program, vault, mint, to, pool, amount, decimals, &[seeds],
    )
}

fn transfer_collat<'info>(
    token_program: Pubkey,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    config: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    config_bump: u8,
    market: Pubkey,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[CONFIG_SEED, market.as_ref(), &[config_bump]];
    crate::token_utils::transfer_checked_signed(
        token_program, vault, mint, to, config, amount, decimals, &[seeds],
    )
}

#[derive(Accounts)]
pub struct InitStabilityPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + StabilityPool::INIT_SPACE,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump,
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    #[account(
        init,
        payer = admin,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
        token::token_program = token_program,
    )]
    pub sp_usdc_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_stability_pool(ctx: Context<InitStabilityPool>) -> Result<()> {
    let pool = &mut ctx.accounts.stability_pool;
    pool.version = BID_BOOK_VERSION;
    pool.collateral_mint = ctx.accounts.collateral_mint.key();
    pool.bump = ctx.bumps.stability_pool;
    Ok(())
}

#[derive(Accounts)]
pub struct DepositStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
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
        associated_token::mint = usdc_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub depositor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
    )]
    pub sp_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + StabilityDeposit::INIT_SPACE,
        seeds = [STABILITY_DEPOSIT_SEED, depositor.key().as_ref(), stability_pool.key().as_ref()],
        bump,
    )]
    pub stability_deposit: Box<Account<'info, StabilityDeposit>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_stability(
    ctx: Context<DepositStability>,
    amount: u64,
    discount_bps: u16,
) -> Result<()> {
    require!(amount > 0, PreLendError::ZeroAmount);
    require!(discount_bps > 0 && discount_bps < BPS_DENOMINATOR as u16, PreLendError::ZeroAmount);

    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.depositor_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.depositor.to_account_info(),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.stability_pool.key();
    let pool = &mut ctx.accounts.stability_pool;
    let deposit = &mut ctx.accounts.stability_deposit;
    if deposit.depositor == Pubkey::default() {
        deposit.depositor = ctx.accounts.depositor.key();
        deposit.pool = pool_key;
        deposit.discount_bps = discount_bps;
        deposit.locked_at = now;
        deposit.bump = ctx.bumps.stability_deposit;
    } else {
        require!(
            deposit.discount_bps == discount_bps,
            PreLendError::BidDiscountMismatch
        );
    }
    pool.insert_bid(ctx.accounts.depositor.key(), amount, discount_bps, deposit.locked_at)?;
    deposit.initial_usdc = deposit
        .initial_usdc
        .checked_add(amount)
        .ok_or(PreLendError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
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
        seeds = [STABILITY_DEPOSIT_SEED, depositor.key().as_ref(), stability_pool.key().as_ref()],
        bump = stability_deposit.bump,
        constraint = stability_deposit.depositor == depositor.key() @ PreLendError::Unauthorized,
        constraint = stability_deposit.pool == stability_pool.key(),
    )]
    pub stability_deposit: Box<Account<'info, StabilityDeposit>>,
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
    )]
    pub sp_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = usdc_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub depositor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_stability(ctx: Context<WithdrawStability>, amount: u64) -> Result<()> {
    ctx.accounts.config.accrue_interest(Clock::get()?.unix_timestamp)?;
    let rate = ctx.accounts.config.current_rate_bps()?;
    let headroom = crate::math::interest_headroom(
        ctx.accounts.config.total_borrowed,
        rate,
        ctx.accounts.config.risk_params.interest_headroom_secs,
    )?;
    let needed = ctx
        .accounts
        .config
        .total_borrowed
        .saturating_add(headroom)
        .min(ctx.accounts.stability_pool.total_usdc);

    let idx = ctx
        .accounts
        .stability_pool
        .find_owner(ctx.accounts.depositor.key())
        .ok_or(PreLendError::InsufficientDeposits)? as usize;
    let engaged = ctx.accounts.stability_pool.engaged_usdc(idx, needed);
    let free = ctx.accounts.stability_pool.bid_usdc[idx].saturating_sub(engaged);
    let out = if amount == 0 || amount > free { free } else { amount };
    require!(out > 0, PreLendError::BidEngaged);

    transfer_book_usdc(
        ctx.accounts.token_program.key(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.depositor_usdc.to_account_info(),
        ctx.accounts.stability_pool.to_account_info(),
        out,
        ctx.accounts.usdc_mint.decimals,
        ctx.accounts.collateral_mint.key(),
        ctx.accounts.stability_pool.bump,
    )?;

    ctx.accounts.stability_pool.remove_usdc(idx, out)?;
    ctx.accounts.stability_deposit.initial_usdc = ctx
        .accounts
        .stability_deposit
        .initial_usdc
        .saturating_sub(out);
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    #[account(
        mut,
        seeds = [STABILITY_DEPOSIT_SEED, depositor.key().as_ref(), stability_pool.key().as_ref()],
        bump = stability_deposit.bump,
        constraint = stability_deposit.depositor == depositor.key() @ PreLendError::Unauthorized,
        constraint = stability_deposit.pool == stability_pool.key(),
    )]
    pub stability_deposit: Box<Account<'info, StabilityDeposit>>,
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
        payer = depositor,
        associated_token::mint = collateral_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub depositor_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
    )]
    pub sp_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = usdc_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub depositor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_stability(ctx: Context<ClaimStability>) -> Result<()> {
    let tokens = ctx.accounts.stability_deposit.pending_collateral;
    let mut yield_usdc = ctx.accounts.stability_deposit.yield_usdc;
    if let Some(idx) = ctx
        .accounts
        .stability_pool
        .find_owner(ctx.accounts.depositor.key())
    {
        let i = idx as usize;
        yield_usdc = yield_usdc.saturating_add(ctx.accounts.stability_pool.bid_yield[i]);
        ctx.accounts.stability_pool.bid_yield[i] = 0;
    }
    require!(tokens > 0 || yield_usdc > 0, PreLendError::ZeroAmount);

    transfer_collat(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.depositor_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        tokens,
        ctx.accounts.collateral_mint.decimals,
        ctx.accounts.config.bump,
        ctx.accounts.config.collateral_mint,
    )?;
    transfer_book_usdc(
        ctx.accounts.token_program.key(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.depositor_usdc.to_account_info(),
        ctx.accounts.stability_pool.to_account_info(),
        yield_usdc,
        ctx.accounts.usdc_mint.decimals,
        ctx.accounts.collateral_mint.key(),
        ctx.accounts.stability_pool.bump,
    )?;

    ctx.accounts.stability_pool.collateral_held = ctx
        .accounts
        .stability_pool
        .collateral_held
        .saturating_sub(tokens);
    ctx.accounts.stability_deposit.pending_collateral = 0;
    ctx.accounts.stability_deposit.yield_usdc = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct ResetStability<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
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
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = admin,
        associated_token::token_program = token_program,
    )]
    pub admin_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = collateral_mint,
        associated_token::authority = admin,
        associated_token::token_program = token_program,
    )]
    pub admin_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_reset_stability(ctx: Context<ResetStability>) -> Result<()> {
    let usdc_out = ctx.accounts.sp_usdc_vault.amount;
    let coll_out = ctx.accounts.stability_pool.collateral_held;
    transfer_book_usdc(
        ctx.accounts.token_program.key(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.admin_usdc.to_account_info(),
        ctx.accounts.stability_pool.to_account_info(),
        usdc_out,
        ctx.accounts.usdc_mint.decimals,
        ctx.accounts.collateral_mint.key(),
        ctx.accounts.stability_pool.bump,
    )?;
    transfer_collat(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.admin_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        coll_out,
        ctx.accounts.collateral_mint.decimals,
        ctx.accounts.config.bump,
        ctx.accounts.config.collateral_mint,
    )?;

    let admin_info = ctx.accounts.admin.to_account_info();
    for acc in ctx.remaining_accounts.iter() {
        require_keys_eq!(*acc.owner, crate::ID, PreLendError::Unauthorized);
        let dest_lamports = admin_info.lamports();
        **admin_info.try_borrow_mut_lamports()? = dest_lamports
            .checked_add(acc.lamports())
            .ok_or(PreLendError::MathOverflow)?;
        **acc.try_borrow_mut_lamports()? = 0;
        acc.assign(&system_program::ID);
        acc.resize(0)?;
    }

    let pool = &mut ctx.accounts.stability_pool;
    pool.version = BID_BOOK_VERSION;
    pool.total_usdc = 0;
    pool.collateral_held = 0;
    pool.bid_count = 0;
    for i in 0..MAX_BIDS {
        pool.owners[i] = Pubkey::default();
        pool.bid_usdc[i] = 0;
        pool.discount_bps[i] = 0;
        pool.locked_at[i] = 0;
        pool.bid_yield[i] = 0;
    }
    Ok(())
}

const SP_TOKEN_ACCOUNT_LEN: u64 = 165;

#[derive(Accounts)]
pub struct RebuildSpUsdcVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub old_usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    /// CHECK: bid-book USDC vault PDA; mint is read from raw token bytes.
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
    )]
    pub sp_usdc_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = old_usdc_mint,
        token::authority = admin,
        token::token_program = token_program,
    )]
    pub admin_old_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_rebuild_sp_usdc_vault(ctx: Context<RebuildSpUsdcVault>) -> Result<()> {
    let token_program = ctx.accounts.token_program.key();
    let new_mint = ctx.accounts.usdc_mint.key();
    let col = ctx.accounts.collateral_mint.key();
    let vault_bump = ctx.bumps.sp_usdc_vault;
    let pool_bump = ctx.accounts.stability_pool.bump;

    let live_mint = {
        let vault = ctx.accounts.sp_usdc_vault.to_account_info();
        let data = vault.try_borrow_data()?;
        if *vault.owner == token_program && data.len() >= 32 {
            Some(Pubkey::try_from(&data[0..32]).map_err(|_| PreLendError::InvalidUsdcMint)?)
        } else {
            None
        }
    };
    if live_mint == Some(new_mint) {
        return Ok(());
    }

    if live_mint.is_some() {
        let amount = {
            let data = ctx.accounts.sp_usdc_vault.try_borrow_data()?;
            require!(data.len() >= 72, PreLendError::InvalidUsdcMint);
            let mint = Pubkey::try_from(&data[0..32]).map_err(|_| PreLendError::InvalidUsdcMint)?;
            require_keys_eq!(mint, ctx.accounts.old_usdc_mint.key(), PreLendError::InvalidUsdcMint);
            u64::from_le_bytes(data[64..72].try_into().map_err(|_| PreLendError::MathOverflow)?)
        };
        let pool_seeds: &[&[u8]] = &[STABILITY_POOL_SEED, col.as_ref(), &[pool_bump]];
        if amount > 0 {
            transfer_book_usdc(
                token_program,
                ctx.accounts.sp_usdc_vault.to_account_info(),
                ctx.accounts.old_usdc_mint.to_account_info(),
                ctx.accounts.admin_old_usdc.to_account_info(),
                ctx.accounts.stability_pool.to_account_info(),
                amount,
                ctx.accounts.old_usdc_mint.decimals,
                col,
                pool_bump,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.sp_usdc_vault.to_account_info(),
                destination: ctx.accounts.admin.to_account_info(),
                authority: ctx.accounts.stability_pool.to_account_info(),
            },
            &[pool_seeds],
        ))?;
    }

    let vault_key = ctx.accounts.sp_usdc_vault.key();
    let vault_seeds: &[&[u8]] = &[SP_USDC_VAULT_SEED, col.as_ref(), &[vault_bump]];
    let rent = Rent::get()?.minimum_balance(SP_TOKEN_ACCOUNT_LEN as usize);
    let have = ctx.accounts.sp_usdc_vault.to_account_info().lamports();
    if have < rent {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.sp_usdc_vault.to_account_info(),
                },
            ),
            rent.saturating_sub(have),
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(&vault_key, SP_TOKEN_ACCOUNT_LEN),
        &[
            ctx.accounts.sp_usdc_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(&vault_key, &token_program),
        &[
            ctx.accounts.sp_usdc_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;
    token_interface::initialize_account3(CpiContext::new(
        ctx.accounts.token_program.key(),
        InitializeAccount3 {
            account: ctx.accounts.sp_usdc_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            authority: ctx.accounts.stability_pool.to_account_info(),
        },
    ))?;

    let admin_info = ctx.accounts.admin.to_account_info();
    for acc in ctx.remaining_accounts.iter() {
        require_keys_eq!(*acc.owner, crate::ID, PreLendError::Unauthorized);
        let dest_lamports = admin_info.lamports();
        **admin_info.try_borrow_mut_lamports()? = dest_lamports
            .checked_add(acc.lamports())
            .ok_or(PreLendError::MathOverflow)?;
        **acc.try_borrow_mut_lamports()? = 0;
        acc.assign(&system_program::ID);
        acc.resize(0)?;
    }

    let pool = &mut ctx.accounts.stability_pool;
    pool.version = BID_BOOK_VERSION;
    pool.total_usdc = 0;
    pool.collateral_held = 0;
    pool.bid_count = 0;
    for i in 0..MAX_BIDS {
        pool.owners[i] = Pubkey::default();
        pool.bid_usdc[i] = 0;
        pool.discount_bps[i] = 0;
        pool.locked_at[i] = 0;
        pool.bid_yield[i] = 0;
    }
    Ok(())
}
