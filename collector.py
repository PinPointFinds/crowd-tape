#!/usr/bin/env python3
"""Crowd Tape collector — records social stock chatter over time.

Sources (all free, no API keys needed):
  ApeWisdom   https://apewisdom.io/api    Reddit mention counts + ranks
  Tradestie   https://tradestie.com       r/wallstreetbets bullish/bearish sentiment
  yfinance    (unofficial Yahoo Finance)  latest price per ticker

Each run appends one snapshot per ticker to sentiment.db (SQLite).
Run it hourly or daily via cron / Task Scheduler / GitHub Actions.
Safe to re-run at any time; aborts cleanly if the main source is down.
"""

from __future__ import annotations

import sqlite3
import sys
import time
from datetime import datetime, timezone

import requests

# ------------------------- settings -------------------------
DB_PATH = "sentiment.db"
TOP_N = 30                       # tickers recorded per run (frontend shows top 20)
APEWISDOM_FILTER = "all-stocks"  # alternatives: "wallstreetbets", "stocks", "investing"
HEADERS = {"User-Agent": "crowd-tape/1.0 (personal research project)"}
TIMEOUT = 30


# ------------------------- helpers -------------------------
def to_int(x, default=None):
    """ApeWisdom sometimes returns numbers as strings."""
    try:
        return int(x)
    except (TypeError, ValueError):
        return default


def get_apewisdom(pages: int = 1) -> list[dict]:
    """Top tickers by Reddit mentions in the last 24h."""
    results: list[dict] = []
    for page in range(1, pages + 1):
        url = f"https://apewisdom.io/api/v1.0/filter/{APEWISDOM_FILTER}/page/{page}"
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        results.extend(data.get("results", []))
        if page >= to_int(data.get("pages"), 1):
            break
        time.sleep(1)  # be polite
    return results


def get_tradestie() -> dict[str, dict]:
    """r/wallstreetbets sentiment, keyed by ticker.

    Fields per ticker: sentiment ('Bullish'/'Bearish'),
    sentiment_score (-1..1), no_of_comments.
    Bonus: the same endpoint accepts ?date=YYYY-MM-DD for past days.
    """
    url = "https://tradestie.com/api/v1/apps/reddit"
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return {row["ticker"].upper(): row for row in r.json()}


def get_prices(tickers: list[str]) -> dict[str, float]:
    """Latest close per ticker via yfinance. Failures just mean no price."""
    prices: dict[str, float] = {}
    if not tickers:
        return prices
    try:
        import yfinance as yf
    except ImportError:
        print("  ! yfinance not installed (pip install yfinance) — prices skipped")
        return prices

    # Yahoo uses '-' where Reddit tickers use '.' (BRK.B -> BRK-B)
    yf_map = {t.replace(".", "-"): t for t in tickers}
    try:
        df = yf.download(
            " ".join(yf_map),
            period="5d",
            interval="1d",
            group_by="ticker",
            threads=True,
            progress=False,
            auto_adjust=True,
        )
    except Exception as e:
        print(f"  ! price download failed ({e}) — prices skipped")
        return prices
    if df is None or df.empty:
        print("  ! price download returned nothing — prices skipped")
        return prices

    multi = getattr(df.columns, "nlevels", 1) > 1
    for yft, orig in yf_map.items():
        try:
            series = df[(yft, "Close")] if multi else df["Close"]
            series = series.dropna()
            if len(series):
                prices[orig] = round(float(series.iloc[-1]), 4)
        except Exception:
            continue

    missing = [t for t in tickers if t not in prices]
    if missing:
        preview = ", ".join(missing[:10]) + (" ..." if len(missing) > 10 else "")
        print(f"  ! no price found for: {preview}")
    return prices


def init_db(path: str = DB_PATH) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at      TEXT NOT NULL,   -- UTC ISO timestamp of the run
            ticker            TEXT NOT NULL,
            name              TEXT,
            rank              INTEGER,         -- ApeWisdom rank by mentions
            mentions          INTEGER,         -- mentions, trailing 24h
            mentions_24h_ago  INTEGER,
            upvotes           INTEGER,
            sentiment         TEXT,            -- Bullish / Bearish / NULL
            sentiment_score   REAL,            -- -1..1 (Tradestie compound)
            bullish_pct       REAL,            -- 0..1, derived from score
            comments          INTEGER,
            price             REAL,            -- latest close at collection time
            UNIQUE (collected_at, ticker)
        )
        """
    )
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_ticker_time ON snapshots (ticker, collected_at)"
    )
    return con


# ------------------------- main -------------------------
def main() -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    print(f"[{now}] collecting…")

    # 1) mention counts — required; abort if unavailable
    try:
        ape = get_apewisdom()
    except Exception as e:
        sys.exit(f"ApeWisdom request failed ({e}) — nothing recorded, try again later.")
    if not ape:
        sys.exit("ApeWisdom returned no results — nothing recorded.")
    ape = ape[:TOP_N]

    # 2) bullish/bearish sentiment — optional; continue without it if down
    try:
        wsb = get_tradestie()
    except Exception as e:
        print(f"  ! Tradestie failed ({e}) — continuing without sentiment")
        wsb = {}

    # 3) prices — optional
    tickers = [row["ticker"].upper() for row in ape]
    prices = get_prices(tickers)

    # 4) write one snapshot row per ticker
    rows = []
    for row in ape:
        t = row["ticker"].upper()
        s = wsb.get(t, {})
        score = s.get("sentiment_score")
        bull = None if score is None else round((float(score) + 1) / 2, 4)  # map -1..1 -> 0..1
        rows.append(
            (
                now,
                t,
                row.get("name"),
                to_int(row.get("rank")),
                to_int(row.get("mentions")),
                to_int(row.get("mentions_24h_ago")),
                to_int(row.get("upvotes")),
                s.get("sentiment"),
                score,
                bull,
                to_int(s.get("no_of_comments")),
                prices.get(t),
            )
        )

    con = init_db()
    con.executemany(
        """
        INSERT OR IGNORE INTO snapshots
            (collected_at, ticker, name, rank, mentions, mentions_24h_ago,
             upvotes, sentiment, sentiment_score, bullish_pct, comments, price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    con.commit()

    total = con.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
    print(f"  saved {len(rows)} tickers (database now holds {total} rows)")
    print(f"  {'#':>2} {'TICKER':<8}{'MENTIONS':>9}  {'SENTIMENT':<9}{'SCORE':>7}{'PRICE':>10}")
    for r in rows[:8]:
        score_s = f"{r[8]:+.2f}" if r[8] is not None else "  —"
        price_s = f"{r[11]:.2f}" if r[11] is not None else "—"
        print(
            f"  {r[3] or 0:>2} {r[1]:<8}{r[4] or 0:>9}  "
            f"{(r[7] or '—'):<9}{score_s:>7}{price_s:>10}"
        )
    con.close()


if __name__ == "__main__":
    main()
