import Head from "next/head";
import Link from "next/link";

const NAV = [
  {
    group: "Guide",
    items: [
      { id: "overview", label: "Overview" },
      { id: "how-it-works", label: "How It Works" },
      { id: "wallet-connection", label: "Wallet Connection" },
      { id: "privacy", label: "Privacy Model" },
      { id: "margin", label: "Margin and Leverage" },
      { id: "orders", label: "Order Types" },
      { id: "tp-sl", label: "TP / SL" },
      { id: "liquidation", label: "Liquidation" },
      { id: "shielded-collateral", label: "Shielded Collateral" },
      { id: "faq", label: "FAQ" },
    ],
  },
  {
    group: "Legal",
    items: [
      { id: "privacy-policy", label: "Privacy Policy" },
      { id: "terms", label: "Terms of Use" },
      { id: "cookies", label: "Cookie Policy" },
    ],
  },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="docs-note">{children}</div>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="docs-code">{children}</code>;
}

export default function DocsPage() {
  return (
    <>
      <Head>
        <title>Documentation | ShadowPerp</title>
        <meta
          name="description"
          content="ShadowPerp documentation for private perpetual trading on Solana, covering wallet connection, privacy, margin, leverage, order flow, and Arcium MPC on devnet."
        />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #e2e8f0; font-family: 'Inter', -apple-system, sans-serif; }
        html.light body { background: #0a0a0f; color: #e2e8f0; }
        html.light .gradient-bg { background: none; }
        .theme-toggle-floating { display: none !important; }

        .docs-layout {
          display: flex;
          min-height: 100vh;
        }

        .docs-sidebar {
          width: 240px;
          flex-shrink: 0;
          border-right: 1px solid rgba(255,255,255,0.06);
          background: rgba(10,10,18,0.95);
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          padding: 24px 0;
        }
        .docs-sidebar-logo {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 20px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-decoration: none;
          color: transparent;
          background: linear-gradient(90deg, #a78bfa, #60a5fa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-size: 18px;
          font-weight: 800;
        }
        .docs-sidebar-logo-svg {
          width: 56px; height: 56px; flex-shrink: 0;
        }
        .docs-sidebar-section {
          padding: 16px 20px 8px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #4b5563;
        }
        .docs-sidebar a {
          display: block;
          padding: 7px 20px;
          font-size: 13px;
          color: #6b7280;
          text-decoration: none;
          border-left: 2px solid transparent;
          transition: all 0.15s;
        }
        .docs-sidebar a:hover {
          color: #a78bfa;
          border-left-color: #8b5cf6;
          background: rgba(139,92,246,0.05);
        }

        .docs-main {
          flex: 1;
          min-width: 0;
          max-width: 800px;
          padding: 48px 56px 80px;
        }
        .docs-header {
          margin-bottom: 48px;
          padding-bottom: 32px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .docs-header h1 {
          font-size: 32px;
          font-weight: 800;
          background: linear-gradient(135deg, #f1f5f9 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 10px;
        }
        .docs-header p {
          font-size: 15px;
          color: #6b7280;
          line-height: 1.6;
        }
        .docs-section {
          margin-bottom: 56px;
        }
        .docs-section h2 {
          font-size: 22px;
          font-weight: 700;
          color: #f1f5f9;
          margin-bottom: 16px;
          padding-top: 8px;
          scroll-margin-top: 24px;
        }
        .docs-section h3 {
          font-size: 15px;
          font-weight: 600;
          color: #e2e8f0;
          margin: 24px 0 8px;
        }
        .docs-section p {
          font-size: 14px;
          line-height: 1.75;
          color: #94a3b8;
          margin-bottom: 12px;
        }
        .docs-section ul, .docs-section ol {
          margin: 8px 0 16px 20px;
        }
        .docs-section li {
          font-size: 14px;
          line-height: 1.75;
          color: #94a3b8;
          margin-bottom: 4px;
        }
        .docs-note {
          background: rgba(139,92,246,0.08);
          border: 1px solid rgba(139,92,246,0.2);
          border-radius: 10px;
          padding: 14px 18px;
          font-size: 13px;
          color: #a78bfa;
          line-height: 1.65;
          margin: 16px 0;
        }
        .docs-code {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 5px;
          padding: 2px 7px;
          font-size: 12px;
          font-family: 'Menlo', 'Monaco', monospace;
          color: #e2e8f0;
        }
        .docs-table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 13px;
        }
        .docs-table th {
          text-align: left;
          padding: 10px 14px;
          background: rgba(255,255,255,0.04);
          color: #94a3b8;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .docs-table td {
          padding: 10px 14px;
          color: #94a3b8;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .docs-table td:first-child { color: #e2e8f0; font-weight: 500; }

        .docs-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 48px;
          font-size: 13px;
          color: #6b7280;
          text-decoration: none;
          transition: color 0.15s;
        }
        .docs-back:hover { color: #a78bfa; }

        @media (max-width: 768px) {
          .docs-sidebar { display: none; }
          .docs-main { padding: 24px 20px 48px; }
          .docs-header h1 { font-size: 24px; }
        }
      `}</style>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <Link href="/" className="docs-sidebar-logo">
            <svg viewBox="0 0 100 100" className="docs-sidebar-logo-svg" aria-hidden="true">
              <defs>
                <linearGradient id="docs-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 1 }} />
                </linearGradient>
              </defs>
              <path d="M50 15 L85 35 L50 55 L15 35 Z" fill="url(#docs-logo-grad)" opacity={0.4} />
              <path d="M50 25 L85 45 L50 65 L15 45 Z" fill="url(#docs-logo-grad)" opacity={0.65} />
              <path d="M50 35 L85 55 L50 75 L15 55 Z" fill="url(#docs-logo-grad)" />
            </svg>
            SHADOW
          </Link>
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="docs-sidebar-section">{group.group}</div>
              {group.items.map((item) => (
                <a key={item.id} href={`#${item.id}`}>
                  {item.label}
                </a>
              ))}
            </div>
          ))}
          <div style={{ marginTop: "24px", padding: "0 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <Link
              href="/"
              style={{
                display: "block",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: "500",
                color: "#9ca3af",
                textDecoration: "none",
                textAlign: "center",
                transition: "all 0.15s",
              }}
            >
              Back Home
            </Link>
            <Link
              href="/app"
              style={{
                display: "block",
                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                borderRadius: "8px",
                padding: "10px 14px",
                fontSize: "13px",
                fontWeight: "600",
                color: "#fff",
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              Launch App
            </Link>
          </div>
        </aside>

        <main className="docs-main">
          <div className="docs-header">
            <h1>ShadowPerp Documentation</h1>
            <p>
              ShadowPerp is a private perpetual trading app on Solana. It combines encrypted positions,
              direct wallet signing, and Arcium Multi Party Computation so your order details stay off the
              public ledger by default.
            </p>
          </div>

          <Section id="overview" title="Overview">
            <p>
              ShadowPerp lets you trade perpetual futures on Solana without broadcasting your position details to the
              world. Trade size, direction, leverage, and margin are encrypted before they reach the on chain program.
              Sensitive calculations run through Arcium's MPC network rather than being exposed in plaintext on the ledger.
            </p>
            <p>
              Only the minimum public state required for settlement is written on chain. The protocol is designed so
              that position data does not become exploitable public information.
            </p>
            <p>
              ShadowPerp supports <strong>6 trading pairs</strong>: SOL/USD, BTC/USD, ETH/USD, JUP/USD, PYTH/USD, and ORCA/USD.
              Each pair routes to its own on chain market account. Shared collateral keeps account usage reusable
              across supported markets, and your selected pair persists across page refreshes.
            </p>
            <Note>
              ShadowPerp is currently deployed on <strong>Solana Devnet</strong> at program ID <Code>ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4</Code>. All balances are test funds.
            </Note>
            <Note>
              Current live status: direct wallet trading, direct collateral actions, shared collateral migration flows,
              shielded collateral base flows, and the hardened runtime stack are all working on devnet. The remaining
              blocker is the Arcium-backed open-position lane, which is still being resolved on the current namespace.
            </Note>
          </Section>

          <Section id="how-it-works" title="How It Works">
            <p>Each trade follows the same core path:</p>
            <ol>
              <li>
                <strong>Encrypt</strong> — Your browser encrypts sensitive trade inputs including size, price, leverage,
                direction, and margin before submission.
              </li>
              <li>
                <strong>Queue</strong> — The encrypted payload is submitted to the Solana program, which queues an
                Arcium MPC computation.
              </li>
              <li>
                <strong>Compute</strong> — Arcium's MPC network evaluates trade logic, margin checks, PnL, and
                liquidation conditions without exposing raw inputs to any single node.
              </li>
              <li>
                <strong>Callback</strong> — Arcium returns a verified, replay hardened result to the Solana program.
              </li>
              <li>
                <strong>Settle</strong> — ShadowPerp updates the margin account and position state from the verified output.
              </li>
            </ol>
            <p>
              Shadow signs directly with your connected Solana wallet. That includes Privy embedded wallets for
              email and social users, and external Solana wallets connected through Privy.
            </p>
            <Note>
              ShadowPerp keeps longer callback wait windows and surfaces on chain callback failures more directly.
              That makes it easier to diagnose what happened and prevents failed opens from looking like indefinite
              pending states.
            </Note>
          </Section>

          <Section id="wallet-connection" title="Wallet Connection">
            <p>
              ShadowPerp now uses a <strong>direct wallet</strong> model. Every trade and collateral action is signed by
              the connected Solana wallet that is active in the app.
            </p>
            <ol>
              <li>
                You can log in with email or social through Privy, which creates an embedded Solana wallet for you.
              </li>
              <li>
                You can also connect an external Solana wallet such as Phantom or Solflare through Privy.
              </li>
              <li>
                Trading and collateral actions are signed directly from that wallet instead of being routed through a
                separate session layer.
              </li>
            </ol>
            <h3>What this means in practice</h3>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Wallet Type</th>
                  <th>Trading Path</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Privy embedded wallet</td>
                  <td>Direct signing in the app</td>
                </tr>
                <tr>
                  <td>External Solana wallet</td>
                  <td>Direct signing through Privy wallet connectors</td>
                </tr>
              </tbody>
            </table>
            <Note>
              The product goal is simple: one wallet source of truth, one signing model, and fewer hidden branches in
              the user flow. That keeps the app easier to reason about for both traders and maintainers.
            </Note>
          </Section>

          <Section id="privacy" title="Privacy Model">
            <p>
              ShadowPerp relies on{" "}
              <a href="https://www.arcium.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>
                Arcium
              </a>
              {" "}as the privacy layer behind every trade. Here is the practical boundary between what stays private and what
              remains visible on chain:
            </p>
            <h3>What is private</h3>
            <ul>
              <li>Position size</li>
              <li>Entry price</li>
              <li>Leverage</li>
              <li>Direction (long or short)</li>
              <li>Margin amount</li>
              <li>Unrealized PnL</li>
            </ul>
            <h3>What is public</h3>
            <ul>
              <li>Your wallet address, used for the margin account and wallet connection</li>
              <li>Token transfers to and from the vault (a Solana constraint)</li>
              <li>The fact that a trade was queued, but none of the details</li>
            </ul>
            <h3>What is becoming private through shielded collateral</h3>
            <ul>
              <li>Internal collateral ownership and allocation</li>
              <li>Margin lock and release transitions</li>
              <li>Per user balance within the protocol</li>
            </ul>
            <Note>
              The reference orderbook pulls live market depth from Binance, Coinbase, Bybit, and Gate.io depending
              on your selected pair. Provider selection runs through the server side reference depth pipeline with
              cached client state as a graceful fallback when a provider is temporarily unreachable. The orderbook
              provides market context only and does not represent ShadowPerp's own liquidity. It does not reveal
              other traders' positions.
            </Note>
          </Section>

          <Section id="margin" title="Margin and Leverage">
            <p>ShadowPerp supports two margin modes and leverage up to <strong>50x</strong>.</p>
            <p>
              The devnet namespace uses a shared collateral model for adopted markets. Once your wallet is migrated
              from any legacy per-market margin accounts, a single owner scoped collateral balance can back positions
              across supported pairs instead of requiring a separate funding bucket per market.
            </p>
            <h3>Cross Margin</h3>
            <p>
              Your full margin balance is shared across all open positions in cross margin mode. If one position loses,
              the rest of the balance absorbs it. This can reduce the chance of a single position getting liquidated
              in isolation, but it also means aggregate losses can draw down the full account.
            </p>
            <h3>Isolated Margin</h3>
            <p>
              A fixed amount of margin is assigned to one position. If that position is liquidated, only that isolated
              amount is at risk. The rest of your balance stays untouched.
            </p>
            <h3>Leverage</h3>
            <p>
              Leverage amplifies both upside and downside relative to your margin. Available range is <Code>1x</Code> to{" "}
              <Code>50x</Code>. Higher leverage means a smaller adverse move can trigger liquidation.
            </p>
            <Note>
              Shared collateral is active on adopted markets but is not automatic for every wallet. If you have legacy
              per-market balances, you will need to run the migration before your collateral behaves as one pool
              across all supported pairs.
            </Note>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Leverage</th>
                  <th>Risk Level</th>
                  <th>Liquidation Sensitivity</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1x to 5x</td>
                  <td>Low</td>
                  <td>Large move required to liquidate</td>
                </tr>
                <tr>
                  <td>10x to 15x</td>
                  <td>Medium</td>
                  <td>Moderate move liquidates</td>
                </tr>
                <tr>
                  <td>20x to 30x</td>
                  <td>High</td>
                  <td>Small adverse move liquidates</td>
                </tr>
                <tr>
                  <td>40x to 50x</td>
                  <td>Very High</td>
                  <td>Minimal move liquidates</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section id="orders" title="Order Types">
            <h3>Market Order</h3>
            <p>
              A market order executes against the current oracle price. The position is queued for MPC computation and
              opens once the Arcium callback returns successfully.
            </p>
            <h3>Limit Order</h3>
            <p>
              A limit order is queued in the browser and triggered when the market price crosses your chosen level.
              When that happens, the app submits the order from your connected wallet.
            </p>
            <Note>
              Limit orders run in the browser right now, which means the tab needs to stay open for them to fire.
              Market order submission is working on devnet and end-to-end open finalization is under active investigation.
            </Note>
          </Section>

          <Section id="tp-sl" title="Take Profit and Stop Loss">
            <p>Each open position can carry optional take profit and stop loss rules. These are stored locally and monitored by the client.</p>
            <ul>
              <li><strong>Take Profit</strong> closes the position when price reaches your upside target.</li>
              <li><strong>Stop Loss</strong> closes the position when price hits your downside protection level.</li>
            </ul>
            <p>
              You can set take profit and stop loss in the trading panel before opening a position, or edit them later
              from the position row. Use the <Code>Save</Code> action to confirm the rule.
            </p>
            <h3>Validation Rules</h3>
            <ul>
              <li>For <strong>long</strong> positions, take profit must be above entry and stop loss must be below entry.</li>
              <li>For <strong>short</strong> positions, take profit must be below entry and stop loss must be above entry.</li>
              <li>Both levels must be at least <Code>0.10%</Code> away from entry price.</li>
            </ul>
          </Section>

          <Section id="liquidation" title="Liquidation">
            <p>
              A position is liquidated when its health ratio falls below the maintenance threshold. The health ratio is
              calculated as:
            </p>
            <p
              style={{
                fontFamily: "monospace",
                background: "rgba(255,255,255,0.04)",
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "13px",
              }}
            >
              Health = (Equity / Maintenance Margin) x 100%
            </p>
            <ul>
              <li><strong>Liquidation threshold</strong> is set per market in basis points and enforced by the on chain program.</li>
              <li><strong>Liquidation penalty</strong> is 5% to the liquidator with the remainder returned to the trader.</li>
            </ul>
            <p>
              In cross margin mode, your full balance acts as equity. In isolated mode, only the allocated margin for
              that position counts.
            </p>
            <Note>
              Liquidation is enforced on chain through Arcium's MPC network. The liquidator never sees your plaintext
              position details.
            </Note>
          </Section>

          <Section id="shielded-collateral" title="Shielded Collateral">
            <p>
              ShadowPerp has the base shielded collateral flow deployed on devnet. Deposits, private withdrawal requests,
              proof verification callbacks, and delayed finalization are all live. The remaining work is private margin
              lock and private position settlement through Arcium MPC.
            </p>
            <h3>How it works</h3>
            <ol>
              <li>
                <strong>Deposit</strong> — You deposit collateral to the vault. The token transfer is public because
                that is a Solana constraint, but the protocol records a private commitment in a Merkle tree instead
                of updating a plaintext balance.
              </li>
              <li>
                <strong>Trade</strong> — Margin lock and release transitions happen through Arcium MPC, consuming and
                producing commitments without revealing your internal balance to anyone.
              </li>
              <li>
                <strong>Withdraw</strong> — You first create a pending withdrawal, then queue an Arcium MPC proof check.
                Finalization only happens after the callback marks the withdrawal as verified and the delay window has passed.
              </li>
            </ol>
            <h3>What stays private</h3>
            <ul>
              <li>Your internal balance within the protocol</li>
              <li>How much margin is allocated to each position</li>
              <li>The connection between deposits and trading activity</li>
            </ul>
            <h3>What remains public</h3>
            <ul>
              <li>Token transfers to and from the vault (a Solana L1 constraint)</li>
              <li>The fact that a deposit or withdrawal happened</li>
              <li>Transaction timestamps</li>
            </ul>
            <Note>
              Shielded collateral deposit, withdrawal request, proof verification callback, and finalization are deployed
              on devnet. The current withdrawal proof is a simplified additive binding MPC check over the claimed amount,
              commitment secret, and nullifier preimage. A full private Merkle membership proof of note ownership is not
              yet implemented. Private margin lock and settle transitions are still in progress.
            </Note>
          </Section>

          <Section id="faq" title="FAQ">
            <h3>Do I need to keep the browser open?</h3>
            <p>
              For market orders, the callback path continues after submission, so you do not need to keep the tab open
              just to keep the request alive. For limit orders, take profit, and stop loss automation, yes.
              Those flows still run in the browser and need the tab to stay open.
            </p>

            <h3>How do I deposit collateral?</h3>
            <p>
              Click <strong>Collateral</strong> in the trading panel, or use the deposit button in the portfolio summary.
              You need to deposit collateral before opening a position. On devnet, you can claim test mUSDC from the
              onboarding flow when you first connect your wallet. It goes straight into your Shadow margin account.
            </p>

            <h3>Why does my position show Queued or Finalizing?</h3>
            <p>
              Both states mean the trade was submitted successfully and is moving through the protected callback path.
              <strong> Queued</strong> means Shadow is waiting for the Arcium MPC callback to return.
              <strong> Finalizing</strong> means the callback completed and the remaining on chain settlement steps are
              finishing. On devnet this typically takes 30 to 120 seconds depending on cluster load. If it takes longer,
              the cluster may be temporarily delayed. Your collateral stays safe and the position will either resolve once
              settlement completes or move to a terminal state if the callback aborts on chain.
            </p>
            <Note>
              Current devnet status: direct wallet trading and direct collateral actions are working across supported
              markets. The open-position callback path is still being debugged on the current namespace.
            </Note>

            <h3>Is my data stored anywhere?</h3>
            <p>
              Trading preferences, automation rules, cached activity, layout preferences, and RPC settings
              are stored in your browser's <Code>localStorage</Code>. On chain position state is always read directly from
              Solana, but the app keeps a few local convenience snapshots so the interface can restore faster.
              Server-backed features like history routes and market data helpers may receive your public wallet address
              when needed to fulfill a request.
            </p>

            <h3>Can I use ShadowPerp on mainnet?</h3>
            <p>
              Not yet. ShadowPerp is devnet only for now. Mainnet deployment depends on a fully verified open and close
              flow, production operational confidence, and a comprehensive audit.
            </p>
          </Section>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "24px", paddingTop: "48px" }}>
            <Section id="privacy-policy" title="Privacy Policy">
              <p><em>Effective: March 2026</em></p>
              <h3>Information We Collect</h3>
              <p>
                ShadowPerp does not require account registration and does not collect personally identifiable information.
                When you connect a wallet, your public key is used only to identify your on-chain margin account and
                trading state. Some server-backed features including wallet history lookups may receive your public
                wallet address in order to fulfill the request, but the product does not create a user profile or
                account around that data.
              </p>
              <p>
                ShadowPerp is not designed to retain plaintext trade inputs as application records, but normal
                operational logs and hosting telemetry may still capture request metadata during debugging or incident
                handling.
              </p>
              <h3>Cookies and Local Storage</h3>
              <p>
                ShadowPerp stores automation rules, theme and layout preferences, RPC preferences, activity cache
                entries, and some UI convenience metadata in your browser's <Code>localStorage</Code>.
                This data stays on your device unless a specific server-backed feature needs your public wallet address
                or encrypted payload to complete the request. No third party tracking cookies are used.
              </p>
              <h3>Blockchain Data</h3>
              <p>
                Solana transactions are public by nature. ShadowPerp minimizes what is written on chain by keeping position
                details encrypted and recording only settlement outputs. Collateral deposits and withdrawals still
                involve public USDC transfers.
              </p>
              <h3>Third Party Services</h3>
              <p>
                ShadowPerp uses Pyth Network for primary oracle price feeds, with public APIs from Coinbase and Binance for
                reference data. ShadowPerp does not intentionally send personal profile data to these services.
                Arcium processes encrypted trade inputs, and individual MPC nodes do not get access to the plaintext data.
              </p>
              <h3>Contact</h3>
              <p>
                Questions about privacy can be sent to{" "}
                <a href="https://x.com/emperoar007" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>
                  @emperoar007
                </a>
                {" "}on X.
              </p>
            </Section>

            <Section id="terms" title="Terms of Use">
              <p><em>Effective: March 2026</em></p>
              <h3>Acceptance</h3>
              <p>By accessing ShadowPerp, you agree to these terms. If you do not agree, please do not use the platform.</p>
              <h3>Prototype Status</h3>
              <p>
                ShadowPerp is an experimental prototype deployed on Solana Devnet. All balances are test funds with no real
                monetary value. Do not send real assets to devnet addresses. The protocol should not be treated as fully
                live until end-to-end open and close are both signed off on the active namespace.
              </p>
              <h3>No Financial Advice</h3>
              <p>
                Nothing on ShadowPerp is financial, investment, or trading advice. Perpetual futures carry meaningful risk.
                You are responsible for your own trading decisions.
              </p>
              <h3>Prohibited Use</h3>
              <ul>
                <li>Using ShadowPerp to launder funds or bypass financial regulation</li>
                <li>Attempting to exploit, manipulate, or attack the protocol</li>
                <li>Reverse engineering the encrypted computation system</li>
                <li>Accessing ShadowPerp from jurisdictions where this type of service is prohibited</li>
              </ul>
              <h3>Limitation of Liability</h3>
              <p>
                ShadowPerp is provided "as is" without warranty. The developers are not liable for loss of funds, data, or
                opportunity arising from use of the platform, including smart contract bugs, MPC failures, or network
                disruptions.
              </p>
              <h3>Changes</h3>
              <p>These terms may be updated over time. Continued use after changes means you accept the revised terms.</p>
            </Section>

            <Section id="cookies" title="Cookie Policy">
              <p><em>Effective: March 2026</em></p>
              <h3>What We Use</h3>
              <p>ShadowPerp does not use traditional HTTP cookies for tracking or analytics.</p>
              <p>We do use browser <Code>localStorage</Code> for a few practical product features:</p>
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Purpose</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Code>shadow-theme</Code></td>
                    <td>Light or dark mode preference</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp:ui:margin-mode:v1:*</Code></td>
                    <td>Margin mode preference per wallet</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp:automation:v1:*</Code></td>
                    <td>Limit orders and TP or SL rules per wallet</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp:posviews:v1:*</Code></td>
                    <td>UI convenience snapshots of decrypted position views keyed by wallet</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp-trading-settings</Code></td>
                    <td>Trading settings such as slippage and default leverage</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp-selected-pair</Code></td>
                    <td>Last selected trading pair</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp.rpc.endpoints</Code></td>
                    <td>Saved custom RPC endpoint list</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp.rpc.override</Code> / <Code>shadowperp.rpc.index</Code></td>
                    <td>Active RPC override and selected endpoint preference</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp-panel-visibility</Code></td>
                    <td>Layout panel visibility preferences</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp-layout-locked</Code> / <Code>shadowperp-layout-v7</Code></td>
                    <td>Saved terminal layout lock state and grid arrangement</td>
                    <td>Persistent</td>
                  </tr>
                  <tr>
                    <td><Code>shadowperp:ui:activity:v2:*</Code></td>
                    <td>Cached wallet activity labels used by the wallet popup</td>
                    <td>Rolling local cache</td>
                  </tr>
                </tbody>
              </table>
              <h3>Third Party Cookies</h3>
              <p>
                No third party analytics, advertising, or tracking cookies are used. External APIs may set their own
                cookies if you visit them directly, but ShadowPerp only uses their public endpoints on the server
                side.
              </p>
              <h3>Clearing Your Data</h3>
              <p>
                You can clear all ShadowPerp local data through your browser developer tools by clearing{" "}
                <Code>localStorage</Code> for the ShadowPerp domain, or by using your browser's clear site data option.
              </p>
            </Section>
          </div>

          <Link href="/" className="docs-back">
            Back to homepage
          </Link>
        </main>
      </div>
    </>
  );
}
