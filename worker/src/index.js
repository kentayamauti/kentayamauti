// 不動産情報ライブラリ API の中継 Worker
// APIキーをブラウザに出さずに、物件地点の地価・成約事例・ハザード・用途地域をまとめて返す。
//
// GET /lookup?lat=34.76&lon=134.84
//
// 環境変数
//   REINFOLIB_API_KEY  不動産情報ライブラリのAPIキー（wrangler secret put で設定）
//   ALLOWED_ORIGINS    許可するオリジン（カンマ区切り）。未設定なら全て許可

const REINFOLIB = 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const REVERSE_GEOCODER = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const CACHE_TTL = 60 * 60 * 24; // 1日

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== '/lookup') return json({ error: 'not_found' }, 404, cors);

    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json({ error: 'invalid_coordinates' }, 400, cors);
    }
    if (!env.REINFOLIB_API_KEY) return json({ error: 'api_key_not_configured' }, 500, cors);

    // 同じ地点（約10m単位）の結果はキャッシュする
    const cacheKey = new Request(`https://cache.local/lookup?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return withHeaders(hit, cors);
    }

    const result = await lookup(lat, lon, env.REINFOLIB_API_KEY);
    const response = json(result, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL}` });
    if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return withHeaders(response, cors);
  }
};

export async function lookup(lat, lon, apiKey) {
  const api = (id, params) => reinfolib(id, params, apiKey);
  const year = new Date().getFullYear();

  const city = await reverseGeocode(lat, lon);
  const [landPrices, transactions, zoning, flood, stormSurge, tsunami, landslide] = await Promise.all([
    settle(nearbyLandPrices(api, lat, lon, year)),
    settle(city.code ? cityTransactions(api, city, year) : Promise.resolve(null)),
    settle(featuresAt(api, 'XKT002', lat, lon, 15)),
    settle(featuresAt(api, 'XKT026', lat, lon, 15)),
    settle(featuresAt(api, 'XKT027', lat, lon, 15)),
    settle(featuresAt(api, 'XKT028', lat, lon, 15)),
    settle(featuresAt(api, 'XKT029', lat, lon, 15))
  ]);

  return {
    location: { lat, lon, cityCode: city.code, district: city.district },
    landPrices,
    transactions,
    zoning: mapOk(zoning, summarizeZoning),
    hazards: {
      flood: mapOk(flood, summarizeFlood),
      stormSurge: mapOk(stormSurge, (fs) => summarizeDepth(fs, 'A49_003')),
      tsunami: mapOk(tsunami, (fs) => summarizeDepth(fs, 'A40_003')),
      landslide: mapOk(landslide, summarizeLandslide)
    }
  };
}

// ---- 地価公示・地価調査（XPT002）------------------------------------------

async function nearbyLandPrices(api, lat, lon, year) {
  // z=13 の地点タイルと、地点に近い側の隣接タイル（計4枚）から住宅地のポイントを集める
  const z = 13;
  const t = tileOf(lat, lon, z);
  const dx = t.fx < 0.5 ? -1 : 1;
  const dy = t.fy < 0.5 ? -1 : 1;
  const tiles = [[t.x, t.y], [t.x + dx, t.y], [t.x, t.y + dy], [t.x + dx, t.y + dy]];

  for (const y of [year, year - 1]) {
    const lists = await Promise.all(tiles.map(([x, ty]) =>
      api('XPT002', { response_format: 'geojson', z, x, y: ty, year: y, useCategoryCode: '00' })
        .then((g) => (g && g.features) || [])
        .catch(() => [])
    ));
    const points = lists.flat()
      .filter((f) => f.geometry && f.geometry.type === 'Point')
      .map((f) => {
        const [plon, plat] = f.geometry.coordinates;
        const p = f.properties || {};
        return {
          price: parsePrice(p.u_current_years_price_ja),
          distance: Math.round(distanceMeters(lat, lon, plat, plon)),
          label: firstOf(p, ['standard_lot_number_ja', 'location_number_ja', 'place_name_ja']),
          address: firstOf(p, ['location_number_ja', 'residence_display_name_ja', 'location_ja']),
          station: firstOf(p, ['nearest_station_name_ja']),
          lat: plat,
          lon: plon
        };
      })
      .filter((p) => p.price > 0);

    if (points.length) {
      const unique = dedupe(points, (p) => `${p.lat},${p.lon}`);
      unique.sort((a, b) => a.distance - b.distance);
      return { year: y, points: unique.slice(0, 5) };
    }
  }
  return { year: null, points: [] };
}

// ---- 不動産取引価格・成約価格（XIT001）-------------------------------------

async function cityTransactions(api, city, year) {
  const lists = await Promise.all([year, year - 1].map((y) =>
    api('XIT001', { year: y, city: city.code })
      .then((r) => (r && r.data) || [])
      .catch(() => [])
  ));
  const rows = lists.flat();

  const landUnit = (r) => {
    const unit = num(r.UnitPrice);
    if (unit > 0) return unit;
    const price = num(r.TradePrice);
    const area = num(r.Area);
    return price > 0 && area > 0 ? price / area : 0;
  };

  const land = rows.filter((r) => r.Type === '宅地(土地)').map((r) => ({ r, unit: landUnit(r) })).filter((x) => x.unit > 0);
  const houses = rows.filter((r) => r.Type === '宅地(土地と建物)' && num(r.TradePrice) > 0);

  const inDistrict = (r) => city.district && r.DistrictName &&
    (city.district.indexOf(r.DistrictName) !== -1 || r.DistrictName.indexOf(city.district) !== -1);
  const districtLand = land.filter((x) => inDistrict(x.r));
  const districtHouses = houses.filter(inDistrict);

  return {
    years: [year - 1, year],
    district: city.district || null,
    landUnitPrice: {
      district: stats(districtLand.map((x) => x.unit)),
      city: stats(land.map((x) => x.unit))
    },
    housePrice: {
      district: stats(districtHouses.map((r) => num(r.TradePrice))),
      city: stats(houses.map((r) => num(r.TradePrice)))
    },
    samples: (districtLand.length ? districtLand : land)
      .slice()
      .sort((a, b) => periodKey(b.r.Period) - periodKey(a.r.Period))
      .slice(0, 8)
      .map(({ r, unit }) => ({
        district: r.DistrictName || '',
        period: r.Period || '',
        price: num(r.TradePrice),
        area: num(r.Area),
        unitPrice: Math.round(unit),
        category: r.PriceCategory || ''
      }))
  };
}

// ---- 用途地域・ハザード（XKT002 / XKT026〜029）-----------------------------

async function featuresAt(api, id, lat, lon, z) {
  const t = tileOf(lat, lon, z);
  const g = await api(id, { response_format: 'geojson', z, x: t.x, y: t.y });
  const features = (g && g.features) || [];
  return features.filter((f) => containsPoint(f.geometry, lon, lat)).map((f) => f.properties || {});
}

function summarizeZoning(props) {
  if (!props.length) return { inside: false };
  const p = props[0];
  return {
    inside: true,
    name: p.use_area_ja || '',
    floorAreaRatio: p.u_floor_area_ratio_ja || '',
    buildingCoverageRatio: p.u_building_coverage_ratio_ja || ''
  };
}

function summarizeFlood(props) {
  if (!props.length) return { inside: false };
  const ranks = props.map((p) => num(p.A31a_205)).filter((n) => n > 0);
  const rivers = dedupe(props.map((p) => p.A31a_202).filter(Boolean), (s) => s);
  return { inside: true, maxRank: ranks.length ? Math.max(...ranks) : null, rivers };
}

function summarizeDepth(props, key) {
  if (!props.length) return { inside: false };
  return { inside: true, depths: dedupe(props.map((p) => p[key]).filter(Boolean), (s) => s) };
}

function summarizeLandslide(props) {
  if (!props.length) return { inside: false };
  const special = props.some((p) => String(p.A33_002) === '2');
  return { inside: true, level: special ? '土砂災害特別警戒区域' : '土砂災害警戒区域' };
}

// ---- 外部API ---------------------------------------------------------------

async function reinfolib(id, params, apiKey) {
  const url = new URL(REINFOLIB + id);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'Ocp-Apim-Subscription-Key': apiKey } });
  if (!res.ok) throw new Error(`${id} ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`${REVERSE_GEOCODER}?lat=${lat}&lon=${lon}`);
    const body = await res.json();
    const r = (body && body.results) || {};
    return { code: r.muniCd || null, district: r.lv01Nm && r.lv01Nm !== '−' ? r.lv01Nm : null };
  } catch (e) {
    return { code: null, district: null };
  }
}

// ---- ユーティリティ --------------------------------------------------------

export function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, fx: xf - x, fy: yf - y };
}

export function containsPoint(geometry, x, y) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(geometry.coordinates, x, y);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => inPolygon(poly, x, y));
  return false;
}

function inPolygon(rings, x, y) {
  if (!rings.length || !inRing(rings[0], x, y)) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(rings[i], x, y)) return false; // 穴
  return true;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function parsePrice(text) {
  if (text == null) return 0;
  const head = String(text).split('(')[0];
  return num(head);
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function stats(values) {
  if (!values.length) return { count: 0, median: null };
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { count: s.length, median: Math.round(median), min: Math.round(s[0]), max: Math.round(s[s.length - 1]) };
}

function periodKey(period) {
  const m = /(\d{4})年第(\d)四半期/.exec(period || '');
  return m ? Number(m[1]) * 10 + Number(m[2]) : 0;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function firstOf(obj, keys) {
  for (const k of keys) if (obj[k]) return obj[k];
  return '';
}

function dedupe(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const k = keyFn(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function mapOk(settled, fn) {
  return settled.ok ? { ok: true, value: fn(settled.value) } : settled;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && origin && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': allowed.length ? origin || allowed[0] : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function withHeaders(response, headers) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}
