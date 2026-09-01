---
version: 1.0
updatedAt: 2026-08-18
title: "Bucket Sort: Ordenação Baseada em Distribuição"
description: "Uma ordenação sem comparação que espalha n chaves — assumidas uniformemente distribuídas sobre um intervalo conhecido [0, K) — em n buckets de largura igual, ordena cada bucket individualmente e os concatena; sob uniformidade cada bucket guarda O(1) elementos em média, dando tempo esperado O(n), uma suposição estrutural diferente do counting-sort irmão (faixa de inteiros limitada) e do radix-sort (chaves de largura fixa)."
---
## Objetivo

Entenda bucket sort: uma ordenação sem comparação que espalha n chaves — assumidas uniformemente distribuídas sobre um intervalo conhecido `[0, K)` — em n buckets de largura igual `K/n`, ordena cada bucket com um algoritmo simples, e concatena os buckets em ordem. Sob a suposição de uniformidade, espera-se que cada bucket guarde apenas um número pequeno e constante de elementos, que é o que empurra o tempo de execução esperado do algoritmo inteiro para O(n) — uma suposição estrutural diferente do concept irmão `counting-sort` (faixa de inteiros pequena) e do `string-sorts-lsd-msd-radix` (chaves de largura fixa, ordenadas dígito por dígito), mesmo que os três batam o mesmo piso de ordenação por comparação Ω(n log n) ao se recusar a comparar chaves aos pares de qualquer forma.

## Casos de Uso

- Ordenar um grande lote de medições ou pontuações de ponto flutuante já conhecidas por serem aproximadamente uniformes sobre uma faixa fixa — leituras de sensor normalizadas para `[0, 1)`, pontuações de percentil, amostras aleatórias de uma distribuição conhecida — onde o O(n) esperado do bucket sort supera o piso Ω(n log n) de qualquer ordenação por comparação.
- Um passo de pré-processamento antes de uma ordenação por comparação quando a entrada é esperada como aproximadamente uniforme mas a distribuição exata não é garantida o suficiente para confiar cegamente — bucket sort degrada graciosamente para a complexidade de qualquer ordenação por bucket usada, em vez de falhar completamente.
- Qualquer pipeline onde os dados podem ser reescalados para `[0, 1)` primeiro (normalização min-max) e de volta depois — a mesma reescala linear que uma feature numérica recebe antes de muitas rotinas estatísticas ou de machine learning, reutilizada aqui puramente para fazer a suposição de uniformidade valer.
- Ensinar a família geral de "ordenação sem comparação" ao lado de suas duas irmãs: ver as três lado a lado deixa claro que "bater Ω(n log n)" sempre significa "encontrar *alguma* suposição estrutural sobre as chaves para explorar", nunca "encontrar uma forma mais esperta de comparar".

## Aprofundamento

### A ideia central: espalhe em buckets de largura igual, ordene cada um, concatene

Dado um intervalo `I = [0, K)` e n chaves assumidas uniformemente distribuídas sobre ele, o primeiro passo divide `I` em `n` buckets, cada um de largura `K/n`: o bucket `0` cobre `[0, K/n)`, o bucket `1` cobre `[K/n, 2K/n)`, e assim por diante até o bucket `n-1` cobrindo `[(n-1)K/n, K)`. Toda chave `x` é colocada no bucket `floor(n·x/K)` — para o caso comum `K = 1` (chaves já reescaladas para `[0, 1)`), isso é simplesmente `floor(n·x)`.

```
0     1     2     3     4          ...              n-1
[--- | --- | --- | --- | --- | ... | --- ]
0   K/n  2K/n 3K/n 4K/n 5K/n            (n-1)K/n    K
```

Sob a suposição de uniformidade, o número esperado de elementos caindo em qualquer bucket é pequeno e constante — que é o ponto inteiro: se os tamanhos de bucket permanecem O(1) em média, ordenar cada bucket individualmente (mesmo com um algoritmo O(n²) de pior caso como insertion sort) custa só O(1) por bucket, O(n) no total sobre todos os n buckets. O último passo percorre os buckets em ordem e concatena seus conteúdos ordenados no resultado final.

**Exemplo resolvido** (`n = 8` chaves, já em `[0, 1)`): `0.75, 0.1, 0.3, 0.95, 0.05, 0.6, 0.9, 0.15`. O índice de bucket de cada chave é `floor(8·x)`:

```
chave:   0.75  0.10  0.30  0.95  0.05  0.60  0.90  0.15
bucket:   6     0     2     7     0     4     7     1
```

O bucket 0 guarda duas chaves (`0.10`, `0.05`) e o bucket 7 guarda duas (`0.95`, `0.90`) — um transbordo pequeno e inteiramente esperado sob uniformidade, não uma "colisão" de hashing no sentido adversarial que o concept irmão `hash-tables-chaining-and-open-addressing` descreve (lá, um atacante que conhece a função de hash pode deliberadamente forçar toda chave para um único slot; aqui, uniformidade é uma suposição sobre os *dados*, não uma propriedade a defender). Ordenar cada bucket (`{0.05, 0.10}`, `{0.15}`, `{0.30}`, `{0.60}`, `{0.75}`, `{0.90, 0.95}`) e concatenar os buckets `0` a `7` em ordem produz o resultado totalmente ordenado `0.05, 0.10, 0.15, 0.30, 0.60, 0.75, 0.90, 0.95`.

### Implementação em Java

```java
static double[] bucketSort(double[] a, int n) {
    List<Double>[] buckets = new List[n];
    for (int i = 0; i < n; i++) buckets[i] = new ArrayList<>();

    for (double x : a) {
        int index = (x == 1.0) ? n - 1 : (int) Math.floor(n * x);  // x == 1.0 é o único caso extremo: sem
        buckets[index].add(x);                                     // isso, indexaria além do bucket n-1
    }

    for (List<Double> bucket : buckets) {
        Collections.sort(bucket);   // insertion sort na apresentação clássica -- qualquer ordenação por comparação funciona
    }

    double[] result = new double[a.length];
    int k = 0;
    for (List<Double> bucket : buckets)
        for (double x : bucket)
            result[k++] = x;
    return result;
}
```

Reescalar dados arbitrários `[a, b]` para `[0, 1)` primeiro (e de volta depois) torna a suposição de uniformidade usável mesmo quando os dados reais não estão já em `[0, 1)`:

```
y_i = (x_i - x_min) / (x_max - x_min)              # direto: [a, b] -> [0, 1)
x_i = x_min + (x_max - x_min) * y_i                # inverso: [0, 1) -> [a, b], depois de ordenar
```

### Veja acontecendo: espalhando o exemplo resolvido em 8 buckets

```viz
type: formula
capacity = 8
slot = floor(number(item) * capacity)
---
0.75
0.1
0.3
0.95
0.05
0.6
0.9
0.15
```

Isso mostra só o passo de espalhar-nos-buckets — o índice de destino que cada chave calcula, batendo exatamente com a tabela trabalhada à mão acima (bucket 0 destacado como guardando duas chaves, bucket 7 igualmente). Ele **não** mostra a segunda passada, ordenar o conteúdo de cada bucket depois que já aterrissou — o modo `formula` do motor coloca tokens em slots mas não tem noção de uma segunda operação de ordenação dentro do slot, a mesma razão pela qual `simplex-tabular-method` e `linear-programming-formulation-and-duality` pulam um bloco `viz` próprio para conteúdo que os modos deste motor não modelam. Imagine o bucket 0 como `{0.10, 0.05}` momentaneamente fora de ordem até sua própria minúscula passada de insertion sort — não mostrada aqui — colocá-lo em ordem.

### Análise de caso médio: por que dá em O(n)

Seja `X_i` o número de chaves que caem no bucket `i`, e `Y_i` o número de comparações necessárias para ordenar o bucket `i`. Como qualquer ordenação por comparação custa no máximo O(n²) no pior caso, `Y_i <= X_i²`, então `E[Y_i] <= E[X_i²]`. Escrevendo `X_i` como uma soma de variáveis indicadoras `X_ij` (1 se a chave `j` cai no bucket `i`, 0 caso contrário) e expandindo `E[X_i²] = E[(Σ_j X_ij)²]` separa-se em termos diagonais (`E[X_ij²] = P(X_ij = 1) = 1/n`, já que `X_ij` é uma variável 0/1) e termos fora da diagonal (`E[X_ij · X_ik] = E[X_ij]·E[X_ik] = 1/n²`, já que chaves distintas caem em seus buckets independentemente sob uniformidade). Somando ambos sobre `n` chaves:

```
E[Y_i] <= Σ_j (1/n) + Σ_j Σ_{k≠j} (1/n²) = n·(1/n) + n(n-1)·(1/n²) = 1 + (n²-n)/n² = 2 - 1/n
```

Isso limita o custo *esperado* de ordenar um bucket a pouco menos de 2 comparações, independente de `n`. Somado sobre todos os `n` buckets, o custo total esperado é `E[Y] = n·(2 - 1/n) = 2n - 1` — linear em `n`. Somando a passada de espalhamento O(n) e a passada de concatenação O(n), o tempo de execução esperado total é O(n).

### Pior caso: o que acontece quando a entrada não é realmente uniforme

Toda etapa dessa análise se apoia em independência e uniformidade — `E[X_ij] = 1/n` só vale se uma chave for genuinamente igualmente provável de cair em qualquer bucket. Se a entrada real não for uniforme (ou for escolhida adversarialmente), todas as n chaves podem cair no *mesmo* bucket, e todo outro bucket fica vazio. Nesse caso o bucket sort degenera para rodar uma única ordenação por comparação sobre todos os n elementos: O(n²) se essa ordenação por bucket for insertion sort (a escolha da apresentação clássica), ou tão baixo quanto O(n log n) se uma ordenação por comparação com pior caso melhor (mergesort, heapsort) for usada em cada bucket — o pior caso do bucket sort é inteiramente herdado de qualquer ordenação escolhida para limpar cada bucket, já que o próprio passo de espalhamento é sempre O(n) independentemente de onde as chaves caiam.

## Trade-offs

- **A suposição de uniformidade é estrutural, não um detalhe simplificador menor.** Diferente do counting sort (que só precisa de uma faixa de inteiros limitada) ou do radix sort (que só precisa de chaves de largura fixa), o caso *médio* O(n) do bucket sort depende de as chaves realmente estarem espalhadas mais ou menos uniformemente sobre o intervalo. Uma entrada enviesada ou adversarial não apenas desacelera o bucket sort graciosamente — pode concentrar tudo num único bucket, colapsando todo o benefício de ter n buckets em primeiro lugar.
- **A complexidade de pior caso depende da escolha da ordenação por bucket, não do bucket sort em si.** Como uma entrada degenerada pode colocar todos os n elementos num único bucket, o pior caso do bucket sort é exatamente o pior caso de sua ordenação por bucket: O(n²) com insertion sort, ou O(n log n) com uma ordenação que garante esse limite no pior caso (ao custo do fator constante geralmente maior dessa ordenação nos buckets pequenos e do caso esperado que ela realmente está tratando).
- **Reescalar para `[0, 1)` e de volta é uma válvula de escape real e usável** — dados que não começam em `[0, 1)` ainda podem usar bucket sort, ao custo de uma passada linear extra em cada direção, desde que os dados *reescalados* sejam genuinamente próximos de uniformes. Reescalar uma distribuição genuinamente enviesada não a torna uniforme; só a move para um intervalo diferente.
- **O custo de espaço é O(n)** para os próprios n buckets, além do que cada ordenação por bucket precisar — diferente de uma ordenação por comparação in-place, bucket sort sempre paga por esse armazenamento auxiliar de bucket.
- **A estabilidade decorre diretamente da ordenação por bucket e da ordem de concatenação** — como chaves são espalhadas por valor em faixas de bucket que não se sobrepõem e os buckets são concatenados em ordem crescente, a ordenação geral é estável exatamente quando a ordenação por bucket é (insertion sort, a escolha clássica, é estável).

## Documentation Links

- [Introduction to Algorithms, 4ª Edição — Cormen, Leiserson, Rivest, Stein](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Capítulo 8 "Sorting in Linear Time", Seção 8.4 "Bucket sort" — doc
- [Bucket sort — Wikipedia](https://en.wikipedia.org/wiki/Bucket_sort) — doc
