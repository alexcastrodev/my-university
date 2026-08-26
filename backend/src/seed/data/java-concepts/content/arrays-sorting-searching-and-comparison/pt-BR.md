---
version: 1.0
updatedAt: 2026-08-21
title: Arrays: Ordenação, Busca e Comparação Profunda
summary: Cobre a divisão de Arrays.sort entre primitivos e Comparator, o comportamento indefinido e silencioso de binarySearch em dados não ordenados, e por que equals/toString precisam de suas variantes "deep" para arrays aninhados.
---
## Objective

`java.util.Arrays` é a classe utilitária por trás de quase toda operação com arrays que não seja indexação ou `.length` — ordenar, buscar, preencher, copiar e comparar. Seus métodos parecem uniformes entre os overloads, mas duas de suas operações mais usadas escondem arestas cortantes: ordenar um array primitivo em ordem decrescente não compila do jeito que se esperaria, e tanto `binarySearch` quanto os métodos de igualdade/impressão só se comportam corretamente quando você já sabe algo sobre o array que o compilador não consegue verificar por você.

## Use Cases

- Ordenar um array de objetos de domínio pela ordem natural (`Comparable`) ou por uma regra ad-hoc (`Comparator`) antes de exibição, serialização, ou um algoritmo posterior que exija entrada ordenada.
- Localizar a posição de um valor em um array já ordenado em O(log n) em vez de percorrê-lo linearmente.
- Comparar dois arrays — incluindo arrays de arrays — por igualdade estrutural (de conteúdo), por exemplo, verificando esperado vs. real em um teste.
- Produzir um dump legível por humanos do conteúdo de um array para logging ou debugging.
- Copiar um array para um novo array, possivelmente redimensionado, ou inicializar em massa um array com um valor constante.

## Deep Dive

### `Arrays.sort(Object[])`: ordem natural ou um `Comparator` explícito

Para um array de tipo referência, `Arrays.sort` tem duas formas: ordenar pela ordem natural (os elementos devem implementar `Comparable`), ou ordenar por um `Comparator` passado como segundo argumento.

```java
Integer[] boxed = { 5, 3, 8, 1 };

Arrays.sort(boxed);                              // natural order: [1, 3, 5, 8]
Arrays.sort(boxed, Comparator.reverseOrder());    // explicit Comparator: [8, 5, 3, 1]

String[] names = { "Charlie", "alice", "Bob" };
Arrays.sort(names, String.CASE_INSENSITIVE_ORDER); // [alice, Bob, Charlie]
```

### A armadilha do array primitivo: não existe overload com `Comparator`

`Arrays.sort` para arrays primitivos (`int[]`, `long[]`, `double[]`, ...) só tem o overload sem comparator — não existe `Arrays.sort(int[], Comparator<Integer>)`. Isso não é um caso extremo para lembrar abstratamente; falha ao compilar no exato momento em que você tenta usá-lo:

```java
int[] scores = { 5, 3, 8, 1 };

// Arrays.sort(scores, Comparator.reverseOrder()); // does not compile:
// no method Arrays.sort(int[], Comparator<Object>) exists
```

`Comparator` opera sobre objetos, e um `int` primitivo nunca é autoboxed automaticamente para um array — só valores individuais de `int` fazem autobox, não `int[]` inteiro para `Integer[]`. Há duas correções reais. Ou você faz o boxing do array e ordena com um `Comparator`:

```java
Integer[] boxedScores = { 5, 3, 8, 1 };
Arrays.sort(boxedScores, Comparator.reverseOrder());   // [8, 5, 3, 1]
```

Ou ordena de forma crescente com o overload primitivo e inverte o array manualmente, evitando por completo o custo do boxing:

```java
int[] scores2 = { 5, 3, 8, 1 };
Arrays.sort(scores2);                    // [1, 3, 5, 8]
for (int i = 0, j = scores2.length - 1; i < j; i++, j--) {
    int tmp = scores2[i];
    scores2[i] = scores2[j];
    scores2[j] = tmp;
}
// scores2 is now [8, 5, 3, 1]
```

### `Arrays.binarySearch`: exige um array ordenado, silenciosamente, sem verificação

`Arrays.binarySearch` executa busca binária, que só funciona corretamente em um array ordenado. O Javadoc declara isso como uma pré-condição, não uma garantia em tempo de execução: **"If the array is not sorted, the results are undefined."** Nada verifica a pré-condição — nenhuma exceção, nenhuma asserção, apenas um índice não especificado. Isso o torna um dos bugs silenciosos mais perigosos da biblioteca padrão, porque a chamada sempre retorna *algo* que parece plausível:

```java
int[] unsorted = { 5, 3, 8, 1, 9 };

int index = Arrays.binarySearch(unsorted, 8);
System.out.println(index); // may print 2 (correct by luck), or an unrelated,
                            // wrong index, or a negative "not found" result —
                            // the JDK makes no guarantee either way, and the
                            // outcome can differ across JDK versions or inputs
```

O único uso seguro é ordenar primeiro, depois buscar:

```java
int[] data = { 5, 3, 8, 1, 9 };
Arrays.sort(data);                         // [1, 3, 5, 8, 9] — precondition satisfied
int found = Arrays.binarySearch(data, 8);  // 3 — guaranteed correct
```

Se o valor estiver ausente, `binarySearch` retorna `-(ponto de inserção) - 1` — sempre negativo, nunca apenas `-1` — então `index >= 0` é a verificação correta de "foi encontrado", não `index != -1`.

### `Arrays.equals` vs `Arrays.deepEquals`: referência vs. conteúdo para arrays aninhados

`Arrays.equals(Object[], Object[])` compara dois arrays elemento a elemento usando o `.equals` próprio de cada elemento. Isso é correto para um array de `String` ou `Integer`, mas para um array de arrays, cada "elemento" é ele próprio um array, e o `.equals` de array é herdado de `Object` — identidade de referência, não conteúdo:

```java
int[][] grid1 = { {1, 2}, {3, 4} };
int[][] grid2 = { {1, 2}, {3, 4} };   // same content, different sub-array objects

System.out.println(Arrays.equals(grid1, grid2));     // false — compares sub-array references
System.out.println(Arrays.deepEquals(grid1, grid2)); // true  — recurses into each sub-array's content
```

`Arrays.deepEquals` aplica recursivamente a mesma lógica em cada nível de aninhamento, então também lida corretamente com arrays de arrays de arrays, enquanto `Arrays.equals` sempre olha apenas um nível de profundidade.

### `Arrays.toString` vs `Arrays.deepToString`: a mesma divisão raso/profundo para impressão

`Arrays.toString` tem a mesma limitação ao imprimir: para um array 2D, cada elemento passado para `String.valueOf` é um sub-array, e o `toString` padrão de um array (herdado de `Object`) é o descritor do seu tipo mais o hash code, não seu conteúdo:

```java
int[][] grid = { {1, 2}, {3, 4} };

System.out.println(Arrays.toString(grid));      // e.g. [[I@1b6d3586, [I@4554617c]
System.out.println(Arrays.deepToString(grid));  // [[1, 2], [3, 4]]
```

`Arrays.toString` é correto e suficiente para um array unidimensional (`Arrays.toString(new int[]{1,2,3})` imprime `[1, 2, 3]`); é especificamente o aninhamento que exige `deepToString`.

### `copyOf`, `copyOfRange`, e `fill`

`Arrays.copyOf` cria um novo array com um comprimento dado, copiando a partir do início do array de origem e preenchendo com valores padrão (ou truncando) conforme necessário. `Arrays.copyOfRange` copia uma fatia arbitrária `[from, to)`. `Arrays.fill` sobrescreve cada slot (ou um sub-intervalo) com um valor constante:

```java
int[] source = { 1, 2, 3 };

int[] grown = Arrays.copyOf(source, 5);          // [1, 2, 3, 0, 0]
int[] shrunk = Arrays.copyOf(source, 2);         // [1, 2]
int[] slice = Arrays.copyOfRange(source, 1, 3);  // [2, 3]

int[] zeros = new int[4];
Arrays.fill(zeros, 7);                           // [7, 7, 7, 7]
Arrays.fill(zeros, 1, 3, 9);                      // [7, 9, 9, 7] — fills only index 1..3 (exclusive)
```

## Trade-offs

- **Arrays primitivos não aceitam um `Comparator`, então ordenações decrescentes precisam de boxing (alocação extra, `Integer[]` em vez de `int[]`) ou de uma inversão manual após ordenar.** A rota do boxing é mais legível; a inversão manual evita o custo de memória e autoboxing em um caminho quente.
  ```java
  Integer[] boxed = {3, 1, 2};
  Arrays.sort(boxed, Comparator.reverseOrder()); // simple, allocates boxed Integers
  ```
- **`binarySearch` em um array não ordenado é um bug de corretude silencioso, não uma falha explícita** — não há exceção para pegar em testes, então o erro tende a aparecer depois, como um defeito de "a busca encontrou o item errado" longe da causa real.
  ```java
  Arrays.binarySearch(new int[]{5, 3, 8}, 8); // undefined result — no exception thrown
  ```
- **`equals`/`toString` vs `deepEquals`/`deepToString` é fácil de errar exatamente uma vez, em uma asserção de teste, e depois confiar para sempre** — um `assertTrue(Arrays.equals(expected2D, actual2D))` que deveria estar comparando conteúdo vai passar ou falhar baseado na identidade de objeto das linhas, não em seus valores.
  ```java
  Arrays.equals(new int[][]{{1}}, new int[][]{{1}}); // false — same content, different sub-array refs
  ```
- **A armadilha do array de tamanho fixo em `Arrays.asList` é uma cilada relacionada mas separada**, coberta em `varargs-pitfalls-and-safe-usage.md` — não repetida aqui, já que é sobre mutação de lista, não sobre ordenação/busca/comparação.
- **`copyOf`/`copyOfRange` sempre alocam um novo array** — conveniente, mas cada chamada é uma cópia O(n); redimensionar um array repetidamente em um loop (em vez de usar uma estrutura que cresça, como `ArrayList`) paga esse custo a cada iteração.

## Documentation Links

- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
- [Arrays.sort(Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#sort(java.lang.Object%5B%5D)) — doc
- [Arrays.binarySearch(int[], int) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#binarySearch(int%5B%5D,int)) — doc
- [Arrays.deepEquals(Object[], Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepEquals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
- [Arrays.deepToString(Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepToString(java.lang.Object%5B%5D)) — doc
