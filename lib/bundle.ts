import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

// Launchpad program IDs (for labelling the source of the launch)
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
// Raydium LaunchLab (what letsbonk / bonk tokens launch on)
const RAYDIUM_LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

export type BundleResult = {
  analyzed: boolean;
  launchpad?: string;
  launchSlot?: number;
  bundleWallets?: number;
  bundledPct?: number;
  status: "safe" | "warn" | "danger" | "unknown";
  detail: string;
};

// Page back to the oldest signatures (the launch). Bounded so we never hammer
// the RPC — bundle detection targets recent launches, which reach the start fast.
async function oldestPage(conn: Connection, mint: PublicKey, maxPages = 40) {
  let before: string | undefined = undefined;
  let page: Awaited<ReturnType<Connection["getSignaturesForAddress"]>> = [];
  let reachedStart = false;
  for (let i = 0; i < maxPages; i++) {
    const batch = await conn.getSignaturesForAddress(mint, { limit: 1000, before });
    if (batch.length === 0) {
      reachedStart = true;
      break;
    }
    page = batch;
    if (batch.length < 1000) {
      reachedStart = true;
      break;
    }
    before = batch[batch.length - 1].signature;
    await new Promise((r) => setTimeout(r, 110));
  }
  return { page, reachedStart };
}

export async function detectBundle(mintStr: string): Promise<BundleResult> {
  try {
    const conn = new Connection(RPC, "confirmed");
    const mint = new PublicKey(mintStr);

    // total supply (for the bundled-% denominator)
    const info = await conn.getParsedAccountInfo(mint);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = info.value?.data as any;
    const decimals = md?.parsed?.info?.decimals ?? 0;
    const supply = md?.parsed?.info?.supply
      ? Number(md.parsed.info.supply) / Math.pow(10, decimals)
      : 0;

    const { page, reachedStart } = await oldestPage(conn, mint);
    if (!reachedStart || page.length === 0) {
      return {
        analyzed: false,
        status: "unknown",
        detail:
          "This token has traded too much to reach its launch block on the current RPC — bundle detection works best on freshly-launched tokens (check them early).",
      };
    }

    // earliest transactions, chronological
    const earliest = [...page]
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .slice(0, 20);
    const launchSlot = earliest[0]?.slot ?? 0;
    // Fetch transactions ONE at a time — the Helius free tier rejects JSON-RPC
    // batches (which getParsedTransactions uses). Pace single calls under the limit.
    const txns: Awaited<ReturnType<Connection["getParsedTransaction"]>>[] = [];
    for (const s of earliest) {
      try {
        txns.push(
          await conn.getParsedTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
          })
        );
      } catch {
        txns.push(null);
      }
      await new Promise((r) => setTimeout(r, 130));
    }

    // identify the launchpad from programs touched in the first txns
    let launchpad = "Unknown launchpad";
    const programs = new Set<string>();
    for (const tx of txns) {
      for (const k of tx?.transaction.message.accountKeys ?? []) {
        programs.add(k.pubkey.toBase58());
      }
    }
    if (programs.has(PUMP_FUN) || programs.has(PUMP_AMM)) launchpad = "pump.fun";
    else if (programs.has(RAYDIUM_LAUNCHLAB)) launchpad = "Raydium LaunchLab (bonk)";

    // sum tokens received per owner within the launch block window
    const window = new Set([launchSlot, launchSlot + 1, launchSlot + 2]);
    const received = new Map<string, number>();
    for (const tx of txns) {
      if (!tx || tx.slot == null || !window.has(tx.slot)) continue;
      const delta = new Map<string, number>();
      for (const b of tx.meta?.postTokenBalances ?? []) {
        if (b.mint !== mintStr || !b.owner) continue;
        delta.set(b.owner, (delta.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
      }
      for (const b of tx.meta?.preTokenBalances ?? []) {
        if (b.mint !== mintStr || !b.owner) continue;
        delta.set(b.owner, (delta.get(b.owner) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
      }
      for (const [owner, d] of delta) {
        if (d > 0) received.set(owner, (received.get(owner) ?? 0) + d);
      }
    }

    // drop the single largest receiver — that's the bonding curve / pool vault
    // that the initial supply is minted into, not a buyer.
    const sorted = [...received.entries()].sort((a, b) => b[1] - a[1]);
    const buyers = sorted.slice(1);
    const bundleWallets = buyers.length;
    const bundledAmt = buyers.reduce((s, [, a]) => s + a, 0);
    const bundledPct = supply ? (bundledAmt / supply) * 100 : 0;

    let status: BundleResult["status"];
    let detail: string;
    if (bundleWallets >= 5 && bundledPct >= 25) {
      status = "danger";
      detail = `Likely BUNDLED — ${bundleWallets} wallets grabbed ${bundledPct.toFixed(
        1
      )}% of supply in the launch block. High dump risk.`;
    } else if (bundleWallets >= 3 && bundledPct >= 8) {
      status = "warn";
      detail = `Possible bundle — ${bundleWallets} wallets took ${bundledPct.toFixed(
        1
      )}% of supply at launch.`;
    } else {
      status = "safe";
      detail = `Low bundle signal — ${bundleWallets} early wallet(s) holding ${bundledPct.toFixed(
        1
      )}% from the launch block.`;
    }

    return { analyzed: true, launchpad, launchSlot, bundleWallets, bundledPct, status, detail };
  } catch {
    return {
      analyzed: false,
      status: "unknown",
      detail: "Bundle analysis hit an RPC limit — try again in a moment.",
    };
  }
}
