---
version: 1.0
updatedAt: 2026-11-04
title: "Interpolação Polinomial: Lagrange e Newton"
summary: "As formas de Lagrange e de Newton do mesmo polinômio interpolador, diferenças divididas, a fórmula do erro de interpolação e o fenômeno de Runge."
---
## Objetivos de Aprendizagem

- Provar que $n+1$ nós distintos determinam um único polinômio de grau no máximo $n$, e explicar por que o sistema de Vandermonde é o jeito errado de calculá-lo.
- Construir o interpolador na forma de Lagrange, na forma baricêntrica e na forma de Newton com diferenças divididas, e acrescentar um nó à forma de Newton.
- Enunciar a fórmula do erro de interpolação com suas hipóteses e usá-la para limitar um erro.
- Medir o fenômeno de Runge e separar a divergência verdadeira do polinômio do arredondamento amplificado pela constante de Lebesgue.
- Dizer o que os nós de Chebyshev consertam e o que não consertam.

## Contexto e Motivação

Um polinômio de Taylor coincide com a função em um ponto. Um interpolador coincide em vários, e `taylor-and-maclaurin-series-with-error-bounds` já mostrou a interpolação em nós de Chebyshev batendo o polinômio de Taylor de mesmo grau para $\sin$ por um fator de mais de 250. A interpolação também é a matéria-prima da quadratura em `trapezoid-and-simpson-rules`. A mesma fórmula de Lagrange roda sobre corpos finitos em códigos Reed-Solomon e no compartilhamento de segredos de Shamir, onde a aritmética é exata e nada do que esta lição diz sobre arredondamento se aplica.

Em ponto flutuante, três coisas podem dar errado mesmo com o polinômio sendo único: a base pode ser mal condicionada no sentido de `the-matrix-condition-number`, a posição dos nós pode fazer o próprio polinômio divergir, e o arredondamento dos dados pode ser amplificado. São falhas separadas, e esta lição mede cada uma.

## Teoria Central

### Existência e unicidade

Dados nós distintos $x_0,\ldots,x_n$ e valores quaisquer $y_0,\ldots,y_n$, existe exatamente um polinômio $p$ de grau no máximo $n$ com $p(x_j) = y_j$. Unicidade: a diferença de dois desses polinômios tem grau no máximo $n$ e $n+1$ raízes, logo é zero. Existência: a forma de Lagrange abaixo o constrói. Os nós precisam ser distintos, já que um nó repetido com dois valores diferentes não admite função nenhuma.

Assim, o "polinômio de Lagrange" e o "polinômio de Newton" são um único polinômio escrito em duas bases. Só o comportamento numérico difere. Escrevê-lo na base de monômios significa resolver um sistema de Vandermonde $Vc = y$, cujo número de condição cresce rápido: para 21 nós, $\kappa_2(V)$ vale $8{,}3\times10^{8}$ com nós equiespaçados em $[-1,1]$ e $8{,}9\times10^{16}$ em $[0,1]$.

### Formas de Lagrange e baricêntrica

Os polinômios cardinais são $\ell_j(x) = \prod_{k\ne j}\frac{x-x_k}{x_j-x_k}$, com $\ell_j(x_i)$ igual a 1 quando $i=j$ e 0 caso contrário, então $p(x) = \sum_j y_j\ell_j(x)$. Avaliado diretamente, isso custa $O(n^2)$ por ponto. Com pesos $w_j = 1/\prod_{k\ne j}(x_j-x_k)$ e $\omega(x) = \prod_k (x-x_k)$, temos $p(x) = \omega(x)\sum_j \frac{w_j y_j}{x-x_j}$. A função constante 1 é o próprio interpolador, então $1 = \omega(x)\sum_j\frac{w_j}{x-x_j}$. Dividir cancela $\omega$ e dá a **fórmula baricêntrica**, para $x$ que não seja nó:

$$p(x) = \frac{\sum_j \dfrac{w_j y_j}{x-x_j}}{\sum_j \dfrac{w_j}{x-x_j}}.$$

A preparação é $O(n^2)$ e cada avaliação é $O(n)$. É isso que `scipy.interpolate.BarycentricInterpolator` calcula.

### Forma de Newton e diferenças divididas

Escreva $p(x) = c_0 + c_1(x-x_0) + c_2(x-x_0)(x-x_1) + \cdots$. Os coeficientes são as **diferenças divididas** $c_k = f[x_0,\ldots,x_k]$, definidas por $f[x_i] = y_i$ e

$$f[x_i,\ldots,x_{i+k}] = \frac{f[x_{i+1},\ldots,x_{i+k}] - f[x_i,\ldots,x_{i+k-1}]}{x_{i+k}-x_i}.$$

A tabela custa $O(n^2)$, e a multiplicação aninhada avalia $p$ em $O(n)$. Acrescentar um nó adiciona uma linha, com custo $O(n)$, e não muda nenhum $c_k$ anterior.

### A fórmula do erro

**Hipóteses.** $f \in C^{n+1}[a,b]$, os nós são pontos distintos de $[a,b]$ e $x \in [a,b]$. **Conclusão.** Existe $\xi \in [a,b]$, que depende de $x$, com

$$f(x) - p(x) = \frac{f^{(n+1)}(\xi)}{(n+1)!}\,\omega(x), \qquad \omega(x) = \prod_{k=0}^n (x-x_k).$$

Ela se lê como o resto de Taylor com $(x-a)^{n+1}$ trocado por $\omega$. Dois fatores competem: a derivada pertence a $f$, e $\omega$ pertence aos nós.

### Nós e a constante de Lebesgue

Em $[-1,1]$, os **nós de Chebyshev** $x_k = \cos\frac{(2k+1)\pi}{2n+2}$, $k=0,\ldots,n$, são os zeros de $T_{n+1}$. Eles dão $\max\lvert\omega\rvert = 2^{-n}$, o menor valor que qualquer escolha de $n+1$ nós consegue atingir. Nós equiespaçados deixam $\omega$ pequeno no meio e grande nas pontas: para $n=20$, $\lvert\omega\rvert$ vale $4{,}3\times10^{-9}$ perto de $x=0{,}05$ e $2{,}3\times10^{-4}$ perto das pontas, contra um máximo de $9{,}5\times10^{-7}$ com Chebyshev ($8{,}3\times10^{-7}$ em $x=0{,}05$). Em $[a,b]$, mapeie por $x\mapsto\frac{a+b}{2}+\frac{b-a}{2}x$.

Os nós também fixam o condicionamento do mapa dos dados para o polinômio. Mudar os valores em no máximo $\varepsilon$ muda $p$ em no máximo $\Lambda_n\varepsilon$, onde $\Lambda_n = \max_x\sum_j\lvert\ell_j(x)\rvert$ é a **constante de Lebesgue**:

```text
n    Lambda_n equiespaçados   Lambda_n Chebyshev
10   2.99e+01                 2.49
20   1.10e+04                 2.90
40   4.69e+09                 3.33
60   2.98e+15                 3.58
```

Para $f$ analítica num intervalo aberto que contém $[-1,1]$, a interpolação em nós de Chebyshev converge geometricamente: o erro máximo é no máximo $CK^{-n}$ para certos $C>0$, $K>1$. Para nós equiespaçados não vale nada parecido.

## Exemplos Resolvidos

### Exemplo 1: um polinômio, três formas, um nó novo

Interpole $(0,1), (1,3), (2,2), (4,5)$. Os denominadores $\prod_{k\ne j}(x_j-x_k)$ são $-8, 3, -4, 24$, logo $w = (-\tfrac18, \tfrac13, -\tfrac14, \tfrac1{24})$. Em $x=3$ as somas baricêntricas são

$$\frac{-\frac1{24}+\frac12-\frac12-\frac5{24}}{-\frac1{24}+\frac16-\frac14-\frac1{24}} = \frac{-1/4}{-1/6} = \frac32.$$

A tabela de diferenças divididas, com os coeficientes de Newton no topo de cada coluna:

```text
x   f      f[,]   f[,,]   f[,,,]
0   1      2      -3/2    7/12
1   3      -1     5/6
2   2      3/2
4   5
```

Logo $p(x) = 1 + 2x - \tfrac32 x(x-1) + \tfrac7{12}x(x-1)(x-2)$, que expande para $\tfrac7{12}x^3 - \tfrac{13}4x^2 + \tfrac{14}3x + 1$ e dá $p(3) = \tfrac32$ de novo. A expansão simbólica da forma de Lagrange devolve a mesma cúbica, e `BarycentricInterpolator` e `KroghInterpolator` devolvem $1{,}5$ em $x=3$.

Agora acrescente $(3,0)$. Uma linha nova dá $5$, $\tfrac72$, $\tfrac43$, $\tfrac14$, e $p$ ganha só o termo $\tfrac14x(x-1)(x-2)(x-4)$. Esse termo se anula nos quatro nós antigos e vale $-\tfrac32$ em $x=3$, o que leva $\tfrac32$ a $0$.

### Exemplo 2: conferindo a fórmula do erro

Para $f = e^x$ em $[0,1]$ com nós $0, \tfrac13, \tfrac23, 1$, a quarta derivada fica em $[1,e]$. O cálculo dá $\max\lvert\omega\rvert = \tfrac1{81}$, em $x = \tfrac12\pm\tfrac{\sqrt5}{6}$. Assim, o erro máximo fica entre $\frac{1}{24\cdot81} = 5{,}14\times10^{-4}$ e $\frac{e}{24\cdot81} = 1{,}40\times10^{-3}$. Medido numa grade de $10^5$ pontos, ele vale $9{,}24\times10^{-4}$, perto de $x = 0{,}875$. Ali a fórmula dá $e^\xi = 1{,}797$, isto é, $\xi = 0{,}586$, dentro de $[0,1]$ como prometido.

### Exemplo 3: o fenômeno de Runge

Tome $f(x) = 1/(1+25x^2)$ em $[-1,1]$, que está em $C^\infty$ e parece inofensiva. Erros máximos numa grade de 20001 pontos, com o caso equiespaçado repetido em aritmética de 200 dígitos:

```text
 n   equiespaçado   equiespaçado exato   Chebyshev
 5   4.33e-01       4.33e-01             5.56e-01
10   1.92e+00       1.92e+00             1.09e-01
20   5.98e+01       5.98e+01             1.53e-02
40   1.05e+05       1.05e+05             2.89e-04
60   1.64e+08       2.29e+08             5.42e-06
80   6.31e+14       5.46e+11             1.02e-07
```

As hipóteses da fórmula do erro valem; a fórmula só deixa de ajudar. Como $f^{(2k)}(0)$ tem tamanho $(2k)!\,25^{k}$, o fator $f^{(n+1)}(\xi)/(n+1)!$ pode crescer como $5^{n+1}$, então a cota é inútil aqui e não consegue localizar o problema: em $n=40$, $5^{41}\lvert\omega(0{,}025)\rvert = 3{,}9\times10^{11}$ numa região onde o método funciona. O que separa as regiões é o polo. Para esta $f$ o erro é exatamente $\omega(x)\cdot2\operatorname{Re}\big[1/(50z\,\omega(z)(x-z))\big]$ com $z=i/5$, então ele escala com $\lvert\omega(x)/\omega(i/5)\rvert$, que em $n=40$ vale $1{,}5\times10^{-5}$ em $x=0{,}025$ e $2{,}9\times10^{5}$ em $x=0{,}975$. A coluna de aritmética exata prova que a divergência é real, e não arredondamento. O pior ponto caminha para a ponta, $x\approx0{,}94$ em $n=10$ e $0{,}989$ em $n=40$, enquanto o meio converge: em $\lvert x\rvert\le\tfrac12$ o erro é $0{,}116$, $0{,}0153$ e $5{,}5\times10^{-4}$ em $n=10,20,40$. O arredondamento entra no fim da tabela: em $n=80$ o valor em float64 é cerca de 1000 vezes o exato.

Com nós de Chebyshev, o fator observado por grau fica entre $1{,}218$ e $1{,}220$ de $n=40$ a $n=160$, e o erro chega ao nível do arredondamento perto de $n=160$. A análise complexa prevê a taxa a partir dos polos de $f$ em $\pm i/5$: $\tfrac15+\sqrt{1+\tfrac1{25}} = 1{,}2198$. Repare na primeira linha: em $n=5$, Chebyshev é pior.

### Exemplo 4: quando o arredondamento é a história inteira

$e^x$ em $[-1,1]$ não tem problema de Runge, já que $\lvert f^{(n+1)}\rvert \le e$ e a fórmula força a convergência.

```text
 n   equiespaçado float64   equiespaçado exato   Chebyshev float64
10   2.35e-10               2.35e-10             2.71e-11
20   2.12e-12               4.82e-24             2.22e-15
30   2.78e-09               1.02e-39             2.66e-15
40   2.34e-06               9.37e-57             2.66e-15
50   1.15e-03               7.98e-75             2.66e-15
60   9.66e-01               9.94e-94             3.11e-15
```

O polinômio verdadeiro em $n=60$ acerta 93 dígitos, e o float64 devolve lixo de tamanho 1. `BarycentricInterpolator` mostra o mesmo crescimento ($0{,}78$ em $n=60$), então não é erro de código. Multiplique $e\,u\,\Lambda_n$ com $u = 1{,}1\times10^{-16}$: $3{,}3\times10^{-12}$, $1{,}4\times10^{-6}$ e $0{,}89$ em $n=20,40,60$, o tamanho dos erros observados. Aqui o erro de truncamento acabou, e o arredondamento dos dados, amplificado por $\Lambda_n$, é tudo o que sobra.

### Exemplo 5: o mesmo polinômio, cinco implementações

Nós de Chebyshev, $f$ do Exemplo 3, $n=60$, float64. As cinco linhas calculam um único objeto matemático:

```text
método                                        erro máximo
baricêntrico                                  5.42e-06
Newton, ordem de Leja                         5.42e-06
Vandermonde, potências crescentes             4.33e-03
Newton, nós ordenados da esquerda à direita   1.43e+00
Vandermonde, potências decrescentes (padrão)  5.24e+01
```

A ordem de Leja escolhe cada próximo nó maximizando o produto das distâncias aos já escolhidos. A ordem dos nós é a única diferença entre as duas linhas de Newton, e em $n=120$ a distância é de $3{,}6\times10^{-11}$ contra $3{,}2\times10^{24}$. As linhas de Vandermonde têm $\kappa_2(V) = 4{,}5\times10^{22}$, resolvem o sistema com `numpy.linalg.solve` e usam os nós na ordem $k=0,\ldots,n$. Seus valores são ruído de arredondamento: a ordem das colunas move o erro em quatro ordens de grandeza aqui, ordenar os nós dá $0{,}048$ e $3{,}66$ em vez disso, e os dígitos podem mudar entre máquinas. Para $e^x$ as mesmas matrizes dão $5{,}3\times10^{-15}$ com potências crescentes e $3{,}0\times10^{-10}$ com potências decrescentes, então $\kappa$ limita o pior lado direito, e estes dados suaves não são esse caso. Uma implementação direta da fórmula baricêntrica coincide com `BarycentricInterpolator` até $1{,}1\times10^{-15}$ em $n=20$ e $n=40$.

### Exemplo 6: quando falta suavidade

$f(x) = \lvert x\rvert$ é contínua, mas não tem derivada em $0$, então a fórmula do erro não se aplica.

```text
 n   equiespaçado exato   Chebyshev   n * erro Chebyshev
10   6.64e-01             5.46e-02    0.55
20   9.52e+01             2.85e-02    0.57
40   1.47e+07             1.46e-02    0.58
80   2.45e+18             7.37e-03    0.59
```

A interpolação equiespaçada diverge. Chebyshev converge, mas só como $1/n$: a taxa geométrica precisava de analiticidade. Continuidade sozinha não basta para nenhuma tabela fixa de nós: o teorema de Faber diz que toda tabela tem alguma função contínua cujos interpoladores divergem.

## Equívocos Comuns e Armadilhas

- **"Mais nós sempre dão um ajuste melhor."** Os Exemplos 3, 4 e 6 mostram o erro crescendo com $n$, por três razões diferentes.
- **"O fenômeno de Runge é efeito de arredondamento."** A coluna de aritmética exata do Exemplo 3 também diverge. O Exemplo 4 é o caso oposto: ali o polinômio exato está ótimo e só o arredondamento atrapalha.
- **"Lagrange e Newton dão respostas diferentes."** A unicidade faz deles um só polinômio. Diferem em custo e em arredondamento.
- **"A forma de Newton é segura em qualquer ordem de nós."** O Exemplo 5 mostra cinco ordens de grandeza de diferença só pela ordem em $n=60$.
- **"Nós de Chebyshev são sempre melhores."** Perderam em $n=5$ no Exemplo 3, dão só $1/n$ para $\lvert x\rvert$ e exigem escolher onde amostrar. Para dados já amostrados numa grade fixa, veja `splines` e `least-squares-curve-fitting`.
- **"Livro vs hoje."** A documentação do SciPy avisa que `scipy.interpolate.lagrange` é numericamente instável, diz para não esperar mais de cerca de 20 pontos e a marca como obsoleta desde a versão 1.18, em favor de `BarycentricInterpolator`.

## Resumo

Existe um único polinômio de grau no máximo $n$ por $n+1$ nós distintos. A forma baricêntrica o avalia de modo estável em $O(n)$ por ponto; a forma de Newton acrescenta nós barato, mas depende da ordem dos nós; a forma de monômios herda um número de condição de Vandermonde. O erro é $f^{(n+1)}(\xi)\,\omega(x)/(n+1)!$ para $f \in C^{n+1}$. Nós equiespaçados tornam $\omega$ e a constante de Lebesgue grandes perto das pontas, o que dá divergência verdadeira para $1/(1+25x^2)$ ($10^5$ em $n=40$) e explosão de arredondamento para $e^x$ (cerca de $1$ em $n=60$). Nós de Chebyshev mantêm $\Lambda_n$ abaixo de 4 nestas execuções e dão convergência geométrica para funções analíticas, numa taxa definida pelos polos ($1{,}2198$ por grau para $1/(1+25x^2)$), mas só $1/n$ para $\lvert x\rvert$.

## Documentation Links

- [Fundamentals of Numerical Computation, 9.1 Polynomial interpolation](https://fncbook.com/polynomial/): existência, unicidade, forma de Lagrange e fórmula do erro.
- [Fundamentals of Numerical Computation, 9.2 The barycentric formula](https://fncbook.com/barycentric/): dedução dos pesos e da fórmula baricêntrica.
- [Fundamentals of Numerical Computation, 9.3 Stability of polynomial interpolation](https://fncbook.com/stability-1/): fenômeno de Runge, nós de Chebyshev e convergência espectral.
- [MIT OpenCourseWare 18.330, Chapter 3: Interpolation](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter3/): interpolação de Lagrange, o teorema do erro e o fenômeno de Runge.
- [SciPy: BarycentricInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.BarycentricInterpolator.html): o interpolador da biblioteca usado para conferir estes resultados, com notas sobre a escolha dos nós.
- [SciPy: KroghInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.KroghInterpolator.html): um interpolador alternativo e seu aviso sobre mau condicionamento.
- [SciPy: scipy.interpolate.lagrange](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.lagrange.html): o aviso e a nota de obsolescência citados nas armadilhas.
- [Wikipedia: Polynomial interpolation](https://en.wikipedia.org/wiki/Polynomial_interpolation): a constante de Lebesgue e o teorema de divergência para toda tabela de nós.
