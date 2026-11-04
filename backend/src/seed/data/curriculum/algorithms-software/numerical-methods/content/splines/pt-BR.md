---
version: 1.0
updatedAt: 2026-11-04
title: "Splines"
summary: "Interpolação por partes com splines lineares e cúbicas, as condições de continuidade, as fronteiras natural e fixada, e por que splines evitam a oscilação de Runge."
---
## Objetivos de Aprendizagem

- Explicar por que muitos pedaços de grau baixo evitam a oscilação de um único polinômio de grau alto, e medir a diferença na função de Runge.
- Contar as condições que definem uma spline cúbica e deduzir o sistema tridiagonal das suas segundas derivadas.
- Comparar as fronteiras natural, fixada (clamped) e not-a-knot, e prever a ordem de cada uma a partir do que ela supõe nas pontas.
- Implementar uma spline cúbica e conferi-la contra `scipy.interpolate.CubicSpline`.
- Reconhecer onde uma spline $C^2$ engana (overshoot, extrapolação, dados ruidosos) e recorrer a uma alternativa que preserva a forma.

## Contexto e Motivação

`polynomial-interpolation-lagrange-and-newton` deixou um problema aberto: nós de Chebyshev salvam um polinômio de grau alto, mas dados reais costumam chegar numa grade que outra pessoa escolheu, e ali o polinômio diverge. Splines mantêm a grade e abrem mão da fórmula única. Usam um polinômio de grau baixo em cada intervalo entre nós e emendam os pedaços suavemente. O grau fica fixo enquanto o número de pedaços cresce, então a precisão vem de $h$ ficar pequeno e não de o grau ficar grande, e o efeito de um dado some rápido com a distância.

O nome vem da régua flexível que os desenhistas curvavam passando por pontos fixos. Splines cúbicas são um padrão comum para curvas suaves por dados porque são baratas de construir, com um único sistema tridiagonal, e baratas de avaliar.

## Teoria Central

### Splines lineares

Ligar os pontos com segmentos de reta dá a spline linear. Se $f\in C^2[a,b]$ e $h$ é a maior distância entre nós, a fórmula do erro para dois nós dá

$$\lvert f(x)-S(x)\rvert \le \frac{h^2}{8}\max_{[a,b]}\lvert f''\rvert,$$

porque $\lvert(x-x_i)(x-x_{i+1})\rvert\le h^2/4$ em cada intervalo. O mapa dos dados para o interpolador tem número de condição absoluto 1 na norma do máximo: uma mudança de tamanho $\varepsilon$ nos dados muda $S$ em exatamente $\varepsilon$ nessa norma. O preço é uma quina em cada nó.

### Contando as condições de uma spline cúbica

Uma **spline cúbica** em nós $x_0<\cdots<x_n$ é uma função que é cúbica em cada intervalo, está em $C^2[x_0,x_n]$ e interpola os dados. Com $n$ intervalos há $4n$ coeficientes. Coincidir com os dados nas duas pontas de cada intervalo dá $2n$ condições. A continuidade de $S'$ e $S''$ nos $n-1$ nós internos dá mais $2(n-1)$. São $4n-2$, então sobram exatamente duas condições livres, e elas são as condições de fronteira.

### O sistema das segundas derivadas

Sejam $M_i = S''(x_i)$, $h_i = x_{i+1}-x_i$ e $\delta_i = (y_{i+1}-y_i)/h_i$. Em cada intervalo, $S''$ é linear de $M_i$ a $M_{i+1}$. Integrar duas vezes e impor os dados dá, em $[x_i,x_{i+1}]$,

$$S(x) = \frac{M_i(x_{i+1}-x)^3 + M_{i+1}(x-x_i)^3}{6h_i} + \Big(\frac{y_i}{h_i}-\frac{M_ih_i}{6}\Big)(x_{i+1}-x) + \Big(\frac{y_{i+1}}{h_i}-\frac{M_{i+1}h_i}{6}\Big)(x-x_i).$$

Os valores e $S''$ agora coincidem por construção. Exigir que $S'$ concorde pelos dois lados num nó interno dá, para $i=1,\ldots,n-1$,

$$h_{i-1}M_{i-1} + 2(h_{i-1}+h_i)M_i + h_iM_{i+1} = 6(\delta_i-\delta_{i-1}).$$

Esse sistema é o que torna as splines práticas. Ele é tridiagonal, então se resolve em $O(n)$ operações, não em $O(n^3)$. Com fronteira natural ou fixada ele é estritamente diagonal dominante por linhas em qualquer malha, já que $2(h_{i-1}+h_i) > h_{i-1}+h_i$, logo é invertível e dispensa pivoteamento (compare com `lu-decomposition-and-partial-pivoting` e com a condição de dominância em `iterative-methods-jacobi-and-gauss-seidel`). Numa malha uniforme com fronteira natural, ele é $h$ vezes a matriz com 4 na diagonal e 1 ao lado, cujos autovalores ficam em $(2,6)$, então $\kappa_2<3$: medido $2{,}81$, $2{,}998$, $2{,}99998$ para $n=10,100,1000$. Compare com as matrizes de Vandermonde da lição anterior.

### Condições de fronteira

- **Natural:** $M_0 = M_n = 0$. Não exige dado extra e afirma que $f$ não tem curvatura nas pontas.
- **Fixada (clamped):** $S'(x_0) = s_0$ e $S'(x_n) = s_n$ para inclinações dadas. As equações acrescentadas são $2h_0M_0 + h_0M_1 = 6(\delta_0-s_0)$ e $h_{n-1}M_{n-1}+2h_{n-1}M_n = 6(s_n-\delta_{n-1})$.
- **Not-a-knot:** $S'''$ é contínua em $x_1$ e $x_{n-1}$, então os dois primeiros pedaços são uma só cúbica, e os dois últimos também. Não exige dado extra e é o padrão em `CubicSpline`.
- **Periódica:** $S'$ e $S''$ coincidem entre as duas pontas, para dados com $y_0=y_n$.

**Ordem.** Se $f\in C^4[a,b]$ numa malha uniforme, a spline not-a-knot satisfaz $\lVert f-S\rVert_\infty\le Ch^4$ para $h$ pequeno o bastante. Splines fixadas com as inclinações verdadeiras atingem a mesma ordem (Exemplo 4). A spline natural força $S''=0$ nas pontas, então quando $f''\ne0$ ali ela é só $O(h^2)$, e a perda fica nas pontas.

### Curvatura mínima

Entre todas as $g\in C^2[x_0,x_n]$ que interpolam os dados, a spline natural minimiza $\int (g'')^2\,dx$. Com as duas inclinações das pontas fixadas, a spline fixada minimiza essa integral entre os interpoladores com essas inclinações. A integral só aproxima a energia de flexão de uma régua física: a curvatura verdadeira é $g''/(1+g'^2)^{3/2}$, então as duas só concordam para inclinações pequenas.

## Exemplos Resolvidos

### Exemplo 1: uma spline natural à mão

Tome nós $0,1,2,3$ com valores $1,2,0,1$. Então $h_i=1$ e $\delta = (1,-2,1)$, e com $M_0=M_3=0$ o sistema é

$$\begin{aligned}4M_1 + M_2 &= 6(-2-1) = -18,\\ M_1 + 4M_2 &= 6(1+2) = 18,\end{aligned}$$

logo $M_1=-6$ e $M_2=6$. Com $t = x-x_i$, os pedaços são

$$\begin{aligned}S_0 &= 1 + 2t - t^3,\\ S_1 &= 2 - t - 3t^2 + 2t^3,\\ S_2 &= -t + 3t^2 - t^3.\end{aligned}$$

Em $x=1$: $S_0' = -1 = S_1'$ e $S_0''=-6=S_1''$, mas $S_0'''=-6$ e $S_1'''=12$. A terceira derivada salta, como precisa, senão os pedaços seriam uma só cúbica. Os valores nos pontos médios são $\tfrac{15}8, 1, \tfrac18$, e `CubicSpline(x, y, bc_type="natural")` devolve $1{,}875$, $1$, $0{,}125$ com exatamente esses coeficientes.

A integral de curvatura $\int_0^3 (S'')^2\,dx$ vale $36$ para esta spline. Vale $81$ para a spline not-a-knot, que em quatro pontos é a única cúbica por eles, e $64{,}8$ para a spline fixada com inclinação zero. A natural tem a menor, como o teorema exige.

### Exemplo 2: implementação, conferida contra o SciPy

```python
import numpy as np
from scipy.linalg import solve_banded

def moments(t, y, slopes=None):
    """Segundas derivadas nos nós: natural, ou fixada se slopes=(s0, sn)."""
    n, h = len(t) - 1, np.diff(t)
    d = np.diff(y) / h
    up, main, lo, r = np.zeros((4, n + 1))
    main[1:n] = 2 * (h[:-1] + h[1:])
    lo[:n - 1] = h[:-1]
    up[2:] = h[1:]
    r[1:n] = 6 * (d[1:] - d[:-1])
    main[[0, n]] = 1.0
    if slopes is not None:
        main[0], up[1], r[0] = 2 * h[0], h[0], 6 * (d[0] - slopes[0])
        main[n], lo[n - 1], r[n] = 2 * h[-1], h[-1], 6 * (slopes[1] - d[-1])
    return solve_banded((1, 1), np.vstack([up, main, lo]), r)
```

Em 40 nós aleatórios em $[-1,1]$ (intervalos de $0{,}0016$ a $0{,}28$) com $f = 1/(1+25x^2)$, avaliar a fórmula por partes acima em 20001 pontos difere de `CubicSpline` em no máximo $3{,}3\times10^{-16}$, tanto com fronteira natural quanto com fronteira fixada nas inclinações verdadeiras.

### Exemplo 3: a função de Runge

Erros máximos para $f(x)=1/(1+25x^2)$ em $[-1,1]$ com $n+1$ nós, numa grade de 20001 pontos. Todas as colunas, menos a última, usam nós equiespaçados.

```text
 n   polinômio    linear     cúbica not-a-knot   polinômio de Chebyshev
10   1.92e+00     6.74e-02   2.20e-02            1.09e-01
20   5.98e+01     4.18e-02   3.18e-03            1.53e-02
40   1.05e+05     1.40e-02   2.78e-04            2.89e-04
80   6.31e+14     3.80e-03   1.61e-05            1.02e-07
```

O polinômio diverge nos mesmos dados em que a spline converge. As ordens observadas da cúbica, dobrando $n$, são $2{,}79$, $3{,}52$, $4{,}11$, depois $4{,}06$ e $4{,}02$ em $n=160$ e $320$: a "ordem 4" só aparece quando $h$ resolve o pico de largura cerca de $1/5$. Splines não são simplesmente melhores que a interpolação de Chebyshev. Até $n=20$ a spline ganha, em $n=40$ empatam, e em $n=80$ o polinômio em nós escolhidos é cerca de 160 vezes melhor, porque esta $f$ é analítica e a convergência geométrica ultrapassa $h^4$.

A razão da estabilidade é a localidade. Ponha $y=1$ no nó central e $y=0$ nos outros, $n=20$, e registre o maior valor em cada intervalo:

```text
intervalo a partir do pico   spline natural   polinômio
1                            1.37e-01         2.65e-01
2                            3.66e-02         2.32e-01
3                            9.81e-03         3.01e-01
5                            7.05e-04         1.25e+00
9                            4.41e-06         1.82e+03
```

Cada intervalo multiplica a spline por um fator de cerca de $0{,}268 = 2-\sqrt3$, o tamanho da raiz decrescente da recorrência $M_{i-1}+4M_i+M_{i+1}=0$. O polinômio cresce rumo às pontas. A constante de Lebesgue em $n=20$ é $1{,}55$ para a spline natural e $1{,}97$ para a not-a-knot, contra $1{,}1\times10^4$ para o polinômio. Com $n=40$, somar $10^{-3}$ ao valor central muda a spline em $10^{-3}$ e o polinômio em $5{,}7\times10^{5}$.

### Exemplo 4: a condição de fronteira define a ordem

Erro máximo para $e^x$ em $[0,1]$, onde $f''\ne0$ nas duas pontas:

```text
  n   natural    fixada     not-a-knot
 10   1.33e-03   6.96e-07   6.93e-06
 20   3.34e-04   4.39e-08   4.56e-07
 40   8.34e-05   2.75e-09   2.92e-08
 80   2.09e-05   1.73e-10   1.85e-09
160   5.21e-06   1.08e-11   1.17e-10
ord   2.00       4.00       3.99
```

O erro da natural fica junto da ponta direita, em $x=0{,}990$ para $n=40$, onde a suposição falsa $S''=0$ custa mais. Em $\sin x$ sobre $[0,\pi]$, onde $f''$ de fato vale $0$ nas duas pontas, a spline natural recupera a ordem $4{,}00$. Aqui o erro da fixada vezes $n^4/e$ dá $0{,}0026$, perto de $1/384$, para esta $f$. A cota $h^2e/8$ da spline linear é quase atingida: $8{,}289\times10^{-7}$ medido contra $8{,}296\times10^{-7}$ em $n=640$.

### Exemplo 5: quando $f$ não é suave

Para $\sqrt x$ em $[0,1]$, $f'$ é ilimitada em $0$, então a hipótese $f\in C^4$ falha.

```text
  n   linear uniforme   cúbica uniforme   cúbica graduada, x_i = (i/n)^4
 20   5.59e-02          3.94e-02          7.20e-03
 80   2.80e-02          1.97e-02          4.50e-04
320   1.40e-02          9.85e-03          2.81e-05
```

Na malha uniforme as duas ordens caem para $0{,}50$, e o grau extra quase não compra nada. Splines aceitam qualquer malha, então os nós podem ser levados para perto da singularidade, o que dá ordem $2{,}00$ com o mesmo número de nós.

### Exemplo 6: overshoot e extrapolação

Tome dados $0$ em $x=0,\ldots,5$ e $1$ em $x=6,\ldots,10$. `CubicSpline` vai de $-0{,}108$ a $1{,}108$. A suavidade a empurra para além dos dados. Agora tome uma distribuição de latência ilustrativa, com $x=1,2,5,10,20,50,100,200,500$ ms e frações acumuladas $0{,}10$, $0{,}40$, $0{,}70$, $0{,}85$, $0{,}92$, $0{,}97$, $0{,}99$, $0{,}995$, $0{,}999$. Nessa grade irregular a cúbica chega a $1{,}041$ perto de $388$ ms, uma probabilidade impossível, e decresce em cerca de um terço do intervalo. `PchipInterpolator` continua monótono, entre $0{,}1$ e $0{,}999$, ao custo de ser só $C^1$.

Fora dos dados, uma spline é apenas sua última cúbica, e `CubicSpline` extrapola por padrão. Para $\sin 2\pi x$ em 11 nós de $[0,1]$, o valor em $x=1{,}2$ é $1{,}18$ contra $0{,}95$, e em $x=2$ é $-18{,}6$ contra $0$. Passe `extrapolate=False` para receber `nan` ali.

## Equívocos Comuns e Armadilhas

- **"Splines nunca oscilam."** Elas evitam o crescimento de Runge, não o overshoot: o Exemplo 6 ultrapassa em cerca de $11\%$ do degrau.
- **"A spline natural é a escolha mais natural."** O nome se refere à condição, não à precisão. Ela tem ordem 2, a não ser que $f''$ se anule nas pontas (Exemplo 4).
- **"`bc_type='clamped'` significa que as inclinações são respeitadas."** No SciPy essa string significa inclinação zero nas duas pontas. Em $e^x$ com $n=40$ ela dá erro $0{,}0116$, contra $2{,}75\times10^{-9}$ com `bc_type=((1, 1.0), (1, np.e))`.
- **"Uma spline interpoladora remove ruído."** Ela passa por todos os pontos, com ruído e tudo. Para dados ruidosos use um ajuste: veja `least-squares-curve-fitting` ou `scipy.interpolate.make_smoothing_spline`.
- **"Splines sempre vencem polinômios globais."** Em funções suaves com nós escolhidos, a interpolação de Chebyshev acaba ganhando (Exemplo 3).
- **"Livro vs hoje."** Código antigo usa `scipy.interpolate.interp1d`, que o SciPy agora chama de legado. Código novo deve usar `CubicSpline`, `PchipInterpolator` ou `make_interp_spline`. Com a fronteira padrão, `make_interp_spline(t, y, k=3)` coincide com `CubicSpline` até $6{,}7\times10^{-16}$ nos dados de degrau do Exemplo 6.

## Resumo

Uma spline cúbica tem $4n$ coeficientes e $4n-2$ condições de coincidência, então duas condições de fronteira a completam. As segundas derivadas resolvem um sistema tridiagonal e estritamente diagonal dominante em $O(n)$, com $\kappa_2<3$ numa malha uniforme natural. Para $f\in C^4$, splines not-a-knot e fixadas atingem ordem 4, e as naturais caem para ordem 2, a não ser que $f''$ se anule nas pontas. Na função de Runge o erro vai de $2{,}2\times10^{-2}$ a $1{,}6\times10^{-5}$ entre $n=10$ e $n=80$ enquanto o polinômio equiespaçado explode, porque a resposta de uma spline a um valor é multiplicada por um fator de $0{,}268$ por intervalo. Splines cúbicas ainda ultrapassam os dados e extrapolam mal: use um interpolador monótono como o PCHIP quando a forma importa, e um ajuste quando os dados têm ruído.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.2 Piecewise linear interpolation](https://fncbook.com/pwlin/): funções chapéu e o resultado de condicionamento da interpolação linear.
- [Fundamentals of Numerical Computation, 5.3 Cubic splines](https://fncbook.com/splines/): as condições de suavidade, as condições de fronteira e o teorema de quarta ordem para splines not-a-knot.
- [MIT OpenCourseWare 18.330, Chapter 3: Interpolation](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter3/): interpolação por partes e o sistema das segundas derivadas de uma spline natural.
- [SciPy: CubicSpline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.CubicSpline.html): opções de fronteira, incluindo o significado de `'clamped'`, e o padrão not-a-knot.
- [SciPy: PchipInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html): o interpolador $C^1$ que preserva a forma.
- [SciPy: interp1d](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.interp1d.html): a interface legada e sua nota sobre substituição.
- [SciPy: make_interp_spline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_interp_spline.html): interpolação por B-splines de grau escolhido.
- [SciPy: make_smoothing_spline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_smoothing_spline.html): uma spline suavizadora para dados ruidosos.
