import axios from "axios";
import { execSync } from "child_process";
import { config } from "dotenv";

config();

// ── Config ──────────────────────────────────────────────────────────────────

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const TELEGRAM_TARGET = process.env.TELEGRAM_TARGET; // chat ID or @username
const AV_BASE = "https://www.alphavantage.co/query";
const BRAVE_NEWS = "https://api.search.brave.com/res/v1/news/search";

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_LOSERS_TO_SCAN = 5; // limit API calls
const PE_MAX = 20;
const NEAR_LOW_THRESHOLD = 1.05; // within 5% of 52-week low
const MIN_INSTITUTIONAL_PCT = 10; // minimum institutional ownership %
const MIN_REVENUE_TTM = 100_000_000; // $100M minimum TTM revenue
const MIN_FLOAT = 1_000_000; // 1M shares minimum float

// ── Types ───────────────────────────────────────────────────────────────────

interface LoserTicker {
  ticker: string;
  price: string;
  change_amount: string;
  change_percentage: string;
  volume: string;
}

interface CompanyOverview {
  Symbol: string;
  Name: string;
  Sector: string;
  Industry: string;
  MarketCapitalization: string;
  PERatio: string;
  ForwardPE: string;
  EPS: string;
  "52WeekHigh": string;
  "52WeekLow": string;
  "50DayMovingAverage": string;
  "200DayMovingAverage": string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
  Beta: string;
  DividendYield: string;
  ProfitMargin: string;
  RevenueTTM: string;
  PercentInstitutions: string;
  SharesOutstanding: string;
  SharesFloat: string;
}

interface NewsArticle {
  title: string;
  description: string;
  url: string;
  age: string;
}

interface ScoutResult {
  symbol: string;
  name: string;
  price: number;
  change: string;
  low52w: number;
  high52w: number;
  pe: number | null;
  forwardPe: number | null;
  sector: string;
  analystTarget: number | null;
  marketCap: string;
  institutionalPct: number | null;
  news: NewsArticle[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(val: string | undefined): number | null {
  if (!val || val === "None" || val === "-" || val === "0") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function formatMarketCap(mc: string): string {
  const n = parseNum(mc);
  if (!n) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── API Functions ───────────────────────────────────────────────────────────

async function fetchTopLosers(): Promise<LoserTicker[]> {
  console.log("[1/3] Fetching top losers from Alpha Vantage...");
  const { data } = await axios.get(AV_BASE, {
    params: { function: "TOP_GAINERS_LOSERS", apikey: AV_KEY },
  });

  if (!data.top_losers) {
    throw new Error(
      `Alpha Vantage TOP_GAINERS_LOSERS failed: ${JSON.stringify(data).slice(0, 200)}`
    );
  }

  // Filter out warrants, units, and rights (tickers ending in W, U, R with 5+ chars)
  const losers: LoserTicker[] = data.top_losers.filter((t: LoserTicker) => {
    const sym = t.ticker;
    if (sym.length >= 5 && /[WUR]$/.test(sym)) return false;
    // Filter out penny stocks (price < $1)
    if (parseFloat(t.price) < 1) return false;
    return true;
  });

  console.log(
    `   Found ${data.top_losers.length} losers, ${losers.length} after filtering warrants/pennies`
  );
  return losers.slice(0, MAX_LOSERS_TO_SCAN);
}

async function fetchOverview(symbol: string): Promise<CompanyOverview | null> {
  console.log(`   Fetching overview for ${symbol}...`);
  const { data } = await axios.get(AV_BASE, {
    params: { function: "OVERVIEW", symbol, apikey: AV_KEY },
  });

  // AV returns empty object {} when symbol not found
  if (!data.Symbol) {
    console.log(`   ⚠ No overview data for ${symbol}, skipping`);
    return null;
  }

  return data as CompanyOverview;
}

async function fetchBraveNews(symbol: string): Promise<NewsArticle[]> {
  if (!BRAVE_KEY) {
    console.log("   ⚠ BRAVE_API_KEY not set, skipping news lookup");
    return [];
  }

  console.log(`   Fetching news for ${symbol}...`);
  try {
    const { data } = await axios.get(BRAVE_NEWS, {
      params: {
        q: `${symbol} stock drop reason`,
        count: 3,
        freshness: "pw", // past week
      },
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_KEY,
      },
    });

    if (!data.results) return [];

    return data.results.slice(0, 3).map((r: any) => ({
      title: r.title || "No title",
      description: r.description || "",
      url: r.url || "",
      age: r.age || "",
    }));
  } catch (err: any) {
    console.log(`   ⚠ Brave news fetch failed: ${err.message}`);
    return [];
  }
}

// ── Filtering Logic ─────────────────────────────────────────────────────────

function evaluateCandidate(
  loser: LoserTicker,
  overview: CompanyOverview
): { pass: boolean; reason: string } {
  const price = parseFloat(loser.price);
  const low52 = parseNum(overview["52WeekLow"]);
  const pe = parseNum(overview.PERatio);
  const forwardPe = parseNum(overview.ForwardPE);
  const revenueTTM = parseNum(overview.RevenueTTM);
  const instPct = parseNum(overview.PercentInstitutions);
  const sharesFloat = parseNum(overview.SharesFloat);

  // Revenue filter
  if (!revenueTTM || revenueTTM < MIN_REVENUE_TTM) {
    const revStr = revenueTTM ? `$${(revenueTTM / 1e6).toFixed(1)}M` : "N/A";
    return { pass: false, reason: `revenue too low (${revStr}, min $100M)` };
  }

  // Institutional ownership filter
  if (!instPct || instPct < MIN_INSTITUTIONAL_PCT) {
    const pctStr = instPct != null ? `${instPct.toFixed(1)}%` : "N/A";
    return { pass: false, reason: `institutional ownership too low (${pctStr}, min ${MIN_INSTITUTIONAL_PCT}%)` };
  }

  // Float filter
  if (!sharesFloat || sharesFloat < MIN_FLOAT) {
    const floatStr = sharesFloat ? `${(sharesFloat / 1000).toFixed(0)}k shares` : "N/A";
    return { pass: false, reason: `float too small (${floatStr}, min 1M)` };
  }

  // Must have a valid 52-week low
  if (!low52) return { pass: false, reason: "no 52-week low data" };

  // Check proximity to 52-week low (within 5%)
  const nearLow = price <= low52 * NEAR_LOW_THRESHOLD;
  if (!nearLow) {
    const pctAbove = (((price - low52) / low52) * 100).toFixed(1);
    return { pass: false, reason: `${pctAbove}% above 52w low ($${low52})` };
  }

  // Check P/E: use trailing P/E first, fall back to forward P/E
  const effectivePe = pe ?? forwardPe;
  if (!effectivePe) return { pass: false, reason: "no P/E data (likely unprofitable)" };
  if (effectivePe <= 0) return { pass: false, reason: `negative P/E (${effectivePe})` };
  if (effectivePe >= PE_MAX) return { pass: false, reason: `P/E too high (${effectivePe})` };

  return { pass: true, reason: "PASS" };
}

// ── Message Formatting ──────────────────────────────────────────────────────

function formatAlert(results: ScoutResult[]): string {
  if (results.length === 0) {
    return "📊 Market Scout: No stocks matched the criteria today (near 52w low + P/E < 20). Markets may not be in a broad dip.";
  }

  let msg = `📉 **Market Scout Alert** (${new Date().toLocaleDateString()})\n`;
  msg += `Found ${results.length} stock(s) near 52-week lows with decent valuations:\n`;
  msg += "━".repeat(40) + "\n\n";

  for (const r of results) {
    const pe = r.pe ?? r.forwardPe;
    const peLabel = r.pe ? "P/E" : "Fwd P/E";
    const pctFromLow = (((r.price - r.low52w) / r.low52w) * 100).toFixed(1);
    const upside =
      r.analystTarget && r.analystTarget > r.price
        ? `+${(((r.analystTarget - r.price) / r.price) * 100).toFixed(0)}%`
        : null;

    msg += `**${r.symbol}** — ${r.name}\n`;
    msg += `Price: $${r.price.toFixed(2)} (${r.change}) | ${peLabel}: ${pe?.toFixed(1)}\n`;
    msg += `52w Low: $${r.low52w.toFixed(2)} (${pctFromLow}% above) | High: $${r.high52w.toFixed(2)}\n`;
    const instOwn = r.institutionalPct != null ? `${r.institutionalPct.toFixed(1)}%` : "N/A";
    msg += `Sector: ${r.sector} | Mkt Cap: ${r.marketCap} | Inst. Own: ${instOwn}\n`;

    if (upside) {
      msg += `Analyst Target: $${r.analystTarget!.toFixed(2)} (${upside} upside)\n`;
    }

    if (r.news.length > 0) {
      msg += `\n**Why it's dropping:**\n`;
      for (const n of r.news) {
        msg += `• ${n.title}\n`;
        if (n.description) {
          const desc =
            n.description.length > 120
              ? n.description.slice(0, 120) + "..."
              : n.description;
          msg += `  ${desc}\n`;
        }
      }
    }

    msg += `\n**Verdict:** Review manually — valuation looks interesting but verify fundamentals & news.\n`;
    msg += "\n" + "━".repeat(40) + "\n\n";
  }

  return msg;
}

// ── Telegram Reporting ──────────────────────────────────────────────────────

function sendToTelegram(message: string): void {
  console.log("[3/3] Sending report to Telegram via OpenClaw...");

  // Escape special characters for shell safety
  const escaped = message
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");

  try {
    execSync(
      `openclaw message send --channel telegram --target ${TELEGRAM_TARGET} --message "${escaped}"`,
      { stdio: "inherit", timeout: 30_000 }
    );
    console.log("   ✓ Report sent to Telegram");
  } catch (err: any) {
    console.error("   ✗ Failed to send to Telegram:", err.message);
    console.log("\n--- Report (console fallback) ---\n");
    console.log(message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🔍 Market Scout — Starting scan...\n");

  if (!AV_KEY) {
    console.error("Error: ALPHA_VANTAGE_API_KEY not set in .env");
    process.exit(1);
  }

  // Step 1: Get top losers
  const losers = await fetchTopLosers();
  if (losers.length === 0) {
    console.log("No suitable losers found. Exiting.");
    return;
  }

  console.log(
    `\n[2/3] Analyzing top ${losers.length} candidates: ${losers.map((l) => l.ticker).join(", ")}\n`
  );

  // Step 2: Filter and enrich
  const results: ScoutResult[] = [];

  for (const loser of losers) {
    // Rate limit: AV free tier = 5 calls/min
    await sleep(1500);

    const overview = await fetchOverview(loser.ticker);
    if (!overview) continue;

    const eval_ = evaluateCandidate(loser, overview);
    if (!eval_.pass) {
      console.log(`   ✗ ${loser.ticker} rejected: ${eval_.reason}`);
      continue;
    }

    console.log(`   ✓ ${loser.ticker} PASSED filters`);

    // Fetch news for passing candidates
    await sleep(500);
    const news = await fetchBraveNews(loser.ticker);

    results.push({
      symbol: overview.Symbol,
      name: overview.Name,
      price: parseFloat(loser.price),
      change: loser.change_percentage,
      low52w: parseFloat(overview["52WeekLow"]),
      high52w: parseFloat(overview["52WeekHigh"]),
      pe: parseNum(overview.PERatio),
      forwardPe: parseNum(overview.ForwardPE),
      sector: overview.Sector || "N/A",
      analystTarget: parseNum(overview.AnalystTargetPrice),
      marketCap: formatMarketCap(overview.MarketCapitalization),
      institutionalPct: parseNum(overview.PercentInstitutions),
      news,
    });
  }

  // Step 3: Report
  const report = formatAlert(results);
  console.log("\n" + report);

  if (DRY_RUN) {
    console.log("(--dry-run: skipping Telegram send)");
  } else {
    sendToTelegram(report);
  }

  console.log("🏁 Market Scout — Scan complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
