const MAX_PROMPT_LENGTH = 18000;
const GEMINI_MODEL = 'gemini-3.6-flash';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function safe(value, limit = 2400) {
  if (value === undefined || value === null || value === '') return 'não disponível';
  return String(value).slice(0, limit);
}

function buildMatchPrompt(match) {
  return `Você é uma especialista esportiva em futebol e análise estatística responsável. Analise somente a partida indicada e use exclusivamente os dados fornecidos. Nunca invente estatísticas, odds, mercados, casas, lesões, escalações ou confrontos. Quando um dado não existir, retorne null, lista vazia ou explique que não está disponível. Não prometa acerto. Organize a resposta para o modelo de palpites do Score.AI, separando probabilidade qualitativa, justificativa, confiança e limitações.

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
  return `Você é a analista principal do módulo Score.AI. Gere um modelo de palpites responsável, verificável e baseado somente nos dados recebidos. Não invente odds, casas, mercados, estatísticas, lesões ou histórico. Se um dado estiver ausente, use null, lista vazia ou explique a limitação. Nunca prometa acerto e inclua uma advertência de jogo responsável.

Responda SOMENTE JSON válido com este contrato: summary (string), confidence (string: baixa|média|alta ou percentual disponível), market (string), reason (string), riskProfile (string: conservador|moderado|ousado), expectedValue (string ou null), fairOdd (number ou null), edge (string ou null), over25Probability (string), over15Probability (string), bothTeamsToScore (string), expectedGoals (string ou null), averageCorners (string ou null), averageCards (string ou null), conservativeMarkets (array de strings), bookmakers (array). Cada bookmaker deve conter bookmaker, simple (array) e combined (array). Cada seleção deve conter market, selection, odd, confidence e reason. Inclua somente seleções cuja odd exista no payload. Inclua warnings (array de strings) para dados insuficientes ou mercados não cobertos.

Para o perfil conservador, prefira +1,5 gols, dupla chance ou ambas marcam somente quando os dados suportarem. Para moderado e ousado, use mercados reais adicionais disponíveis, mas nunca crie um mercado. Faça a seleção por casa de aposta quando a mesma seleção tiver odds diferentes, preservando o maior valor real e informando a casa.

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
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: prompt,
        store: false,
        generation_config: { max_output_tokens: 3000, thinking_level: 'low' },
        ...(structured ? { response_format: { type: 'text', mime_type: 'application/json' } } : {})
      })
    });
    const data = await response.json().catch(() => ({}));
    const upstreamCode = data?.error?.status || data?.error?.code || null;
    if (response.status === 401 || response.status === 403) return jsonResponse(502, { success: false, error: 'AI_AUTH_FAILED', message: 'Não foi possível autenticar a IA.', upstreamCode });
    if (response.status === 429) return jsonResponse(429, { success: false, error: 'AI_RATE_LIMIT', message: 'Limite temporário de requisições atingido.', upstreamCode });
    if (!response.ok) return jsonResponse(502, { success: false, error: 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.', upstreamCode, upstreamMessage: safe(data?.error?.message, 300) });
    const text = Array.isArray(data?.steps)
      ? data.steps.filter(step => step?.type === 'model_output').flatMap(step => Array.isArray(step.content) ? step.content : []).map(part => part?.text || '').join('').trim()
      : (typeof data?.output_text === 'string' ? data.output_text.trim() : '');
    if (!text) return jsonResponse(502, { success: false, error: 'AI_EMPTY_RESPONSE', message: 'A IA retornou uma resposta vazia.' });
    return jsonResponse(200, { success: true, text, structured, model: GEMINI_MODEL });
  } catch (error) {
    return jsonResponse(502, { success: false, error: error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
  } finally { clearTimeout(timeout); }
}

export const config = { path: '/api/gemini' };
