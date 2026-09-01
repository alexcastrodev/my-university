---
version: 1.0
updatedAt: 2026-08-18
title: "AVL Trees: Árvores de Busca Balanceadas por Altura via Rotação"
description: "AVL trees são a primeira árvore de busca binária autobalanceada já publicada (1962), corrigindo a maior fraqueza de uma BST simples — a altura, e o custo de toda operação, dependerem da ordem de inserção e degradarem para O(n) — ao limitar o fator de balanceamento de todo nó a {-1, 0, 1} e restaurá-lo via rotações simples ou duplas após cada inserção/remoção, garantindo altura O(log n) incondicionalmente."
---
## Objetivo

Entenda as AVL trees — a primeira árvore de busca binária autobalanceada já publicada (1962) — como a correção direta para a única fraqueza real de uma BST simples (coberta separadamente): sua altura, e portanto o custo de toda operação, depende inteiramente da ordem de inserção e pode degradar para O(n) em entrada ordenada. AVL trees anexam um invariante a todo nó — o **fator de balanceamento**, a diferença de altura entre suas subárvores esquerda e direita, limitado a -1, 0 ou 1 — e o restauram com rotações após cada inserção ou remoção, garantindo altura O(log n) incondicionalmente, não apenas em média.

## Casos de Uso

- Qualquer tabela de símbolos ordenada onde buscas superam em muito inserções e remoções, e o limite de altura mais apertado possível importa mais que o custo de atualização — o fator de balanceamento da AVL é limitado a ±1 por nó (red-black trees, cobertas separadamente, toleram mais folga), então uma AVL tree é comprovadamente pelo menos tão baixa quanto, e geralmente mais baixa que, uma red-black tree sobre as mesmas chaves, o que torna toda busca um pouco mais rápida ao preço de atualizações mais caras.
- O ponto de comparação direto sempre que red-black trees surgem: "por que `TreeMap` simplesmente não usa AVL, se é mais estritamente balanceada?" é uma pergunta de acompanhamento natural, respondida abaixo em Trade-offs.
- Valor histórico/fundacional — todo esquema posterior de árvore balanceada (red-black trees, árvores 2-3, B-trees) está resolvendo exatamente o mesmo problema de "limitar a altura para que operações não degradem para O(n)" que as AVL trees resolveram primeiro, apenas com uma estratégia de rebalanceamento diferente e uma tolerância diferente ao desbalanceamento.
- Índices com muita leitura e pouca escrita (uma estrutura de busca majoritariamente estática, reconstruída ou carregada em lote ocasionalmente) — um caso onde o balanceamento mais estrito da AVL, e portanto suas buscas mais rápidas, se paga precisamente porque atualizações são raras.

## Aprofundamento

### O fator de balanceamento: o único invariante que limita a altura

Uma BST simples não tem salvaguarda estrutural alguma: inserir chaves já em ordem crescente anexa todo novo nó como único filho do anterior, degenerando a árvore numa lista encadeada com altura O(n) — busca, inserção e remoção todas se tornam O(n) em vez do O(log n) que uma árvore balanceada promete. AVL trees fecham essa lacuna definindo, para todo nó `x`, um **fator de balanceamento**:

```
x.b = h(x.left) - h(x.right)
```

onde `h(T)` é a altura da subárvore `T` (uma subárvore vazia tem altura 0). Uma árvore está **AVL-balanceada** exatamente quando o fator de balanceamento de todo nó está em `{-1, 0, 1}` — nenhum nó pode pender mais de um nível para nenhum dos lados. Essa única restrição por nó, mantida continuamente, é o que limita a altura da árvore inteira a O(log n): uma árvore em que todo nó está apenas levemente desbalanceado não consegue esconder em nenhum lugar um caminho O(n) de profundidade.

Cada nó armazena sua própria altura diretamente (`h`), em vez de recalculá-la percorrendo subárvores a cada consulta, então a altura de um nó é lida em O(1) e só recalculada para os O(log n) ancestrais tocados por uma inserção ou remoção:

```java
class AVLNode {
    int key;
    int height;         // 1 + max(altura dos filhos); uma subárvore vazia tem altura 0
    AVLNode left, right, parent;
}

static int height(AVLNode z) {
    return z == null ? 0 : z.height;
}

static int balanceFactor(AVLNode z) {
    return z == null ? 0 : height(z.left) - height(z.right);
}
```

### Rotações: a única ferramenta que corrige um desbalanceamento

Exatamente uma operação repara um fator de balanceamento quebrado: uma **rotação**, que reestrutura um pequeno pedaço da árvore preservando a propriedade de ordenação da BST (tudo continua se lendo da esquerda para a direita em ordem crescente). Existem duas rotações básicas, e duas "rotações duplas" construídas a partir delas.

**Rotação à esquerda** — usada quando um nó `x` está pesado à direita (`x.b < -1`): seu filho direito `y` sobe para tomar o lugar de `x`, `x` se torna o novo filho esquerdo de `y`, e o que costumava ser a subárvore esquerda de `y` (`β`) é reanexada como a nova subárvore direita de `x` (ela continua sendo maior que `x` e menor que `y`, então a ordenação se mantém):

```java
static AVLNode rotateLeft(AVLNode x) {
    AVLNode y = x.right;
    AVLNode beta = y.left;
    x.right = beta;
    if (beta != null) beta.parent = x;
    y.left = x;
    y.parent = x.parent;
    // quem chama é responsável por religar y ao antigo pai de x (raiz, ou slot de filho esquerdo/direito)
    x.parent = y;
    x.height = 1 + Math.max(height(x.left), height(x.right));
    y.height = 1 + Math.max(height(y.left), height(y.right));
    return y; // y é a nova raiz desta subárvore
}
```

**Rotação à direita** é a imagem espelhada — usada quando um nó está pesado à esquerda (`x.b > 1`): seu filho esquerdo sobe, e a subárvore direita desse filho é reanexada como a nova subárvore esquerda do pivô.

```java
static AVLNode rotateRight(AVLNode y) {
    AVLNode x = y.left;
    AVLNode beta = x.right;
    y.left = beta;
    if (beta != null) beta.parent = y;
    x.right = y;
    x.parent = y.parent;
    y.parent = x;
    y.height = 1 + Math.max(height(y.left), height(y.right));
    x.height = 1 + Math.max(height(x.left), height(x.right));
    return x; // x é a nova raiz desta subárvore
}
```

Uma única rotação basta apenas quando o desbalanceamento é uma linha reta (a subárvore esquerda do filho esquerdo cresceu, ou a subárvore direita do filho direito cresceu — os casos **LL** e **RR**). Quando a nova chave cai no lado *interno* em vez disso — um nó pesado à direita cujo filho esquerdo é ele próprio pesado à esquerda, ou vice-versa (os casos **LR** e **RL**) — uma única rotação não basta e deixaria a árvore igualmente desbalanceada do outro lado. Esses precisam de duas rotações em sequência, primeiro puxando o neto interno para a posição de seu pai, depois rotacionando de novo no nó original:

```java
static AVLNode rotateLeftRight(AVLNode z) { // caso LR
    z.left = rotateLeft(z.left);
    return rotateRight(z);
}

static AVLNode rotateRightLeft(AVLNode z) { // caso RL
    z.right = rotateRight(z.right);
    return rotateLeft(z);
}
```

### Inserção: inserção comum de BST, depois rebalanceamento de baixo para cima

Inserir numa AVL tree é uma inserção comum de BST — desce comparando chaves, anexa o novo nó como folha — seguida de uma caminhada de baixo para cima de volta à raiz que recalcula a altura de cada ancestral e checa seu fator de balanceamento, corrigindo o *primeiro* nó encontrado desbalanceado (o mais próximo da nova folha):

```java
static AVLNode insert(AVLNode node, int key) {
    if (node == null) return new AVLNode(key);

    if (key < node.key) node.left = insert(node.left, key);
    else if (key > node.key) node.right = insert(node.right, key);
    else return node; // chave duplicada: no-op

    node.height = 1 + Math.max(height(node.left), height(node.right));
    int b = balanceFactor(node);

    if (b > 1 && key < node.left.key)  return rotateRight(node);     // Caso LL
    if (b < -1 && key > node.right.key) return rotateLeft(node);     // Caso RR
    if (b > 1 && key > node.left.key)  return rotateLeftRight(node); // Caso LR
    if (b < -1 && key < node.right.key) return rotateRightLeft(node); // Caso RL

    return node; // já balanceado, nada a fazer
}
```

Como só o caminho da nova folha de volta à raiz pode ter mudado de altura, no máximo um nó ao longo desse caminho é encontrado desbalanceado, e corrigi-lo com no máximo **uma rotação simples, ou uma rotação dupla**, sempre restaura todos os fatores de balanceamento da árvore para `{-1, 0, 1}` — a inserção nunca precisa de uma segunda correção não relacionada mais acima.

### Veja acontecendo: inserir 30, 20, 10 dispara uma rotação LL

Inserir três chaves decrescentes constrói uma cadeia reta pesada à esquerda — o caso LL de livro-texto — verificado à mão contra a lógica de rotação acima: `rotate-right` no nó desbalanceado ("30") promove seu filho esquerdo ("20") a raiz da subárvore, "10" permanece filho esquerdo de "20", e "30" se torna filho direito de "20".

```viz
type: tree
insert 30 30 | Insere 30 como raiz.
insert 20 20 parent=30 side=left | 20 < 30 -- vai para a esquerda.
insert 10 10 parent=20 side=left | 10 < 30, depois 10 < 20 -- vai para a esquerda de novo. Três nós agora formam uma cadeia reta pesada à esquerda: 30 -> 20 -> 10.
mark 30 | Caminhando de volta a partir da nova folha, "30" é o primeiro ancestral cujo fator de balanceamento sai de {-1,0,1}: sua subárvore esquerda tem altura 2, sua subárvore direita (vazia) tem altura 0, então b = 2. A nova chave (10) é menor que a chave do filho esquerdo de "30" (20) -- o caso LL.
rotate-right 30 | Rotação simples à direita em "30": "20" se torna a nova raiz da subárvore, "10" permanece seu filho esquerdo, "30" se torna seu filho direito. Todos os fatores de balanceamento voltam para dentro de {-1,0,1}.
insert 25 25 parent=30 side=left | 25 > 20 (a nova raiz), então desce à direita até "30"; depois 25 < 30, então se torna filho esquerdo de "30". Nenhuma rotação necessária -- "20" continua balanceado (b = -1), já que só uma subárvore cresceu um nível.
```

### A remoção também precisa de rebalanceamento, e pode se propagar mais longe que a inserção

A remoção começa da mesma forma que a de uma BST simples — uma folha é removida diretamente, um nó com um filho é substituído por seu filho, e um nó com dois filhos é substituído por seu sucessor em ordem (que garantidamente tem no máximo um filho, então removê-*lo* reduz de volta a um dos dois primeiros casos). O que muda em relação à inserção é onde a caminhada de rebalanceamento começa e quão longe pode viajar: depois de extrair o nó real, a AVL retraça os ancestrais para cima a partir do antigo pai do nó *substituído*, recalculando alturas e rotacionando no primeiro ancestral desbalanceado encontrado — mas diferente da inserção, corrigir esse ancestral não garante que todo ancestral acima dele continue balanceado, já que uma rotação durante a remoção pode *reduzir* a altura da subárvore em um, o que pode propagar o desbalanceamento ainda mais para cima na árvore. Então uma remoção pode exigir rebalanceamento em múltiplos ancestrais no caminho de volta à raiz, não só um.

## Trade-offs

- **Balanceamento estritamente mais apertado que red-black trees, ao custo de atualizações mais caras.** A altura de uma red-black tree é limitada por `2 log₂(n+1)`; a de uma AVL tree é limitada mais estritamente, próxima de `1.44 log₂(n+2)` — então buscas AVL são mais rápidas no pior caso. O preço é que o invariante mais estrito `{-1,0,1}` da AVL precisa de rebalanceamento com mais frequência e pode exigir mais trabalho de rotação na remoção do que o invariante mais frouxo de uma red-black tree.
- **É exatamente por isso que `TreeMap`/`TreeSet` usam red-black trees, não AVL** — os próprios mapas ordenados do JDK favorecem um esquema com rebalanceamento mais barato e mais localizado em vez de um com um limite de altura marginalmente mais apertado, sob o raciocínio de que cargas de trabalho reais misturam leituras e escritas e raramente precisam da garantia mais estrita da AVL.
- **Tanto rotações simples quanto duplas são O(1)** — uma rotação toca apenas um número constante de ponteiros e dois campos de altura, independentemente do tamanho da subárvore — então mesmo que inserção ou remoção possam disparar uma rotação em cada nível percorrido de volta à raiz, o custo total de rebalanceamento permanece O(log n) por operação, batendo com o próprio limite de altura.
- **Inserção precisa de no máximo uma correção; remoção pode precisar de várias** — a caminhada de baixo para cima de uma inserção para no primeiro ancestral desbalanceado, porque restaurá-lo é comprovadamente suficiente para rebalancear a árvore inteira. A rotação de rebalanceamento de uma remoção pode encolher a altura daquela subárvore, o que pode desbalancear um ancestral mais acima — então a caminhada de rebalanceamento da remoção pode precisar continuar, checando e corrigindo ancestrais até a raiz.
- **Book vs. hoje**: este concept (o fator de balanceamento, os quatro casos de rotação, e sua tradução para Java) vem das próprias figuras trabalhadas de uma apostila de curso universitário, não de *Algorithms* de Sedgewick & Wayne ou de *Introduction to Algorithms* de Cormen et al. — nenhum dos dois livros cobre AVL trees em suas edições atuais (4ª); ambos usam red-black trees (ou, no caso de Sedgewick & Wayne, left-leaning red-black BSTs) como seu exemplo de árvore balanceada. Não espere encontrar os casos de rotação da AVL descritos dessa forma em nenhum dos dois livros.

## Documentation Links

- [AVL tree — Wikipedia](https://en.wikipedia.org/wiki/AVL_tree) — doc
