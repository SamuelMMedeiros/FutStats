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

## Painel de partidas por data

A aplicação agora pode carregar partidas por data usando `football-data.org` como fonte principal e `API-Football` como fallback controlado. O endpoint do frontend é `GET /api/fixtures?date=YYYY-MM-DD`; ele normaliza as fontes para os cards e mantém o fuso `America/Sao_Paulo`. O botão de análise Gemini continua sob demanda e não é executado automaticamente para cada card.

O arquivo `supabase/schema.sql` cria o contador diário atômico da API-Football e a tabela de cache preparada para persistência. O orçamento padrão do backend é de 80 requisições por dia, deixando margem abaixo do limite informado de 100. A API-Football só é consultada como complemento quando a fonte principal não retorna partidas e o contador do Supabase autoriza a chamada.

### Variáveis de ambiente do Netlify

Configure os valores no projeto Netlify, em **Project configuration → Environment variables**, nunca no frontend:

| Variável | Uso |
|---|---|
| `FOOTBALL_DATA_API_KEY` | Header `X-Auth-Token` da API football-data.org. |
| `API_FOOTBALL_KEY` | Header `x-apisports-key` da API-Football. |
| `API_FOOTBALL_DAILY_BUDGET` | Opcional; padrão `80`. |
| `SUPABASE_URL` | URL do projeto Supabase. |
| `SUPABASE_KEY` | Chave de servidor usada somente pelas funções Netlify. |
| `GEMINI_API_KEY` | Chave usada apenas pela função `/api/gemini`. |

Execute `supabase/schema.sql` no SQL Editor do Supabase antes de ativar o fallback da API-Football. Sem o schema do contador, o backend bloqueia o uso da API-Football para evitar ultrapassar o limite diário.
