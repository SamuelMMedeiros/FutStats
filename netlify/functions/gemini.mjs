const MAX_PROMPT_LENGTH = 18000;
const GEMINI_MODEL = 'gemini-2.5-flash';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function safe(value, limit = 2400) {
  if (value === undefined || value === null || value === '') return 'não disponível';
  return String(value).slice(0, limit);
}

function buildMatchPrompt(match) {
  return `Você é uma especialista esportiva em futebol e análise estatística responsável. Analise somente a partida indicada e use exclusivamente os dados fornecidos. Nunca invente estatísticas, odds, mercados, casas, lesões, escalações ou confrontos. Quando um dado não existir, retorne null, lista vazia ou explique que não está disponível. Não prometa acerto.

Partida: ${safe(match.title)}
Data e horário: ${safe(match.dateTime)}
Competição: ${safe(match.competition)}
Status: ${safe(match.status)}
Dados estatísticos: ${safe(JSON.stringify(match.apiStats || {}))}
Eventos: ${safe(JSON.stringify(match.apiEvents || {}))}
Histórico e forma: ${safe(JSON.stringify(match.history || {}))}
Odds e mercados reais: ${safe(JSON.stringify(match.odds || []), 7000)}

Gere uma análise objetiva com probabilidades qualitativas apenas entre baixa, média e alta para +1,5 gols, +2,5 gols e ambas marcam. Inclua gols esperados, médias disponíveis, pontos importantes, limitações dos dados e mercados conservadores somente se houver suporte nos dados.`;
}

function buildTicketPrompt(match) {
  return `Você é uma analista de futebol responsável por organizar bilhetes com mercados reais. Não invente odds, casas ou mercados. Use somente as odds fornecidas. Para cada casa de aposta encontrada, monte um bilhete simples e, quando houver dados suficientes, uma opção combinada conservadora. Cada seleção precisa conter bookmaker, mercado, seleção, odd e justificativa curta. Não inclua seleção sem odd real. Retorne JSON válido exatamente com: summary (string), bookmakers (array de objetos com bookmaker, simple (array), combined (array)), warnings (array de strings). Cada item de aposta deve conter market, selection, odd, confidence e reason. Deixe arrays vazios quando não houver dados.

Partida: ${safe(match.title)}
Data: ${safe(match.dateTime)}
Competição: ${safe(match.competition)}
Estatísticas: ${safe(JSON.stringify(match.apiStats || {}))}
Histórico: ${safe(JSON.stringify(match.history || {}))}
Odds disponíveis: ${safe(JSON.stringify(match.odds || []), 10000)}`;
}

export default async function gemini(req) {
  if (req.method !== 'POST') return jsonResponse(405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' });
  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  if (!apiKey) return jsonResponse(503, { success: false, error: 'AI_NOT_CONFIGURED', message: 'A análise de IA não está configurada no servidor.' });
  let payload;
  try { payload = await req.json(); } catch { return jsonResponse(400, { success: false, error: 'INVALID_JSON', message: 'Payload inválido.' }); }

  let prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  let structured = false;
  if (payload?.mode === 'match-analysis' && payload?.match && typeof payload.match === 'object') { prompt = buildMatchPrompt(payload.match); structured = true; }
  if (payload?.mode === 'bet-ticket' && payload?.match && typeof payload.match === 'object') { prompt = buildTicketPrompt(payload.match); structured = true; }
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return jsonResponse(400, { success: false, error: 'INVALID_PROMPT', message: 'Solicitação inválida ou muito longa.' });

  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 3000, ...(structured ? { responseMimeType: 'application/json' } : {}) } })
    });
    if (response.status === 401 || response.status === 403) return jsonResponse(502, { success: false, error: 'AI_AUTH_FAILED', message: 'Não foi possível autenticar a IA.' });
    if (response.status === 429) return jsonResponse(429, { success: false, error: 'AI_RATE_LIMIT', message: 'Limite temporário de requisições atingido.' });
    if (!response.ok) return jsonResponse(502, { success: false, error: 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) return jsonResponse(502, { success: false, error: 'AI_EMPTY_RESPONSE', message: 'A IA retornou uma resposta vazia.' });
    return jsonResponse(200, { success: true, text, structured, model: GEMINI_MODEL });
  } catch (error) {
    return jsonResponse(502, { success: false, error: error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
  } finally { clearTimeout(timeout); }
}

export const config = { path: '/api/gemini' };
