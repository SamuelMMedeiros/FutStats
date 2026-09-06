/* Persistent storage abstraction for FutStats. */
(function (global) {
  'use strict';
  const KEY = 'statscard_state_v2';
  const legacyKeys = ['statsCardMatches', 'matchesData', 'permanentHistory'];
  const core = global.FutStatsCore;
  const safeClone = value => JSON.parse(JSON.stringify(value ?? []));
  function readState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const state = JSON.parse(raw);
        return { matches: Array.isArray(state.matches) ? state.matches : [], history: Array.isArray(state.history) ? state.history : [] };
      }
      const matches = JSON.parse(localStorage.getItem(legacyKeys[0]) || localStorage.getItem(legacyKeys[1]) || '[]');
      const history = JSON.parse(localStorage.getItem(legacyKeys[2]) || '[]');
      return { matches: Array.isArray(matches) ? matches : [], history: Array.isArray(history) ? history : [] };
    } catch (error) {
      console.warn('[FutStats] armazenamento inválido; iniciando vazio');
      return { matches: [], history: [] };
    }
  }
  function normalizeMatch(match) {
    const copy = { ...(match || {}) };
    copy.id = core.stableMatchId(copy);
    copy.title = core.sanitizeText(copy.title || 'Partida sem título');
    copy.dateTime = core.sanitizeText(copy.dateTime || '');
    copy.parsedDate = core.parseMatchDate(copy.dateTime)?.toISOString() || null;
    copy.prediction = copy.prediction || {};
    if (!copy.prediction.market && copy.market) copy.prediction.market = copy.market;
    if (copy.prediction.line === undefined && copy.line !== undefined) copy.prediction.line = copy.line;
    copy.result = copy.result || {};
    copy.evaluation = copy.evaluation || {};
    return copy;
  }
  function mergeById(items) {
    const map = new Map();
    items.filter(Boolean).map(normalizeMatch).forEach(item => map.set(item.id, { ...(map.get(item.id) || {}), ...item }));
    return [...map.values()];
  }
  function save(matches, history) {
    const state = { version: 2, updatedAt: new Date().toISOString(), matches: mergeById(matches), history: mergeById(history) };
    localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }
  function saveMatches(matches) { const state = readState(); return save(matches, state.history); }
  function saveHistory(history) { const state = readState(); return save(state.matches, history); }
  function exportBackup(matches, history, stats) { return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), matches: mergeById(matches), history: mergeById(history), stats: stats || null }, null, 2); }
  function importBackup(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') throw new Error('Backup inválido');
    return { matches: mergeById(Array.isArray(parsed.matches) ? parsed.matches : []), history: mergeById(Array.isArray(parsed.history) ? parsed.history : []) };
  }
  global.FutStatsStorage = { readState, save, saveMatches, saveHistory, normalizeMatch, mergeById, exportBackup, importBackup, KEY };
})(window);
