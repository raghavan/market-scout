# Market Scout

OpenClaw skill that finds US stocks near their 52-week lows with decent fundamentals, explains why they're dropping using news search, and sends alerts to Telegram.

## How It Works

1. Fetches today's **top losers** from Alpha Vantage
2. Filters out warrants, penny stocks, and non-equity tickers
3. For each candidate, checks:
   - Is the price within **5% of the 52-week low**?
   - Is the **P/E ratio < 20**? (trailing, or forward as fallback)
4. For stocks that pass, fetches **news headlines** from Brave Search to explain the drop
5. Sends a formatted alert to **Telegram** via OpenClaw


## Setup

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/market-scout.git
cd market-scout
npm install
```

### 2. Configure API keys

```bash
cp .env.example .env
```

Edit `.env` and add your keys:

```
ALPHA_VANTAGE_API_KEY=your_key_here
BRAVE_API_KEY=your_key_here
```

- **Alpha Vantage** (required): Get a free key at https://www.alphavantage.co/support/#api-key
- **Brave Search** (optional): Get a key at https://brave.com/search/api/ — news context is skipped if not set

### 3. Get your Telegram chat ID

Message **@userinfobot** on Telegram. It replies instantly with your numeric user ID.

Add it to `.env`:

```
TELEGRAM_TARGET=123456789
```

### 4. Test

```bash
# Dry run — prints report to console, skips Telegram
npx ts-node src/index.ts --dry-run

# Live — sends report to Telegram
npx ts-node src/index.ts
```

## Deploy to OpenClaw

### 1. Clone on your OpenClaw machine

```bash
cd /home/openclaw/.openclaw/workspace/skills
git clone https://github.com/<your-username>/market-scout.git
cd market-scout
npm install
```

### 2. Configure secrets

```bash
cp .env.example .env
nano .env
# Fill in ALPHA_VANTAGE_API_KEY, BRAVE_API_KEY, TELEGRAM_TARGET
```

### 3. Test on the remote machine

```bash
npx ts-node src/index.ts --dry-run
npx ts-node src/index.ts
```

### 4. Schedule with cron

```bash
crontab -e
```

Add these lines:

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 13,17,21 * * 1-5  cd /home/openclaw/.openclaw/workspace/skills/market-scout && npx ts-node src/index.ts >> /tmp/market-scout.log 2>&1
```

This runs at 1pm, 5pm, and 9pm ET on weekdays.

### 5. Check logs

```bash
tail -f /tmp/market-scout.log
```

## Updating

```bash
cd /home/openclaw/.openclaw/workspace/skills/market-scout
git pull
npm install  # only if dependencies changed
```
