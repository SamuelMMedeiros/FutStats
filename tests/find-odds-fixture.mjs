const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) throw new Error('API_FOOTBALL_KEY ausente');
const start = new Date('2026-09-07T12:00:00Z');
const end = new Date('2026-09-14T12:00:00Z');
const iso = date => date.toISOString().slice(0, 10);
for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const date = iso(cursor);
  const fixturesResponse = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=America%2FSao_Paulo`, { headers: { 'x-apisports-key': apiKey } });
  const fixturesPayload = await fixturesResponse.json();
  for (const fixture of fixturesPayload.response || []) {
    const id = fixture.fixture?.id;
    if (!id) continue;
    const oddsResponse = await fetch(`https://v3.football.api-sports.io/odds?fixture=${id}`, { headers: { 'x-apisports-key': apiKey } });
    const oddsPayload = await oddsResponse.json();
    const bookmakers = oddsPayload.response?.[0]?.bookmakers || [];
    if (bookmakers.length) {
      console.log(JSON.stringify({ date, fixtureId: id, home: fixture.teams?.home?.name, away: fixture.teams?.away?.name, league: fixture.league?.name, kickoff: fixture.fixture?.date, bookmakers: bookmakers.map(book => book.name), bookmakerCount: bookmakers.length }));
      process.exit(0);
    }
  }
}
console.log(JSON.stringify({ found: false, message: 'Nenhuma partida futura com odds foi encontrada no intervalo consultado.' }));
