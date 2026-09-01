---
version: 1.0
updatedAt: 2026-08-13
title: "Hash Tables: Chaining, Open Addressing e Fator de Carga"
description: "A teoria algorítmica por trás das hash tables: como uma função de hash mapeia chaves para índices de array, por que colisões são matematicamente inevitáveis, e como separate chaining e open addressing/linear probing as resolvem sob um fator de carga limitado — mais o design de funções de hash (método da divisão, universal hashing) e por que deletar é complicado em open addressing."
---
## Objetivo

Entenda hash tables como uma ideia algorítmica, não uma classe Java: uma função de hash transforma uma chave em um índice de array para que a busca seja quase O(1), colisões entre chaves diferentes são matematicamente inevitáveis assim que o universo de chaves excede o tamanho da tabela, e todo o design de uma hash table é, na verdade, uma escolha de *como* resolver essas colisões — separate chaining ou open addressing — mais como manter o fator de carga limitado conforme a tabela cresce.

## Casos de Uso

- Implementar uma tabela de símbolos não ordenada (map/set) onde busca O(1) em média importa mais que ordem — a base teórica de `HashMap`/`HashSet`, embora este concept cubra os algoritmos de resolução de colisão em si, não a classe do JDK.
- Deduplicação, contagem de frequência e teste de pertencimento sobre grandes conjuntos de chaves, onde uma busca em lista encadeada ou BST seria lenta demais.
- Qualquer sistema (tabela de símbolos de compilador, cache, índice de banco de dados) que precisa trocar memória por busca quase O(1), seguindo o enquadramento de Sedgewick & Wayne de hashing como "um exemplo clássico de trade-off tempo-espaço".
- Entender por que um adversário que conhece sua função de hash pode atacá-la — relevante para qualquer hash table exposta a entrada não confiável (ex.: nomes de campo de um formulário HTTP), que é exatamente o que universal hashing foi projetado para prevenir.

## Aprofundamento

### A ideia central de hashing, e por que colisões são inevitáveis

Uma função de hash `h` mapeia um universo de chaves (geralmente enorme) para `{0, 1, ..., M-1}`, os índices de um array de tamanho `M`. Cormen declara o mecanismo básico com clareza: com *endereçamento direto* você precisaria de um slot de array por chave possível, o que é desperdício ou francamente impossível quando o universo é enorme; hashing resolve isso calculando o slot a partir da chave em vez de usar a chave diretamente como índice, então a tabela só precisa ser proporcional ao número de chaves de fato armazenadas, Θ(N) em vez de Θ(|universo|).

```java
private int hash(Object key, int m) {
    // Convenção do Java: combina hashCode() com hashing modular pra cair em [0, m-1].
    return (key.hashCode() & 0x7fffffff) % m;
}
```

Como o universo de chaves é (quase) sempre maior que `M`, o princípio da casa dos pombos garante que duas chaves diferentes vão eventualmente cair no mesmo slot — uma **colisão**. Cormen é explícito sobre isso: "deve haver pelo menos duas chaves com o mesmo valor de hash, e evitar colisões por completo é impossível." Então todo design real de hash table é fundamentalmente sobre *resolução de colisões* — Sedgewick & Wayne organizam a seção inteira em torno de exatamente duas estratégias: **separate chaining** e **linear probing**.

### Separate chaining: uma lista por slot, custo limitado pelo fator de carga

Separate chaining mantém, em cada um dos `M` slots do array, uma lista encadeada (ou qualquer tabela de símbolos pequena) de cada par chave-valor que caiu ali:

```java
public class SeparateChainingHashST<Key, Value> {
    private int M;                              // número de chains
    private Node<Key, Value>[] chains;

    @SuppressWarnings("unchecked")
    public SeparateChainingHashST(int m) {
        this.M = m;
        chains = new Node[m];
    }

    private int hash(Key key) {
        return (key.hashCode() & 0x7fffffff) % M;
    }

    public void put(Key key, Value val) {
        int i = hash(key);
        for (Node<Key, Value> x = chains[i]; x != null; x = x.next)
            if (x.key.equals(key)) { x.val = val; return; }
        chains[i] = new Node<>(key, val, chains[i]);   // prepend — O(1)
    }

    public Value get(Key key) {
        int i = hash(key);
        for (Node<Key, Value> x = chains[i]; x != null; x = x.next)
            if (x.key.equals(key)) return x.val;
        return null;
    }

    private static class Node<K, V> {
        K key; V val; Node<K, V> next;
        Node(K key, V val, Node<K, V> next) { this.key = key; this.val = val; this.next = next; }
    }
}
```

Defina o **fator de carga** α = N/M (N chaves, M slots — esse mesmo α é usado pelos dois livros, embora o interpretem de forma ligeiramente diferente para os dois esquemas, veja abaixo). O argumento de Sedgewick & Wayne para por que o comprimento das chains é limitado é desarmantemente simples: "como temos M listas e N chaves, o comprimento médio das listas é sempre N/M, não importa como as chaves estejam distribuídas entre as listas" — isso é pura aritmética (Property L / Proposition K), independente de qualquer suposição sobre a função de hash.

A precisão vem do que os dois livros chamam de **suposição de hashing uniforme** (a "Assumption J" de Sedgewick & Wayne: cada chave é independente e uniformemente provável de cair em qualquer slot — o "independent uniform hashing" de Cormen). Sob essa suposição, Cormen prova isso exatamente:

> **Teorema 11.1 / 11.2 (Cormen).** Em uma hash table com colisões resolvidas por chaining, tanto uma busca malsucedida quanto uma busca bem-sucedida levam **Θ(1 + α)** tempo em média.

O `1` é o custo fixo de calcular a função de hash e indexar no array; o `α` é o comprimento médio esperado da chain a percorrer. Quando N é mantido proporcional a M (α = O(1)), toda operação é O(1) em média — "você consegue implementar busca e inserção para tabelas de símbolos que exigem tempo constante (amortizado) por operação," como Sedgewick & Wayne colocam. O pior caso ainda é Θ(N) — uma função de hash patológica que manda toda chave para o mesmo slot degenera o chaining em uma única lista encadeada longa — que é exatamente a lacuna que o universal hashing (abaixo) fecha.

### Open addressing / linear probing: sem listas, sondando pelo próximo slot livre

Open addressing (linear probing é a variante de Sedgewick & Wayne — e a mais simples segundo Cormen) armazena o par chave-valor diretamente na própria tabela: sem listas, sem ponteiros fora do array. Em uma colisão, avance para o próximo slot, dando a volta no fim, até encontrar um slot vazio ou a chave:

```java
public class LinearProbingHashST<Key, Value> {
    private int N, M = 16;
    private Key[] keys;
    private Value[] vals;

    @SuppressWarnings("unchecked")
    public LinearProbingHashST() {
        keys = (Key[]) new Object[M];
        vals = (Value[]) new Object[M];
    }

    private int hash(Key key) { return (key.hashCode() & 0x7fffffff) % M; }

    public void put(Key key, Value val) {
        if (N >= M / 2) resize(2 * M);              // mantém fator de carga < 1/2
        int i;
        for (i = hash(key); keys[i] != null; i = (i + 1) % M)
            if (keys[i].equals(key)) { vals[i] = val; return; }
        keys[i] = key;
        vals[i] = val;
        N++;
    }

    public Value get(Key key) {
        for (int i = hash(key); keys[i] != null; i = (i + 1) % M)
            if (keys[i].equals(key)) return vals[i];
        return null;   // caiu num slot null — a chave nunca foi inserida (ou foi deletada)
    }
}
```

Como toda chave vive diretamente na tabela, **a tabela nunca pode ficar completamente cheia** — `α = N/M` não pode exceder 1, e uma busca sem sucesso em uma tabela totalmente cheia entraria em loop infinito. Os dois livros insistem que o fator de carga precisa ficar *bem abaixo* de 1, e dão números reais para justificar. A Proposition M de Sedgewick & Wayne (análise de Knuth de 1962) declara as contagens médias de probes em função de α:

> acerto de busca ≈ ½(1 + 1/(1-α)), erro de busca/inserção ≈ ½(1 + 1/(1-α)²)

Concretamente: em α ≈ 1/2, um acerto custa ~1,5 probes e um erro ~2,5. Em α = 3/4, um acerto custa ~2,5 e um erro ~8,5. Em α = 7/8, um erro dispara para ~32,5 probes. É por isso que o `LinearProbingHashST` de Sedgewick & Wayne dobra a tabela (`resize(2*M)`) assim que `N >= M/2`, garantindo que α nunca exceda meio — e por isso o capítulo de Cormen declara categoricamente que, com open addressing, diferente do chaining, "o fator de carga α nunca pode exceder 1" de forma alguma, por construção.

**Deletar é genuinamente complicado.** Você não pode simplesmente zerar o slot da chave deletada. Cormen explica exatamente por quê: "seria um erro marcar aquele slot como vazio simplesmente armazenando NIL nele... você poderia ficar incapaz de recuperar qualquer chave k para a qual o slot q foi sondado e encontrado ocupado quando k foi inserida" — porque `get`/busca para assim que encontra um slot `null`, tratando isso como prova de que a chave nunca foi inserida. Se o probe de uma chave posterior passou *através* do slot deletado para pousar em algum lugar depois dele, zerar aquele slot quebra a cadeia de probes e torna a chave posterior inalcançável. O próprio exemplo trabalhado de Sedgewick & Wayne: deletar `C` (que fica no slot 4 no traço deles, mas foi deslocado até lá via probing), zerar ingenuamente o slot dele e então buscar `H` (que sondou *além* do slot de C quando foi inserido) — a busca bate no buraco null onde `C` estava e incorretamente reporta um erro, mesmo que `H` ainda esteja na tabela.

A correção padrão que Cormen apresenta é a **deleção preguiçosa via tombstone**: marcar o slot com um sentinela especial `DELETED` em vez de `null`.

```java
// A abordagem de tombstone de Cormen: um sentinela distinto tanto de uma chave real quanto de null.
static final Object DELETED = new Object();

public void delete(Key key) {
    for (int i = hash(key); keys[i] != null; i = (i + 1) % M) {
        if (keys[i] != DELETED && keys[i].equals(key)) {
            keys[i] = (Key) DELETED;   // NÃO null — preserva a cadeia de probes
            vals[i] = null;
            N--;
            return;
        }
    }
}
```

`get`/busca deve então tratar `DELETED` como "ocupado, continue sondando" (não "vazio, pare"), enquanto `put` pode reaproveitar um slot `DELETED` para uma inserção nova. O custo: o tempo de busca deixa de depender de forma limpa de α, já que tombstones se acumulam e nunca são de fato recuperados até um resize — que é exatamente por que Cormen observa que chaining costuma ser preferido sempre que deleções são frequentes. Sedgewick & Wayne resolvem o mesmo problema de outro jeito, sem tombstones: o `delete()` deles remove a chave, depois anda para frente pelo resto daquele cluster, puxando cada par chave-valor subsequente e *reinserindo* via `put()` — mais código, mas sem acúmulo permanente de tombstone.

### Design de função de hash: o método da divisão e universal hashing

Os dois livros convergem no **método da divisão** como padrão: `h(k) = k mod M`. É uma instrução de CPU, mas a escolha de `M` importa enormemente. O aviso concreto de Sedgewick & Wayne: códigos de área telefônica dos EUA se agrupam com dígito do meio 0 ou 1, então hashear com `M = 100` (uma potência de 10, olhando só para os dígitos de baixa ordem) "favorece fortemente os valores menores que 20" — enquanto `M = 97`, um primo distante de uma potência de 10, dispersa muito mais uniformemente. Cormen generaliza o mesmo aviso para binário: escolha `M` **primo e distante de uma potência de 2**, porque um módulo potência de 2 só examina os bits de baixa ordem da chave, e chaves do mundo real (endereços IP, códigos de área, endereços de memória) frequentemente têm bits de baixa ordem estruturados, não aleatórios.

O **método da multiplicação** de Cormen é a outra opção estática clássica: `h(k) = ⌊M · (kA mod 1)⌋` para uma constante `0 < A < 1` — multiplique a chave por `A`, mantenha só a parte fracionária, escale por `M`. Sua variante prática, o *método multiply-shift*, precisa só de multiplicação/subtração/shift e não exige que `M` seja primo.

Mas tanto o método da divisão quanto o da multiplicação são **hashing estático**: uma função fixa, escolhida com antecedência. O insight central de Cormen — e o mais frequentemente perdido — é que *qualquer função de hash fixa tem uma entrada patológica*: "suponha que um adversário malicioso escolhe as chaves a serem hasheadas usando alguma função de hash fixa. Então o adversário pode escolher n chaves que hasheiam todas para o mesmo slot, produzindo um tempo médio de recuperação de Θ(n)... qualquer função de hash estática é vulnerável a esse comportamento terrível de pior caso." Isso não é hipotético: Sedgewick & Wayne notam que o próprio `String.hashCode()` do Java produz o valor `0` para a string `"polygenelubricants"`, e encontrar outras strings que colidem com ela "virou um passatempo divertido de algoritmo-quebra-cabeça" — uma função de hash fixa e conhecida está sempre sujeita a ataque assim que sua fórmula é pública.

**Universal hashing** é a correção, e é uma ideia precisa, não um apelo vago à "aleatoriedade": em vez de se comprometer com um `h` fixo, escolha `h` *em tempo de execução*, uniformemente ao acaso, de uma família `H` de funções de hash com a propriedade de que, para quaisquer duas chaves distintas, a fração de funções em `H` sob as quais elas colidem é no máximo `1/M`. O Teorema 11.4 de Cormen constrói uma dessas famílias a partir de aritmética modular — `h(k) = ((a·k + b) mod p) mod M` para um primo `p` maior que qualquer chave e `a, b` escolhidos aleatoriamente — e prova que ela é universal. Como a *função em si* é escolhida depois (ou independente) de qualquer estratégia adversária, nenhuma sequência fixa de chaves pode ser pré-construída para colidir contra ela: "o algoritmo pode se comportar de forma diferente em cada execução, mesmo para o mesmo conjunto de chaves a serem hasheadas, garantindo bom desempenho médio-caso" (o Corolário 11.3 reafirma o limite Θ(1+α) do Teorema 11.2, agora como uma garantia incondicional independente de quais chaves forem jogadas nela).

### Um traço trabalhado: separate chaining com uma colisão real

Trace inserindo as chaves `S E A R C H` (o próprio alfabeto de exemplo de Sedgewick & Wayne) em uma tabela de chaining com `M = 8`, usando o `String.hashCode()` real do Java (cada uma é um único caractere, então `hashCode()` é só seu code point UTF-16) combinado com o passo de espalhamento de bits do `HashMap` e `(M-1) & spread(h)` como índice — a mesma mecânica hash-para-índice usada em todo o JDK:

```viz
type: formula
capacity = 8
slot = (capacity - 1) & spread(hash(item))
---
S
E
A
R
C
H
```

Verificado à mão: `hash("S")=83 → slot 3`, `hash("E")=69 → slot 5`, `hash("A")=65 → slot 1`, `hash("R")=82 → slot 2`, `hash("C")=67 → slot 3` — **uma colisão real com `S`** — `hash("H")=72 → slot 0`.

Percorrendo a chain do slot 3 à mão, do jeito que `CHAINED-HASH-INSERT`/`put()` de fato constroem (os dois livros prependam novos nós no início da lista):

```
insert S:  slot 3 -> [S]
...
insert C:  slot 3 já tem S -> C é prependido -> slot 3 -> [C -> S]
```

Um `get("S")` depois disso ainda tem sucesso — a chain no slot 3 é percorrida (`C`, depois `S`) até a chave bater — só custa uma comparação a mais do que custaria se C tivesse caído em qualquer outro lugar. Essa comparação extra *é* o custo do fator de carga: essa tabela tem α = 6/8 = 0,75, então em média toda busca paga por cerca de 0,75 comparação extra além do custo fixo de hash-e-indexação, batendo quase exatamente com a previsão ~N/M da Property L.

### Resizing mantém o fator de carga limitado — e é O(1) amortizado

Nem chaining nem open addressing funcionam bem se α deriva arbitrariamente alto (chaining) ou se aproxima de 1 (open addressing nunca pode chegar lá). Os dois livros usam a mesma correção: **resizing dinâmico** — quando `N` cresce além de um limiar (o `LinearProbingHashST.put()` de Sedgewick & Wayne dobra a tabela assim que `N >= M/2`), aloca uma tabela maior e re-hasheia cada chave para ela. Isso mantém α limitado dentro de um intervalo constante não importa quantas chaves cheguem.

Re-hashear a tabela inteira é uma operação O(M) cara sempre que acontece — mas acontece raramente o suficiente (cada dobramento aproximadamente dobra o "orçamento" antes do próximo ser necessário) para que o *custo por inserção, calculado em média sobre uma longa sequência de inserções*, ainda seja O(1). Sedgewick & Wayne declaram isso formalmente como a Proposition N: "qualquer sequência de t operações de busca, inserção e deleção é executada em tempo esperado proporcional a t." A técnica por trás dessa afirmação — espalhar um resize ocasionalmente caro por muitas operações baratas para obter um limite constante por operação — é a **análise amortizada**, uma ferramenta geral de análise algorítmica coberta em seu próprio concept; o princípio de resizing aqui é o mesmo em que esta seção se apoia sem rederivá-lo.

## Trade-offs

- **Chaining degrada com elegância; open addressing não.** Uma tabela de chaining com α = 5 é só mais lenta (comprimento médio de chain 5), ainda correta. Uma tabela de open addressing nem consegue aceitar uma inserção quando está completamente cheia, e fica drasticamente mais lenta bem antes disso — os números de Sedgewick & Wayne (2,5 probes em α=3/4 vs. 32,5 em α=7/8) mostram que o penhasco é abrupto, não gradual.
- **Deletar é barato com chaining, genuinamente incômodo com open addressing.** A deleção em chaining é uma remoção normal de lista encadeada. A deleção em open addressing precisa de tombstones (bookkeeping extra, perda permanente de slot até o próximo resize) ou da abordagem de reinserir-o-resto-do-cluster de Sedgewick & Wayne (trabalho extra por deleção) — nunca um `null` simples.
- **A forma de memória é diferente.** A própria tabela de espaço de Sedgewick & Wayne: chaining usa ~48N + 64M referências; linear probing usa entre ~32N e ~128N (dois arrays paralelos grandes, sem overhead por nó). Para tabelas enormes isso é um trade-off real de nível de sistema, não só algorítmico.
- **Nenhuma função de hash fixa é comprovadamente segura** — só uma função escolhida aleatoriamente a cada execução, de uma família universal, fecha a lacuna adversária que Cormen identifica; uma única implementação estática de `hashCode()`, por mais bem ajustada que seja, é sempre teoricamente atacável por um adversário que viu seu código-fonte.
- **Hashing abre mão de ordem.** Os dois livros são explícitos: uma vez que as chaves são hasheadas, qualquer noção de "próxima maior chave" ou consulta por intervalo desaparece — esse é o trade-off que uma tabela de símbolos ordenada baseada em BST não precisa fazer.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 3.4 "Hash Tables," pp. 458-483](https://algs4.cs.princeton.edu/34hash/) — doc
- [Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 11 "Hash Tables," Seções 11.1-11.4, pp. 272-299](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Object.hashCode() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#hashCode()) — doc
- [Hash table — Wikipedia](https://en.wikipedia.org/wiki/Hash_table) — doc
