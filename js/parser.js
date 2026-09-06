/* Robust TXT/JSON importers. */
(function (global) {
  'use strict';
  const core = global.FutStatsCore;
  const storage = global.FutStatsStorage;
  function toNumber(value, fallback = null) { return core.number(value, fallback); }
  function baseMatch(input, rawText = '') {
    const match = { ...input, rawText, status: input.status || 'pending', durationMinutes: input.durationMinutes || 115 };
    match.id = core.stableMatchId(match);
    match.parsedDate = core.parseMatchDate(match.dateTime)?.toISOString() || null;
    match.prediction = { ...(input.prediction || {}) };
    match.result = { ...(input.result || {}) };
    match.evaluation = { ...(input.evaluation || {}) };
    const validation = core.validateMatch(match);
    return { match: storage.normalizeMatch(match), validation };
  }
  function parseJson(raw) {
    const warnings = [], matches = [];
    let value;
    try { value = JSON.parse(raw); } catch (error) { return { matches: [], warnings: ['JSON inválido: não foi possível interpretar o arquivo.'] }; }
    const records = Array.isArray(value) ? value : (Array.isArray(value.matches) ? value.matches : [value]);
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) { warnings.push(`Registro ${index + 1}: estrutura inválida.`); return; }
      const { match, validation } = baseMatch(record, record.rawText || '');
      if (!validation.valid) { warnings.push(`Registro ${index + 1}: campos inválidos (${validation.errors.join(', ')}).`); return; }
      matches.push(match);
    });
    return { matches, warnings };
  }
  function capture(block, regex, fallback = '') { const found = block.match(regex); return found ? found[1].trim() : fallback; }
  function parseTxt(raw) {
    const warnings = [], matches = [];
    const header = /([^\n]+?\s+x\s+[^\n]+?)\s*-\s*\[\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}:\d{2})\s*\]/gi;
    const starts = [...raw.matchAll(header)];
    if (!starts.length) return { matches: [], warnings: ['Nenhum cabeçalho de partida encontrado.'] };
    starts.forEach((found, index) => {
      const start = found.index, end = starts[index + 1]?.index ?? raw.length;
      const block = raw.slice(start, end).trim();
      const title = core.sanitizeText(found[1]);
      const dateTime = `${found[2]} - ${found[3]}`;
      const marketLine = capture(block, /(?:Mercado|Linha|Previsão)\s*:\s*([^\n]+)/i, '');
      let market = '', line = null;
      const marketMatch = marketLine.match(/(over|under|mais|menos)\s+([^\d]*)(\d+(?:[,.]\d+)?)/i);
      if (marketMatch) {
        const direction = /under|menos/i.test(marketMatch[1]) ? 'under' : 'over';
        const subject = marketMatch[2].toLowerCase();
        const kind = /esc|corner/i.test(subject) ? 'corners' : /cart|card/i.test(subject) ? 'cards' : 'goals';
        market = `${direction}_${kind}`; line = toNumber(marketMatch[3], null);
      }
      const item = {
        title, dateTime,
        plus25: core.sanitizeText(capture(block, /\+2[,.]5\s*:\s*([^\n]+)/i, '')),
        plus15: core.sanitizeText(capture(block, /\+1[,.]5\s*:\s*([^\n]+)/i, '')),
        gols: toNumber(capture(block, /Quantidade\s+esperada\s+de\s+gols[^:]*:\s*([\d,.]+)/i, null), null),
        escanteios: toNumber(capture(block, /M[ée]dia\s+de\s+escanteios\s*:\s*([\d,.]+)/i, null), null),
        cartoes: toNumber(capture(block, /M[ée]dia\s+de\s+cart[õo]es\s*:\s*([\d,.]+)/i, null), null),
        info: core.sanitizeText(capture(block, /Info\s*:\s*([^\n]+)/i, '')),
        odd: toNumber(capture(block, /Sugest[ãa]o\s+de\s+odd[^:]*:\s*([\d,.]+)/i, null), null),
        sugestao: core.sanitizeText(capture(block, /Sugest[ãa]o\s+de\s+odd[^—-]*[—-]\s*([^\n]+)/i, '')),
        prediction: { market, line, confidence: capture(block, /Confian[çc]a\s*:\s*([^\n]+)/i, '') },
        stats100: [], rawText: block
      };
      const result = baseMatch(item, block);
      if (!result.validation.valid) warnings.push(`Partida ${index + 1}: campos inválidos (${result.validation.errors.join(', ')}); importada com os campos válidos.`);
      matches.push(result.match);
    });
    return { matches, warnings };
  }
  function parse(raw) {
    const content = String(raw || '').replace(/\r\n?/g, '\n');
    const trimmed = content.trim();
    if (!trimmed) return { matches: [], warnings: ['Conteúdo vazio.'] };
    return /^[\[{]/.test(trimmed) ? parseJson(trimmed) : parseTxt(content);
  }
  global.FutStatsParser = { parse, parseJson, parseTxt };
})(window);
