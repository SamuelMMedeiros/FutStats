const DEFAULT_SPORT_KEYS = ['soccer_brazil_campeonato', 'soccer_epl', 'soccer_spain_la_liga', 'soccer_germany_bundesliga', 'soccer_italy_serie_a'];
const TARGET_BOOKMAKERS = [
  { tokens: ['1xbet', '1x bet'], title: '1xBet' },
  { tokens: ['bet365'], title: 'Bet365 BR' },
  { tokens: ['betano'], title: 'Betano BR' },
  { tokens: ['betfair'], title: 'Betfair BR' },
  { tokens: ['estrela bet', 'estrelabet'], title: 'Estrela Bet BR' },
  { tokens: ['kto'], title: 'KTO BR' },
  { tokens: ['sportingbet', 'sporting bet'], title: 'SportingBet BR' },
  { tokens: ['superbet'], title: 'Superbet BR' }
];
const memoryCache = new Map();
const bookmakerCatalogCache = { expiresAt: 0, slugs: [] };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...headers } });
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null; }
function text(value) { return value == null ? '' : String(value).trim(); }
function listEnv(name, fallback) { const value = text(Netlify.env.get(name)); return value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback; }
function oddsTimestamp(date) { return `${date.toISOString().slice(0, 19)}Z`; }
function dayBounds(date) {
  // America/Sao_Paulo is UTC-03:00. Both providers receive second-precision UTC timestamps.
  const start = new Date(`${date}T03:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
  return { from: oddsTimestamp(start), to: oddsTimestamp(end) };
}
function cacheKey(source, date, config) { return `odds-v4:${source}:${date}:${config}`; }
function normalizeBookmaker(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function bookmakerTitle(slug) {
  const normalized = normalizeBookmaker(slug);
  return TARGET_BOOKMAKERS.find(item => item.tokens.some(token => normalized.includes(normalizeBookmaker(token))))?.title || slug;
}
async function resolveBookmakers(apiKey) {
  const requested = listEnv('ODDSPAPI_BOOKMAKERS', []);
  if (!requested.length && bookmakerCatalogCache.expiresAt > Date.now()) return bookmakerCatalogCache.slugs;
  const catalogResult = await fetchJson(`https://api.oddspapi.io/v4/bookmakers?${new URLSearchParams({ apiKey }).toString()}`);
  const catalog = Array.isArray(catalogResult.body) ? catalogResult.body : [];
  const wanted = requested.length ? requested.map(item => ({ tokens: [item], title: item })) : TARGET_BOOKMAKERS;
  const slugs = wanted.map(target => {
    const found = catalog.find(item => target.tokens.some(token => normalizeBookmaker(item?.slug || '').includes(normalizeBookmaker(token)) || normalizeBookmaker(item?.bookmakerName || '').includes(normalizeBookmaker(token))));
    return found?.slug ? text(found.slug) : '';
  }).filter(Boolean).filter((slug, index, list) => list.indexOf(slug) === index);
  if (!requested.length) { bookmakerCatalogCache.slugs = slugs; bookmakerCatalogCache.expiresAt = Date.now() + 24 * 60 * 60 * 1000; }
  return slugs;
}
function normalizeEvent(event, sportKey) {
  return {
    id: text(event?.id), sportKey: text(event?.sport_key || sportKey), commenceTime: text(event?.commence_time), homeTeam: text(event?.home_team), awayTeam: text(event?.away_team),
    bookmakers: (event?.bookmakers || []).map(book => ({ key: text(book.key), title: text(book.title || book.key), lastUpdate: text(book.last_update), markets: (book.markets || []).map(market => ({ key: text(market.key), outcomes: (market.outcomes || []).map(outcome => ({ name: text(outcome.name), price: Number(outcome.price), point: outcome.point == null ? null : Number(outcome.point) })).filter(outcome => Number.isFinite(outcome.price)) })).filter(market => market.outcomes.length) })).filter(book => book.markets.length)
  };
}
function normalizeOddsPapiMarket(marketId, market) {
  const outcomes = [];
  for (const [outcomeId, outcome] of Object.entries(market?.outcomes || {})) {
    const player = Object.values(outcome?.players || {})[0];
    const price = Number(player?.price);
    if (!Number.isFinite(price)) continue;
    outcomes.push({ name: text(player?.bookmakerOutcomeId || outcomeId), price, point: null });
  }
  return { key: text(marketId), outcomes };
}
function normalizeOddsPapiEvent(event, bookmakers) {
  const bookmakerOdds = event?.bookmakerOdds || {};
  const normalizedBooks = Object.entries(bookmakerOdds).map(([slug, data]) => {
    const markets = Object.entries(data?.markets || {}).map(([marketId, market]) => normalizeOddsPapiMarket(marketId, market)).filter(market => market.outcomes.length);
    return { key: slug, title: bookmakerTitle(slug), lastUpdate: text(event?.updatedAt), markets };
  }).filter(book => book.markets.length && (!bookmakers.length || bookmakers.includes(book.key)));
  return {
    id: text(event?.fixtureId), sportKey: 'soccer_oddspapi', commenceTime: text(event?.startTime), homeTeam: text(event?.participant1Name), awayTeam: text(event?.participant2Name), bookmakers: normalizedBooks
  };
}
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const upstreamValue = body?.message || body?.error || body?.code || body;
    const upstream = typeof upstreamValue === 'string' ? upstreamValue : JSON.stringify(upstreamValue).slice(0, 500);
    throw new Error(`UPSTREAM_${response.status}${upstream ? `_${upstream}` : ''}`);
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
async function writeCache(key, date, payload, source) {
  const url = Netlify.env.get('SUPABASE_URL'); const secret = Netlify.env.get('SUPABASE_KEY');
  if (!url || !secret) return;
  await fetch(`${url}/rest/v1/matches_cache?on_conflict=cache_key`, { method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ cache_key: key, event_date: date, payload, source, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }), signal: AbortSignal.timeout(8000) }).catch(() => null);
}
async function cachedRequest(key, date, source, loader) {
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { body: cached.body, cache: 'memory' };
  const persistent = await readCache(key);
  if (persistent?.success) { memoryCache.set(key, { expiresAt: Date.now() + 15 * 60 * 1000, body: persistent }); return { body: persistent, cache: 'supabase' }; }
  const body = await loader();
  memoryCache.set(key, { expiresAt: Date.now() + 15 * 60 * 1000, body });
  await writeCache(key, date, body, source);
  return { body, cache: 'miss' };
}
async function fetchOddsPapi(date, apiKey) {
  const bookmakers = await resolveBookmakers(apiKey);
  const bounds = dayBounds(date);
  const bookmakerParam = bookmakers.join(',');
  const config = `bookmakers=${bookmakerParam}`;
  const key = cacheKey('oddspapi', date, config);
  return cachedRequest(key, date, 'oddspapi', async () => {
    const fixturesUrl = new URL('https://api.oddspapi.io/v4/fixtures');
    fixturesUrl.search = new URLSearchParams({ apiKey, sportId: '10', from: bounds.from, to: bounds.to, hasOdds: 'true', bookmakers: bookmakerParam, language: 'en' }).toString();
    const fixturesResult = await fetchJson(fixturesUrl);
    const fixtures = Array.isArray(fixturesResult.body) ? fixturesResult.body : [];
    const tournamentCounts = new Map();
    fixtures.forEach(item => { const id = text(item?.tournamentId); if (id) tournamentCounts.set(id, (tournamentCounts.get(id) || 0) + 1); });
    const maxTournaments = Math.max(1, Math.min(5, Number(Netlify.env.get('ODDSPAPI_MAX_TOURNAMENTS') || 5)));
    const allTournamentIds = [...tournamentCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const tournamentIds = allTournamentIds.slice(0, maxTournaments);
    if (!bookmakers.length) return { success: true, source: 'oddspapi', date, timezone: 'America/Sao_Paulo', events: [], fetchedAt: new Date().toISOString(), meta: { bookmakerCount: 0, fixtureCount: fixtures.length, apiCalls: 2 }, warnings: ['ODDSPAPI_TARGET_BOOKMAKERS_NOT_FOUND'] };
    if (!tournamentIds.length) return { success: true, source: 'oddspapi', date, timezone: 'America/Sao_Paulo', events: [], fetchedAt: new Date().toISOString(), meta: { bookmakerCount: bookmakers.length, fixtureCount: 0, apiCalls: 2 }, warnings: ['ODDSPAPI_NO_FIXTURES_FOR_DATE'] };
    const fixtureById = new Map(fixtures.map(item => [text(item.fixtureId), item]));
    const mergedByFixture = new Map();
    const warnings = [];
    for (let index = 0; index < bookmakers.length; index += 1) {
      const bookmaker = bookmakers[index];
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const oddsUrl = new URL('https://api.oddspapi.io/v4/odds-by-tournaments');
      oddsUrl.search = new URLSearchParams({ apiKey, tournamentIds: tournamentIds.join(','), bookmaker, language: 'en', verbosity: '3', oddsFormat: 'decimal' }).toString();
      try {
        const oddsResult = await fetchJson(oddsUrl);
        const rows = Array.isArray(oddsResult.body) ? oddsResult.body : (oddsResult.body && typeof oddsResult.body === 'object' ? [oddsResult.body] : []);
        rows.forEach(row => {
          const id = text(row.fixtureId);
          if (!id) return;
          const previous = mergedByFixture.get(id) || { ...row, bookmakerOdds: {} };
          mergedByFixture.set(id, { ...previous, ...row, participant1Name: row.participant1Name || previous.participant1Name || fixtureById.get(id)?.participant1Name, participant2Name: row.participant2Name || previous.participant2Name || fixtureById.get(id)?.participant2Name, startTime: row.startTime || previous.startTime || fixtureById.get(id)?.startTime, bookmakerOdds: { ...(previous.bookmakerOdds || {}), ...(row.bookmakerOdds || {}) } });
        });
      } catch (error) { warnings.push({ bookmaker, error: error.message }); }
    }
    const events = [...mergedByFixture.values()].map(row => ({ ...row, participant1Name: row.participant1Name || fixtureById.get(text(row.fixtureId))?.participant1Name, participant2Name: row.participant2Name || fixtureById.get(text(row.fixtureId))?.participant2Name, startTime: row.startTime || fixtureById.get(text(row.fixtureId))?.startTime })).filter(row => { const start = new Date(row.startTime); return !Number.isNaN(start.getTime()) && start >= new Date(bounds.from) && start <= new Date(bounds.to); }).map(row => normalizeOddsPapiEvent(row, bookmakers)).filter(event => event.id && event.homeTeam && event.awayTeam && event.bookmakers.length);
    if (allTournamentIds.length > tournamentIds.length) warnings.push(`ODDSPAPI_TOURNAMENT_COVERAGE_LIMIT:${allTournamentIds.length - tournamentIds.length}`);
    return { success: true, source: 'oddspapi', date, timezone: 'America/Sao_Paulo', events, fetchedAt: new Date().toISOString(), meta: { bookmakerCount: bookmakers.length, fixtureCount: fixtures.length, tournamentCount: tournamentIds.length, omittedTournamentCount: Math.max(0, allTournamentIds.length - tournamentIds.length), eventCount: events.length, apiCalls: 2 + bookmakers.length }, warnings };
  });
}
async function fetchTheOddsApi(date, apiKey) {
  const sports = listEnv('ODDS_API_SPORT_KEYS', DEFAULT_SPORT_KEYS);
  const regions = listEnv('ODDS_API_REGIONS', ['eu']);
  const markets = listEnv('ODDS_API_MARKETS', ['h2h', 'totals']);
  const key = cacheKey('the-odds-api', date, `${sports.join(',')}:${regions.join(',')}:${markets.join(',')}`);
  return cachedRequest(key, date, 'the-odds-api', async () => {
    const bounds = dayBounds(date); const events = []; const errors = []; const quota = {};
    for (const sport of sports) {
      const query = new URLSearchParams({ apiKey, regions: regions.join(','), markets: markets.join(','), oddsFormat: 'decimal', dateFormat: 'iso', commenceTimeFrom: bounds.from, commenceTimeTo: bounds.to });
      try { const result = await fetchJson(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds?${query.toString()}`); events.push(...(Array.isArray(result.body) ? result.body.map(item => normalizeEvent(item, sport)) : [])); quota[sport] = result.headers; } catch (error) { errors.push({ sport, error: error.message }); }
    }
    return { success: true, source: 'the-odds-api', date, timezone: 'America/Sao_Paulo', events, fetchedAt: new Date().toISOString(), quota, errors, meta: { sports, regions, markets, eventCount: events.length } };
  });
}

export default async function odds(req) {
  if (req.method !== 'GET') return json(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
  const params = new URL(req.url).searchParams;
  const date = validDate(params.get('date'));
  if (!date) return json(400, { success: false, error: 'VALID_DATE_REQUIRED' });
  const oddspapiKey = text(Netlify.env.get('ODDSPAPI_API_KEY'));
  const theOddsKey = text(Netlify.env.get('ODDS_API_KEY'));
  try {
    if (oddspapiKey) {
      const result = await fetchOddsPapi(date, oddspapiKey);
      return json(200, result.body, { 'X-FutStats-Cache': result.cache, 'X-FutStats-Odds-Source': 'oddspapi' });
    }
    if (theOddsKey) {
      const result = await fetchTheOddsApi(date, theOddsKey);
      return json(200, result.body, { 'X-FutStats-Cache': result.cache, 'X-FutStats-Odds-Source': 'the-odds-api-fallback' });
    }
    return json(503, { success: false, error: 'ODDS_API_NOT_CONFIGURED', events: [] });
  } catch (error) {
    return json(502, { success: false, error: 'ODDS_PROVIDER_ERROR', message: text(error?.message || error), events: [] });
  }
}

export const config = { path: '/api/odds' };
