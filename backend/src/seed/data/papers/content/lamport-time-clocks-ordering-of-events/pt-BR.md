---
title: "Tempo, relógios e a ordenação de eventos em um sistema distribuído"
summary: O artigo fundador de Lamport sobre tempo em sistemas distribuídos, que define a ordem parcial "aconteceu antes" só a partir de mensagens, acrescenta relógios lógicos que a estendem para uma ordem total, usa essa ordem para construir um algoritmo distribuído de exclusão mútua e a abordagem de máquina de estados, e por fim limita o quanto relógios físicos sincronizados podem se afastar.
researchArea: Sistemas distribuídos
keywords: relógios lógicos, aconteceu antes, ordem parcial, ordem total, replicação de máquina de estados, exclusão mútua, sincronização de relógios
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A distributed system consists of a collection of distinct processes which are spatially separated, and which communicate with one another by exchanging messages. A network of interconnected computers, such as the ARPA net, is a distributed system. A single computer can also be viewed as a distributed system in which the central control unit, the memory units, and the input-output channels are separate processes. A system is distributed if the message transmission delay is not negligible compared to the time between events in a single process. We will concern ourselves primarily with systems of spatially separated computers. However, many of our remarks will apply more generally. In particular, a multiprocessing system on a single computer involves problems similar to those of a distributed system because of the unpredictable order in which certain events can occur.

The concept of one event happening before another in a distributed system is examined, and is shown to define a partial ordering of the events. A distributed algorithm is given for synchronizing a system of logical clocks which can be used to totally order the events. The use of the total ordering is illustrated with a method for solving synchronization problems. The algorithm is then specialized for synchronizing physical clocks, and a bound is derived on how far out of synchrony the clocks can become.

## Visão geral

Este artigo, publicado no Communications of the ACM em julho de 1978, é um dos textos fundadores da computação distribuída. Foi escrito quando redes como a ARPA net eram novidade e parte de uma observação que hoje parece óbvia: em um sistema onde mensagens levam tempo, muitas vezes não existe resposta significativa para "qual destes dois eventos aconteceu primeiro?". Todo o resto decorre de levar isso a sério. Lamport voltaria às mesmas ideias em [O parlamento de meio período](/papers/paxos-part-time-parliament) e em [Paxos simplificado](/papers/paxos-made-simple), que fazem servidores concordarem sobre uma única ordem de comandos.

A ideia central é definir tempo sem nenhum relógio físico. Eventos dentro de um processo são ordenados pelo próprio processo, o envio de uma mensagem vem antes do seu recebimento, e a relação é fechada por transitividade. O que não se conecta desse modo é chamado de concorrente. O restante do artigo pergunta o que se pode fazer com essa relação: numerar eventos de forma consistente, ordená-los totalmente e, por fim, comparar o resultado com relógios físicos reais e imperfeitos.

Vale conhecer antes: o que são processo e mensagem em um sistema de troca de mensagens, o que são ordens parcial e total, e o que o problema da exclusão mútua pede. O artigo usa um diagrama espaço-tempo emprestado da relatividade restrita, e o texto o explica, então não é preciso saber física.

## Contribuição

- **A relação "aconteceu antes".** Escrita "->", é a menor relação em que (1) eventos de um mesmo processo são ordenados por esse processo, (2) o envio de uma mensagem precede o seu recebimento e (3) a relação é transitiva. Dois eventos são concorrentes se nenhum precede o outro. O artigo lê "a -> b" como "a pode afetar b causalmente".
- **A Condição de Relógio e os relógios lógicos.** Um relógio apenas atribui números a eventos, sem relação com o tempo físico. Ele é correto se a -> b implica C(a) < C(b). Duas regras de implementação garantem isso: IR1, cada processo incrementa seu relógio entre dois eventos sucessivos, e IR2, toda mensagem leva o timestamp do remetente e o receptor ajusta seu relógio para além desse valor.
- **Uma ordem total a partir da parcial.** Ordenar os eventos pelo timestamp e desempatar com uma ordem fixa e arbitrária dos processos estende "->" para uma ordem total. O artigo observa que essa ordem não é única e que só a ordem parcial é determinada pelos eventos.
- **Exclusão mútua distribuída.** Um algoritmo de cinco regras, baseado em mensagens com timestamp de pedido, confirmação e liberação, sem coordenador central.
- **A abordagem de máquina de estados.** Cada processo simula a mesma máquina de estados e aplica os comandos na ordem dos timestamps, o que generaliza o exemplo da exclusão mútua para qualquer sincronização.
- **Comportamento anômalo e relógios físicos.** O artigo nomeia o caso em que a ordem do sistema discorda da ordem percebida pelos usuários, e apresenta uma regra de sincronização de relógios e um teorema que limita o desvio.

## Metodologia

O artigo é uma sequência de definições, regras e provas informais, sem implementação nem medições. Primeiro fixa o modelo: processos são sequências de eventos, e enviar ou receber uma mensagem é um evento. Depois enuncia uma condição de correção para relógios, mostra que duas regras simples a implicam e mostra como uma ordem total decorre dela.

Para mostrar que a ordem é útil, pega um problema concreto, um recurso compartilhado que deve ser concedido na ordem dos pedidos, e argumenta que um escalonador central não o resolve. Em seguida apresenta o algoritmo de cinco regras e verifica uma a uma as três condições exigidas. Para o comportamento anômalo, introduz um conjunto maior de eventos que inclui os externos e define uma Condição de Relógio Forte sobre eles. A última parte passa aos relógios físicos, com duas hipóteses (um limite para o erro de taxa do relógio e um limite para a diferença entre as leituras de dois relógios), e prova um teorema sobre eles no Apêndice.

## Resultados

- **Eventos muitas vezes não têm ordem.** Um processo não sabe o que outro fez em um evento até receber uma mensagem que dependa dele, mesmo que um diagrama sugira que o outro evento veio antes no tempo físico. Eventos concorrentes simplesmente não são ordenados.
- **Relógios lógicos cumprem a Condição de Relógio, mas não a sua recíproca.** A recíproca obrigaria todos os eventos concorrentes a terem o mesmo tempo, o que contradiz a própria condição, então um timestamp menor não significa que o evento aconteceu antes.
- **Um servidor central que concede pedidos na ordem de chegada não é correto.** Se P1 envia um pedido ao escalonador P0 e depois uma mensagem a P2, que envia o próprio pedido, o pedido de P2 pode chegar primeiro a P0, e a exigência de ordem é violada.
- **O algoritmo de exclusão mútua cumpre as três condições.** Um processo fica com o recurso quando seu pedido é o primeiro da fila local na ordem total e ele recebeu uma mensagem de cada outro processo com timestamp posterior ao pedido. O artigo também nota que o esquema inteiro para se um processo falhar, porque todos precisam conhecer todos os comandos.
- **Falha exige tempo físico.** Sem ele, não há como distinguir um processo que falhou de um que só está parado entre eventos.
- **O comportamento anômalo é real.** Se um usuário faz o pedido A em uma máquina e depois telefona a um amigo que faz o pedido B em outra, B pode receber o timestamp menor. O artigo oferece duas saídas: o usuário repassa o timestamp, ou os relógios são físicos e cumprem a Condição de Relógio Forte.
- **Um limite para relógios físicos sincronizados.** Para relógios típicos controlados por cristal, o artigo dá uma deriva de no máximo 10^-6 e exige que relógios nunca sejam atrasados. Em um grafo fortemente conexo de diâmetro d, com uma mensagem enviada por cada arco a cada tau segundos e atraso imprevisível menor que xi, os relógios ficam a uma distância de aproximadamente d(2 kappa tau + xi) uns dos outros depois de tempo suficiente, onde kappa é o limite de deriva. O artigo chama a prova de surpreendentemente difícil e acredita que o teorema seja um resultado novo.

## Análise crítica

O artigo é curto e sua ideia central envelheceu muito bem, mas o leitor deve guardar alguns limites.

- **A ordem total é arbitrária.** Ela respeita a causalidade, mas eventos concorrentes são ordenados por valores de relógio sem significado real, com empates desfeitos pela identidade do processo, e um processo só conhece a ordem depois de ouvir todos os outros.
- **Timestamps escalares perdem informação.** Um timestamp menor não diz se dois eventos têm relação causal. O artigo não trata disso, e foi por isso que trabalhos posteriores introduziram relógios vetoriais.
- **Os algoritmos supõem canais confiáveis.** As mensagens chegam em ordem e sempre chegam, e o artigo diz que essas hipóteses podem ser removidas com numeração de mensagens e confirmações. O algoritmo resultante ainda exige a participação de todos os processos, então uma falha para o sistema.
- **A parte de relógios físicos é idealizada.** Ela supõe um espaço-tempo newtoniano, relógios contínuos e um atraso mínimo de mensagem conhecido, o que redes reais só aproximam.
- **A generalização é só prometida.** A conclusão anuncia um artigo futuro sobre estender o método a qualquer problema de sincronização, então a generalização aqui é um esboço.

Livro versus hoje: o tratamento de falhas no artigo é breve de propósito, e trabalhos posteriores de consenso, como [Paxos simplificado](/papers/paxos-made-simple) e [Raft](/papers/raft-understandable-consensus-algorithm), lidam com quedas sem exigir resposta de todos os processos. Sistemas modernos também usam o tempo físico mais diretamente do que o artigo sugere, por exemplo no [Spanner](/papers/spanner-globally-distributed-database) e no [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks). Uma ordem total vinda de um log, como no [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), faz o papel da ordem por timestamp.

## Pesquisas futuras

- Relógios vetoriais e estruturas parecidas que capturam a causalidade com exatidão, e relógios lógicos híbridos que combinam tempo lógico e físico.
- Consistência causal em serviços reais, por exemplo [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) e [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Versões tolerantes a falhas da abordagem de máquina de estados, baseadas em consenso.
- Sincronização de relógios com erro limitado e os sistemas que dependem dela, como no [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks).
- Ordenação fornecida pela própria rede, como no [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering).
