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

## Gemini

Configure `GEMINI_API_KEY` somente no ambiente do backend/serverless. A aplicação chama `POST /api/gemini`; a chave nunca é enviada ao navegador nem armazenada no `localStorage`. O endpoint trata ausência de chave, autenticação, limite de requisições, timeout, resposta vazia e indisponibilidade temporária.

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
