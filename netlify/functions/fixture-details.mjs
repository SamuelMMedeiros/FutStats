const TZ = 'America/Sao_Paulo';
const DEFAULT_DAILY_BUDGET = 80;
const detailCache = new Map();

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' } }); }
function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function status(short) { return ({ TBD: 'scheduled', NS: 'scheduled', LIVE: 'live', '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', P: 'live', FT: 'finished', AET: 'finished', PEN: 'finished', PST: 'postponed', CANC: 'cancelled', ABD: 'suspended' })[short] || short || 'scheduled'; }
function isoDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
async function apiJson(url, options = {}) { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`UPSTREAM_${response.status}`); return body; }
async function consumeBudget() {
  const base = Netlify.env.get('SUPABASE_URL'); const key = Netlify.env.get('SUPABASE_KEY');
  if (!base || !key) return false;
  const response = await fetch(`${base}/rest/v1/rpc/consume_api_football_request`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_day: isoDate(), p_limit: Number(Netlify.env.get('API_FOOTBALL_DAILY_BUDGET') || DEFAULT_DAILY_BUDGET) }), signal: AbortSignal.timeout(8000) });
  return response.ok && (await response.json().catch(() => false)) === true;
}

function normalizeOdds(data) {
  const item = data?.response?.[0];
  if (!item) return [];
  return (Array.isArray(item.bookmakers) ? item.bookmakers : []).map(bookmaker => ({
    bookmakerId: bookmaker.id ?? null,
    bookmaker: text(bookmaker.name),
    markets: (Array.isArray(bookmaker.bets) ? bookmaker.bets : []).map(market => ({
      marketId: market.id ?? null,
      market: text(market.name),
      values: (Array.isArray(market.values) ? market.values : []).map(value => ({ label: text(value.value), odd: number(value.odd), handicap: text(value.handicap) })).filter(value => value.label && value.odd !== null)
    })).filter(market => market.values.length)
  })).filter(bookmaker => bookmaker.bookmaker && bookmaker.markets.length);
}

function apiFootballDetail(data, oddsData, oddsStatus = 'available') {
  const item = data?.response?.[0];
  if (!item) return {};
  const events = Array.isArray(data?.events) ? data.events.map(event => ({ time: event.time?.elapsed ? `${event.time.elapsed}'` : '', type: event.type, detail: event.detail, player: event.player?.name, team: event.team?.name })) : [];
  const stats = {};
  for (const group of Array.isArray(data?.statistics) ? data.statistics : []) {
    const team = group.team?.name || 'Equipe';
    stats[team] = Object.fromEntries((group.statistics || []).filter(row => row?.type).map(row => [row.type, row.value]));
  }
  const odds = normalizeOdds(oddsData);
  return { venue: text(item.fixture?.venue?.name), referee: text(item.fixture?.referee), statusLabel: text(item.fixture?.status?.long), status: status(item.fixture?.status?.short), score: { home: number(item.goals?.home), away: number(item.goals?.away) }, events, apiStats: stats, odds, oddsStatus, coverage: { events: events.length > 0, statistics: Object.keys(stats).length > 0, odds: odds.length > 0 }, detailsSource: 'api-football', detailsFetchedAt: new Date().toISOString() };
}
function footballDataDetail(data) {
  return { venue: text(data?.venue), statusLabel: text(data?.status), status: text(data?.status), score: { home: number(data?.score?.fullTime?.home ?? data?.score?.halfTime?.home), away: number(data?.score?.fullTime?.away ?? data?.score?.halfTime?.away) }, head2head: data?.head2head || null, events: [], odds: [], oddsStatus: 'not-supported-for-source', detailsSource: 'football-data.org', detailsFetchedAt: new Date().toISOString() };
}

function localDateFromValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? isoDate() : new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

function findFixtureByTeams(data, home, away) {
  const normalize = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const homeKey = normalize(home); const awayKey = normalize(away);
  return (Array.isArray(data?.response) ? data.response : []).find(item => {
    const itemHome = normalize(item?.teams?.home?.name); const itemAway = normalize(item?.teams?.away?.name);
    return (itemHome.includes(homeKey) || homeKey.includes(itemHome)) && (itemAway.includes(awayKey) || awayKey.includes(itemAway));
  }) || null;
}

export default async function fixtureDetails(req) {
  if (req.method !== 'GET') return json(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
  const url = new URL(req.url); const source = text(url.searchParams.get('source')); const id = text(url.searchParams.get('id'));
  if (!source || !id) return json(400, { success: false, error: 'INVALID_FIXTURE' });
  const cacheKey = `${source}:${id}`; const cached = detailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return json(200, { success: true, details: cached.details });
  try {
    let details;
    if (source === 'football-data.org') {
      const key = Netlify.env.get('FOOTBALL_DATA_API_KEY'); if (!key) return json(503, { success: false, error: 'FOOTBALL_DATA_NOT_CONFIGURED' });
      const footballData = await apiJson(`https://api.football-data.org/v4/matches/${encodeURIComponent(id)}`, { headers: { 'X-Auth-Token': key } });
      details = footballDataDetail(footballData);
      details.oddsStatus = 'deferred';
      details.oddsMessage = 'Mercados e odds são carregados uma vez pela Odds API quando os detalhes da partida são abertos.';
    } else if (source === 'api-football') {
      const key = Netlify.env.get('API_FOOTBALL_KEY'); if (!key) return json(503, { success: false, error: 'API_FOOTBALL_NOT_CONFIGURED' });
      if (!await consumeBudget()) return json(429, { success: false, error: 'API_FOOTBALL_DAILY_LIMIT' });
      const fixtureData = await apiJson(`https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(id)}`, { headers: { 'x-apisports-key': key } });
      details = apiFootballDetail(fixtureData, { response: [] }, 'deferred');
      details.oddsMessage = 'Mercados e odds são carregados uma vez pela Odds API quando os detalhes da partida são abertos.';
    } else return json(400, { success: false, error: 'UNKNOWN_SOURCE' });
    detailCache.set(cacheKey, { expiresAt: Date.now() + 120000, details });
    return json(200, { success: true, details });
  } catch (error) { return json(502, { success: false, error: error.message || 'DETAILS_UNAVAILABLE' }); }
}
export const config = { path: '/api/fixture-details' };
