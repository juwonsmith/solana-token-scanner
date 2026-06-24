import { Connection, PublicKey } from "@solana/web3.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const RAYDIUM_LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

export type BundleResult = {
  analyzed: boolean;
  launchpad?: string;
  launchSlot?: number;
  bundleWallets?: number;
  bundledPct?: number;
  status: "safe" | "warn" | "danger" | "unknown";
  detail: string;
  /** which method produced the result */
  source?: "rugcheck" | "onchain";
};

function verdict(pct: number, wallets: number) {
  if (pct >= 25 || wallets >= 6) return "danger" as const;
  if (pct >= 8 || wallets >= 3) return "warn" as const;
  return "safe" as const;
}

// ── Primary: RugCheck's indexed insider/bundle networks (works for busy tokens) ──
async function fromRugcheck(mint: string): Promise<BundleResult | null> {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: { "User-Agent": "token-safety-scanner", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const r: any = await res.json();

    const networks: any[] = Array.isArray(r?.insiderNetworks) ? r.insiderNetworks : [];
    const decimals: number = r?.token?.decimals ?? 0;
    const supply: number = r?.token?.supply
      ? Number(r.token.supply) / Math.pow(10, decimals)
      : 0;
    const launchpad: string | undefined = r?.launchpad?.name;

    // no insider networks indexed → genuinely clean
    if (networks.length === 0 && !r?.graphInsidersDetected) {
      return {
        analyzed: true,
        launchpad,
        bundleWallets: 0,
        bundledPct: 0,
        status: "safe",
        detail: "No insider / bundle networks detected (RugCheck index).",
        source: "rugcheck",
      };
    }

    const wallets =
      networks.reduce((s, n) => s + (n?.size ?? n?.activeAccounts ?? 0), 0) ||
      r?.graphInsidersDetected ||
      0;
    const amount =
      networks.reduce((s, n) => s + (Number(n?.tokenAmount) || 0), 0) /
      Math.pow(10, decimals);
    const pct = supply ? (amount / supply) * 100 : 0;
    const status = verdict(pct, wallets);

    const detail =
      status === "danger"
        ? `Likely BUNDLED — ${wallets} insider wallets across ${networks.length} network(s) hold ${pct.toFixed(
            1
          )}% of supply. High dump risk.`
        : status === "warn"
        ? `Possible bundle — ${wallets} insider wallets across ${networks.length} network(s) hold ${pct.toFixed(
            1
          )}% of supply.`
        : `Low bundle signal — ${wallets} insider wallet(s) holding ${pct.toFixed(1)}% of supply.`;

    return {
      analyzed: true,
      launchpad,
      bundleWallets: wallets,
      bundledPct: pct,
      status,
      detail,
      source: "rugcheck",
    };
  } catch {
    return null;
  }
}

// ── Fallback: on-chain launch-block trace (for brand-new tokens not yet indexed) ──
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

async function fromLaunchTrace(mintStr: string): Promise<BundleResult> {
  try {
    const conn = new Connection(RPC, "confirmed");
    const mint = new PublicKey(mintStr);

    const info = await conn.getParsedAccountInfo(mint);
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
          "This token has traded too much to reach its launch block, and isn't in the bundle index yet — try again shortly.",
        source: "onchain",
      };
    }

    const earliest = [...page].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).slice(0, 20);
    const launchSlot = earliest[0]?.slot ?? 0;
    const txns: Awaited<ReturnType<Connection["getParsedTransaction"]>>[] = [];
    for (const s of earliest) {
      try {
        txns.push(
          await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
        );
      } catch {
        txns.push(null);
      }
      await new Promise((r) => setTimeout(r, 130));
    }

    let launchpad = "Unknown launchpad";
    const programs = new Set<string>();
    for (const tx of txns) {
      for (const k of tx?.transaction.message.accountKeys ?? []) {
        programs.add(k.pubkey.toBase58());
      }
    }
    if (programs.has(PUMP_FUN) || programs.has(PUMP_AMM)) launchpad = "pump.fun";
    else if (programs.has(RAYDIUM_LAUNCHLAB)) launchpad = "Raydium LaunchLab (bonk)";

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
      for (const [owner, d] of delta) if (d > 0) received.set(owner, (received.get(owner) ?? 0) + d);
    }

    const sorted = [...received.entries()].sort((a, b) => b[1] - a[1]);
    const buyers = sorted.slice(1); // drop the bonding curve / pool vault
    const bundleWallets = buyers.length;
    const bundledAmt = buyers.reduce((s, [, a]) => s + a, 0);
    const bundledPct = supply ? (bundledAmt / supply) * 100 : 0;
    const status = verdict(bundledPct, bundleWallets);
    const detail =
      status === "danger"
        ? `Likely BUNDLED — ${bundleWallets} wallet(s) grabbed ${bundledPct.toFixed(1)}% of supply in the launch block. High dump risk.`
        : status === "warn"
        ? `Possible bundle — ${bundleWallets} wallet(s) took ${bundledPct.toFixed(1)}% of supply at launch.`
        : `Low bundle signal — ${bundleWallets} early wallet(s) holding ${bundledPct.toFixed(1)}% from the launch block.`;

    return { analyzed: true, launchpad, launchSlot, bundleWallets, bundledPct, status, detail, source: "onchain" };
  } catch {
    return {
      analyzed: false,
      status: "unknown",
      detail: "Bundle analysis hit an RPC limit — try again in a moment.",
      source: "onchain",
    };
  }
}

export async function detectBundle(mintStr: string): Promise<BundleResult> {
  // RugCheck's index handles any token (incl. busy ones); fall back to the
  // on-chain launch trace for brand-new tokens it hasn't indexed yet.
  const rc = await fromRugcheck(mintStr);
  if (rc) return rc;
  return fromLaunchTrace(mintStr);
}
