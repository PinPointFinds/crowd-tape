#!/usr/bin/env python3
"""Turns sentiment.db into data.json for the Crowd Tape frontend.

Aggregation: one point per ticker per calendar day (that day's latest
snapshot — mentions are already trailing-24h, so the last reading of the
day is the day's total). Stocks are ranked by the most recent day's
mentions and the top 20 are kept, each with its full daily history.

Output shape (what the React page expects):
{
  "generated_at": "2026-08-15T21:00:00+00:00",
  "latest_day": "2026-08-15",
  "stocks": [
    { "sym": "NVDA", "name": "NVIDIA",
      "hist": [ {"date": "2026-08-01", "price": 182.4,
                 "mentions": 14200, "bull": 0.66}, ... ] }
  ]
}
"""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone

DB_PATH = "sentiment.db"
OUT_PATH = "data.json"
TOP_OUT = 20     # stocks to publish
MAX_DAYS = 90    # cap history length per stock

QUERY = """
WITH daily AS (
    SELECT ticker,
           substr(collected_at, 1, 10) AS day,
           MAX(collected_at)           AS latest
    FROM snapshots
    GROUP BY ticker, day
)
SELECT s.ticker, s.name, d.day, s.mentions, s.bullish_pct, s.price
FROM daily d
JOIN snapshots s
  ON s.ticker = d.ticker AND s.collected_at = d.latest
ORDER BY s.ticker, d.day
"""


def main(db: str = DB_PATH, out: str = OUT_PATH) -> None:
    con = sqlite3.connect(db)
    try:
        rows = con.execute(QUERY).fetchall()
    except sqlite3.OperationalError:
        sys.exit("No database yet — run collector.py first.")
    finally:
        con.close()
    if not rows:
        sys.exit("Database is empty — run collector.py first.")

    by_ticker: dict[str, list[dict]] = {}
    names: dict[str, str] = {}
    for ticker, name, day, mentions, bull, price in rows:
        names[ticker] = name or ticker
        by_ticker.setdefault(ticker, []).append(
            {
                "date": day,
                "mentions": mentions or 0,
                "bull": round(bull, 4) if bull is not None else 0.5,
                "price": price,
            }
        )

    latest_day = max(h[-1]["date"] for h in by_ticker.values())

    # rank by mentions on the latest day; skip tickers that fell off the list
    ranked = sorted(
        (t for t, h in by_ticker.items() if h[-1]["date"] == latest_day),
        key=lambda t: by_ticker[t][-1]["mentions"],
        reverse=True,
    )[:TOP_OUT]

    stocks = []
    for t in ranked:
        hist = by_ticker[t][-MAX_DAYS:]
        # forward-fill missing prices; drop leading days that never had one
        filled: list[dict] = []
        last_price = None
        for h in hist:
            if h["price"] is not None:
                last_price = h["price"]
            if last_price is None:
                continue
            filled.append({**h, "price": round(last_price, 4)})
        if filled:
            stocks.append({"sym": t, "name": names[t], "hist": filled})

    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "latest_day": latest_day,
        "stocks": stocks,
    }
    with open(out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    points = sum(len(s["hist"]) for s in stocks)
    print(f"wrote {out}: {len(stocks)} stocks, {points} daily points, latest day {latest_day}")


if __name__ == "__main__":
    main()
