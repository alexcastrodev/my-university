---
version: 1.0
updatedAt: 2026-09-06
title: "Algoritmos de Roteamento: Link-State vs. Distance-Vector"
summary: "As duas famílias de algoritmos de roteamento não são teoria dos grafos nova: o roteamento link-state roda o algoritmo de Dijkstra, já coberto por completo, sobre um grafo de topologia conhecido globalmente, enquanto o roteamento distance-vector roda o algoritmo de Bellman-Ford, também já coberto, com cada roteador conhecendo só os custos dos seus vizinhos. A fraqueza real e honesta do distance-vector é o problema da contagem ao infinito quando um enlace falha."
---
## Objetivos de Aprendizagem

- Explicar que o roteamento link-state é o algoritmo de Dijkstra, já coberto, rodado sobre um grafo de topologia conhecido globalmente, e não teoria dos grafos nova.
- Explicar que o roteamento distance-vector é o algoritmo de Bellman-Ford, já coberto, rodado de forma distribuída, com cada roteador conhecendo só os custos dos seus vizinhos.
- Enunciar a informação real que cada abordagem exige que um roteador tenha, e por que essa diferença tem consequências reais e práticas para o modo como cada protocolo de fato opera.
- Rastrear o problema da contagem ao infinito no roteamento distance-vector numa topologia pequena e concreta, e explicar por que ele acontece.
- Conectar este conceito aos protocolos reais (OSPF, BGP) que o próximo conceito cobre, que são implementações concretas destas duas famílias algorítmicas.

## Contexto e Motivação

Os três conceitos anteriores cobriram o encaminhamento: a mecânica do plano de dados de usar uma tabela de encaminhamento já construída. Este conceito se volta para o plano de controle: como uma rede de fato calcula bons caminhos, a questão de algoritmos de roteamento que a distinção entre plano de dados e plano de controle, vários conceitos atrás, deixou de lado exatamente para este ponto do bloco. A notícia genuinamente boa é que este não é material novo a aprender do zero: o roteamento link-state é o algoritmo de Dijkstra, já coberto por completo em `algorithms`, e o roteamento distance-vector é o algoritmo de Bellman-Ford, também já coberto lá. O trabalho real deste conceito é conectar esses algoritmos de grafos já compreendidos à restrição específica e real que as redes acrescentam: os roteadores não têm acesso livre e instantâneo a uma imagem compartilhada e correta da topologia da rede inteira, do jeito que o grafo de entrada de um livro-texto de algoritmos pressupõe.

## Teoria Central

### Modelando uma rede como um grafo

Uma rede de roteadores e enlaces mapeia diretamente num grafo: os roteadores são nós, os enlaces entre roteadores são arestas, e cada aresta tem um custo (que pode representar distância física, atraso, ou simplesmente "1" se só a contagem de saltos importa). Encontrar um caminho "bom" de um roteador a outro é, nesse enquadramento, exatamente o problema do caminho mínimo, o mesmo problema para o qual `algorithms` já desenvolveu duas soluções completas e reais.

### Roteamento link-state: o algoritmo de Dijkstra, aplicado

No roteamento link-state, todo roteador primeiro obtém um conhecimento completo e preciso da topologia da rede inteira (todo roteador e o custo de todo enlace, em toda a rede), normalmente via um broadcast de estado de enlace, em que cada roteador inunda informações sobre os seus próprios enlaces diretamente conectados para todos os outros roteadores da rede. Uma vez que um roteador tem esse grafo de topologia completo, ele roda o algoritmo de Dijkstra, exatamente como já coberto, calculando os caminhos mínimos de si mesmo até todos os outros roteadores da rede. A coisa genuinamente nova que o roteamento link-state acrescenta, em relação ao próprio algoritmo já coberto, é o mecanismo distribuído (a inundação) pelo qual todo roteador obtém o mesmo grafo de topologia completo e consistente, para começo de conversa. O cálculo de caminho mínimo, uma vez com esse grafo em mãos, é Dijkstra inalterado.

### Roteamento distance-vector: Bellman-Ford, distribuído

No roteamento distance-vector, nenhum roteador jamais tem uma imagem completa da topologia da rede: cada roteador conhece só o custo para alcançar cada um dos seus próprios vizinhos diretamente conectados, e troca periodicamente as suas próprias distâncias estimadas atuais até cada destino com esses mesmos vizinhos (nunca com a rede inteira). Esta é uma aplicação direta e distribuída da ideia central do algoritmo de Bellman-Ford, já coberto: um roteador atualiza a sua própria distância mínima estimada até um destino com base na distância anunciada por um vizinho até esse destino mais o custo do enlace até esse vizinho. Isso se repete iterativamente pela rede inteira até que as estimativas de todo roteador convirjam, sem que nenhum roteador isolado jamais precise do grafo de topologia completo que o roteamento link-state exige.

### A diferença prática real: quanto cada roteador precisa saber

O roteamento link-state exige que todo roteador guarde e processe uma cópia da topologia da rede inteira: mais memória e computação por roteador, mas cada roteador calcula as suas próprias rotas de forma independente e correta, uma vez, a partir de uma imagem completa e consistente. O roteamento distance-vector exige só conhecimento local (os vizinhos do próprio roteador e os custos para alcançá-los): menos memória e computação mais simples por roteador, mas a convergência depende de rodadas repetidas de comunicação entre vizinhos e, como a próxima seção cobre, pode sofrer de um problema genuíno de corretude que a abordagem de conhecimento global do link-state não tem.

### O problema da contagem ao infinito

A dependência do roteamento distance-vector de informações possivelmente desatualizadas e indiretas vindas dos vizinhos (em vez de um conhecimento direto e completo da topologia) cria um modo de falha real quando um enlace falha. Um roteador que perde a sua rota direta até um destino pode, antes de ter processado a falha corretamente, receber de um vizinho uma distância anunciada até esse mesmo destino que está ela mesma baseada numa rota pelo enlace que acabou de falhar (uma informação que o vizinho ainda não atualizou). Os dois roteadores podem acabar incrementando as estimativas de distância um do outro, de lá para cá, lentamente "contando" em direção ao infinito em vez de reconhecer corretamente que o destino agora está inalcançável por aquele caminho: uma falha de convergência lenta e indesejável que os Exemplos Resolvidos deste conceito rastreiam concretamente. O roteamento link-state, como todo roteador recalcula as rotas a partir de um grafo de topologia completo e recém-atualizado depois de qualquer mudança, não sofre deste modo de falha específico.

## Exemplos Resolvidos

### Exemplo 1: O roteamento link-state como literalmente o algoritmo de Dijkstra

Uma rede tem os roteadores A, B, C, D com os seguintes custos de enlace: A-B: 1, B-C: 2, A-C: 4, C-D: 1. Todo roteador, via inundação link-state, aprende essa topologia inteira. O roteador A agora roda o algoritmo de Dijkstra (exatamente o mesmo algoritmo, com exatamente a mesma garantia de corretude, já coberto por completo) sobre esse grafo, calculando:

```text
Caminho mínimo de A até B: A-B, custo 1
Caminho mínimo de A até C: A-B-C, custo 3 (mais barato que a aresta
  direta A-C, custo 4)
Caminho mínimo de A até D: A-B-C-D, custo 4
```

Nada neste cálculo difere do algoritmo já coberto. O único elemento genuinamente novo que o roteamento link-state acrescenta é que A precisou primeiro obter esse grafo completo via inundação, uma informação que, num cenário puro de livro-texto de algoritmos, é simplesmente entregue ao algoritmo como entrada.

### Exemplo 2: Convergência distance-vector via a regra de atualização central de Bellman-Ford

Usando a mesma topologia, mas agora via distance-vector: o roteador B inicialmente conhece só os custos até os seus vizinhos diretos (até A: 1, até C: 2). O roteador C compartilha as suas próprias estimativas de distância atuais com B: "a minha distância até D é 1." B aplica exatamente a regra de relaxamento de Bellman-Ford, já coberta: "passar por C é mais barato do que o que eu sei atualmente?"

```text
Estimativa atual de B até D: desconhecida (infinito)
Distância anunciada por C até D: 1
Custo do enlace B-C: 2

Nova estimativa de B até D, via C: 2 (custo do enlace) + 1 (distância de C até D) = 3
Como 3 < infinito (a estimativa anterior de B), B atualiza: distância até D = 3
```

Este é o passo de relaxamento idêntico ao de Bellman-Ford, aplicado aqui num cenário distribuído em que B só vê a distância anunciada por C, nunca o grafo de topologia subjacente que C usou para calculá-la.

### Exemplo 3: Rastreando a contagem ao infinito depois de uma falha de enlace

Três roteadores em linha: A-B-C, com A-B de custo 1 e B-C de custo 1. A rota de A até C é via B, custo 2. Agora o enlace B-C falha.

```text
1. B perde o seu enlace direto até C. A distância PRÓPRIA de B até C
   passa a ser infinito (reconhecido corretamente).
2. ANTES de B ter propagado esta atualização, A ainda acredita que a sua
   rota antiga (distância até C = 2, via B) é válida e, conforme o seu
   cronograma normal de atualizações periódicas, anuncia a B: "a minha
   distância até C é 2."
3. B, ainda sem saber que a rota de A TAMBÉM passava pelo enlace B-C agora
   quebrado, calcula incorretamente: distância até C via A = 1 (custo do
   enlace A-B) + 2 (distância anunciada por A) = 3. B atualiza a sua
   distância até C: 3.
4. B agora anuncia "distância até C é 3" de volta para A.
5. A, vendo a distância nova e maior de B, recalcula a SUA PRÓPRIA
   distância até C via B: 1 (custo do enlace A-B) + 3 (a distância agora
   atualizada de B) = 4.
6. Esta troca continua, com as estimativas de distância até C de A e de B
   incrementando lentamente de lá para cá (3, 4, 5, 6, ...) em vez de
   convergir corretamente para "C é inalcançável": contagem ao infinito.
```

A causa raiz fica visível diretamente no rastreamento: a rota de distância 2 de A passava silenciosamente pelo próprio enlace que acabou de falhar, e B, sem nenhuma visão global da topologia, não tem como reconhecer isso sem mecanismos adicionais (como split-horizon ou poison-reverse, mitigações parciais reais não desenvolvidas mais neste conceito introdutório) além da regra básica de atualização de Bellman-Ford.

## Equívocos Comuns e Armadilhas

- **"Link-state e distance-vector são algoritmos inteiramente novos, inventados especificamente para redes."** São aplicações diretas e distribuídas do algoritmo de Dijkstra e do algoritmo de Bellman-Ford, respectivamente, ambos já cobertos por completo em `algorithms`. O material genuinamente novo aqui é o mecanismo distribuído (inundação, ou troca iterativa entre vizinhos) que cada abordagem usa para obter a informação de que o seu algoritmo subjacente precisa, e não o cálculo de caminho mínimo em si.
- **"O roteamento distance-vector é simplesmente uma versão inferior do roteamento link-state."** O distance-vector exige muito menos informação e computação por roteador (só conhecimento local, no nível dos vizinhos, contra um grafo de topologia completo): uma vantagem real e legítima em redes com recursos limitados ou muito grandes, trocada pela fraqueza genuína de corretude do distance-vector (a contagem ao infinito), que o link-state não compartilha.
- **"A contagem ao infinito acontece porque Bellman-Ford é um algoritmo falho."** O algoritmo de Bellman-Ford já coberto, recebendo um grafo completo e estático como entrada, é totalmente correto. A contagem ao infinito surge especificamente do cenário *distribuído* e com informação limitada do roteamento distance-vector, em que os roteadores agem com base em informações desatualizadas e indiretas de vizinhos que ainda não propagaram uma mudança de topologia, um problema que o próprio algoritmo, rodado de forma centralizada sobre um grafo completo, nunca encontra.
- **"Todo roteador numa rede link-state calcula rotas diferentes, potencialmente inconsistentes."** Assumindo que todo roteador recebe a mesma informação de topologia, completa e correta, via inundação, todo roteador roda o cálculo de Dijkstra idêntico sobre o grafo idêntico e chega a resultados de caminho mínimo globalmente consistentes: uma garantia real de corretude que a abordagem de conhecimento global do link-state oferece e que a abordagem puramente local e iterativa do distance-vector não oferece.

## Resumo

O roteamento link-state e o roteamento distance-vector não são algoritmos de grafos novos: são o algoritmo de Dijkstra e o algoritmo de Bellman-Ford, ambos já cobertos por completo, aplicados sob as restrições reais e distribuídas das redes. O roteamento link-state primeiro inunda informações completas de topologia para todo roteador, que então roda Dijkstra de forma independente sobre esse grafo compartilhado e completo, garantindo rotas globalmente consistentes e corretas ao custo de exigir que todo roteador guarde e processe a topologia da rede inteira. O roteamento distance-vector exige só conhecimento local, no nível dos vizinhos, aplicando iterativamente a regra de relaxamento de Bellman-Ford via troca periódica de estimativas de distância com os vizinhos imediatos: uma abordagem mais leve, com uma fraqueza de corretude real e bem conhecida, a contagem ao infinito, que pode surgir quando um enlace falha e informações de distância desatualizadas e indiretas circulam entre os roteadores antes de convergirem corretamente. O próximo conceito conecta as duas famílias algorítmicas a protocolos reais e implantados (o OSPF, link-state, e o BGP, um primo do distance-vector guiado por políticas) na escala real da Internet.

## Documentation Links

- [Stanford CS144: Lecture Schedule ("Routing 1", "Routing 2")](https://www.scs.stanford.edu/10au-cs144/sched/): uma sequência de aulas de um curso real dedicada às duas famílias de algoritmos de roteamento.
- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do roteamento link-state e distance-vector, incluindo o problema da contagem ao infinito.
