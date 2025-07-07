use anchor_lang::prelude::*;

#[account]
pub struct Subscription {
    /// The subscriber's wallet address
    pub user: Pubkey,
    /// Slot at which the subscription started
    pub start_slot: u64,
    /// Slot at which the subscription expires
    pub expiry_slot: u64,
}

impl Subscription {
    pub const LEN: usize = 32  // user Pubkey
        + 8  // start_slot
        + 8; // expiry_slot
}
