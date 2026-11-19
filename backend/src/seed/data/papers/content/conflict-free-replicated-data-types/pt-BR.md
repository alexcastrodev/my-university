---
title: "Tipos de dados replicados livres de conflito"
summary: Shapiro, Preguiça, Baquero e Zawirski definem a Consistência Eventual Forte e mostram que duas condições simples, um semirreticulado monotônico nos objetos baseados em estado e operações comutativas nos baseados em operações, fazem as réplicas convergirem sem consenso nem rollback. O artigo também constrói contadores, conjuntos, um log e um grafo dirigido a partir dessas condições.
researchArea: Sistemas distribuídos
keywords: crdt, consistência eventual, consistência eventual forte, semirreticulado, comutatividade, replicação, teorema cap
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Replicar dados sob Consistência Eventual (EC) permite que qualquer réplica aceite atualizações sem sincronização remota. Isso garante desempenho e escalabilidade em sistemas distribuídos de grande escala (por exemplo, nuvens). No entanto, as abordagens de EC publicadas são ad hoc e propensas a erros. Sob um modelo formal de Consistência Eventual Forte (SEC), estudamos condições suficientes para a convergência. Um tipo de dados que satisfaz essas condições é chamado de Conflict-free Replicated Data Type (CRDT). As réplicas de qualquer CRDT convergem de forma autoestabilizante, apesar de qualquer número de falhas. Este artigo formaliza duas abordagens populares (baseada em estado e baseada em operações) e suas condições suficientes. Estudamos vários CRDTs úteis, como conjuntos com semântica limpa que aceitam adição e remoção, e examinamos em profundidade o tipo mais complexo, o grafo. Os tipos CRDT podem ser compostos para desenvolver aplicações distribuídas de grande escala e têm propriedades teóricas interessantes.

## Visão geral

A consistência forte serializa toda atualização em uma ordem total global, que é a abordagem da [máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) e de protocolos de consenso como o [Paxos](/papers/paxos-made-simple). Essa ordem é um gargalo, e a [conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services) diz que ela não convive com disponibilidade sob partições. A consistência eventual deixa qualquer réplica aceitar uma atualização localmente e enviá-la depois, mas os autores observam que resolver conflitos é difícil e que soluções ad hoc são frágeis, citando as anomalias de concorrência do carrinho de compras da Amazon descritas no Dynamo. O artigo saiu no SSS 2011 e, nas palavras dos autores, é o primeiro estudo sistemático desses projetos.

A pergunta é quando atualizações concorrentes podem ser mescladas sem nenhuma arbitragem. A resposta é um par de condições matemáticas que um tipo de dados pode satisfazer por construção, de modo que as réplicas convergem sem rollback e sem consenso, e o consenso é justamente o que o [resultado FLP](/papers/flp-impossibility-of-distributed-consensus) mostra não ter solução determinística em um sistema assíncrono com até uma falha de parada.

Vale conhecer antes: a relação acontece-antes e os relógios vetoriais do [artigo de relógios lógicos de Lamport](/papers/lamport-time-clocks-ordering-of-events), a ideia de semirreticulado de junção (uma ordem parcial em que quaisquer dois elementos têm um menor limite superior) e a diferença entre atualizações concorrentes e causalmente ordenadas. O modelo de sistema é assíncrono, não bizantino, com falhas por parada e uma rede que pode se particionar e se recuperar.

## Contribuição

- **Consistência Eventual Forte (SEC).** Consistência eventual mais convergência forte: réplicas corretas que entregaram as mesmas atualizações têm estado equivalente, sem resolução de conflitos depois. O artigo apresenta a SEC como solução para o problema do CAP, já que uma réplica SEC está sempre disponível para leitura e escrita.
- **Duas condições suficientes.** Em objetos baseados em estado (CvRDT), os estados formam um semirreticulado de junção monotônico e o merge calcula o menor limite superior. Em objetos baseados em operações (CmRDT), todas as atualizações concorrentes comutam, dada entrega causal confiável.
- **Equivalência dos dois estilos.** Todo objeto SEC baseado em estado pode ser emulado por um SEC baseado em operações, e vice-versa.
- **A SEC é incomparável com a consistência sequencial,** demonstrado com um conjunto de semântica "add vence".
- **Um catálogo de blocos básicos.** Vetores de inteiros, contadores só de incremento e com incremento/decremento, conjuntos só de adição, o U-Set, um mapa e um log.
- **Um projeto completo: o grafo dirigido.** Um CRDT de grafo, especificado no estilo de operações e motivado por um rastreador web.

## Metodologia

O artigo é formal, não empírico. Ele define objetos replicados como tuplas: objetos baseados em estado têm payload, consulta, atualização e merge, enquanto os baseados em operações dividem cada atualização em um método de preparação, sem efeitos colaterais, na origem e um método de efeito que roda em todas as réplicas. Um histórico causal, dispositivo de raciocínio que implementações não precisam ter, define entrega, acontece-antes e concorrência.

Cada condição suficiente vira um teorema. Os exemplos de CRDT são então especificados nesse estilo e conferidos contra as condições. Para o grafo, os autores partem de um experimento mental (um buscador cujos rastreadores constroem o grafo da web de forma assíncrona), comparam três formas de tratar `addArc` e `removeVertex` concorrentes e escolhem uma. A versão da conferência omite as provas do teorema do CvRDT e do grafo, remetendo a um relatório técnico complementar. Não há implementação nem medição.

## Resultados

- **CvRDT e CmRDT bastam para a SEC.** A convergência baseada em estado exige entrega eventual, terminação e o semirreticulado monotônico; a baseada em operações exige entrega causal e atualizações concorrentes que comutam.
- **Sem consenso e com tolerância extrema a falhas.** Um objeto SEC tolera até n - 1 falhas simultâneas, e qualquer subconjunto de réplicas que se comunicam converge mesmo isolado do resto.
- **SEC e consistência sequencial são incomparáveis.** Com semântica "add vence", uma réplica executa `add(e); remove(e')` e outra `add(e'); remove(e)`. Ao mesclar, o conjunto contém `e` e `e'`, estado que nenhuma execução sequencial produz. No sentido inverso, a consistência sequencial exige consenso, que falha com n - 1 falhas.
- **Contadores e conjuntos a partir de peças monotônicas.** Um vetor mesclado pelo máximo por índice é um CvRDT e, com uma entrada por processo, é o relógio vetorial. Um contador com incremento e decremento usa dois contadores só de incremento, com valor `|I| - |D|`. O U-Set guarda um conjunto A de adições e um conjunto R de tombstones e devolve `A \ R`.
- **A coleta de lixo do log dispensa consenso, mas só progride se nenhum processo estiver parado.** Uma entrada pode ser descartada quando seu timestamp fica abaixo de todos os relógios vetoriais remotos.
- **O grafo força uma escolha de projeto.** As opções são deixar `removeVertex` vencer e esconder os arcos incidentes, deixar `addArc` vencer e restaurar vértices, ou atrasar o `removeVertex`, o que exige sincronização. O artigo adota a primeira, reconhece que não há escolha perfeita e mostra que o conjunto baseado em operações dispensa tombstones graças à entrega causal. Um add e um remove concorrentes do mesmo vértice se resolvem a favor do add.

## Análise crítica

O artigo dá à consistência eventual um alvo preciso, e as duas condições envelheceram bem. Limites que valem lembrar:

- **Sem implementação nem avaliação.** Os autores deixam biblioteca, aplicações e avaliação de desempenho como trabalho futuro, então o custo de metadados, tombstones e tamanho dos vetores não é medido aqui.
- **O custo das garantias está escondido nas premissas.** Objetos baseados em operações precisam de broadcast causal confiável, os baseados em estado precisam que o estado continue circulando, e a coleta de lixo do log trava se algum processo estiver parado.
- **Ausência de conflito não é preservação de invariantes.** O CRDT precisa escolher uma resolução para atualizações concorrentes (add vence, remove vence, último escritor), e essa política pode não servir à aplicação. O próprio projeto do grafo admite que não há escolha perfeita.
- **"Uma solução para o problema do CAP" é uma troca, não uma fuga.** A SEC abre mão da consistência forte, como os autores dizem, e o artigo não afirma o contrário.
- **As provas do grafo ficam fora do texto da conferência,** então o leitor precisa do relatório complementar para verificar o exemplo central.
- **Livro vs hoje.** O artigo apresenta CvRDT e CmRDT como o quadro completo. O trabalho posterior avançou para projetos práticos, como CRDTs de delta-estado, que enviam só a parte do estado que mudou, e bibliotecas de CRDT usadas em edição colaborativa e em bancos de dados. A premissa do U-Set de que cada elemento é adicionado só uma vez foi relaxada por projetos de conjunto posteriores.

## Pesquisas futuras

- Quais computações os CRDTs conseguem realizar, suas classes de complexidade e as classes de invariantes que podem sustentar.
- Relações entre CRDTs e autoestabilização e agregação.
- Uma biblioteca dos tipos especificados, aplicações reais e avaliação de desempenho analítica e experimental.
- Suporte a operações síncronas raras e não críticas, como consolidar um estado ou fazer um reset global.
- Invariantes globais mais fortes, possivelmente com técnicas probabilísticas ou heurísticas.
- Onde o modelo termina: [falhas bizantinas](/papers/byzantine-generals-problem) e [BFT prático](/papers/practical-byzantine-fault-tolerance) estão fora das premissas não bizantinas, e as garantias mais fortes continuam vindo de serviços de coordenação como o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) e o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), com a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) como contraste.
