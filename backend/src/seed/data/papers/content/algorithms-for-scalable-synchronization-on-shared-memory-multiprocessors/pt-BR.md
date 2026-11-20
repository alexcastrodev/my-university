---
title: "Algoritmos para sincronização escalável em multiprocessadores de memória compartilhada"
summary: Mellor-Crummey e Scott mostram que locks e barreiras com espera ocupada não precisam gerar contenção de memória nem de interconexão se cada processador girar em uma flag localmente acessível, e apresentam o lock de fila MCS e uma barreira em árvore, medidos em um Sequent Symmetry e em um BBN Butterfly.
researchArea: Sistemas operacionais
keywords: spin lock, lock MCS, lock de fila, sincronização por barreira, espera local, contenção, fetch-and-store, compare-and-swap, multiprocessador de memória compartilhada
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Técnicas de espera ocupada são muito usadas para exclusão mútua e sincronização por barreira em programas paralelos de memória compartilhada. Infelizmente, implementações típicas de espera ocupada tendem a produzir grandes quantidades de contenção de memória e de interconexão, criando gargalos de desempenho que se acentuam à medida que as aplicações crescem. Argumentamos que esse problema não é fundamental e que é possível construir algoritmos de sincronização com espera ocupada que não induzem contenção de memória nem de interconexão. A chave desses algoritmos é que cada processador gire em variáveis-flag separadas e localmente acessíveis, e que algum outro processador encerre a espera com uma única escrita remota no momento apropriado. As flags podem ser localmente acessíveis por causa do cache coerente ou por estarem alocadas na parte local da memória fisicamente distribuída.

Apresentamos um novo algoritmo escalável de spin lock que gera O(1) referências remotas por aquisição do lock, independentemente do número de processadores que tentam adquiri-lo. O algoritmo tem latência razoável na ausência de contenção, exige espaço constante por lock e não exige suporte de hardware além de uma instrução de troca com a memória. Apresentamos também um novo algoritmo escalável de barreira que gera O(1) referências remotas por processador que chega à barreira, e observamos que duas barreiras já conhecidas também podem ser reescritas de modo a girar apenas em flags localmente acessíveis. Nenhum desses algoritmos de barreira exige hardware além da atomicidade usual de leituras e escritas de memória.

Comparamos o desempenho dos nossos algoritmos escaláveis com outras abordagens de software para sincronização com espera ocupada em um Sequent Symmetry e em um BBN Butterfly. Nossa principal conclusão é que a contenção causada por sincronização não precisa ser um problema em multiprocessadores de memória compartilhada de grande escala. A existência de algoritmos escaláveis enfraquece bastante o argumento a favor de suporte de hardware especial e caro para sincronização, e é um argumento contra as chamadas arquiteturas "dance hall", em que as posições de memória compartilhada ficam à mesma distância de todos os processadores.

## Visão geral

Este artigo de 1991 da ACM Transactions on Computer Systems, de Rice e da University of Rochester, é a origem do lock MCS (nome vindo das iniciais dos autores). Ele é de uma época de máquinas com de poucos a algumas centenas de processadores, quando muitos pesquisadores esperavam que pontos quentes de sincronização exigissem hardware especial: redes com combinação, variáveis de sincronização nos switches ou filas de lock nos controladores de cache. O artigo cita uma simulação de Agarwal e Cherian em que a sincronização respondia por até 49% do tráfego de rede em uma máquina "dance hall" de 64 processadores. A resposta dele é de software: se muitos processadores consultam uma única variável, o tráfego se acumula ali, então cada processador recebe a sua variável e uma única escrita o acorda.

A mesma preocupação aparece no catálogo. [An Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores) encontra um spin lock derrubando o Exim com 48 cores, e o [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) combina locks de leitura, spin locks e RCU. O [Read Copy Update](/papers/read-copy-update-mckenney-ols-2002) ataca a contenção de outro modo, tirando os locks dos leitores. O [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) verifica locks ticket e MCS. O [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) evita o estado compartilhado por completo.

Vale conhecer antes: test-and-set, coerência de cache e invalidação, memória local versus remota no estilo NUMA, e por que um processador que espera girando consome banda do barramento ou da rede.

## Contribuição

- **O lock MCS.** Cada processador enfileira um `qnode` (ponteiro para o próximo e uma flag `locked`) em memória local a ele. O lock guarda um ponteiro para o fim da fila. O acquire faz um `fetch_and_store` do próprio nó no fim da fila e, se havia um predecessor, liga-se atrás dele e gira na própria flag. O release passa o lock ao sucessor com uma única escrita. A ordem é FIFO, o espaço por lock é constante e há O(1) transações de rede por aquisição, com ou sem caches coerentes.
- **O compare-and-swap é opcional.** Com ele, quem libera e não vê sucessor troca o fim da fila de volta para nil. Sem ele, a Figura 7 conserta a fila com `fetch_and_store` extras, ao custo da ordem FIFO estrita (as aquisições continuam "muito próximas de FIFO na prática", com risco teórico de inanição).
- **Uma barreira em árvore.** Duas árvores de P nós: chegada com fan-in 4 e despertar com fan-out 2. Cada processador gira apenas em uma flag posicionada estaticamente no próprio nó, usando só leituras e escritas. São 2P-2 transações de rede, que o artigo argumenta ser o mínimo sem broadcast, e O(log P) no caminho crítico.
- **Espera local para barreiras antigas.** A barreira de disseminação (Hensgen, Finkel e Manber) e uma barreira de torneio com árvore de despertar são reescritas para que toda flag seja atribuída estaticamente e local. O artigo também introduz o backoff proporcional para o lock ticket e para a barreira centralizada.

## Metodologia

Os algoritmos são dados em pseudocódigo e comparados por transações de rede, caminho crítico, espaço e operações atômicas exigidas. As implementações foram medidas em um BBN Butterfly 1 (memória distribuída, sem caches coerentes, nós MC68000 de 8 MHz, leitura remota de cerca de 4 microssegundos, aproximadamente cinco vezes uma local; testes até 80 processadores) e em um Sequent Symmetry Model B (barramento compartilhado, caches com snooping, 80386 de 16 MHz, até 30 processadores; gráficos até 18). Cada ponto é a média de muitas operações: 10^5 aquisições de lock no Butterfly, 10^6 no Symmetry, 10^5 barreiras nas duas, com interrupções desabilitadas ou processos presos a processadores. Nenhuma das máquinas tem compare-and-swap, então o lock MCS foi medido com o release da Figura 7. A latência da rede também foi sondada cronometrando o acesso à interface de rede de cada nó. O código foi oferecido por ftp anônimo. O argumento de corretude é só esboçado, com os detalhes em um relatório técnico.

## Resultados

Todos os números vêm do texto e das tabelas do artigo. As inclinações vêm de regressão linear sobre os tempos do Butterfly.

- **Spin locks, Butterfly.** O tempo por acquire/release cresce 7,4 microssegundos por processador extra no test-and-set, 7,0 no lock ticket sem backoff e 5,0 no test-and-set com backoff linear. O lock em array de Anderson cresce 0,4. Excluindo execuções com menos de 10 processadores, o test-and-set com backoff exponencial, o ticket com backoff proporcional e o MCS crescem 0,025, 0,021 e 0,00025 microssegundo por processador.
- **Spin locks, Symmetry.** O test-and-test-and-set escala pior. O MCS, o lock de Anderson e o test-and-set com backoff exponencial escalam extremamente bem, com desempenho absoluto comparável, com seção crítica de 6,48 microssegundos. O MCS mostra um pico com dois processadores, que os autores ligam à falta de compare-and-swap.
- **Latência sem contenção (Tabela I).** Butterfly: 34,9 (test-and-set), 38,7 (ticket), 65,7 (Anderson), 71,3 (MCS) microssegundos. Symmetry: 7,0, não se aplica, 10,6, 9,2. No TC2000, 8,1 contra 12,2 microssegundos para test-and-set e MCS.
- **Impacto na rede (Tabela II).** Com 60 processadores no Butterfly, a latência subiu no nó do lock 1420% (test-and-set), 992 (ticket), 75 (Anderson) e 4 (MCS), e em um nó ocioso 96, 97, 67 e 2.
- **Barreiras, Butterfly.** A melhor barreira centralizada (atraso proporcional) levou mais de 1,4 ms com 80 processadores. As barreiras em árvore, de torneio e de disseminação crescem de forma logarítmica. O torneio exige 2⌈log2 P⌉ rodadas contra ⌈log2 P⌉ da disseminação, cerca de duas vezes mais lento, e a árvore fica no meio.
- **Barreiras, Symmetry.** A disseminação exige O(P log P) transações de barramento e perde para as outras quatro com P > 8. Uma barreira centralizada com inversão de sentido é a mais rápida abaixo das maiores contagens de processadores testadas, enquanto a árvore de chegada com flag central de despertar vence para P grande, na extrapolação dos autores.
- **Por que a localidade importa.** Forçar toda a espera a passar pela rede no Butterfly somou 27,8 (árvore) e 9,4 (disseminação) microssegundos por processador, fatores de 11,8 e 6,8 com 84 processadores. Tabela III: com 60 processadores, a latência de rede subiu 10 e 18% com espera local e 124 e 117% com espera pela rede.
- **Hardware.** No Symmetry, mecanismos especiais como o QOLB dificilmente superariam o MCS em mais de 30%.

## Análise crítica

O artigo é cuidadoso quanto ao escopo, e vários limites são dele mesmo.

- **Instruções atômicas exigidas.** O MCS precisa de `fetch_and_store`. As barreiras precisam só de leituras e escritas. As operações atômicas de 16 bits do Butterfly não comportavam ponteiros de 24 bits, então o MCS usou índices de array. As atômicas do Butterfly eram caras, o que infla os números de latência dele.
- **Justiça e preempção.** Locks FIFO desperdiçam CPU se um processo que espera girando for preemptado. O artigo cita coscheduling, ou um lock test-and-set com backoff exponencial, como remédios, e não mede nenhum dos dois.
- **Os resultados das barreiras dependem da máquina.** As recomendações dele diferem para máquinas com broadcast coerente, com diretório e sem cache, e a barreira centralizada é a que melhor se adapta quando o número de processadores muda.

O que o artigo não afirma: nada sobre hierarquias de cache de vários níveis, NUMA multi-soquete ou máquinas desta década. As máquinas descritas têm no máximo 256 nós simples (Butterfly) ou 30 processadores com um cache cada (Symmetry). Meus próprios limites: resultados só em curva (os gráficos do Butterfly além das inclinações e do valor de 1,4 ms que o texto dá) não são citados aqui, e a prova de corretude, que fica em um relatório técnico, não estava disponível para mim.

Literatura posterior (não faz parte do artigo, e minhas checagens são limitadas). Li o artigo de Corbet na LWN de 2014, "MCS locks and qspinlocks", por meio de um trecho obtido por busca, não o código-fonte do kernel. Ele diz que os locks MCS não foram usados nos spinlocks gerais do Linux porque os spinlocks ticket cabem em 32 bits e o MCS não, e que o qspinlock mantém um array por CPU de quatro nós MCS. A página do catálogo sobre o CertiKOS relata um custo sem contenção de 34 ciclos para o lock ticket contra 74 para o MCS na máquina dele, que tomei dessa página sem ler o original. Não li a literatura de locks cientes de NUMA, então não faço afirmações sobre ela. Uma linha de trabalho diferente e posterior (2013) é [The Scalable Commutativity Rule](/papers/the-scalable-commutativity-rule). Pela análise dela no catálogo, ela pergunta quando uma interface permite uma implementação cujas operações não escrevem em nenhuma linha de cache que outro core lê ou escreve, e relata o Linux 3.8 sem conflitos em 68% de 13.664 testes gerados de 18 chamadas POSIX e o kernel sv6 dos autores em 99%. Essa página não discute locks MCS, então a relação entre os dois é leitura minha: um lock como o MCS barateia o compartilhamento inevitável, enquanto a regra diz quando a interface nem precisa compartilhar.

## Pesquisas futuras

- Como filas no estilo MCS se comportam quando os que esperam são preemptados, em sistemas virtualizados ou superalocados, o que o artigo só menciona.
- Locks que mantenham a espera local do MCS e ainda caibam no tamanho compacto de palavra que os kernels exigem.
- Repetir a comparação Butterfly versus Symmetry em máquinas atuais de vários soquetes e hierarquias profundas de cache.
- Provas verificadas por máquina dos algoritmos de lock e barreira, como as do CertiKOS, no lugar do argumento esboçado.
