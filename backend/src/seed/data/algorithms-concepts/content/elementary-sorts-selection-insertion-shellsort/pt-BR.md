---
version: 1.0
updatedAt: 2026-08-13
title: "Sorts Elementares: Seleção, Inserção e Shellsort"
description: "Compara os três sorts elementares de array que fundamentam o restante deste módulo: selection sort (movimentação mínima de dados, mas cego à ordem da entrada), insertion sort (adaptativo a entradas quase ordenadas, e o próprio exemplo recorrente de CLRS para provas de corretude por invariante de laço), e shellsort (insertion sort estendido com uma sequência de gaps decrescente, com uma complexidade de pior caso que ainda é um problema em aberto para muitas sequências de gap práticas)."
---
## Objetivo

Entenda os três sorts elementares de array que fundamentam o restante deste módulo: selection sort (encontre o mínimo, troque-o para o lugar certo, repita), insertion sort (construa um prefixo ordenado inserindo cada novo elemento onde ele pertence), e shellsort (insertion sort estendido para mover elementos por distâncias longas primeiro). Todos os três são in-place, e compará-los revela as duas propriedades que mais importam na hora de escolher um sort: quanta movimentação de dados ele faz, e se ele se adapta a uma entrada já parcialmente ordenada.

## Casos de Uso

- Ordenar arrays muito pequenos, onde o baixo overhead do insertion sort supera quicksort, mergesort ou heapsort — assintoticamente melhores, mas com constantes mais pesadas.
- Ordenar dados quase ordenados (alguns registros novos anexados a um log já ordenado, uma importação majoritariamente ordenada) — o tempo de execução do insertion sort é proporcional ao número de *inversões*, não ao tamanho do array, então fica perto de linear aqui.
- A propriedade de movimentação mínima de dados do selection sort (apenas N trocas, o menor número de qualquer sort deste módulo) importa quando escritas são caras em relação a leituras — ex: ordenar em armazenamento flash, onde toda escrita encurta a vida útil do meio.
- Como o corte de subarray pequeno dentro de implementações de produção de quicksort/mergesort — tanto o quicksort de pivô duplo do Java quanto o TimSort caem para insertion sort quando uma partição ou run fica pequena, em vez de recursar até o fim.

## Aprofundamento

### Selection sort: movimentação mínima, mas cego à ordem da entrada

Varra o restante não ordenado em busca do seu mínimo, troque-o para o lugar na frente, e repita — avançando a fronteira ordenada em um a cada passada:

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    for (int i = 0; i < n; i++) {
        int min = i;
        for (int j = i + 1; j < n; j++) {
            if (less(a[j], a[min])) min = j;
        }
        exch(a, i, min);
    }
}
```

Proposição A de Sedgewick: selection sort usa **N²/2 comparações e N trocas** para ordenar um array de tamanho N — para cada `i` de 0 a N−1, o laço interno roda N−1−i comparações e há exatamente uma troca, então as comparações somam N(N−1)/2 e as trocas somam N.

As duas propriedades características seguem diretamente desse formato:

- **O tempo de execução é insensível à ordem da entrada.** Encontrar o mínimo em uma passada não dá nenhuma informação sobre onde está o próximo mínimo, então um array já ordenado, um array em ordem reversa e um array aleatório custam todos os mesmos N²/2 comparações. O insertion sort (abaixo) não compartilha essa fraqueza.
- **A movimentação de dados é mínima.** Exatamente N trocas, ponto final — nenhum outro sort deste módulo fica abaixo de contagens de troca linearítmicas. Se escritas forem a operação cara, essa é a única propriedade capaz de superar a contagem quadrática de comparações.

Trace em `[5, 3, 8, 1, 9, 4, 7, 2]` — cada passada marca o mínimo encontrado pela varredura, depois o troca para a frente:

```viz
type: moves
mark 3 | Varre a[0..7] em busca do mínimo: encontrado "1" no índice 3.
swap 0 3 | Troca ele para o lugar — a[0] agora está definitivo.
mark 7 | Varre a[1..7] em busca do mínimo: encontrado "2" no índice 7.
swap 1 7 | Troca para o lugar — a[0..1] agora estão definitivos.
mark 7 | Varre a[2..7] em busca do mínimo: encontrado "3" no índice 7.
swap 2 7 | Troca para o lugar — a[0..2] agora estão definitivos.
mark 5 | Varre a[3..7] em busca do mínimo: encontrado "4" no índice 5.
swap 3 5 | Troca para o lugar — a[0..3] agora estão definitivos.
mark 5 | Varre a[4..7] em busca do mínimo: encontrado "5" no índice 5.
swap 4 5 | Troca para o lugar — a[0..4] agora estão definitivos.
mark 6 | Varre a[5..7] em busca do mínimo: encontrado "7" no índice 6.
swap 5 6 | Troca para o lugar — a[0..5] agora estão definitivos.
mark 7 | Varre a[6..7] em busca do mínimo: encontrado "8" no índice 7.
swap 6 7 | Troca para o lugar — o array está completamente ordenado.
---
5
3
8
1
9
4
7
2
```

Sete trocas para oito elementos — uma por passada, exatamente N como a Proposição A prevê (a trivial N-ésima passada, onde o último elemento já está sozinho e no lugar, não faz troca alguma).

### Insertion sort: adaptativo à ordem já existente

Cresça um prefixo ordenado um elemento por vez: pegue o próximo elemento e troque-o para a esquerda, passando por toda entrada já ordenada maior do que ele.

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    for (int i = 1; i < n; i++) {
        for (int j = i; j > 0 && less(a[j], a[j - 1]); j--) {
            exch(a, j, j - 1);
        }
    }
}
```

Proposição B de Sedgewick: para um array ordenado aleatoriamente com chaves distintas, insertion sort usa em média **~N²/4 comparações e ~N²/4 trocas**, com pior caso de N²/2 e melhor caso de apenas N−1 comparações e 0 trocas. A Proposição C refina isso: o número de trocas é igual ao número de *inversões* (pares fora de ordem) no array, e as comparações ficam dentro de N−1 dessa mesma contagem.

Essa é a propriedade adaptativa, tornada concreta: o array de oito elementos traçado abaixo, `[4, 2, 7, 1, 5, 3, 8, 6]`, tem 10 inversões, então insertion sort faz exatamente 10 trocas para ordená-lo. Compare isso com `[1, 2, 3, 4, 5, 6, 8, 7]` — os mesmos oito valores, ordenados exceto por uma troca adjacente. Esse array tem uma única inversão (8-7), então insertion sort faz **uma** troca e termina em tempo efetivamente linear. Selection sort, em contraste, ainda queimaria seus N²/2 = 28 comparações completas nesse array quase ordenado, alheio a quão perto ele já está de terminado — essa é exatamente a assimetria que Sedgewick aponta entre os dois algoritmos.

Trace em `[4, 2, 7, 1, 5, 3, 8, 6]` — cada passo é uma troca adjacente, enquanto um elemento desliza para a esquerda passando por vizinhos maiores:

```viz
type: moves
swap 1 0 | Insere a[1] = "2": menor que a[0] = "4" — desliza à esquerda.
swap 3 2 | Insere a[3] = "1": menor que a[2] = "7" — desliza à esquerda.
swap 2 1 | "1" ainda é menor que a[1] = "4" — continua deslizando à esquerda.
swap 1 0 | "1" ainda é menor que a[0] = "2" — mais um deslize; agora é o menor até aqui.
swap 4 3 | Insere a[4] = "5": menor que a[3] = "7" — desliza à esquerda. Agora ≥ a[2] = "4", então para aqui.
swap 5 4 | Insere a[5] = "3": menor que a[4] = "7" — desliza à esquerda.
swap 4 3 | "3" ainda é menor que a[3] = "5" — continua deslizando à esquerda.
swap 3 2 | "3" ainda é menor que a[2] = "4" — mais um deslize; agora ≥ a[1] = "2", então para aqui.
swap 7 6 | Insere a[7] = "6": menor que a[6] = "8" — desliza à esquerda.
swap 6 5 | "6" ainda é menor que a[5] = "7" — mais um deslize; agora ≥ a[4] = "5", então para aqui.
---
4
2
7
1
5
3
8
6
```

Dez trocas, batendo exatamente com as dez inversões do array inicial, como a Proposição C prevê.

O insertion sort merece uma segunda menção além de Sedgewick: CLRS o usa como exemplo recorrente de como *provar* um algoritmo correto, via invariante de laço. A formulação deles enuncia o invariante — "no início de cada iteração, `A[1..i-1]` consiste dos elementos originais de `A[1..i-1]`, mas em ordem ordenada" — e percorre a prova padrão de três partes: **inicialização** (o invariante vale trivialmente antes da primeira iteração, quando o "prefixo ordenado" é um único elemento), **manutenção** (o laço `while` interno de cada iteração desloca elementos maiores à direita e insere a chave, estendendo o prefixo ordenado em um enquanto preserva o invariante), e **término** (o laço termina quando `i` excede `n`, ponto em que o invariante — aplicado ao array inteiro — é exatamente a pós-condição de ordenação). É uma escolha pedagógica notável: em vez de escolher um algoritmo mais "interessante", CLRS usa o sort mais simples do livro para introduzir a técnica de prova que depois reutiliza pelo texto inteiro.

### Shellsort: insertion sort com um gap decrescente

O insertion sort é lento em arrays grandes especificamente porque suas únicas trocas movem elementos uma posição de cada vez — um elemento que pertence ao extremo distante precisa se arrastar até lá uma troca de cada vez. A correção do shellsort: primeiro ordene o array comparando elementos que estão `h` posições afastados, para algum `h` grande (um *h-sort*, equivalente a rodar insertion sort independentemente em `h` subsequências intercaladas), depois repita com `h` cada vez menor, terminando em `h = 1` — que é insertion sort comum, mas agora rodando em um array que passadas anteriores já arrastaram para uma ordem aproximada, então essa passada final é rápida.

```java
public static void sort(Comparable[] a) {
    int n = a.length;
    int h = 1;
    while (h < n / 3) h = 3 * h + 1;      // 1, 4, 13, 40, 121, ...
    while (h >= 1) {
        for (int i = h; i < n; i++) {
            for (int j = i; j >= h && less(a[j], a[j - h]); j -= h) {
                exch(a, j, j - h);
            }
        }
        h = h / 3;
    }
}
```

A própria sequência de incrementos de Sedgewick — 1, 4, 13, 40, 121, … (cada termo é `3×anterior + 1`) — é fácil de calcular e performa bem na prática, embora não seja a única sequência em uso.

Trace em `[6, 1, 8, 3, 5, 2, 7, 4]` (n = 8, então a sequência acima dá h = 4, depois h = 1):

```viz
type: moves
mark 0 | h = 4 — a sequência de incrementos 3×+1 de Sedgewick, o maior h < n/3 alcançado por h = 3h + 1 partindo de 1. 4-sort do array: insertion-sort em cada uma das 4 subsequências intercaladas (passo 4) independentemente.
swap 4 0 | Subsequência {a[0], a[4]}: "5" < "6" — desliza à esquerda um gap.
swap 6 2 | Subsequência {a[2], a[6]}: "7" < "8" — desliza à esquerda um gap.
mark 0 | h = 1 — a passada final é um insertion sort comum, mas o array já está 4-ordenado (aproximadamente em ordem), então essa passada faz bem menos trabalho do que insertion sort faria na entrada bruta.
swap 1 0 | Insere a[1] = "1": menor que a[0] = "5" — desliza à esquerda.
swap 3 2 | Insere a[3] = "3": menor que a[2] = "7" — desliza à esquerda.
swap 2 1 | "3" ainda é menor que a[1] = "5" — continua deslizando à esquerda.
swap 4 3 | Insere a[4] = "6": menor que a[3] = "7" — desliza à esquerda.
swap 5 4 | Insere a[5] = "2": menor que a[4] = "7" — desliza à esquerda.
swap 4 3 | "2" ainda é menor que a[3] = "6" — continua deslizando à esquerda.
swap 3 2 | "2" ainda é menor que a[2] = "5" — continua deslizando à esquerda.
swap 2 1 | "2" ainda é menor que a[1] = "3" — mais um deslize; agora é o menor até aqui.
swap 7 6 | Insere a[7] = "4": menor que a[6] = "8" — desliza à esquerda.
swap 6 5 | "4" ainda é menor que a[5] = "7" — continua deslizando à esquerda.
swap 5 4 | "4" ainda é menor que a[4] = "6" — continua deslizando à esquerda.
swap 4 3 | "4" ainda é menor que a[3] = "5" — mais um deslize; o array está completamente ordenado.
---
6
1
8
3
5
2
7
4
```

Duas trocas na passada h = 4 movem elementos quatro posições de cada vez — algo que o insertion sort puro nunca consegue fazer em um único passo — e a passada h = 1 que vem depois, embora faça a maioria das trocas restantes, está operando sobre um array já perto de ordenado.

Shellsort é genuinamente surpreendente em termos de complexidade. Para certas sequências de incremento — incluindo a própria de Sedgewick, 1, 4, 13, 40, 121, … — shellsort foi *provado* rodar em tempo subquadrático de pior caso, superando o limite Θ(N²) que governa selection e insertion sort. Mas a complexidade exata de pior caso para muitas sequências de incremento práticas continua sendo um problema em aberto: ninguém encontrou uma sequência comprovadamente ótima, e não se entende completamente até onde o trade-off entre número de incrementos e suas relações aritméticas (divisores compartilhados e coisas do tipo) pode ser levado. É um exemplo raro de um algoritmo simples, com décadas de idade, amplamente usado, cuja análise teórica completa ainda está inacabada. Mais uma propriedade que vale destacar: diferente do insertion sort, **shellsort não é estável** — um h-sort com h > 1 pode trocar dois elementos iguais de posição, já que eles são comparados contra elementos h posições distantes, não contra o vizinho imediato.

### Quando recorrer a um destes — e quando não

- **Arrays minúsculos (aproximadamente algumas dezenas de elementos ou menos):** o baixo overhead de fator constante do insertion sort supera as melhores assintóticas de quicksort/mergesort/heapsort, que só começam a compensar uma vez que N é grande o suficiente para o gap O(N log N) vs. O(N²) dominar as constantes. É exatamente por isso que sorts de produção usam insertion sort como corte, em vez de recursar até o tamanho 1 — veja Trade-offs abaixo.
- **Dados quase ordenados:** insertion sort é a escolha certa sempre que a entrada tem poucas inversões em relação ao seu tamanho — anexar novos registros a um log ordenado, reordenar após uma pequena edição. Selection sort e shellsort não compartilham essa vantagem adaptativa no mesmo grau.
- **Armazenamento com escrita cara:** a garantia de N trocas do selection sort é o único cenário em que ele supera o insertion sort diretamente, independente de quão ordenada a entrada já esteja.
- **Todo o resto — arrays grandes ou imprevisíveis:** recorra a quicksort (velocidade em caso médio, in-place), mergesort (O(N log N) garantido, estável), ou heapsort (O(N log N) garantido, in-place) em vez disso. Todos os três sorts elementares aqui são Θ(N²) no pior caso, o que deixa de ser competitivo bem antes de N chegar aos milhares.

## Trade-offs

- **As N²/2 comparações do selection sort são pagas independentemente da ordem da entrada — até um array já ordenado recebe a varredura completa** — sua única vantagem é o limite de N trocas, que importa especificamente quando escritas custam mais que comparações (armazenamento flash, por exemplo). Para tudo o mais, o insertion sort domina ele.
- **O pior caso do insertion sort ainda é Θ(N²)** — ele é adaptativo, não assintoticamente melhor; um array grande e genuinamente aleatório ainda será lento. Seu valor real é o papel de corte de subarray pequeno: em vez de recursar quicksort ou mergesort até o fim, até subarrays triviais, implementações reais trocam para insertion sort quando um subarray fica pequeno o suficiente para que seu baixo overhead e adaptabilidade superem o custo de mais recursão — a mesma ideia subjacente por trás do passo de extensão de run via insertion sort dentro do TimSort, apontado nos Trade-offs do concept de mergesort.
- **Shellsort não é estável, diferente do insertion sort** — chaves iguais podem cruzar durante uma passada de gap grande, então não é um substituto seguro quando a ordem relativa de empates importa. Sua complexidade também é a questão genuinamente em aberto entre os sorts deste módulo: comportamento subquadrático de pior caso é provado para sequências de incremento específicas, mas nenhuma sequência foi provada ótima.
- **No Java de produção, isso não é só teoria de livro-texto** — o `Arrays.sort()` de quicksort de pivô duplo (para arrays de primitivos) cai para uma passada de insertion sort comum assim que uma partição encolhe abaixo de um pequeno limiar de tamanho, exatamente a ideia de otimização de corte descrita acima, não apenas um truque de sala de aula:

  ```java
  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);   // quicksort de pivô duplo para partições grandes,
                        // insertion sort assim que uma partição fica pequena o suficiente
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 2.1 "Elementary Sorts", pp. 244-265 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 2.1 "Insertion sort", pp. 17-24 — book
- [Princeton Algorithms, 4th Ed. — Elementary Sorts (companion site)](https://algs4.cs.princeton.edu/21elementary/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
