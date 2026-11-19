---
title: "Implementando serviços tolerantes a falhas com a abordagem de máquina de estados: um tutorial"
summary: O tutorial de Schneider sobre a abordagem de máquina de estados, que torna um serviço tolerante a falhas rodando réplicas determinísticas que processam as mesmas requisições na mesma ordem, divide esse objetivo em Acordo e Ordem e desenvolve protocolos, testes de estabilidade e reconfiguração para falhas bizantinas e fail-stop.
researchArea: Sistemas distribuídos
keywords: replicação de máquina de estados, tolerância a falhas, acordo, ordenação de requisições, estabilidade, falhas bizantinas, fail-stop, reconfiguração
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

The state machine approach is a general method for implementing fault-tolerant services in distributed systems. This paper reviews the approach and describes protocols for two different failure models: Byzantine and fail stop. System reconfiguration techniques for removing faulty components and integrating repaired components are also discussed.

## Visão geral

Este tutorial saiu no ACM Computing Surveys em dezembro de 1990, quando os protocolos de replicação ainda eram em geral descritos um a um. O argumento de Schneider é que muitos deles são instâncias de uma única ideia. Modele o serviço como uma máquina de estados, mantenha uma réplica dela em cada um de vários processadores que falham de forma independente e garanta que toda réplica receba e processe a mesma sequência de requisições. A maioria dos protocolos que ele discute não foi de fato derivada assim, mas, nas palavras dele, enxergá-los como máquinas de estados ajuda a entender como e por que funcionam.

O artigo fica entre a teoria e os sistemas que vieram depois. Ele se apoia em [Tempo, relógios e a ordenação de eventos](/papers/lamport-time-clocks-ordering-of-events), onde Lamport descreveu a abordagem pela primeira vez, e cita o [resultado FLP](/papers/flp-impossibility-of-distributed-consensus) para explicar por que alguns ambientes de falha não têm solução viável. Também menciona o protocolo Paxon Synod como algo que pode ser entendido nesses termos, que é o algoritmo de [O parlamento de meio período](/papers/paxos-part-time-parliament) e, depois, de [Paxos simplificado](/papers/paxos-made-simple).

Vale conhecer antes: relógios lógicos, a diferença entre falhas bizantinas (comportamento arbitrário, possivelmente com conluio) e falhas fail-stop (o componente para e os outros conseguem detectar), e a ideia de um sistema síncrono com limites para o atraso das mensagens.

## Contribuição

- **Uma noção precisa de máquina de estados.** Variáveis de estado mais comandos, cada um um programa determinístico e atômico. A caracterização semântica é que as saídas dependem só da sequência de requisições processadas, não do tempo nem de outra atividade. Um laço que lê um sensor dentro da máquina violaria isso, então o laço vai para um cliente.
- **Coordenação de réplicas dividida em Acordo e Ordem.** Toda réplica não falha recebe toda requisição (Acordo) e as processa na mesma ordem relativa (Ordem). A divisão segue a separação que já existe entre clientes e réplicas.
- **Número de réplicas.** Com falhas bizantinas, tolerar t falhas exige pelo menos 2t + 1 réplicas e votação por maioria nas saídas. Com falhas fail-stop, t + 1 réplicas bastam e qualquer saída pode ser usada.
- **Ordem por identificadores únicos e estabilidade.** Uma requisição é estável em uma réplica quando nenhuma requisição com identificador menor pode mais chegar, e a réplica processa a requisição estável de menor identificador. O artigo dá três formas de atribuir identificadores: relógios lógicos, relógios de tempo real sincronizados e identificadores gerados pelas próprias réplicas.
- **Relaxamentos.** O Acordo pode ser enfraquecido para requisições somente de leitura sob fail-stop, e a Ordem pode ser dispensada para requisições que comutam.
- **Saídas e clientes defeituosos.** Dispositivos de saída e votadores replicados, votação no lado do cliente, clientes replicados, projeto defensivo de comandos e requisições transmitidas pela passagem do tempo.
- **Reconfiguração.** Uma Condição de Combinação sobre o número de processadores defeituosos e protocolos para remover elementos defeituosos e integrar os reparados, inclusive uma nova réplica.

## Metodologia

É um tutorial, então o método é exposição e prova por argumento. Pequenas máquinas de estados escritas em notação de comandos guardados (uma memória, um alocador de recurso com exclusão mútua chamado mutex e uma eleição chamada tally) carregam os exemplos. Cada protocolo é apresentado como um requisito mais uma implementação, e a correção é argumentada de modo informal, por exemplo o argumento de que, depois que uma requisição passa no teste de estabilidade, nenhuma requisição com identificador menor pode chegar.

As falhas são tratadas em dois modelos representativos, bizantino e fail-stop, e não de forma geral. O raciocínio também se organiza pelo que está sendo replicado: a própria máquina de estados (Seção 3), os dispositivos de saída (Seção 4), os clientes (Seção 5) e a configuração (Seção 7). O artigo não traz implementação nem medições. Para desempenho, ele remete a experimentos de Pittelli e Garcia-Molina com testes de estabilidade em estações SUN.

## Resultados

Estes são os resultados que o artigo estabelece, nos termos dele.

- **Duas condições dão uma máquina tolerante a t falhas.** Se toda réplica não falha começa no mesmo estado e executa as mesmas requisições na mesma ordem, todas produzem a mesma saída, e combinar as saídas do conjunto mascara até t falhas.
- **Relógios lógicos só funcionam com fail-stop e um teste de estabilidade.** O teste exige que todo cliente faça requisições periódicas, possivelmente nulas, e depende de canais FIFO e da Suposição de Detecção de Falhas. Com falhas bizantinas e atrasos ilimitados, o artigo diz que não adianta ter teste de estabilidade, porque o resultado FLP impede acordo determinístico nesse cenário.
- **Relógios de tempo real dão dois testes.** Um espera até o relógio local passar o identificador da requisição mais um limite de atraso, então a máquina fica atrás dos clientes por esse limite. O outro espera uma requisição com identificador maior vinda de todos os clientes. Os dois podem ser combinados para que o atraso só apareça quando processadores defeituosos ou a rede o forçarem.
- **Identificadores gerados pelas réplicas dispensam comunicação de todos com todos.** Cada réplica propõe um identificador candidato, o maior candidato vira o identificador, e o artigo prova que o protocolo satisfaz suas restrições. Uma otimização dele é a base do protocolo ABCAST do ISIS Toolkit.
- **Um número ilimitado de falhas ao longo do tempo é possível.** Se réplicas defeituosas forem removidas e réplicas reparadas forem adicionadas com rapidez suficiente, a Condição de Combinação pode valer para sempre, e o total de falhas toleradas é ilimitado.
- **Integrar uma réplica é delicado.** A réplica doadora precisa enviar seu estado e depois repassar requisições por um tempo, o que obriga a um teste de estabilidade modificado durante a reinicialização.

## Análise crítica

O artigo é uma síntese clara e bem organizada, e o vocabulário de Acordo e Ordem continua sendo a forma padrão de falar de replicação. Os limites abaixo vêm em boa parte da época em que foi escrito. A comparação com trabalhos posteriores é uma leitura editorial, não algo que o artigo afirma.

- **O modelo fail-stop esconde a parte difícil.** Usar t + 1 réplicas depende da Suposição de Detecção de Falhas, que dá detecção perfeita e pontual. Numa rede assíncrona, um processo lento não se distingue de um que caiu, então protocolos práticos como [Paxos](/papers/paxos-made-simple) e [Raft](/papers/raft-understandable-consensus-algorithm) usam quóruns de maioria com 2t + 1 réplicas para tolerar t quedas.
- **A Ordem é descrita, não resolvida sob assincronia.** O artigo explica por que o caso de atrasos arbitrários com falhas bizantinas é sem esperança, mas não oferece protocolo que se mantenha seguro quando as hipóteses de tempo falham e vivo quando valem. Essa é a contribuição dos protocolos de consenso.
- **Os números bizantinos dependem de sincronia.** O conjunto de 2t + 1 vem com uma ordenação (Seção 3.2.2) que supõe relógios de tempo real sincronizados e atrasos de mensagem limitados, como o artigo declara. Protocolos bizantinos para redes parcialmente síncronas, até onde sei, usam conjuntos maiores, então esses números não devem ser levados para tais sistemas.
- **Sem avaliação.** Os custos são discutidos de forma qualitativa, e os protocolos de ordenação supõem que as requisições de um cliente, ou ao menos requisições nulas, cheguem com regularidade.
- **A recuperação após falha é rasa.** Elementos reparados são reintegrados a partir de uma réplica em execução, sem tratar de logs duráveis ou snapshots, que é onde os sistemas reais gastam a maior parte do esforço.

## Pesquisas futuras

- Protocolos de consenso que implementam a Ordem em redes parcialmente síncronas sem detecção perfeita de falhas, como Paxos e Raft, com o log como unidade de acordo.
- Reconfiguração como parte do próprio log replicado, em vez de um configurador e um detector de falhas separados.
- Tratamento mais barato de requisições somente de leitura mantendo a linearizabilidade, por exemplo o [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases) e seus leases, que revisita o relaxamento do Acordo para leituras.
- Replicação bizantina tolerante a falhas para cenários assíncronos ou parcialmente síncronos, e seu custo em comparação com protocolos que só toleram quedas.
- Aproveitar a comutatividade para dispensar a ordenação, como o artigo mostra com o exemplo do tally.
