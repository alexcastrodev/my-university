---
version: 1.0
updatedAt: 2026-08-18
title: "Skip Lists: Uma Alternativa Probabilística às Árvores Balanceadas"
description: "Uma lista encadeada ordenada aumentada com níveis de \"pista expressa\" randomizados, onde cada elemento é independentemente promovido ao nível i+1 com probabilidade 1/d; diferente de AVL/red-black trees, que garantem altura O(log n) via rotações/recoloração determinísticas, uma skip list obtém tempo esperado O(log n) só a partir da aleatoriedade, sem nenhuma lógica de rebalanceamento."
---
## Objetivo

Entenda skip lists: uma lista encadeada ordenada aumentada com níveis de "pista expressa" randomizados, onde um elemento promovido ao nível `i+1` permite que uma busca pule por cima de tudo abaixo dele. Diferente dos concepts irmãos de AVL trees e red-black trees, que garantem altura O(log n) através de lógica de rebalanceamento determinística (rotações, recoloração) disparada em toda inserção, uma skip list obtém seu tempo *esperado* O(log n) de busca/inserção/remoção só a partir da aleatoriedade — nenhum código de rotação, nenhum bit de cor, nenhuma passada de rebalanceamento jamais roda.

## Casos de Uso

- Qualquer implementação de map/set ordenado onde o custo de *quem implementa* de escrever e testar corretamente a lógica de rotação importa tanto quanto o custo de tempo de execução de *quem usa* — o código de inserção/remoção de uma skip list é uma fração do tamanho do de uma AVL ou red-black tree, porque não há invariantes estruturais a reparar após uma modificação, só ponteiros para frente a religar.
- Estruturas ordenadas concorrentes/lock-free — o sorted set (`ZSET`) do Redis é implementado internamente como uma skip list pareada com uma hash table especificamente porque uma inserção em skip list só toca o punhado de nós diretamente ligados ao novo nó, enquanto o rebalanceamento de uma árvore balanceada pode tocar uma porção grande e imprevisível da árvore e precisaria de um locking muito mais grosseiro.
- Listas de postings de motores de busca (por exemplo, Apache Lucene), onde uma lista ordenada de IDs de documento é aumentada com ponteiros de salto para que interseccionar duas listas de postings longas não exija percorrer todo elemento da mais curta.
- Consultas de intervalo e estatísticas de ordem sobre streams de chaves já ordenadas ou quase ordenadas, onde a simplicidade de implementação de uma skip list frequentemente supera a garantia de pior caso marginalmente melhor de uma AVL tree.

## Aprofundamento

### A ideia central: uma hierarquia de listas encadeadas cada vez mais esparsas

Uma skip list é construída em camadas. O nível 0 é uma lista encadeada ordenada comum contendo todo elemento. Cada nível superior é uma "pista expressa": um elemento presente no nível `i` também está presente no nível `i+1` com alguma probabilidade fixa `q = 1/d` (o **fator de expansão** `d > 1` controla isso; `d = 2` é a escolha clássica, dando `q = 1/2` — literalmente um cara-ou-coroa por elemento por nível). Um elemento que "ganha o cara-ou-coroa" no nível `i` é promovido ao nível `i+1` e o sorteio se repete lá, então níveis superiores contêm exponencialmente menos elementos: o nível `k` guarda um número esperado de `n/d^k` elementos de um total de `n`. A cabeça da lista é um nó sentinela presente em todo nível, alto o suficiente para alcançar o nível máximo atualmente em uso.

```
nível 2:  head ------------------------------------> 17 --------------------------> NIL
nível 1:  head --------------> 6 ------> 9 --------> 17 --------> 21 --------------> NIL
nível 0:  head -> 3 -> 6 -> 7 -> 9 -> 12 -> 17 -> 19 -> 21 -> 25 -> 26 -> NIL
```

Cada nó é uma chave mais um array `forward[]` de referências, uma por nível em que o nó participa — um nó no nível 2 tem um `forward[]` de 3 slots (índices 0, 1, 2), cada slot apontando para o próximo nó que também existe naquele nível:

```java
class SkipListNode<K> {
    K key;
    SkipListNode<K>[] forward;   // forward[i] = próximo nó no nível i, ou null (NIL)

    @SuppressWarnings("unchecked")
    SkipListNode(K key, int level) {
        this.key = key;
        this.forward = (SkipListNode<K>[]) new SkipListNode[level + 1];
    }
}
```

### Sem rotações, sem recoloração — o balanceamento é probabilístico, não estrutural

Este é o contraste fundamental com os concepts irmãos `avl-trees` e `red-black-trees`. Ambas essas estruturas fazem uma promessa *determinística* ("a altura nunca excede `X`") e pagam por isso com lógica de rebalanceamento que roda em toda inserção e remoção: AVL trees rastreiam um fator de balanceamento por nó e rotacionam no instante em que ele sai de `{-1, 0, 1}`; red-black trees rastreiam um bit de cor por nó e rodam um fixup de múltiplos casos após toda inserção. Uma skip list não faz promessa determinística nenhuma — uma sequência de sorteios excepcionalmente ruins poderia, em princípio, produzir uma skip list que degenera para uma única lista de nível 0 ininterrupta, dando busca O(n). O que ela garante em vez disso é *probabilístico*: com o nível de cada elemento escolhido independentemente ao acaso, o custo de busca **esperado** é O(log n), e a probabilidade de uma busca custar significativamente mais que isso encolhe exponencialmente conforme `n` cresce — um comportamento ruim é possível, mas tão improvável na prática que nenhuma sequência de entrada fixa consegue dispará-lo de forma confiável (compare com uma BST simples não balanceada, onde uma entrada específica e fácil de construir — inserção em ordem crescente — *sempre* a degrada para uma lista encadeada).

O ganho prático: a inserção e a remoção de uma skip list são apenas "busque, depois religue alguns poucos ponteiros" — sem análise de casos, sem rotação, sem propagação de cor pela árvore. A própria comparação de Pugh, do artigo que introduziu skip lists, deixa explícita a implicação para concorrência:

> "A implementação mais usada de uma árvore de busca binária é uma red-black tree. Os problemas de concorrência aparecem quando a árvore é modificada — frequentemente ela precisa rebalancear. A operação de rebalanceamento pode afetar grandes porções da árvore, o que exigiria um mutex lock em muitos dos nós da árvore. Inserir um nó numa skip list é muito mais localizado — só os nós diretamente ligados ao nó afetado precisam ser travados."

### Busca: comece na pista expressa do topo, desça quando não puder ir à direita

A busca começa na cabeça, no *nível máximo atual* — a pista mais esparsa — e repete uma regra: mova-se à direita enquanto a chave do próximo nó ainda for menor que o alvo; no momento em que não for (porque a próxima chave é grande demais, ou não há próximo nó nesse nível), desça um nível e tente de novo. Chegar ao nível 0 sem mais para onde ir significa checar se o nó em que você parou logo antes é de fato o alvo.

```java
K search(K key) {
    SkipListNode<K> x = head;
    for (int i = level; i >= 0; i--) {
        while (x.forward[i] != null && less(x.forward[i].key, key)) {
            x = x.forward[i];
        }
        // x agora é o último nó no nível i com uma chave estritamente menor que `key`
    }
    x = x.forward[0];                 // candidato: o sucessor no nível base
    return (x != null && x.key.equals(key)) ? x.key : null;
}
```

### Trace resolvido: buscando por 21

Considere a skip list de 10 elementos `3, 6, 7, 9, 12, 17, 19, 21, 25, 26` com esta atribuição de níveis (resultado dos próprios sorteios de cada elemento): `head` e `17` alcançam o nível 2 (o máximo atual); `6`, `9` e `21` alcançam o nível 1; todo outro elemento — `3`, `7`, `12`, `19`, `25`, `26` — existe só no nível 0. Isso produz exatamente o diagrama de três níveis mostrado acima. Buscando por `21`:

1. **Nível 2, em `head`.** `head.forward[2] = 17`. `17 < 21`? Sim — mova à direita. Agora em `17`. `17.forward[2] = NIL`. Nada menor que 21 para onde ir — desça ao nível 1, ainda em `17`.
2. **Nível 1, em `17`.** `17.forward[1] = 21`. `21 < 21`? Não (igual não é "menor que") — não pode mover à direita. Desça ao nível 0, ainda em `17`.
3. **Nível 0, em `17`.** `17.forward[0] = 19`. `19 < 21`? Sim — mova à direita. Agora em `19`. `19.forward[0] = 21`. `21 < 21`? Não — não pode mover à direita. Sem mais níveis para descer.
4. **Checagem final.** `x = x.forward[0] = 21`. `21.key == 21` — encontrado.

Quatro comparações no total, e o único salto de nível 2 de `head` direto para `17` é o ponto inteiro: pulou por cima de `3, 6, 7, 9, 12` — cinco nós da lista base — em um único passo. Uma busca em lista encadeada simples por `21` teria percorrido os dez nós um a um; esta busca só tocou três (`17`, `19`, `21`).

### Veja acontecendo: a mesma busca, nível por nível

Cada elemento é desenhado como um nó por nível em que participa (por exemplo, "17" aparece três vezes — uma por nível que alcança), empilhado numa coluna e ligado por uma aresta "torre" vertical, exatamente como o diagrama ASCII acima. Uma aresta horizontal é um ponteiro `forward[]` real naquele nível; uma aresta vertical é usada aqui apenas para representar *descer* um nível no mesmo elemento, nunca um ponteiro real que uma busca segue lateralmente.

```viz
type: graph
node H_L2 H 0 0
node H_L1 H 0 1
node H_L0 H 0 2
node n3_L0 3 1 2
node n6_L1 6 2 1
node n6_L0 6 2 2
node n7_L0 7 3 2
node n9_L1 9 4 1
node n9_L0 9 4 2
node n12_L0 12 5 2
node n17_L2 17 6 0
node n17_L1 17 6 1
node n17_L0 17 6 2
node n19_L0 19 7 2
node n21_L1 21 8 1
node n21_L0 21 8 2
node n25_L0 25 9 2
node n26_L0 26 10 2
edge H_L0 n3_L0 directed
edge n3_L0 n6_L0 directed
edge n6_L0 n7_L0 directed
edge n7_L0 n9_L0 directed
edge n9_L0 n12_L0 directed
edge n12_L0 n17_L0 directed
edge n17_L0 n19_L0 directed
edge n19_L0 n21_L0 directed
edge n21_L0 n25_L0 directed
edge n25_L0 n26_L0 directed
edge H_L1 n6_L1 directed
edge n6_L1 n9_L1 directed
edge n9_L1 n17_L1 directed
edge n17_L1 n21_L1 directed
edge H_L2 n17_L2 directed
edge H_L2 H_L1
edge H_L1 H_L0
edge n6_L1 n6_L0
edge n9_L1 n9_L0
edge n17_L2 n17_L1
edge n17_L1 n17_L0
edge n21_L1 n21_L0
---
visit H_L2 | Comece na cabeça, no nível máximo atual (2) -- a pista expressa mais esparsa.
traverse H_L2 n17_L2 | forward[2] = "17", e 17 < 21 -- mova à direita.
visit n17_L2 | Agora em "17" no nível 2.
traverse n17_L2 n17_L1 | forward[2] = NIL em "17" -- nada mais para onde ir. Desça ao nível 1 (ainda em "17").
visit n17_L1 | Agora em "17" no nível 1.
traverse n17_L1 n17_L0 | forward[1] = "21", mas 21 < 21 é falso (igual não é "menor que") -- não pode mover à direita. Desça ao nível 0 (ainda em "17").
visit n17_L0 | Agora em "17" no nível 0 -- a lista base, nada mais para pular.
traverse n17_L0 n19_L0 | forward[0] = "19", e 19 < 21 -- mova à direita.
visit n19_L0 | Agora em "19".
traverse n19_L0 n21_L0 | forward[0] = "21", e 21 < 21 é falso -- sem mais níveis para descer. O sucessor é o próprio "21".
visit n21_L0 | x = x.forward[0] = "21" -- as chaves batem. Encontrado, tendo tocado só "17", "19", "21".
```

### Inserção: busque primeiro, depois emende em cada nível até uma altura sorteada

A inserção roda a mesma busca descendente para encontrar, em todo nível, o último nó cuja chave ainda é menor que a nova chave — o algoritmo de Pugh chama isso de array `update[]`, uma entrada por nível, e é exatamente o conjunto de nós cujos ponteiros `forward[]` precisam ser religados. Uma vez encontrado o ponto de inserção, uma altura é sorteada para o novo nó — independentemente de sua chave, usando o mesmo processo de cara-ou-coroa que construiu a altura de todo outro nó — e o nó é emendado em todo nível de 0 até essa altura religando exatamente os ponteiros `update[i]` em cada um desses níveis.

```
RandomLevel(q):                       # q = 1/d, a probabilidade de promoção
    level = 1
    while random() < q and level < maxLevel:
        level = level + 1
    return level
```

Com `q = 0.5`, isso é literalmente "continue jogando uma moeda; toda cara aumenta o nível em um; pare na primeira coroa (ou em `maxLevel`)" — que é exatamente por que o número esperado de nós no nível `i` é `n / 2^i`. Se o nível sorteado exceder o máximo atual da lista, o próprio array `forward[]` do nó cabeça cresce para acompanhar, com os novos slots superiores inicializados apontando diretamente para o novo nó (não há mais nada naquele nível ainda).

Como os sorteios são independentes a cada vez, inserir o mesmo *conjunto* de chaves duas vezes, em duas execuções diferentes, produz duas skip lists com formatos diferentes — não existe uma "a" skip list canônica para um dado conjunto de chaves, só uma família de formatos igualmente prováveis.

### Complexidade: por que O(log n) decorre da geometria, não de uma prova sobre rotações

O número esperado de níveis que uma skip list precisa para `n` elementos decorre diretamente da regra de promoção: o nível `k` tem um número esperado de `n/d^k` elementos, e a lista precisa de níveis suficientes para que o topo tenha esperadamente só um nó (a cabeça) — resolvendo `n/d^k = 1` dá `k = log_d(n)`, então uma skip list de `n` elementos tem um número esperado de `1 + log_d(n)` níveis. Uma busca visita algum número de nós por nível antes de descer; como cada nível tem (em média) `d` vezes menos nós que o de baixo, o número esperado de movimentos à direita *por nível* é uma pequena constante (`d/2`), independente de `n`. Multiplicar "níveis esperados" por "movimentos esperados por nível" dá o custo total esperado de busca: `(d/2) · (1 + log_d(n)) = O(log_d n)` — logarítmico, para qualquer `d` fixo.

O espaço esperado segue um argumento de série geométrica parecido: somar `n + n/d + n/d^2 + ...` (os `n` nós do nível 0, o `n/d` do nível 1, e assim por diante) é uma série geométrica que converge para `n·d/(d-1)` — linear em `n`, ou seja, O(n), o mesmo espaço assintótico de que uma lista encadeada simples precisa, só com um overhead de fator constante pelos slots `forward[]` extras.

### Ajustando o fator de expansão `d`: um botão direto de tempo/espaço

`d` é um botão real e quantificável entre velocidade de busca e memória: com `d = 2`, o tempo esperado é `log_2(n)` e o espaço esperado é `2n`. Com `d = 10`, o tempo esperado se torna `(10/2)·log_10(n) = 5·log_10(n) ≈ 1.5·log_2(n)` — cerca de 50% mais lento — mas o espaço esperado cai para `10n/9 ≈ 1.11n`, mal mais que uma lista encadeada simples. Não existe almoço grátis aqui: um `d` maior significa que menos elementos são promovidos a pistas expressas, então as pistas economizam menos tempo, mas também custam menos memória para manter. Essa é uma troca deliberada e ajustável de um jeito que AVL e red-black trees não expõem — o balanceamento dessas estruturas é tudo-ou-nada (ou o invariante se mantém ou é ativamente reparado), não um botão.

## Trade-offs

- **Garantia probabilística, não de pior caso.** Toda operação é O(log n) *esperado*; uma sequência de sorteios azarados pode em princípio produzir comportamento O(n). Na prática esse risco não é uma preocupação séria — nenhuma sequência fixa de chaves pode ser construída de antemão para dispará-lo de forma confiável, diferente do pior caso de entrada ordenada de uma BST simples — mas é uma distinção real em relação ao limite de altura O(log n) incondicional de AVL/red-black trees.
- **Código de inserção/remoção dramaticamente mais simples, ao custo dessa garantia.** Não há análise de casos a errar — nenhuma direção de rotação a escolher, nenhuma cor a propagar — o que é exatamente por que skip lists são uma escolha comum para estruturas ordenadas concorrentes (o `ZSET` do Redis) onde o rebalanceamento de uma red-black tree exigiria travar uma fatia grande e imprevisível da árvore.
- **O fator de expansão `d` é uma troca genuína e ajustável de tempo/espaço** (veja acima) — não há botão único equivalente numa árvore balanceada; AVL/red-black trees fixam seu invariante de balanceamento por definição.
- **A remoção tem um caso extremo que vale a pena conhecer**: remover um nó que era o *único* elemento no nível máximo atual esvazia esse nível inteiramente, e o nível máximo rastreado da lista precisa encolher em um (ou mais) para acompanhar — pular essa contabilidade deixa níveis superiores pendurados, permanentemente vazios.
- **AVL trees ainda podem vencer em cargas de trabalho com muita remoção e não ordenadas.** Empiricamente, skip lists tendem a superar AVL trees quando as chaves chegam já ordenadas (ou quase) e quando as consultas se inclinam para "quantos elementos são menores que X" ou remoção de intervalo; AVL trees permanecem preferíveis quando a busca é a operação dominante sobre chegadas de chave não ordenadas, já que sua garantia de pior caso é incondicional.

## Documentation Links

- [William Pugh, "Skip Lists: A Probabilistic Alternative to Balanced Trees," *Communications of the ACM*, Vol. 33, No. 6 (junho de 1990), pp. 668–676](https://dl.acm.org/doi/10.1145/78973.78977) — doc
- [Skip Lists: A Probabilistic Alternative to Balanced Trees — cópia hospedada gratuitamente do artigo original de Pugh (cs.umd.edu)](https://ftp.cs.umd.edu/pub/skipLists/skiplists.pdf) — doc
- [Skip list — Wikipedia](https://en.wikipedia.org/wiki/Skip_list) — doc
