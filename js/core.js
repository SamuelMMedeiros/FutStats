/* FutStats core domain logic. No DOM dependencies. */
(function (global) {
  'use strict';

  const VALID_STATUSES = new Set(['pending', 'live', 'finished', 'green', 'red', 'push', 'void', 'cancelled']);
  const VALID_MARKETS = new Set([
    'over_goals', 'under_goals', 'over_corners', 'under_corners',
    'over_cards', 'under_cards', 'both_teams_score', 'home_win',
    'away_win', 'draw', 'double_chance'
  ]);

  function text(value, fallback = '') {
    return value === null || value === undefined ? fallback : String(value).trim();
  }

  function number(value, fallback = null) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseMatchDate(value, timeZone = 'America/Sao_Paulo') {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    const raw = text(value);
    if (!raw) return null;
    const br = raw.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})(?:\s*-\s*|\s+)(\d{1,2}):(\d{2})$/);
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    let year, month, day, hour, minute;
    if (br) [, day, month, year, hour, minute] = br.map(Number);
    else if (iso) [, year, month, day, hour, minute] = iso.map(Number);
    else return null;
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
    if (!Number.isFinite(utcGuess)) return null;
    // Brazil's common offset is used deterministically for imported local match times.
    const offsetHours = timeZone === 'America/Sao_Paulo' ? 3 : 0;
    return new Date(utcGuess + offsetHours * 60 * 60 * 1000);
  }

  function formatMatchDate(value) {
    const date = value instanceof Date ? value : parseMatchDate(value);
    if (!date || Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.day}/${parts.month}/${parts.year} - ${parts.hour}:${parts.minute}`;
  }

  function getMatchStatus(match, now = new Date()) {
    if (!match || match.status === 'cancelled' || match.status === 'void') return match?.status || 'pending';
    if (['green', 'red', 'push'].includes(match.status) && hasResult(match)) return match.status;
    const start = parseMatchDate(match.dateTime || match.parsedDate);
    if (!start) return 'pending';
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(current.getTime())) return 'pending';
    const duration = Math.max(60, number(match.durationMinutes, 115));
    const startMs = start.getTime();
    const nowMs = current.getTime();
    if (nowMs < startMs) return 'pending';
    if (nowMs < startMs + duration * 60000) return 'live';
    return 'finished';
  }

  function isMatchFinished(match, now = new Date()) {
    return ['finished', 'green', 'red', 'push', 'void', 'cancelled'].includes(getMatchStatus(match, now));
  }

  function normalizeTeam(value) { return text(value).toLowerCase().replace(/\s+/g, ' '); }
  function stableMatchId(match) {
    if (text(match?.id)) return text(match.id);
    const key = [match?.homeTeam, match?.awayTeam, match?.title, match?.dateTime, match?.competition]
      .map(normalizeTeam).join('|');
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `match_${(hash >>> 0).toString(16)}`;
  }

  function hasResult(match) {
    const r = match?.result || {};
    return [r.homeGoals, r.awayGoals, match?.realGolsCasa, match?.realGolsFora]
      .some(v => number(v, null) !== null);
  }

  function getResult(match) {
    const r = match?.result || {};
    return {
      homeGoals: number(r.homeGoals ?? match?.realGolsCasa, null),
      awayGoals: number(r.awayGoals ?? match?.realGolsFora, null),
      corners: number(r.corners ?? ((number(match?.realEscCasa, 0) || 0) + (number(match?.realEscFora, 0) || 0)), null),
      cards: number(r.cards ?? ((number(match?.realCartoesCasa, 0) || 0) + (number(match?.realCartoesFora, 0) || 0)), null)
    };
  }

  function normalizePrediction(prediction = {}, match = {}) {
    const source = prediction.market ? prediction : (match.prediction || {});
    const market = text(source.market || match.market || '');
    const line = number(source.line ?? match.line, null);
    return { market, line, confidence: text(source.confidence || match.confidence || '') };
  }

  function evaluatePrediction(prediction, result) {
    const p = normalizePrediction(prediction);
    const r = result || {};
    if (!p.market || p.line === null || !r || !Number.isFinite(number(r.homeGoals, null)) || !Number.isFinite(number(r.awayGoals, null))) return 'pending';
    const goals = number(r.homeGoals, 0) + number(r.awayGoals, 0);
    const corners = number(r.corners, null);
    const cards = number(r.cards, null);
    let outcome = null;
    switch (p.market) {
      case 'over_goals': outcome = goals > p.line; break;
      case 'under_goals': outcome = goals < p.line; break;
      case 'over_corners': outcome = corners === null ? null : corners > p.line; break;
      case 'under_corners': outcome = corners === null ? null : corners < p.line; break;
      case 'over_cards': outcome = cards === null ? null : cards > p.line; break;
      case 'under_cards': outcome = cards === null ? null : cards < p.line; break;
      case 'both_teams_score': outcome = number(r.homeGoals, 0) > 0 && number(r.awayGoals, 0) > 0; break;
      case 'home_win': outcome = r.homeGoals > r.awayGoals; break;
      case 'away_win': outcome = r.awayGoals > r.homeGoals; break;
      case 'draw': outcome = r.homeGoals === r.awayGoals; break;
      case 'double_chance': {
        const choice = text(prediction.choice || p.choice || '1X');
        outcome = choice === '1X' ? r.homeGoals >= r.awayGoals : choice === 'X2' ? r.awayGoals >= r.homeGoals : r.homeGoals !== r.awayGoals;
        break;
      }
      default: return 'pending';
    }
    if (outcome === null) return 'pending';
    if (['over_goals', 'under_goals', 'over_corners', 'under_corners', 'over_cards', 'under_cards'].includes(p.market) && Number.isInteger(p.line) && ((p.market.startsWith('over') && goals === p.line) || (p.market.startsWith('under') && goals === p.line))) return 'push';
    return outcome ? 'green' : 'red';
  }

  function validateMatch(input = {}) {
    const errors = [];
    if (!text(input.title) && !(text(input.homeTeam) && text(input.awayTeam))) errors.push('equipes');
    if (input.dateTime && !parseMatchDate(input.dateTime)) errors.push('data/horário');
    for (const field of ['gols', 'escanteios', 'cartoes', 'odd', 'line']) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '' && (number(input[field], null) === null || number(input[field]) < 0)) errors.push(field);
    }
    const prediction = normalizePrediction(input);
    if (prediction.market && !VALID_MARKETS.has(prediction.market)) errors.push('mercado');
    if (prediction.line !== null && prediction.line < 0) errors.push('linha');
    return { valid: errors.length === 0, errors };
  }

  function sanitizeText(value) {
    return text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  global.FutStatsCore = { VALID_STATUSES, VALID_MARKETS, parseMatchDate, formatMatchDate, getMatchStatus, isMatchFinished, stableMatchId, getResult, normalizePrediction, evaluatePrediction, validateMatch, sanitizeText, number, text, hasResult };
})(window);
