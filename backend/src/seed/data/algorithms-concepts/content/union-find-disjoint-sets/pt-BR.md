---
version: 1.0
updatedAt: 2026-08-13
title: "Union-Find: de Quick-Find a Tempo Quase Constante com Path Compression"
description: "Percorre a estrutura de dados union-find por quick-find, quick-union, weighted quick-union e path compression — o clássico problema de conectividade dinâmica resolvido com florestas baseadas em array progressivamente mais rápidas, terminando em O(α(n)) amortizado, na prática efetivamente constante."
---
## Objetivo

Entenda o problema da *conectividade dinâmica* — dado um fluxo de operações "conecte p a q", responda consultas "p e q estão conectados?" de forma eficiente — e percorra a estrutura de dados union-find por quatro refinamentos sucessivos (quick-find, quick-union, weighted quick-union, weighted quick-union com path compression) que a levam de O(n) por union até O(α(n)) amortizado, efetivamente tempo constante para qualquer n que possa existir na prática.

## Casos de Uso

- Conectividade de rede e grafo social: "o site p consegue alcançar o site q através de conexões existentes?" sem recomputar o grafo inteiro a cada consulta.
- O algoritmo de minimum spanning tree de Kruskal usa union-find para detectar, em tempo quase constante, se adicionar uma aresta criaria um ciclo.
- Processamento de imagem / percolação: agrupar pixels ou sites adjacentes em regiões conectadas (o exemplo motivador de Sedgewick & Wayne é literalmente percolação em química física).
- Ferramentas de compilador e linguagem: o primeiro uso documentado (FORTRAN) foi determinar se dois nomes de variável declarados são referências equivalentes — um problema de classe de equivalência, exatamente o que union-find resolve.

## Aprofundamento

### O problema da conectividade dinâmica e o quick-find

Sedgewick & Wayne enquadram o problema como ler uma sequência de pares de inteiros `p q`, onde "p está conectado a q" é uma relação de equivalência (reflexiva, simétrica, transitiva), filtrando pares que já são implicados por pares anteriores. Eles especificam a API como `UF(int N)`, `union(p, q)`, `find(p)`, `connected(p, q)`, `count()` — com `connected(p, q)` implementado em toda parte simplesmente como `find(p) == find(q)`.

A primeira implementação, **quick-find**, mantém um array `id[]` indexado por site onde `id[i]` é sempre o identificador *canônico* do componente do site `i` — todo site que compartilha um componente tem o mesmo valor de `id[]`:

```java
public class QuickFindUF {
    private int[] id;

    public QuickFindUF(int n) {
        id = new int[n];
        for (int i = 0; i < n; i++) id[i] = i;
    }

    public int find(int p) { return id[p]; }

    public void union(int p, int q) {
        int pID = find(p);
        int qID = find(q);
        if (pID == qID) return;
        for (int i = 0; i < id.length; i++)
            if (id[i] == pID) id[i] = qID;
    }
}
```

`find` é uma única leitura de array — O(1). Mas `union` precisa reescrever *toda* entrada atualmente marcada `pID` para `qID`, uma varredura O(n) do array inteiro independentemente de quão pequenos sejam os dois componentes. A Proposição F de Sedgewick & Wayne fixa o custo entre "N+3 e 2N+1 acessos a array" por union que de fato mescla componentes, e observam que reduzir um grafo de N sites a um único componente exige pelo menos N-1 unions — empurrando o custo total para Θ(N²). A conclusão deles é direta: quick-find "não consegue resolver de forma viável" problemas grandes de conectividade dinâmica.

### Quick-union — e como uma cadeia se forma

**Quick-union** reinterpreta o mesmo array: `id[i]` deixa de ser um id canônico e passa a ser um *ponteiro de pai*. Cada site se liga a outro site do seu componente (possivelmente ele mesmo); `find` sobe pelos ponteiros de pai até uma raiz — um site que é seu próprio pai:

```java
public class QuickUnionUF {
    private int[] parent;

    public QuickUnionUF(int n) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    public int find(int p) {
        while (p != parent[p]) p = parent[p];
        return p;
    }

    public void union(int p, int q) {
        int rootP = find(p);
        int rootQ = find(q);
        if (rootP == rootQ) return;
        parent[rootP] = rootQ;
    }
}
```

`union` agora é barato — uma busca de raiz de cada lado mais uma única reescrita de ponteiro. Mas nada impede que a floresta resultante cresça alta e estreita, porque a raiz sendo relinkada é escolhida arbitrariamente (sempre a raiz de `rootP`, pendurada sob a raiz de `rootQ`). Sedgewick & Wayne constroem exatamente esse pior caso: alimente os pares `0-1`, `0-2`, `0-3`, ... em ordem. Traçando o array à mão, a cadeia se forma:

```
union(0, 1): parent = [1, 1, 2, 3, 4]   // 0 -> 1
union(0, 2): parent = [1, 2, 2, 3, 4]   // find(0) percorre 0->1, chega à raiz 1; parent[1] = 2
union(0, 3): parent = [1, 2, 3, 3, 4]   // find(0) percorre 0->1->2, chega à raiz 2; parent[2] = 3
union(0, 4): parent = [1, 2, 3, 4, 4]   // find(0) percorre 0->1->2->3, chega à raiz 3; parent[3] = 4
```

Depois de N-1 unions desse tipo, a árvore tem altura N-1 — o site 0 agora está a N-1 saltos da raiz. Todo `find(0)` subsequente custa O(N). A Proposição G do livro deixa isso preciso: `find` custa "1 mais duas vezes a profundidade" do nó, então uma sequência como essa leva o custo total a Θ(N²) no pior caso — nem melhor que quick-find, só com o custo movido de `union` para `find`.

### Weighted quick-union por tamanho

A correção que Sedgewick & Wayne chamam de **weighted quick-union**: rastrear o tamanho de cada árvore e, ao unir, sempre anexar a raiz da árvore *menor* sob a raiz da árvore *maior*, em vez de escolher arbitrariamente:

```java
public class WeightedQuickUnionUF {
    private int[] parent;
    private int[] size;
    private int count;

    public WeightedQuickUnionUF(int n) {
        count = n;
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    }

    public int find(int p) {
        while (p != parent[p]) p = parent[p];
        return p;
    }

    public void union(int p, int q) {
        int rootP = find(p);
        int rootQ = find(q);
        if (rootP == rootQ) return;
        if (size[rootP] < size[rootQ]) { parent[rootP] = rootQ; size[rootQ] += size[rootP]; }
        else                            { parent[rootQ] = rootP; size[rootP] += size[rootQ]; }
        count--;
    }
}
```

Só o método `union` mudou — `find` é idêntico ao quick-union puro — mas essa pequena mudança limita a altura de forma provável. A intuição por trás da Proposição H de Sedgewick & Wayne: toda vez que a profundidade de um nó aumenta em 1 (porque sua árvore foi anexada sob outra), a árvore à qual ele agora pertence pelo menos *dobrou* de tamanho (já que, por construção, ela não era maior do que a árvore com a qual se mesclou). Uma árvore só pode dobrar de tamanho lg N vezes antes de conter todos os N sites, então nenhum nó pode acabar mais fundo que lg N. Isso limita todo `find`, `union` e `connected` a O(log N) no pior caso — uma garantia que o quick-union puro nunca teve. A heurística estruturalmente idêntica do Cormen sobre uma representação em lista encadeada (a "heurística de union ponderado," Teorema 19.1) prova o mesmo argumento de duplicação formalmente: uma sequência de m operações, n delas `MAKE-SET`, custa O(m + n lg n).

### Path compression — achatando a árvore durante o find

A otimização final se empilha diretamente sobre o union ponderado: enquanto `find` já está subindo até a raiz, faça todo nó pelo qual ele passa apontar *diretamente* para a raiz, achatando a árvore para todo `find` futuro nesse caminho. Sedgewick & Wayne descrevem isso como aproximar a busca O(1) do quick-find sem o custo O(n) de union do quick-find. Uma implementação compacta em duas passadas:

```java
public int find(int p) {
    int root = p;
    while (root != parent[root]) root = parent[root];   // passada 1: localizar a raiz
    while (p != root) {                                  // passada 2: achatar o caminho
        int next = parent[p];
        parent[p] = root;
        p = next;
    }
    return root;
}
```

O Cormen apresenta a mesma ideia recursivamente na variante "union por rank" (rank é um limite superior para a altura, rastreado em vez de tamanho, mas com o mesmo espírito de "anexar a árvore mais rasa sob a mais alta"):

```java
private int findSet(int x) {
    if (x != parent[x]) {
        parent[x] = findSet(parent[x]);   // path compression no caminho de volta
    }
    return parent[x];
}
```

O efeito em uma cadeia, antes e depois de uma única chamada `find`:

```
Antes de find(0):
índice:  0  1  2  3  4
parent:  1  2  3  4  4     // 0 -> 1 -> 2 -> 3 -> 4 (raiz)

find(0) percorre a cadeia até a raiz 4, depois relinca todo nó que visitou:

Depois de find(0):
índice:  0  1  2  3  4
parent:  4  4  4  4  4     // todo nó aponta diretamente para a raiz
```

Todo `find` futuro sobre 0, 1, 2 ou 3 agora é um único acesso a array. Combinado com union ponderado, a Seção 19.4 do Cormen prova que isso gera tempo de execução no pior caso de **O(m·α(n))** para uma sequência de m operações sobre n elementos, onde α é a função inversa de Ackermann — uma função que cresce tão devagar que α(n) ≤ 4 para qualquer n até aproximadamente o número de átomos no universo observável. A própria tabela de desempenho de Sedgewick & Wayne enuncia o mesmo resultado de forma mais informal: weighted quick-union com path compression custa "muito, muito perto, mas não exatamente 1" acesso a array por operação, amortizado. Na prática: para qualquer n que você algum dia consiga de fato rodar, path compression mais union ponderado é O(1) por operação.

## Trade-offs

- **Quick-find e o quick-union puro são degraus pedagógicos, não escolhas de produção** — quick-find só é competitivo quando chamadas de `find`/`connected` superam em muito as chamadas de `union` (raro), e o quick-union puro não tem garantia alguma de pior caso; Sedgewick & Wayne apresentam ambos puramente para motivar por que a ponderação importa.
- **A ponderação fornece a garantia de *pior caso*; path compression sozinho não** — o Cormen é explícito ao dizer que union por rank *ou* path compression sozinhos já melhoram a floresta ingênua, mas é a *combinação* que gera o limite O(m·α(n)); pular a ponderação e depender só de path compression deixa um limite teoricamente mais fraco (embora ainda muito bom).
- **Nenhum algoritmo consegue garantir O(1) verdadeiro no pior caso por operação** — Sedgewick & Wayne observam que, sob o modelo geral de computação "cell-probe", nenhum algoritmo union-find consegue garantir tempo constante amortizado para toda operação; weighted quick-union com path compression é essencialmente o teto prático, não uma prova de que O(1) no pior caso é alcançável.
- **O JDK não tem classe union-find embutida** — diferente de `TreeMap`/`TreeSet`, que se apoiam em uma red-black tree, não existe um `java.util.UnionFind`; você implementa a estrutura de ~15 linhas baseada em array você mesmo sempre que um algoritmo (MST de Kruskal, componentes conectados, detecção de ciclo) precisa dela.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 1.5 "Case Study: Union-Find", pp. 216-231 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 19 "Data Structures for Disjoint Sets", Seções 19.1-19.4, pp. 520-533 — doc
- [Princeton Algorithms, 4th Ed. — Union-Find (companion site, with UF.java source)](https://algs4.cs.princeton.edu/15uf/) — doc
- [Disjoint-set data structure — Wikipedia](https://en.wikipedia.org/wiki/Disjoint-set_data_structure) — doc
