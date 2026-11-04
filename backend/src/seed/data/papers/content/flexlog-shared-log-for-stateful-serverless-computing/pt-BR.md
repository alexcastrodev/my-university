---
title: "FlexLog: um shared log para computação serverless com estado"
summary: FlexLog é um shared log distribuído para funções serverless que guarda registros em memória persistente e os ordena com uma árvore de sequenciadores, permitindo que as aplicações escolham a ordenação por região do log em vez de aceitar uma única ordem total global.
researchArea: Sistemas distribuídos
keywords: shared log, computação serverless, memória persistente, sequenciador, ordenação flexível, multi-tenancy
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Publicado no HPDC 2023 por Dimitra Giantsidi, Emmanouil Giortamis, Nathaniel Tornow, Florin Dinu e Pramod Bhatotia, o FlexLog parte de onde o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) partiu, tratando um shared log como a camada de estado das funções serverless. Os autores então apontam dois limites dos shared logs existentes: são construídos sobre SSDs, e a maioria é projetada para ordem total, que é mais rígida do que muitas aplicações serverless precisam. Um job encadeado de análise de dados, por exemplo, precisa serializar suas fases, mas não as tarefas paralelas dentro de uma fase.

Um perfil local de duas cargas, processamento de vídeo e compressão gzip, mostra 41% e 48,1% do tempo de CPU gastos em chamadas de armazenamento. O FlexLog responde com registros guardados em memória persistente (PM) Intel Optane e um log dividido em regiões, cada uma com sua própria ordem total.

Vale conhecer antes: a separação entre camada de dados e camada de ordenação em um shared log, linearizabilidade e como o Paxos chega a um acordo.

## Contribuição

- **Cores.** Uma cor é uma região do log formada por shards, e cada região tem um sequenciador em uma árvore n-ária. Registros de cores diferentes são ordenados de forma arbitrária. Fazer append em uma única cor dá linearizabilidade, escrever em várias cores dá consistência eventual, e aplicações sem relação entre si podem usar cores distintas para multi-tenancy.
- **Sequenciamento sem consenso por requisição.** Um número de sequência combina uma época de 32 bits e um contador de 32 bits. Os 2f backups replicam só a época e ficam fora da execução normal. Os sequenciadores abaixo da raiz juntam requisições concorrentes da mesma cor.
- **Armazenamento em camadas.** Cada réplica tem um cache em DRAM, um log crash-consistent em PM e SSD para os segmentos antigos do log.
- **Replicação conduzida pela função.** A função transmite o registro para todas as réplicas de um shard aleatório. Cada réplica o persiste e pede um número de sequência, depois faz commit quando o sequenciador folha responde. O append termina quando todas as réplicas confirmam, o que permite leituras linearizáveis a partir de uma réplica.
- **Append multicor.** Um protocolo especificado no artigo usa uma cor especial como intermediária para fazer append em várias regiões no modo tudo ou nada.

## Metodologia

O artigo apresenta os protocolos, um esboço de prova de linearizabilidade e uma implementação em Go (ordenação e replicação) e C++ sobre PMDK (armazenamento). O cluster tem 6 máquinas com 800 GB de Optane PM e rede de 10 Gbps, com processos colocalizados. Os padrões são 3 réplicas por shard, registros de 1 KB e intervalo de batching de 1 µs.

O artigo chama sua comparação com o Boki de "apples-to-apples", e ela é feita camada por camada. Na ordenação, nenhum dado é escrito. Como "we were not able to run a multi-client deployment of Boki's ordering layer", a latência é comparada com um único cliente, e o throughput multiusuário é comparado com o libpaxos com um único proponente, que faz as vezes da abstração de ordenação do Boki e do Scalog. No armazenamento, a camada de PM enfrenta o RocksDB com MemTable de 64 MB e write-ahead log ativado, usando db_bench.

## Resultados

Estas são afirmações do próprio FlexLog, nas condições acima.

- **Armazenamento contra o Boki.** O throughput é uma ordem de grandeza maior em todos os tamanhos de registro e números de threads. Os autores atribuem o limite do Boki principalmente às syscalls de sync.
- **Ordenação contra o Boki.** A latência fica abaixo de 250 µs, de 2,5× a 4× melhor na seção de resultados (o resumo diz de 2× a 4×).
- **Ordenação contra o Paxos.** O throughput é de 2× a 3× maior que o do libpaxos.
- **Ordenação flexível.** Dispensar o sequenciador raiz (FlexLog-P) acrescenta 10% de throughput em relação à ordem total.
- **Para onde vai o tempo.** Com a função colocalizada com o armazenamento, a latência de armazenamento é de 1 µs e a de ordenação é de 250 µs e 100 µs em duas cargas. Os autores concluem: "The performance gains come from the fast ordering protocol (in appends) rather than the use of PM."
- **Replicação.** A latência de append fica estável até 3 réplicas e dobra com 4, 6 e 8.
- **Escala.** Um sequenciador folha emite cerca de 1,2M de números de sequência por segundo, e cada folha adicional, cerca de 1M a mais. Um pedido de ordenação leva cerca de 110 µs com um sequenciador e cresce linearmente com a altura da árvore. Seis shards entregam o dobro do throughput de três com 95% de leituras.

## Análise crítica

O próprio artigo declara vários limites. O Optane foi descontinuado, e o CXL é apresentado como caminho futuro. A prova omite "most of the details". Falhas de réplica bloqueiam appends, e uma réplica perdida de forma permanente deixa seu shard legível, mas não gravável. A implementação é parcial: "we implemented only the single-log Append and Read operations", o que conflita com a afirmação da introdução de ter implementado todos os protocolos e operações auxiliares.

Outros limites vêm da leitura da avaliação.

- **A comparação com o Boki não é de ponta a ponta.** Nenhum experimento passa um append replicado e ordenado pelos dois sistemas, e a avaliação não roda nenhuma aplicação serverless sobre o FlexLog.
- **Os 3× não são medidos contra o Boki.** O quadro de conclusões afirma até 3× de throughput de ordenação em relação ao Boki, mas o experimento por trás disso usa o libpaxos, e o Boki não está nesse gráfico.
- **A baseline difere da descrição do próprio Boki.** O FlexLog configura os sequenciadores do Boki para "run Paxos" e discute livelock com múltiplos proponentes. O artigo do Boki descreve um metalog guiado pelo primário, em que só o primário faz append e espera um quórum. O Boki também ordena registros periodicamente, então a latência com um único cliente depende de um período que o FlexLog não informa.
- **A motivação de leitura é seletiva.** O FlexLog diz que o Boki informa leituras de 1 a 3 ms. A Tabela 3 do próprio Boki traz medianas de 0,12 a 0,79 ms e p99 de 0,72 a 2,90 ms, então essa faixa só corresponde às caudas mais lentas. O FlexLog não compara diretamente a latência de leitura com a do Boki.
- **A diferença de armazenamento varia.** O teste exercita o RocksDB com db_bench, e não os nós do Boki com seus caches, e a configuração não descreve o SSD. A Figura 7 mostra a diferença caindo para bem menos de 10× com 99% de leituras.
- **A PM não é o principal resultado dos appends.** Pela conclusão dos próprios autores, a ordenação determina os appends, então o resultado de 10× no armazenamento não se transfere para eles.
- **A flexibilidade quase não é medida.** Sua evidência é um único número de 10%. Appends multicor e multi-tenancy não têm experimento, e o Algoritmo 2 faz append cor por cor, então a prova de tudo ou nada não mostra que um leitor não possa observar um resultado parcial.
- **A evidência de escala é estreita.** A escala em shards informada é uma única duplicação em 6 máquinas com 95% de leituras. Os 1,2M Ops/s do Boki e os 1,2M de números de sequência por segundo do FlexLog são grandezas diferentes.
- **A cobertura de falhas é pequena.** A recuperação de réplica, que cresce quase linearmente com os registros a recuperar, usa um microbenchmark em uma réplica, e o failover de sequenciador não é medido.

## Pesquisas futuras

- Como FlexLog e Boki se comparam de ponta a ponta, com uma aplicação, o mesmo hardware e uma camada de ordenação do Boki com vários clientes?
- O projeto mantém sua latência em memória conectada por CXL, que o artigo propõe mas não testa?
- Quanto a ordenação relaxada economiza em árvores mais altas, e quais aplicações reais podem usá-la?
- Que isolamento um append multicor pode dar a leitores concorrentes?
- Contatar uma réplica de cada shard a cada leitura limita a escala além de 6 shards, e um índice ajudaria?
