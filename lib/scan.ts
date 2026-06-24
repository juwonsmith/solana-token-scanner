import { Connection, PublicKey } from "@solana/web3.js";

// Public RPC works for a demo but is rate-limited — set SOLANA_RPC (e.g. a
// free Helius/QuickNode endpoint) in production for reliability.
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

export type CheckStatus = "safe" | "warn" | "danger" | "unknown";

export type Check = {
  label: string;
  status: CheckStatus;
  detail: string;
};

export type Holder = {
  address: string;
  uiAmount: number;
  pct: number;
};

export type ScanReport = {
  address: string;
  name?: string;
  symbol?: string;
  logoURI?: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  topHolders: Holder[];
  top1Pct: number;
  top10Pct: number;
  checks: Check[];
  /** 0 = safe, higher = riskier */
  riskScore: number;
  verdict: "Looks Safe" | "Caution" | "High Risk";
};

async function fetchMeta(mint: string) {
  // Prefer Helius DAS getAsset — reliable on the free tier for name/symbol/logo
  if (RPC.includes("helius")) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "meta",
          method: "getAsset",
          params: { id: mint },
        }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      const a = j?.result;
      const name = a?.content?.metadata?.name as string | undefined;
      const symbol = a?.content?.metadata?.symbol as string | undefined;
      const logoURI = (a?.content?.links?.image || a?.content?.files?.[0]?.uri) as
        | string
        | undefined;
      if (name || symbol) return { name, symbol, logoURI };
    } catch {
      /* fall back to Jupiter */
    }
  }
  for (const url of [
    `https://lite-api.jup.ag/tokens/v1/token/${mint}`,
    `https://tokens.jup.ag/token/${mint}`,
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = await res.json();
      if (j?.name || j?.symbol) {
        return { name: j?.name, symbol: j?.symbol, logoURI: j?.logoURI };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

// getTokenLargestAccounts is heavy/indexed — retry transient "overloaded" errors
async function largestWithRetry(conn: Connection, mint: PublicKey, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await conn.getTokenLargestAccounts(mint);
    } catch {
      if (i === tries - 1) return null;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return null;
}

export async function scanToken(rawAddress: string): Promise<ScanReport> {
  const address = rawAddress.trim();
  let mint: PublicKey;
  try {
    mint = new PublicKey(address);
  } catch {
    throw new Error("That doesn't look like a valid Solana address.");
  }

  const conn = new Connection(RPC, "confirmed");

  const [info, largest, meta] = await Promise.all([
    conn.getParsedAccountInfo(mint),
    largestWithRetry(conn, mint),
    fetchMeta(address),
  ]);

  if (!info.value) throw new Error("No account found for that address on mainnet.");
  const data = info.value.data as unknown as {
    program?: string;
    parsed?: { type?: string; info?: Record<string, unknown> };
  };
  if (data?.program !== "spl-token" || data?.parsed?.type !== "mint") {
    throw new Error("That address is not an SPL token mint.");
  }

  const p = data.parsed!.info as {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    decimals: number;
    supply: string;
  };

  const decimals = p.decimals;
  const supply = Number(p.supply) / Math.pow(10, decimals);
  const mintAuthority = p.mintAuthority ?? null;
  const freezeAuthority = p.freezeAuthority ?? null;

  const holderDataAvailable = (largest?.value?.length ?? 0) > 0;
  const topHolders: Holder[] = (largest?.value ?? []).slice(0, 10).map((h) => {
    const ui = h.uiAmount ?? Number(h.amount) / Math.pow(10, decimals);
    return { address: h.address.toBase58(), uiAmount: ui, pct: supply ? (ui / supply) * 100 : 0 };
  });
  const top1Pct = topHolders[0]?.pct ?? 0;
  const top10Pct = topHolders.reduce((s, h) => s + h.pct, 0);

  const checks: Check[] = [
    {
      label: "Mint authority",
      status: mintAuthority ? "danger" : "safe",
      detail: mintAuthority
        ? "Active — the owner can mint unlimited new supply and dilute holders."
        : "Revoked — total supply is fixed and can't be inflated.",
    },
    {
      label: "Freeze authority",
      status: freezeAuthority ? "danger" : "safe",
      detail: freezeAuthority
        ? "Active — the owner can freeze your tokens, blocking you from selling."
        : "Revoked — your tokens can never be frozen.",
    },
    ...(holderDataAvailable
      ? ([
          {
            label: "Largest holder",
            status: (top1Pct > 50 ? "danger" : top1Pct > 20 ? "warn" : "safe") as CheckStatus,
            detail: `${top1Pct.toFixed(1)}% of supply held by a single account${
              top1Pct > 50 ? " — extreme concentration / dump risk." : "."
            }`,
          },
          {
            label: "Top 10 concentration",
            status: (top10Pct > 80 ? "danger" : top10Pct > 50 ? "warn" : "safe") as CheckStatus,
            detail: `${top10Pct.toFixed(1)}% of supply held by the top 10 accounts.`,
          },
        ] as Check[])
      : ([
          {
            label: "Holder distribution",
            status: "unknown" as CheckStatus,
            detail:
              "Unavailable on this RPC — set a Helius/QuickNode SOLANA_RPC for holder-concentration analysis.",
          },
        ] as Check[])),
  ];

  const riskScore =
    checks.filter((c) => c.status === "danger").length * 2 +
    checks.filter((c) => c.status === "warn").length;
  const verdict =
    riskScore >= 2 ? "High Risk" : riskScore >= 1 ? "Caution" : "Looks Safe";

  return {
    address,
    name: meta?.name,
    symbol: meta?.symbol,
    logoURI: meta?.logoURI,
    decimals,
    supply,
    mintAuthority,
    freezeAuthority,
    topHolders,
    top1Pct,
    top10Pct,
    checks,
    riskScore,
    verdict,
  };
}
