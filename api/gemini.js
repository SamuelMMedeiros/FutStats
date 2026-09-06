const ALLOWED_MAX_PROMPT = 12000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function geminiHandler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(res, 503, { success: false, error: 'AI_NOT_CONFIGURED', message: 'A análise de IA não está configurada no servidor.' });
  let payload = req.body;
  try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return json(res, 400, { success: false, error: 'INVALID_JSON', message: 'Payload inválido.' }); }
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt || prompt.length > ALLOWED_MAX_PROMPT) return json(res, 400, { success: false, error: 'INVALID_PROMPT', message: 'Solicitação inválida ou muito longa.' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1200 } })
    });
    if (response.status === 401 || response.status === 403) return json(res, 502, { success: false, error: 'AI_AUTH_FAILED', message: 'Não foi possível autenticar a IA.' });
    if (response.status === 429) return json(res, 429, { success: false, error: 'AI_RATE_LIMIT', message: 'Limite temporário de requisições atingido.' });
    if (!response.ok) return json(res, 502, { success: false, error: 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) return json(res, 502, { success: false, error: 'AI_EMPTY_RESPONSE', message: 'A IA retornou uma resposta vazia.' });
    return json(res, 200, { success: true, text });
  } catch (error) {
    return json(res, 502, { success: false, error: error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
  } finally { clearTimeout(timeout); }
};
