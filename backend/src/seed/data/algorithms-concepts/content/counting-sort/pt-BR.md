---
version: 1.0
updatedAt: 2026-08-14
title: "Counting Sort: Quebrando o Limite Inferior dos Comparison Sorts"
description: "Counting sort assume que cada elemento de entrada é um inteiro não negativo em um intervalo limitado de 0 a k, e ordena em tempo Theta(n + k) — Theta(n) quando k = O(n) — contando e fazendo soma de prefixos em vez de comparar, que é exatamente como ele supera o limite Omega(n lg n) que só se aplica a comparison sorts."
---
## Objetivo

Entenda o counting sort: um sort que assume que cada elemento de entrada é um inteiro no intervalo 0 a k, e roda em tempo Θ(n + k) — Θ(n) quando k = O(n) — contando quantos elementos são menores ou iguais a cada valor e usando essa contagem para posicionar cada elemento diretamente em sua posição final, sem nunca comparar dois elementos de entrada entre si.

## Casos de Uso

- Ordenar n inteiros que se sabe de antemão estarem em um intervalo pequeno de 0 a k, onde k = O(n) — o caso em que o tempo de execução Θ(n) do counting sort realmente supera o limite Ω(n lg n) ao qual comparison sorts estão presos.
- Como sub-rotina dentro do radix sort, onde cada "dígito" de um valor multi-chave é ele mesmo um inteiro pequeno e limitado, ordenado com counting sort — isso só funciona corretamente se o counting sort for estável.
- Qualquer situação em que você precise saber, para cada elemento, quantos outros elementos são menores ou iguais a ele — a passada de contagem/soma de prefixos produz exatamente essa informação como subproduto.

## Aprofundamento

### As três passadas: contar, acumular, posicionar

Counting sort primeiro determina, para cada elemento de entrada x, o número de elementos menores ou iguais a x, depois usa esse número para posicionar x diretamente em sua posição no array de saída. Se 17 elementos são menores ou iguais a x, x pertence à posição 17 da saída — com uma reviravolta para lidar com valores duplicados de forma que não colidam todos na mesma posição.

O procedimento `COUNTING-SORT(A, n, k)` do livro recebe o array `A[1..n]`, o tamanho n, e o limite k dos valores inteiros não negativos em A. Ele retorna a saída ordenada no array `B[1..n]` e usa `C[0..k]` como armazenamento temporário de trabalho. Traduzido para um array Java 0-indexado (os arrays do livro são 1-indexados, então uma posição de saída `C[A[j]]` vira `C[A[j]] - 1` uma vez que B fica 0-indexado):

```java
static int[] countingSort(int[] a, int k) {
    int n = a.length;
    int[] b = new int[n];
    int[] c = new int[k + 1];

    for (int i = 0; i <= k; i++) {
        c[i] = 0;                          // linhas 2-3: inicializa C com tudo zero
    }
    for (int j = 0; j < n; j++) {
        c[a[j]] = c[a[j]] + 1;             // linhas 4-5: C[i] = # elementos iguais a i
    }
    for (int i = 1; i <= k; i++) {
        c[i] = c[i] + c[i - 1];            // linhas 7-8: C[i] = # elementos <= i
    }
    for (int j = n - 1; j >= 0; j--) {     // linhas 11-13: copia A para B, do fim de A
        b[c[a[j]] - 1] = a[j];
        c[a[j]] = c[a[j]] - 1;             // decrementa, pra lidar com valores duplicados
    }
    return b;
}
```

Depois que o primeiro loop zera `C`, o segundo loop passa por `A` e incrementa `C[i]` cada vez que encontra um elemento igual a `i`; depois dessa passada, `C[i]` guarda o número de elementos de entrada iguais a `i` para cada `i = 0, 1, ..., k`. O terceiro loop transforma isso em uma soma corrente, então `C[i]` agora guarda o número de elementos de entrada menores ou iguais a `i`. O loop final passa por `A` de novo, ao contrário, posicionando cada elemento em sua posição correta ordenada em `B` e decrementando `C` para que a próxima ocorrência do mesmo valor caia uma posição antes.

### Exemplo trabalhado, traçado passo a passo

O livro traça `COUNTING-SORT` em `A[1..8] = <2, 5, 3, 0, 2, 3, 0, 3>` com `k = 5` (todo valor é um inteiro não negativo no máximo 5). Seguindo o mesmo array (1-indexado, batendo com o livro):

```
Entrada A (posições 1..8):        2  5  3  0  2  3  0  3

Depois da passada de contagem (linha 5), C[i] = # elementos iguais a i:
  i:  0  1  2  3  4  5
  C:  2  0  2  3  0  1

Depois da passada de soma de prefixos (linha 8), C[i] = # elementos <= i:
  i:  0  1  2  3  4  5
  C:  2  2  4  7  7  8
```

O último loop então percorre `A` de `j = 8` até `j = 1`, posicionando cada `A[j]` na posição `C[A[j]]` de `B` e decrementando `C[A[j]]` depois:

```
j=8  A[8]=3  C[3]=7 -> B[7]=3   C[3] vira 6
j=7  A[7]=0  C[0]=2 -> B[2]=0   C[0] vira 1
j=6  A[6]=3  C[3]=6 -> B[6]=3   C[3] vira 5
j=5  A[5]=2  C[2]=4 -> B[4]=2   C[2] vira 3
j=4  A[4]=0  C[0]=1 -> B[1]=0   C[0] vira 0
j=3  A[3]=3  C[3]=5 -> B[5]=3   C[3] vira 4
j=2  A[2]=5  C[5]=8 -> B[8]=5   C[5] vira 7
j=1  A[1]=2  C[2]=3 -> B[3]=2   C[2] vira 2

Saída B (posições 1..8):       0  0  2  2  3  3  3  5
```

Se todos os n elementos fossem distintos, `C[A[j]]` já seria a posição final correta de `A[j]` na primeira vez que a linha 11 é executada, já que `C[A[j]]` conta exatamente os elementos menores ou iguais a `A[j]`. Como elementos podem se repetir, decrementar `C[A[j]]` depois de cada posicionamento faz com que o elemento *anterior* em `A` com o mesmo valor — se existir — pouse imediatamente antes dele em `B`.

### Por que Θ(n + k) não viola o limite inferior Ω(n lg n) de ordenação

Counting sort consegue superar o limite inferior Ω(n lg n) dos comparison sorts porque não é um comparison sort — nenhuma comparação entre elementos de entrada acontece em nenhum lugar do código. Em vez disso, ele usa os valores reais dos elementos para indexar diretamente em um array (`C[A[j]]`). O limite inferior Ω(n lg n) só se aplica a algoritmos que determinam a ordem comparando elementos; ele não se aplica assim que você sai do modelo de comparison sort, que é exatamente o que indexar por valor faz.

Em termos de tempo: o loop de inicialização (linhas 2-3) leva Θ(k), o loop de contagem (linhas 4-5) leva Θ(n), o loop de soma de prefixos (linhas 7-8) leva Θ(k), e o loop de posicionamento (linhas 11-13) leva Θ(n). O tempo de execução total é Θ(k + n). Na prática, counting sort é usado quando k = O(n), caso em que o tempo de execução é Θ(n).

### Estabilidade, e por que o loop roda ao contrário

Counting sort é estável: elementos com o mesmo valor aparecem no array de saída na mesma ordem em que aparecem no array de entrada — empates são desfeitos por quem aparece primeiro na entrada. Normalmente estabilidade só importa quando dados satélite viajam junto com a chave ordenada, mas aqui ela importa por outra razão: counting sort é frequentemente usado como sub-rotina no radix sort, e o radix sort só funciona corretamente se o counting sort for estável.

Essa estabilidade não é automática — ela depende de varrer `A` ao contrário (`j = n downto 1`) e decrementar `C[A[j]]` depois de cada posicionamento. O livro coloca isso diretamente como um exercício: reescreva o cabeçalho do loop na linha 11 para rodar para frente em vez disso —

```java
for (int j = 0; j < n; j++) {   // em vez de j = n - 1 downto 0
    b[c[a[j]] - 1] = a[j];
    c[a[j]] = c[a[j]] - 1;
}
```

— e o algoritmo ainda ordena corretamente, mas deixa de ser estável. Varrer a partir do fim é o que garante que, entre elementos de valor igual, o que aparece primeiro em `A` seja escrito na posição mais cedo em `B`.

## Trade-offs

- **Só ordena chaves inteiras limitadas e não negativas, não valores `Comparable` arbitrários** — o algoritmo assume que todo elemento é um inteiro em um intervalo conhecido de 0 a k; ele não tem noção de comparação, então não pode receber objetos `Comparable` arbitrários do jeito que um comparison sort pode.
- **Θ(n + k) é linear só quando k = O(n)** — as passadas de contagem e soma de prefixos custam Θ(k) cada, independente de quantos elementos existam de fato, então se k é muito maior que n, essas passadas dominam e o sort deixa de se comportar como Θ(n).
- **Estabilidade vem de uma escolha específica de implementação, não de graça** — a varredura reversa (`j = n downto 1`) combinada com decrementar `C[A[j]]` depois de cada posicionamento é o que torna o counting sort estável; reescrever o loop final para varrer para frente ainda produz um array ordenado, mas quebra a estabilidade, o que importa se o counting sort está sendo usado como sub-rotina do radix sort.
- **Custa espaço auxiliar Θ(n + k)** para o array de saída `B` e o array de contagem `C`, além do array de entrada `A` — diferente de um comparison sort in-place, counting sort sempre precisa desse armazenamento extra.

## Documentation Links

- [Introduction to Algorithms, 4th Edition — Cormen, Leiserson, Rivest, Stein](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Seção 8.2 "Counting sort", pp. 209-211 — doc
