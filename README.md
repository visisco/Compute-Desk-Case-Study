# Compute Desk Exchange: clickable prototype

Case study prototype: one trading platform for GPU compute covering **(1) physical delivery** and **(2) cash-settled financial contracts**, with EFP as the bridge.

All prices, providers, quotes, fees and margin rates are **example data**. Index levels are the public Compute Signal homepage snapshot (Nov 2026).

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # single-file build in dist/index.html (open directly in a browser)
```

## Demo script (about 6 minutes)

1. **Login.** Continue, then Verify, then pick **Northwind AI** (end user).
2. **Home.** Equity, collateral split (FCM margin vs Clear Escrow), index cards, and the "For you" insight.
3. **Trade.** Sort Markets by "Tightest", pick H1UF M27, choose Market, 128 contracts and Review. Read the slippage and margin, then confirm. The receipt walks through Accepted, Filled, Sent to FCM and Cleared by DCO. Then try a 6-month **Strip**, and on the review use **Get a block quote instead**.
4. **Exposure.** See where a move in GPU rates hurts, and open a suggested hedge in Trade.
5. **Request.** Your requests and their responses sit on one board. Start a **Spread trade** (B200 vs H100), request quotes and hit the best.
6. **Convert to Physical.** EFP a 6-month H100 strip into 64 GPUs, then track delivery and cure a failed Clear Verified check.
7. **Switch to Lattice Trading** (market maker) and quote an open spread request on Request.
8. **Integrate and Settings.** API keys, quickstart for REST, WebSocket and FIX, light mode, alerts and CSV reports.

## Structure

- `src/App.jsx`: shell, accounts, simulated market, order matching, RFQ, spread and EFP booking
- `src/data.js`: example data, contract constants (730 GPU-hr contract, $0.01 tick, 12 monthlies), symbols
- `src/market.js`: candles, order book depth by month and SKU, walk-the-book fills
- `src/Login.jsx`, `src/Home.jsx`: sign-in and Platform Home
- `src/Trade.jsx`: configurable widgets, markets, charts, book, order ticket, positions and blotter
- `src/Hedge.jsx`, `src/exposure.js`: Exposure tab and hedge finder
- `src/Request.jsx`: request board, physical RFQ, spread and flex requests, delivery tracker
- `src/Convert.jsx`: guided Convert to Physical (EFP)
- `src/Integrate.jsx`, `src/Settings.jsx`: API keys and quickstarts; theme, alerts, preferences, reports
