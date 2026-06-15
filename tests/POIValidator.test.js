// POIValidator.test.js
// Tests V1–V8 for validatePOI() — SPEC v0.7 §3.5 / §4.4.
// Reconstructed from src/POIValidator.js behavior (originals were never committed).

import { validatePOI } from '../src/POIValidator.js';

// ─── Fixtures ───────────────────────────────────────────────────────────
// A fully valid record of each type. Tests clone + mutate these.

function validWinterChute() {
  return {
    id: 'tunnel-vision',
    name: 'Tunnel Vision',
    type: 'winter-chute',
    topLatLon: [51.2750, -117.0794],
    radiusMeters: 25,
    stormDirPreference: 'SSW',
    bottomLatLon: [51.2761, -117.0802],
    slopeMin_deg: 38,
    slopeMax_deg: 45,
    widthMin_m: 3,
    widthMax_m: 8,
    topElev_m: 2380,
    bottomElev_m: 2120,
  };
}

function validNarrativePoi() {
  return {
    id: 'whispering-pines',
    name: 'Whispering Pines',
    type: 'narrative-poi',
    topLatLon: [51.2900, -117.0550],
    radiusMeters: 30,
    audioUrl: 'https://example.com/audio.mp3',
    season: 'winter',
  };
}

function validGeneral() {
  return {
    id: 'base-lodge',
    name: 'Base Lodge',
    type: 'general',
    topLatLon: [51.2980, -117.0480],
    radiusMeters: 50,
  };
}

// helper: does any error string match a pattern?
function hasError(result, re) {
  return result.errors.some(e => re.test(e));
}

// ─── V1: valid winter-chute passes ──────────────────────────────────────
test('V1 — validatePOI: a complete winter-chute is valid', () => {
  const result = validatePOI(validWinterChute());
  assertEq(result.valid, true, 'expected valid winter-chute');
  assertEq(result.errors.length, 0, 'expected no errors');
});

// ─── V2: valid narrative-poi passes ─────────────────────────────────────
test('V2 — validatePOI: a complete narrative-poi is valid', () => {
  const result = validatePOI(validNarrativePoi());
  assertEq(result.valid, true, 'expected valid narrative-poi');
  assertEq(result.errors.length, 0, 'expected no errors');
});

// ─── V3: valid general passes ───────────────────────────────────────────
test('V3 — validatePOI: a complete general POI is valid', () => {
  const result = validatePOI(validGeneral());
  assertEq(result.valid, true, 'expected valid general POI');
  assertEq(result.errors.length, 0, 'expected no errors');
});

// ─── V4: bad id and missing name rejected ───────────────────────────────
test('V4 — validatePOI: bad id and missing name are rejected', () => {
  const poi = validGeneral();
  poi.id = 'Bad ID!';   // uppercase + space + special char
  poi.name = '   ';     // blank after trim
  const result = validatePOI(poi);
  assertEq(result.valid, false, 'expected invalid');
  assert(hasError(result, /id/i), 'expected an id error');
  assert(hasError(result, /name/i), 'expected a name error');
});

// ─── V5: topLatLon outside KH bounding box rejected ─────────────────────
test('V5 — validatePOI: topLatLon outside KH bbox is rejected', () => {
  const poi = validGeneral();
  poi.topLatLon = [49.0, -123.0]; // Vancouver-ish, well outside KH
  const result = validatePOI(poi);
  assertEq(result.valid, false, 'expected invalid');
  assert(hasError(result, /bounding box/i), 'expected a bbox error');
});

// ─── V6: radiusMeters out of range rejected ─────────────────────────────
test('V6 — validatePOI: radiusMeters must be within 5–100', () => {
  const tooSmall = validGeneral();
  tooSmall.radiusMeters = 2;
  assertEq(validatePOI(tooSmall).valid, false, 'radius 2 should be invalid');

  const tooBig = validGeneral();
  tooBig.radiusMeters = 250;
  const big = validatePOI(tooBig);
  assertEq(big.valid, false, 'radius 250 should be invalid');
  assert(hasError(big, /radiusMeters/), 'expected a radiusMeters error');
});

// ─── V7: winter-chute reversed ranges rejected ──────────────────────────
test('V7 — validatePOI: winter-chute reversed slope/width/elevation rejected', () => {
  const poi = validWinterChute();
  poi.slopeMin_deg = 50; poi.slopeMax_deg = 40;   // min > max
  poi.widthMin_m = 9;    poi.widthMax_m = 4;       // min > max
  poi.topElev_m = 2000;  poi.bottomElev_m = 2400;  // top below bottom
  const result = validatePOI(poi);
  assertEq(result.valid, false, 'expected invalid');
  assert(hasError(result, /slopeMin_deg/), 'expected slope range error');
  assert(hasError(result, /widthMin_m/),   'expected width range error');
  assert(hasError(result, /topElev_m/),    'expected elevation range error');
});

// ─── V8: type-specific requirements + guards ────────────────────────────
test('V8 — validatePOI: missing audioUrl, bad type, and non-object rejected', () => {
  // narrative-poi missing audioUrl + invalid season
  const narr = validNarrativePoi();
  delete narr.audioUrl;
  narr.season = 'autumn';
  const nr = validatePOI(narr);
  assertEq(nr.valid, false, 'narrative without audioUrl should be invalid');
  assert(hasError(nr, /audioUrl/), 'expected audioUrl error');
  assert(hasError(nr, /season/),   'expected season error');

  // invalid type
  const bad = validGeneral();
  bad.type = 'banana';
  assertEq(validatePOI(bad).valid, false, 'unknown type should be invalid');

  // non-object guard
  assertEq(validatePOI(null).valid, false, 'null should be invalid');
  assertEq(validatePOI(42).valid, false, 'number should be invalid');
});
