// POIValidator.js — type-aware POI schema validation
// ─────────────────────────────────────────────────────────────
// Validates POI records before they are written to KV.
// Returns { valid: boolean, errors: string[] }
//
// Per SPEC v0.7 §3.5 and §4.4.
//
// Pure JavaScript. No DOM, no network, no Cloudflare APIs.

// ─── Constants ──────────────────────────────────────────────

// KH bounding box (lat min/max, lon min/max).
// Matches SPEC v0.7 §3.5 validation rules.
const KH_BBOX = {
  latMin: 51.26,
  latMax: 51.31,
  lonMin: -117.10,
  lonMax: -117.03,
};

// 16-point compass labels for stormDirPreference (SPEC §3.5).
const COMPASS_16 = [
  'N',  'NNE', 'NE', 'ENE',
  'E',  'ESE', 'SE', 'SSE',
  'S',  'SSW', 'SW', 'WSW',
  'W',  'WNW', 'NW', 'NNW',
];

const VALID_TYPES = ['winter-chute', 'narrative-poi', 'general'];
const VALID_SEASONS = ['summer', 'winter', 'any'];
const VALID_DIFFICULTY = ['green', 'blue', 'black', 'double-black'];

const RADIUS_MIN = 5;
const RADIUS_MAX = 100;

// ─── ID format check ────────────────────────────────────────
// Lowercase letters, digits, hyphens only. Must not start/end with hyphen.
const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RUN_REGEX = /^[A-Za-z0-9-]{1,10}$/;

// ─── Helpers ────────────────────────────────────────────────

function isInsideKHBbox(latLon) {
  if (!Array.isArray(latLon) || latLon.length !== 2) return false;
  const [lat, lon] = latLon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  return (
    lat >= KH_BBOX.latMin && lat <= KH_BBOX.latMax &&
    lon >= KH_BBOX.lonMin && lon <= KH_BBOX.lonMax
  );
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNumber(v) {
  return typeof v === 'number' && !isNaN(v) && isFinite(v);
}

// ─── Per-type validators ────────────────────────────────────

function validateCommonFields(poi, errors) {
  // id
  if (!isNonEmptyString(poi.id)) {
    errors.push('id is required and must be a non-empty string');
  } else if (!ID_REGEX.test(poi.id)) {
    errors.push(`id "${poi.id}" must be lowercase letters/digits/hyphens only (no spaces or special chars)`);
  }

  // name
  if (!isNonEmptyString(poi.name)) {
    errors.push('name is required and must be a non-empty string');
  }

  // type
  if (!VALID_TYPES.includes(poi.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')} (got "${poi.type}")`);
  }

  // topLatLon
  if (!Array.isArray(poi.topLatLon) || poi.topLatLon.length !== 2) {
    errors.push('topLatLon is required and must be [lat, lon]');
  } else if (!isInsideKHBbox(poi.topLatLon)) {
    errors.push(`topLatLon ${JSON.stringify(poi.topLatLon)} is outside the KH bounding box`);
  }

  // radiusMeters
  if (!isNumber(poi.radiusMeters)) {
    errors.push('radiusMeters is required and must be a number');
  } else if (poi.radiusMeters < RADIUS_MIN || poi.radiusMeters > RADIUS_MAX) {
    errors.push(`radiusMeters must be between ${RADIUS_MIN} and ${RADIUS_MAX} (got ${poi.radiusMeters})`);
  }
}

function validateWinterChuteFields(poi, errors) {
  // stormDirPreference
  if (!COMPASS_16.includes(poi.stormDirPreference)) {
    errors.push(`stormDirPreference must be one of the 16 compass labels (got "${poi.stormDirPreference}")`);
  }
  if (!VALID_DIFFICULTY.includes(poi.difficulty)) {
    errors.push(`difficulty must be one of: ${VALID_DIFFICULTY.join(', ')} (got "${poi.difficulty}")`);
  }
  if (typeof poi.runNumber !== 'string' || !RUN_REGEX.test(poi.runNumber)) {
    errors.push('runNumber is required for winter-chute (digits or a short code, e.g. "12" or "12A")');
  }
  if (poi.noFallZone !== undefined && typeof poi.noFallZone !== 'boolean') {
    errors.push('noFallZone must be a boolean if present');
  }

  // Fall line: a winter-chute needs a descent bearing. It can come from an explicit
  // aspectDeg (preferred — always obtainable, even for chutes you can't reach the bottom of)
  // and/or a bottomLatLon (optional refinement). At least one must be present.
  if (poi.bottomLatLon !== undefined && poi.bottomLatLon !== null) {
    if (!Array.isArray(poi.bottomLatLon) || poi.bottomLatLon.length !== 2) {
      errors.push('bottomLatLon must be [lat, lon] if present');
    } else if (!isInsideKHBbox(poi.bottomLatLon)) {
      errors.push(`bottomLatLon ${JSON.stringify(poi.bottomLatLon)} is outside the KH bounding box`);
    }
  }
  if (poi.aspectDeg !== undefined && poi.aspectDeg !== null && poi.aspectDeg !== '') {
    if (!isNumber(poi.aspectDeg) || poi.aspectDeg < 0 || poi.aspectDeg >= 360) {
      errors.push('aspectDeg must be a number 0–359 (the fall-line / descent bearing) if present');
    }
  }
  const hasBottom = Array.isArray(poi.bottomLatLon) && poi.bottomLatLon.length === 2;
  const hasAspect = isNumber(poi.aspectDeg) && poi.aspectDeg >= 0 && poi.aspectDeg < 360;
  if (!hasBottom && !hasAspect) {
    errors.push('winter-chute needs a fall line: set aspectDeg (descent bearing 0–359) or a bottomLatLon');
  }

  // slope range
  if (!isNumber(poi.slopeMin_deg) || !isNumber(poi.slopeMax_deg)) {
    errors.push('slopeMin_deg and slopeMax_deg are required and must be numbers');
  } else if (poi.slopeMin_deg > poi.slopeMax_deg) {
    errors.push(`slopeMin_deg (${poi.slopeMin_deg}) must be <= slopeMax_deg (${poi.slopeMax_deg})`);
  }

  // width range
  if (!isNumber(poi.widthMin_m) || !isNumber(poi.widthMax_m)) {
    errors.push('widthMin_m and widthMax_m are required and must be numbers');
  } else if (poi.widthMin_m > poi.widthMax_m) {
    errors.push(`widthMin_m (${poi.widthMin_m}) must be <= widthMax_m (${poi.widthMax_m})`);
  }

  // elevation range
  if (!isNumber(poi.topElev_m) || !isNumber(poi.bottomElev_m)) {
    errors.push('topElev_m and bottomElev_m are required and must be numbers');
  } else if (poi.topElev_m < poi.bottomElev_m) {
    errors.push(`topElev_m (${poi.topElev_m}) must be >= bottomElev_m (${poi.bottomElev_m})`);
  }
}

function validateNarrativePoiFields(poi, errors) {
  // season
  if (!VALID_SEASONS.includes(poi.season)) {
    errors.push(`season must be one of: ${VALID_SEASONS.join(', ')} (got "${poi.season}")`);
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Validate a POI record against the v0.7 schema.
 * @param {object} poi - POI record to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePOI(poi) {
  const errors = [];

  if (poi === null || typeof poi !== 'object') {
    return { valid: false, errors: ['poi must be an object'] };
  }

  // Common fields first (always validated)
  validateCommonFields(poi, errors);

  // Type-specific fields (only if type is one we recognize)
  if (poi.type === 'winter-chute') {
    validateWinterChuteFields(poi, errors);
  } else if (poi.type === 'narrative-poi') {
    validateNarrativePoiFields(poi, errors);
  } else if (poi.type === 'general') {
    // No additional validation; common fields are enough
  }
  // If type is invalid, validateCommonFields already added that error;
  // we skip type-specific validation to avoid noise.

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Export the constants too, in case tests or callers want to reference them
export const VALIDATOR_CONSTANTS = {
  KH_BBOX,
  COMPASS_16,
  VALID_TYPES,
  VALID_SEASONS,
  VALID_DIFFICULTY,
  RUN_REGEX,
  RADIUS_MIN,
  RADIUS_MAX,
  ID_REGEX,
};
