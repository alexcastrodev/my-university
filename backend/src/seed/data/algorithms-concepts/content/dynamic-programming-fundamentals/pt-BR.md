---
version: 1.0
updatedAt: 2026-08-13
title: "Programação Dinâmica: Memoização, Tabulação e Corte de Hastes"
description: "Veja por que programação dinâmica supera a recursão simples só quando os subproblemas se sobrepõem, usando o problema do corte de hastes do CLRS: a recursão ingênua e exponencial CUT-ROD, o cache de memoização que garante que cada tamanho de subproblema seja computado exatamente uma vez, o preenchimento bottom-up da tabela que constrói a mesma resposta iterativamente, e as duas marcas registradas — subestrutura ótima e subproblemas sobrepostos — que determinam se DP se aplica ou não."
---
## Objetivo

Entenda programação dinâmica como uma técnica distinta de divide-and-conquer — ela se aplica quando quebrar um problema recursivamente produz subproblemas *sobrepostos* (o mesmo tamanho de subproblema é resolvido repetidamente em diferentes caminhos de chamada), em vez de subproblemas novos e disjuntos. O CLRS enquadra isso como uma receita de quatro passos: caracterizar a estrutura de uma solução ótima, defini-la recursivamente, computar esse valor bottom-up e (opcionalmente) reconstruir a solução real a partir da tabela. O corte de hastes — o próprio exemplo condutor do CLRS — torna o ganho concreto: o mesmo problema passa de uma recursão ingênua de tempo exponencial para um preenchimento de tabela de tempo quadrático, apenas garantindo que cada subproblema seja resolvido uma vez em vez de repetidas vezes.

## Casos de Uso

- Qualquer problema de otimização construído a partir de uma escolha que deixa para trás uma instância menor do *mesmo* problema — corte de estoque/hastes, troco de moedas, knapsack, edit distance — onde a solução recursiva ingênua visivelmente refaz o mesmo trabalho.
- Reconhecer, antes de escrever qualquer código, se um problema é candidato a divide-and-conquer (subproblemas disjuntos — as duas metades do mergesort nunca se sobrepõem) ou a programação dinâmica (subproblemas sobrepostos — o mesmo comprimento de haste menor é necessário para muitos cortes maiores diferentes).
- Escolher entre top-down (recursão memoizada, mais fácil de derivar diretamente da recorrência) e bottom-up (tabulação, geralmente mais rápida na prática, sem overhead de pilha de chamadas) uma vez confirmado que um problema tem as marcas registradas de DP.

## Aprofundamento

### Por que subproblemas sobrepostos quebram a recursão simples: a explosão exponencial do CUT-ROD

A Serling Enterprises tem uma tabela de preços `p[i]` para uma haste de comprimento `i`, e quer a receita máxima `r[n]` obtida cortando uma haste de comprimento `n` em pedaços e vendendo-os (os cortes são grátis). A tradução recursiva direta da recorrência `r[n] = max(p[i] + r[n-i])` para `1 <= i <= n` é o `CUT-ROD` do CLRS:

```java
static int cutRod(int[] p, int n) {
    if (n == 0) return 0;
    int q = Integer.MIN_VALUE;
    for (int i = 1; i <= n; i++) {
        q = Math.max(q, p[i] + cutRod(p, n - i));
    }
    return q;
}
```

Isso está correto, e também é exponencial em `n` — o CLRS observa que quando `n` chega na faixa dos 30 ou 40, leva de minutos a horas, aproximadamente dobrando a cada vez que `n` aumenta em um. O motivo: `cutRod(p, n)` chama `cutRod(p, n - i)` para todo `i` de `1` a `n`, o que é o mesmo que chamar `cutRod(p, j)` para todo `j` de `0` a `n - 1` — e cada uma *dessas* chamadas faz a mesma coisa de novo. O mesmo tamanho de subproblema é resolvido do zero toda vez que é necessário, em vez de uma única vez.

Instrumentar a versão ingênua para contar chamadas por tamanho de subproblema torna a explosão visível, em vez de apenas afirmada:

```java
static int[] callsBySize = new int[5]; // índice = comprimento da haste sendo resolvido

static int cutRodCounted(int[] p, int n) {
    callsBySize[n]++;
    if (n == 0) return 0;
    int q = Integer.MIN_VALUE;
    for (int i = 1; i <= n; i++) {
        q = Math.max(q, p[i] + cutRodCounted(p, n - i));
    }
    return q;
}
```

Rodando `cutRodCounted(p, 4)` e imprimindo `callsBySize` depois:

```
comprimento de haste resolvido:  4    3    2    1    0
número de chamadas:              1    1    2    4    8      (16 chamadas no total)
```

Uma única chamada para resolver o comprimento 4 dispara 16 chamadas recursivas no total — e o caso-base de comprimento 0 sozinho é recomputado 8 vezes separadas, o comprimento 1 quatro vezes, o comprimento 2 duas vezes. A árvore de recursão do CLRS (Figura 14.3) mostra exatamente essa forma para `n = 4`: a contagem de chamadas necessárias para resolver uma haste de comprimento `n`, `T(n)`, satisfaz `T(0) = 1` e `T(n) = 1 + soma(T(j) para j = 0..n-1)`, o que dá `T(n) = 2^n` — genuinamente exponencial, e é exponencial *especificamente* porque a recursão fica revisitando tamanhos de subproblema já resolvidos, não porque o problema em si exija exponencialmente muitas peças distintas de trabalho.

### Memoização: cachear a resposta de cada subproblema, computá-la exatamente uma vez

A *estrutura* recursiva do `CUT-ROD` não precisa mudar para corrigir isso — só sua contabilidade precisa. A memoização top-down mantém a mesma forma, mas checa um cache antes de fazer qualquer trabalho, e escreve nesse cache antes de retornar:

```java
static int memoizedCutRod(int[] p, int n) {
    int[] r = new int[n + 1];
    Arrays.fill(r, -1); // -1 marca "ainda não resolvido" (receita é sempre >= 0)
    return memoizedCutRodAux(p, n, r);
}

static int memoizedCutRodAux(int[] p, int n, int[] r) {
    if (r[n] >= 0) return r[n];          // esse tamanho já foi resolvido — só consultar
    int q;
    if (n == 0) {
        q = 0;
    } else {
        q = Integer.MIN_VALUE;
        for (int i = 1; i <= n; i++) {
            q = Math.max(q, p[i] + memoizedCutRodAux(p, n - i, r));
        }
    }
    r[n] = q;   // lembrar — toda chamada futura para esse tamanho retorna em O(1)
    return q;
}
```

Com o cache no lugar, na primeiríssima vez que `memoizedCutRodAux` é chamado para o comprimento de haste 2, ele faz a computação completa e guarda a resposta em `r[2]`. Toda chamada subsequente para o comprimento 2 — e na árvore de `n = 4` acima, houve duas — cai na checagem `r[n] >= 0` e retorna imediatamente. Cada tamanho de subproblema distinto de `0` a `n` é computado exatamente uma vez; toda outra visita é uma consulta de tempo constante. Isso transforma a recursão ingênua `Θ(2^n)` em `Θ(n^2)`: `n + 1` subproblemas distintos, cada um fazendo até `n` unidades de trabalho no seu `for`.

### Tabulação bottom-up: preencher a tabela na ordem de dependência, do menor para o maior

A estrutura recursiva e o cache juntos são só uma forma indireta de dizer "resolva os subproblemas do menor para o maior, e lembre-se das respostas". A tabulação faz isso diretamente, sem nenhuma recursão: um loop comum preenche `r[0..n]` em ordem crescente de comprimento de haste, de modo que, quando o loop precisar de `r[j - i]` para ajudar a computar `r[j]`, esse valor já esteja preenchido.

```java
static int bottomUpCutRod(int[] p, int n) {
    int[] r = new int[n + 1];
    r[0] = 0; // uma haste de comprimento 0 não gera receita
    for (int j = 1; j <= n; j++) {         // resolve os subproblemas do menor para o maior
        int q = Integer.MIN_VALUE;
        for (int i = 1; i <= j; i++) {
            q = Math.max(q, p[i] + r[j - i]);  // r[j - i] já está preenchido
        }
        r[j] = q;
        printTableSoFar(r, j);
    }
    return r[n];
}
```

Usando a própria tabela de preços de exemplo do CLRS (`p[1..10] = 1, 5, 8, 9, 10, 17, 17, 20, 24, 30`), imprimir o conteúdo da tabela depois de processar os comprimentos de haste 2, 6 e 10 mostra o array realmente se preenchendo, da esquerda para a direita, cada entrada dependendo apenas de entradas já à sua esquerda:

Depois de `j = 2`:

| comprimento `i` | 0 | 1 | 2 |
|---|---|---|---|
| `r[i]` | 0 | 1 | 5 |

Depois de `j = 6`:

| comprimento `i` | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| `r[i]` | 0 | 1 | 5 | 8 | 10 | 13 | 17 |

Depois de `j = 10` (final):

| comprimento `i` | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `r[i]` | 0 | 1 | 5 | 8 | 10 | 13 | 17 | 18 | 22 | 25 | 30 |

`r[4] = 10` confirma que o corte ótimo para uma haste de comprimento 4 é dois pedaços de 2 polegadas (`p[2] + p[2] = 5 + 5 = 10`), superando vendê-la inteira (`p[4] = 9`) — e foi computado usando `r[2]`, que o loop já havia preenchido duas iterações antes. Tanto memoização quanto tabulação rodam em `Θ(n^2)` — o CLRS observa que a tabulação costuma vencer em fatores constantes na prática, já que não tem overhead de chamada de procedimento, enquanto a vantagem da memoização é que ela cai diretamente da recorrência, com menos reestruturação.

### As duas marcas registradas: quando programação dinâmica de fato se aplica

O CLRS nomeia exatamente duas propriedades que um problema de otimização precisa ter para que programação dinâmica seja uma técnica viável:

- **Subestrutura ótima** — uma solução ótima para o problema contém dentro dela soluções ótimas para subproblemas. Para corte de hastes: se cortar uma haste de comprimento `n` de forma ótima envolve algum corte, o pedaço que sobra depois desse primeiro corte precisa, ele próprio, ser cortado de forma ótima — se não fosse, encaixar uma solução melhor para o restante venceria a solução original supostamente ótima, uma contradição.
- **Subproblemas sobrepostos** — um algoritmo recursivo para o problema revisita repetidamente os *mesmos* tamanhos de subproblema, em vez de gerar novos a cada passo, e o número total de subproblemas distintos é polinomial no tamanho da entrada. É exatamente isso que o trace de `callsBySize` acima demonstra: existem apenas 5 comprimentos de haste distintos (0-4) como subproblemas, mas a recursão ingênua os resolve 16 vezes no total.

Essa é precisamente a propriedade que separa programação dinâmica de divide-and-conquer. O CLRS afirma isso diretamente: divide-and-conquer "particiona o problema em subproblemas disjuntos, resolve os subproblemas recursivamente e depois combina suas soluções" — a metade esquerda e a metade direita do mergesort nunca compartilham nenhum sub-subproblema, então não há nada para cachear e nenhum benefício em memoizar. Programação dinâmica se aplica precisamente quando essa disjunção se quebra: "um algoritmo de divide-and-conquer faz mais trabalho do que o necessário, resolvendo repetidamente os subsubproblemas comuns." Subestrutura ótima sozinha também não é suficiente — o contraexemplo do CLRS é o caminho simples *mais longo* não ponderado, que tem subproblemas com a forma de subestrutura ótima que acabam não sendo independentes (encaixar dois subcaminhos localmente ótimos pode revisitar um vértice e produzir um caminho ilegal, não simples), e nenhuma solução DP eficiente para ele é conhecida.

## Trade-offs

- **Memoização vs. tabulação é uma escolha real de engenharia, não só de estilo** — memoização costuma ser o menor diff a partir de uma solução recursiva de força bruta (adicione um cache, verifique-o, popule-o) e naturalmente pula subproblemas que o padrão de chamadas top-down nunca de fato precisa; tabulação garante que você visite todo subproblema na ordem de dependência, sem risco de profundidade de pilha de recursão, e tipicamente fatores constantes menores, ao custo de se comprometer a resolver *todo* o espaço de subproblemas de antemão.
- **Programação dinâmica é fundamentalmente um trade-off de tempo por memória, e o CLRS diz isso explicitamente** — o array extra `Θ(n)` (ou a tabela `Θ(n^2)`, para problemas bidimensionais como matrix-chain multiplication) é o preço pago para converter tempo exponencial em tempo polinomial. Para uma instância de corte de hastes onde `n` é genuinamente enorme, esse custo de memória merece ser checado, não simplesmente assumido como grátis.
- **As duas marcas registradas são obrigatórias — subestrutura ótima sem subproblemas sobrepostos significa que DP não compra nada**: se toda chamada recursiva em um algoritmo de divide-and-conquer correto produz subproblemas que nenhuma outra chamada jamais precisará de novo (as metades do mergesort), um cache fica ali sem uso e só adiciona overhead. Confirme que uma solução recursiva está de fato revisitando tamanhos de subproblema (como o trace de `callsBySize` mostra para corte de hastes) antes de recorrer a um cache.
- **Precisar da solução real, não só do seu valor, custa mais uma tabela** — `memoizedCutRod`/`bottomUpCutRod` acima retornam apenas a receita ótima `r[n]`; reconstruir quais cortes a produziram significa também rastrear um array paralelo `s[]` registrando a escolha feita em cada subproblema (o `EXTENDED-BOTTOM-UP-CUT-ROD` do CLRS), o que é fácil de acrescentar mas fácil de esquecer se o enunciado do problema silenciosamente precisar do "como", não só do "quanto".

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 14 "Dynamic Programming" (abertura) e Seção 14.1 "Rod cutting", pp. 361-372 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Seção 14.3 "Elements of dynamic programming", pp. 382-390 — book
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
