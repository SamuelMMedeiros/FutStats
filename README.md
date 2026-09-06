# FutStats

O FutStats é uma aplicação local para importação, acompanhamento e análise de partidas de futebol. A interface visual existente foi preservada; a evolução concentra-se no domínio, persistência, validação, segurança e confiabilidade.

## Estrutura principal

| Caminho | Responsabilidade |
|---|---|
| `index.html` | Entrada principal da aplicação, mantendo a interface existente. |
| `Documento de Samuel Medeiros.html` | Cópia compatível do HTML original atualizado. |
| `js/core.js` | Datas, fuso horário, status, identificadores, validação e avaliação Green/Red/Push/Pending. |
| `js/parser.js` | Importação TXT/JSON com avisos por registro e tolerância a dados incompletos. |
| `js/storage.js` | Armazenamento versionado, deduplicação, histórico e backup. |
| `js/statistics.js` | Estatísticas gerais e agrupadas por mercado ou competição. |
| `api/gemini.js` | Endpoint serverless seguro para Gemini. |
| `manifest.json` e `sw.js` | PWA e funcionamento offline dos recursos locais. |
| `tests/core.test.js` | Testes automatizados do núcleo funcional. |

## Gemini e Netlify

O projeto está preparado para o Netlify com `netlify.toml` e a função moderna `netlify/functions/gemini.mjs`, publicada em `POST /api/gemini`. Configure `GEMINI_API_KEY` no painel do projeto Netlify em **Project configuration → Environment variables**. A chave nunca deve ser colocada no HTML, JavaScript público, `localStorage`, README ou Git. O endpoint usa `Netlify.env.get('GEMINI_API_KEY')`, valida o payload, aplica timeout, trata autenticação, limite de requisições, resposta vazia e indisponibilidade temporária, e retorna apenas dados necessários ao frontend.

O arquivo legado `api/gemini.js` permanece no repositório para compatibilidade com outros provedores serverless, mas o deploy Netlify utiliza exclusivamente `netlify/functions/gemini.mjs`.

## Execução e testes

Para validar o núcleo, execute:

```bash
node tests/core.test.js
node --check api/gemini.js
node --check sw.js
for f in js/*.js; do node --check "$f"; done
```

Para testar a interface localmente, sirva a pasta por HTTP. Para testar PWA e service worker, use HTTPS; o navegador não registra o service worker em `file://` ou HTTP inseguro. A integração Gemini requer um runtime serverless que exponha `api/gemini.js` em `/api/gemini`.

A importação TXT continua aceitando o formato legado com cabeçalhos `Equipe A x Equipe B - [DD/MM/YYYY - HH:MM]`. A importação JSON aceita um objeto, um array ou um backup exportado. Registros inválidos são ignorados quando possível, sem interromper os registros válidos.

O ROI só é exibido quando há `stake` ou `valorApostado` e odds válidas. Na ausência desses dados, a interface apresenta `N/D` em vez de inventar valores.
