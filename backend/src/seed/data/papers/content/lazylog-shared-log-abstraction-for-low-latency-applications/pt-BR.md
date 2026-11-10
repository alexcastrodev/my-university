---
title: "LazyLog: uma nova abstração de log compartilhado para aplicações de baixa latência"
summary: O LazyLog mantém a ordem total linearizável de um log compartilhado, mas só associa os registros a posições depois que o append retorna, de modo que a ingestão leva uma ida e volta e a ordenação acontece em segundo plano antes de as leituras chegarem.
researchArea: Sistemas distribuídos
keywords: log compartilhado, ordenação preguiçosa, linearizabilidade, ordem total, baixa latência, camada de sequenciamento
version: 1.0
updatedAt: 2026-11-03
---

## Resumo

Logs compartilhados oferecem ordem total linearizável entre shards de armazenamento. No entanto, eles impõem essa ordem de forma ansiosa na ingestão, o que leva a latências altas. Observamos que, em muitas aplicações modernas de log compartilhado, embora a ordenação linearizável seja necessária, ela não é exigida de forma ansiosa ao ingerir os dados, mas apenas mais tarde, quando os dados são consumidos. Além disso, nessas aplicações os leitores estão naturalmente desacoplados dos escritores no tempo. Com base nessa percepção, propomos o LazyLog, uma nova abstração de log compartilhado. O LazyLog associa de forma preguiçosa os registros (entre shards) a posições globais linearizáveis e impõe isso antes que uma posição do log possa ser lida. Essa ordenação preguiçosa permite latências baixas de ingestão. Dado o desacoplamento no tempo, o LazyLog consegue estabelecer a ordem bem antes de as leituras chegarem, minimizando o custo nas leituras. Construímos dois sistemas LazyLog que fornecem ordem total linearizável entre shards. Nossos experimentos mostram que os sistemas LazyLog entregam latências significativamente menores do que os logs compartilhados convencionais, de ordenação ansiosa.

## Visão geral

Um log compartilhado é uma sequência ordenada e tolerante a falhas de registros, na qual muitos clientes fazem append e leitura. Logs como o [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) e o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) espalham os registros por muitos shards de armazenamento e ainda prometem uma única ordem linearizável entre todos eles. Para isso, definem a posição de um registro antes que o append retorne, o que coloca coordenação no caminho de escrita: o Scalog relata latências médias de append de 1 a 2 ms mesmo com throughput baixo.

Este artigo do SOSP 2024, da University of Illinois Urbana-Champaign e da VMware Research, observa que muitas aplicações precisam da ordem quando os dados são consumidos, não quando são ingeridos, e que seus leitores andam atrás dos escritores. Um log pode então confirmar uma escrita assim que ela está durável e decidir a posição depois.

Vale conhecer antes: linearizabilidade (se o append B começa depois que o append A termina, B fica depois de A na ordem) e a diferença entre ordem dentro de um shard, como no Kafka, e ordem total entre shards.

## Contribuição

- **Uma nova abstração.** O `append` torna um registro durável e garante que ele será associado depois à sua posição linearizável correta, retornando um indicador de sucesso em vez de uma posição. `read`, `checkTail` e `trim` não mudam. O artigo defende que isso serve a bancos de dados com leitores desacoplados, event sourcing, filas de mensagens, journals, registro de atividades e agregação de logs.
- **Ordem recuperada de réplicas sem coordenação.** Os clientes escrevem em paralelo em todas as réplicas de uma camada de sequenciamento. Se b começa depois que a termina, a já está em todas as réplicas, então b fica depois de a em todas elas, e só appends concorrentes podem divergir. O log de qualquer réplica dá portanto uma ordem válida, e o do líder é usado na operação normal.
- **O invariante do stable-gp.** Os shards só servem leituras até um contador que avança depois que todas as réplicas de sequenciamento fizeram a coleta de lixo do lote, então uma ordem que um leitor já viu não pode mudar na recuperação.
- **Dois sistemas.** O Erwin-■ (black box, também chamado apenas de Erwin no artigo) passa os registros pela camada de sequenciamento, que os empurra para shards não modificados em segundo plano. O Erwin-st (scalable throughput) passa só metadados por essa camada e escreve os dados direto em um shard escolhido pelo cliente, o que exige shards modificados. Os dois concluem appends em uma ida e volta (1 RTT).

## Metodologia

Os dois sistemas compartilham cerca de 8 mil linhas de C++. Os experimentos rodaram no CloudLab, com camada de sequenciamento de três réplicas e no máximo cinco shards, além de um segundo cluster com até 10 shards para escala. As bases de comparação foram um Corfu implementado do zero pelos autores e o artefato público do Scalog, com registros de 4KB, só com appends, no mesmo throughput. Outras rodadas variaram o atraso da leitura, a taxa de append e o tamanho do registro, colocaram o Erwin-■ sobre shards Kafka e derrubaram uma réplica de sequenciamento. Foram construídas três aplicações: um armazenamento chave-valor inspirado no FireScroll, logging de auditoria para transações e um job de stream com journal.

## Resultados

Estes são os resultados relatados pelos autores. As comparações com Corfu e Scalog usam o Erwin-■.

- **Appends.** Latência até 3,8× menor que a do Corfu no mesmo throughput (a introdução arredonda para cerca de 4×), já que o Corfu precisa de 4 RTTs com três réplicas e o Erwin-■ de um. Contra o Scalog, média e p99 caem duas ordens de grandeza.
- **Leituras.** Com leituras atrasadas em 3 ms, a latência fica perto da do Corfu. Sem atraso, as leituras pagam pela ordenação: lotes grandes as mantêm só um pouco mais lentas que no Corfu a 45K operações/s, enquanto a 5K quase todas tomam o caminho lento.
- **Throughput.** O Erwin-■ chega a cerca de 1M de appends/s com registros de 100 bytes, mas estagna com registros maiores. O Erwin-st chega a cerca de 700K appends/s com registros de 4KB em 10 shards, a 29 µs.
- **Kafka.** Contra o Kafka isolado, o Erwin-■ sobre um shard Kafka reduz a latência em três ordens de grandeza, e três shards dão benefícios parecidos e mais ordem total linearizável.
- **Falhas.** A queda de uma réplica de sequenciamento perturba a carga por cerca de 15 ms, e a recuperação central leva 600 µs.
- **Aplicações.** O armazenamento chave-valor ganha 3,4× só com escritas, cerca de 2,5× com muitas escritas e pouco com muitas leituras. O logging de auditoria ganha 1,8× em transações de escrita e 2,9× em transações de leitura, e o journaling de 1,17× a 1,66× conforme os lotes diminuem.

## Análise crítica

O argumento central é limpo, e a razão contra o Corfu bate com a contagem de idas e voltas. O próprio artigo admite três limites.

- **Escrever em todas as réplicas.** Qualquer falha de réplica de sequenciamento força uma reconfiguração, e réplicas lentas elevam a latência de cauda. A alternativa por supermaioria é trabalho futuro, e a reconfiguração de cerca de 1 ms é uma projeção com um substituto mais rápido para o ZooKeeper.
- **Escalabilidade.** O Erwin-st escala como o Corfu e não alcança o nível do Scalog, o que os autores chamam de desafio em aberto.
- **Diferenças de implementação.** O artefato do Scalog usa gRPC e o Erwin, eRPC. Os autores aceitam que um Scalog melhor seria mais rápido e argumentam que a diferença continuaria, sem medir isso.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O desacoplamento no tempo é argumentado, não medido.** O caso se apoia em descrições de aplicações, não em dados de atraso de leitura vindos de implantações. Um trabalho posterior com autores em comum, o [SpecLog](/papers/speclog-low-latency-speculative-shared-log-fix-ante-ordering), diz que a suposição não vale para aplicações que consomem os registros assim que chegam, e que a latência ponta a ponta do LazyLog sempre inclui o custo de ordenar.
- **O pior caso é mais prometido do que mostrado.** O artigo diz que, sem batching, o LazyLog iguala o desempenho geral de um log convencional, mas a 5K a latência de leitura supera o custo de append de 70 µs do Corfu. Os autores atribuem isso ao ajuste para lotes grandes, sem medir uma correção.
- **Parte do ganho está em onde a durabilidade é declarada.** O Erwin-■ confirma assim que os registros estão na memória das réplicas de sequenciamento, o que o artigo chama de prática padrão. Ainda assim, uma perda de energia simultânea nessas réplicas é um risco diferente de uma escrita em um shard com disco, e o artigo não trata disso.
- **A avaliação favorece o lado do append.** A carga de auditoria não lê o log, as leituras do armazenamento chave-valor vêm do estado local e o journal não é reproduzido. A rodada com Kafka é só de appends, então não exercita a sobrescrita do fim do log que as trocas de view exigem dos shards, e o Erwin-st não tem comparação direta de latência com Corfu ou Scalog.

## Pesquisas futuras

- Escritas por supermaioria, que o artigo cita como trabalho futuro: quanta complexidade de recuperação acrescentam e quanto atenuam réplicas lentas?
- Medições do atraso real de leitura em implantações, que mostrariam com que frequência o caminho rápido se aplica.
- Falhas de cliente no Erwin-st: um primário de shard espera um timeout quando há metadados sem dados, e o stable-gp precisa que todos os shards terminem.
- Se a ingestão preguiçosa e a entrega especulativa do SpecLog podem funcionar no mesmo sistema.
