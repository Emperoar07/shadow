# ShadowPerp

> **Trade in the shadows, settle in the light.**

ShadowPerp is a private perpetual futures protocol built on Solana using [Arcium's](https://arcium.com) encrypted computation network. Your trading positions, leverage, and strategy remain completely private until you close your position.

## Privacy Guarantees

| Data | Privacy Status | When Revealed |
|------|----------------|---------------|
| Position Size | Encrypted | **Never** |
| Entry Price | Encrypted | **Never** |
| Leverage | Encrypted | **Never** |
| Direction (Long/Short) | Encrypted | **Never** |
| Health Factor | Encrypted | **Never** |
| Liquidation Price | Encrypted | **Never** |
| **Realized PnL** | Encrypted → Public | Position Close |

## Why Private Perps?

Traditional perpetual futures protocols expose trader intent:

- **Copy-Trading**: Whales can be front-run by observing their positions
- **Targeted Liquidations**: Adversaries can see health factors and push prices to liquidate positions
- **Strategy Leakage**: Trading strategies are visible on-chain

ShadowPerp solves this using Multi-Party Computation (MPC):

- **Encrypted Positions**: Size, leverage, and direction are encrypted in Arcium's MPC network
- **Private Liquidations**: Health factors are computed privately - only the liquidation decision is revealed
- **Reveal Only at Exit**: The only data revealed is your final PnL when you close

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                   │
│   - Wallet connection (Phantom/Solflare)                │
│   - Position management UI                              │
│   - Client-side encryption (X25519 + Rescue)            │
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
│   - Position account storage                            │
│   - Oracle price integration                            │
│   - Settlement and fee collection                       │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
shadowperp/
├── programs/shadowperp/        # Solana Anchor program
│   └── src/
│       ├── handlers/           # Instruction handlers
│       │   ├── open_position.rs
│       │   ├── close_position.rs
│       │   ├── check_liquidation.rs
│       │   └── callbacks/      # MPC result handlers
│       ├── state/              # Account definitions
│       │   ├── market.rs
│       │   ├── position.rs
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
│       ├── components/         # React components
│       ├── lib/                # SDK client
│       └── pages/              # Next.js pages
├── tests/                      # Integration tests
├── Anchor.toml
├── Arcium.toml
└── Cargo.toml
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (0.30+)
- [Arcium CLI](https://docs.arcium.com/) (0.3+)
- [Node.js](https://nodejs.org/) (18+)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/shadowperp.git
cd shadowperp

# Install dependencies
npm install

# Build the Solana program
anchor build

# Build the Arcium circuits
arcium build

# Start local validator with Arcium
arcium localnet

# Deploy
anchor deploy
```

### Running the Frontend

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

### Opening a Position

1. User inputs position parameters (size, leverage, direction)
2. Parameters are encrypted client-side using X25519 key exchange with MXE
3. Encrypted data is sent to Solana program
4. Arcium MPC validates parameters and stores encrypted position
5. Only margin amount is visible on-chain

### Closing a Position

1. User requests position close
2. MPC decrypts position, calculates PnL using current oracle price
3. **Only the realized PnL is revealed** - position details stay encrypted
4. Settlement amount transferred to user

### Liquidation Check

1. Anyone can trigger a liquidation check
2. MPC computes health factor privately: `(margin + unrealized_pnl) / maintenance_margin`
3. Only returns `true/false` - **health factor is never revealed**
4. If liquidatable, position is closed with penalty

## Security

### Arcium MPC Security

- Uses the **Cerberus protocol** - only needs 1 honest node for security
- Position data is split into secret shares across nodes
- No single node ever sees plaintext position data
- Encrypted using **Rescue cipher** with 128-bit security

### Smart Contract Security

- Built with Anchor for safety checks
- PDA-based account derivation
- Reentrancy protection
- Overflow checks enabled

## Development

### Running Tests

```bash
# Solana program tests
anchor test

# Frontend tests
cd app && npm test
```

### Building for Production

```bash
# Build optimized program
anchor build --verifiable

# Build circuits
arcium build --release

# Build frontend
cd app && npm run build
```

## Roadmap

- [ ] Mainnet deployment
- [ ] Multiple trading pairs
- [ ] Limit orders (encrypted)
- [ ] Funding rate mechanism
- [ ] Liquidation rewards
- [ ] Mobile app

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Arcium Documentation](https://docs.arcium.com/)
- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework](https://www.anchor-lang.com/)

---

**Built for the Arcium Private Perps Hackathon**

*Trade privately. Settle transparently. ShadowPerp.*
