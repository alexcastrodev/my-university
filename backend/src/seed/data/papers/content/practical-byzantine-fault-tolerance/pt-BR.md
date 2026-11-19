---
title: "Tolerância prática a falhas bizantinas"
summary: O PBFT de Castro e Liskov, o primeiro protocolo de replicação de máquina de estados que sobrevive a falhas bizantinas em uma rede assíncrona com custo baixo o bastante para serviços reais, demonstrado por um NFS replicado que ficou apenas 3% mais lento que o não replicado no benchmark Andrew.
researchArea: Sistemas distribuídos
keywords: tolerância a falhas bizantinas, replicação de máquina de estados, pbft, troca de visão, códigos de autenticação de mensagem, linearizabilidade
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo descreve um novo algoritmo de replicação capaz de tolerar falhas bizantinas. Acreditamos que algoritmos tolerantes a falhas bizantinas serão cada vez mais importantes no futuro, porque ataques maliciosos e erros de software são cada vez mais comuns e podem fazer nós defeituosos exibirem comportamento arbitrário. Enquanto os algoritmos anteriores assumiam um sistema síncrono ou eram lentos demais para uso prático, o algoritmo descrito aqui é prático: funciona em ambientes assíncronos como a Internet e incorpora várias otimizações importantes que melhoram o tempo de resposta dos algoritmos anteriores em mais de uma ordem de grandeza. Implementamos um serviço NFS tolerante a falhas bizantinas com o algoritmo e medimos seu desempenho. Os resultados mostram que nosso serviço é apenas 3% mais lento que um NFS padrão sem replicação.

## Visão geral

[O problema dos generais bizantinos](/papers/byzantine-generals-problem) definiu as falhas arbitrárias (bizantinas) em 1982, mas os protocolos que vieram depois eram construções teóricas lentas demais para uso ou assumiam uma rede síncrona, com limites conhecidos para o atraso das mensagens. O [Paxos](/papers/paxos-part-time-parliament) e o Viewstamped Replication tratavam a replicação em sistemas assíncronos, mas só para falhas benignas, em que um nó cai ou fica lento e nunca mente. Este artigo, apresentado no OSDI em fevereiro de 1999 por Miguel Castro e Barbara Liskov, mira a lacuna entre os dois: replicação de máquina de estados ([o tutorial](/papers/state-machine-approach-fault-tolerant-services-tutorial)) que funciona quando um número limitado de réplicas está comprometido ou com defeito, sobre uma rede como a Internet.

A motivação aparece logo nas primeiras linhas: ataques maliciosos e erros de software são cada vez mais comuns, e ambos podem fazer um nó se comportar de forma arbitrária. O serviço pode ser qualquer máquina de estados determinística, não apenas leituras e escritas de um registrador.

Vale conhecer antes: o modelo assíncrono e por que o [FLP](/papers/flp-impossibility-of-distributed-consensus) obriga qualquer protocolo desse tipo a abrir mão de algo (aqui, a vivacidade depende de uma hipótese fraca de sincronia), a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) como condição de segurança, e a estrutura de primário e backups com visões usada pelo [Paxos](/papers/paxos-made-simple).

## Contribuição

- **Um protocolo bizantino que não precisa de sincronia para a segurança.** Com pelo menos 3f+1 réplicas e no máximo f defeituosas, os clientes recebem respostas corretas que satisfazem a linearizabilidade, e o protocolo nunca precisa excluir réplicas suspeitas do grupo, que é a fraqueza que o artigo atribui ao Rampart e ao SecureRing.
- **Um caso normal em três fases.** O primário atribui um número de sequência no pre-prepare, as réplicas trocam mensagens prepare e depois commit, e o cliente aceita o resultado após f+1 respostas iguais.
- **Uma troca de visão que substitui um primário defeituoso,** com checkpoints e uma prova de checkpoint estável para que as réplicas possam descartar seus logs.
- **Otimizações que tornam o protocolo usável.** Autenticadores (vetores de MACs) no lugar de assinaturas de chave pública na operação normal, respostas só com digest, execução tentativa que reduz cinco atrasos de mensagem para quatro, um caminho de uma ida e volta para operações somente de leitura, agrupamento de requisições e digests incrementais de checkpoint.
- **Uma biblioteca de replicação e o BFS,** um serviço NFS tolerante a falhas bizantinas, com medições.

## Metodologia

A seção 2 fixa o modelo: uma rede assíncrona que pode perder, atrasar, duplicar e reordenar mensagens, nós que podem falhar de modo arbitrário e independente, e um adversário limitado computacionalmente que não consegue forjar assinaturas nem quebrar os digests. A independência não é de graça: o artigo diz que as réplicas deveriam rodar implementações, sistemas operacionais e administradores diferentes. As seções 3 a 5 apresentam o algoritmo, um esboço da prova de segurança e vivacidade (a prova completa está em um memorando técnico separado) e as otimizações.

A avaliação da seção 7 usa quatro réplicas, que toleram uma falha bizantina, mais um cliente, todos estações DEC 3000/400 Alpha idênticas (133 MHz) em uma Ethernet comutada isolada de 10 Mbit/s. Um micro-benchmark mede operações nulas (10.000 invocações, mediana de três execuções). O benchmark Andrew, uma carga de desenvolvimento de software com cinco fases, compara o BFS com o NFS-std (o NFS V2 do Digital Unix) e com o BFS-nr (BFS sem replicação), com média de 10 execuções.

## Resultados

- **A resiliência é ótima.** 3f+1 é o número mínimo de réplicas para segurança e vivacidade em um sistema assíncrono com f defeituosas, e o artigo cita uma prova disso. A segurança vale para qualquer número de clientes defeituosos.
- **Micro-benchmark.** Para uma operação nula (0/0), a latência replicada de leitura e escrita é 3,35 ms contra 0,82 ms sem replicação (sobrecusto de 309%), e a somente leitura é 1,62 ms (98%). Com argumentos de 4 KB (4/0) os valores são 14,19 ms (207%) e 6,98 ms (51%) contra 4,62 ms; com resultados de 4 KB (0/4) são 8,01 ms (72%) e 5,94 ms (27%) contra 4,66 ms. O artigo chama isso de pior caso, já que as operações não fazem trabalho nenhum.
- **Benchmark Andrew.** O BFS na forma estrita leva 64,48 s contra 62,52 s do NFS-std, 3% a mais, e 26% a mais que o BFS-nr, com 51,07 s. Tornar o lookup somente de leitura leva o BFS a 61,07 s, 2% mais rápido que o NFS-std e 20% acima do BFS-nr. As fases 1, 2 e 5 são mais rápidas que o NFS-std porque a replicação dá estabilidade sem escritas síncronas em disco, como no Harp.
- **Criptografia.** Uma assinatura RSA de 1024 bits leva 43 ms para ser gerada e 0,6 ms para ser verificada no hardware do artigo, enquanto o MAC de uma mensagem de 64 bytes leva cerca de 10,3 microssegundos. Assinaturas são usadas só nas mensagens de troca de visão e de nova visão.
- **Contra o Rampart.** O artigo estima, a partir de números publicados, uma latência de pelo menos 65 ms para o Rampart, e conclui que seu algoritmo é mais de 10 vezes mais rápido para operações nulas de leitura e escrita e mais de 20 vezes para as somente de leitura, depois de um escalonamento conservador por 1,7.
- **Mascarando um bug real.** Os autores relatam que encontraram um bug de software durante a execução do sistema e o algoritmo continuou funcionando corretamente.

## Análise crítica

O PBFT é o projeto de referência para replicação bizantina prática, e seus pontos fortes se sustentam: segurança sem sincronia, uma separação limpa entre a ordenação dentro de uma visão e o acordo entre visões, e um custo medido em um serviço real. Os limites também aparecem no próprio artigo.

- **As medições cobrem só a operação normal.** O artigo diz que os experimentos não têm trocas de visão, e a biblioteca de replicação ainda não implementava trocas de visão nem retransmissões. O custo de um primário defeituoso, portanto, não foi medido, nem o comportamento sob um ataque de verdade.
- **Escala pequena.** Todos os experimentos usam quatro réplicas, um cliente e uma LAN de 10 Mbit/s. O artigo observa que o tempo para gerar autenticadores cresce linearmente com o número de réplicas, e o número de mensagens cresce com o grupo, então os resultados dizem pouco sobre grupos grandes ou implantações de longa distância.
- **A comparação com o Rampart é uma estimativa** feita com números publicados para outro hardware, não uma execução lado a lado.
- **A hipótese de independência é exigente.** Implementações e administradores diversos custam caro, e um bug presente em todas as réplicas não é mascarado.
- **Sem privacidade.** Uma réplica defeituosa pode vazar dados, porque as operações precisam de suas entradas em claro.
- **A pesquisa posterior mudou o quadro.** A troca de visão do PBFT e sua comunicação de todos para todos viraram o principal problema de escala. O HotStuff (2019) reestruturou o protocolo para simplificar a troca de líder com comunicação linear, e a replicação BFT virou peça de blockchains permissionados e do consenso de alguns sistemas de criptomoedas. Esse material vem da literatura posterior, não deste artigo.

## Pesquisas futuras

- Os próprios autores listam menos recursos: réplicas usadas como testemunhas, só envolvidas quando uma réplica completa falha, e menos cópias do estado (f+1), além de compartilhamento de segredo para privacidade.
- Protocolos que mantêm as garantias do PBFT com menos comunicação ou menos carga no líder, como o [Autobahn](/papers/autobahn-seamless-high-speed-bft), que separa a disseminação de dados de uma ordenação no estilo PBFT, e o [Ambulance](/papers/ambulance-saving-bft-through-racing), que troca timeouts por uma corrida entre réplicas.
- Sistemas bizantinos que evitam a ordem total para parte da carga, como o [Pesto](/papers/pesto-high-performance-bft-queries).
- BFT em larga escala e em redes de longa distância, incluindo seu uso em blockchains.
- Medir o custo de trocas de visão, líderes lentos e ataques ativos, que a avaliação original deixou de fora.
