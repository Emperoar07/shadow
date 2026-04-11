use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;

#[account]
pub struct OpenPositionDiagnostic {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub run_id: u64,
    pub stage: u8,
    pub status: OpenPositionDiagnosticStatus,
    pub result_0: bool,
    pub result_1: bool,
    pub result_2: bool,
    pub result_3: bool,
    pub bump: u8,
    pub pending_computation_account: Pubkey,
    pub created_at: i64,
    pub completed_at: i64,
    pub _reserved: [u8; 32],
}

impl Default for OpenPositionDiagnostic {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            market: Pubkey::default(),
            run_id: 0,
            stage: 0,
            status: OpenPositionDiagnosticStatus::Pending,
            result_0: false,
            result_1: false,
            result_2: false,
            result_3: false,
            bump: 0,
            pending_computation_account: Pubkey::default(),
            created_at: 0,
            completed_at: 0,
            _reserved: [0u8; 32],
        }
    }
}

impl OpenPositionDiagnostic {
    pub const STAGE_TUPLE_ONLY: u8 = 1;
    pub const STAGE_MARGIN_CHECK: u8 = 2;
    pub const STAGE_FULL_CHECK: u8 = 3;

    pub const LEN: usize = 8 +  // discriminator
        32 + // owner
        32 + // market
        8 +  // run_id
        1 +  // stage
        1 +  // status
        1 +  // result_0
        1 +  // result_1
        1 +  // result_2
        1 +  // result_3
        1 +  // bump
        32 + // pending_computation_account
        8 +  // created_at
        8 +  // completed_at
        32; // reserved

    pub fn begin(
        &mut self,
        owner: Pubkey,
        market: Pubkey,
        run_id: u64,
        stage: u8,
        bump: u8,
        computation_account: Pubkey,
        created_at: i64,
    ) -> Result<()> {
        require!(
            self.pending_computation_account == Pubkey::default(),
            ShadowPerpError::ComputationInProgress
        );
        self.owner = owner;
        self.market = market;
        self.run_id = run_id;
        self.stage = stage;
        self.status = OpenPositionDiagnosticStatus::Pending;
        self.result_0 = false;
        self.result_1 = false;
        self.result_2 = false;
        self.result_3 = false;
        self.bump = bump;
        self.pending_computation_account = computation_account;
        self.created_at = created_at;
        self.completed_at = 0;
        Ok(())
    }

    pub fn consume(&mut self, computation_account: Pubkey, completed_at: i64) -> Result<()> {
        require!(
            self.pending_computation_account != Pubkey::default(),
            ShadowPerpError::InvalidAccountData
        );
        require!(
            self.pending_computation_account == computation_account,
            ShadowPerpError::Unauthorized
        );
        self.pending_computation_account = Pubkey::default();
        self.completed_at = completed_at;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum OpenPositionDiagnosticStatus {
    #[default]
    Pending,
    Passed,
    Rejected,
    Aborted,
}
