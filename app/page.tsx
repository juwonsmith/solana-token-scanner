"use client";

import { useState } from "react";
import type { ScanReport } from "@/lib/scan";
import type { BundleResult } from "@/lib/bundle";

const EXAMPLES = [
  { label: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { label: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "Wrapped SOL", address: "So11111111111111111111111111111111111111112" },
];

const VERDICT: Record<ScanReport["verdict"], string> = {
  "Looks Safe": "text-brand border-brand/40 bg-brand/10",
  Caution: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  "High Risk": "text-red-400 border-red-400/40 bg-red-400/10",
};
const DOT: Record<string, string> = {
  safe: "bg-brand",
  warn: "bg-amber-400",
  danger: "bg-red-400",
  unknown: "bg-white/30",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2, notation: n > 1e6 ? "compact" : "standard" }).format(n);
}
function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleResult | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  async function scan(addr?: string) {
    const a = (addr ?? address).trim();
    if (!a) return;
    if (addr) setAddress(addr);
    setLoading(true);
    setError(null);
    setReport(null);
    setBundle(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: a }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed.");
      setReport(json as ScanReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function bundleScan() {
    if (!report) return;
    setBundleLoading(true);
    setBundle(null);
    try {
      const res = await fetch("/api/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: report.address }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bundle analysis failed.");
      setBundle(json as BundleResult);
    } catch (e) {
      setBundle({
        analyzed: false,
        status: "unknown",
        detail: e instanceof Error ? e.message : "Bundle analysis failed.",
      });
    } finally {
      setBundleLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-16 sm:py-24">
      <header className="text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Solana · mainnet
        </div>
        <h1 className="bg-gradient-to-r from-brand to-brand-deep bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
          Token Safety Scanner
        </h1>
        <p className="mx-auto mt-4 max-w-md text-white/60">
          Paste any SPL token address for an instant on-chain risk report —
          mint/freeze authority, holder concentration, and a verdict.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          scan();
        }}
        className="mt-10 flex flex-col gap-3 sm:flex-row"
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Token mint address…"
          spellCheck={false}
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm outline-none transition-colors placeholder:text-white/30 focus:border-brand/50"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-brand px-6 py-3 font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/40">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => scan(ex.address)}
            className="rounded-full border border-white/10 px-3 py-1 transition-colors hover:border-brand/40 hover:text-white"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-8 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {report && (
        <section className="mt-10 space-y-6">
          {/* token header + verdict */}
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {report.logoURI ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={report.logoURI} alt="" className="h-11 w-11 rounded-full" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 font-mono text-xs">
                  {report.symbol?.slice(0, 3) || "?"}
                </div>
              )}
              <div>
                <div className="font-semibold">
                  {report.name || "Unknown token"}{" "}
                  {report.symbol && <span className="text-white/40">{report.symbol}</span>}
                </div>
                <div className="font-mono text-xs text-white/40">{short(report.address)}</div>
              </div>
            </div>
            <span
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${VERDICT[report.verdict]}`}
            >
              {report.verdict}
            </span>
          </div>

          {/* stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { k: "Supply", v: fmt(report.supply) },
              { k: "Decimals", v: String(report.decimals) },
              { k: "Top holder", v: `${report.top1Pct.toFixed(1)}%` },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-wider text-white/40">{s.k}</div>
                <div className="mt-1 font-mono text-lg">{s.v}</div>
              </div>
            ))}
          </div>

          {/* checks */}
          <div className="space-y-2">
            {report.checks.map((c) => (
              <div
                key={c.label}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`} />
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-sm text-white/55">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {/* holder distribution */}
          {report.topHolders.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 text-sm font-medium text-white/70">
                Top holders
              </div>
              <div className="space-y-2">
                {report.topHolders.map((h, i) => (
                  <div key={h.address} className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-white/30">{i + 1}</span>
                    <span className="w-24 font-mono text-xs text-white/50">{short(h.address)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-deep"
                        style={{ width: `${Math.min(h.pct, 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-white/60">
                      {h.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* bundle / sniper check (pump.fun / bonk launches) */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white/80">Bundle / sniper check</div>
                <div className="text-xs text-white/40">
                  Scans the launch block for coordinated insider buys (pump.fun / bonk).
                </div>
              </div>
              <button
                onClick={() => bundleScan()}
                disabled={bundleLoading}
                className="shrink-0 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {bundleLoading ? "Analyzing…" : "Check bundle"}
              </button>
            </div>
            {bundle && (
              <div className="mt-4 flex items-start gap-3 border-t border-white/10 pt-4">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[bundle.status]}`} />
                <div>
                  <div className="font-medium">
                    {bundle.launchpad || "Bundle analysis"}
                    {typeof bundle.bundledPct === "number" && (
                      <span className="ml-2 font-mono text-white/50">
                        {bundle.bundledPct.toFixed(1)}% bundled
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-white/60">{bundle.detail}</div>
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-white/30">
            On-chain signals only — not financial advice. Always do your own research.
          </p>
        </section>
      )}

      <footer className="mt-auto pt-16 text-center text-xs text-white/30">
        Built by Kami · Solana mainnet · read-only
      </footer>
    </main>
  );
}
