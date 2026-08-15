import { useState, useMemo, useRef, useEffect } from "react";

/* ============================================================
   CROWD TAPE — social sentiment stock terminal (demo)
   - Top 20 stocks ranked by social mention volume
   - Price chart with buy/sell arrows sized by mention count
   - "Crowd accuracy": did arrows predict next-day moves?
   NOTE: data is SIMULATED. Swap generateUniverse() for a real
   feed (ApeWisdom / Tradestie / StockTwits + price API).
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

// ---------- deterministic rng ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sym, name, basePrice, baseMentions/day, baseline bullishness, predictiveness (-1..1)
const TICKERS = [
  ["NVDA", "NVIDIA", 182, 14200, 0.66, 0.9],
  ["TSLA", "Tesla", 244, 11800, 0.55, 0.65],
  ["PLTR", "Palantir", 158, 9400, 0.68, 1.0],
  ["GME", "GameStop", 23, 8600, 0.6, 0.0],
  ["AMD", "AMD", 171, 7900, 0.62, 0.8],
  ["SMCI", "Super Micro", 46, 7100, 0.52, -0.6],
  ["AAPL", "Apple", 231, 6400, 0.57, 0.4],
  ["MSTR", "MicroStrategy", 372, 6100, 0.58, 0.6],
  ["COIN", "Coinbase", 301, 5600, 0.54, 0.5],
  ["HOOD", "Robinhood", 108, 5200, 0.63, 0.7],
  ["SOFI", "SoFi", 21, 4800, 0.61, 0.3],
  ["META", "Meta", 742, 4300, 0.56, 0.5],
  ["AMZN", "Amazon", 228, 3900, 0.58, 0.2],
  ["MSFT", "Microsoft", 512, 3600, 0.55, 0.3],
  ["INTC", "Intel", 24, 3300, 0.44, 0.6],
  ["RIVN", "Rivian", 14, 2900, 0.48, 0.0],
  ["BABA", "Alibaba", 118, 2600, 0.51, -0.4],
  ["AMC", "AMC", 4.1, 2300, 0.46, 0.0],
  ["SPY", "S&P 500 ETF", 648, 2100, 0.52, 0.1],
  ["GOOG", "Alphabet", 201, 1900, 0.57, 0.4],
];

const DAYS = 60;

function generateUniverse() {
  const today = new Date();
  const stocks = TICKERS.map(([sym, name, p0, m0, b0, pred], idx) => {
    const rng = mulberry32(9000 + idx * 137);
    const hist = [];

    // 1) chatter first: mentions + bullish share per day
    for (let i = 0; i < DAYS; i++) {
      const spike = rng() < 0.07;
      let mentions = m0 * (0.55 + 0.9 * rng()) * (spike ? 2 + 2.5 * rng() : 1);
      let bull = b0 + (rng() - 0.5) * 0.28;
      if (spike) bull = bull > 0.5 ? Math.min(0.92, bull + 0.16) : Math.max(0.08, bull - 0.16);
      bull = Math.max(0.08, Math.min(0.92, bull));
      hist.push({ mentions: Math.round(mentions), bull, spike });
    }

    // 2) price walk, nudged by YESTERDAY's sentiment (per-stock predictiveness)
    let price = p0 * (0.82 + 0.2 * rng());
    const vol = 0.022 + 0.02 * rng();
    for (let i = 0; i < DAYS; i++) {
      const noise = (rng() - 0.5) * 2 * vol;
      const sent = i > 0 ? hist[i - 1].bull - 0.5 : 0;
      price = price * (1 + noise + pred * sent * 0.055 + 0.0008);
      hist[i].price = price;
    }

    // 3) dates
    hist.forEach((h, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (DAYS - 1 - i));
      h.date = d;
      h.i = i;
    });

    return { sym, name, hist };
  });

  // rank by today's mention volume
  stocks.sort((a, b) => b.hist[DAYS - 1].mentions - a.hist[DAYS - 1].mentions);
  return stocks;
}

// ---------- formatting ----------
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n));
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
  const span = pMax - pMin || 1;
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
  const last = stock.hist[DAYS - 1];
  const prev = stock.hist[DAYS - 2];
  const chg = (last.mentions / prev.mentions - 1) * 100;
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
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: chg >= 0 ? C.bull : C.bear }}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(0)}% vs yd
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

// ---------- main ----------
export default function CrowdTape() {
  const stocks = useMemo(() => generateUniverse(), []);
  const [selectedSym, setSelectedSym] = useState(stocks[0].sym);
  const [range, setRange] = useState(30);
  const [hover, setHover] = useState(null);

  const stock = stocks.find((s) => s.sym === selectedSym) || stocks[0];
  const data = stock.hist.slice(-range);
  const maxMentions = stocks[0].hist[DAYS - 1].mentions;

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
    signals === 0
      ? "No strong-conviction days in this window."
      : rate >= 0.57
      ? "Crowd has been predictive here — arrows led next-day moves more often than not."
      : rate <= 0.43
      ? "Crowd has been a contrarian signal — price tended to move against the arrows."
      : "Coin flip so far — chatter has not reliably led price in this window.";
  const rateColor = signals === 0 ? C.dim : rate >= 0.57 ? C.bull : rate <= 0.43 ? C.bear : C.dim;

  const readout = hover != null ? data[Math.min(hover, data.length - 1)] : data[data.length - 1];
  const rs = signalOf(readout.bull);

  const last = stock.hist[DAYS - 1];
  const dayChg = (last.price / stock.hist[DAYS - 2].price - 1) * 100;

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
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.amber, border: `1px solid ${C.amber}`, padding: "3px 8px", borderRadius: 3, letterSpacing: 1 }}>
            SIMULATED DATA
          </span>
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
                const l = s.hist[DAYS - 1];
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
                <span style={{ fontFamily: MONO, fontSize: 12, color: dayChg >= 0 ? C.bull : C.bear }}>
                  {dayChg >= 0 ? "+" : ""}{dayChg.toFixed(2)}% today
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
            Demo runs on simulated chatter + prices. Wire generateUniverse() to a live feed (ApeWisdom / Tradestie / StockTwits + a price API) and everything else keeps working. Not financial advice.
          </p>
        </main>
      </div>
    </div>
  );
}
