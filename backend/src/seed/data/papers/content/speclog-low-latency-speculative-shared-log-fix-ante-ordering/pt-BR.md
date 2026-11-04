---
title: "Baixa latência ponta a ponta sobre um log compartilhado especulativo com ordenação fix-ante"
summary: O SpecLog entrega registros de um log compartilhado antes de a ordenação global terminar, usando cortes predeterminados que permitem aos shards prever posições com precisão, e sua implementação, o Belfast, sobrepõe a ordenação à computação downstream para reduzir a latência ponta a ponta.
researchArea: Sistemas distribuídos
keywords: log compartilhado, especulação, ordenação fix-ante, latência ponta a ponta, ordem total, durability-first
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Em um log compartilhado durability-first como o [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order), os clientes escrevem nos shards que escolhem, e os shards informam periodicamente seus registros duráveis a uma camada de sequenciamento, que calcula um corte global. Esse desenho dá elasticidade, escolha de onde colocar os dados e escalabilidade, mas um registro só chega aos consumidores depois que o corte volta. A latência de entrega, o tempo até uma tarefa downstream poder ter um registro, é por isso alta, e a latência ponta a ponta (e2e) da aplicação soma o processamento a ela.

Este artigo do OSDI 2025, da University of Illinois Urbana-Champaign, mira aplicações que consomem os registros assim que chegam, como detecção de fraude e negociação de alta frequência. A ideia é entregar os registros antes de a ordem ser conhecida, computar sobre uma ordem prevista e confirmar depois, de modo que ordenação e computação andem lado a lado.

Vale separar três nomes: SpecLog é a abstração, ordenação fix-ante é o mecanismo que torna as previsões precisas e Belfast é o sistema que implementa as duas coisas.

Vale conhecer antes: os cortes globais do Scalog, a execução especulativa e o [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications), artigo irmão com autores em comum que mira a latência de ingestão.

## Contribuição

- **A interface do SpecLog.** Ela se parece com a dos logs atuais, exceto que `deliver` traz um bit dizendo se a posição é especulativa, e depois vem `confirm_spec(k)` ou `fail_spec(k)`. As aplicações seguram as saídas externas até a confirmação e desfazem o estado em caso de falha.
- **Ordenação fix-ante.** No Scalog, um shard pode informar quantos registros quiser, então nenhum outro shard sabe onde os próprios registros vão cair. A ordenação fix-ante troca esse livre-arbítrio por cortes predeterminados que dão a cada shard uma cota. Com cotas de 2, 3 e 2, o primeiro corte cobre as posições de 1 a 7, então S2 sabe que seu próximo registro fica na posição 10, já que 8 e 9 pertencem a S1. Um shard com poucos registros acrescenta no-ops, e um com registros a mais os adia para o relato seguinte.
- **A ordem continua vindo depois da durabilidade.** A camada de sequenciamento continua produzindo cortes reais, e os appends só são confirmados depois deles, porque confirmar antes quebraria a linearizabilidade.
- **Os mecanismos do Belfast.** As cotas seguem as taxas de ingestão. O lag fix pede relatos extras aos shards que ficam para trás durante rajadas. As janelas de lease de especulação, de W cortes, restringem mudanças de cotas e de composição às fronteiras das janelas, então todos os shards mudam juntos. Shards retardatários recebem cota zero, e com muitos shards os cortes escalonados esperam apenas um subconjunto.
- **Tratamento de falhas.** Quando um shard inteiro falha, uma troca de view invalida todas as posições depois do último corte confirmado, e um shard vivo preenche com no-ops as posições do shard que falhou até a janela terminar.

## Metodologia

O Belfast modifica o código aberto do Scalog, com janela de 100 cortes e intervalo de ordenação de 1 ms. Os experimentos rodaram no CloudLab, com um primário e um backup por shard e registros de 4KB. A base de comparação é o Scalog, alterado para que só o primário informe, o que isola os relatos fix-ante dos relatos com livre-arbítrio. Os autores variaram o tempo de computação, o número de shards, as rajadas, as taxas e o tamanho da janela, injetaram um retardatário e derrubaram uma réplica e um shard inteiro. As rodadas reais chegam a 10 shards, e uma emulação chega a 40. Foram construídas três aplicações: detecção de intrusão em IoT, monitoramento de fraude e negociação de alta frequência.

## Resultados

Estes são os resultados relatados pelos autores, comparando o Belfast com o Scalog.

- **Latência de entrega e e2e.** Com 1,5 ms de computação, o Belfast entrega de 3,2× a 3,5× mais cedo e reduz a latência e2e média em 1,6×. No p99, o ganho é de 1,4× com 2 shards e 1,17× com 4.
- **O tempo de computação define o ganho.** Ele é de 1,17× com 0,5 ms, atinge o pico de 1,63× com 1,5 ms, cai para 1,3× com 4 ms e se aproxima de 1 com 50 ms. Com computação curta, as tarefas esperam a confirmação; com computação longa, a ordenação é uma fração pequena do total.
- **Custos.** O overhead no append é de 5,8% com 10 shards, e os no-ops ficam abaixo de 5% dos registros.
- **Rajadas e mudanças de taxa.** Com lag fix, a latência e2e fica abaixo da do Scalog durante toda a rajada. Sem mudanças de cota, a carga no sequenciador fica cerca de 2× maior.
- **Elasticidade e escala.** Shards entram e saem sem indisponibilidade, e o throughput de um shard novo chega menos de 100 ms atrasado. O Belfast escala como o Scalog, com latência e2e 1,66× e 1,4× menor com 2 e 10 shards (1,2 ms de computação), e uma emulação mantém algum ganho com 40 shards.
- **Aplicações.** A detecção de intrusão ganha 1,60× (1,4 ms de computação), o monitoramento de fraude 1,40× (2,2 ms) e a negociação de alta frequência 1,42× (800 µs).
- **Falhas.** A falha de uma réplica não afeta latência nem throughput. A falha de um shard inteiro causa rollbacks, com a detecção tomando a maior parte do tempo e o rollback uma parte marginal dele.

## Análise crítica

A ideia é elegante, e a Figura 8 explica bem o ganho. O artigo admite dois custos.

- **A confirmação limita o que o usuário vê.** As saídas precisam esperar por ela, então a especulação esconde a ordenação em vez de removê-la. O 1,6× de destaque está no pico da curva de computação.
- **O fix-ante acrescenta espera.** O sequenciador segura um corte até que todo shard com cota informe, um atraso que o Scalog não tem. O artigo avisa que rajadas repetidas podem causar muitos lag fixes e mais carga no sequenciador, e deixa como trabalho futuro seu modo de alta rajada e o retorno ao modo do Scalog.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A especulação errada é medida uma vez.** O único caso forçado é uma falha de shard inteiro no monitoramento de fraude, em que o estado para desfazer são poucas linhas do banco por transação. Um rollback marginal pode não valer para aplicações com estado caro, e a raridade da falha de shard inteiro é afirmada, não quantificada.
- **O esforço de portabilidade não tem números.** O artigo chama as mudanças de mínimas sem medi-las. Sua regra cobre saídas externas, mas as três aplicações escrevem valores especulativos em um banco, então qualquer outro leitor desse banco precisa de proteção própria.
- **Os números são relativos a uma única base de código.** O Belfast e sua base de comparação descendem do artefato do Scalog, o que mantém as razões justas. Valores absolutos pedem mais cuidado: o artigo do [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) diz que uma implementação melhor desse Scalog teria latências absolutas menores. O resultado com 40 shards, emulados, é uma estimativa.
- **A evidência de demanda é compartilhada.** Os cerca de 35% que apontam a entrega como a latência mais crítica vêm do mesmo relatório da Redpanda que o LazyLog cita para um terço de 300 profissionais apontando a ingestão. Nenhum dos dois é maioria.
- **A comparação com o LazyLog depende da aplicação.** O artigo diz que o LazyLog não ajuda de forma fundamental a reduzir a latência e2e. Isso é justo para registros consumidos de imediato. Nos appends o balanço se inverte: os do Belfast ficam perto de 3 ms na Figura 9, mais ou menos onde estão os do Scalog, e a ingestão é a métrica que o LazyLog mira.

## Pesquisas futuras

- O modo de alta rajada e o retorno ao modo do Scalog, que o artigo deixa como trabalho futuro.
- Especulação em logs order-first, que o artigo esboça como ler registros ordenados, mas ainda não duráveis, do primário de um shard.
- Até que custo de rollback a especulação compensa, com falhas injetadas em aplicações com tamanhos de estado diferentes.
- Se um único log consegue oferecer ao mesmo tempo entrega especulativa e ingestão preguiçosa em 1 RTT.
