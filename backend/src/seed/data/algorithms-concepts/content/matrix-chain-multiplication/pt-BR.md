---
version: 1.0
updatedAt: 2026-08-14
title: "Matrix-Chain Multiplication: Encontrando a Parentetização Mais Barata"
description: "O segundo exemplo trabalhado de programação dinâmica do CLRS: encontrar a parentetização de uma cadeia de matrizes que minimiza o total de multiplicações escalares, preenchendo uma tabela Theta(n^2) de subproblemas indexados por intervalo de matrizes em tempo O(n^3), em vez de enumerar as exponencialmente muitas parentetizações possíveis."
---
## Objetivo

Aprenda o segundo exemplo trabalhado do CLRS do método de programação dinâmica (depois de rod cutting): dada uma cadeia de matrizes para multiplicar, encontre a parentetização que minimiza o número total de multiplicações escalares — sem de fato realizar nenhuma das multiplicações. Isso assume que você já conhece a metodologia geral de DP (veja `dynamic-programming-fundamentals.md` para a receita de quatro passos e as características de subestrutura ótima / subproblemas sobrepostos); o foco aqui é aplicar essa receita a um problema cujos subproblemas são indexados por um par `(i, j)` — um intervalo contíguo da cadeia — em vez do comprimento único `n` do rod cutting.

## Casos de Uso

- Decidir a ordem de avaliação mais barata antes de multiplicar uma cadeia de matrizes: a parentetização escolhida pode fazer uma diferença de ordem de grandeza no custo, não só um fator constante — o próprio exemplo de três matrizes do CLRS calcula 7.500 multiplicações escalares com uma parentetização contra 75.000 com outra, uma diferença de 10x, mesmo que ambas calculem exatamente o mesmo produto.
- Reconhecer quando a busca por força bruta sobre toda parentetização possível é inviável: o número de formas de parentetizar completamente uma cadeia de `n` matrizes, `P(n)`, cresce como `Ω(2^n)` (está intimamente relacionado aos números de Catalan, que crescem como `Θ(4^n / n^(3/2))`), então checar exaustivamente toda parentetização deixa de ser prático muito antes de uma tabela de programação dinâmica deixar.
- Ver a metodologia geral de DP aplicada uma segunda vez a um problema com um formato de subproblema genuinamente diferente do rod cutting: um intervalo 2D `Ai...Aj` sobre a cadeia em vez de um comprimento de prefixo 1D, que é o que motiva a tabela de tamanho `Θ(n^2)` e o tempo de preenchimento `O(n^3)` trabalhados abaixo.

## Aprofundamento

### O problema: parentetizar uma cadeia para minimizar multiplicações escalares

Dada uma cadeia `⟨A1, A2, ..., An⟩` de `n` matrizes para multiplicar, onde a matriz `Ai` tem dimensões `p[i-1] × p[i]`, o objetivo é parentetizar completamente o produto `A1 A2 ... An` de forma a minimizar o número de multiplicações escalares necessárias para calculá-lo — usando o algoritmo padrão para multiplicar pares de matrizes retangulares como sub-rotina. Multiplicação de matrizes é associativa, então toda parentetização produz o mesmo produto; o problema é puramente sobre o *custo* de chegar lá, não sobre correção. O algoritmo padrão para multiplicar uma matriz `p×q` por uma matriz `q×r`, `RECTANGULAR-MATRIX-MULTIPLY`, faz exatamente `p*q*r` multiplicações escalares (seu loop mais interno roda `p*q*r` vezes):

```java
// RECTANGULAR-MATRIX-MULTIPLY(A, B, C, p, q, r): C += A * B, A é p x q, B é q x r
static void rectangularMatrixMultiply(double[][] a, double[][] b, double[][] c, int p, int q, int r) {
    for (int i = 0; i < p; i++) {
        for (int j = 0; j < r; j++) {
            for (int k = 0; k < q; k++) {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
}
```

O próprio exemplo de três matrizes do CLRS mostra por que a parentetização importa: uma cadeia `⟨A1, A2, A3⟩` com dimensões `10×100`, `100×5`, e `5×50`. Parentetizar como `((A1 A2) A3)` custa `10*100*5 = 5.000` multiplicações para formar o produto `10×5` de `A1 A2`, mais `10*5*50 = 2.500` para multiplicar isso por `A3` — um total de `7.500`. Parentetizar em vez disso como `(A1 (A2 A3))` custa `100*5*50 = 25.000` para formar o produto `100×50` de `A2 A3`, mais `10*100*50 = 50.000` para multiplicar `A1` por isso — um total de `75.000`. A primeira parentetização é 10 vezes mais rápida, mesmo que ambas calculem a matriz `10×50` idêntica. O problema de matrix-chain-multiplication é: dada a sequência de dimensões `⟨p0, p1, ..., pn⟩`, parentetize completamente `A1 A2 ... An` para minimizar o total de multiplicações escalares — o problema nunca de fato multiplica as matrizes, ele só determina a ordem mais barata, na premissa de que o tempo gasto encontrando essa ordem costuma se pagar muitas vezes quando as multiplicações reais rodarem (7.500 em vez de 75.000, no exemplo acima).

### Por que força bruta falha: contando as parentetizações

Seja `P(n)` o número de formas distintas de parentetizar completamente uma cadeia de `n` matrizes. Uma cadeia de uma matriz tem exatamente uma parentetização (trivial), então `P(1) = 1`. Para `n ≥ 2`, uma parentetização completa divide a cadeia em duas subcadeias completamente parentetizadas em alguma matriz `k`, então:

```
P(n) = 1                                  se n = 1
P(n) = sum_{k=1}^{n-1} P(k) * P(n-k)      se n >= 2
```

A solução dessa recorrência é `Ω(2^n)` — relacionada aos números de Catalan, cuja taxa de crescimento é `Θ(4^n / n^(3/2))`. De qualquer forma, a contagem de parentetizações é exponencial em `n`, o que descarta enumerar e custear exaustivamente cada uma delas como algoritmo eficiente — exatamente a situação para a qual programação dinâmica foi feita.

### Aplicando o método de DP, passos 1 e 2: subestrutura ótima e a recorrência

Seguindo o mesmo método de quatro passos do rod cutting, defina `Ai:j` (para `i ≤ j`) como a matriz resultante de avaliar o produto `Ai Ai+1 ... Aj`. Parentetizar `Ai:j` quando `i < j` significa dividir o produto entre `Ak` e `Ak+1` para algum `k` com `i ≤ k < j`: primeiro calcular `Ai:k` e `Ak+1:j`, depois multiplicá-los.

**Passo 1 — subestrutura ótima.** Se uma parentetização ótima de `Ai Ai+1 ... Aj` divide o produto em `k`, então a forma como ela parentetiza a subcadeia de prefixo `Ai ... Ak` precisa ela mesma ser uma parentetização ótima de `Ai ... Ak` — se existisse uma parentetização mais barata dessa subcadeia, substituí-la produziria uma parentetização mais barata da cadeia inteira, contradizendo a otimalidade. O mesmo argumento se aplica à subcadeia de sufixo `Ak+1 ... Aj`. Então construir uma solução ótima significa dividir o problema em dois subproblemas, resolver cada um de forma ótima, e combinar — tentando todo ponto de divisão `k` possível para encontrar o melhor.

**Passo 2 — a recorrência.** Seja `m[i, j]` o número mínimo de multiplicações escalares necessárias para calcular `Ai:j`; a resposta do problema completo é `m[1, n]`. O caso base é trivial: `m[i, i] = 0`, já que uma cadeia de uma matriz não precisa de multiplicações. Para `i < j`, como cada `Ai` é `p[i-1] × p[i]`, calcular `Ai:k * Ak+1:j` custa `p[i-1] * p[k] * p[j]` multiplicações escalares além do que cada lado já custou, então:

```
m[i, j] = 0                                                              se i = j
m[i, j] = min{ m[i,k] + m[k+1,j] + p[i-1]*p[k]*p[j] : i <= k < j }        se i < j
```

`s[i, j]` registra o valor de `k` que alcança esse mínimo — não afeta o custo, mas é exatamente a informação necessária depois para reconstruir qual parentetização o produziu.

### Passo 3: calculando os custos ótimos de baixo para cima

Um algoritmo recursivo construído diretamente sobre a recorrência acima levaria tempo exponencial, pela mesma razão que o `CUT-ROD` recursivo ingênuo leva (veja `dynamic-programming-fundamentals.md`): ele re-resolveria repetidamente o mesmo subproblema `(i, j)` ao longo de diferentes caminhos de chamada. Mas há só `Θ(n^2)` subproblemas distintos — um para cada par `1 ≤ i ≤ j ≤ n` — então uma tabela preenche cada um deles exatamente uma vez. `m[i, j]` depende só de `m[i, k]` e `m[k+1, j]` para `k` estritamente entre eles, e ambos descrevem cadeias *mais curtas* que `Ai:j`. Então a tabela precisa ser preenchida em ordem crescente de comprimento de cadeia `l = j - i + 1`, do comprimento 1 até o comprimento `n`:

```java
// MATRIX-CHAIN-ORDER(p, n): p = <p0, p1, ..., pn>, matriz Ai é p[i-1] x p[i]
static int[][] matrixChainOrder(int[] p, int n) {
    int[][] m = new int[n + 1][n + 1]; // m[i][j]: mín. mult. escalares pra calcular Ai..Aj
    int[][] s = new int[n + 1][n + 1]; // s[i][j]: o ponto de divisão k que alcança m[i][j]

    for (int i = 1; i <= n; i++) {
        m[i][i] = 0; // comprimento de cadeia 1
    }
    for (int l = 2; l <= n; l++) {                    // l = comprimento de cadeia
        for (int i = 1; i <= n - l + 1; i++) {         // cadeia começa em Ai
            int j = i + l - 1;                         // cadeia termina em Aj
            m[i][j] = Integer.MAX_VALUE;
            for (int k = i; k <= j - 1; k++) {          // tenta Ai:k * Ak+1:j
                int q = m[i][k] + m[k + 1][j] + p[i - 1] * p[k] * p[j];
                if (q < m[i][j]) {
                    m[i][j] = q;                        // lembra esse custo
                    s[i][j] = k;                         // lembra essa divisão
                }
            }
        }
    }
    return m; // s é preenchido como efeito colateral; os dois são retornados juntos no CLRS
}
```

O aninhamento de loops tem três níveis (`l`, `i`, `k`), e cada um dos três índices de loop assume no máximo `n - 1` valores, então `MATRIX-CHAIN-ORDER` roda em tempo `O(n^3)` — uma melhora dramática sobre a enumeração exponencial de parentetizações. As tabelas `m` e `s` exigem `Θ(n^2)` de espaço cada.

### O exemplo trabalhado: uma cadeia de 6 matrizes

A própria Figura 14.5 do CLRS preenche a tabela `m` para `n = 6` matrizes com dimensões:

| matriz | A1 | A2 | A3 | A4 | A5 | A6 |
|---|---|---|---|---|---|---|
| dimensão | 30×35 | 35×15 | 15×5 | 5×10 | 10×20 | 20×25 |

Preenchendo `m` por comprimento crescente de cadeia `l` (a diagonal `m[i,i] = 0` para todo `i` é omitida já que é sempre zero):

| comprimento de cadeia | m[1,·] | m[2,·] | m[3,·] | m[4,·] | m[5,·] |
|---|---|---|---|---|---|
| l=2 | m[1,2]=15.750 | m[2,3]=2.625 | m[3,4]=750 | m[4,5]=1.000 | m[5,6]=5.000 |
| l=3 | m[1,3]=7.875 | m[2,4]=4.375 | m[3,5]=2.500 | m[4,6]=3.500 | |
| l=4 | m[1,4]=9.375 | m[2,5]=7.125 | m[3,6]=5.375 | | |
| l=5 | m[1,5]=11.875 | m[2,6]=10.500 | | | |
| l=6 | m[1,6]=15.125 | | | | |

O número mínimo de multiplicações escalares necessárias para multiplicar as 6 matrizes é `m[1, 6] = 15.125`. A figura também mostra quais entradas a linha 9 do pseudocódigo compara ao calcular `m[2, 5]`, tentando cada ponto de divisão `k` de 2 a 4:

```
m[2,2] + m[3,5] + p1*p2*p5 = 0    + 2.500 + 35*15*20 = 13.000
m[2,3] + m[4,5] + p1*p3*p5 = 2.625 + 1.000 + 35*5*20  = 7.125   <- mínimo
m[2,4] + m[5,5] + p1*p4*p5 = 4.375 + 0     + 35*10*20 = 11.375
```

A divisão do meio (`k = 3`) vence, dando `m[2, 5] = 7.125` — batendo com a tabela acima, e ilustrando exatamente como a linha 9 do `MATRIX-CHAIN-ORDER` tenta todo `k` no intervalo válido e mantém o melhor.

### Passo 4: reconstruindo a parentetização real

`MATRIX-CHAIN-ORDER` determina o *custo* ótimo, mas não quais multiplicações realizar — é para isso que serve a tabela `s`. Cada `s[i, j]` registra o `k` em que uma parentetização ótima de `Ai...Aj` se divide, então a multiplicação final ao calcular `A1:n` é `A1:s[1,n] * A(s[1,n]+1):n`, e a mesma tabela, lida recursivamente, dá cada divisão anterior também. `PRINT-OPTIMAL-PARENS` percorre a tabela `s` para imprimir a parentetização:

```java
// PRINT-OPTIMAL-PARENS(s, i, j)
static void printOptimalParens(int[][] s, int i, int j) {
    if (i == j) {
        System.out.print("A" + i);
    } else {
        System.out.print("(");
        printOptimalParens(s, i, s[i][j]);
        printOptimalParens(s, s[i][j] + 1, j);
        System.out.print(")");
    }
}
```

Para o exemplo de `n = 6` acima, a chamada inicial `PRINT-OPTIMAL-PARENS(s, 1, 6)` imprime a parentetização ótima `((A1(A2 A3))((A4A5)A6))`. Decodificando essa string contra a definição de `s[i, j]` (o ponto de divisão `k` usado em cada nível) dá os pontos de divisão que a produziram: a divisão de nível superior é entre `A3` e `A4` (`s[1,6] = 3`), a subcadeia esquerda `A1..A3` se divide entre `A1` e `A2` (`s[1,3] = 1`, com `s[2,3] = 2` forçado já que `k = 2` é a única escolha quando `i = 2, j = 3`), e a subcadeia direita `A4..A6` se divide entre `A5` e `A6` (`s[4,6] = 5`, com `s[4,5] = 4` forçado da mesma forma). Essa estrutura é naturalmente uma árvore binária de multiplicações, com as seis matrizes como folhas em ordem e cada nó interno sendo a multiplicação de seus dois filhos:

```viz
type: tree
insert r16 A1:6 | Divisão final s[1,6] = 3 -- multiplica (A1..A3) por (A4..A6).
insert r13 A1:3 parent=r16 side=left | Subcadeia esquerda se divide em s[1,3] = 1 -- multiplica A1 por (A2 A3).
insert r46 A4:6 parent=r16 side=right | Subcadeia direita se divide em s[4,6] = 5 -- multiplica (A4 A5) por A6.
insert a1 A1 parent=r13 side=left | Uma única matriz -- sem mais divisão.
insert r23 A2:3 parent=r13 side=right | s[2,3] = 2 é a única divisão possível (i = k = 2, j = 3).
insert a2 A2 parent=r23 side=left
insert a3 A3 parent=r23 side=right
insert r45 A4:5 parent=r46 side=left | s[4,5] = 4 é a única divisão possível (i = k = 4, j = 5).
insert a6 A6 parent=r46 side=right
insert a4 A4 parent=r45 side=left
insert a5 A5 parent=r45 side=right
```

As folhas, lidas da esquerda para a direita, são `A1, A2, A3, A4, A5, A6` — a cadeia original, em ordem — com cada nó interno marcando uma das multiplicações que `PRINT-OPTIMAL-PARENS` imprime, batendo exatamente com `((A1(A2 A3))((A4A5)A6))`.

## Trade-offs

- **Compartilha sua forma com outros preenchimentos de tabela de DP por intervalo, mas não seu custo exato** — matrix-chain multiplication e longest-common-subsequence (veja `longest-common-subsequence.md`) são ambos programas dinâmicos sobre intervalos contíguos com tabelas de tamanho `Θ(n^2)` preenchidas por comprimento crescente de subproblema, e ambos precisam de subestrutura ótima sobre esses intervalos para funcionar. Mas LCS preenche sua tabela em `O(mn)` porque cada célula faz trabalho `O(1)`; a célula `m[i,j]` de matrix-chain multiplication precisa ela mesma minimizar sobre todo ponto de divisão `k` no intervalo, então a mesma tabela `Θ(n^2)` custa `O(n^3)` no total pra preencher, não `O(n^2)` — os trade-offs "quantas células" e "quão caro é cada célula" são independentes e ambos importam.
- **Uma troca de tempo por tempo, não de tempo por nada** — o CLRS é explícito que o problema de matrix-chain nunca multiplica nenhuma matriz; ele só busca a ordem mais barata. O tempo `O(n^3)` (e espaço `Θ(n^2)`) gasto encontrando essa ordem vale a pena especificamente porque costuma se pagar muitas vezes quando as multiplicações reais rodam — o `7.500` vs. `75.000` multiplicações escalares do exemplo é o payoff contra o qual o próprio custo de `MATRIX-CHAIN-ORDER` precisa ser pesado.
- **A tabela de custo sozinha não responde "como" — isso é uma segunda tabela** — `m[i,j]` dá o custo ótimo mas, sozinha, não dá nenhum jeito de de fato realizar as multiplicações na ordem mais barata; `s[i,j]` precisa ser mantida junto e percorrida recursivamente (`PRINT-OPTIMAL-PARENS`) para recuperar a parentetização em si, a mesma divisão "valor vs. solução real" observada para a própria tabela estendida do rod cutting.
- **Força bruta aqui não é só mais lenta, é uma classe de crescimento diferente** — `P(n) = Ω(2^n)` parentetizações distintas significa que checar todas é exponencial no número de matrizes, enquanto a tabela de DP é `O(n^3)`; essa diferença é muito mais gritante que, digamos, uma decisão de ajuste de fator constante, e é o que torna a busca exaustiva inviável mesmo para comprimentos de cadeia modestos.

## Documentation Links

- [Introduction to Algorithms, 4th Edition](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Cormen, Leiserson, Rivest, Stein — Seção 14.2 "Matrix-chain multiplication", pp. 373-381 — doc
