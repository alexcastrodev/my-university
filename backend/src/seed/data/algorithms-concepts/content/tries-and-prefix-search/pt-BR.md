---
version: 1.0
updatedAt: 2026-08-13
title: "Tries: Chaves de String como Caminhos, Não Comparações"
description: "Uma trie armazena chaves de string implicitamente como o caminho da raiz até o nó, dando custo de busca/inserção proporcional ao comprimento da chave em vez do número de chaves (diferente de uma BST, cujo custo depende de N via altura da árvore); a ternary search trie (TST) reduz o custo de espaço da trie R-way usando 3 links por nó em vez de um array de R slots, e ambas as estruturas suportam de forma única consultas de prefixo como autocomplete e correspondência de prefixo mais longo."
---
## Objetivo

Entenda a trie (árvore de recuperação): uma estrutura de tabela de símbolos construída especificamente para chaves de string, onde uma chave é representada implicitamente pelo *caminho* da raiz até um nó — nunca armazenada explicitamente em lugar nenhum — e por que esse design faz o custo de busca/inserção na trie depender só do comprimento da chave, não de quantas chaves há na tabela.

## Casos de Uso

- Implementar buscas baseadas em prefixo — "me dê toda chave começando com `pre`" ou "qual é a chave mais longa que é prefixo desta string de consulta" — operações que uma BST ou hash table não suportam naturalmente de jeito nenhum.
- Autocomplete/typeahead, corretores ortográficos, e tabelas de roteamento IP (correspondência de prefixo mais longo), todos que na verdade são `keysWithPrefix()` ou `longestPrefixOf()` disfarçados.
- Entender o trade-off espaço/tempo que motiva a ternary search trie (TST) quando o alfabeto ou o conjunto de chaves cresce — o mesmo trade-off que aparece toda vez que um array "largo mas esparso" é substituído por uma árvore de busca embutida.

## Aprofundamento

### A ideia central: uma chave é um caminho, não um valor armazenado

Um nó de trie guarda um array de `R` links (um slot por possível próximo caractere) mais um valor, que é `null` a menos que uma chave realmente termine naquele nó. Nada na estrutura armazena um caractere ou uma string — a chave só existe como a sequência de escolhas de link que você seguiu para chegar lá. Insira `"cat"`, `"car"`, `"cup"`, e `"cats"` (nessa ordem) numa trie inicialmente vazia:

```
insert("cat", 1); insert("car", 2); insert("cup", 3); insert("cats", 4);

root
 └── 'c' → node
             ├── 'a' → node
             │          ├── 't' → node [val=1]   ("cat")
             │          │           └── 's' → node [val=4]   ("cats")
             │          └── 'r' → node [val=2]   ("car")
             └── 'u' → node
                        └── 'p' → node [val=3]   ("cup")
```

Repare no nó alcançado por `'t'`: ele tem um valor não nulo (1, para `"cat"`) *e* um link de filho para `'s'` (continuando até `"cats"`) — um único nó pode ser simultaneamente o fim de uma chave e um ponto de passagem rumo a outra. Todos os outros links em todo nó (as outras 253+ letras na raiz, as outras 24 letras sob `'c'`, e assim por diante) são nulos; diagramas reais simplesmente os omitem.

Busca e inserção ambas só percorrem a chave caractere por caractere, seguindo (ou criando) links:

```java
public class TrieST<Value> {
    private static final int R = 256; // radix ASCII estendido
    private Node root;

    private static class Node {
        private Object val;
        private Node[] next = new Node[R];
    }

    public Value get(String key) {
        Node x = get(root, key, 0);
        if (x == null) return null;
        return (Value) x.val;
    }

    private Node get(Node x, String key, int d) {
        if (x == null) return null;                 // caiu fora da trie -- miss
        if (d == key.length()) return x;             // consumiu a chave inteira
        char c = key.charAt(d);
        return get(x.next[c], key, d + 1);
    }

    public void put(String key, Value val) {
        root = put(root, key, val, 0);
    }

    private Node put(Node x, String key, Value val, int d) {
        if (x == null) x = new Node();               // cria nós conforme necessário
        if (d == key.length()) { x.val = val; return x; }
        char c = key.charAt(d);
        x.next[c] = put(x.next[c], key, val, d + 1);
        return x;
    }
}
```

`get` desce um caractere de cada vez; se consumir a chave inteira, retorna o nó onde pousou (cujo `val` ainda pode ser `null` — um miss de busca mesmo com todo caractere batendo com um link, por exemplo buscando `"ca"` acima). `put` faz a descida idêntica, criando um novo `Node` onde faltar um link, e define o valor no nó que corresponde ao último caractere.

### Por que o tempo de busca depende do comprimento da chave, não da quantidade de chaves

Essa é a propriedade principal da trie, e ela é exata, não uma vagueza assintótica: buscar ou inserir uma chave toca **no máximo `1 + key.length()` nós**, ponto final — independentemente de quantas outras chaves estão na trie. O parâmetro recursivo `d` acima começa em 0, avança um por chamada, e a recursão sempre para em `d == key.length()`; nada nesse limite envolve `N`, o número de chaves armazenadas.

Compare isso com uma árvore binária de busca (veja o conceito irmão de BST): toda operação de BST custa tempo proporcional à *altura* da árvore, e altura é uma função de `N` — `Θ(log N)` se a árvore for balanceada, `Θ(N)` no pior caso. Mesmo no melhor caso, o custo de uma BST genuinamente cresce conforme mais chaves são adicionadas. O custo de uma trie não: uma trie contendo 10 chaves de sete caracteres e uma trie contendo 10 milhões de chaves de sete caracteres resolvem ambas `get("license")` em no máximo 8 visitas a nós. As duas estruturas não são apenas "as duas mais ou menos logarítmicas" — uma limita o custo pelo comprimento da chave, a outra limita o custo pela quantidade de chaves, e essas são variáveis diferentes.

(Um fato relacionado de caso médio que vale conhecer: uma busca sem sucesso numa trie construída a partir de `N` chaves aleatórias sobre um alfabeto de tamanho `R` examina em média só cerca de `log_R(N)` nós, porque um único link ausente perto da raiz geralmente encerra a busca imediatamente — buscas sem sucesso costumam ser ainda mais baratas do que o limite de comprimento sugere.)

### O problema de espaço, e o conserto da ternary search trie (TST)

A fraqueza da trie R-way é o espaço: todo nó aloca um array de `R` links, mesmo que para qualquer dataset real quase todos esses links sejam nulos (um nó sob `'q'` ainda reserva 256 slots para conter, realisticamente, um ou dois links vivos). O número de links numa trie construída a partir de `N` chaves de comprimento médio `w` fica entre `R·N` e `R·N·w` — para um alfabeto grande (digamos `R = 256` ou os 65.536 do Unicode) e chaves longas (URLs, números de conta), aquele fator constante `R` domina e pode queimar gigabytes de links para um conjunto de chaves modesto.

A ternary search trie (TST) conserta isso dando a cada nó apenas **três** links — `left`, `mid`, `right` — mais um caractere e um valor, em vez de um array de `R` slots. É equivalente a substituir o array R-way em cada posição da trie por uma pequena árvore binária de busca embutida sobre só os caracteres que realmente ocorrem ali: compare o caractere atual da chave com o caractere do nó; vá para `left` se menor, `right` se maior, ou tome `mid` (e avance para o próximo caractere da chave) numa correspondência.

```java
public class TST<Value> {
    private Node root;

    private class Node {
        char c;                        // caractere neste nó
        Node left, mid, right;         // menor / igual / maior
        Value val;
    }

    public Value get(String key) {
        Node x = get(root, key, 0);
        return (x == null) ? null : x.val;
    }

    private Node get(Node x, String key, int d) {
        if (x == null) return null;
        char c = key.charAt(d);
        if      (c < x.c) return get(x.left, key, d);
        else if (c > x.c) return get(x.right, key, d);
        else if (d < key.length() - 1) return get(x.mid, key, d + 1);
        else return x;
    }

    public void put(String key, Value val) {
        root = put(root, key, val, 0);
    }

    private Node put(Node x, String key, Value val, int d) {
        char c = key.charAt(d);
        if (x == null) { x = new Node(); x.c = c; }
        if      (c < x.c) x.left  = put(x.left,  key, val, d);
        else if (c > x.c) x.right = put(x.right, key, val, d);
        else if (d < key.length() - 1) x.mid = put(x.mid, key, val, d + 1);
        else x.val = val;
        return x;
    }
}
```

O ganho: uma TST construída a partir de `N` chaves de comprimento médio `w` precisa de apenas `3N` a `3Nw` links — nenhum multiplicador `R` de jeito nenhum, então ela escala com o número de *caracteres*, não com o tamanho do alfabeto. O custo é uma lentidão modesta: como cada "passo de caractere" agora percorre uma pequena BST em vez de um único acesso a array, a busca ganha aproximadamente um fator multiplicativo `ln R` por caractere em média. Para qualquer alfabeto grande o suficiente para tornar o espaço da trie R-way um problema real (ASCII, e especialmente Unicode), essa é uma boa troca — bem menos memória desperdiçada por uma busca que, na prática, continua quase tão rápida.

### Para que tries (e TSTs) servem que BSTs e hash tables não servem

Uma hash table dá lookup exato rápido mas destrói qualquer relação entre chaves parecidas — uma vez hasheadas, `"shell"` e `"shells"` não têm nada em comum. Uma BST mantém as chaves ordenadas e suporta consultas de intervalo/floor/ceiling, mas "toda chave começando com este prefixo" ainda significa varrer um intervalo sem nenhum atalho estrutural ligado ao próprio prefixo.

Numa trie, um prefixo *é* uma subtrie: percorrer a trie ao longo dos caracteres de `prefix` te leva exatamente ao nó que enraíza a subtrie de toda chave que começa com `prefix` — nada mais precisa ser comparado.

```java
public Iterable<String> keysWithPrefix(String prefix) {
    Queue<String> results = new LinkedList<>();
    Node x = get(root, prefix, 0);           // subtrie de toda chave começando com prefix
    collect(x, prefix, results);
    return results;
}

private void collect(Node x, String prefix, Queue<String> q) {
    if (x == null) return;
    if (x.val != null) q.add(prefix);
    for (char c = 0; c < R; c++)
        collect(x.next[c], prefix + c, q);
}
```

`longestPrefixOf(query)` é a imagem espelhada: desça ao longo dos caracteres de `query`, lembrando a última profundidade em que um nó teve um valor não nulo, e pare no primeiro link `null` ou no fim da string. Isso é exatamente a forma de uma sugestão de corretor ortográfico, um dropdown de autocomplete, ou a correspondência de prefixo mais longo de uma tabela de roteamento IP — nenhum dos quais uma hash table ou BST comum consegue expressar sem uma varredura completa e cara.

## Trade-offs

- **Tries R-way são a opção mais rápida, se você puder pagar pelo espaço.** Busca e inserção custam no máximo `1 + key.length()` acessos a array não importa quantas chaves estejam armazenadas — difícil de superar — mas todo nó paga por `R` links usados ou não, então isso só faz sentido para chaves curtas e/ou alfabetos pequenos.
- **TSTs trocam um pouco de tempo por muito espaço.** Substituir o array de R slots por 3 links por nó transforma `R·N·w` links no pior caso em `3·N·w`, ao custo de um fator `ln R` extra por comparação de caractere — o padrão certo assim que o alfabeto é grande ou as chaves são longas (texto Unicode, URLs).
- **A forma de uma trie é única para um dado conjunto de chaves, independente da ordem de inserção** — diferente de uma BST (ou de uma TST, cuja estrutura por nó *é* uma BST comum e portanto depende da ordem de inserção da mesma forma que uma BST comum depende).
- **Nem trie nem TST superam uma hash table em throughput bruto de correspondência exata**, e isso não é o trabalho delas: você aceita um pouco mais de trabalho por lookup em troca de operações de prefixo (`keysWithPrefix`, `longestPrefixOf`) que hashing não consegue suportar de jeito nenhum, porque hashing deliberadamente descarta qualquer relação entre chaves parecidas.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 5.2 "Tries", pp. 730-753 — book
- [Princeton Algorithms, 4th Ed. — Tries (companion site)](https://algs4.cs.princeton.edu/52trie/) — doc
