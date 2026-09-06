
## Revalidação após commit 535822e

Após inserir os helpers ausentes `renderMetricCard` e `renderLiveMetrics`, o deploy passou a renderizar o card. O erro anterior era concreto: `ReferenceError: renderLiveMetrics is not defined` interrompia `renderCards()`.

O modal individual abriu corretamente pelo botão `Detalhes ↗`, mostrou título, data, status, informações e métricas sem afetar o card. Ainda falta validar os fluxos de comparação, edição de resultado, IA, filtros e persistência após reload.

## Fluxos adicionais reproduzidos

No deploy `535822e`, o card passou a aparecer. O botão de detalhes abriu o modal individual corretamente. O botão Comparar também abriu o modal e recebeu resposta da IA após alguns segundos; o estado intermediário de carregamento ficou explícito e não exibiu erro técnico.

A investigação adicional deve cobrir: duas ou mais partidas simultâneas, campos ausentes, atualização de resultados, persistência e resposta parcial ou falha da IA.
