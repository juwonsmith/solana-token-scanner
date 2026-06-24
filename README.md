# Solana Token Safety Scanner

Paste any SPL token mint address → instant **on-chain risk report**. Read-only, no wallet or SOL required.

## What it checks
- **Mint authority** — can the owner mint unlimited new supply? (dilution risk)
- **Freeze authority** — can the owner freeze your tokens? (can't-sell risk)
- **Holder concentration** — % held by the largest account and the top 10
- A combined **Looks Safe / Caution / High Risk** verdict + supply, decimals, and a top-holder distribution chart
- Token name / symbol / logo via the Jupiter token API

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind · `@solana/web3.js`. On-chain reads run server-side in `app/api/scan/route.ts`; analysis logic in `lib/scan.ts`.

## Run it
```bash
npm install
npm run dev
```
Open http://localhost:3000 and try the BONK / USDC example chips.

## Reliability note
It defaults to the public `api.mainnet-beta.solana.com` RPC, which is rate-limited. For production, set a free **Helius**/**QuickNode** endpoint:
```bash
# .env.local
SOLANA_RPC=https://your-rpc-endpoint
```

## Deploy
Works on **Vercel** out of the box (the API route uses the Node runtime). Add `SOLANA_RPC` as an env var there.
