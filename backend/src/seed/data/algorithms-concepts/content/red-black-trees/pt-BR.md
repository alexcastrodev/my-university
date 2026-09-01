---
version: 1.0
updatedAt: 2026-08-13
title: "Árvores Rubro-Negras: Altura O(log n) Garantida"
description: "As cinco propriedades rubro-negras, os casos de insert-fixup do CLRS (recoloração e rotação) traçados manualmente e verificados, e por que TreeMap/TreeSet usam isso em vez de uma BST comum."
---
## Objetivo

Entenda árvores rubro-negras: uma árvore binária de busca auto-balanceada que garante altura O(log n) no pior caso — não só na média — restringindo as cores dos nós durante toda inserção e remoção, que é exatamente a garantia que uma BST comum (coberta separadamente) não dá.

## Casos de Uso

- Entender o que `TreeMap`/`TreeSet` realmente são por baixo dos panos — o JDK implementa ambos como árvores rubro-negras especificamente para obter uma garantia de altura no pior caso que uma BST comum não consegue oferecer.
- Um tópico padrão avançado de estruturas de dados — espere ser cobrado a declarar as cinco propriedades de memória e traçar uma inserção manualmente.
- A porta de entrada conceitual para outras estruturas de balanceamento garantido (árvores AVL, B-trees) — árvores rubro-negras são as que a maioria dos bancos de dados de produção e runtimes de linguagem realmente usam.

## Aprofundamento

### As cinco propriedades

O CLRS define uma árvore rubro-negra como uma árvore binária de busca com um bit extra por nó — sua cor — satisfazendo cinco propriedades:

```
1. Todo nó é vermelho ou preto.
2. A raiz é preta.
3. Toda folha (NIL) é preta.
4. Se um nó é vermelho, ambos os filhos são pretos.        (nenhum vermelho seguido de outro)
5. Todo caminho de um nó até qualquer folha descendente     (mesma altura-negra
   tem o mesmo número de nós pretos.                         em todo caminho)
```

A propriedade 5 é a que faz o trabalho de verdade: ela garante que o caminho raiz-a-folha *mais curto* não pode ser menor que metade do comprimento do *mais longo*, porque a propriedade 4 limita quantos nós vermelhos consecutivos podem aparecer entre dois nós pretos em qualquer caminho. O CLRS prova a partir disso que uma árvore rubro-negra com n nós tem altura no máximo 2·log₂(n+1) — O(log n), garantido, não apenas esperado.

### Inserção: insira vermelho, depois corrija violações

`RB-INSERT` faz uma inserção comum de BST (a mesma descida-e-anexação mostrada no conceito de BST comum), depois colore o novo nó de **vermelho**, e depois chama `RB-INSERT-FIXUP` para reparar o que essa escolha de coloração possa ter quebrado. Colorir o novo nó de vermelho (em vez de preto) é deliberado: só pode violar a propriedade 2 (se ele for a raiz) ou a propriedade 4 (se o pai dele também for vermelho) — nunca a propriedade 5, já que um nó vermelho com dois filhos `NIL` pretos não muda a contagem de nós pretos de nenhum caminho.

`RB-INSERT-FIXUP` trata uma violação vermelho-vermelho com três casos, verificados em ordem:

```
Caso 1 — o tio do novo nó é vermelho:      recolore o pai e o tio de preto, o avô de vermelho,
                                             depois continue corrigindo a partir do avô.
Caso 2 — tio é preto, o novo nó é um       rotaciona para transformar isto no Caso 3.
          neto "em ziguezague" (interno):
Caso 3 — tio é preto, o novo nó é um       recolore o pai de preto e o avô de vermelho,
          neto "em linha reta" (externo):  depois rotaciona no avô. Pronto.
```

O caso 1 empurra o problema mais para cima na árvore sem nenhuma rotação (barato, mas a violação pode recorrer mais acima). Os casos 2-3 usam exatamente as rotações do mecanismo de rotação da BST comum para corrigir as coisas no lugar, em no máximo duas rotações no total, encerrando a correção. A última linha de `RB-INSERT-FIXUP` recolore incondicionalmente a raiz de preto — o caso 1 pode deixar a raiz vermelha se a violação se propagar até o topo, e essa linha é o que restaura a propriedade 2 depois disso.

### Veja acontecendo: inserindo 10, 20, 30, 15 numa árvore vazia

Traçado à mão contra os próprios casos de `RB-INSERT-FIXUP` do CLRS — toda recoloração e rotação abaixo é exatamente o que o algoritmo faz, não um atalho:

```viz
type: tree
insert 10 10 color=red | O novo nó sempre começa vermelho -- RB-INSERT o colore de vermelho primeiro.
recolor 10 black | A raiz precisa sempre ser preta (propriedade 2) -- a última linha da correção enegrece a raiz incondicionalmente.
insert 20 20 parent=10 side=right color=red | "20" > "10" -- inserido à direita, vermelho. O pai ("10") é preto: sem violação, sem correção necessária.
insert 30 30 parent=20 side=right color=red | "30" > "20" -- inserido à direita, vermelho. O pai ("20") é vermelho: violação. O tio (o outro filho de "10", NIL) é preto.
recolor 20 black | Caso 3 (tio preto, linha reta): recolore o pai de preto...
recolor 10 red | ...e o avô de vermelho...
rotate-left 10 | ...depois rotaciona à esquerda no avô. "20" toma a antiga posição de "10".
insert 15 15 parent=10 side=right color=red | "15" > "10", "15" < "20" -- inserido como filho direito de "10", vermelho. O pai ("10") é vermelho: violação. O tio ("30") também é vermelho.
recolor 10 black | Caso 1 (tio vermelho): recolore o pai de preto...
recolor 30 black | ...e o tio de preto...
recolor 20 red | ...e o avô de vermelho, depois continue corrigindo a partir do avô.
recolor 20 black | "20" é a raiz -- a última linha da correção a enegrece de novo.
```

## Trade-offs

- **Altura O(log n) garantida, ao custo de contabilidade extra em toda inserção/remoção** — a inserção numa BST comum é uma simples descida-e-anexação; uma inserção rubro-negra é essa mesma descida mais uma passada de correção que pode disparar recoloração e até duas rotações. O ganho é que uma árvore rubro-negra não consegue degradar para a forma de uma lista encadeada como uma BST comum com ordem de inserção azarada consegue.
- **Livro vs. livro, não livro vs. hoje**: Sedgewick e Wayne cobrem uma formulação diferente — a **BST rubro-negra left-leaning**, derivada de árvores 2-3, onde a cor vive em *links* em vez de *nós* e todo link vermelho precisa inclinar para a esquerda por construção. É comprovadamente equivalente nas garantias que dá (mesmo limite de altura O(log n)), mas os invariantes e o código de rebalanceamento têm uma cara diferente da coloração por nó do CLRS mostrada acima — não misture os dois conjuntos de regras ao implementar um ou outro de memória.
- **`TreeMap`/`TreeSet` usam árvores rubro-negras, não a BST comum do conceito irmão** — esse é o ganho direto da garantia de altura: um `TreeMap` construído a partir de entrada já ordenada permanece O(log n) para toda operação, onde a BST comum equivalente degradaria para O(n).
- **Remoção é mais difícil que inserção, e fora do escopo aqui** — `RB-DELETE-FIXUP` tem quatro casos em vez de três e pode exigir até três rotações; o kit de ferramentas central de recolorir-e-rotacionar é o mesmo que a inserção usa, mas a análise de casos é mais densa e merece uma passada dedicada própria em vez de um resumo de um parágrafo.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 13 "Red-Black Trees", Seções 13.1 e 13.3, pp. 331-334, 338-345 — book
- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 3.3 "Balanced Search Trees" (BSTs rubro-negras left-leaning), pp. 424-433 — book
- [TreeMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html) — doc
