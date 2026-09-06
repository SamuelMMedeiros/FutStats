const MAX_PROMPT_LENGTH = 12000;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default async function gemini(req) {
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' });
  }

  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return jsonResponse(503, { success: false, error: 'AI_NOT_CONFIGURED', message: 'A análise de IA não está configurada no servidor.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { success: false, error: 'INVALID_JSON', message: 'Payload inválido.' });
  }

  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse(400, { success: false, error: 'INVALID_PROMPT', message: 'Solicitação inválida ou muito longa.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
      })
    });

    if (response.status === 401 || response.status === 403) {
      return jsonResponse(502, { success: false, error: 'AI_AUTH_FAILED', message: 'Não foi possível autenticar a IA.' });
    }
    if (response.status === 429) {
      return jsonResponse(429, { success: false, error: 'AI_RATE_LIMIT', message: 'Limite temporário de requisições atingido.' });
    }
    if (!response.ok) {
      return jsonResponse(502, { success: false, error: 'AI_UNAVAILABLE', message: 'Não foi possível consultar a IA.' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) {
      return jsonResponse(502, { success: false, error: 'AI_EMPTY_RESPONSE', message: 'A IA retornou uma resposta vazia.' });
    }

    return jsonResponse(200, { success: true, text });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      error: error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      message: 'Não foi possível consultar a IA.'
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const config = { path: '/api/gemini' };
