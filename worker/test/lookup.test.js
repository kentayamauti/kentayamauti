import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { tileOf, containsPoint, parsePrice } from '../src/index.js';

const LAT = 34.7680;
const LON = 134.8380;

// 物件地点を囲む正方形ポリゴン
const around = (d) => ({
  type: 'Polygon',
  coordinates: [[[LON - d, LAT - d], [LON + d, LAT - d], [LON + d, LAT + d], [LON - d, LAT + d], [LON - d, LAT - d]]]
});
const away = { type: 'Polygon', coordinates: [[[135, 35], [135.01, 35], [135.01, 35.01], [135, 35]]] };

function mockFetch(calls) {
  return async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, headers: (init && init.headers) || {} });
    const id = u.pathname.split('/').pop();
    const body = {
      LonLatToAddress: { results: { muniCd: '28216', lv01Nm: '荒井町' } },
      XPT002: u.searchParams.get('year') === String(new Date().getFullYear())
        ? { type: 'FeatureCollection', features: [] } // 当年分は未公表を想定
        : {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', geometry: { type: 'Point', coordinates: [LON + 0.002, LAT] }, properties: { u_current_years_price_ja: '68,000(円/㎡)', standard_lot_number_ja: '高砂-1' } },
              { type: 'Feature', geometry: { type: 'Point', coordinates: [LON + 0.02, LAT] }, properties: { u_current_years_price_ja: '55,000(円/㎡)', standard_lot_number_ja: '高砂-2' } }
            ]
          },
      XIT001: {
        status: 'OK',
        data: [
          { Type: '宅地(土地)', DistrictName: '荒井町', TradePrice: '6000000', Area: '100', UnitPrice: '', Period: '2025年第2四半期' },
          { Type: '宅地(土地)', DistrictName: '荒井町', TradePrice: '8000000', Area: '100', UnitPrice: '80000', Period: '2025年第3四半期' },
          { Type: '宅地(土地)', DistrictName: '曽根町', TradePrice: '3000000', Area: '100', Period: '2024年第1四半期' },
          { Type: '宅地(土地と建物)', DistrictName: '荒井町', TradePrice: '9500000', Area: '120', Period: '2025年第1四半期' },
          { Type: '中古マンション等', DistrictName: '荒井町', TradePrice: '15000000', Area: '70', Period: '2025年第1四半期' }
        ]
      },
      XKT002: { features: [{ geometry: around(0.01), properties: { use_area_ja: '第一種住居地域', u_floor_area_ratio_ja: '200%', u_building_coverage_ratio_ja: '60%' } }] },
      XKT026: { features: [
        { geometry: around(0.01), properties: { A31a_205: 2, A31a_202: '加古川' } },
        { geometry: around(0.01), properties: { A31a_205: 4, A31a_202: '法華山谷川' } },
        { geometry: away, properties: { A31a_205: 9 } }
      ] },
      XKT027: { features: [{ geometry: around(0.01), properties: { A49_003: '0.5m以上1.0m未満' } }] },
      XKT028: { features: [] },
      XKT029: { features: [{ geometry: away, properties: { A33_002: '2' } }] }
    }[id];
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

test('lookup aggregates land prices, transactions, zoning and hazards', async () => {
  const calls = [];
  globalThis.fetch = mockFetch(calls);
  const res = await worker.fetch(new Request(`https://w.example/lookup?lat=${LAT}&lon=${LON}`), { REINFOLIB_API_KEY: 'k' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const r = await res.json();

  assert.equal(r.location.cityCode, '28216');
  assert.equal(r.landPrices.value.year, new Date().getFullYear() - 1, 'falls back to previous year');
  assert.equal(r.landPrices.value.points[0].price, 68000);
  assert.equal(r.landPrices.value.points[0].label, '高砂-1');
  assert.ok(r.landPrices.value.points[0].distance < r.landPrices.value.points[1].distance);

  assert.equal(r.transactions.value.landUnitPrice.district.count, 4, 'two years x two district land rows');
  assert.equal(r.transactions.value.landUnitPrice.district.median, 70000);
  assert.equal(r.transactions.value.housePrice.district.median, 9500000);
  assert.equal(r.transactions.value.samples[0].period, '2025年第3四半期');

  assert.deepEqual(r.zoning.value, { inside: true, name: '第一種住居地域', floorAreaRatio: '200%', buildingCoverageRatio: '60%' });
  assert.equal(r.hazards.flood.value.maxRank, 4);
  assert.deepEqual(r.hazards.flood.value.rivers, ['加古川', '法華山谷川']);
  assert.deepEqual(r.hazards.stormSurge.value.depths, ['0.5m以上1.0m未満']);
  assert.equal(r.hazards.tsunami.value.inside, false);
  assert.equal(r.hazards.landslide.value.inside, false, 'polygon away from point is ignored');

  const api = calls.filter((c) => c.url.hostname === 'www.reinfolib.mlit.go.jp');
  assert.ok(api.every((c) => c.headers['Ocp-Apim-Subscription-Key'] === 'k'));
  assert.ok(api.filter((c) => c.url.pathname.endsWith('XIT001')).every((c) => c.url.searchParams.get('city') === '28216'));
});

test('a failing API is reported without breaking the rest', async () => {
  const calls = [];
  const base = mockFetch(calls);
  globalThis.fetch = async (url, init) => (String(url).includes('XKT026') ? new Response('err', { status: 500 }) : base(url, init));
  const r = await (await worker.fetch(new Request(`https://w.example/lookup?lat=${LAT}&lon=${LON}`), { REINFOLIB_API_KEY: 'k' })).json();
  assert.equal(r.hazards.flood.ok, false);
  assert.equal(r.zoning.ok, true);
});

test('rejects bad input, missing key and disallowed origins', async () => {
  globalThis.fetch = mockFetch([]);
  assert.equal((await worker.fetch(new Request('https://w.example/lookup?lat=x&lon=1'), { REINFOLIB_API_KEY: 'k' })).status, 400);
  assert.equal((await worker.fetch(new Request('https://w.example/lookup?lat=34&lon=134'), {})).status, 500);
  assert.equal((await worker.fetch(new Request('https://w.example/other'), { REINFOLIB_API_KEY: 'k' })).status, 404);
  const env = { REINFOLIB_API_KEY: 'k', ALLOWED_ORIGINS: 'https://ok.example' };
  const bad = await worker.fetch(new Request('https://w.example/lookup?lat=34&lon=134', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(bad.status, 403);
  const good = await worker.fetch(new Request('https://w.example/lookup?lat=34&lon=134', { headers: { Origin: 'https://ok.example' } }), env);
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), 'https://ok.example');
});

test('helpers', () => {
  assert.deepEqual(
    (({ x, y }) => ({ x, y }))(tileOf(35.681236, 139.767125, 15)),
    { x: 29105, y: 12903 } // 東京駅
  );
  assert.equal(containsPoint(around(0.001), LON, LAT), true);
  assert.equal(containsPoint(away, LON, LAT), false);
  assert.equal(parsePrice('3,100,000(円/㎡)'), 3100000);
});
