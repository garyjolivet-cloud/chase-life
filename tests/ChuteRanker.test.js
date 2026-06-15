// ChuteRanker.test.js
// Tests R1–R10 for ChuteRanker — SPEC v0.7 §3.7.
// Reconstructed from src/ChuteRanker.js (originals were never committed).
//
// Formula: score = round(100 * (0.40*snow + 0.30*dir + 0.15*slope + 0.15*trust))
// Each expected value below is derived directly from that formula, so a
// failure indicates a real discrepancy in the ranker, not a fitted test.

import { ChuteRanker } from '../src/ChuteRanker.js';

const ranker = new ChuteRanker();

// ─── Fixtures ───────────────────────────────────────────────────────────

// Ideal-slope chute (mid 43 → slope_score 1.0), pref SSW (202.5°).
function chute(overrides = {}) {
  return {
    id: 'c',
    type: 'winter-chute',
    stormDirPreference: 'SSW',
    slopeMin_deg: 38,
    slopeMax_deg: 48,
    skiedThisSeason: false,
    patrolControlled: false,
    ...overrides,
  };
}

function weather({ snow_cm = 0, isRain = false, avgKph = 0, dominantDir = 0 } = {}) {
  return {
    overnight: { snow_cm, isRain },
    wind: { avgKph, dominantDir },
  };
}

// ─── R1: perfect conditions → 100 ───────────────────────────────────────
// snow 1.0, dir 1.0 (strong wind exactly on preference), slope 1.0, trust 1.0
test('R1 — scoreOne: perfect chute in perfect conditions scores 100', () => {
  const c = chute({ skiedThisSeason: true, patrolControlled: true });
  const w = weather({ snow_cm: 30, avgKph: 30, dominantDir: 202.5 });
  assertEq(ranker.scoreOne(c, w), 100, 'expected a perfect 100');
});

// ─── R2: no snow, calm wind, ideal slope, full trust → 60 ───────────────
// snow 0, dir 1.0 (calm → neutral), slope 1.0, trust 1.0
// 100*(0 + 0.30 + 0.15 + 0.15) = 60
test('R2 — scoreOne: no snow but calm + ideal slope + trust → 60', () => {
  const c = chute({ skiedThisSeason: true, patrolControlled: true });
  const w = weather({ snow_cm: 0, avgKph: 5, dominantDir: 0 });
  assertEq(ranker.scoreOne(c, w), 60, 'expected 60');
});

// ─── R3: rain zeroes the snow component ─────────────────────────────────
// isRain true with 40cm → snow 0. calm, ideal slope, no trust.
// 100*(0 + 0.30 + 0.15 + 0) = 45
test('R3 — explainScore: rain forces snow sub-score to 0', () => {
  const c = chute(); // no trust
  const w = weather({ snow_cm: 40, isRain: true, avgKph: 5 });
  const ex = ranker.explainScore(c, w);
  assertEq(ex.snow, 0, 'rain should zero the snow sub-score');
  assertEq(ex.total, 45, 'expected total 45');
});

// ─── R4: strong wind opposite to preference tanks direction ─────────────
// pref N (0°), wind from 180° @ 30kph → transport 1, rawMatch 0 → dir 0.
// snow 1.0 (25cm), slope 1.0, no trust → 100*(0.40 + 0 + 0.15 + 0) = 55
test('R4 — scoreOne: strong opposing wind drives direction score to 0', () => {
  const c = chute({ stormDirPreference: 'N' });
  const w = weather({ snow_cm: 25, avgKph: 30, dominantDir: 180 });
  assertEq(ranker.scoreOne(c, w), 55, 'expected 55');
});

// ─── R5: same opposing wind but CALM → blending removes the penalty ─────
// Identical to R4 except avgKph 10 (≤15 → transport 0 → dir neutral 1.0).
// 100*(0.40 + 0.30 + 0.15 + 0) = 85.  R4 vs R5 proves wind-transport blend.
test('R5 — scoreOne: calm wind makes direction neutral despite mismatch', () => {
  const c = chute({ stormDirPreference: 'N' });
  const w = weather({ snow_cm: 25, avgKph: 10, dominantDir: 180 });
  assertEq(ranker.scoreOne(c, w), 85, 'expected 85 (blending neutralizes direction)');
});

// ─── R6: slope sub-score band behavior ──────────────────────────────────
test('R6 — explainScore: slope sub-score follows ideal/ramp/hard bands', () => {
  const w = weather({ snow_cm: 0, avgKph: 0 });
  const ideal = ranker.explainScore(chute({ slopeMin_deg: 38, slopeMax_deg: 48 }), w); // mid 43
  assertEq(ideal.slope, 1.0, 'mid 43 should be ideal (1.0)');

  const halfway = ranker.explainScore(chute({ slopeMin_deg: 25, slopeMax_deg: 38 }), w); // mid 31.5
  assertClose(halfway.slope, 0.5, 0.001, 'mid 31.5 should ramp to ~0.5');

  const tooShallow = ranker.explainScore(chute({ slopeMin_deg: 10, slopeMax_deg: 20 }), w); // mid 15
  assertEq(tooShallow.slope, 0, 'mid 15 (below hard min) should be 0');
});

// ─── R7: trust sub-score increments per signal ──────────────────────────
test('R7 — explainScore: trust = 0.5 per signal, capped at 1.0', () => {
  const w = weather();
  const none = ranker.explainScore(chute({ skiedThisSeason: false, patrolControlled: false }), w);
  const one  = ranker.explainScore(chute({ skiedThisSeason: true,  patrolControlled: false }), w);
  const both = ranker.explainScore(chute({ skiedThisSeason: true,  patrolControlled: true  }), w);
  assertEq(none.trust, 0,   'no signals → 0');
  assertEq(one.trust,  0.5, 'one signal → 0.5');
  assertEq(both.trust, 1.0, 'both signals → 1.0');
});

// ─── R8: rank() sorts chutes desc and places non-chutes after ───────────
test('R8 — rank: winter-chutes sorted by score desc, non-chutes pass through', () => {
  const w = weather({ snow_cm: 30, avgKph: 5 }); // snow differs by chute below
  const high = chute({ id: 'high', skiedThisSeason: true, patrolControlled: true });
  const low  = chute({ id: 'low' }); // no trust → lower score
  const place = { id: 'lodge', type: 'general' };
  const out = ranker.rank([low, place, high], w);
  assertEq(out.map(p => p.id), ['high', 'low', 'lodge'], 'expected high, low, then general');
  assert(typeof out[0].score === 'number', 'chute should have a score');
  assert(out[2].score === undefined, 'general POI should not get a score');
});

// ─── R9: rank() handles empty / invalid input ───────────────────────────
test('R9 — rank: empty or invalid input returns []', () => {
  assertEq(ranker.rank([]), [], 'empty array → []');
  assertEq(ranker.rank(null), [], 'null → []');
  assertEq(ranker.rank(undefined), [], 'undefined → []');
});

// ─── R10: non-chutes return null; valid score is an int in 0–100 ────────
test('R10 — scoreOne/explainScore: non-chutes → null; chute score is int 0–100', () => {
  assertEq(ranker.scoreOne({ type: 'general' }), null, 'general → null');
  assertEq(ranker.explainScore({ type: 'narrative-poi' }), null, 'narrative → null');
  const s = ranker.scoreOne(chute(), weather({ snow_cm: 12, avgKph: 5 }));
  assert(Number.isInteger(s), 'score should be an integer');
  assert(s >= 0 && s <= 100, 'score should be within 0–100');
});
