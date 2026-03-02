---
name: market-scout
description: Find US stocks near 52-week lows with solid fundamentals and news context
version: 1.0.0
metadata:
  openclaw:
    emoji: "📉"
    requires:
      env:
        - ALPHA_VANTAGE_API_KEY
        - BRAVE_API_KEY
        - TELEGRAM_TARGET
      bins:
        - node
    primaryEnv: ALPHA_VANTAGE_API_KEY
    install:
      - kind: node
        package: ts-node
        bins: [ts-node]
---

# Market Scout

Scans today's top losers on the US market, filters for stocks near their 52-week low with P/E < 20, fetches news explaining the drop, and sends an alert to Telegram.

## Usage

```bash
# Dry run (console only)
cd skills/market-scout && npx ts-node src/index.ts --dry-run

# Live (sends to Telegram)
cd skills/market-scout && npx ts-node src/index.ts
```

## What it checks

- **Source:** Alpha Vantage `TOP_GAINERS_LOSERS` endpoint
- **Filter 1:** Price within 5% of 52-week low
- **Filter 2:** Trailing P/E (or Forward P/E) between 0 and 20
- **News:** Brave Search API for recent headlines on why the stock is dropping
- **Delivery:** `openclaw message send --channel telegram --target $TELEGRAM_TARGET`

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | Yes | API key from alphavantage.co |
| `BRAVE_API_KEY` | No | Brave Search API key (news skipped if unset) |
| `TELEGRAM_TARGET` | Yes | Numeric Telegram chat ID (message @userinfobot to get yours) |
