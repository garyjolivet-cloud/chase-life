// functions/api/config.js
// Cloudflare Pages Function — global mountain settings.
//
// Routes:
//   GET     /api/config   → current settings (public; the skier app reads this)
//   POST    /api/config   → merge settings (admin token required)
//   OPTIONS /api/config   → CORS preflight
//
// Bindings (shared with pois.js):
//   CHUTES_KV     → KV namespace "chase-life-chutes"
//   ADMIN_TOKEN   → secret string (env var)
//
// Storage model:
//   Single KV key "config" holds a JSON object of global settings.
//
// Settings:
//   fullGpsMode (bool) — when true, phones disable the battery saver and
//     track GPS at full rate always (summer / field work, energy not a concern).
//     When false (default), the two-tier SCAN/TRACK power manager is active.

const CONFIG_KEY = 'config';

const DEFAULTS = {
  fullGpsMode: false,
};

// ─── CORS (mirrors pois.js) ─────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://chase-life-admin.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'null',
]);

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

function jsonResponse(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

function errorResponse(message, status, request, extra = {}) {
  return jsonResponse({ error: message, ...extra }, status, request);
}

// ─── KV helpers ─────────────────────────────────────────────
async function readConfig(kv) {
  const raw = await kv.get(CONFIG_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (err) {
    console.error('Config JSON parse failed:', err);
    return { ...DEFAULTS };
  }
}

async function writeConfig(kv, config) {
  await kv.put(CONFIG_KEY, JSON.stringify(config));
}

// ─── Auth (mirrors pois.js) ─────────────────────────────────
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function checkAuth(request, env) {
  if (!env.ADMIN_TOKEN || typeof env.ADMIN_TOKEN !== 'string') {
    return errorResponse('ADMIN_TOKEN env var is not configured on this deployment.', 500, request);
  }
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    return errorResponse('Missing or malformed Authorization header (expected "Bearer <token>")', 401, request);
  }
  if (!safeEqual(match[1], env.ADMIN_TOKEN)) {
    return errorResponse('Invalid admin token', 401, request);
  }
  return null;
}

// ─── Handlers ───────────────────────────────────────────────
export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestGet({ request, env }) {
  if (!env.CHUTES_KV) {
    return errorResponse('CHUTES_KV binding is missing on this deployment.', 500, request);
  }
  let config;
  try {
    config = await readConfig(env.CHUTES_KV);
  } catch (err) {
    console.error('Failed to read config from KV:', err);
    return errorResponse('Failed to read config from KV', 500, request);
  }
  return jsonResponse(config, 200, request);
}

export async function onRequestPost({ request, env }) {
  if (!env.CHUTES_KV) {
    return errorResponse('CHUTES_KV binding missing', 500, request);
  }
  const authErr = checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse('Request body must be valid JSON', 400, request);
  }
  if (!body || typeof body !== 'object') {
    return errorResponse('Body must be a JSON object', 400, request);
  }

  // Validate known keys (ignore unknown keys rather than store junk).
  const patch = {};
  if ('fullGpsMode' in body) {
    if (typeof body.fullGpsMode !== 'boolean') {
      return errorResponse('fullGpsMode must be a boolean', 400, request);
    }
    patch.fullGpsMode = body.fullGpsMode;
  }
  if (Object.keys(patch).length === 0) {
    return errorResponse('No recognised settings in body (expected: fullGpsMode)', 400, request);
  }

  let config;
  try {
    config = await readConfig(env.CHUTES_KV);
  } catch (err) {
    return errorResponse('Failed to read config from KV', 500, request);
  }

  config = { ...config, ...patch, updatedAt: new Date().toISOString() };

  try {
    await writeConfig(env.CHUTES_KV, config);
  } catch (err) {
    console.error('Failed to write config to KV:', err);
    return errorResponse('Failed to write config to KV', 500, request);
  }

  return jsonResponse({ saved: config }, 200, request);
}
