const TZ = 'America/Sao_Paulo';
const DEFAULT_DAILY_BUDGET = 80;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' } });
}
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
function apiFootballDetail(data) {
  const item = data?.response?.[0];
  if (!item) return {};
  const events = Array.isArray(data?.events) ? data.events.map(event => ({ time: event.time?.elapsed ? `${event.time.elapsed}'` : '', type: event.type, detail: event.detail, player: event.player?.name, team: event.team?.name })) : [];
  const stats = {};
  for (const group of Array.isArray(data?.statistics) ? data.statistics : []) {
    const team = group.team?.name || 'Equipe';
    stats[team] = Object.fromEntries((group.statistics || []).filter(row => row?.type).map(row => [row.type, row.value]));
  }
  return { venue: text(item.fixture?.venue?.name), referee: text(item.fixture?.referee), statusLabel: text(item.fixture?.status?.long), status: status(item.fixture?.status?.short), score: { home: number(item.goals?.home), away: number(item.goals?.away) }, events, apiStats: stats, detailsSource: 'api-football', detailsFetchedAt: new Date().toISOString() };
}
function footballDataDetail(data) {
  const events = [];
  return { venue: text(data?.venue), statusLabel: text(data?.status), status: text(data?.status), score: { home: number(data?.score?.fullTime?.home ?? data?.score?.halfTime?.home), away: number(data?.score?.fullTime?.away ?? data?.score?.halfTime?.away) }, head2head: data?.head2head || null, events, detailsSource: 'football-data.org', detailsFetchedAt: new Date().toISOString() };
}
export default async function fixtureDetails(req) {
  if (req.method !== 'GET') return json(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
  const url = new URL(req.url); const source = text(url.searchParams.get('source')); const id = text(url.searchParams.get('id'));
  if (!source || !id) return json(400, { success: false, error: 'INVALID_FIXTURE' });
  try {
    let details;
    if (source === 'football-data.org') {
      const key = Netlify.env.get('FOOTBALL_DATA_API_KEY'); if (!key) return json(503, { success: false, error: 'FOOTBALL_DATA_NOT_CONFIGURED' });
      details = footballDataDetail(await apiJson(`https://api.football-data.org/v4/matches/${encodeURIComponent(id)}`, { headers: { 'X-Auth-Token': key } }));
    } else if (source === 'api-football') {
      const key = Netlify.env.get('API_FOOTBALL_KEY'); if (!key) return json(503, { success: false, error: 'API_FOOTBALL_NOT_CONFIGURED' });
      if (!await consumeBudget()) return json(429, { success: false, error: 'API_FOOTBALL_DAILY_LIMIT' });
      const data = await apiJson(`https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(id)}`, { headers: { 'x-apisports-key': key } });
      details = apiFootballDetail(data);
    } else return json(400, { success: false, error: 'UNKNOWN_SOURCE' });
    return json(200, { success: true, details });
  } catch (error) { return json(502, { success: false, error: error.message || 'DETAILS_UNAVAILABLE' }); }
}
export const config = { path: '/api/fixture-details' };
