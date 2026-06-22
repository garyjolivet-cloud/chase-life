// functions/api/snow-log.js
// Daily snowfall history for the 14-day bar chart on the winter home.
//
//   GET  /api/snow-log   → public. Returns the last 14 daily entries for the chart.
//   POST /api/snow-log   → Bearer-auth (ADMIN_TOKEN). Captures TODAY's new snow
//                          (dogtooth hn24) into a rolling history. Idempotent per day.
//
// Triggered once daily by a scheduled GitHub Action (see snow-log.yml). The station
// only reports current values, so we must record each day ourselves; this builds the
// 14-day series forward (bootstraps over the first fortnight). Uses the existing
// CHUTES_KV binding; no new infrastructure.

const HISTORY_KEY = 'snow-history';
const KEEP   = 30;   // entries retained in KV (rolling)
const WINDOW = 14;   // entries returned to the chart

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.CHUTES_KV;
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

  // --- READ (public): last 14 days for the chart ---
  if (request.method === 'GET') {
    const hist = await readHistory(kv);
    return new Response(JSON.stringify({ ok: true, days: hist.slice(-WINDOW), count: hist.length }), { headers });
  }

  // --- CAPTURE (auth): record today's snowfall ---
  if (request.method === 'POST') {
    const token = env.ADMIN_TOKEN || '';
    const auth = request.headers.get('authorization') || '';
    if (!token || auth !== `Bearer ${token}`) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers });
    }

    // Pull the current reading from our own weather endpoint and reuse its parsing.
    let cm = 0, tempC = null, windDir = null, ok = false;
    try {
      const origin = new URL(request.url).origin;
      const wRes = await fetch(`${origin}/api/kh-weather`, { headers: { 'cache-control': 'no-store' } });
      const w = await wRes.json();
      const hn24 = w && w.dogtooth ? w.dogtooth.hn24 : null;
      if (typeof hn24 === 'number' && isFinite(hn24) && hn24 >= 0) { cm = Math.min(hn24, 100); ok = true; }
      if (w && w.whiteWall) {
        if (typeof w.whiteWall.airTemp === 'number') tempC = w.whiteWall.airTemp;
        if (typeof w.whiteWall.dir === 'number') windDir = w.whiteWall.dir;
      }
    } catch (e) { /* read failed → store a gap day (cm 0, ok false) */ }

    const date = todayISO();
    const hist = await readHistory(kv);
    const entry = { date, cm, tempC, windDir, ok };
    const i = hist.findIndex(d => d.date === date);
    if (i >= 0) hist[i] = entry; else hist.push(entry);            // idempotent per day
    hist.sort((a, b) => (a.date < b.date ? -1 : 1));
    const trimmed = hist.slice(-KEEP);
    await kv.put(HISTORY_KEY, JSON.stringify(trimmed));

    return new Response(JSON.stringify({ ok: true, captured: entry, count: trimmed.length }), { headers });
  }

  return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), { status: 405, headers });
}

async function readHistory(kv) {
  try {
    const raw = await kv.get(HISTORY_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

// Local date (YYYY-MM-DD) in mountain time, so the "day" boundary matches the hill.
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
