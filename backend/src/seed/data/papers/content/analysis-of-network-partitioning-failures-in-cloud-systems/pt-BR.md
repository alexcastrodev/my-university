---
title: "Uma análise de falhas por particionamento de rede em sistemas de nuvem"
summary: Um estudo do OSDI 2018 sobre 136 falhas disparadas por partições de rede em 25 sistemas distribuídos muito usados conclui que 80% são catastróficas, 88% exigem isolar só um nó e 29% vêm de partições parciais, e apresenta o NEAT, um framework de injeção de falhas que encontrou 32 falhas novas em sete sistemas.
researchArea: Distributed Systems
keywords: partição de rede, partição parcial, partição simplex, estudo de falhas, injeção de falhas, NEAT, eleição de líder, teorema CAP
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Os autores apresentam um estudo abrangente de 136 falhas de sistemas atribuídas a faltas de particionamento de rede em 25 sistemas distribuídos muito usados. A maioria das falhas teve efeitos catastróficos, como perda de dados, reaparecimento de dados apagados, travas quebradas e quedas do sistema. A maioria se manifesta com facilidade assim que a partição ocorre: exige pouca ou nenhuma ação de clientes, pode ser disparada isolando um único nó e é determinística. Porém, o número de casos de teste a considerar é enorme. Felizmente, os autores identificam características de ordem, tempo e tipo de falha de rede que simplificam bastante o teste. Além disso, boa parte das falhas se deve a falhas de projeto em mecanismos centrais dos sistemas. A maioria poderia ter sido evitada por revisões de projeto e descoberta por testes com injeção de partições. Eles construíram o NEAT, um framework de teste que simplifica a coordenação de vários clientes e injeta diferentes tipos de partição, e o usaram em sete sistemas populares, encontrando e reportando 32 falhas.

## Visão geral

Este artigo do OSDI 2018 (Carlsbad), de Ahmed Alquraan, Hatem Takruri, Mohammed Alfatafta e Samer Al-Kiswany, da Universidade de Waterloo, faz uma pergunta estreita: partições de rede são um problema bem estudado, então por que ainda quebram sistemas em produção? Os autores citam estudos de redes segundo os quais elas ocorrem cerca de uma vez por semana e levam de dezenas de minutos a horas para serem reparadas. O estudo acompanha a falha de ponta a ponta, da sequência de eventos ao efeito visível ao usuário.

O pano de fundo teórico é o teorema CAP de Gilbert e Lynch ([Brewer's Conjecture](/papers/brewers-conjecture-cap-feasibility-web-services)): durante uma partição, é preciso escolher entre disponibilidade e consistência. O artigo não revisita o teorema. Ele mostra que sistemas reais falham mesmo quando a escolha foi feita, por defeitos em eleição de líder, reconfiguração e recuperação. É o irmão, específico para partições, de [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) (citado como Yuan et al.), e segue um método parecido. Contexto do catálogo, pareamento meu e não do artigo: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) trata de falhas que os detectores não percebem, enquanto aqui a premissa que quebra é a do detector: "inalcançável significa que caiu".

## Contribuição

- **Um corpus de 136 falhas em 25 sistemas**, com a sequência de manifestação de cada uma (eventos, ordem, tempo, número de nós, tipo de partição).
- **Treze constatações.** O artigo as apresenta como 13 resultados principais para projetistas, desenvolvedores, testadores e administradores.
- **Uma taxonomia de partições** (completa, parcial, simplex), com o primeiro estudo, até onde os autores sabem, do impacto de partições parciais em sistemas modernos.
- **O NEAT**, um framework de teste em Java que cria e desfaz os três tipos de partição e coordena clientes com uma ordem global de operações.
- **Evidência de que testar é barato:** 32 falhas novas em sete sistemas, com testes de cerca de 30 linhas cada.

## Metodologia

As 136 falhas vêm de três fontes: 88 tickets de rastreadores públicos, 16 relatórios do Jepsen (dos 25 posts do blog do Jepsen, os que tratam dos sistemas estudados) e 32 falhas achadas pelo próprio NEAT. Os 25 sistemas são MongoDB, VoltDB, RethinkDB, HBase, Riak, Cassandra, Aerospike, Geode, Redis, Hazelcast, Elasticsearch, ZooKeeper, HDFS, Kafka, RabbitMQ, MapReduce, Chronos, Mesos, Infinispan, Ignite, Terracotta, Ceph, MooseFS, ActiveMQ e DKron.

Seleção dos tickets: busca por palavras-chave ("network partition", "split-brain", "isolation" e outras), tickets de 2011 em diante, sem prioridade "Minor" ou "Trivial". Falhas que uma simples queda de nó também dispararia foram excluídas, então os dois lados da partição precisam estar rodando. Para cada ticket os autores leram a descrição, os logs, a discussão, o patch e os testes unitários, e reproduziram 24 falhas (13 dos rastreadores, 11 do Jepsen). Dois revisores classificaram cada falha de forma independente. Os limites declarados são a representatividade (25 sistemas), o viés de amostragem para tickets de alto impacto e o erro do observador.

## Resultados

- **Impacto (F1 a F3).** 80% das falhas são catastróficas (perda de dados 26,6%, leitura obsoleta 13,2%, travas quebradas 8,2%, queda ou travamento 8,1%, indisponibilidade 6,6%, reaparecimento de dados apagados 6,6%, corrupção 5,1%, leitura suja 5,1%); a tabela contabiliza 104 de 136. 90% são silenciosas, e 21% deixam dano que persiste depois que a partição se desfaz.
- **Mecanismos (F4).** A eleição de líder aparece em 39,7% das falhas, seguida de mudança de configuração (19,9%), consolidação de dados (14,0%) e roteamento de requisições (13,2%). O defeito de eleição mais comum é a sobreposição entre líderes sucessivos (57,4%), depois a eleição de um líder ruim (20,4%).
- **Tipos de partição (F6).** Completa 69,1%, parcial 28,7%, simplex 2,2%; 99% das falhas precisam de uma única partição. Há exemplos como a alternância de líderes no MongoDB e no Elasticsearch e líderes duplos por causa de um nó que enxerga os dois lados.
- **Acesso de clientes (F5).** 28% não precisam de cliente, 36% só de um lado, 36% dos dois lados.
- **Facilidade de manifestação (F7 a F9).** 12,6% não precisam de nada além da partição. Pela Tabela 7, 83% precisam de no máximo quatro eventos contando a partição; todas as falhas com vários eventos exigem uma ordem específica, mas 84% começam pela partição. 88% se manifestam isolando um nó, 45% isolando qualquer réplica.
- **Tempo e determinismo (F10).** 62% são determinísticas e 18% têm restrições de tempo conhecidas (80% no total); 7% são não determinísticas.
- **Correção (F11).** 47% exigiram redesenhar um mecanismo: falhas de projeto levaram em média 205 dias para serem resolvidas, bugs de implementação 81 dias.
- **Teste (F12 e F13).** Todas as falhas se reproduzem com cinco nós, 83% com três. 93% podem ser reproduzidas por testes com um framework de injeção de falhas.

O NEAT tem 1553 linhas de Java, com um particionador via OpenFlow (152 linhas sobre o Floodlight) ou iptables. Um motor de testes executa a carga via Java RMI. Ele testou Ceph, Ignite, Terracotta, DKron, ActiveMQ, Infinispan e MooseFS e achou 32 falhas, 30 delas catastróficas.

## Análise crítica

Pontos fortes: análise manual e revisada por duas pessoas de tickets reais, limitações declaradas com honestidade e constatações que viram testes (isolar um líder, testar com três nós, emitir operações logo depois da partição).

Limites que o próprio artigo registra: os tickets são enviesados para os importantes, e falhas que uma queda de nó também causaria ficaram de fora, então os percentuais descrevem falhas exclusivas de partição e não todas as quedas. A comparação com Yuan et al. (24% catastróficas) é sinalizada pelos autores como não diretamente comparável.

O que o artigo não afirma: não dá taxas de falha em produção, não mostra que um sistema específico seja inseguro hoje (as versões são de 2018 ou anteriores) e não prova que revisões de projeto teriam pego as falhas. Ele diz apenas "esperamos" que sim. Também não propõe correção para partições parciais, só pede modelos de falha e detectores de falha melhores.

Literatura posterior (marcada como tal): o mesmo grupo publicou "Toward a Generic Fault Tolerance Technique for Partial Network Partitioning" (OSDI 2020). Li apenas o resumo na página da USENIX: um estudo de falhas por partição parcial em 12 sistemas e o Nifty, uma camada de overlay que desvia pacotes em torno de partições parciais. O Jepsen, com que o artigo se compara, é descrito aqui só como o artigo o descreve. Veja também [Metastable Failures](/papers/metastable-failures-in-distributed-systems).

## Pesquisas futuras

Os autores apontam duas direções: estender o NEAT com geradores de carga e de falhas de rede para automatizar o teste, e criar técnicas de tolerância a falhas para partições parciais. Também pedem detectores de falha mais precisos, já que a inalcançabilidade é usada como indício de queda.

Perguntas em aberto, leitura minha e não do artigo: quais das falhas de 2018 ainda se reproduzem nas versões atuais, e como combinar testes direcionados no estilo do NEAT com a verificação de modelos e a verificação em tempo de execução que, segundo os autores, as constatações podem orientar. Trabalho relacionado do catálogo sobre reprodução de falhas: [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems). Base sobre os protocolos envolvidos: [Raft](/papers/raft-understandable-consensus-algorithm) e [Paxos Made Live](/papers/paxos-made-live-engineering-perspective), este último citado pelo artigo a respeito de ajustes em protocolos provados.
