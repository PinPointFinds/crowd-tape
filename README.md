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

## The Crowd Tape page

`crowd-tape.jsx` is already wired to the live feed — the simulated `generateUniverse()` is gone. It fetches:

```
https://raw.githubusercontent.com/PinPointFinds/crowd-tape/main/data.json
```

on mount via `useEffect`, showing a loading/error splash until the feed lands. Because real history starts at one day and grows, every lookup is length-relative (`lastOf` / `prevOf`) rather than a fixed `DAYS - 1` index — the "vs yesterday" figures read *first day* until there's a second point to compare against.

If you fork this to another account, change `FEED_URL` at the top of the file.

### Preview it locally

```bash
npm install
npm run dev
```

Opens on http://localhost:5199 against the **live** feed — the same JSON your published page would fetch, so what you see is what the data actually looks like today.

That harness is `index.html` + `dev/` + the Vite config, and exists only to render the component; it is not a deployment target. `crowd-tape.jsx` itself is a plain component meant to be dropped into your own React app, which needs to supply React and Tailwind.

If `npm install` warns that install scripts were skipped, run `npm approve-scripts esbuild` — npm 11 blocks postinstall scripts by default and Vite's bundler needs its platform binary.

## Good to know

- Be polite to the free APIs: hourly is plenty (ApeWisdom's mention counts are trailing 24-hour totals anyway). Don't run it every minute.
- These are unofficial/community APIs — they can change format or go down. The collector aborts safely when ApeWisdom is unreachable and simply skips sentiment or prices if those sources fail, so the database never gets corrupted.
- Tradestie's endpoint accepts `?date=YYYY-MM-DD`, so past sentiment can be backfilled if you ever want to seed history before today.
- Sentiment mapping: Tradestie's score runs −1…+1; it's stored as `bullish_pct` = (score + 1) / 2, matching the 0–1 scale the chart uses (arrows appear ≥ 0.58 bullish or ≤ 0.42 bearish).
- The database grows by ~30 small rows per run — years of hourly collection stays only a few megabytes.
- Research tool, not financial advice: the whole point is to *measure* whether the crowd predicts price, not to assume it does.
