# Shadow

> **Trade in the shadows, settle in the light.**

Shadow is a private perpetual futures protocol built on Solana using [Arcium's](https://arcium.com) Multi-Party Execution (MXE) network. Your trading positions, leverage, and strategy remain completely private — only your final PnL is revealed when you close.

## The Problem

Traditional perpetual futures protocols expose trader intent on-chain:

- **Copy-Trading Attacks**: Whales can be front-run by adversaries observing their positions in real-time
- **Targeted Liquidations**: Attackers can see health factors on-chain and push prices to trigger liquidations
- **Strategy Leakage**: Every trade's size, leverage, direction, and entry price is publicly visible
- **MEV Extraction**: Searchers exploit visible position data for sandwich attacks and forced liquidations

## The Solution

ShadowPerp uses Arcium's MPC infrastructure to keep all position data encrypted throughout the entire lifecycle:

| Data | Privacy Status | When Revealed |
|------|----------------|---------------|
| Position Size | **Encrypted** | Never |
| Entry Price | **Encrypted** | Never |
| Leverage | **Encrypted** | Never |
| Direction (Long/Short) | **Encrypted** | Never |
| Margin (active) | **Encrypted** | Settlement only (MPC-revealed, not emitted) |
| Health Factor | **Encrypted** | Never |
| Liquidation Price | **Encrypted** | Never |
| Realized PnL | Encrypted → Private settlement | Not emitted on-chain |

## How Arcium Is Used

ShadowPerp deeply integrates Arcium at every layer of the protocol:

### 1. Client-Side Encryption (x25519 + Rescue Cipher)

Before any position data touches the blockchain, it's encrypted client-side:

```
User Input → x25519 ECDH Key Exchange with MXE Cluster
           → Derive Shared Secret
           → Rescue Cipher Encryption (128-bit security)
           → Submit Encrypted Ciphertexts On-Chain
```

- **x25519 Diffie-Hellman**: Ephemeral keypair generated per session, shared secret derived with MXE cluster's public key
- **Rescue Cipher**: Arithmetization-friendly symmetric cipher over F_{2^255-19}, optimized for MPC circuits
- **Enc<Shared, T>**: Each encrypted parameter includes `[x25519_pubkey | nonce | ciphertext]` — decryptable by both client and MXE

### 2. Arcis MPC Circuits (encrypted-ixs/)

Three privacy-preserving circuits written in Arcium's Arcis DSL:

**`open_position`** — Position Validation Circuit
- Inputs: `Enc<Shared, size>`, `Enc<Shared, entry_price>`, `Enc<Shared, leverage>`, `Enc<Shared, is_long>`, `Enc<Shared, margin>`
- Validates leverage limits, margin requirements inside MPC
- Returns: `(Enc<Mxe, OpenPositionResult>, Enc<Mxe, OpenInterest>)` — position stored as MXE-only encrypted state

**`close_position`** — PnL Computation Circuit
- Inputs: `Enc<Mxe, Position>` (from on-chain), plaintext `oracle_price`
- Computes PnL = `(exit_price - entry_price) * size * direction`
- Returns: `(realized_pnl: i64, settlement_amount: u64, fee: u64, locked_margin: u64, Enc<Mxe, OpenInterest>)` — settlement values revealed to on-chain callback only; nothing emitted to public event logs

**`liquidation_check`** — Private Health Factor Circuit
- Inputs: `Enc<Mxe, Position>`, plaintext `oracle_price`, `market_params`
- Computes: `health_factor = (margin + unrealized_pnl) / maintenance_margin`
- Returns: `(should_liquidate: bool, revealed_margin: u64, liquidation_price: u64)` — **health factor is NEVER revealed**; margin is revealed only when `should_liquidate = true` (needed for penalty distribution)

### 3. On-Chain Arcium Integration (Anchor Program)

The Solana program uses Arcium's Anchor macros for full MPC integration:

- **`#[init_computation_definition_accounts]`**: Registers MPC circuit bytecode on-chain as `ComputationDefinitionAccount`
- **`#[queue_computation_accounts]`**: Prepares accounts for submitting computation to Arcium network
- **`ArgBuilder`**: Constructs encrypted arguments matching the Enc<Shared,T> wire format (pubkey + nonce + ciphertext)
- **`queue_computation()`**: CPI call to Arcium program that sends encrypted data to MXE cluster for MPC execution
- **`#[callback_accounts]` + `#[arcium_callback]`**: Receives and verifies MPC results via `verify_output()`
- **`SignedComputationOutputs<T>`**: Typed callback output with cryptographic verification against cluster signatures

### 4. Encryption Data Flow

```
┌──────────────────────────────────────────────────────────┐
│ CLIENT                                                   │
│  1. Generate x25519 ephemeral keypair                    │
│  2. ECDH with MXE cluster pubkey → shared secret         │
│  3. RescueCipher.encrypt(position_data, nonce)           │
│  4. Pack: [pubkey(32) | nonce(16) | ciphertext(32)] × 7 │
└──────────────────────────┬───────────────────────────────┘
                           │ encrypted ciphertexts
                           ▼
┌──────────────────────────────────────────────────────────┐
│ SOLANA PROGRAM (Anchor)                                  │
│  5. Store encrypted_data[256] on Position account        │
│  6. ArgBuilder packs args into MPC computation           │
│  7. queue_computation() CPI → Arcium program             │
└──────────────────────────┬───────────────────────────────┘
                           │ computation request
                           ▼
┌──────────────────────────────────────────────────────────┐
│ ARCIUM MXE CLUSTER (Cerberus MPC)                        │
│  8. Nodes receive secret shares of encrypted data        │
│  9. Execute Arcis circuit on secret shares                │
│ 10. Only 1 honest node needed for security guarantee     │
│ 11. Return signed computation outputs                     │
└──────────────────────────┬───────────────────────────────┘
                           │ SignedComputationOutputs
                           ▼
┌──────────────────────────────────────────────────────────┐
│ CALLBACK (On-Chain)                                      │
│ 12. verify_output() validates cluster signature          │
│ 13. Extract results (PnL revealed, or bool for liq)      │
│ 14. Update on-chain state, transfer settlement           │
└──────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│   - Wallet connection (Phantom/Solflare)                │
│   - Position management UI                              │
│   - Client-side encryption (x25519 + Rescue)            │
│   - 4-step encryption flow visualization                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Arcium MPC Layer (Arcis)                   │
│   - open_position: Validates & stores encrypted         │
│   - close_position: Calculates & reveals PnL            │
│   - check_liquidation: Private health factor check      │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│            Solana Program (Anchor)                      │
│   - Collateral management (USDC vault)                  │
│   - Position account storage (256-byte encrypted blob)  │
│   - Oracle price integration                            │
│   - Settlement and fee collection                       │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
shadowperp/
├── programs/shadowperp/        # Solana Anchor program
│   └── src/
│       ├── lib.rs              # Program entrypoint + instruction dispatch
│       ├── handlers/           # Instruction handlers
│       │   ├── init_comp_defs.rs   # Registers 3 comp-def accounts on-chain
│       │   ├── sync_comp_defs.rs   # Patches market comp-def pointers post-deploy
│       │   ├── open_position.rs    # Encrypts & queues via ArgBuilder
│       │   ├── close_position.rs   # Queues PnL computation
│       │   ├── check_liquidation.rs # Queues liquidation check
│       │   └── callbacks/          # MPC result handlers
│       │       ├── open_position_callback.rs
│       │       ├── close_position_callback.rs
│       │       └── liquidation_callback.rs
│       ├── state/              # Account definitions
│       │   ├── market.rs       # Market with comp def addresses
│       │   ├── position.rs     # 256-byte encrypted_data blob
│       │   └── margin_account.rs
│       └── errors/
├── encrypted-ixs/              # Arcis MPC circuits
│   └── src/
│       ├── open_position.rs    # Position validation circuit
│       ├── close_position.rs   # PnL calculation circuit
│       ├── liquidation_check.rs # Health factor circuit
│       └── types.rs            # Shared encrypted types
├── app/                        # Next.js frontend
│   └── src/
│       ├── components/
│       │   ├── TradingPanel.tsx     # Trade UI with encryption steps
│       │   ├── PositionsList.tsx    # Positions with MPC status
│       │   └── MarketInfo.tsx       # Market data + privacy info
│       ├── lib/
│       │   ├── client.ts           # SDK: x25519 + Rescue + Arcium
│       │   ├── create-client.ts    # Factory with wallet integration
│       │   └── runtime.ts          # Environment config
│       ├── types/index.ts          # TypeScript type definitions
│       └── pages/
├── tests/shadowperp.ts         # Comprehensive integration tests
├── Anchor.toml                 # Anchor config with Arcium clone
├── Arcium.toml                 # Arcium circuit build config
└── Cargo.toml
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (0.32+)
- [Arcium CLI](https://docs.arcium.com/) (0.3+)
- [Node.js](https://nodejs.org/) (20.x LTS recommended)
- Linux/macOS/WSL2 for Solana + Anchor + Arcium CLI

## Key Design Decisions

### Why Enc<Shared, T> for User Inputs?

User inputs use `Enc<Shared, T>` (decryptable by both client and MXE) because:
- Client needs to verify their own encrypted data before submission
- MXE nodes need to decrypt for MPC computation
- x25519 ECDH ensures only the intended MXE cluster can decrypt

### Why Enc<Mxe, T> for Stored State?

Position state after MPC uses `Enc<Mxe, T>` (MXE-only decryptable) because:
- Prevents even the position owner from reading on-chain state directly
- Only MPC can operate on stored positions (for close/liquidation)
- Eliminates client-side key leakage as attack vector

### Why Reveal PnL/Margin in Callbacks but Not in Events?

- Settlement amounts must be computed inside MPC (PnL, fee, locked margin) so the callback can execute the correct USDC transfer
- These values are consumed internally by the callback — they are **not emitted to public event logs**, preventing observers from inferring position size or direction from settlement data
- Position size, leverage, direction remain encrypted even after close
- This is the minimum information leakage required for settlement

### Why Boolean-Only Liquidation?

- Health factor is the most sensitive data (directly exploitable)
- Boolean `should_liquidate` is sufficient for the protocol to act
- Liquidation price is revealed only when liquidation occurs (needed for penalty calculation)

## Security

### Arcium MPC Security

- **Cerberus protocol**: Only 1 honest node needed for full security guarantee
- Position data split into secret shares across MXE nodes
- No single node ever sees plaintext position data
- **Rescue cipher**: 128-bit security, optimized for arithmetic circuits
- **x25519 ECDH**: Ephemeral keys prevent replay attacks

### Smart Contract Security

- Built with Anchor (0.30.1) for automatic safety checks
- PDA-based account derivation for all accounts
- Callback verification via `verify_output()` against cluster signatures
- Oracle price freshness validation (< 300 second staleness)
- Overflow checks enabled via Cargo profile

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Blockchain | Solana |
| Smart Contracts | Anchor 0.32.1 |
| MPC Network | Arcium MXE |
| MPC Circuits | Arcis DSL |
| Encryption | x25519 ECDH + Rescue Cipher |
| Frontend | Next.js + TypeScript |
| Wallet | Solana Wallet Adapter |
| Collateral | SPL Token (USDC) |

## Links

- [Arcium Documentation](https://docs.arcium.com/)
- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework](https://www.anchor-lang.com/)

---

**Built for the Arcium Private Perps Bounty**

*Trade privately. Settle transparently. ShadowPerp.*
