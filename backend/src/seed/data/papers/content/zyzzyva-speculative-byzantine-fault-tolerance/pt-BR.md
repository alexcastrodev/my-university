---
title: "Zyzzyva: tolerância bizantina a falhas por especulação"
summary: O Zyzzyva faz as réplicas executarem um pedido na ordem proposta pelo primário e responderem ao cliente na hora, e passa a decisão final para o cliente, que só aceita a resposta quando 3f+1 respostas (ou um certificado de commit de 2f+1 réplicas) provam que a ordem é estável. Sem falhas, chega a três atrasos de mensagem de ida e, com lotes, a 86 mil ops/s contra 59 mil do PBFT.
researchArea: Sistemas distribuídos
keywords: tolerância a falhas bizantinas, execução especulativa, replicação de máquina de estados, certificado de commit, troca de visão, acordo conduzido pelo cliente
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Apresentamos o Zyzzyva, um protocolo que usa especulação para reduzir o custo e simplificar o projeto da replicação de máquina de estados tolerante a falhas bizantinas. No Zyzzyva, as réplicas respondem ao pedido de um cliente sem antes executar um caro protocolo de commit de três fases para chegar a um acordo sobre a ordem em que o pedido deve ser processado. Em vez disso, adotam de forma otimista a ordem proposta pelo primário e respondem imediatamente ao cliente. As réplicas podem, assim, ficar temporariamente inconsistentes entre si, mas os clientes detectam as inconsistências, ajudam as réplicas corretas a convergir para uma única ordem total dos pedidos e só confiam em respostas consistentes com essa ordem total. Essa abordagem permite ao Zyzzyva reduzir os custos de replicação a valores próximos dos mínimos teóricos.

## Visão geral

O [problema dos generais bizantinos](/papers/byzantine-generals-problem) definiu as falhas arbitrárias, e o [PBFT](/papers/practical-byzantine-fault-tolerance) (OSDI 1999) as tornou toleráveis em uma rede assíncrona. Este artigo, da University of Texas at Austin, foi apresentado no SOSP 2007 (Stevenson, 14 a 17 de outubro, pp. 45 a 58). O ponto de partida é que o acordo no estilo PBFT ainda exige um protocolo de três fases antes de as réplicas responderem. Os autores também dizem que o estado da arte era "distressingly complex" (desesperadoramente complexo): citando o artigo do HQ, a melhor escolha entre PBFT, Q/U e HQ dependia de contenção, de lotes, do número de réplicas e do valor de f, então o projetista precisava escolher por carga de trabalho. Esse artigo também esperava que o PBFT sofresse com "the quadratic number of messages" (o número quadrático de mensagens) conforme f cresce, e o Zyzzyva o cita.

A proposta é mover o "output commit" para o cliente. As réplicas executam de imediato a ordem proposta pelo primário, sem conversar entre si. A resposta traz um resumo do histórico de pedidos, de modo que o cliente consegue saber se ele é estável, isto é, se tem garantia de ser eventualmente confirmado em todas as réplicas corretas.

Vale conhecer antes: as fases pre-prepare, prepare e commit do PBFT, a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) como a garantia que o cliente enxerga, o modelo de sincronia eventual de [Dwork, Lynch e Stockmeyer](/papers/consensus-in-the-presence-of-partial-synchrony) (a hipótese de vivacidade do artigo) e o [Paxos](/papers/paxos-part-time-parliament) (veja também [Paxos Made Simple](/papers/paxos-made-simple)), já que o artigo diz que seu acordo rápido se baseia em trabalhos sobre Fast Paxos.

## Contribuição

- **Especulação com verificação no cliente.** A réplica acrescenta o pedido ordenado ao histórico, executa e envia uma spec-response com o hash do histórico. Um pedido se completa no cliente de duas maneiras, e o subprotocolo de acordo nunca precisa de mais de duas fases dentro de uma visão.
- **Caso rápido.** Com 3f+1 respostas mutuamente consistentes, o cliente age na hora. São três atrasos de mensagem de ida no caminho crítico (PBFT e HQ: 4, Q/U: 2, segundo a Tabela 1).
- **Caso de duas fases.** Com 2f+1 a 3f respostas iguais, o cliente monta um certificado de commit (2f+1 respostas assinadas) e o envia às réplicas, que respondem com local-commit. O cliente conclui após 2f+1 local-commits.
- **Menos de 2f+1 respostas.** O cliente reenvia o pedido a todas as réplicas, que o encaminham ao primário (confirm-req) e disparam um temporizador de troca de visão se ele não for ordenado. Se duas spec-responses trazem order-req conflitantes, o par é uma prova de mau comportamento enviada às réplicas, que iniciam a troca de visão.
- **Uma troca de visão diferente.** A réplica que suspeita do primário envia por multicast "I hate the primary", mas continua participando, e só se compromete com a troca depois de f+1 votos desses. O histórico da nova visão pode incluir um pedido apoiado por order-req de f+1 réplicas mesmo sem certificado de commit, porque um pedido concluído com 3f+1 respostas não tem certificado de commit em lugar nenhum.
- **Zyzzyva5.** Com 5f+1 réplicas, o caminho de três atrasos sobrevive a f réplicas não primárias falhas.

## Metodologia

O artigo apresenta o protocolo e depois esboços de prova de duas propriedades, com as provas completas em um relatório técnico estendido que esta entrada não leu. Segurança (saf): se um pedido com número de sequência n e histórico h_n se completa, qualquer pedido que se complete com n' >= n tem um histórico que contém h_n como prefixo. Vivacidade (liv): todo pedido de um cliente correto eventualmente se completa. A segurança vale em qualquer rede assíncrona, com qualquer número de clientes falhos e até f réplicas falhas. A vivacidade exige períodos em que as mensagens são processadas dentro de um atraso fixo, possivelmente desconhecido.

O protótipo usa MACs no lugar de assinaturas (as assinaturas ficam nas retransmissões do cliente e nas trocas de visão), 2f+1 réplicas de execução com as demais como testemunhas, lotes, pedidos somente de leitura, resposta única de execução, quóruns preferenciais (não usados nas medições) e cache de mensagens fora de ordem. Os testes rodaram em máquinas Pentium-4 de 3,0 GHz com Linux 2.6, MACs com MD5 e os microbenchmarks 0/0, 4/0 e 0/4 de Castro e colegas, na maior parte com f = 1. PBFT e HQ rodaram a partir das implementações originais, com a vazão ampliada em 9% por causa do SHA-1 em vez do MD5. A vazão do Q/U é o pico publicado, ampliado em 7,5% pelo clock, e a latência do Q/U vem de uma implementação simples do melhor caso escrita pelos autores.

## Resultados

São os resultados dos autores; cada item diz de onde sai o número.

- **Vazão, 0/0, sem lotes (texto).** O pico do Zyzzyva é 2,7 vezes o do PBFT, com o PBFT fazendo cerca de 2,2 vezes mais operações criptográficas e cerca de 3,7 vezes mais mensagens.
- **Vazão com lote de 10 (texto).** Zyzzyva e Zyzzyva5 chegam a 86 mil ops/s, o que os autores leem como 12 µs de custo de protocolo por requisição em lote no primário. O PBFT chega a 59 mil, uma diferença de 45%. O Zyzzyva tem mais de 3 vezes o pico informado do Q/U e mais de 9 vezes a vazão medida do HQ, e fica a 35% de um servidor não replicado.
- **Latência (Figura 4, só leitura de gráfico).** Zyzzyva e Zyzzyva5 ficam abaixo de PBFT e HQ, e as barras do HQ são as mais altas, em torno de 0,7 ms no 0/0. O texto diz que o Q/U, no melhor caso, tem latência ainda menor com pouca contenção. O texto não dá números de latência.
- **Escalabilidade com f.** Sem lotes, o Zyzzyva precisa de 2 + (3f+1) operações criptográficas por pedido no gargalo e o PBFT de 2 + (10f+1). As contagens de mensagens da Figura 7 vêm de um modelo analítico, e o artigo observa que as mensagens no primário crescem com f no Zyzzyva, no Zyzzyva5 e no PBFT, mas não no Q/U e no HQ.
- **Com f réplicas não primárias sem responder (texto).** Para f = 1 e sem lotes, Zyzzyva e Zyzzyva5 dão 1,8 e 2,6 vezes a vazão do PBFT. Com lote de 10, o PBFT é 15% melhor que o Zyzzyva, cujo custo criptográfico é 16% maior, enquanto o Zyzzyva5 continua 43% acima do PBFT. Uma réplica falha já força o caminho de duas fases, e o custo criptográfico por lote sobe de 2 + (3f+1)/b para 3 + (5f+1)/b.

## Análise crítica

O que o artigo diz sobre seus limites: o caso rápido precisa das 3f+1 respostas, então uma réplica lenta ou falha força a rodada do certificado de commit, e os números são otimizados para o caso sem falhas. O Zyzzyva5 recupera a velocidade com 2f réplicas a mais. Um primário falho "can significantly prevent progress" (pode impedir o progresso de forma significativa) e só é tratado por substituição.

Pontos que são leitura da evidência, não afirmações do artigo:

- **A avaliação com falhas é estreita.** Mede réplicas que deixam de responder, não réplicas bizantinas se comportando mal de forma ativa, e não há medições de trocas de visão, de primário falho nem do temporizador do cliente que antecede a rodada de commit, então o custo do caminho lento com atacantes ativos não foi medido. A Figura 7 é um modelo, não uma medição.
- **As bases de comparação são de natureza diferente.** O Q/U entra por vazão publicada e por uma implementação de latência do melhor caso, e os números de HQ e PBFT são reescalados pelos autores por diferenças de hardware e de hash.
- **Inconsistência interna nas fórmulas de custo.** A Tabela 1 dá o custo de MACs no gargalo do PBFT como 2+(8f+1)/b e o do Zyzzyva como 2+3f/b, enquanto as Seções 5.3 e 5.4 escrevem 2+(10f+1) e 2+(3f+1)/b. O artigo não explica, e só o relatório estendido tem os detalhes.
- **A complexidade foi movida, não removida.** A troca de visão ganha uma fase, uma regra mais fraca sobre quais pedidos entram no novo histórico, e o próprio artigo chama uma das consequências de "a curiosity" (uma curiosidade).

Literatura posterior, que não faz parte do artigo. Em dezembro de 2017, Abraham, Gueta, Malkhi (VMware Research) com Alvisi, Kotla e Martin publicaram a nota no arXiv "Revisiting Fast Practical Byzantine Fault Tolerance" (1712.01367). O resumo diz: "we observe a safety violation in Zyzzyva and a liveness violation in FaB" (observamos uma violação de segurança no Zyzzyva e uma violação de vivacidade no FaB). Para o Zyzzyva, a nota dá dois cenários com quatro réplicas, uma bizantina, e três visões, em que o conflito aparece já no primeiro slot do log: um questiona preferir um certificado de commit a f+1 prepares, o outro preferir o certificado de commit mais longo. A nota chama sua descrição do Zyzzyva de "skeletal" (esquelética) e remete à versão da CACM para os detalhes. Li a seção da nota sobre o Zyzzyva, mas não conferi os cenários contra o texto do SOSP nem contra o relatório estendido, nem li resposta ou correção, então não sei dizer como eles se aplicam ao protocolo de 2007. Entradas posteriores do catálogo seguem outro caminho para a vazão BFT: segundo seus resumos, o [Autobahn](/papers/autobahn-seamless-high-speed-bft) e o [Narwhal e Tusk](/papers/narwhal-and-tusk-dag-based-mempool-and-efficient-bft-consensus) separam a disseminação de dados da ordenação, com o Autobahn ordenando por consenso no estilo PBFT.

## Pesquisas futuras

- Medir o caminho lento sob comportamento bizantino ativo, incluindo trocas de visão, o que o artigo nunca faz.
- Quantificar como o temporizador do cliente que antecede o certificado de commit afeta a latência quando uma réplica está lenta.
- Ler a versão estendida da ACM TOCS (27(4), 2009) e o relatório técnico para as provas completas, e conferir de novo os cenários da nota de 2017 contra elas.
- Pesar as 5f+1 réplicas do Zyzzyva5 contra o caminho lento da versão com 3f+1.
