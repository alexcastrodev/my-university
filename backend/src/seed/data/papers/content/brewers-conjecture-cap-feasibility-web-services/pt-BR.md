---
title: "A conjectura de Brewer e a viabilidade de serviços web consistentes, disponíveis e tolerantes a partições"
summary: Gilbert e Lynch formalizam a conjectura CAP de Eric Brewer e a provam: numa rede assíncrona, nenhum objeto de leitura e escrita pode ser atomicamente consistente e sempre disponível se mensagens podem se perder. Depois mostram que, com temporizadores, um serviço mantém a consistência quando a rede está saudável e degrada de forma controlada quando não está.
researchArea: Sistemas distribuídos
keywords: teorema CAP, consistência, disponibilidade, tolerância a partições, linearizabilidade, resultado de impossibilidade, sincronia parcial
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Ao projetar serviços web distribuídos, há três propriedades comumente desejadas: consistência, disponibilidade e tolerância a partições. É impossível obter as três. Nesta nota, provamos essa conjectura no modelo de rede assíncrona e depois discutimos soluções para esse dilema no modelo parcialmente síncrono.

## Visão geral

No PODC 2000, Eric Brewer fez uma palestra convidada, "Towards robust distributed systems", em que conjecturou que um serviço web não consegue oferecer ao mesmo tempo consistência, disponibilidade e tolerância a partições. As três palavras não tinham significado preciso, então a afirmação não podia ser provada nem refutada. Esta nota, publicada no ACM SIGACT News em junho de 2002, é o artigo que transformou o slogan em teorema e lhe deu o nome "CAP" usado pelos trabalhos seguintes.

Ela pertence à família de resultados de impossibilidade que começou com o [FLP](/papers/flp-impossibility-of-distributed-consensus). Os dois usam o modelo assíncrono, em que um nó não distingue uma mensagem perdida de uma atrasada, e os dois se apoiam em um argumento de indistinguibilidade. A nota também ajuda a entender por que a máquina de estados replicada do [Paxos](/papers/paxos-made-simple) e do [Raft](/papers/raft-understandable-consensus-algorithm) não pode prometer responder a todo cliente durante uma partição.

Vale conhecer antes: linearizabilidade (cada operação parece ocorrer em um único instante, numa ordem que respeita o tempo real), o modelo assíncrono de troca de mensagens e a diferença entre segurança ("nada de ruim acontece") e vivacidade ("algo de bom acontece eventualmente").

## Contribuição

- **Definições precisas.** Consistência vira consistência atômica (linearizável) de um objeto de leitura e escrita. Disponibilidade significa que toda requisição recebida por um nó que não falhou deve receber resposta, sem limite de tempo. Tolerância a partições significa que a rede pode perder arbitrariamente muitas mensagens entre nós.
- **O teorema de impossibilidade.** No modelo assíncrono, nenhum objeto de leitura e escrita garante disponibilidade e consistência atômica em todas as execuções justas, inclusive nas que perdem mensagens (Teorema 1).
- **Um corolário mais forte.** O mesmo vale mesmo que a atomicidade só seja exigida nas execuções sem perda de mensagens (Corolário 1.1), porque nesse modelo um algoritmo não distingue mensagem perdida de mensagem atrasada.
- **Um mapa do que é possível.** Quaisquer duas das três propriedades podem ser obtidas: atômico e tolerante a partições, atômico e disponível, ou disponível e tolerante a partições, cada caso com um exemplo simples.
- **Uma saída.** Num modelo parcialmente síncrono o corolário deixa de valer, e a nota define a consistência Delayed-t, uma garantia mais fraca com limite explícito de tempo.

## Metodologia

A nota é um argumento formal, sem implementação nem experimento. A prova de impossibilidade divide os nós em dois conjuntos não vazios, G1 e G2, e supõe que toda mensagem entre eles se perde. Uma escrita de um valor diferente do valor inicial v0 termina em G1, porque o serviço é disponível. Uma leitura posterior em G2 também precisa terminar, de novo por disponibilidade, mas G2 não distingue essa execução de uma em que a escrita nunca aconteceu, e por isso devolve v0. A leitura começa depois do fim da escrita, o que contradiz a atomicidade.

O corolário é provado por extensão: se existisse um algoritmo atômico sempre que todas as mensagens são entregues, toma-se uma execução com uma resposta não atômica, corta-se nessa resposta e estende-se o prefixo até uma execução justa em que toda mensagem é entregue. O resultado é não atômico, uma contradição. O modelo parcialmente síncrono dá a cada nó um temporizador, um limite conhecido t_msg para a entrega de mensagens (ou a mensagem se perde) e um limite conhecido t_local para o processamento. O Teorema 2 repete a prova com um longo período ocioso em G2, para que a escrita termine antes da leitura começar. A parte construtiva é um algoritmo centralizado com timeouts, provado correto em relação à definição Delayed-t.

## Resultados

São resultados das provas, não de medições.

- **Teorema 1.** Nenhum algoritmo no modelo assíncrono dá disponibilidade e consistência atômica em todas as execuções justas, incluindo as que perdem mensagens.
- **Corolário 1.1.** A atomicidade não pode nem ser reservada às execuções sem perda, já que um algoritmo assíncrono não detecta mensagem perdida.
- **Teorema 2.** A sincronia parcial não elimina a impossibilidade quando mensagens arbitrárias podem se perder.
- **Com temporizadores o corolário deixa de valer.** Um nó que espera 2 * t_msg + t_local pelo nó central pode concluir que uma mensagem se perdeu e responder com o melhor valor que conhece. O resultado são dados atômicos quando as mensagens são entregues e possivelmente defasados quando não são.
- **Teorema 4.** O algoritmo centralizado modificado é Delayed-t consistente: se passa um intervalo maior que t sem perda de mensagens, operações posteriores deixam de preceder, na ordem parcial, operações anteriores já concluídas. O artigo relaciona isso aos serviços de dados eventualmente serializáveis, mas com um limite explícito de tempo.

## Análise crítica

O teorema é estreito, e esse é o seu valor, mas costuma ser citado de forma mais ampla do que foi provado.

- **A disponibilidade é forte e fraca ao mesmo tempo.** Exige resposta de todo nó que não falhou mesmo isolado de todos os outros, mas não limita a latência, então "lento, porém respondendo no fim" conta como disponível. Serviços reais são avaliados por latência e pela fração de requisições atendidas, não por essa definição.
- **Consistência aqui é só linearizabilidade.** O resultado nada diz sobre os modelos mais fracos que muitos bancos oferecem. A própria nota diz que disponibilidade com consistência mais fraca é alcançável, e esboça apenas um modelo desse tipo.
- **É uma afirmação sobre partições, não uma escolha permanente.** "Dois de três" sugere um rótulo fixo para o sistema, mas o dilema só pesa enquanto a partição dura, e o algoritmo parcialmente síncrono do próprio artigo já muda de comportamento nesse momento.
- **O modelo é pequeno.** Um único objeto de leitura e escrita, sem falhas de parada (a introdução as deixa de lado), um algoritmo centralizado como exemplo principal e uma prova Delayed-t de poucos parágrafos. Não trata de durabilidade, custo de replicação nem de transações com vários objetos.
- **Livro versus hoje.** O artigo é uma nota de nove páginas no periódico, e a própria conclusão aponta "a maior parte dos dados, na maior parte do tempo" como trabalho teórico futuro. Trabalhos posteriores, incluindo a retrospectiva do próprio Brewer e o "Perspectives on the CAP Theorem" de Gilbert e Lynch, argumentam que o dilema é mais sutil que o slogan de 2000.

## Pesquisas futuras

- Tratar latência e um contínuo de níveis de consistência, e não só disponibilidade binária, já que serviços reais são avaliados pelos dois.
- Sistemas que ficam consistentes e tornam as partições raras, como o [Spanner](/papers/spanner-globally-distributed-database), e outros que evitam coordenação quando possível, como o [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) e o [Eris](/papers/eris-coordination-free-consistent-transactions).
- Consistência causal como modelo que continua disponível sob partições, como no [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) e no [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Formalizar "a maior parte dos dados, na maior parte do tempo", que o artigo cita como trabalho futuro.
- Ler o resultado ao lado do [FLP](/papers/flp-impossibility-of-distributed-consensus) e do problema dos [Generais Bizantinos](/papers/byzantine-generals-problem) como um conjunto de limites do que uma rede não confiável permite.
