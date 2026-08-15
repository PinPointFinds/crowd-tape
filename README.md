# Crowd Tape — data collector

Records which stocks the internet is talking about, how bullish the crowd is, and the price at that moment — one snapshot at a time. After a couple of weeks you have real history, and the "crowd accuracy" score on the Crowd Tape page becomes meaningful.

## The files

- **collector.py** — pulls the top 30 tickers by Reddit mentions (ApeWisdom), bullish/bearish sentiment (Tradestie), and the latest price (yfinance), then appends a snapshot to `sentiment.db` (SQLite). All three sources are free and need no API key.
- **export_json.py** — squeezes the database into `data.json`: one point per stock per day, top 20 stocks, ready for the frontend.
- **collect.yml** — a GitHub Actions workflow that runs both scripts every hour for free.
- **requirements.txt** — the two Python packages needed.

## Try it once, locally

```bash
pip install -r requirements.txt
python collector.py        # creates sentiment.db, prints a preview table
python export_json.py      # creates data.json
```

Run `collector.py` again tomorrow and `data.json` will have two days of history per stock. That's the whole idea — it just needs to keep running.

## Keep it running

**Option A — your own computer.** Add a cron line (Mac/Linux) so it runs hourly:

```
17 * * * * cd /path/to/this/folder && python3 collector.py && python3 export_json.py
```

On Windows, use Task Scheduler to run the same two commands. Downside: your computer has to be on.

**Option B — GitHub Actions (recommended, free, no server).**

1. Create a GitHub repo (public or private) and add these four files.
2. Move `collect.yml` into a folder called `.github/workflows/` inside the repo.
3. Push. Open the repo's **Actions** tab, pick *collect-sentiment*, and press **Run workflow** once to test.
4. From then on it runs every hour on GitHub's machines and commits the updated `sentiment.db` and `data.json` back to the repo.

Your live data feed is then simply the raw file URL:

```
https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/data.json
```

(One GitHub quirk: if the repo gets no activity for 60 days the schedule pauses — the hourly bot commits themselves count as activity, so in practice it keeps itself alive.)

## Hook up the Crowd Tape page

In `crowd-tape.jsx`, the demo builds fake data with `generateUniverse()`. Replace that with a fetch of your feed:

```js
async function loadUniverse() {
  const url = "https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/main/data.json";
  const { stocks } = await (await fetch(url)).json();
  return stocks.map((s) => ({
    sym: s.sym,
    name: s.name,
    hist: s.hist.map((h, i) => ({ ...h, date: new Date(h.date), i })),
  }));
}
```

Then load it with a `useEffect` instead of `useMemo`, and replace the fixed `DAYS - 1` index lookups with `hist.length - 1` (real history starts short and grows). Everything else — arrows, volume bars, accuracy score — works unchanged, because `data.json` uses the exact same fields the demo generates: `date`, `price`, `mentions`, `bull`.

## Good to know

- Be polite to the free APIs: hourly is plenty (ApeWisdom's mention counts are trailing 24-hour totals anyway). Don't run it every minute.
- These are unofficial/community APIs — they can change format or go down. The collector aborts safely when ApeWisdom is unreachable and simply skips sentiment or prices if those sources fail, so the database never gets corrupted.
- Tradestie's endpoint accepts `?date=YYYY-MM-DD`, so past sentiment can be backfilled if you ever want to seed history before today.
- Sentiment mapping: Tradestie's score runs −1…+1; it's stored as `bullish_pct` = (score + 1) / 2, matching the 0–1 scale the chart uses (arrows appear ≥ 0.58 bullish or ≤ 0.42 bearish).
- The database grows by ~30 small rows per run — years of hourly collection stays only a few megabytes.
- Research tool, not financial advice: the whole point is to *measure* whether the crowd predicts price, not to assume it does.
