import Head from "next/head";
import Link from "next/link";

const NAV = [
  { group: "Guide", items: [
    { id: "overview", label: "Overview" },
    { id: "how-it-works", label: "How It Works" },
    { id: "session-trading", label: "Session Trading" },
    { id: "privacy", label: "Privacy Model" },
    { id: "margin", label: "Margin & Leverage" },
    { id: "orders", label: "Order Types" },
    { id: "tp-sl", label: "TP / SL" },
    { id: "liquidation", label: "Liquidation" },
    { id: "faq", label: "FAQ" },
  ]},
  { group: "Legal", items: [
    { id: "privacy-policy", label: "Privacy Policy" },
    { id: "terms", label: "Terms of Use" },
    { id: "cookies", label: "Cookie Policy" },
  ]},
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
        <title>Documentation — Shadow</title>
        <meta name="description" content="Shadow perpetuals documentation: privacy model, session trading, margin, leverage, and more." />
      </Head>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #e2e8f0; font-family: 'Inter', -apple-system, sans-serif; }

        .docs-layout {
          display: flex;
          min-height: 100vh;
        }

        /* Sidebar */
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
          gap: 8px;
          padding: 0 20px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-decoration: none;
          color: #f1f5f9;
          font-size: 15px;
          font-weight: 700;
        }
        .docs-sidebar-logo-svg {
          width: 28px; height: 28px; flex-shrink: 0;
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

        /* Main content */
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

        /* Back to top */
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
        {/* Sidebar */}
        <aside className="docs-sidebar">
          <Link href="/" className="docs-sidebar-logo">
            <svg viewBox="0 0 100 100" className="docs-sidebar-logo-svg" aria-hidden="true">
              <defs>
                <linearGradient id="docs-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 1 }} />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="40" fill="url(#docs-logo-grad)" />
              <circle cx="62" cy="38" r="41" fill="#0a0a0f" />
            </svg>
            Shadow
          </Link>
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="docs-sidebar-section">{group.group}</div>
              {group.items.map((item) => (
                <a key={item.id} href={`#${item.id}`}>{item.label}</a>
              ))}
            </div>
          ))}
          <div style={{ marginTop: "24px", padding: "0 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <Link href="/" style={{
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
            }}>
              ← Home
            </Link>
            <Link href="/app" style={{
              display: "block",
              background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#fff",
              textDecoration: "none",
              textAlign: "center",
            }}>
              Launch App →
            </Link>
          </div>
        </aside>

        {/* Main */}
        <main className="docs-main">
          <div className="docs-header">
            <h1>Shadow Documentation</h1>
            <p>
              Shadow is a privacy-first perpetual futures exchange built on Solana.
              Trade with encrypted positions, delegated sessions, and on-chain privacy powered by Arcium MPC.
            </p>
          </div>

          <Section id="overview" title="Overview">
            <p>
              Shadow lets you trade perpetual futures without exposing your position details on-chain.
              Your trade size, direction, leverage, and margin are encrypted before being sent to the Solana program.
              The computation (risk checks, PnL settlement) happens inside Arcium's confidential compute cluster.
            </p>
            <p>
              Only the minimum necessary public state is written on-chain — no plaintext positions, no public intent disclosure.
            </p>
            <Note>
              Shadow is currently deployed on <strong>Solana Devnet</strong> as an active prototype.
              All balances and positions are test funds only.
            </Note>
          </Section>

          <Section id="how-it-works" title="How It Works">
            <p>Every trade on Shadow goes through a 5-step privacy pipeline:</p>
            <ol>
              <li><strong>Encrypt</strong> — your browser encrypts the trade inputs (size, price, leverage, direction) using the MPC cluster's public key.</li>
              <li><strong>Queue</strong> — the encrypted payload is submitted to the Solana program, which queues a computation on Arcium.</li>
              <li><strong>Compute</strong> — Arcium's MPC nodes decrypt and evaluate the trade logic (margin checks, PnL, liquidation) entirely in secret shares — no single node ever sees the plaintext.</li>
              <li><strong>Callback</strong> — Arcium delivers the verified result back to the Solana program on-chain.</li>
              <li><strong>Settle</strong> — the program updates your position and margin account based on the verified output.</li>
            </ol>
            <p>
              The relay server submits trades on your behalf after your initial session approval —
              so you only sign once per session, not once per trade.
            </p>
          </Section>

          <Section id="session-trading" title="Session Trading">
            <p>
              Shadow uses a <strong>delegated session</strong> model to eliminate per-trade wallet popups.
              Here's what happens when you first trade:
            </p>
            <ol>
              <li>You sign a <strong>CreateTradeSession</strong> transaction — this creates an on-chain session PDA linked to your wallet and the relay.</li>
              <li>You sign a short <strong>authorization message</strong> (not a transaction) — this proves you authorized the relay to open positions on your behalf for the session duration.</li>
              <li>For every subsequent trade within the session, the relay submits the transaction without requiring a wallet popup.</li>
            </ol>
            <h3>Session Limits</h3>
            <table className="docs-table">
              <thead><tr><th>Parameter</th><th>Default</th></tr></thead>
              <tbody>
                <tr><td>Session duration</td><td>7 days</td></tr>
                <tr><td>Max actions</td><td>200 trades</td></tr>
                <tr><td>Max margin per action</td><td>$1,000 USDC</td></tr>
                <tr><td>Revocable</td><td>Yes — anytime on-chain</td></tr>
              </tbody>
            </table>
            <Note>
              The session authorization signature is scoped to a specific session ID, market, and expiry.
              It cannot be reused across sessions or markets.
            </Note>
          </Section>

          <Section id="privacy" title="Privacy Model">
            <p>
              Shadow's privacy guarantees come from <a href="https://www.arcium.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>Arcium</a>'s
              Multi-Party Computation (MPC) infrastructure. Here's what is and isn't private:
            </p>
            <h3>What is private</h3>
            <ul>
              <li>Position size</li>
              <li>Entry price</li>
              <li>Leverage</li>
              <li>Direction (long/short)</li>
              <li>Margin amount</li>
              <li>Unrealized PnL</li>
            </ul>
            <h3>What is public</h3>
            <ul>
              <li>Your wallet address (used for margin account and session)</li>
              <li>Collateral deposits and withdrawals (USDC transfers are on-chain)</li>
              <li>The fact that a trade was queued (not the details)</li>
              <li>Session creation and revocation</li>
            </ul>
            <Note>
              The reference orderbook shown in the terminal is external depth from Coinbase/Binance —
              it is not Shadow's own venue liquidity and does not reflect other traders' positions.
            </Note>
          </Section>

          <Section id="margin" title="Margin & Leverage">
            <p>
              Shadow supports two margin modes and leverage up to <strong>50x</strong>.
            </p>
            <h3>Cross Margin</h3>
            <p>
              Your entire margin balance is shared across all cross-margin positions.
              If one position loses, the remaining balance absorbs it — reducing liquidation risk on individual positions
              but exposing your full balance to aggregate losses.
            </p>
            <h3>Isolated Margin</h3>
            <p>
              A fixed margin amount is allocated per position. If the position is liquidated,
              only that isolated margin is at risk — the rest of your balance is unaffected.
            </p>
            <h3>Leverage</h3>
            <p>
              Leverage amplifies both gains and losses relative to your margin. Available range: <Code>1x</Code> to <Code>50x</Code>.
            </p>
            <table className="docs-table">
              <thead><tr><th>Leverage</th><th>Risk Level</th><th>Liquidation Sensitivity</th></tr></thead>
              <tbody>
                <tr><td>1x – 5x</td><td>Low</td><td>Large move required to liquidate</td></tr>
                <tr><td>10x – 15x</td><td>Medium</td><td>Moderate move liquidates</td></tr>
                <tr><td>20x – 30x</td><td>High</td><td>Small adverse move liquidates</td></tr>
                <tr><td>40x – 50x</td><td>Very High</td><td>Minimal move liquidates</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="orders" title="Order Types">
            <h3>Market Order</h3>
            <p>
              Executes immediately at the current oracle price. The position is queued for MPC computation
              and opened once the Arcium callback is received.
            </p>
            <h3>Limit Order</h3>
            <p>
              Queued client-side and triggered automatically when the market price crosses your specified limit price.
              Limit orders are stored in your browser and executed via the relay when the condition is met.
            </p>
            <Note>
              Limit orders are client-side only in the current prototype — they require the browser tab to be open to trigger.
            </Note>
          </Section>

          <Section id="tp-sl" title="Take Profit / Stop Loss">
            <p>
              Each open position supports optional TP and SL rules. These are stored locally and monitored by the client.
            </p>
            <ul>
              <li><strong>Take Profit (TP)</strong> — automatically closes the position when price reaches your target.</li>
              <li><strong>Stop Loss (SL)</strong> — automatically closes the position when price drops to your limit.</li>
            </ul>
            <p>
              Set TP/SL directly in the position table or in the trading panel before opening.
              Use the <Code>Save</Code> button in the position row to persist a rule.
            </p>
            <h3>Validation Rules</h3>
            <ul>
              <li>For <strong>long</strong> positions: TP must be above entry, SL must be below entry.</li>
              <li>For <strong>short</strong> positions: TP must be below entry, SL must be above entry.</li>
              <li>TP and SL must be at least <Code>0.10%</Code> away from entry price.</li>
            </ul>
          </Section>

          <Section id="liquidation" title="Liquidation">
            <p>
              A position is liquidated when its health ratio falls below the maintenance threshold.
              The health ratio is calculated as:
            </p>
            <p style={{ fontFamily: "monospace", background: "rgba(255,255,255,0.04)", padding: "12px 16px", borderRadius: "8px", fontSize: "13px" }}>
              Health = (Equity / Maintenance Margin) × 100%
            </p>
            <ul>
              <li><strong>Maintenance margin</strong>: 5% of position value</li>
              <li><strong>Liquidation threshold</strong>: 80% health (configurable per market)</li>
              <li><strong>Liquidation penalty</strong>: 5% to liquidator, remainder returned to trader</li>
            </ul>
            <p>
              In cross margin mode, your full balance acts as equity. In isolated mode, only the position's
              allocated margin counts.
            </p>
            <Note>
              Liquidation is enforced on-chain via Arcium's confidential compute — the liquidator never
              sees your plaintext position details.
            </Note>
          </Section>

          <Section id="faq" title="FAQ">
            <h3>Do I need to keep the browser open?</h3>
            <p>
              For market orders — no. Once submitted, the relay handles execution.
              For limit orders and TP/SL automation — yes, these run client-side and require the tab to be open.
            </p>

            <h3>How do I deposit collateral?</h3>
            <p>
              Click <strong>Manage</strong> in the top bar (or <strong>Deposit</strong> if your balance is zero).
              You can deposit USDC directly or via a delegated session. Devnet USDC faucet: use the Solana devnet faucet at <Code>spl-token</Code> level.
            </p>

            <h3>Why does my position show "MPC Processing"?</h3>
            <p>
              The trade was submitted successfully and is waiting for the Arcium MPC cluster to compute and deliver the callback.
              This typically takes a few seconds on devnet. If it persists, the cluster may be delayed — your collateral remains safe.
            </p>

            <h3>Is my data stored anywhere?</h3>
            <p>
              Position metadata (pair, side, leverage) is stored in your browser's <Code>localStorage</Code> keyed
              to your wallet address. No personal data is sent to any server other than the relay, which only
              receives encrypted trade inputs.
            </p>

            <h3>Can I use Shadow on mainnet?</h3>
            <p>
              Shadow is currently devnet-only. Mainnet launch depends on successful end-to-end validation of
              the Arcium MPC pipeline and a full audit.
            </p>
          </Section>

          {/* LEGAL */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "24px", paddingTop: "48px" }}>
            <Section id="privacy-policy" title="Privacy Policy">
              <p><em>Effective: March 2026</em></p>
              <h3>Information We Collect</h3>
              <p>
                Shadow does not require account registration and does not collect personally identifiable information.
                When you connect a wallet, your public key is used solely to identify your on-chain margin account and
                trading session. We do not store wallet addresses on any server.
              </p>
              <p>
                The relay server receives encrypted trade inputs (size, price, leverage, direction) and your session
                authorization signature. These are used only to submit transactions on your behalf and are not logged
                or retained after the transaction is submitted.
              </p>
              <h3>Cookies &amp; Local Storage</h3>
              <p>
                Shadow stores position metadata (pair, side, leverage) and session information in your browser's
                <Code>localStorage</Code>. This data never leaves your device except as part of relay requests.
                No third-party tracking cookies are used.
              </p>
              <h3>Blockchain Data</h3>
              <p>
                All on-chain transactions are public by nature of the Solana blockchain. Shadow minimizes what is
                written on-chain — position details are encrypted and only settlement outputs are recorded.
                Collateral deposits and withdrawals involve public USDC token transfers.
              </p>
              <h3>Third-Party Services</h3>
              <p>
                Shadow uses Coinbase and Binance public APIs for reference price data. No user data is sent to
                these services. Arcium's MPC infrastructure processes encrypted trade inputs — individual nodes
                never have access to plaintext data.
              </p>
              <h3>Contact</h3>
              <p>
                Questions about privacy? Reach out via <a href="https://x.com/emperoar007" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>@emperoar007</a> on X.
              </p>
            </Section>

            <Section id="terms" title="Terms of Use">
              <p><em>Effective: March 2026</em></p>
              <h3>Acceptance</h3>
              <p>
                By accessing Shadow you agree to these terms. If you do not agree, do not use the platform.
              </p>
              <h3>Prototype Status</h3>
              <p>
                Shadow is an experimental prototype deployed on Solana Devnet. All balances are test funds with no
                real monetary value. Do not send real assets to devnet addresses.
              </p>
              <h3>No Financial Advice</h3>
              <p>
                Nothing on Shadow constitutes financial, investment, or trading advice. Perpetual futures carry
                significant risk of loss. You are solely responsible for your trading decisions.
              </p>
              <h3>Prohibited Use</h3>
              <ul>
                <li>Using Shadow to launder funds or circumvent financial regulations</li>
                <li>Attempting to exploit, manipulate, or attack the protocol</li>
                <li>Reverse engineering the encrypted computation system</li>
                <li>Accessing Shadow from jurisdictions where such services are prohibited</li>
              </ul>
              <h3>Limitation of Liability</h3>
              <p>
                Shadow is provided "as is" without warranty. The developers are not liable for any loss of funds,
                data, or opportunity arising from use of the platform, including smart contract bugs, MPC failures,
                or network disruptions.
              </p>
              <h3>Changes</h3>
              <p>
                These terms may be updated at any time. Continued use after changes constitutes acceptance.
              </p>
            </Section>

            <Section id="cookies" title="Cookie Policy">
              <p><em>Effective: March 2026</em></p>
              <h3>What We Use</h3>
              <p>Shadow does not use traditional HTTP cookies for tracking or analytics.</p>
              <p>We use browser <Code>localStorage</Code> for the following functional purposes:</p>
              <table className="docs-table">
                <thead><tr><th>Key</th><th>Purpose</th><th>Expires</th></tr></thead>
                <tbody>
                  <tr><td><Code>shadow-theme</Code></td><td>Light/dark mode preference</td><td>Persistent</td></tr>
                  <tr><td><Code>shadowperp.relay.session.v1</Code></td><td>Active trading session info</td><td>Session expiry</td></tr>
                  <tr><td><Code>shadowperp:positions:*</Code></td><td>Position metadata (pair, side, leverage)</td><td>Persistent</td></tr>
                  <tr><td><Code>shadowperp:ui:margin-mode:*</Code></td><td>Margin mode preference per wallet</td><td>Persistent</td></tr>
                  <tr><td><Code>shadowperp:automation:*</Code></td><td>Limit orders and TP/SL rules</td><td>Persistent</td></tr>
                </tbody>
              </table>
              <h3>Third-Party Cookies</h3>
              <p>
                No third-party analytics, advertising, or tracking cookies are used.
                External APIs (Coinbase, Binance) may set their own cookies if accessed directly,
                but Shadow only uses their public REST endpoints server-side.
              </p>
              <h3>Clearing Your Data</h3>
              <p>
                You can clear all Shadow local data by opening your browser's developer tools and clearing
                <Code>localStorage</Code> for the Shadow domain, or by using your browser's "Clear site data" option.
              </p>
            </Section>
          </div>

          <Link href="/" className="docs-back">
            ← Back to homepage
          </Link>
        </main>
      </div>
    </>
  );
}
