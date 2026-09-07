const TZ = 'America/Sao_Paulo';
const DEFAULT_DAILY_BUDGET = 80;
const memoryCache = new Map();

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600', ...headers }
  });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
}

function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function isoLocalDate(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function dateKey(start, end) { return `fixtures-v2:${start}:${end}`; }
function addDays(iso, amount) { const date = new Date(`${iso}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return isoLocalDate(date); }
function dateChunks(start, end, maxDays = 7) {
  const chunks = []; let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, maxDays - 1) < end ? addDays(cursor, maxDays - 1) : end;
    chunks.push([cursor, chunkEnd]);
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

function statusFromFootballData(status) {
  return ({ SCHEDULED: 'scheduled', TIMED: 'scheduled', IN_PLAY: 'live', PAUSED: 'live', FINISHED: 'finished', POSTPONED: 'postponed', SUSPENDED: 'suspended', CANCELLED: 'cancelled' })[status] || 'scheduled';
}

function statusFromApiFootball(short) {
  return ({ TBD: 'scheduled', NS: 'scheduled', LIVE: 'live', '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', P: 'live', FT: 'finished', AET: 'finished', PEN: 'finished', PST: 'postponed', CANC: 'cancelled', ABD: 'suspended' })[short] || 'scheduled';
}

function normalizeFootballData(match) {
  const home = text(match?.homeTeam?.name);
  const away = text(match?.awayTeam?.name);
  const utcDate = match?.utcDate || '';
  return {
    id: `fd-${match.id}`, source: 'football-data.org', sourceId: String(match.id), title: `${home} x ${away}`,
    homeTeam: home, awayTeam: away, homeCrest: text(match?.homeTeam?.crest), awayCrest: text(match?.awayTeam?.crest),
    competition: text(match?.competition?.name), competitionCode: text(match?.competition?.code), competitionLogo: '', area: text(match?.area?.name),
    venue: '', round: text(match?.matchday), dateTime: utcDate, status: statusFromFootballData(match?.status), statusLabel: text(match?.status),
    score: { home: number(match?.score?.fullTime?.home ?? match?.score?.halfTime?.home), away: number(match?.score?.fullTime?.away ?? match?.score?.halfTime?.away) },
    stats: {}, events: [], coverage: { calendar: true, events: false, statistics: false, lineups: false, odds: false },
    sources: ['football-data.org'], fetchedAt: new Date().toISOString()
  };
}

function normalizeApiFootball(item) {
  const home = text(item?.teams?.home?.name);
  const away = text(item?.teams?.away?.name);
  const fixtureId = text(item?.fixture?.id);
  return {
    id: `af-${fixtureId}`, source: 'api-football', sourceId: fixtureId, title: `${home} x ${away}`,
    homeTeam: home, awayTeam: away, homeCrest: text(item?.teams?.home?.logo), awayCrest: text(item?.teams?.away?.logo),
    competition: text(item?.league?.name), competitionCode: text(item?.league?.id), competitionLogo: text(item?.league?.logo), area: text(item?.league?.country),
    venue: text(item?.fixture?.venue?.name), round: text(item?.league?.round), dateTime: text(item?.fixture?.date),
    status: statusFromApiFootball(item?.fixture?.status?.short), statusLabel: text(item?.fixture?.status?.long || item?.fixture?.status?.short),
    score: { home: number(item?.goals?.home), away: number(item?.goals?.away) }, stats: {}, events: [],
    coverage: { calendar: true, events: false, statistics: false, lineups: false, odds: false }, sources: ['api-football'], fetchedAt: new Date().toISOString()
  };
}

function mergeMatches(primary, secondary) {
  const result = [...primary];
  const keys = new Set(primary.map(item => `${item.homeTeam.toLowerCase()}|${item.awayTeam.toLowerCase()}|${item.dateTime.slice(0, 10)}`));
  for (const item of secondary) {
    const key = `${item.homeTeam.toLowerCase()}|${item.awayTeam.toLowerCase()}|${item.dateTime.slice(0, 10)}`;
    if (!keys.has(key)) { result.push(item); keys.add(key); }
  }
  return result.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return body;
}

async function consumeApiFootballBudget() {
  const limit = Number(Netlify.env.get('API_FOOTBALL_DAILY_BUDGET') || DEFAULT_DAILY_BUDGET);
  const url = Netlify.env.get('SUPABASE_URL'); const key = Netlify.env.get('SUPABASE_KEY');
  if (!url || !key) return false;
  const response = await fetch(`${url}/rest/v1/rpc/consume_api_football_request`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_day: isoLocalDate(new Date()), p_limit: limit }), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return false;
  return (await response.json().catch(() => false)) === true;
}

async function readSupabaseCache(start, end) {
  const url = Netlify.env.get('SUPABASE_URL'); const key = Netlify.env.get('SUPABASE_KEY');
  if (!url || !key) return null;
  const cacheKey = encodeURIComponent(dateKey(start, end));
  const response = await fetch(`${url}/rest/v1/matches_cache?select=payload,expires_at&cache_key=eq.${cacheKey}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return rows?.[0]?.payload || null;
}

async function writeSupabaseCache(start, end, payload) {
  const url = Netlify.env.get('SUPABASE_URL'); const key = Netlify.env.get('SUPABASE_KEY');
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/matches_cache?on_conflict=cache_key`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ cache_key: dateKey(start, end), event_date: start, payload, source: 'football-data.org+api-football', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120000).toISOString() }),
    signal: AbortSignal.timeout(8000)
  }).catch(() => null);
}

export default async function fixtures(req) {
  if (req.method !== 'GET') return json(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
  const params = new URL(req.url).searchParams;
  const today = isoLocalDate(new Date());
  const date = validDate(params.get('date')) || today;
  const start = validDate(params.get('from')) || date;
  const end = validDate(params.get('to')) || date;
  if (new Date(`${end}T12:00:00Z`) < new Date(`${start}T12:00:00Z`)) return json(400, { success: false, error: 'INVALID_DATE_RANGE' });
  const key = dateKey(start, end);
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return json(200, cached.body, { 'X-FutStats-Cache': 'memory' });
  const persistentCached = await readSupabaseCache(start, end);
  if (persistentCached?.success) { memoryCache.set(key, { expiresAt: Date.now() + 120000, body: persistentCached }); return json(200, persistentCached, { 'X-FutStats-Cache': 'supabase' }); }

  const primaryKey = Netlify.env.get('FOOTBALL_DATA_API_KEY'); const secondaryKey = Netlify.env.get('API_FOOTBALL_KEY');
  let primary = []; let primaryError = null;
  if (primaryKey) {
    try {
      for (const [chunkStart, chunkEnd] of dateChunks(start, end)) {
        const data = await fetchJson(`https://api.football-data.org/v4/matches?dateFrom=${chunkStart}&dateTo=${chunkEnd}`, { headers: { 'X-Auth-Token': primaryKey } });
        if (Array.isArray(data?.matches)) primary.push(...data.matches.map(normalizeFootballData));
      }
    } catch (error) { primaryError = error.message; }
  }
  let secondary = []; let secondaryUsed = false; let secondaryError = null;
  if (secondaryKey && primary.length === 0 && await consumeApiFootballBudget()) {
    secondaryUsed = true;
    try { const data = await fetchJson(`https://v3.football.api-sports.io/fixtures?from=${start}&to=${end}&timezone=${encodeURIComponent(TZ)}`, { headers: { 'x-apisports-key': secondaryKey } }); secondary = Array.isArray(data?.response) ? data.response.map(normalizeApiFootball) : []; }
    catch (error) { secondaryError = error.message; }
  }
  const matches = mergeMatches(primary, secondary);
  const body = { success: true, date: start === end ? start : null, from: start, to: end, timezone: TZ, matches, meta: { primary: 'football-data.org', primaryCount: primary.length, secondary: 'api-football', secondaryUsed, secondaryCount: secondary.length, primaryError, secondaryError, fetchedAt: new Date().toISOString() } };
  memoryCache.set(key, { expiresAt: Date.now() + 120000, body }); await writeSupabaseCache(start, end, body); return json(200, body);
}

export const config = { path: '/api/fixtures' };
