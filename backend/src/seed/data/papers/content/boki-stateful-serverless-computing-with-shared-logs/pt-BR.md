---
title: "Boki: computação serverless com estado usando shared logs"
summary: Boki é um runtime FaaS que oferece às funções serverless uma API de shared log, construída em torno de um metalog que resolve ordenação, consistência de leitura e tolerância a falhas com um único mecanismo, além de bibliotecas para workflows, armazenamento de objetos e filas de mensagens.
researchArea: Sistemas distribuídos
keywords: shared log, computação serverless, function as a service, metalog, consistência, tolerância a falhas, replicação de máquina de estados
version: 1.0
updatedAt: 2026-11-03
---

## Resumo

Boki é um novo runtime serverless que exporta uma API de shared log para funções serverless. Os shared logs do Boki permitem que aplicações serverless com estado gerenciem seu estado com durabilidade, consistência e tolerância a falhas. Os shared logs do Boki alcançam alto throughput e baixa latência. O principal viabilizador é o metalog, um mecanismo novo que permite ao Boki tratar ordenação, consistência e tolerância a falhas de forma independente. O metalog ordena os registros do shared log com alto throughput e oferece consistência de leitura, ao mesmo tempo que permite aos provedores de serviço otimizar os caminhos de escrita e de leitura do shared log de maneiras diferentes. Para demonstrar o valor dos shared logs para aplicações serverless com estado, construímos bibliotecas de suporte do Boki que implementam workflows tolerantes a falhas, armazenamento durável de objetos e filas de mensagens. Nossa avaliação mostra que os shared logs podem acelerar cargas de trabalho serverless importantes em até 4,7×.

## Visão geral

Funções serverless não têm estado, mas as aplicações construídas com elas têm. No exemplo do artigo, uma reserva de viagem chama uma função para hotéis e outra para voos, e qualquer uma pode falhar no meio do caminho, deixando estado inconsistente para trás. Zhipeng Jia e Emmett Witchel apresentam o Boki no SOSP 2021 como um runtime FaaS, construído sobre o sistema Nightcore dos próprios autores, em que as funções gerenciam estado por meio de um shared log em vez de um armazenamento put/get.

Um shared log é um log totalmente ordenado em que muitos clientes fazem append e leem de forma concorrente. [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) e [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) mostraram que shared logs podem sustentar objetos consistentes e duráveis, e o Boki toma do [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) o seu protocolo de ordenação. O problema novo é o ambiente serverless: não há garantia de que a memória da função sobreviva entre invocações, o armazenamento fica separado da computação e muitos logs precisam dividir o hardware com eficiência.

Vale conhecer antes: replicação de máquina de estados, quóruns, as garantias de leitura chamadas monotonic reads e read-your-writes, e a separação entre replicar registros e ordená-los.

## Contribuição

- **A API LogBook.** Cada invocação de função fica ligada a um LogBook, com chamadas de append, leitura e trim. Tags selecionam sub-streams, então um leitor pula registros que não lhe interessam.
- **O metalog.** Cada log físico tem um metalog que registra suas transições internas de estado. Fazer append nele decide a ordem total, comparar posições nele garante a consistência de leitura, e selá-lo pausa o log para a reconfiguração. O artigo o chama de "the Answer to Everything" no Boki.
- **Um índice de log nos nós de função.** Muitos LogBooks são multiplexados em um log físico e os registros podem cair em qualquer shard. Os LogBook engines, ao lado das funções, mantêm um índice compacto e um cache de registros, o que separa o caminho de leitura do caminho de escrita.
- **Dados auxiliares.** Um cache por registro, de melhor esforço, que poupa as funções de um replay completo do log.
- **Três bibliotecas de suporte.** BokiFlow adapta os workflows tolerantes a falhas do Beldi, BokiStore adapta os objetos transacionais do Tango com snapshot isolation, e BokiQueue adapta a replicação de máquina de estados composta do vCorfu.

## Metodologia

No append, um LogBook engine numera o registro localmente e o replica para os nós de armazenamento do seu shard. Esses nós enviam periodicamente vetores de progresso ao sequenciador primário, que calcula o mínimo elemento a elemento e o adiciona ao metalog, ordenando registros entre shards. O próprio metalog usa um protocolo guiado pelo primário: só o primário faz append, e cada entrada espera um quórum de sequenciadores. Cada função acompanha uma posição no metalog, e uma leitura fica suspensa se o índice local estiver atrás dela.

Os registros ficam no RocksDB, nos nós de armazenamento. Os experimentos rodaram em instâncias EC2 c5d.2xlarge com SSDs NVMe em uma única região, com registros e metalogs replicados três vezes por padrão.

A avaliação tem microbenchmarks e uma comparação por biblioteca. O BokiFlow roda as cargas de filmes e viagens do Beldi contra o Beldi portado para o Nightcore. O BokiStore roda uma carga inspirada no Retwis contra o MongoDB. O BokiQueue roda contra o Amazon SQS e o Apache Pulsar.

## Resultados

Estes são os resultados informados pelos autores.

- **Appends.** Um LogBook chegou a 1,2M Ops/s com 64 nós e 2.560 funções concorrentes, com latência mediana de 2,03 ms e p99 de 6,42 ms.
- **Leituras.** Um acerto no cache local leva 121 µs. A mediana é de 0,57 ms em uma falha do cache local e de 0,79 ms por um engine remoto.
- **Virtualização.** Quatro logs físicos sustentaram 100K LogBooks a 446,9 KOp/s, contra 458,2 KOp/s para 100 LogBooks. Sob carga Zipf assimétrica (s = 5), o índice de log entregou 278,6 KOp/s e o sharding fixo, 129,6.
- **Reconfiguração.** Os appends voltaram à latência normal em até 100 ms, e o protocolo em si levou 15,7 ms com três sequenciadores.
- **BokiFlow.** A latência mediana foi de 26 ms contra 121 ms do Beldi em avaliações de filmes a 200 requisições por segundo (4,7×), e de 18 ms contra 78 ms em viagens a 500 (4,3×). Em relação a uma baseline sem semântica exactly-once, o custo é de 3,0× e 1,8×.
- **BokiStore.** O throughput foi de 1,18 a 1,25× o do MongoDB e as transações foram até 2,3× mais rápidas, mas as leituras não transacionais foram mais lentas.
- **BokiQueue.** O throughput foi de 1,66 a 2,14× o do SQS, com latência até 15× menor, e de 1,06 a 1,23× o do Pulsar, com latência até 2,0× menor.

## Análise crítica

Usar um único mecanismo para ordenação, consistência e reconfiguração é um resultado limpo. Vários limites são declarados no próprio artigo.

- **O replay do log é caro.** Os autores atribuem ao replay do log a lentidão das leituras não transacionais: UserLogin levou 1,47 ms na mediana, contra 0,86 ms do MongoDB. Sem dados auxiliares, o Retwis caiu para 939 Op/s aos três minutos, contra 11.078 com eles, e a tabela não traz resultado para execuções mais longas.
- **A localidade não é automática.** A comparação do BokiStore usou o melhor caso, com índice em todos os 8 nós de função, e ainda assim o artigo diz que "In a large-scale deployment, having all LogBook engines maintain an index for a particular physical log is not viable." Com 25% de leituras locais, o Retwis manteve 77% do throughput máximo.
- **Os dados auxiliares precisaram de um segundo projeto.** Com cache de 16 MB, o throughput caiu para 3.561 Op/s. Guardar uma cópia dos dados auxiliares nos nós de armazenamento o levou de volta a 11.358, o que se afasta do armazenamento mais simples, só no nó de função, descrito na seção de projeto.

Outros limites vêm da leitura da avaliação.

- **O número de destaque tem um oponente específico.** Os 4,7× comparam a latência mediana, em um único ponto de carga, com uma camada de log construída sobre o DynamoDB. Contra MongoDB e Pulsar, os melhores ganhos de latência são de 2,3× e 2,0×, com ganhos de throughput de até 1,25× e 1,23×, e no caso saturado de fila 4:1 o Pulsar tem o melhor p99 nas três configurações, como 12,7 ms contra 27,3 ms.
- **A reconfiguração foi testada sob comando.** O experimento migra para sequenciadores já provisionados. Quedas de nós de armazenamento ou de LogBook engines, e o tempo para detectá-las, não são medidos.
- **A durabilidade do metalog é condicional.** No protótipo, os metalogs "are replicated in the DRAM of sequencer nodes", o que o artigo aceita sob a suposição de que um quórum de sequenciadores continua vivo. Uma perda correlacionada desse quórum fica fora da avaliação.
- **Elasticidade e custo são mais afirmados que testados.** As implantações são medidas em tamanhos fixos, e nem o preço de nós dedicados de armazenamento e de sequenciadores nem a interferência entre LogBooks em um mesmo log físico são medidos.

O [FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing) afirma depois ter throughput de armazenamento e latência de ordenação melhores que os do Boki. Esse é um resultado do próprio FlexLog, na sua configuração camada por camada.

## Pesquisas futuras

- Como um escalonador FaaS deve posicionar funções quando os engines não conseguem indexar todos os logs físicos?
- Quanto custa um metalog durável em comparação com a replicação em DRAM, e quais falhas ele cobriria?
- Checkpoints podem se combinar com dados auxiliares para limitar o replay em objetos muito lidos?
- Como o Boki se comporta com quedas de nós de armazenamento e falhas correlacionadas de sequenciadores?
- Quanto os inquilinos que dividem um log físico interferem uns nos outros, e quanto isso custa em comparação com bancos de dados na nuvem?
