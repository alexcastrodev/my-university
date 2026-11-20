---
title: "Relógios lógico-físicos"
summary: Kulkarni, Demirbas e colegas propõem o relógio lógico híbrido (HLC), um par (l, c) que mantém a garantia de causalidade de Lamport, fica dentro da incerteza de sincronização do relógio NTP e cabe em 64 bits. Atenção: esta análise se baseia na versão do relatório técnico da University at Buffalo, não no texto dos anais do OPODIS 2014.
researchArea: Sistemas distribuídos
keywords: relógios lógicos híbridos, relógios lógicos, relógios físicos, NTP, causalidade, snapshots consistentes, bancos de dados multiversão
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Resumo original, em inglês, da versão do relatório técnico que foi lida (o capítulo dos anais pode redigi-lo de forma diferente):

There is a gap between the theory and practice of distributed systems in terms of the use of time. The theory of distributed systems shunned the notion of time, and introduced "causality tracking" as a clean abstraction to reason about concurrency. The practical systems employed physical time (NTP) information but in a best effort manner due to the difficulty of achieving tight clock synchronization. In an effort to bridge this gap and reconcile the theory and practice of distributed systems on the topic of time, we propose a hybrid logical clock, HLC, that combines the best of logical clocks and physical clocks. HLC captures the causality relationship like logical clocks, and enables easy identification of consistent snapshots in distributed systems. Dually, HLC can be used in lieu of physical/NTP clocks since it maintains its logical clock to be always close to the NTP clock. Moreover HLC fits in to 64 bits NTP timestamp format, and is masking tolerant to NTP kinks and uncertainties. We show that HLC has many benefits for wait-free transaction ordering and performing snapshot reads in multiversion globally distributed databases.

## Visão geral

O artigo saiu no OPODIS 2014 (Lecture Notes in Computer Science 8878, pp. 17-32; o Crossref lista Kulkarni, Demirbas, Madappa, Avva e Leone). **Ressalva importante:** a cópia aberta que foi lida é o relatório técnico da University at Buffalo (cse.buffalo.edu/tech-reports/2014-04.pdf, 13 páginas). O título dele é "Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases" e um autor aparece como "Madeppa". O capítulo dos anais não foi lido e pode diferir do relatório em texto, resultados e numeração.

O ponto de partida é a distância entre a teoria e a prática do tempo. Os [relógios lógicos de Lamport](/papers/lamport-time-clocks-ordering-of-events) capturam o aconteceu-antes, mas não têm relação com o tempo de parede, então um sistema não consegue pedir "o estado às 10h". Relógios físicos sincronizados por NTP têm relação com o tempo de parede, mas seus intervalos de incerteza se sobrepõem, e o artigo cita problemas do NTP como segundos intercalares e atualizações não monotônicas. O TrueTime, usado pelo [Spanner](/papers/spanner-globally-distributed-database), exige GPS e relógios atômicos e faz as transações esperarem a incerteza passar. O artigo também discute os relógios vetoriais, cujo tamanho cresce com o número de nós, e os vetores de versão no estilo do [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store). Convém conhecer os relógios de Lamport e o que o NTP oferece antes de começar.

## Contribuição

- **O relógio lógico híbrido.** Cada nó mantém um par (l, c). O valor l acompanha o máximo do tempo físico visto até agora, e c é um contador limitado usado só para ordenar eventos que têm o mesmo l. Os timestamps são comparados em ordem lexicográfica.
- **Um diagnóstico do projeto ingênuo.** Juntar os dois em um único valor (no recebimento, l = max(l + 1, l da mensagem + 1, pt)) deixa |l - pt| crescer sem limite em um laço de mensagens entre três nós (a Figura 4 do artigo).
- **Propriedades provadas.** Causalidade em um sentido (e hb f implica hlc.e < hlc.f), l nunca abaixo de pt, |l - pt| limitado pela incerteza de sincronização epsilon e um limite para c.
- **Uma codificação compacta.** O timestamp cabe em 64 bits, como os timestamps do NTP, e o HLC só lê o relógio físico, nunca o altera.
- **Mecanismos de resiliência.** Autoestabilização por reinício em (pt, 0) quando os limites são violados e regras para ignorar mensagens fora dos limites.
- **Leituras de snapshot sem espera.** Uma leitura em (l = t, c = 0) devolve um snapshot consistente, com eventos fantasmas virtuais.

## Metodologia

O artigo enuncia quatro requisitos para um timestamp l.e: causalidade, O(1) inteiros, espaço limitado e proximidade de pt.e. Ele apresenta o algoritmo ingênuo, um contraexemplo e depois o algoritmo HLC (Figura 5): em um evento de envio ou local, l vira max(l anterior, pt) e c é incrementado se l não mudou, senão volta a 0. No recebimento, l vira max(l anterior, l da mensagem, pt) e c é definido conforme l seja igual ao valor anterior, ao valor da mensagem, a ambos ou a nenhum.

A correção é por prova (Teoremas 1 a 4 e Corolários 1 a 4), com epsilon como o limite assumido para a incerteza de sincronização dos relógios. A avaliação tem duas partes. Primeiro, uma implantação real em instâncias m1.xlarge da Amazon AWS (Ubuntu 14.04, sincronizadas com o servidor stratum 2 0.ubuntu.pool.ntp.org), em que todos os nós enviam mensagens TCP uns aos outros continuamente, com 75.000 a 425.000 mensagens no total, em execuções de 4, 8 e 16 nós em uma região e uma execução WAN de 4 nós entre Irlanda, US East, US West e Tóquio. Segundo, simulações com um evento por milissegundo, deriva epsilon de 10 ms a 100 ms, e com stragglers (relógios atrasados) e rushers (relógios adiantados) adicionados.

## Resultados

- **Teorema 1:** e hb f implica (l.e, c.e) < (l.f, c.f). **Teorema 2:** l.f é pelo menos pt.f. **Teorema 3:** se l.f > pt.f, existe um evento g com g hb f e pt.g = l.f. **Corolário 1:** |l.f - pt.f| é no máximo epsilon.
- **Limites para c.** O Corolário 3 dá c.f no máximo N * (epsilon + 1), supondo que o relógio físico avance pelo menos um entre dois eventos de um nó. Se a transmissão de mensagens for longa o bastante para os relógios avançarem pelo menos d, o Corolário 4 dá c.f no máximo epsilon / d + 1.
- **Tamanho.** l guarda os 48 bits mais significativos de pt (arredondado para cima, granularidade de microssegundo) e c fica com 16 bits, podendo chegar a 65536.
- **4 nós:** c nunca passou de 3 (offset de 5 ms: c = 0 em 83,90% dos eventos, c = 1 em 12,12%). O máximo de l - pt foi 21,7 ms com offset de 5 ms e 20,3 ms com 1,5 ms.
- **8 nós:** com offset de 9 ms, c chegou a 9 (0,03%) e o máximo de l - pt foi 107,9 ms; com offset de 3 ms, c foi só 0 (91,18%) ou 1 (8,82%) e o máximo de l - pt foi 7,4 ms.
- **16 nós:** com offset de 16 ms, c chegou a 7 (0,02%), o máximo de l - pt foi 90,5 ms (percentil 90: 25,2 ms); com offset de 6 ms o máximo foi 46,8 ms.
- **WAN:** com offset de 3 ms, c = 0 em cerca de 95% dos eventos e o máximo de l - pt foi cerca de 0,02 ms, porque os atrasos de mensagem superam epsilon.
- **Simulação:** c foi pouco dependente de epsilon e ficou em 4 ou menos em mais de 99% dos eventos. Um straggler na borda da deriva permitida chegou a c = 97, e um até 5 epsilon atrasado chegou a 514, ambos apenas no próprio nó straggler. Os rushers deram c máximo de 8.

## Análise crítica

- **Relatório técnico, não os anais.** Todos os números acima vêm do relatório. A versão dos anais pode ter experimentos ou afirmações revisados.
- **Os limites dependem de suposições.** O limite de epsilon depende de a restrição de sincronização dos relógios valer. O artigo trata as violações com reinícios e mensagens ignoradas, que são medidas de projeto e não garantias provadas. O limite mais justo para c exige uma suposição sobre o atraso das mensagens em relação ao avanço dos relógios.
- **Sem avaliação ponta a ponta em um banco de dados.** Os experimentos medem só c e l - pt. Nada mede vazão de transações, latência de leitura ou um sistema como o Spanner, então o benefício de "não esperar" é argumentado, não medido.
- **Não substitui o TrueTime.** O artigo observa que o commit-wait do Spanner dá consistência externa (serializabilidade estrita). O HLC sozinho dá causalidade em um só sentido; o artigo diz que a consistência externa poderia ser obtida com uma "client-notification-wait" depois do fim da transação, em um parágrafo e sem avaliação. O artigo usa "valores de HLC iguais implicam eventos concorrentes" para os snapshots, mas afirma causalidade só em um sentido (a recíproca não vale, como nos relógios de Lamport).
- **Cenário.** As implantações usam um único provedor de nuvem, e o pior caso com straggler (c = 514) é bem maior que o caso típico.
- **Literatura posterior (marcada como tal).** A documentação do CockroachDB (lida em 2026-11-20) diz que ele usa relógios lógicos híbridos, com timestamps atualizados a partir do tempo HLC enviado nas requisições, e aponta para este mesmo relatório como "the HLC paper". Ela também afirma que um desvio além do limite configurado pode violar a linearizabilidade de chave única entre transações causalmente dependentes, o que combina com os limites acima. Não verifiquei afirmações sobre o MongoDB ou outros sistemas.

## Pesquisas futuras

- Comparar o HLC com o [TrueTime do Spanner](/papers/spanner-globally-distributed-database) em cargas reais, incluindo o custo do commit-wait.
- Sistemas que exploram relógios sincronizados para ordenar, como o [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks).
- Consistência causal em serviços georreplicados, por exemplo [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) e [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Ler a versão dos anais e compará-la com o relatório.
- Voltar aos [relógios de Lamport](/papers/lamport-time-clocks-ordering-of-events) como a base que o HLC estende.
