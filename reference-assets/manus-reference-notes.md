# Referências visuais da pasta Manus

## Padrões observados

As duas imagens mostram uma interface mobile de prognósticos com fundo preto profundo, cartões grandes em carrossel e acentos em gradientes vermelho/azul associados aos times. O topo tem título central "Palpites IA", botão de retorno e abas horizontais para `Simples`, `Combinada`, `Múltiplas` e `Super Odd`.

O card principal usa escudos reais dos times em círculos translúcidos, confronto `VS`, horário destacado, título do mercado e um bloco de odd com contraste elevado. Há uma chamada de ação grande para liberar ou visualizar a aposta. A navegação inferior fixa possui cinco áreas: início, partidas, palpites IA, chat IA e perfil; a área ativa usa um círculo verde brilhante e sublinhado.

## Adaptação recomendada para o FutStats

Preservar a identidade atual em azul-petróleo/índigo, mas elevar o card para uma composição com cabeçalho de competição, logos de clubes, horário/status, mercado sugerido, confiança, odd e botão `Gerar bilhete IA`. Usar abas internas `Simples`, `Combinada`, `Múltipla` e `Mais seguras` no painel de prognóstico, sem esconder os dados estatísticos do jogo.

Usar escudos e logos de competição vindos da API-Football, com fallback visual neutro quando faltarem. O botão Green e o botão Red devem ficar separados do badge automático de status da partida. O carrossel pode ser adaptado para desktop como uma grade de cards e, no mobile, como navegação horizontal.

A tela deve manter transparência: odds devem ser exibidas somente quando retornadas por fonte, e a IA deve indicar dados insuficientes em vez de inventar probabilidades. O CTA de IA deve operar sob demanda e mostrar loading, erro e resultado estruturado.
