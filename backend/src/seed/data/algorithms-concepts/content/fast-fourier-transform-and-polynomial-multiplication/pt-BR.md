---
version: 1.0
updatedAt: 2026-08-17
title: "A FFT e a Multiplicação de Polinômios em Θ(n lg n)"
description: "Por que multiplicar polinômios em forma de coeficientes custa Θ(n²) mas só Θ(n) em forma ponto-valor, e como a divisão-e-conquista par/ímpar da FFT sobre as raízes complexas da unidade torna a conversão entre as duas representações — e portanto a multiplicação inteira — Θ(n lg n)."
---
## Objetivo

Entenda como dois polinômios de degree-bound `n` podem ser multiplicados em tempo `Θ(n lg n)` em vez do óbvio `Θ(n²)`. O truque não é um jeito mais esperto de multiplicar coeficientes — é uma troca de *representação*: polinômios em forma ponto-valor se multiplicam em tempo `Θ(n)`, então o problema inteiro colapsa para converter rapidamente entre a forma de coeficientes e a forma ponto-valor. O CLRS mostra que, se os pontos de avaliação são as raízes complexas da unidade, essa conversão é exatamente a transformada discreta de Fourier (DFT) e sua inversa, e a fast Fourier transform (FFT) calcula ambas em `Θ(n lg n)` por uma divisão-e-conquista que separa os coeficientes de índice par dos de índice ímpar.

## Casos de Uso

- Multiplicar dois polinômios dados em forma de coeficientes, e calcular convoluções — o vetor de coeficientes `c` do produto é exatamente a convolução `a ⊗ b` dos dois vetores de coeficientes de entrada. O CLRS chama multiplicação de polinômios e convolução de "problemas computacionais fundamentais de considerável importância prática", motivo pelo qual o capítulo se concentra em algoritmos eficientes para eles.
- Avaliar um polinômio de degree-bound `n` em todas as `n` raízes `n`-ésimas complexas da unidade de uma vez, em `Θ(n lg n)` — versus `Θ(n²)` se você simplesmente chamar a regra de Horner `n` vezes.
- Interpolar um polinômio de volta a partir de `n` pares ponto-valor, quando os pontos são as raízes da unidade: a DFT inversa faz isso em `Θ(n lg n)`, versus `O(n³)` para resolver o sistema linear de Vandermonde diretamente ou `Θ(n²)` para a fórmula de Lagrange.
- Implementações em hardware: o CLRS observa que muitas das aplicações da FFT em processamento de sinais exigem a máxima velocidade, então a FFT é frequentemente construída como um circuito — e sua estrutura de divisão-e-conquista dá um circuito paralelo de profundidade apenas `Θ(lg n)`.

## Aprofundamento

### Duas representações do mesmo polinômio

Uma **representação por coeficientes** de um polinômio `A(x) = Σ_{j=0}^{n-1} a_j x^j` de degree-bound `n` é apenas o vetor `a = (a0, a1, ..., a_{n-1})`. Essa forma é conveniente para algumas operações e péssima para outras:

| operação | custo na forma de coeficientes |
|---|---|
| avaliar `A(x0)` num ponto (regra de Horner) | `Θ(n)` |
| somar dois polinômios (`c_j = a_j + b_j`) | `Θ(n)` |
| multiplicar dois polinômios | `Θ(n²)` |

Avaliação num único ponto é linear graças à regra de Horner, que aninha as multiplicações:

```
A(x0) = a0 + x0*(a1 + x0*(a2 + ... + x0*(a_{n-2} + x0*(a_{n-1}))...))
```

Multiplicação é a exceção. O método direto multiplica cada coeficiente de `a` por cada coeficiente de `b`, então custa `Θ(n²)`. O vetor de coeficientes resultante `c` também é chamado de **convolução** dos vetores de entrada, escrito `c = a ⊗ b`.

Uma **representação ponto-valor** de um polinômio de degree-bound `n` é um conjunto de `n` pares ponto-valor `{(x0, y0), (x1, y1), ..., (x_{n-1}, y_{n-1})}` onde todos os `x_k` são distintos e `y_k = A(x_k)`. Um polinômio tem muitas representações ponto-valor, já que qualquer conjunto de `n` pontos distintos pode servir de base.

As duas formas são genuinamente equivalentes — um polinômio em forma ponto-valor tem uma contraparte única em forma de coeficientes:

> **Teorema 30.1 (Unicidade de um polinômio interpolador).** Para qualquer conjunto de `n` pares ponto-valor com todos os `x_k` distintos, existe um único polinômio `A(x)` de degree-bound `n` tal que `y_k = A(x_k)` para todo `k`.

A prova escreve `y_k = A(x_k)` como a equação matricial `V(x0, ..., x_{n-1}) · a = y`, onde `V` é a **matriz de Vandermonde** cuja linha `k` é `(1, x_k, x_k², ..., x_k^{n-1})`. O determinante dessa matriz é o produto de `(x_k - x_j)` sobre todo `j < k`, então ele é não nulo — a matriz é invertível — exatamente quando os `x_k` são distintos, e `a = V^{-1} y` recupera os coeficientes de forma única.

Então *avaliação* (forma de coeficientes → forma ponto-valor) e *interpolação* (forma ponto-valor → forma de coeficientes) são operações inversas bem definidas. Os algoritmos óbvios para ambas são quadráticos ou piores: a regra de Horner em `n` pontos é `Θ(n²)`; interpolação resolvendo o sistema de Vandermonde é `O(n³)` (Seção 28.1) e pela fórmula de Lagrange é `Θ(n²)` (Exercício 30.1-5).

### Por que a forma ponto-valor torna a multiplicação trivial — e a pegadinha do degree-bound

Em forma ponto-valor, tanto soma quanto multiplicação são pontuais, desde que ambos os polinômios sejam avaliados nos *mesmos* pontos. Se `C(x) = A(x)·B(x)`, então `C(x_k) = A(x_k)·B(x_k)` para todo ponto `x_k`, então multiplicar é só `n` multiplicações escalares: `Θ(n)`.

Há uma pegadinha. `degree(C) = degree(A) + degree(B)`, então se `A` e `B` têm degree-bound `n`, `C` tem degree-bound `2n` — e `2n` pares ponto-valor são necessários para determinar unicamente um polinômio de degree-bound `2n`, não `n` (Exercício 30.1-4). O conserto é trabalhar desde o início com representações ponto-valor **estendidas** de `2n` pares cada para `A` e `B`, obtidas primeiro preenchendo ambos os vetores de coeficientes com `n` coeficientes zero de ordem alta.

### A estratégia: avaliar, multiplicar pontualmente, interpolar

A multiplicação `Θ(n)` em forma ponto-valor só compensa se converter entre representações for barato. Qualquer conjunto de pontos pode servir como pontos de avaliação, mas certos pontos permitem conversão em apenas tempo `Θ(n lg n)` — as raízes complexas da unidade, onde a avaliação *é* a DFT e a interpolação *é* a DFT inversa. Isso dá o algoritmo de quatro passos (assumindo que `n` é uma potência exata de 2; se não, preencha com coeficientes zero de ordem alta):

1. **Dobre o degree-bound** — crie representações de coeficientes de `A(x)` e `B(x)` como polinômios de degree-bound `2n` adicionando `n` coeficientes zero de ordem alta a cada um. `Θ(n)`
2. **Avalie** — calcule representações ponto-valor de comprimento `2n` aplicando a FFT de ordem `2n` a cada um, dando os valores de ambos os polinômios nas raízes `(2n)`-ésimas da unidade. `Θ(n lg n)`
3. **Multiplique pontualmente** — multiplique os dois vetores de valores componente a componente para obter uma representação ponto-valor de `C(x) = A(x)B(x)` em cada raiz `(2n)`-ésima da unidade. `Θ(n)`
4. **Interpole** — aplique a FFT aos `2n` pares ponto-valor para calcular a DFT inversa, produzindo a representação de coeficientes de `C(x)`. `Θ(n lg n)`

> **Teorema 30.2.** Dois polinômios de degree-bound `n`, com representações de entrada e saída em forma de coeficientes, podem ser multiplicados em tempo `Θ(n lg n)`.

### Raízes complexas da unidade: as três propriedades que fazem funcionar

Uma raiz `n`-ésima complexa da unidade é um número complexo `ω` com `ω^n = 1`. Existem exatamente `n` delas, `e^(2πik/n)` para `k = 0, 1, ..., n-1`, interpretadas por meio de `e^(iu) = cos(u) + i·sin(u)`. Elas ficam igualmente espaçadas ao redor do círculo unitário no plano complexo. O valor

```
ω_n = e^(2πi/n)
```

é a **raiz `n`-ésima principal da unidade**; todas as outras são potências dela, então as `n` raízes são `ω_n^0, ω_n^1, ..., ω_n^{n-1}`. (O CLRS observa que muitos autores em vez disso definem `ω_n = e^(-2πi/n)`, a convenção tipicamente usada para aplicações de processamento de sinais; a matemática subjacente é substancialmente a mesma de qualquer forma. Toda fórmula aqui usa o `e^(2πi/n)` do livro.) Elas formam um grupo sob multiplicação com a mesma estrutura do grupo aditivo dos inteiros módulo `n`: `ω_n^j · ω_n^k = ω_n^{(j+k) mod n}`, e `ω_n^{-1} = ω_n^{n-1}`.

Três lemas carregam o algoritmo inteiro:

- **Lema do cancelamento (30.3).** Para inteiros `n > 0`, `k ≥ 0`, `d > 0`: `ω_{dn}^{dk} = ω_n^k`. Segue diretamente da definição, já que `(e^(2πi/dn))^{dk} = (e^(2πi/n))^k`.
- **Corolário 30.4.** Para todo `n > 0` par: `ω_n^{n/2} = ω_2 = -1`. Isso é o que faz a segunda saída de toda butterfly ser uma *subtração* em vez de uma multiplicação separada — `ω_n^{k+n/2} = -ω_n^k`.
- **Lema da bissecção (30.5).** Se `n > 0` é par, os quadrados das `n` raízes `n`-ésimas complexas da unidade são as `n/2` raízes `(n/2)`-ésimas complexas da unidade, cada uma ocorrendo exatamente duas vezes — porque `ω_n^k` e `ω_n^{k+n/2}` têm o mesmo quadrado. O CLRS chama esse lema de essencial para a abordagem de divisão-e-conquista: é o que garante que os subproblemas recursivos tenham só *metade* do tamanho.
- **Lema da soma (30.6).** Para todo inteiro `n ≥ 1` e inteiro não nulo `k` não divisível por `n`, a soma `Σ_{j=0}^{n-1} (ω_n^k)^j = 0`. A fórmula da série geométrica dá `((ω_n^k)^n - 1) / (ω_n^k - 1) = ((ω_n^n)^k - 1) / (ω_n^k - 1) = (1^k - 1) / (ω_n^k - 1) = 0`, e o denominador é não nulo precisamente porque `ω_n^k = 1` só quando `k` é divisível por `n`. Esse lema é o que faz a matriz da DFT inversa funcionar.

### A DFT e a divisão par/ímpar da FFT

Avaliar `A(x) = Σ a_j x^j` nas `n` raízes `n`-ésimas complexas da unidade define

```
y_k = A(ω_n^k) = Σ_{j=0}^{n-1} a_j · ω_n^{kj}     para k = 0, 1, ..., n-1
```

O vetor `y = (y0, ..., y_{n-1})` é a **transformada discreta de Fourier** de `a`, escrita `y = DFT_n(a)`. Calculado diretamente pela definição, custa `Θ(n²)`.

A FFT leva isso a `Θ(n lg n)` dividindo `A` pela *paridade* do índice de coeficiente — coeficientes de índice par num polinômio, de índice ímpar no outro, cada um de degree-bound `n/2`:

```
A_par(x) = a0 + a2·x + a4·x² + ... + a_{n-2}·x^(n/2-1)
A_impar(x)  = a1 + a3·x + a5·x² + ... + a_{n-1}·x^(n/2-1)
```

que se recombinam na identidade-chave

```
A(x) = A_par(x²) + x · A_impar(x²)          (equação 30.9)
```

Então avaliar `A` em `ω_n^0, ..., ω_n^{n-1}` se reduz a (1) avaliar `A_par` e `A_impar` nos *quadrados* `(ω_n^0)², ..., (ω_n^{n-1})²`, depois (2) combinar com a equação 30.9. E, pelo lema da bissecção, essa lista de quadrados não é nem de longe `n` valores distintos — são as `n/2` raízes `(n/2)`-ésimas complexas da unidade, cada uma aparecendo duas vezes. Os subproblemas, portanto, têm exatamente o mesmo formato do original, na metade do tamanho: uma `DFT_n` vira duas `DFT_{n/2}`.

```java
// Um número complexo, já que a FFT avalia nas raízes complexas da unidade.
record Complex(double re, double im) {
    Complex plus(Complex o)  { return new Complex(re + o.re, im + o.im); }
    Complex minus(Complex o) { return new Complex(re - o.re, im - o.im); }
    Complex times(Complex o) { return new Complex(re * o.re - im * o.im, re * o.im + im * o.re); }
}

// FFT(a, n) — n precisa ser uma potência exata de 2, e a.length == n.
static Complex[] fft(Complex[] a, int n) {
    if (n == 1) {
        return a;                       // a DFT de 1 elemento é o próprio elemento
    }
    // ωn = e^(2πi/n) = cos(2π/n) + i·sin(2π/n), a raiz n-ésima principal da unidade
    Complex wn = new Complex(Math.cos(2 * Math.PI / n), Math.sin(2 * Math.PI / n));
    Complex w = new Complex(1, 0);      // valor corrente de ωn^k, k = 0 no início

    Complex[] aEven = new Complex[n / 2];
    Complex[] aOdd  = new Complex[n / 2];
    for (int j = 0; j < n / 2; j++) {
        aEven[j] = a[2 * j];             // (a0, a2, ..., a_{n-2})
        aOdd[j]  = a[2 * j + 1];         // (a1, a3, ..., a_{n-1})
    }
    Complex[] yEven = fft(aEven, n / 2); // conquista: duas DFTs da metade do tamanho
    Complex[] yOdd  = fft(aOdd,  n / 2);

    Complex[] y = new Complex[n];
    for (int k = 0; k < n / 2; k++) {    // neste ponto, w == ωn^k
        Complex t = w.times(yOdd[k]);     // o termo com twiddle, calculado uma vez (uma butterfly)
        y[k]         = yEven[k].plus(t);  // yk = y_even_k + ωn^k · y_odd_k
        y[k + n / 2] = yEven[k].minus(t); // y_{k+n/2}, usando ωn^{k+n/2} = -ωn^k
        w = w.times(wn);                  // avança o twiddle factor corrente
    }
    return y;
}
```

O caso base é a linha `n = 1`: a DFT de um elemento é o próprio elemento, já que `y0 = a0·ω_1^0 = a0`. O laço de combinação é onde a equação 30.9 é aplicada. As chamadas recursivas calculam `y_even_k = A_par(ω_{n/2}^k)` e `y_odd_k = A_impar(ω_{n/2}^k)`, que pelo lema do cancelamento são iguais a `A_par(ω_n^{2k})` e `A_impar(ω_n^{2k})`. Então a primeira linha de saída produz `y_k = A_par(ω_n^{2k}) + ω_n^k·A_impar(ω_n^{2k}) = A(ω_n^k)`, e a segunda produz `A(ω_n^{k+n/2})` — usando `ω_n^{k+n/2} = -ω_n^k` e `ω_n^{2k+n} = ω_n^{2k}`. Como todo fator `ω_n^k` aparece em ambas as formas, positiva e negativa, o CLRS chama esses fatores de **twiddle factors**.

Excluindo as chamadas recursivas, toda invocação faz trabalho `Θ(n)`, então a recorrência é a familiar:

```
T(n) = 2·T(n/2) + Θ(n) = Θ(n lg n)
```

pelo caso 2 do teorema mestre. Note que a otimização de `w` corrente tem um custo: o CLRS aponta que atualizar `ω` iterativamente permite que erros de arredondamento se acumulem, especialmente em tamanhos maiores, e sugere pré-calcular diretamente uma tabela de todos os `n/2` valores de `ω_n^k` quando várias FFTs vão rodar sobre entradas do mesmo tamanho.

### Observe o passo de divisão: a árvore de recursão para n = 8

A Figura 30.5 organiza os vetores de entrada de toda chamada recursiva numa árvore — a chamada inicial na raiz, as duas chamadas recursivas de cada nó como seus filhos esquerdo (índices pares) e direito (índices ímpares), até folhas de 1 elemento:

```viz
type: tree
insert r a0..a7 | A chamada inicial, n = 8. Divide por paridade de índice, não por posição.
insert e (a0,a2,a4,a6) parent=r side=left | Coeficientes de índice par -- índice binário termina em 0.
insert o (a1,a3,a5,a7) parent=r side=right | Coeficientes de índice ímpar -- índice binário termina em 1.
insert ee (a0,a4) parent=e side=left | Divide de novo pela paridade da posição dentro de (a0,a2,a4,a6).
insert eo (a2,a6) parent=e side=right | A metade ímpar da metade par.
insert oe (a1,a5) parent=o side=left | A metade par da metade ímpar.
insert oo (a3,a7) parent=o side=right | A metade ímpar da metade ímpar.
insert a0 (a0) parent=ee side=left | Caso base: n = 1, a DFT de um elemento é ele mesmo.
insert a4 (a4) parent=ee side=right | Caso base.
insert a2 (a2) parent=eo side=left | Caso base.
insert a6 (a6) parent=eo side=right | Caso base.
insert a1 (a1) parent=oe side=left | Caso base.
insert a5 (a5) parent=oe side=right | Caso base.
insert a3 (a3) parent=oo side=left | Caso base.
insert a7 (a7) parent=oo side=right | Caso base.
```

Leia as folhas da esquerda para a direita e elas saem na ordem `0, 4, 2, 6, 1, 5, 3, 7` — em binário, `000, 100, 010, 110, 001, 101, 011, 111`, que é exatamente a sequência `000, 001, 010, 011, 100, 101, 110, 111` com os bits de cada índice *invertidos*. Essa ordenação é a **permutação de bit-reversal**: o elemento `a_k` se move para a posição `rev(k)`, onde `rev(k)` inverte os `lg n` bits de `k`. Isso cai diretamente do passo de divisão — no nível superior, índices cujo bit de ordem mais baixa é 0 vão à esquerda e cujo bit de ordem mais baixa é 1 vão à direita, e retirar mais um bit de ordem mais baixa a cada nível abaixo produz a ordem bit-invertida nas folhas.

Isso importa porque significa que a recursão pode ser rodada *de baixo para cima*: comece a partir do vetor permutado em ordem de folha, combine pares adjacentes com uma butterfly cada para obter `n/2` DFTs de dois elementos, combine essas em pares para obter `n/4` DFTs de quatro elementos, e assim por diante até que duas DFTs de `(n/2)` elementos sejam combinadas na DFT final de `n` elementos.

### Um traço resolvido: a DFT de (0, 1, 2, 3)

Pegue `a = (0, 1, 2, 3)`, então `n = 4` e `ω_4 = e^(2πi/4) = i`. Trace `fft(a, 4)` à mão:

| passo | cálculo | resultado |
|---|---|---|
| divide | `a_par = (a0, a2)`, `a_impar = (a1, a3)` | `(0, 2)` e `(1, 3)` |
| conquista esquerda | `fft((0,2), 2)`: `ω_2 = -1`, então `y0 = 0 + 2`, `y1 = 0 - 2` | `y_par = (2, -2)` |
| conquista direita | `fft((1,3), 2)`: `y0 = 1 + 3`, `y1 = 1 - 3` | `y_impar = (4, -2)` |
| combina `k = 0` | `w = ω_4^0 = 1`, `t = 1·4 = 4`; `y0 = 2 + 4`, `y2 = 2 - 4` | `y0 = 6`, `y2 = -2` |
| combina `k = 1` | `w = ω_4^1 = i`, `t = i·(-2) = -2i`; `y1 = -2 + (-2i)`, `y3 = -2 - (-2i)` | `y1 = -2 - 2i`, `y3 = -2 + 2i` |

Então `DFT_4(0, 1, 2, 3) = (6, -2-2i, -2, -2+2i)`. Checar diretamente contra a definição `y_k = Σ a_j ω_4^{kj}` com `ω_4 = i` confirma cada entrada — por exemplo `y1 = 0 + 1·i + 2·i² + 3·i³ = i - 2 - 3i = -2 - 2i`. Seis operações no nível de elemento nas combinações das duas folhas mais quatro na combinação do topo, em vez dos 16 produtos que a soma dupla da definição levaria.

### Interpolação: a DFT inversa é o mesmo algoritmo, duas vezes modificado

Escrita como um produto de matriz, a DFT é `y = V_n · a`, onde `V_n` é a matriz de Vandermonde de potências de `ω_n`: sua entrada `(k, j)` é `ω_n^{kj}`, então os expoentes formam uma tabela de multiplicação para os fatores `0` a `n-1`. Interpolação é, portanto, `a = V_n^{-1} · y`, e a inversa tem uma forma fechada surpreendentemente simples:

> **Teorema 30.7.** Para `j, k = 0, 1, ..., n-1`, a entrada `(j, k)` de `V_n^{-1}` é `ω_n^{-kj} / n`.

A prova mostra que `V_n^{-1} V_n = I_n` calculando a entrada `(k', k)` como `Σ_{j=0}^{n-1} ω_n^{j(k'-k)} / n`, que é `1` quando `k' = k` e `0` caso contrário pelo lema da soma — o lema se aplica porque `k' - k` fica estritamente entre `-(n-1)` e `n-1` e portanto nunca é um múltiplo não nulo de `n`. Por extenso:

```
a_j = (1/n) · Σ_{k=0}^{n-1} y_k · ω_n^{-kj}     para j = 0, 1, ..., n-1     (equação 30.11)
```

Compare isso com a DFT direta `y_k = Σ_j a_j ω_n^{kj}` e a receita para a inversa cai naturalmente: **troque os papéis de `a` e `y`, substitua `ω_n` por `ω_n^{-1}`, e divida cada elemento do resultado por `n`.** Mais nada muda na FFT, então `DFT_n^{-1}` também é computável em `Θ(n lg n)`. (O CLRS deixa escrever esse pseudocódigo como Exercício 30.2-4; a modificação é exatamente as três mudanças acima.)

Juntar a transformada direta e a inversa dá o resultado central do capítulo sobre convolução:

> **Teorema 30.8 (Teorema da convolução).** Para quaisquer dois vetores `a` e `b` de comprimento `n`, onde `n` é uma potência exata de 2, `a ⊗ b = DFT_{2n}^{-1}(DFT_{2n}(a) · DFT_{2n}(b))`, onde `a` e `b` são preenchidos com 0s até comprimento `2n` e `·` denota o produto componente a componente de dois vetores de `2n` elementos.

### Do início ao fim: multiplicando (1 + 2x) por (3 + 4x)

Dois polinômios de degree-bound 2, então preencha ambos até comprimento `2n = 4` e use `ω_4 = i`. A resposta à mão é `(1 + 2x)(3 + 4x) = 3 + 10x + 8x²`; aqui está o mesmo resultado pelo algoritmo de quatro passos:

| passo | de `A(x) = 1 + 2x` | de `B(x) = 3 + 4x` | combinado |
|---|---|---|---|
| 1. dobra o degree-bound | `a = (1, 2, 0, 0)` | `b = (3, 4, 0, 0)` | — |
| 2. avalia em `ω_4^k = 1, i, -1, -i` | `(3, 1+2i, -1, 1-2i)` | `(7, 3+4i, -1, 3-4i)` | — |
| 3. multiplica pontualmente | — | — | `(21, -5+10i, 1, -5-10i)` |
| 4. DFT inversa, divide por 4 | — | — | `c = (3, 10, 8, 0)` |

Passo 4 detalhado para uma entrada: `c0 = (21 + (-5+10i) + 1 + (-5-10i)) / 4 = 12 / 4 = 3`. O vetor de coeficientes final `(3, 10, 8, 0)` se lê de volta como `3 + 10x + 8x² + 0x³` — o produto correto, e o zero à direita confirma que o degree-bound 4 preenchido foi mais do que suficiente.

### Circuitos FFT: butterflies e profundidade Θ(lg n)

A Seção 30.3 reformula o mesmo algoritmo como hardware. Note que o laço de combinação calcula `ω_n^k · y_impar_k` duas vezes — uma para a soma, uma para a diferença — então um bom compilador otimizador o eleva para uma variável temporária, transformando as duas linhas de saída em três:

```
t = ω · y_impar_k
y_k       = y_par_k + t
y_{k+n/2} = y_par_k - t
```

Isso — multiplicar o twiddle factor por `y_impar_k`, armazenar em `t`, depois somar e subtrair `t` de `y_par_k` — é uma **operação butterfly**, nomeada pelo formato de seu diagrama de circuito. (O CLRS brinca que também poderia ter sido chamada de operação "gravata-borboleta".) O código Java acima já a escreve nessa forma elevada.

Em termos de circuito, a estrutura de divisão-e-conquista se lê como: **divida** a entrada de `n` elementos em seus `n/2` elementos de índice par e `n/2` de índice ímpar; **conquiste** calculando recursivamente duas DFTs de tamanho `n/2`; **combine** com `n/2` operações butterfly usando twiddle factors `ω_n^0, ω_n^1, ..., ω_n^{n/2-1}`. O caso base `FFT_1` não faz absolutamente nada (um fio de entrada é igual a um fio de saída), então o menor circuito não trivial é `FFT_2`: uma única butterfly cujo twiddle factor é `ω_2^0 = 1`.

O circuito completo começa com a permutação de bit-reversal das entradas, depois roda `lg n` estágios, cada estágio consistindo de `n/2` butterflies executadas **em paralelo** — as operações butterfly num dado nível de recursão são independentes umas das outras. Para `s = 1, 2, ..., lg n`, o estágio `s` consiste de `n/2^s` grupos de butterflies com `2^{s-1}` butterflies por grupo, e seus twiddle factors são `ω_m^0, ω_m^1, ..., ω_m^{m/2-1}` onde `m = 2^s`. Assumindo que toda butterfly tem profundidade constante, o circuito inteiro tem profundidade `Θ(lg n)` enquanto ainda executa `Θ(n lg n)` operações butterfly no total.

## Trade-offs

- **A 4ª edição descartou a FFT iterativa — não a procure aqui.** O prefácio do CLRS afirma que a implementação *iterativa* da FFT foi removida da 4ª edição e movida para o site da editora; o Capítulo 30 impresso contém só o procedimento `FFT` recursivo de divisão-e-conquista mais a visão em circuito da Seção 30.3. É por isso que este conceito não mostra nenhuma implementação iterativa, in-place, de bit-reversal-depois-`lg n`-estágios: o material para ela existe no texto só como o esquema de *circuito* (Figuras 30.4 e 30.6) e como o Exercício 30.3-4, que pede ao leitor para escrever `BIT-REVERSE-PERMUTATION` por conta própria. A leitura de baixo para cima da árvore de recursão no Aprofundamento é a ponte conceitual, não um substituto para esse código removido.
- **`Θ(n lg n)` só compensa depois de um ponto de corte.** A rota da FFT substitui um único laço duplo apertado `Θ(n²)` sobre coeficientes inteiros ou double por quatro fases envolvendo aritmética complexa, preenchimento e duas transformadas completas. Nada no capítulo afirma que é mais rápido em `n` pequeno — a vitória assintótica é o que é provado (Teorema 30.2), e os fatores constantes do trabalho de multiplicação-soma complexa jogam contra ela até `n` ser grande o suficiente.
- **`n` precisa ser uma potência exata de 2.** O procedimento `FFT` assume isso o tempo todo, e o procedimento de multiplicação de polinômios também assume, dizendo para você adicionar coeficientes zero de ordem alta quando isso não vale. O CLRS afirma que estratégias para lidar com tamanhos que não são potências exatas de 2 são conhecidas mas **fora do escopo do livro** — isso é uma lacuna genuína neste texto, não uma omissão aqui.
- **Erro de arredondamento de ponto flutuante é um risco real e amplamente não endereçado.** Aparecem dois avisos separados. Primeiro, interpolação é descrita como "um problema notoriamente delicado do ponto de vista de estabilidade numérica": as abordagens dadas são matematicamente corretas, mas pequenas diferenças nas entradas ou arredondamento durante o cálculo podem causar grandes diferenças no resultado. Segundo, a atualização de `ω` corrente dentro do laço de combinação acumula arredondamento, especialmente em tamanhos de entrada maiores; várias técnicas para limitar o erro de arredondamento da FFT foram propostas mas também estão fora do escopo do livro. A única mitigação concreta oferecida é pré-calcular uma tabela de todos os `n/2` valores de `ω_n^k` quando várias FFTs do mesmo tamanho vão rodar.
- **A forma ponto-valor não é uma representação universalmente melhor.** Ela torna soma e multiplicação `Θ(n)`, mas é pior em outras coisas. Avaliar um polinômio em forma ponto-valor num *novo* ponto não tem abordagem melhor conhecida do que converter de volta para forma de coeficientes primeiro e avaliar lá. Divisão de polinômios dividindo os valores `y` correspondentes é explicitamente sinalizada como errada (Exercício 30.1-6). E uma representação estendida de `2n` pares precisa ser escolhida de antemão, antes da multiplicação, porque `n` pares não conseguem determinar o produto de degree-bound `2n`.
- **A escolha do sinal de `ω_n` é uma convenção que você precisa manter clara.** Este capítulo usa `ω_n = e^(2πi/n)`; muitos outros autores, particularmente em processamento de sinais, definem `ω_n = e^(-2πi/n)`. O CLRS diz que a matemática subjacente é substancialmente a mesma de qualquer forma, mas os valores de transformada que você calcula vão diferir, então misturar fontes sem checar a convenção vai produzir resultados que discordam entrada por entrada.

## Documentation Links

- [Introduction to Algorithms, 4th Edition](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Cormen, Leiserson, Rivest, Stein — Chapter 30 "Polynomials and the FFT", Sections 30.1-30.3, pp. 879-898 — doc
