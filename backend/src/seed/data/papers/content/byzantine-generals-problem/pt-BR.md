---
title: "O problema dos generais bizantinos"
summary: O artigo que dá nome e resolve o problema de chegar a um acordo quando componentes defeituosos podem enviar informações conflitantes a partes diferentes de um sistema, provando que mensagens orais exigem que mais de dois terços dos participantes sejam leais e que assinaturas infalsificáveis eliminam esse limite.
researchArea: Sistemas distribuídos
keywords: falhas bizantinas, consistência interativa, acordo, mensagens orais, mensagens assinadas, tolerância a falhas, votação por maioria
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Reliable computer systems must handle malfunctioning components that give conflicting information to different parts of the system. This situation can be expressed abstractly in terms of a group of generals of the Byzantine army camped with their troops around an enemy city. Communicating only by messenger, the generals must agree upon a common battle plan. However, one or more of them may be traitors who will try to confuse the others. The problem is to find an algorithm to ensure that the loyal generals will reach agreement. It is shown that, using only oral messages, this problem is solvable if and only if more than two-thirds of the generals are loyal; so a single traitor can confound two loyal generals. With unforgeable written messages, the problem is solvable for any number of generals and possible traitors. Applications of the solutions to reliable computer systems are then discussed.

## Visão geral

Este artigo de Leslie Lamport, Robert Shostak e Marshall Pease, do SRI International, saiu no ACM Transactions on Programming Languages and Systems em julho de 1982 (foi recebido em 1980). Ele nasce do trabalho com computadores tolerantes a falhas, em que a única forma conhecida de construir um sistema confiável era rodar vários processadores sobre a mesma entrada e tomar um voto majoritário. Isso só funciona se todo processador saudável enxerga a mesma entrada, e uma unidade de entrada defeituosa pode mostrar valores diferentes a processadores diferentes. O artigo dá a essa falha um nome e uma forma abstrata limpa: um general comandante precisa enviar uma ordem a seus tenentes, e alguns deles, possivelmente o próprio comandante, podem ser traidores.

É a origem do termo falha bizantina, o modelo em que um nó defeituoso pode fazer qualquer coisa, inclusive mentir de forma diferente para cada par. Os algoritmos de falha por parada do catálogo, como [Paxos simplificado](/papers/paxos-made-simple) e [Raft](/papers/raft-understandable-consensus-algorithm), assumem que ninguém mente. O artigo que prova que nenhum protocolo determinístico garante acordo em um sistema assíncrono com até uma única falha por parada, [Impossibilidade de consenso distribuído com um processo defeituoso](/papers/flp-impossibility-of-distributed-consensus), remete a este para o caso síncrono. Para o lado da ordenação dessa mesma linha de pesquisa, veja [Tempo, relógios e a ordenação de eventos em um sistema distribuído](/papers/lamport-time-clocks-ordering-of-events).

Vale conhecer antes: votação por maioria, a diferença entre um sistema de mensagens confiável e um que não é, e a ideia de assinaturas de chave pública.

## Contribuição

- **O enunciado do problema.** O comandante envia uma ordem, e duas condições de consistência interativa precisam valer: IC1, todos os tenentes leais obedecem à mesma ordem, e IC2, se o comandante é leal, todo tenente leal obedece à ordem dele. A entrada de cada general é distribuída assim, de modo que todos os generais leais terminam com o mesmo vetor de valores.
- **Impossibilidade com mensagens orais.** Com três generais, nenhuma solução resiste a um traidor, e com mensagens orais nenhuma solução com menos de 3m + 1 generais tolera m traidores. Concordar só de forma aproximada, por exemplo em um horário de ataque com diferença de até 10 minutos, é mostrado como igualmente difícil.
- **Algoritmo OM(m).** Um algoritmo recursivo de mensagens orais que funciona com 3m + 1 ou mais generais e no máximo m traidores.
- **Algoritmo SM(m).** Com mensagens assinadas infalsificáveis, funciona para qualquer número de generais e no máximo m traidores.
- **Redes incompletas.** O OM se estende a grafos 3m-regulares, e o SM funciona desde que os generais leais formem um subgrafo conexo.
- **Dos generais aos computadores.** Uma discussão do que um sistema real precisa oferecer para que as hipóteses sobre mensagens valham: timeouts, relógios sincronizados e assinaturas.

## Metodologia

O artigo é um argumento matemático, sem experimentos. As hipóteses das mensagens orais são explícitas: toda mensagem enviada é entregue corretamente (A1), o receptor sabe quem a enviou (A2) e a ausência de uma mensagem pode ser detectada (A3). Um traidor não consegue forjar nem bloquear mensagens entre outros generais, mas pode dizer qualquer coisa nas suas. O resultado de impossibilidade é argumentado com dois cenários que parecem idênticos para um tenente, e depois estendido a 3m generais fazendo cada um de três generais simular no máximo m dos outros.

No OM(m), o comandante envia seu valor, depois cada tenente age como comandante do OM(m - 1) para os demais, e por fim cada tenente toma a maioria dos valores que recebeu. A correção vem de um lema sobre a IC2 e de uma indução em m (Teorema 1). O SM(m) acrescenta uma quarta hipótese, A4: a assinatura de um general leal não pode ser forjada e qualquer um pode verificá-la. Os tenentes coletam o conjunto de ordens assinadas que viram, repassam as novas e aplicam uma função de escolha determinística (Teorema 2). O Teorema 4 estende isso a grafos arbitrários por meio do diâmetro do subgrafo dos leais.

## Resultados

- **O limite de 3m + 1 é justo para mensagens orais.** O OM(m) satisfaz IC1 e IC2 com mais de 3m generais e no máximo m traidores, e não existe solução com menos. Com três generais e um traidor, mensagens assinadas funcionam: um comandante traidor que manda "atacar" a um tenente e "recuar" ao outro é desmascarado, porque sua assinatura aparece em duas ordens.
- **Assinaturas removem o limite.** O SM(m) resolve o problema com no máximo m traidores para qualquer número de generais (ele é vazio com menos de m + 2).
- **Conectividade.** O OM(m, 3m) exige um grafo 3m-regular. Se os generais leais formam um grafo conexo, o SM(n - 2) resolve para n generais, e com diâmetro d entre os leais basta o SM(m + d - 1).
- **Custo.** O OM(m) e o SM(m) usam caminhos de mensagem de comprimento até m + 1, o que os autores dizem que Fischer e Lynch mostraram ser necessário, e enviam até (n - 1)(n - 2) ... (n - m - 1) mensagens. A conclusão diz que as soluções são caras e que isso parece inerente a falhas arbitrárias.
- **O tempo é necessário.** Detectar uma mensagem ausente exige um limite de atraso e relógios sincronizados dentro de um erro fixo. O artigo afirma que nenhum algoritmo resolve o problema se os generais só podem agir em um instante inicial fixo, ao receber uma mensagem ou quando um temporizador aleatório dispara (a classe mais geral que não permite construir relógios sincronizados) e as mensagens podem viajar arbitrariamente rápido. A prova fica de fora.
- **Assinaturas são probabilísticas.** Forjar não pode ser tornado impossível, só improvável. A assinatura de exemplo S_i(M) = M * K_i mod P dá a um falsificador aleatório probabilidade de 1/P.

## Análise crítica

O artigo é o ponto de referência de todo um modelo de falhas, e seus algoritmos continuam sendo a forma mais clara de ver por que 3f + 1 aparece em toda parte. Os limites são igualmente claros.

- **Ele assume um sistema síncrono.** Timeouts e erro de relógio limitado estão embutidos, que é o cenário em que [o resultado FLP](/papers/flp-impossibility-of-distributed-consensus) não se aplica. Redes reais não oferecem essa garantia.
- **O custo cresce rapidamente com m.** O padrão recursivo de mensagens só é prático para grupos minúsculos, e o artigo diz que reduzir a informação enviada não foi estudado em detalhe.
- **Os argumentos informais são admitidos como frágeis.** Os autores avisam o leitor para desconfiar de raciocínio não rigoroso e o enviam a uma prova separada para o caso de três generais.
- **A condição B nunca é formalizada.** O que conta como um "plano razoável" fica por conta da função que combina os valores.
- **Problema e aplicação ficam separados.** A sincronização dos relógios é adiada para um artigo futuro, e nenhuma implementação é descrita.

Livro versus hoje: sistemas práticos raramente rodam OM ou SM como escritos. O PBFT e seus sucessores trabalham com sincronia parcial e assinaturas ou MACs, usam 3f + 1 réplicas e evitam a troca recursiva. O cenário em que mais importam é aquele em que os participantes não confiam uns nos outros, como blockchains, enquanto protocolos de falha por parada continuam mais baratos para sistemas operados por um único responsável.

## Pesquisas futuras

- Replicação de máquina de estados bizantina prática, com menos rodadas de mensagens e sem depender de sincronia para a segurança, como em [Autobahn](/papers/autobahn-seamless-high-speed-bft) e [Ambulance](/papers/ambulance-saving-bft-through-racing).
- Bancos de dados bizantinos que atendem consultas em escala, como o [Pesto](/papers/pesto-high-performance-bft-queries).
- Modelos híbridos que combinam tolerância a paradas com detecção de comprometimentos raros, como no [Pirateship](/papers/pirateship-append-only-ledgers-for-mostly-trusted-execution-environments).
- Sincronização de relógios tolerante a falhas bizantinas, que o artigo promete para depois.
- Objetivos mais fracos que o acordo completo, como o acordo aproximado, e modelos de falha entre parada e bizantino.
