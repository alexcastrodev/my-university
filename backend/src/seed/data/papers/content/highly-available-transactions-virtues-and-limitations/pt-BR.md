---
title: "Transações altamente disponíveis: virtudes e limitações"
summary: Bailis e colegas classificam quais níveis de isolamento transacional e modelos de consistência de réplicas podem ser oferecidos com alta disponibilidade, isto é, sem coordenação síncrona entre réplicas mesmo sob partição, e quais não podem, e depois medem um protótipo na EC2 para mostrar a diferença de latência frente a projetos coordenados.
researchArea: Sistemas distribuídos
keywords: transações altamente disponíveis, disponibilidade pegajosa, isolamento fraco, Read Committed, Monotonic Atomic View, consistência causal, teorema CAP, geo-replicação
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

To minimize network latency and remain online during server failures and network partitions, many modern distributed data storage systems eschew transactional functionality, which provides strong semantic guarantees for groups of multiple operations over multiple data items. In this work, we consider the problem of providing Highly Available Transactions (HATs): transactional guarantees that do not suffer unavailability during system partitions or incur high network latency. We introduce a taxonomy of highly available systems and analyze existing ACID isolation and distributed data consistency guarantees to identify which can and cannot be achieved in HAT systems. This unifies the literature on weak transactional isolation, replica consistency, and highly available systems. We analytically and experimentally quantify the availability and performance benefits of HATs, often two to three orders of magnitude over wide-area networks, and discuss their necessary semantic compromises.

## Visão geral

Por volta de 2013, os armazenamentos chave-valor que substituíram os SGBDs transacionais (o Dynamo e seus parentes) abriram mão de transações com vários itens para continuar disponíveis e rápidos, e o CAP costumava ser lido como se ACID e disponibilidade não pudessem coexistir. O artigo diz que o CAP é mais estreito: como provado na [formalização de Gilbert e Lynch](/papers/brewers-conjecture-cap-feasibility-web-services), ele trata de [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects), não de todas as propriedades ACID. A pergunta é: que semânticas transacionais um sistema consegue oferecer quando todo servidor que não falhou responde a toda requisição sem esperar outros servidores, mesmo em partições indefinidas? Isso também dá baixa latência, já que ninguém espera uma ida e volta de longa distância.

Esta nota parte da versão de 12 páginas do VLDB (PVLDB 7(3), pp. 181-192, apresentada na VLDB 2014). A versão estendida do arXiv (1302.0309, 17 páginas) traz as definições formais e o pseudocódigo dos algoritmos; li o pseudocódigo do MAV, mas não as provas dos apêndices. Os autores se apoiam nas definições de isolamento de Adya e de Berenson et al. ([Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)). O artigo também cita o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), o [Spanner](/papers/spanner-globally-distributed-database), o [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) e o [artigo do apóstata de Helland](/papers/life-beyond-distributed-transactions-an-apostates-opinion).

Vale conhecer antes: Read Committed, Repeatable Read, Snapshot Isolation e serializabilidade, as anomalias Lost Update e Write Skew e as garantias de sessão (leituras monotônicas, read your writes).

## Contribuição

- **Uma taxonomia de disponibilidade.** Alta disponibilidade (Gilbert e Lynch): todo usuário que alcança um servidor sem falha recebe resposta, sem coordenação, então um sistema de quórum por maioria conta como indisponível. Disponibilidade pegajosa (sticky): vale só enquanto o cliente continua falando com uma cópia do banco que reflete suas operações anteriores. Disponibilidade transacional: dada uma réplica para cada item, a transação acaba confirmando (talvez após novas tentativas) ou aborta por escolha própria, o que exclui o sistema trivial que aborta tudo.
- **Classificação dos modelos existentes.** A Tabela 3 e a Figura 2 separam os modelos em altamente disponíveis, pegajosos e indisponíveis. Os autores dizem que, até onde sabem, é a primeira unificação de isolamento transacional, consistência distribuída e garantias de sessão.
- **Algoritmos de prova de conceito.** Construções para Read Committed, cut isolation, MAV e as garantias de sessão (viabilidade, "não necessariamente ótimas nem eficientes"), mais um algoritmo de MAV eficiente.
- **Argumentos de impossibilidade** para Lost Update, Write Skew e limites de atualidade, e uma análise do TPC-C sobre quais transações cabem.

## Metodologia

O artigo combina três coisas. Primeiro, um estudo de medição: uma semana de pings entre regiões da EC2 (o texto fala em sete, a Tabela 1c lista oito), entre três zonas de disponibilidade e dentro de uma zona. Segundo, análise: cada modelo é definido de modo informal, com um exemplo mínimo, e recebe um algoritmo disponível ou um argumento de que uma partição força uma violação. Terceiro, um protótipo: um chave-valor particionado por hash, sobre LevelDB, escrito em Java com Apache Thrift, com servidores agrupados em clusters (cada um uma cópia completa, cinco instâncias m1.xlarge) e clientes presos a um cluster. Roda o YCSB com 8 operações por transação, 50% de leituras e 50% de escritas, 100.000 chaves, valores de 1KB, 180 segundos por configuração. Compara eventual (Read Uncommitted com last-writer-wins e anti-entropia todos-com-todos), RC (eventual com buffer de escritas), MAV e master (toda operação de uma chave vai para uma réplica mestre, linearizável por chave).

## Resultados

**Taxonomia (Tabela 3).**
- **Altamente disponíveis:** Read Uncommitted, Read Committed, Monotonic Atomic View, Item Cut Isolation, Predicate Cut Isolation, Writes Follow Reads, Monotonic Reads, Monotonic Writes. A convergência (consistência eventual) também é alcançável.
- **Pegajosos:** Read Your Writes, PRAM, consistência causal. A prova: um cliente que escreve numa réplica particionada e depois alcança outra não consegue ficar disponível e ainda ler a própria escrita.
- **Indisponíveis:** Cursor Stability, Snapshot Isolation (inclusive Parallel SI), Repeatable Read e serializabilidade de cópia única (todos exigem prevenir Lost Update ou Write Skew), além de atualidade, safe, regular, linearizável e strong 1SR (qualquer limite de atualidade é quebrado por uma partição longa). Durabilidade contra F falhas também exige F+1 réplicas alcançáveis.

Combinando todas as garantias HA e pegajosas, tem-se leituras de snapshot transacionais e causalmente consistentes (a Figura 2 mostra 144 combinações de HAT).

**Algoritmos.** RC: o cliente guarda as escritas até o commit (ou o servidor as esconde), um timestamp por transação, last-writer-wins. MAV: a réplica só revela uma escrita quando todas as réplicas das outras escritas da transação já a têm ("pending stable"); as escritas levam o timestamp da transação e a lista de chaves irmãs, e as leituras enviam um timestamp como limite inferior. É sem mestre e nunca bloqueia por coordenação entre réplicas.

**Rede (Seção 2).** A ida e volta dentro de um datacenter é de 1,82 a 6,38 vezes mais rápida que entre zonas de disponibilidade e de 40 a 647 vezes mais rápida que entre regiões. De São Paulo a Singapura a média foi 362,8 ms (percentil 95: 649 ms), contra 106,7 ms no limite da velocidade da luz. Um estudo da Microsoft de 2011 achou média de 40,8 falhas de enlace por dia.

**Isolamento fraco na prática.** Dos 18 bancos pesquisados, só 3 usam serializabilidade como padrão e 8 nem a oferecem.

**TPC-C.** Order-Status e Stock-Level (só leitura) e Payment (só incrementos e acréscimos) cabem em HATs, e condições do tipo chave estrangeira se mantêm com MAV. O New-Order consegue IDs únicos, mas não os sequenciais exigidos, e o delete idempotente do Delivery exige prevenir Lost Update (o artigo sugere compensação no mundo real).

**Experimentos.**
- Dois clusters no mesmo datacenter: o master tem cerca de metade da vazão e o dobro da latência do eventual; RC é quase idêntico ao eventual; MAV chega a cerca de 75% da vazão.
- Dois clusters nos Estados Unidos continentais: a latência do master é em média 300 ms por transação (cerca de 37 ms por operação). Com cinco clusters em cinco datacenters chega a quase 800 ms, e uma variante de quórum estilo Dynamo (termina quando a maioria responde) não melhorou muito.
- Entre dois datacenters, eventual, RC e MAV ficam como no datacenter único. O artigo estima a vantagem dos algoritmos HAT em WAN em latência 10 a 100 vezes menor.
- O custo do MAV cresce com o tamanho da transação: até 18% abaixo do eventual com 1 operação (34 bytes de metadados) e até 60% abaixo com 128 operações (1898 bytes). Com 99,8% de leituras o custo é 7%.
- Escala de 5 para 25 servidores por cluster: cerca de 5x para eventual e RC, 3,8x para MAV (mais de 260.000 operações por segundo) e 4,25x para MAV em memória.
- Com cinco clusters, o MAV estagnou em cerca de metade do eventual (IOPS de disco e custo da anti-entropia), e a menos de 20% com armazenamento em memória.

## Análise crítica

Os autores declaram vários limites. Os algoritmos são provas de existência, não sistemas ajustados. O MAV paga metadados proporcionais ao tamanho da transação. O two-phase locking foi omitido porque a versão de livro-texto foi pior que o master, e a afirmação sobre o Calvin é só uma expectativa. HATs expõem mais anomalias que um banco de nó único sob isolamento fraco, sobretudo durante partições, e nenhum modelo alcançável impede atualizações concorrentes.

Os pontos a seguir são uma leitura do artigo, não afirmações dos autores.

- **As provas de indisponibilidade dependem de uma única definição de disponibilidade.** Ela exclui quóruns por maioria e respostas "com alta probabilidade" (nota 2). É a definição estrita de Gilbert e Lynch, então "não é HAT" não significa "inutilizável na prática": um sistema de quórum por maioria continua servindo enquanto uma maioria for alcançável.
- **A disponibilidade é argumentada, não medida.** O texto não descreve experimento que injete partições. Os experimentos medem latência e vazão com enlaces saudáveis.
- **O fator de destaque varia entre as seções.** O abstract diz duas a três ordens de grandeza, a introdução uma a três, a Seção 6.3 diz 10 a 100 vezes. O primeiro parece apoiado nas razões de RTT da Tabela 1, os outros na comparação com o master.
- **A linha de base master é fraca.** É um mestre único designado ao acaso, com linearizabilidade por chave, não um sistema transacional, então os números não medem uma alternativa serializável.
- **O resumo do TPC-C é inconsistente.** A Seção 6.2 primeiro chama o Payment de monotônico e sem problema, depois o resumo lista New-Order e Payment como o par problemático, enquanto o texto cita New-Order e Delivery. A frase sobre durabilidade está impressa como "F > 1".
- **Literatura posterior, marcada como tal.** De cada item abaixo li só o resumo do Crossref. O [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) (Hellerstein e Alvaro, 2020) dá a explicação por monotonicidade de quais programas dispensam coordenação, a partir do trabalho com Bloom que este artigo cita para "logicamente monotônico". "Coordination Avoidance in Database Systems" (Bailis et al., PVLDB 8(3), 2014) propõe a invariant confluence, condição necessária e suficiente para execução segura sem coordenação de uma aplicação. "Scalable Atomic Visibility with RAMP Transactions" (SIGMOD 2014) nomeia o isolamento Read Atomic para visibilidade atômica multipartição. O Elle (Kingsbury e Alvaro, PVLDB 14(3), 2020) é um verificador que infere grafos de dependência estilo Adya a partir de históricos observados para achar anomalias de isolamento em bancos reais.

## Pesquisas futuras

- A lista do próprio artigo: como combinar semânticas HAT e não HAT, usadas com parcimônia, e que arquitetura sustenta o híbrido; escrow e suposições de assincronia limitada para semânticas mais ricas; semântica forte sem partição e mais fraca durante uma.
- Algoritmos de MAV mais baratos, sem metadados proporcionais ao tamanho da transação (os autores dizem estar investigando), e quais invariantes de aplicação sobrevivem às anomalias dos HATs, ponto de partida do trabalho posterior sobre invariant confluence.
- Testar bancos reais contra os níveis de isolamento que afirmam ter, o problema a que o Elle se dedica.
