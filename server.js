import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// Polyfill Netlify global for existing Netlify Functions modules
if (typeof globalThis.Netlify === 'undefined') {
  globalThis.Netlify = {
    env: {
      get: (key) => process.env[key] || ''
    }
  };
}

// Import existing domain API handlers
import fixturesHandler from './netlify/functions/fixtures.mjs';
import fixtureDetailsHandler from './netlify/functions/fixture-details.mjs';
import oddsHandler from './netlify/functions/odds.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Bridge web-standard Request/Response functions to Express routes
async function forwardToWebHandler(handler, req, res) {
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const webReq = new Request(fullUrl, {
      method: req.method,
      headers: req.headers
    });
    const webRes = await handler(webReq);
    res.status(webRes.status);
    for (const [k, v] of webRes.headers.entries()) {
      res.setHeader(k, v);
    }
    const body = await webRes.text();
    res.send(body);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(502).json({ success: false, error: 'UPSTREAM_ERROR', message: err?.message || 'Erro no servidor' });
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'FutStats' });
});

// Fixtures API
app.get('/api/fixtures', (req, res) => forwardToWebHandler(fixturesHandler, req, res));

// Fixture Details API
app.get('/api/fixture-details', (req, res) => forwardToWebHandler(fixtureDetailsHandler, req, res));

// Odds API
app.get('/api/odds', (req, res) => forwardToWebHandler(oddsHandler, req, res));

// Gemini AI Helper Functions
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

// Gemini AI API route
app.post('/api/gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      error: 'AI_NOT_CONFIGURED',
      message: 'A análise de IA não está configurada no servidor. Defina a variável GEMINI_API_KEY.'
    });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ success: false, error: 'INVALID_JSON', message: 'Payload JSON inválido.' });
    }
  }

  let prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  let structured = false;
  if (payload?.mode === 'match-analysis' && payload?.match && typeof payload.match === 'object') {
    prompt = buildMatchPrompt(payload.match);
    structured = true;
  }
  if (payload?.mode === 'bet-ticket' && payload?.match && typeof payload.match === 'object') {
    prompt = buildTicketPrompt(payload.match);
    structured = true;
  }

  if (!prompt || prompt.length > 18000) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_PROMPT',
      message: 'Solicitação inválida ou muito longa.'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const modelsToTry = ['gemini-3.6-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            maxOutputTokens: 3000,
            temperature: 0.2,
            ...(structured && payload?.mode === 'bet-ticket' ? { responseMimeType: 'application/json' } : {})
          }
        });

        const text = response.text?.trim() || '';
        if (text) {
          return res.json({ success: true, text, structured, model });
        }
      } catch (err) {
        lastError = err;
        // Continue to fallback model if 404/503/etc.
      }
    }

    throw lastError || new Error('A IA retornou uma resposta vazia.');
  } catch (error) {
    console.error('[Gemini API Error]', error);
    return res.status(502).json({
      success: false,
      error: 'AI_UNAVAILABLE',
      message: error?.message || 'Não foi possível consultar a IA.'
    });
  }
});

// Serve static assets from project root
app.use(express.static(__dirname));

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FutStats server listening on http://0.0.0.0:${PORT}`);
});
