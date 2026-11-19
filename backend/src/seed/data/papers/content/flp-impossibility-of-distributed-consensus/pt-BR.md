---
title: "Impossibilidade de consenso distribuído com um processo defeituoso"
summary: O resultado FLP, que prova que nenhum protocolo determinístico consegue garantir acordo em um sistema totalmente assíncrono se um único processo puder falhar, e que fixou os limites dentro dos quais todo algoritmo de consenso posterior precisa trabalhar.
researchArea: Sistemas distribuídos
keywords: consenso, resultado de impossibilidade, sistemas assíncronos, tolerância a falhas, bivalência, protocolos de commit
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O problema do consenso envolve um sistema assíncrono de processos, alguns dos quais podem ser não confiáveis. O problema é fazer os processos confiáveis concordarem em um valor binário. Neste artigo, mostra-se que todo protocolo para esse problema tem a possibilidade de não terminar, mesmo com apenas um processo defeituoso. Em contraste, são conhecidas soluções para o caso síncrono, o problema dos "Generais Bizantinos".

## Visão geral

O artigo de Fischer, Lynch e Paterson (conhecido como FLP) saiu no Journal of the ACM em abril de 1985, depois de uma primeira apresentação no ACM Symposium on Principles of Database Systems, em 1983. A motivação vem dos bancos de dados: no problema do commit de transações, todos os gerenciadores de dados que participaram de uma transação precisam decidir juntos se instalam os resultados ou os descartam, embora sistemas reais sofram com quedas, partições e perda de mensagens. Os autores perguntam o quão confiável esse acordo pode ser e respondem com uma surpresa: em um sistema completamente assíncrono, nenhum protocolo tolera nem mesmo a morte de um único processo sem aviso.

O resultado é negativo e explica por que a pesquisa posterior em consenso tem o formato que tem. [Paxos simplificado](/papers/paxos-made-simple) e o [Raft](/papers/raft-understandable-consensus-algorithm) mantêm a segurança (safety) incondicional, mas abrem mão de garantir progresso quando a rede se comporta mal, e o [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus) escapa do limite com aleatoriedade. [The Part-Time Parliament](/papers/paxos-part-time-parliament) é o algoritmo que, na prática, convive com esse resultado.

Vale saber antes: a ideia de processo como máquina de estados determinística, a diferença entre propriedade de segurança (nada de ruim acontece) e de vivacidade (algo bom acaba acontecendo) e o problema do commit. O artigo não assume comportamento bizantino e supõe um sistema de mensagens confiável, então a impossibilidade vale mesmo no modelo de falhas mais favorável.

## Contribuição

- **Um problema de consenso bem fraco.** Cada processo começa com um bit, os processos não defeituosos que decidem precisam escolher o mesmo valor, tanto 0 quanto 1 precisam ser resultados possíveis, e para a prova basta que algum processo decida em algum momento. A impossibilidade para esse problema fraco vale para todos os mais fortes.
- **Um modelo de sistema deliberadamente forte.** Os processos são autômatos, possivelmente com infinitos estados, sem limite para a velocidade relativa, sem limite para o atraso das mensagens, sem relógios sincronizados e sem como detectar uma morte. Um processo lento e um processo morto parecem iguais.
- **O teorema principal.** Nenhum protocolo de consenso é totalmente correto diante de uma falha: todo protocolo parcialmente correto tem alguma execução admissível em que nenhum processo chega a decidir.
- **O argumento de bivalência.** Uma configuração é bivalente se as duas decisões ainda são alcançáveis a partir dela, e a prova mostra que um protocolo sempre pode ser mantido em uma configuração assim. A técnica virou ferramenta padrão em provas de impossibilidade posteriores.
- **Um contraponto positivo.** O Teorema 2 dá um protocolo que funciona quando nenhum processo morre durante a execução e uma maioria estrita está viva desde o início, o que mostra como a impossibilidade é estreita.

## Metodologia

O artigo é uma prova pura, sem implementação nem medição. Um protocolo de consenso é um conjunto de N processos determinísticos (N pelo menos 2) que se comunicam por um buffer de mensagens com as operações send e receive. Um passo é um evento (p, m): o processo p recebe uma mensagem m ou o marcador nulo, muda de estado e envia um conjunto finito de mensagens. Uma execução é admissível se no máximo um processo é defeituoso, isto é, dá apenas um número finito de passos, e toda mensagem enviada a um processo não defeituoso é eventualmente recebida. Um protocolo é parcialmente correto se nenhuma configuração acessível tem dois valores de decisão e os dois valores ocorrem em alguma configuração. Ele é totalmente correto diante de uma falha se toda execução admissível também chega a uma decisão.

A prova é por contradição e tem três etapas. O Lema 1 diz que escalonamentos de eventos de conjuntos disjuntos de processos comutam. O Lema 2 mostra que alguma configuração inicial é bivalente: caso contrário, existiriam lado a lado uma configuração inicial 0-valente e outra 1-valente que diferem na entrada de um só processo, e uma execução em que esse processo não dá passo algum decide igual nas duas. O Lema 3 mostra que, para qualquer configuração bivalente C e qualquer evento e aplicável a ela, existe uma configuração bivalente alcançável a partir de C em que e foi o último evento aplicado. A construção final procede em estágios, sempre dando o próximo passo ao processo à frente de uma fila e entregando sua mensagem mais antiga, e termina todo estágio em uma configuração bivalente. A execução é admissível e nunca decide.

## Resultados

Estes são os resultados que o artigo prova.

- **Teorema 1.** Nenhum protocolo de consenso é totalmente correto diante de uma falha. Basta um processo parar em um momento inoportuno, com um sistema de mensagens confiável e sem comportamento bizantino.
- **Todo protocolo de commit tem uma janela de vulnerabilidade.** O artigo observa que os protocolos de commit assíncronos então em uso têm todos um intervalo em que o atraso de um único processo pode fazer o algoritmo inteiro esperar para sempre, e que o resultado confirma isso como um preceito amplamente aceito no folclore da área.
- **Teorema 2 (processos inicialmente mortos).** Existe um protocolo parcialmente correto em que todos os processos não defeituosos sempre decidem, desde que nenhum processo morra durante a execução e uma maioria estrita esteja viva no início. Ele roda em dois estágios sobre um grafo em que cada processo ouve L - 1 outros, com L igual ao teto de (N + 1) / 2. Os processos então calculam o fecho transitivo, acham a única clique inicial e decidem por uma regra combinada sobre as entradas da clique.
- **O contraste com o caso síncrono.** O problema dos Generais Bizantinos tem soluções conhecidas quando há hipóteses de tempo, então o obstáculo é a assincronia e não apenas as falhas.

## Análise crítica

A prova é curta, elegante e resiste há décadas, mas é fácil exagerar o seu alcance.

- **Fala de garantias, não de probabilidades.** O artigo mostra que existe uma execução admissível sem decisão, não que ela seja provável. Sistemas reais quase sempre decidem, e os autores dizem que os resultados não mostram que esses problemas não possam ser resolvidos na prática.
- **Depende de determinismo e de assincronia total.** Protocolos aleatorizados e modelos com alguma hipótese de tempo ficam fora dele, e o próprio artigo aponta as duas saídas: modelos mais refinados e requisitos de terminação mais fracos, como terminar com probabilidade 1.
- **O modelo é exigente em um ponto e generoso em outro.** A entrega de mensagens é perfeita e as falhas são só quedas, mas o sistema é suposto totalmente livre de informação de tempo, o que nenhuma rede real é.
- **O problema sem solução é a vivacidade, não a segurança.** O artigo fica nesse nível e não discute como o protocolo deve se comportar enquanto espera.
- **Livro vs hoje.** Na prática a lição é aplicada como sincronia parcial: protocolos como Paxos e Raft nunca decidem errado e fazem progresso quando a rede está estável o suficiente, em geral detectado por timeouts. O próprio artigo cita trabalhos sobre consenso com sincronia parcial e sobre acordo aleatorizado, que se desenvolveram na linha dos detectores de falhas e em protocolos assíncronos aleatorizados.

## Pesquisas futuras

- Modelos entre a assincronia total e a sincronia total, como a sincronia parcial, e o detector de falhas mais fraco que torna o consenso solúvel.
- Consenso assíncrono aleatorizado, que abre mão da terminação garantida em troca de terminar com probabilidade 1.
- Resultados de impossibilidade e de trade-off no mesmo espírito, como o teorema CAP, que usa um argumento assíncrono parecido.
- Projetos práticos que mantêm a segurança incondicional e tratam os timeouts apenas como dica de vivacidade, como no [Raft](/papers/raft-understandable-consensus-algorithm).
- Transferência do resultado para outros problemas equivalentes ao consenso, como o atomic broadcast.
