---
version: 1.0
updatedAt: 2026-08-13
title: "Quickselect: Encontrando o k-ésimo Menor Elemento em Tempo Linear"
description: "Como encontrar o k-ésimo menor elemento de um array não ordenado em tempo linear esperado, reaproveitando o próprio passo de partition do quicksort e recursando apenas no lado que contém o rank alvo, mais o algoritmo median-of-medians de Cormen, que garante O(N) mesmo no pior caso."
---
## Objetivo

Entenda o problema de seleção — encontrar o k-ésimo menor elemento de um array não ordenado (a mediana sendo o caso especial k = N/2) — e como resolvê-lo mais rápido do que ordenar primeiro. Quickselect reaproveita a própria rotina de partition do concept irmão de quicksort, mas recursa apenas no único lado sabidamente contendo o k-ésimo elemento, dando tempo O(N) esperado. O algoritmo median-of-medians de Cormen vai além, garantindo O(N) mesmo no pior caso.

## Casos de Uso

- Encontrar uma mediana, percentil, ou corte de top-k sem pagar por um sort completo O(N log N) — ex.: calcular a mediana de um lote de amostras de latência, ou escolher um corte de score para o top 10% dos resultados.
- Um desdobramento natural de entrevista após o quicksort: "você acabou de implementar quicksort — agora encontre o k-ésimo menor elemento sem ordenar o array inteiro."
- Uma baseline para comparar com top-k baseado em `PriorityQueue` (o padrão TopM dos Casos de Uso do concept irmão de quicksort) — quickselect é a alternativa in-place, em passada única, quando toda a coleção já cabe em um array em memória.

## Aprofundamento

### O problema de seleção: por que ordenar primeiro é desperdício

Dado um array não ordenado e um inteiro `k`, o problema de seleção pede o k-ésimo menor elemento — não o array totalmente ordenado, apenas uma entrada dele. A solução óbvia é ordenar e indexar:

```java
Quick.sort(a);
return a[k];   // correto, mas paga por um sort completo que você não precisa
```

Isso funciona porque, depois de um sort completo, `a[k]` é trivialmente o k-ésimo menor — mas custa O(N log N), o mesmo que ordenar o array *inteiro*, mesmo que o problema tenha pedido só uma estatística de ordem entre N. Quando k é uma fração constante de N (a mediana, k = N/2, é o caso difícil canônico — é fácil quando k é muito pequeno ou muito grande, ex.: o mínimo ou o máximo), é possível fazer assintoticamente melhor: encontrar apenas o k-ésimo menor em tempo linear esperado, sem ordenar totalmente mais nada no array.

### Quickselect: particiona uma vez, recursa só em um lado

O movimento-chave que os dois livros compartilham: reaproveite a rotina de partition do concept irmão de quicksort sem modificação, mas em vez de recursar nas *duas* metades como o quicksort faz, recurse apenas na *uma* metade sabidamente contendo o k-ésimo elemento — o trabalho da outra metade é descartado por completo, nunca sequer visitado.

Lembre o que `partition(a, lo, hi)` do concept irmão garante: ele retorna um índice `j` tal que `a[lo..j-1]` são todos ≤ `a[j]` e `a[j+1..hi]` são todos ≥ `a[j]`. Essa é exatamente a informação necessária para decidir qual lado contém o k-ésimo menor elemento, sem olhar o conteúdo de nenhum dos dois lados:

```java
int quickselect(int[] a, int lo, int hi, int k) {
    if (hi <= lo) return a[lo];
    int j = partition(a, lo, hi);      // partition do concept irmão de quicksort, sem modificação
    if (j == k)      return a[j];      // pivot caiu exatamente no rank alvo — pronto
    else if (j > k)  return quickselect(a, lo, j - 1, k);   // k está na parte esquerda
    else              return quickselect(a, j + 1, hi, k);  // k está na parte direita
}
```

O próprio `select()` de Sedgewick & Wayne (na seção de Aplicações, depois de priority queues) expressa a mesma lógica como um loop iterativo em vez de uma recursão, embaralhando o array primeiro para se proteger contra entrada adversária:

```java
public static Comparable select(Comparable[] a, int k) {
    StdRandom.shuffle(a);
    int lo = 0, hi = a.length - 1;
    while (hi > lo) {
        int j = partition(a, lo, hi);
        if      (j == k) return a[k];
        else if (j > k)  hi = j - 1;
        else             lo = j + 1;
    }
    return a[k];
}
```

**Por que isso é O(N) esperado:** se cada chamada de partition acontece de dividir seu subarray aproximadamente ao meio, o trabalho total ao longo de todas as chamadas recursivas (de único ramo) é proporcional a N + N/2 + N/4 + N/8 + ... — uma série geométrica que soma menos que 2N. Sedgewick & Wayne declaram isso como a Proposition U: *"seleção baseada em partition é um algoritmo de tempo linear, em média."* Esse é um limite estritamente melhor que o próprio caso médio O(N log N) do quicksort, precisamente porque o quickselect descarta o trabalho de um lado a cada nível em vez de recursar nos dois.

O qualificador "em média" carrega exatamente a mesma ressalva do próprio quicksort: a análise assume o particionamento em um elemento aleatório (ou aleatoriamente embaralhado), então a garantia é probabilística. Uma escolha de pivot consistentemente ruim — as mesmas entradas adversárias ou já ordenadas que degradam o quicksort — degrada o quickselect para O(N²) no pior caso; veja a própria discussão de pior caso do concept irmão de quicksort em vez de rederivá-la aqui. O `RANDOMIZED-SELECT` de Cormen é o mesmo algoritmo sob outro nome, com a mesma recorrência de pior caso `T(n) = T(n-1) + Θ(n)` que o quicksort tem quando um partition só consegue arrancar um elemento de cada vez.

### Veja acontecendo: um traço trabalhado de 9 elementos

Pegue `a = [7, 2, 9, 4, 1, 8, 3, 6, 5]` (índices 0-8) e busque `k = 4` — a mediana, ou seja, o 5º menor entre esses 9 valores distintos (que é 5, fácil de confirmar contra o array totalmente ordenado `[1,2,3,4,5,6,7,8,9]`). Isso roda o partition real ao estilo Sedgewick do concept irmão de quicksort, traçado à mão chamada por chamada — repare como cada passo depois de uma chamada de partition descarta permanentemente um lado inteiro em vez de recursar nele:

```viz
type: moves
mark 0 | Pivot para a[0..8] é "7" — alvo: encontrar k=4, a mediana (5º menor de 9).
swap 2 8 | Varredura da esquerda encontra "9" (pos 2, ≥ pivot); varredura da direita encontra "5" (pos 8, ≤ pivot) — troca-os.
swap 5 7 | Varredura da esquerda encontra "8" (pos 5, ≥ pivot); varredura da direita encontra "6" (pos 7, ≤ pivot) — troca-os.
swap 0 6 | As varreduras se encontram na posição 6: troca o pivot "7" pro lugar — sua posição final é j=6.
remove 9 | j=6 > k=4, então recursa à ESQUERDA em a[0..5] apenas — "9" fica à direita do pivot, descartado de vez.
remove 8 | Também descartado: "8" está à direita do pivot também, nunca mais visitado.
remove 7 | O próprio pivot (j=6 ≠ k=4) também é descartado — ele está no seu lugar final ordenado, mas não é a[k].
mark 0 | Recursa em a[0..5]. Novo pivot é a[0] = "3".
swap 2 4 | Varredura da esquerda encontra "5" (pos 2, ≥ pivot); varredura da direita encontra "1" (pos 4, ≤ pivot) — troca-os.
swap 0 2 | As varreduras se encontram na posição 2: troca o pivot "3" pro lugar — j=2.
remove 1 | j=2 < k=4, então recursa à DIREITA em a[3..5] apenas — "1" (agora na posição 0) é descartado.
remove 2 | Também descartado: "2" nunca se moveu e também é excluído.
remove 3 | O próprio pivot (j=2 ≠ k=4) é descartado — k=4 vive à sua direita, não à sua esquerda.
mark 3 | Recursa em a[3..5]. Novo pivot é a[3] = "4".
remove 4 | Nenhuma troca é necessária — o pivot cai de volta exatamente em j=3. j=3 < k=4, então também é descartado.
mark 4 | Recursa em a[4..5]. Novo pivot é a[4] = "5" — só "5" e "6" continuam em jogo.
remove 6 | Nenhuma troca necessária: "5" ≤ "6" já, então j=4 = k=4 imediatamente — pronto. "6" é descartado sem ser visitado; o quicksort ainda teria que ordená-lo.
mark 4 | Resposta: a[4] = "5", o 5º menor (mediana) dos 9 elementos originais — encontrado depois de 3 chamadas de partition, sem nunca ordenar o resto.
---
7
2
9
4
1
8
3
6
5
```

Três chamadas de partition, cada uma descartando um lado inteiro do array, pousam diretamente na resposta — nenhuma comparação foi desperdiçada ordenando elementos que estavam do lado "errado" desde o início.

### Median of medians: garantindo O(N) no pior caso (só Cormen)

O quickselect aleatorizado acima é tempo linear *esperado*, mas ainda O(N²) no pior caso, pela mesma razão que o quicksort é: uma sequência azarada de pivots ruins. O `SELECT` de Cormen (Capítulo 9, Seção 9.3) é um algoritmo genuinamente diferente — não coberto por Sedgewick & Wayne — que garante O(N) mesmo no pior caso, substituindo o pivot aleatório por um *comprovadamente bom*, encontrado recursivamente:

1. Divida os n elementos em ⌈n/5⌉ grupos de 5 elementos cada (o último grupo pode ser incompleto).
2. Ordene cada grupo de 5 no lugar — barato, já que ordenar um grupo de tamanho fixo 5 é O(1) independente de n.
3. Pegue a mediana de cada grupo (o 3º elemento de cada grupo ordenado de 5).
4. Chame `SELECT` recursivamente só sobre essas ⌈n/5⌉ medianas de grupo para encontrar a mediana delas — chame-a de `x`. Esse é o pivot.
5. Particione o array inteiro em torno de `x` (uma generalização do partition do concept irmão que recebe o valor do pivot como parâmetro, em vez de sempre escolher `a[lo]`).
6. Recurse no lado que contém o k-ésimo elemento — exatamente como no quickselect acima.

```java
int select(int[] a, int lo, int hi, int k) {
    if (hi <= lo) return a[lo];
    int pivot = medianOfMedians(a, lo, hi);
    int j = partitionAround(a, lo, hi, pivot);  // partition do irmão, generalizado para um valor de pivot dado
    if (j == k)      return a[j];
    else if (j > k)  return select(a, lo, j - 1, k);
    else              return select(a, j + 1, hi, k);
}

int medianOfMedians(int[] a, int lo, int hi) {
    int n = hi - lo + 1;
    int numGroups = (n + 4) / 5;
    int[] medians = new int[numGroups];
    for (int g = 0; g < numGroups; g++) {
        int groupLo = lo + g * 5;
        int groupHi = Math.min(groupLo + 4, hi);
        Arrays.sort(a, groupLo, groupHi + 1);   // um grupo de ≤5 elementos: O(1) pra ordenar
        medians[g] = a[(groupLo + groupHi) / 2];
    }
    return select(medians, 0, numGroups - 1, numGroups / 2);  // mediana DAS medianas, encontrada recursivamente
}
```

A única ideia de prova substancial é esta: como cada grupo de 5 está ordenado, os grupos cuja mediana é ≤ `x` contribuem não só sua mediana mas também os dois elementos abaixo dela, todos ≤ `x` — e simetricamente para os grupos cuja mediana é ≥ `x`. Contando isso ao longo de aproximadamente metade dos grupos de cada lado dá a garantia-chave: **o pivot median-of-medians `x` é garantidamente maior que pelo menos 3/10 dos elementos, e menor que pelo menos 3/10 dos elementos.** Isso limita o quão desbalanceada a divisão do partition pode ser — o lado excluído da recursão sempre tem pelo menos 3n/10 elementos removidos da consideração, então o lado em que se recursa tem no máximo 7n/10 elementos, no *pior* caso, não só em média.

Isso dá a recorrência `T(n) ≤ T(n/5) + T(7n/10) + O(n)` — o termo `T(n/5)` é o custo de encontrar a median-of-medians em si, o termo `T(7n/10)` é o custo da única chamada recursiva para o lado maior possível, e `O(n)` cobre o agrupamento, a ordenação de cada grupo de 5, e o particionamento. Como `n/5 + 7n/10 = 9n/10 < n`, essa recorrência resolve para **O(n)** por substituição (assuma `T(n) ≤ cn`, substitua, e a folga `-cn/10` absorve o termo `O(n)` para `c` grande o suficiente) — tempo linear de pior caso, garantido, independente da entrada.

Esse é um resultado genuinamente engenhoso, não óbvio — mas Cormen é explícito que ele é "principalmente de interesse teórico": os fatores constantes de agrupar em 5s, ordenar cada grupo, e recursar duas vezes por nível (uma para o pivot, outra para a seleção em si) o tornam mais lento na prática que o quickselect aleatorizado, apesar da garantia de pior caso mais fraca deste último. Median-of-medians ganha seu lugar como técnica de prova e como fallback de segurança contra entrada adversária, não como o algoritmo que você usaria por padrão.

## Trade-offs

- **O(N) esperado, não garantido** — mesma ressalva probabilística do quicksort: um pivot consistentemente ruim degrada o quickselect aleatorizado para O(N²). A mitigação padrão também é idêntica: embaralhar o array (ou escolher um pivot aleatório) para que o pior caso não seja disparado por entradas comuns como dados já ordenados. Veja os Trade-offs do concept irmão de quicksort para a discussão completa.
- **Median-of-medians troca uma garantia forte por constantes grandes** — o `SELECT` de pior caso O(N) de Cormen é um resultado real, não só uma curiosidade, mas seu overhead (agrupar em 5s, ordenar cada grupo, duas chamadas recursivas por nível) torna o quickselect aleatorizado mais rápido na prática quase sempre. Use-o só quando uma garantia de pior caso importar genuinamente mais que a velocidade do caso típico.
- **Modifica o array no lugar** — como o partition do concept irmão de quicksort, tanto `quickselect` quanto `SELECT` reordenam o array de entrada como efeito colateral (parcialmente: só em torno do rank alvo, não totalmente ordenado). Se a ordem original precisa sobreviver, trabalhe sobre uma cópia.
- **O JDK não traz um algoritmo de seleção** — não existe `Arrays.select(a, k)`. Recorrer a `Arrays.sort(a)` e depois `a[k]` é o padrão pragmático (ótimo para uma chamada avulsa em um array pequeno-a-médio); implementar quickselect à mão só compensa quando a seleção acontece com frequência suficiente, ou em arrays grandes o bastante, para a diferença O(N) vs O(N log N) importar. Top-k baseado em `PriorityQueue` (veja o caso de uso TopM do concept irmão de quicksort) é a alternativa usual quando os dados chegam como um stream ilimitado em vez de já estarem em um array.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 2.5 "Applications" (depois de priority queues), `select()`, pp. 346-347 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 9 "Medians and Order Statistics", Seções 9.1-9.3, pp. 229-241 — book
- [Princeton Algorithms, 4th Ed. — Quicksort (site complementar, referência de partitioning)](https://algs4.cs.princeton.edu/23quicksort/) — doc
- [PriorityQueue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html) — doc
