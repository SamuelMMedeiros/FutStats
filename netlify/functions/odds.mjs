const TZ = 'America/Sao_Paulo';
const DEFAULT_SPORT_KEYS = ['soccer_brazil_campeonato', 'soccer_epl', 'soccer_spain_la_liga', 'soccer_germany_bundesliga', 'soccer_italy_serie_a'];
const memoryCache = new Map();

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800', ...headers } });
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null; }
function text(value) { return value == null ? '' : String(value).trim(); }
function listEnv(name, fallback) { const value = text(Netlify.env.get(name)); return value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback; }
function oddsTimestamp(date) { return `${date.toISOString().slice(0, 19)}Z`; }
function dayBounds(date) {
  // America/Sao_Paulo is UTC-03:00. The Odds API requires second precision without milliseconds.
  const start = new Date(`${date}T03:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
  return { from: oddsTimestamp(start), to: oddsTimestamp(end) };
}
function cacheKey(date, sports, regions, markets) { return `odds-v2:${date}:${sports.join(',')}:${regions.join(',')}:${markets.join(',')}`; }
function normalizeTeam(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function normalizeEvent(event, sportKey) {
  return {
    id: text(event?.id), sportKey: text(event?.sport_key || sportKey), commenceTime: text(event?.commence_time), homeTeam: text(event?.home_team), awayTeam: text(event?.away_team),
    bookmakers: (event?.bookmakers || []).map(book => ({ key: text(book.key), title: text(book.title || book.key), lastUpdate: text(book.last_update), markets: (book.markets || []).map(market => ({ key: text(market.key), outcomes: (market.outcomes || []).map(outcome => ({ name: text(outcome.name), price: Number(outcome.price), point: outcome.point == null ? null : Number(outcome.point) })).filter(outcome => Number.isFinite(outcome.price)) })) })).filter(book => book.markets.length)
  };
}
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const upstream = text(body?.message || body?.error || body?.code);
    throw new Error(`ODDS_API_${response.status}${upstream ? `_${upstream}` : ''}`);
  }
  return { body, headers: { remaining: response.headers.get('x-requests-remaining'), used: response.headers.get('x-requests-used'), last: response.headers.get('x-requests-last') } };
}
async function readCache(key) {
  const url = Netlify.env.get('SUPABASE_URL'); const secret = Netlify.env.get('SUPABASE_KEY');
  if (!url || !secret) return null;
  const response = await fetch(`${url}/rest/v1/matches_cache?select=payload,expires_at&cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers: { apikey: secret, Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []); return rows?.[0]?.payload || null;
}
async function writeCache(key, date, payload) {
  const url = Netlify.env.get('SUPABASE_URL'); const secret = Netlify.env.get('SUPABASE_KEY');
  if (!url || !secret) return;
  await fetch(`${url}/rest/v1/matches_cache?on_conflict=cache_key`, { method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ cache_key: key, event_date: date, payload, source: 'the-odds-api', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }), signal: AbortSignal.timeout(8000) }).catch(() => null);
}

export default async function odds(req) {
  if (req.method !== 'GET') return json(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
  const params = new URL(req.url).searchParams;
  const date = validDate(params.get('date'));
  if (!date) return json(400, { success: false, error: 'VALID_DATE_REQUIRED' });
  const apiKey = text(Netlify.env.get('ODDS_API_KEY'));
  if (!apiKey) return json(503, { success: false, error: 'ODDS_API_NOT_CONFIGURED', events: [] });
  const sports = listEnv('ODDS_API_SPORT_KEYS', DEFAULT_SPORT_KEYS);
  const regions = listEnv('ODDS_API_REGIONS', ['eu']);
  const markets = listEnv('ODDS_API_MARKETS', ['h2h', 'totals']);
  const key = cacheKey(date, sports, regions, markets);
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return json(200, cached.body, { 'X-FutStats-Cache': 'memory' });
  const persistent = await readCache(key);
  if (persistent?.success) { memoryCache.set(key, { expiresAt: Date.now() + 300000, body: persistent }); return json(200, persistent, { 'X-FutStats-Cache': 'supabase' }); }
  const bounds = dayBounds(date); const events = []; const errors = []; const quota = {};
  for (const sport of sports) {
    const query = new URLSearchParams({ apiKey, regions: regions.join(','), markets: markets.join(','), oddsFormat: 'decimal', dateFormat: 'iso', commenceTimeFrom: bounds.from, commenceTimeTo: bounds.to });
    try {
      const result = await fetchJson(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds?${query.toString()}`);
      events.push(...(Array.isArray(result.body) ? result.body.map(item => normalizeEvent(item, sport)) : []));
      quota[sport] = result.headers;
    } catch (error) { errors.push({ sport, error: error.message }); }
  }
  const body = { success: true, date, timezone: TZ, events, fetchedAt: new Date().toISOString(), quota, errors, meta: { sports, regions, markets, eventCount: events.length } };
  memoryCache.set(key, { expiresAt: Date.now() + 300000, body }); await writeCache(key, date, body);
  return json(200, body);
}

export const config = { path: '/api/odds' };
