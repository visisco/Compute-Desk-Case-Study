# Compute Desk Exchange: clickable prototype

Case study prototype: one trading platform for GPU compute covering **(1) physical delivery** and **(2) cash-settled financial contracts**, with EFP as the bridge.

All prices, providers, quotes, fees and margin rates are **example data**. Index levels are the public Compute Signal homepage snapshot (Nov 2026).

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # single-file build in dist/index.html (open directly in a browser)
```

## Demo script (about 5 minutes)

Use the **Viewing as** switch (top right) to change participant type. Tabs, positions and the default screen change with it.

1. **End user (AI lab)** opens on **EFP**. They are long a 6-month H100 futures strip (64/month, bought at $2.50).
   Request EFP quotes, then accept the best one. Both legs book together: futures flattened and margin released, physical contract signed. Net cost ≈ hedged price + basis.
2. **Delivery**: fund escrow, post bond, hand over nodes. Click **Fail acceptance**, then **Cure with backup provider** (paid from the bond). Settle a month.
3. **Futures**: forward curve vs index, order book, order ticket, positions with FCM margin.
4. **Physical RFQ**: standard term sheet, then a blind RFQ. Quotes are normalised to the index spec and ranked; non-matching quotes show why.
5. **Provider**: quote an open RFQ, then take the other side of an EFP (offsets their short hedge).
6. **Market maker / Speculator**: futures and API only. The **API** tab shows REST, WebSocket and FIX examples, a live stream and entitlements.
7. **Onboard**: the 7-stage lifecycle for each participant type, with a checklist.

## Structure

- `src/data.js`: example data, contract constants (730 GPU-hr contract, tick), lifecycle, quote scoring
- `src/App.jsx`: shell, role switcher, simulated market feed
- `src/screens.jsx`: Onboard, Futures, Physical RFQ, EFP, Delivery, API
