use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

fn restash(deposit: &mut StabilityDeposit, pool: &StabilityPool, initial: u64, pending: u64) {
    deposit.initial_usdc = initial;
    deposit.pending_collateral = pending;
    deposit.snapshot_p_e18 = if pool.p_e18 == 0 { E18 } else { pool.p_e18 };
    deposit.snapshot_s_e18 = pool.s_e18;
    deposit.snapshot_epoch = pool.epoch;
}

fn compounded(deposit: &StabilityDeposit, pool: &StabilityPool) -> Result<u64> {
    crate::math::sp_compounded_usdc(
        deposit.initial_usdc,
        deposit.snapshot_p_e18,
        deposit.snapshot_epoch,
        pool.p_e18,
        pool.epoch,
    )
}

fn live_gain(deposit: &StabilityDeposit, pool: &StabilityPool) -> Result<u64> {
    let extra = crate::math::sp_collateral_gain(
        deposit.initial_usdc,
        deposit.snapshot_p_e18,
        deposit.snapshot_s_e18,
        deposit.snapshot_epoch,
        pool.s_e18,
        pool.epoch,
        pool.prev_s_e18,
        pool.prev_epoch,
    )?;
    deposit
        .pending_collateral
        .checked_add(extra)
        .ok_or(PreLendError::MathOverflow.into())
}

fn transfer_sp_usdc<'info>(
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
        token_program,
        vault,
        mint,
        to,
        pool,
        amount,
        decimals,
        &[seeds],
    )
}

fn transfer_sp_collateral<'info>(
    token_program: Pubkey,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    config: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    config_bump: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
    crate::token_utils::transfer_checked_signed(
        token_program,
        vault,
        mint,
        to,
        config,
        amount,
        decimals,
        &[seeds],
    )
}

fn realloc_paid<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program_ai: &AccountInfo<'info>,
    new_len: usize,
) -> Result<()> {
    let rent = Rent::get()?;
    let needed = rent.minimum_balance(new_len);
    let current = account.lamports();
    if needed > current {
        system_program::transfer(
            CpiContext::new(
                system_program_ai.key(),
                system_program::Transfer {
                    from: payer.clone(),
                    to: account.clone(),
                },
            ),
            needed - current,
        )?;
    }
    account.resize(new_len)?;
    Ok(())
}

// ─── InitStabilityPool (admin) ──────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitStabilityPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + StabilityPool::INIT_SPACE,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump,
    )]
    pub stability_pool: Account<'info, StabilityPool>,
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
    pool.version = SP_ACCOUNT_VERSION;
    pool.total_usdc = 0;
    pool.collateral_mint = ctx.accounts.collateral_mint.key();
    pool.collateral_held = 0;
    pool.p_e18 = E18;
    pool.s_e18 = 0;
    pool.epoch = 0;
    pool.prev_s_e18 = 0;
    pool.prev_epoch = 0;
    pool.legacy_usdc = 0;
    pool.legacy_coll = 0;
    pool.legacy_shares = 0;
    pool.bump = ctx.bumps.stability_pool;
    Ok(())
}

// ─── Migrate share-era accounts ─────────────────────────────────────────────

#[derive(Accounts)]
pub struct MigrateStabilityPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA validated in handler.
    #[account(mut)]
    pub stability_pool: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_stability_pool(ctx: Context<MigrateStabilityPool>) -> Result<()> {
    let (expected, bump) = Pubkey::find_program_address(
        &[
            STABILITY_POOL_SEED,
            ctx.accounts.collateral_mint.key().as_ref(),
        ],
        ctx.program_id,
    );
    require!(
        ctx.accounts.stability_pool.key() == expected,
        PreLendError::Unauthorized
    );
    require!(
        ctx.accounts.stability_pool.owner == ctx.program_id,
        PreLendError::Unauthorized
    );

    let new_len = 8 + StabilityPool::INIT_SPACE;
    let data = ctx.accounts.stability_pool.try_borrow_data()?;
    if data.len() >= new_len && data.get(8) == Some(&SP_ACCOUNT_VERSION) {
        return Ok(());
    }
    require!(data.len() >= 65, PreLendError::InvalidPositionStatus);
    let total_usdc = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let total_shares = u64::from_le_bytes(data[16..24].try_into().unwrap());
    let mint = Pubkey::new_from_array(data[24..56].try_into().unwrap());
    let held = u64::from_le_bytes(data[56..64].try_into().unwrap());
    require!(
        mint == ctx.accounts.collateral_mint.key(),
        PreLendError::Unauthorized
    );
    drop(data);

    realloc_paid(
        &ctx.accounts.stability_pool.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        new_len,
    )?;

    let pool = StabilityPool {
        version: SP_ACCOUNT_VERSION,
        total_usdc: 0,
        collateral_mint: mint,
        collateral_held: 0,
        p_e18: E18,
        s_e18: 0,
        epoch: 0,
        prev_s_e18: 0,
        prev_epoch: 0,
        legacy_usdc: total_usdc,
        legacy_coll: held,
        legacy_shares: total_shares,
        bump,
    };
    let mut dst = ctx.accounts.stability_pool.try_borrow_mut_data()?;
    let mut w: &mut [u8] = &mut dst;
    pool.try_serialize(&mut w)?;
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateStabilityDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: seed only.
    pub depositor: UncheckedAccount<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.version == SP_ACCOUNT_VERSION @ PreLendError::StabilityPoolNeedsMigrate,
    )]
    pub stability_pool: Account<'info, StabilityPool>,
    /// CHECK: PDA validated in handler.
    #[account(mut)]
    pub stability_deposit: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_stability_deposit(ctx: Context<MigrateStabilityDeposit>) -> Result<()> {
    let (expected, bump) = Pubkey::find_program_address(
        &[
            STABILITY_DEPOSIT_SEED,
            ctx.accounts.depositor.key().as_ref(),
            ctx.accounts.stability_pool.key().as_ref(),
        ],
        ctx.program_id,
    );
    require!(
        ctx.accounts.stability_deposit.key() == expected,
        PreLendError::Unauthorized
    );
    require!(
        ctx.accounts.stability_deposit.owner == ctx.program_id,
        PreLendError::Unauthorized
    );

    let new_len = 8 + StabilityDeposit::INIT_SPACE;
    let data = ctx.accounts.stability_deposit.try_borrow_data()?;
    if data.len() >= new_len {
        return err!(PreLendError::AlreadyMigrated);
    }
    require!(data.len() >= 89, PreLendError::InvalidPositionStatus);
    let owner = Pubkey::new_from_array(data[8..40].try_into().unwrap());
    let pool_key = Pubkey::new_from_array(data[40..72].try_into().unwrap());
    let shares = u64::from_le_bytes(data[72..80].try_into().unwrap());
    require!(owner == ctx.accounts.depositor.key(), PreLendError::Unauthorized);
    require!(
        pool_key == ctx.accounts.stability_pool.key(),
        PreLendError::Unauthorized
    );
    drop(data);

    let pool = &mut ctx.accounts.stability_pool;
    require!(pool.legacy_shares > 0, PreLendError::AlreadyMigrated);
    let (usdc, coll) = if shares >= pool.legacy_shares {
        (pool.legacy_usdc, pool.legacy_coll)
    } else {
        let usdc = (shares as u128)
            .checked_mul(pool.legacy_usdc as u128)
            .ok_or(PreLendError::MathOverflow)?
            .checked_div(pool.legacy_shares as u128)
            .ok_or(PreLendError::MathOverflow)? as u64;
        let coll = (shares as u128)
            .checked_mul(pool.legacy_coll as u128)
            .ok_or(PreLendError::MathOverflow)?
            .checked_div(pool.legacy_shares as u128)
            .ok_or(PreLendError::MathOverflow)? as u64;
        (usdc, coll)
    };
    pool.legacy_usdc = pool.legacy_usdc.saturating_sub(usdc);
    pool.legacy_coll = pool.legacy_coll.saturating_sub(coll);
    pool.legacy_shares = pool.legacy_shares.saturating_sub(shares);
    pool.total_usdc = pool
        .total_usdc
        .checked_add(usdc)
        .ok_or(PreLendError::MathOverflow)?;
    pool.collateral_held = pool
        .collateral_held
        .checked_add(coll)
        .ok_or(PreLendError::MathOverflow)?;

    realloc_paid(
        &ctx.accounts.stability_deposit.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        new_len,
    )?;

    let mut deposit = StabilityDeposit {
        depositor: owner,
        pool: pool_key,
        initial_usdc: usdc,
        snapshot_p_e18: if pool.p_e18 == 0 { E18 } else { pool.p_e18 },
        snapshot_s_e18: pool.s_e18,
        snapshot_epoch: pool.epoch,
        pending_collateral: coll,
        bump,
    };
    restash(&mut deposit, pool, usdc, coll);
    let mut dst = ctx.accounts.stability_deposit.try_borrow_mut_data()?;
    let mut w: &mut [u8] = &mut dst;
    deposit.try_serialize(&mut w)?;
    Ok(())
}

// ─── DepositStability ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct DepositStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
        constraint = stability_pool.version == SP_ACCOUNT_VERSION @ PreLendError::StabilityPoolNeedsMigrate,
        constraint = stability_pool.legacy_shares == 0 @ PreLendError::StabilityPoolNeedsMigrate,
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

pub fn handle_deposit_stability(ctx: Context<DepositStability>, amount: u64) -> Result<()> {
    require!(amount > 0, PreLendError::ZeroAmount);

    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.depositor_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.depositor.to_account_info(),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let pool_key = ctx.accounts.stability_pool.key();
    let pool = &mut ctx.accounts.stability_pool;
    if pool.p_e18 == 0 {
        pool.p_e18 = E18;
    }
    let deposit = &mut ctx.accounts.stability_deposit;
    if deposit.depositor == Pubkey::default() {
        deposit.depositor = ctx.accounts.depositor.key();
        deposit.pool = pool_key;
        deposit.bump = ctx.bumps.stability_deposit;
        deposit.snapshot_p_e18 = pool.p_e18;
        deposit.snapshot_epoch = pool.epoch;
    }

    let usdc = compounded(deposit, pool)?;
    let pending = live_gain(deposit, pool)?;
    restash(deposit, pool, usdc.saturating_add(amount), pending);
    pool.total_usdc = pool
        .total_usdc
        .checked_add(amount)
        .ok_or(PreLendError::MathOverflow)?;
    Ok(())
}

// ─── WithdrawStability ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct WithdrawStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
        constraint = stability_pool.version == SP_ACCOUNT_VERSION @ PreLendError::StabilityPoolNeedsMigrate,
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
    let pool = &ctx.accounts.stability_pool;
    let deposit = &ctx.accounts.stability_deposit;
    let usdc = compounded(deposit, pool)?;
    let pending = live_gain(deposit, pool)?;
    let out = if amount == 0 || amount > usdc { usdc } else { amount };
    require!(out > 0, PreLendError::ZeroAmount);

    transfer_sp_usdc(
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

    let pool = &mut ctx.accounts.stability_pool;
    pool.total_usdc = pool.total_usdc.saturating_sub(out);
    restash(
        &mut ctx.accounts.stability_deposit,
        pool,
        usdc.saturating_sub(out),
        pending,
    );
    Ok(())
}

// ─── ClaimStability ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ClaimStability<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
        constraint = stability_pool.version == SP_ACCOUNT_VERSION @ PreLendError::StabilityPoolNeedsMigrate,
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
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_stability(ctx: Context<ClaimStability>) -> Result<()> {
    let pool = &ctx.accounts.stability_pool;
    let deposit = &ctx.accounts.stability_deposit;
    let usdc = compounded(deposit, pool)?;
    let gain = live_gain(deposit, pool)?;
    require!(gain > 0, PreLendError::ZeroAmount);

    transfer_sp_collateral(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.depositor_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        gain,
        ctx.accounts.collateral_mint.decimals,
        ctx.accounts.config.bump,
    )?;

    let pool = &mut ctx.accounts.stability_pool;
    pool.collateral_held = pool.collateral_held.saturating_sub(gain);
    restash(&mut ctx.accounts.stability_deposit, pool, usdc, 0);
    Ok(())
}

// ─── ResetStability (admin) — empty vaults, wipe snapshots, close deposits ───

#[derive(Accounts)]
pub struct ResetStability<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
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
    let coll_out = ctx
        .accounts
        .stability_pool
        .collateral_held
        .saturating_add(ctx.accounts.stability_pool.legacy_coll);

    transfer_sp_usdc(
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
    transfer_sp_collateral(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.admin_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        coll_out,
        ctx.accounts.collateral_mint.decimals,
        ctx.accounts.config.bump,
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
    pool.version = SP_ACCOUNT_VERSION;
    pool.total_usdc = 0;
    pool.collateral_held = 0;
    pool.p_e18 = E18;
    pool.s_e18 = 0;
    pool.epoch = 0;
    pool.prev_s_e18 = 0;
    pool.prev_epoch = 0;
    pool.legacy_usdc = 0;
    pool.legacy_coll = 0;
    pool.legacy_shares = 0;
    Ok(())
}
