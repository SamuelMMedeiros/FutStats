/* Derived statistics. */
(function (global) {
  'use strict';
  const core = global.FutStatsCore;
  function resolved(history) { return (history || []).filter(m => ['green', 'red', 'push'].includes(m.evaluation?.status || m.status)); }
  function evaluate(m) { return m.evaluation?.status || m.status || 'pending'; }
  function calculate(history, options = {}) {
    const list = (history || []).filter(m => {
      const status = evaluate(m); if (status === 'pending' || status === 'live' || status === 'finished') return true;
      if (!options.from && !options.to) return true;
      const date = core.parseMatchDate(m.dateTime || m.parsedDate); if (!date) return false;
      return (!options.from || date >= options.from) && (!options.to || date <= options.to);
    });
    const evaluated = list.filter(m => ['green', 'red', 'push'].includes(evaluate(m)));
    const greens = evaluated.filter(m => evaluate(m) === 'green').length;
    const reds = evaluated.filter(m => evaluate(m) === 'red').length;
    const pushes = evaluated.filter(m => evaluate(m) === 'push').length;
    let stake = 0, profit = 0, hasFinancialData = false;
    evaluated.forEach(m => { const value = core.number(m.stake ?? m.valorApostado, null), odd = core.number(m.odd, null); if (value !== null && value > 0) { hasFinancialData = true; stake += value; if (evaluate(m) === 'green' && odd !== null && odd > 0) profit += value * (odd - 1); else if (evaluate(m) === 'red') profit -= value; } });
    return { total: list.length, evaluated: evaluated.length, greens, reds, pushes, pending: list.length - evaluated.length, winRate: evaluated.length ? greens / evaluated.length * 100 : null, profit: hasFinancialData ? profit : null, roi: hasFinancialData && stake ? profit / stake * 100 : null, stake: hasFinancialData ? stake : null };
  }
  function groupBy(history, key) {
    const groups = {};
    (history || []).forEach(m => { const value = key === 'market' ? (m.prediction?.market || m.market || 'sem mercado') : (m.competition || 'sem competição'); (groups[value] ||= []).push(m); });
    return Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, calculate(list)]));
  }
  global.FutStatsStatistics = { calculate, groupBy };
})(window);
