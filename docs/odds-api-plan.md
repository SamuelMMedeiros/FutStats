# Plano de integração da Odds API

## Regras confirmadas

- Plano gratuito informado na documentação: 500 créditos por mês.
- A API disponibiliza eventos de futebol/soccer e odds agrupadas por bookmakers.
- O endpoint de esportes não consome créditos.
- O endpoint de odds retorna vários bookmakers e mercados em uma resposta por esporte/região/mercado.
- Mercados principais: h2h, spreads/handicap e totals/over-under.
- O retorno inclui identificador do evento, equipes, horário e bookmakers com mercados e outcomes.

## Estratégia do FutStats

- Consultar o feed de odds uma vez por esporte/região/mercado para cada data ou janela suportada, não uma vez por card.
- Persistir a resposta no Supabase e em memória/localStorage com chave de data, sport_key, região e mercados.
- Associar eventos do feed aos jogos da football-data.org por equipes normalizadas e horário aproximado.
- Usar Odds API como fonte principal de odds; API-Football permanece para detalhes, escudos e complemento.
- Bloquear chamadas duplicadas e exibir a data/hora da coleta.
- Enviar ao Gemini somente os mercados reais já cacheados, exclusivamente quando o usuário solicitar o bilhete.
- Reservar o Hugging Face para tarefas auxiliares de desenvolvimento/análise que não exigem prognóstico final.

## Pendência de configuração

A variável `ODDS_API_KEY` ainda precisará ser criada no Netlify quando o usuário fornecer a chave da Odds API. O backend deve responder de modo seguro quando a variável estiver ausente, sem inventar odds.
