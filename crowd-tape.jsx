import { useState, useRef, useEffect } from "react";

/* ============================================================
   CROWD TAPE — social sentiment stock terminal
   - Top 20 stocks ranked by social mention volume
   - Price chart with buy/sell arrows sized by mention count
   - "Crowd accuracy": did arrows predict next-day moves?
   Data is LIVE, from data.json in this repo — collected hourly
   by collector.py via GitHub Actions. History starts at a single
   day and grows one point per day, so every lookup below is
   length-relative, never a fixed index.
   ============================================================ */

// ---------- palette ----------
const C = {
  bg: "#0A0F1C",
  panel: "#101728",
  panel2: "#0D1322",
  border: "#1D2740",
  amber: "#FFB020",
  amberDim: "rgba(255,176,32,0.14)",
  text: "#E8ECF4",
  dim: "#8A94A8",
  faint: "#556074",
  bull: "#29D391",
  bear: "#FF4D67",
  neutral: "#5A6478",
  grid: "#1A2338",
};

const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";

// ---------- live feed ----------
const FEED_URL =
  "https://raw.githubusercontent.com/PinPointFinds/crowd-tape/main/data.json";

// "2026-08-15" -> local midnight. Passing a bare ISO day to new Date() parses
// it as UTC, which renders as the previous day for anyone west of Greenwich.
function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ApeWisdom returns HTML-escaped company names ("SPDR S&amp;P 500 ETF Trust")
const decodeName = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

async function loadUniverse() {
  const res = await fetch(FEED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Feed responded ${res.status}`);
  const feed = await res.json();
  const stocks = (feed.stocks || [])
    .filter((s) => s.hist && s.hist.length)
    .map((s) => ({
      sym: s.sym,
      name: decodeName(s.name || s.sym),
      hist: s.hist.map((h, i) => ({ ...h, date: parseDay(h.date), i })),
    }));
  return { stocks, generatedAt: feed.generated_at || null };
}

// history is short on day one and grows daily — never index from a fixed length
const lastOf = (hist) => hist[hist.length - 1];
const prevOf = (hist) => (hist.length > 1 ? hist[hist.length - 2] : null);

// ---------- formatting ----------
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n));
const pad2 = (n) => String(n).padStart(2, "0");
const fmtStamp = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
};
const fmtPrice = (p) => (p >= 1000 ? p.toFixed(0) : p >= 100 ? p.toFixed(1) : p.toFixed(2));

// arrow rule: what counts as a signal day
const BULL_T = 0.58;
const BEAR_T = 0.42;
const signalOf = (bull) => (bull >= BULL_T ? 1 : bull <= BEAR_T ? -1 : 0);

// ---------- chart ----------
function SentimentChart({ stock, range, hover, setHover }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = stock.hist.slice(-range);
  const n = data.length;

  // geometry
  const H = 380;
  const padL = 10;
  const padR = 52;
  const pTop = 36;   // leaves room for down-arrows above highs
  const pBot = 250;  // leaves room for up-arrows below lows
  const vTop = 288;
  const vBot = 346;
  const axisY = 368;

  const plotW = Math.max(1, width - padL - padR);
  const xAt = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  let pMin = Infinity, pMax = -Infinity, mMax = 1;
  for (const d of data) {
    if (d.price < pMin) pMin = d.price;
    if (d.price > pMax) pMax = d.price;
    if (d.mentions > mMax) mMax = d.mentions;
  }
  // a flat window (day one, or a stock that hasn't moved) has no range to scale
  // to — pad it symmetrically so the point sits centred, not pinned to the floor
  if (pMax - pMin < 1e-9) {
    const pad = Math.max(pMax * 0.005, 0.01);
    pMin -= pad;
    pMax += pad;
  }
  const span = pMax - pMin;
  const yAt = (p) => pBot - ((p - pMin) / span) * (pBot - pTop);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(d.price).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xAt(n - 1).toFixed(1)},${pBot + 18} L${xAt(0).toFixed(1)},${pBot + 18} Z`;

  const pointerToIndex = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = clientX - rect.left - padL;
    const idx = Math.round((x / plotW) * (n - 1));
    return Math.max(0, Math.min(n - 1, idx));
  };

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const p = pMin + t * span;
    return { y: yAt(p), label: "$" + fmtPrice(p) };
  });

  const tickEvery = Math.max(1, Math.floor(n / 5));
  const barW = Math.max(2, (plotW / n) * 0.55);

  const hv = hover != null ? Math.min(hover, n - 1) : null;

  return (
    <div ref={wrapRef} className="w-full select-none" style={{ touchAction: "pan-y" }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          onMouseMove={(e) => setHover(pointerToIndex(e.clientX))}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => setHover(pointerToIndex(e.touches[0].clientX))}
          onTouchMove={(e) => setHover(pointerToIndex(e.touches[0].clientX))}
          style={{ display: "block", cursor: "crosshair" }}
        >
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.amber} stopOpacity="0.16" />
              <stop offset="100%" stopColor={C.amber} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* grid + price labels */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + plotW} y1={g.y} y2={g.y} stroke={C.grid} strokeDasharray="3 5" />
              <text x={width - 4} y={g.y + 3} textAnchor="end" fontSize="10" fill={C.faint} fontFamily={MONO}>
                {g.label}
              </text>
            </g>
          ))}

          {/* mention volume bars, tinted by sentiment */}
          {data.map((d, i) => {
            const h = Math.max(1.5, (d.mentions / mMax) * (vBot - vTop));
            const s = signalOf(d.bull);
            const fill = s === 1 ? C.bull : s === -1 ? C.bear : C.neutral;
            return (
              <rect
                key={"v" + i}
                x={xAt(i) - barW / 2}
                y={vBot - h}
                width={barW}
                height={h}
                fill={fill}
                opacity={hv === i ? 0.95 : 0.4}
                rx="1"
              />
            );
          })}
          <text x={padL} y={vTop - 6} fontSize="9" fill={C.faint} fontFamily={MONO} letterSpacing="1">
            MENTIONS / DAY
          </text>

          {/* price area + line */}
          <path d={areaPath} fill="url(#areaFill)" />
          <path d={linePath} fill="none" stroke={C.amber} strokeWidth="1.8" strokeLinejoin="round" />
          {/* a one-day history draws no line — show the lone point instead */}
          {n === 1 && <circle cx={xAt(0)} cy={yAt(data[0].price)} r="3.5" fill={C.amber} />}

          {/* sentiment arrows: size = mention volume */}
          {data.map((d, i) => {
            const s = signalOf(d.bull);
            if (s === 0) return null;
            const x = xAt(i);
            const y = yAt(d.price);
            const sz = 4.5 + 10 * Math.sqrt(d.mentions / mMax);
            const hw = sz * 0.72;
            const dim = hv != null && hv !== i;
            if (s === 1) {
              return (
                <path
                  key={"a" + i}
                  d={`M${x},${y + 7} L${x - hw},${y + 7 + sz * 1.25} L${x + hw},${y + 7 + sz * 1.25} Z`}
                  fill={C.bull}
                  opacity={dim ? 0.35 : 0.92}
                />
              );
            }
            return (
              <path
                key={"a" + i}
                d={`M${x},${y - 7} L${x - hw},${y - 7 - sz * 1.25} L${x + hw},${y - 7 - sz * 1.25} Z`}
                fill={C.bear}
                opacity={dim ? 0.35 : 0.92}
              />
            );
          })}

          {/* crosshair */}
          {hv != null && (
            <g>
              <line x1={xAt(hv)} x2={xAt(hv)} y1={pTop - 14} y2={vBot} stroke={C.amber} strokeOpacity="0.45" strokeDasharray="2 4" />
              <circle cx={xAt(hv)} cy={yAt(data[hv].price)} r="4" fill={C.bg} stroke={C.amber} strokeWidth="1.6" />
            </g>
          )}

          {/* date axis */}
          {data.map((d, i) =>
            i % tickEvery === 0 ? (
              <text key={"t" + i} x={xAt(i)} y={axisY} textAnchor="middle" fontSize="9.5" fill={C.faint} fontFamily={MONO}>
                {fmtDate(d.date)}
              </text>
            ) : null
          )}
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}
    </div>
  );
}

// ---------- list row ----------
function StockRow({ stock, rank, selected, maxMentions, onClick }) {
  const last = lastOf(stock.hist);
  const prev = prevOf(stock.hist);
  const chg = prev && prev.mentions ? (last.mentions / prev.mentions - 1) * 100 : null;
  const s = signalOf(last.bull);
  const pct = Math.round((s === -1 ? 1 - last.bull : last.bull) * 100);
  const pillColor = s === 1 ? C.bull : s === -1 ? C.bear : C.dim;
  const pillBg = s === 1 ? "rgba(41,211,145,0.12)" : s === -1 ? "rgba(255,77,103,0.12)" : "rgba(138,148,168,0.10)";

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 text-left"
      style={{
        background: selected ? C.amberDim : "transparent",
        borderLeft: `2px solid ${selected ? C.amber : "transparent"}`,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint, width: 20, flexShrink: 0 }}>
        {String(rank).padStart(2, "0")}
      </span>

      <span className="flex flex-col min-w-0" style={{ width: 92, flexShrink: 0 }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13.5, color: C.text }}>{stock.sym}</span>
        <span className="truncate" style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>{stock.name}</span>
      </span>

      <span className="flex flex-col items-end ml-auto" style={{ width: 76, flexShrink: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>{fmtK(last.mentions)}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: chg == null ? C.faint : chg >= 0 ? C.bull : C.bear }}>
          {chg == null ? "first day" : `${chg >= 0 ? "+" : ""}${chg.toFixed(0)}% vs yd`}
        </span>
      </span>

      <span className="hidden sm:block" style={{ width: 54, height: 4, background: C.border, borderRadius: 2, flexShrink: 0 }}>
        <span style={{ display: "block", width: `${(last.mentions / maxMentions) * 100}%`, height: "100%", background: C.amber, borderRadius: 2, opacity: 0.8 }} />
      </span>

      <span
        style={{
          fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: pillColor, background: pillBg,
          padding: "3px 7px", borderRadius: 3, width: 74, textAlign: "center", flexShrink: 0,
        }}
      >
        {s === 1 ? "▲" : s === -1 ? "▼" : "•"} {pct}% {s === -1 ? "BEAR" : s === 1 ? "BULL" : "MIX"}
      </span>
    </button>
  );
}

// ---------- loading / error screen ----------
function Splash({ status, error }) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ background: C.bg, color: C.text }}
    >
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 3, color: C.amber }}>
        SOCIAL SENTIMENT TERMINAL
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: 1, textTransform: "uppercase" }}>
        Crowd Tape
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: status === "error" ? C.bear : C.dim }}>
        {status === "error" ? "FEED UNAVAILABLE" : "LOADING FEED…"}
      </div>
      {status === "error" && (
        <p className="m-0" style={{ fontFamily: MONO, fontSize: 11, color: C.faint, maxWidth: 460, lineHeight: 1.6 }}>
          {error} — check that the collect-sentiment workflow has run and that data.json exists in the repo.
        </p>
      )}
    </div>
  );
}

// ---------- main ----------
export default function CrowdTape() {
  const [stocks, setStocks] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [selectedSym, setSelectedSym] = useState(null);
  const [range, setRange] = useState(30);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let alive = true;
    loadUniverse()
      .then((feed) => {
        if (!alive) return;
        if (!feed.stocks.length) {
          setError("Feed is empty");
          setStatus("error");
          return;
        }
        setStocks(feed.stocks);
        setGeneratedAt(feed.generatedAt);
        setStatus("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  // every hook above runs unconditionally — safe to bail out here
  if (status !== "ready") return <Splash status={status} error={error} />;

  const stock = stocks.find((s) => s.sym === selectedSym) || stocks[0];
  const data = stock.hist.slice(-range);
  const maxMentions = Math.max(...stocks.map((s) => lastOf(s.hist).mentions), 1);

  // crowd accuracy over the visible window
  let hits = 0, signals = 0;
  for (let i = 0; i < data.length - 1; i++) {
    const s = signalOf(data[i].bull);
    if (s === 0) continue;
    signals++;
    const up = data[i + 1].price > data[i].price;
    if ((s === 1 && up) || (s === -1 && !up)) hits++;
  }
  const rate = signals > 0 ? hits / signals : 0;
  const verdict =
    data.length < 2
      ? "History is one day deep — the score needs a following day to check the arrows against. Come back tomorrow."
      : signals === 0
      ? "No strong-conviction days in this window."
      : rate >= 0.57
      ? "Crowd has been predictive here — arrows led next-day moves more often than not."
      : rate <= 0.43
      ? "Crowd has been a contrarian signal — price tended to move against the arrows."
      : "Coin flip so far — chatter has not reliably led price in this window.";
  const rateColor = signals === 0 ? C.dim : rate >= 0.57 ? C.bull : rate <= 0.43 ? C.bear : C.dim;

  const readout = hover != null ? data[Math.min(hover, data.length - 1)] : data[data.length - 1];
  const rs = signalOf(readout.bull);

  const last = lastOf(stock.hist);
  const prevDay = prevOf(stock.hist);
  const dayChg = prevDay && prevDay.price ? (last.price / prevDay.price - 1) * 100 : null;

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        .ct-marquee { display:flex; width:max-content; animation: ct-scroll 45s linear infinite; }
        @keyframes ct-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ct-marquee { animation: none; } }
        button:focus-visible { outline: 2px solid ${C.amber}; outline-offset: -2px; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* header */}
      <header className="px-4 pt-4 pb-3 flex flex-wrap items-end gap-x-4 gap-y-2" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 3, color: C.amber }}>SOCIAL SENTIMENT TERMINAL</div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>
            Crowd Tape
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.bull, border: `1px solid ${C.bull}`, padding: "3px 8px", borderRadius: 3, letterSpacing: 1 }}>
            ● LIVE DATA
          </span>
          {generatedAt && (
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, letterSpacing: 1 }}>
              {fmtStamp(generatedAt)}
            </span>
          )}
        </div>
        <p className="w-full m-0" style={{ fontFamily: MONO, fontSize: 11, color: C.dim, maxWidth: 720 }}>
          Top 20 tickers by social chatter. Green ▲ = crowd leaning buy, red ▼ = crowd leaning sell, arrow size = how many people are talking. Accuracy score tracks whether the crowd called the next day right.
        </p>
      </header>

      {/* ticker strip */}
      <div className="overflow-hidden" style={{ borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
        <div className="ct-marquee py-1.5">
          {[0, 1].map((rep) => (
            <div key={rep} className="flex" aria-hidden={rep === 1}>
              {stocks.map((s) => {
                const l = lastOf(s.hist);
                const sg = signalOf(l.bull);
                return (
                  <span key={rep + s.sym} className="px-4 whitespace-nowrap" style={{ fontFamily: MONO, fontSize: 11 }}>
                    <span style={{ color: C.text, fontWeight: 600 }}>{s.sym}</span>{" "}
                    <span style={{ color: C.dim }}>{fmtK(l.mentions)}</span>{" "}
                    <span style={{ color: sg === 1 ? C.bull : sg === -1 ? C.bear : C.neutral }}>
                      {sg === 1 ? "▲" : sg === -1 ? "▼" : "•"}
                    </span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* main layout */}
      <div className="flex flex-col lg:flex-row">
        {/* ranked list */}
        <aside className="lg:w-[380px] lg:flex-shrink-0" style={{ borderRight: `1px solid ${C.border}` }}>
          <div className="px-3 py-2 flex items-baseline justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim }}>MOST TALKED ABOUT · 24H</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>MENTIONS · SENTIMENT</span>
          </div>
          <div className="overflow-y-auto max-h-72 lg:max-h-[calc(100vh-210px)]">
            {stocks.map((s, i) => (
              <StockRow
                key={s.sym}
                stock={s}
                rank={i + 1}
                maxMentions={maxMentions}
                selected={s.sym === selectedSym}
                onClick={() => { setSelectedSym(s.sym); setHover(null); }}
              />
            ))}
          </div>
        </aside>

        {/* chart panel */}
        <main className="flex-1 min-w-0 p-4">
          {/* title row */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div>
              <div className="flex items-baseline gap-3">
                <span style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{stock.sym}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>{stock.name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600 }}>${fmtPrice(last.price)}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: dayChg == null ? C.faint : dayChg >= 0 ? C.bull : C.bear }}>
                  {dayChg == null ? "no prior day yet" : `${dayChg >= 0 ? "+" : ""}${dayChg.toFixed(2)}% today`}
                </span>
              </div>
            </div>
            <div className="ml-auto flex gap-1">
              {[14, 30, 60].map((r) => (
                <button
                  key={r}
                  onClick={() => { setRange(r); setHover(null); }}
                  style={{
                    fontFamily: MONO, fontSize: 11, padding: "5px 12px", borderRadius: 3,
                    border: `1px solid ${range === r ? C.amber : C.border}`,
                    color: range === r ? C.amber : C.dim,
                    background: range === r ? C.amberDim : "transparent",
                  }}
                >
                  {r}D
                </button>
              ))}
            </div>
          </div>

          {/* hover readout */}
          <div
            className="mt-3 px-3 py-2 flex flex-wrap gap-x-5 gap-y-1"
            style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: MONO, fontSize: 11.5 }}
          >
            <span style={{ color: C.amber }}>{fmtDate(readout.date)}</span>
            <span><span style={{ color: C.faint }}>PRICE </span>${fmtPrice(readout.price)}</span>
            <span><span style={{ color: C.faint }}>MENTIONS </span>{fmtK(readout.mentions)}</span>
            <span style={{ color: rs === 1 ? C.bull : rs === -1 ? C.bear : C.dim }}>
              {Math.round(readout.bull * 100)}% BULLISH {rs === 1 ? "▲ BUY LEAN" : rs === -1 ? "▼ SELL LEAN" : "• MIXED"}
            </span>
          </div>

          {/* chart */}
          <div className="mt-2" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 4px 2px" }}>
            <SentimentChart stock={stock} range={range} hover={hover} setHover={setHover} />
          </div>

          {/* legend */}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-1" style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim }}>
            <span><span style={{ color: C.bull }}>▲</span> crowd leaning buy (≥{Math.round(BULL_T * 100)}% bullish)</span>
            <span><span style={{ color: C.bear }}>▼</span> crowd leaning sell (≥{Math.round((1 - BEAR_T) * 100)}% bearish)</span>
            <span>
              <span style={{ color: C.bull, fontSize: 8 }}>▲</span>
              <span style={{ color: C.bull, fontSize: 11 }}>▲</span>
              <span style={{ color: C.bull, fontSize: 14 }}>▲</span> size = mention volume
            </span>
          </div>

          {/* crowd accuracy */}
          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 2, color: C.faint }}>
                CROWD ACCURACY · LAST {range}D
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span style={{ fontFamily: DISPLAY, fontSize: 38, fontWeight: 700, lineHeight: 1, color: rateColor }}>
                  {signals > 0 ? Math.round(rate * 100) + "%" : "—"}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
                  {hits}/{signals} arrow days called the next day right
                </span>
              </div>
              <p className="m-0 mt-2" style={{ fontFamily: MONO, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{verdict}</p>
            </div>
            <div className="sm:w-64 px-4 py-3" style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 2, color: C.faint }}>HOW IT SCORES</div>
              <p className="m-0 mt-2" style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim, lineHeight: 1.6 }}>
                Every arrow day is a prediction. If the next day's close moves the arrow's way, it counts as a hit. Over 50% means the chatter is leading the price.
              </p>
            </div>
          </div>

          <p className="mt-4 mb-1" style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
            Live chatter from ApeWisdom (Reddit mentions) and Tradestie (bullish share), prices from Yahoo Finance, collected hourly and published as data.json. History grows one point per day. Research tool — not financial advice.
          </p>
        </main>
      </div>
    </div>
  );
}
