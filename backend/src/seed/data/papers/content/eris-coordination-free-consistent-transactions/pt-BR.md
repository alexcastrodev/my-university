---
title: "Eris: transações consistentes sem coordenação usando controle de concorrência na rede"
summary: O Eris leva a ordenação de transações para a rede do data center por meio de uma primitiva chamada multi-sequencing, de modo que transações independentes fazem commit em uma única ida e volta, sem coordenação entre shards ou réplicas no caso normal.
researchArea: Sistemas distribuídos
keywords: transações distribuídas, controle de concorrência na rede, multi-sequencing, transações independentes, serializabilidade estrita, switches programáveis
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Um sistema de armazenamento ao mesmo tempo particionado e replicado costuma empilhar Paxos para replicação, two-phase commit para atomicidade e two-phase locking para isolamento. Cada camada adiciona rodadas de mensagens, e os locks mantidos bloqueiam transações conflitantes.

Este artigo da Universidade de Washington, publicado no SOSP 2017, se apoia no [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering), que ordenava mensagens para um único grupo de réplicas dentro da rede. Transações precisam de mais: os shards veem conjuntos diferentes de operações, mas têm de aplicar as transações entre shards em uma ordem consistente. O Eris separa a ordenação da execução, deixa a rede estabelecer a ordem e junta replicação e coordenação de transações em um só protocolo. Supõe-se que todos os nós estejam em um mesmo data center.

Vale conhecer antes: two-phase commit, two-phase locking, serializabilidade estrita e o modelo ordered unreliable multicast do NOPaxos.

## Contribuição

- **Multi-sequencing.** O sequenciador mantém um contador por grupo de destino, incrementa atomicamente os de cada mensagem e os escreve no pacote como um multi-stamp. Cada receptor confere o próprio número para descartar pacotes fora de ordem e detectar lacunas. O artigo mostra que uma sequência global única não consegue dizer ao receptor se um número ausente era destinado a ele, e que sequenciadores separados por shard não dão ordem entre shards.
- **Transações independentes em uma ida e volta.** São procedimentos one-shot, sem dependências de dados entre shards, em que cada shard chega sozinho à mesma decisão de commit. O cliente espera uma maioria de cada shard, incluindo o Designated Learner, a única réplica que executa de forma síncrona.
- **O Failure Coordinator.** Um serviço replicado que recupera ou descarta permanentemente transações perdidas e conduz a troca de época depois de uma falha do sequenciador.
- **Transações gerais por cima.** Uma transação preliminar executa as leituras e obtém todos os locks, e uma conclusiva faz commit ou abort. Consultas de reconhecimento tratam conjuntos de leitura e escrita desconhecidos, "precisely as in Calvin". O artigo argumenta que obter os locks em um único passo atômico elimina deadlocks.

## Metodologia

Os autores implementaram o Eris em cerca de 7.500 linhas de C++, com servidores em 9 máquinas e um middlebox Cavium Octeon CN6880 como sequenciador. Os experimentos usaram 15 shards de 3 réplicas, salvo indicação.

A comparação cobre Granola, TAPIR, Lock-Store (two-phase commit, two-phase locking e Multi-Paxos, parecido com o Spanner) e NT-UR, uma referência não transacional e não replicada, todos no mesmo framework C++. As cargas vieram do YCSB+T: SRW em um shard, um MRMW customizado de transações independentes e um CRMW customizado que exige transações gerais. O TPC-C usou 15 warehouses, 10% de transações com vários participantes e o particionamento do H-Store, sem alegar conformidade. Os testes de falha injetaram perdas de pacotes e um failover do sequenciador. O artigo esboça uma prova, com a prova completa e uma especificação TLA+ verificada por model checking em um relatório técnico.

## Resultados

Estes são os resultados relatados pelos autores.

- **TPC-C.** 221 mil transações new-order por segundo: 7,6 vezes o Lock-Store, 6,38 vezes o TAPIR, 2,75 vezes o Granola, e a até 3% do NT-UR.
- **Caso ideal em um shard.** 1,26 milhão de transações por segundo, 4,5 vezes o Lock-Store, 2,9 vezes o TAPIR e 2,5 vezes o Granola. A latência é de 99 μs, de 48% a 72% menor que a dos outros sistemas. Throughput e latência ficam a até 10% do NT-UR.
- **Contenção.** Na carga MRMW mais enviesada, o Eris supera o Lock-Store em 35,0 vezes e o TAPIR em 25,6 vezes.
- **Transações gerais.** Passar de MRMW para CRMW custa 28% do throughput ao Eris e mais de 50% ao Granola.
- **Escala.** Quase perfeita até os 15 shards testados, enquanto uma variante com sequência global escala mal.
- **Resiliência.** Com 1% de perda, o throughput cai cerca de 10%. Com 10%, fica abaixo do Granola. Depois de uma falha do sequenciador, a operação normal volta em 130 ms e o throughput máximo em 300 ms.
- **Capacidade do sequenciador.** O middlebox processa 6,19 milhões de pacotes por segundo, e um end-host 1,61 milhão.
- **Faixa de resumo.** A conclusão dá de 4,5 a 35 vezes o throughput e latência de 72% a 80% menor para transações independentes, e 3,6 vezes para as gerais.

## Análise crítica

O resultado é forte para o que testa: quando as transações cabem no modelo independente, tirar a coordenação do caminho normal compensa claramente. As ressalvas dizem respeito a até onde isso alcança.

O artigo admite vários limites.

- **O modelo é restritivo.** Atualizações condicionais entre shards exigem transações gerais, cujos locks também fazem transações independentes esperar.
- **A execução é single-threaded por shard.** Máquinas multicore podem rodar uma partição por core, ao custo de potencialmente mais transações distribuídas.
- **O sequenciador no switch não foi medido.** O hardware estava "not yet commercially available", então o limite de 116 destinos é uma análise de uma arquitetura proposta.
- **Não é o projeto mais rápido.** Sistemas baseados em RDMA, como FaRM e DrTM, alcançam throughput maior.

O restante é uma leitura das evidências.

- **"Coordination-free" tem alcance estreito.** O termo descreve o caso normal das transações independentes. Toda transação passa por um único sequenciador do sistema inteiro, que limita o protótipo a 6,19 milhões de pacotes por segundo, e a falha dele faz réplicas de todos os shards pararem para uma troca de época.
- **O número do TPC-C é o melhor caso.** O particionamento do H-Store torna toda transação independente, então a camada geral não é exercitada ali.
- **A faixa principal é uma dispersão, não um ganho esperado.** As 35 vezes vêm de um enviesamento extremo em uma carga customizada, o que combina mal com "on standard benchmarks", enquanto o TPC-C dá 7,6 vezes contra o mesmo sistema.
- **Alguns números principais não têm origem declarada.** O texto da seção 8 não informa as 3,6 vezes nem os 80%, e dá de 48% a 72% para a latência. A conclusão também coloca as transações gerais a até 10% da referência, o que esse texto tampouco informa.
- **A comparação é parcial.** O Lock-Store não é o Spanner. Quinze shards de três réplicas somam 45 réplicas em 9 máquinas, logo as réplicas compartilham hardware, e o artigo não descreve como elas são distribuídas.
- **O caminho de falha é pouco testado.** Os testes de perda e de failover rodaram no SRW de um shard, então perdas que exigem acordo entre shards não são estressadas. Falha do Designated Learner, falha de cliente e consultas de reconhecimento não têm medições.

## Pesquisas futuras

- Como o multi-sequencing se comporta em switches reais, e a partir de que fan-out os limites de recursos importam?
- O sequenciador do sistema pode ser particionado mantendo a ordem entre shards?
- Quanto custa uma rodada do Failure Coordinator para perdas em vários shards conforme eles aumentam?
- Como as transações gerais se comportam quando a contenção invalida as consultas de reconhecimento repetidamente?
- Qual o tamanho da classe de cargas reais que cabem em transações independentes sem um particionamento no estilo do TPC-C?
