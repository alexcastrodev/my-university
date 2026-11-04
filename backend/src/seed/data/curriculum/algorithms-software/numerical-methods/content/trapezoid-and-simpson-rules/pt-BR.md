---
version: 1.0
updatedAt: 2026-11-04
title: "Regras do Trapézio e de Simpson"
summary: "As regras compostas do trapézio e de Simpson deduzidas por interpolação, com seus termos de erro aplicados a integrais de valor exato conhecido."
---
## Objetivos de Aprendizagem

- Deduzir as regras do trapézio e de Simpson integrando um polinômio interpolador, e escrever suas formas compostas.
- Enunciar cada termo de erro com sua hipótese: $f\in C^2[a,b]$ para o trapézio, $f\in C^4[a,b]$ para Simpson.
- Explicar por que a regra de Simpson, construída sobre uma parábola, é exata para cúbicas.
- Medir uma ordem de convergência a partir de uma tabela de erros e mostrá-la caindo num integrando sem as derivadas exigidas.
- Escolher $n$ a partir de uma cota de erro e distinguir a cota do erro verdadeiro.
- Dizer onde o arredondamento interrompe a convergência e quando uma regra de grau mais alto piora o resultado.

## Contexto e Motivação

A lição `the-definite-integral-and-riemann-sums` construiu a regra do trapézio como média das somas à esquerda e à direita e observou sua taxa $O(1/n^2)$ numa tabela. Uma taxa observada não diz qual propriedade de $f$ é responsável por ela, nem o que fazer quando a função não tem primitiva e só há amostras disponíveis.

Esta lição chega à mesma regra por outro caminho: troque $f$ por um polinômio que a interpola e integre esse polinômio de forma exata. O erro de interpolação de `polynomial-interpolation-lagrange-and-newton` vira então um termo de erro exato, com uma derivada específica dentro dele. Essa derivada é a hipótese, e tirá-la é o que faz a ordem cair.

## Teoria Central

### Integre o interpolante

Seja $p$ o polinômio que interpola $f$ nos nós $x_0,\dots,x_d$ em $[a,b]$. Escrever $p$ na base de Lagrange dá

$$\int_a^b f\,dx \approx \int_a^b p\,dx = \sum_{i=0}^{d} w_i\, f(x_i), \qquad w_i = \int_a^b \ell_i(x)\,dx.$$

Os pesos dependem só dos nós, então são calculados uma vez. Com $H = b-a$ e $m = (a+b)/2$:

- **Grau 1**, nós $a, b$: $w = H/2$ para cada nó, logo $T = \frac{H}{2}\big(f(a)+f(b)\big)$.
- **Grau 2**, nós $a, m, b$: integrar as três parábolas da base dá $H/6$, $4H/6$, $H/6$, logo $S = \frac{H}{6}\big(f(a)+4f(m)+f(b)\big)$.

### O erro do trapézio

Se $f\in C^2[a,b]$, para cada $x$ existe $\xi(x)$ com $f(x)-p(x) = \frac12 f''(\xi(x))\,(x-a)(x-b)$. O fator $(x-a)(x-b)$ não troca de sinal em $[a,b]$, então vale o teorema do valor médio para integrais com peso de sinal constante. Como $\int_a^b (x-a)(x-b)\,dx = -H^3/6$,

$$\int_a^b f\,dx - T = -\frac{H^3}{12}\,f''(\eta), \qquad \eta\in[a,b].$$

Divida $[a,b]$ em $n$ painéis de largura $h=(b-a)/n$ e some os painéis. Como $f''$ é contínua, a média dos $n$ valores $f''(\eta_i)$ é ela mesma um valor de $f''$, o que dá o resultado composto:

$$I - T_n = -\frac{(b-a)h^2}{12}\,f''(\xi), \qquad T_n = h\Big[\tfrac12 f_0 + f_1 + \dots + f_{n-1} + \tfrac12 f_n\Big].$$

Para $f$ convexa isso diz que $T_n$ superestima. Quando $h\to0$, o valor médio tende à média de $f''$, logo $I-T_n \approx -\frac{h^2}{12}\big(f'(b)-f'(a)\big)$.

### Simpson ganha um grau de brinde

O mesmo argumento emperra em Simpson. O fator $(x-a)(x-m)(x-b)$ troca de sinal em $m$, e sua integral em $[a,b]$ é $0$ por simetria. Esse zero é uma boa notícia: significa que a regra integra toda cúbica de forma exata, um grau acima da parábola que a gerou. Seu **grau de precisão** é 3.

Para obter o erro, use uma cúbica que também coincida com $f'(m)$. Para $f\in C^4[a,b]$,

$$f(x) - p_3(x) = \frac{f^{(4)}(\xi(x))}{24}\,(x-a)(x-m)^2(x-b),$$

e agora o fator mantém um sinal só. Sua integral é $-H^5/120$, e $\int p_3 = S$ porque $S$ é exata para cúbicas e $p_3$ coincide com $f$ nos três nós. Daí $I - S = -\frac{H^5}{2880}f^{(4)}(\eta)$. Cada painel tem $H=2h$, então a regra composta exige $n$ par, e

$$I - S_n = -\frac{(b-a)h^4}{180}\,f^{(4)}(\xi), \qquad S_n = \frac{h}{3}\big[f_0 + 4f_1 + 2f_2 + 4f_3 + \dots + 4f_{n-1} + f_n\big].$$

As duas regras compostas usam $n+1$ avaliações de $f$:

```python
def trapezoid(f, a, b, n):
    x = np.linspace(a, b, n + 1); y = f(x); h = (b - a) / n
    return h * (y[0] / 2 + y[1:-1].sum() + y[-1] / 2)

def simpson(f, a, b, n):  # n par
    x = np.linspace(a, b, n + 1); y = f(x); h = (b - a) / n
    return h / 3 * (y[0] + y[-1] + 4 * y[1:-1:2].sum() + 2 * y[2:-1:2].sum())
```

### Por que não um único polinômio de grau alto

Mais nós num só polinômio podem ajudar quando $f$ é muito suave: em $e^x$ sobre $[0,1]$, Newton-Cotes de grau 8 tem erro $9{,}8\times10^{-13}$, contra $2{,}3\times10^{-6}$ de Simpson nos mesmos nove nós. Em nós igualmente espaçados isso também pode falhar feio. Tome $f(x)=1/(1+25x^2)$ em $[-1,1]$, onde $I = \frac25\arctan 5$. A regra fechada de Newton-Cotes de grau $d$ integra o interpolante em $d+1$ nós equiespaçados. Seus pesos, em unidades do espaçamento, vêm de `scipy.integrate.newton_cotes`:

```text
 d   erro de Newton-Cotes   peso mais negativo   Simpson composta, mesmos nós
 4        7.46e-02              (nenhum)               1.93e-02
 8        2.49e-01              -1.28                  2.59e-02
12        6.12e-01              -16.7                  9.00e-03
16        1.80e+00              -168                   2.70e-03
20        5.92e+00              -1800                  7.79e-04
```

É o fenômeno de Runge, agora integrado. Pesos negativos também amplificam o arredondamento de $f$. Grau baixo em muitos painéis é o remédio usual.

### Onde a ordem cai

As ordens 2 e 4 são promessas sob $C^2$ e $C^4$. Aqui elas foram medidas dobrando $n$ de 1024 para 2048, exceto nas duas últimas linhas, em que se ajustou uma reta por $n = 2^4,\dots,2^{16}$ porque os erros são erráticos:

```text
integrando em [0,1]    ordem T   ordem S   o que falha
x^(1/2)                 1.50      1.50     f'  ilimitada em 0
x^(3/2)                 2.00      2.50     f'' ilimitada em 0
x^(5/2)                 2.00      3.49     f''' ilimitada em 0
x^(7/2)                 2.00      3.99     f'''' ilimitada em 0
|x - 1/sqrt(2)|         2.02      1.83     quina
degrau em 1/sqrt(2)     0.98      1.05     salto
```

Em $\sqrt x$ a vantagem de Simpson some: as duas regras têm ordem $3/2$. A linha $x^{3/2}$ mostra que as hipóteses são suficientes, não necessárias: $f''$ é ilimitada, o teorema não diz nada e o trapézio mantém ordem 2. Numa quina, o remédio é dividir a integral ali. Com $\lvert x-\tfrac14\rvert$ e $n$ múltiplo de 4 a quina é um nó e $T_n$ é exata, porque $f$ é linear em todo painel.

A ordem também pode ser melhor que a prometida. Para $f(x)=e^{\cos x}$ no período inteiro $[0,2\pi]$, um integrando suave e periódico:

```text
 n    erro do trapézio   erro de Simpson
 8      1.25e-06          1.15e-02
16      1.78e-15          4.17e-07
32      1.78e-15          2.66e-15
```

As duas regras ficam muito à frente de $h^2$ e $h^4$, e o trapézio vence Simpson. A próxima lição, `error-orders-and-adaptive-quadrature`, explica por quê.

### O arredondamento interrompe a convergência

Os termos de erro acima são só de truncamento. Rode a regra do trapézio em $e^x$ sobre $[0,1]$ em float32, com uma soma acumulada simples:

```text
      n     erro em float32   truncamento h^2(e-1)/12
     16       5.591e-04         5.593e-04
    256       2.182e-06         2.185e-06
   1024       2.018e-07         1.366e-07
   4096       5.594e-07         8.535e-09
  65536       6.786e-07         3.334e-11
 262144       7.474e-06         2.084e-12
1048576       3.066e-04         1.302e-13
```

Até $n\approx 256$ o truncamento domina. Depois de $n\approx 2000$ o erro para de cair, e depois de $65536$ ele cresce, porque o arredondamento acumulado da soma (veja `sources-of-error-truncation-rounding-propagation`) ultrapassa o truncamento, que continua encolhendo. Em float64 o mesmo efeito fica bem mais abaixo. Simpson nesta integral tem erro $8{,}66\times10^{-15}$ em $n=1024$, que ainda é truncamento (previsto: $8{,}68\times10^{-15}$), e o arredondamento aparece em $n=2048$: $6{,}66\times10^{-16}$ contra $5{,}43\times10^{-16}$ previstos.

## Exemplos Resolvidos

### Exemplo 1: exata para cúbicas, não para quárticas

Tome $f(x)=x^3-2x+1$ em $[0,2]$ com um painel de Simpson: $f(0)=1$, $f(1)=0$, $f(2)=5$, logo $S = \frac{2}{6}(1+0+5) = 2$, e a integral exata é $2$. Para $f(x)=x^4$ em $[0,1]$ com $n=2$, $h=\tfrac12$: $S_2 = \frac{1}{6}\big(0+\tfrac{4}{16}+1\big) = \tfrac{5}{24}$ contra $\tfrac15$, então $I-S_2 = -\tfrac{1}{120}$. A fórmula do erro dá $-\frac{1\cdot(1/2)^4}{180}\cdot 24 = -\tfrac{1}{120}$, exatamente, porque $f^{(4)}$ é constante.

### Exemplo 2: medindo as duas ordens em $e^x$

Para $I=\int_0^1 e^x\,dx = e-1$, um script imprime os erros, a razão ao dobrar $n$, a ordem $\log_2(\text{razão})$ e os termos principais previstos $h^2(e-1)/12$ e $h^4(e-1)/180$.

```text
  n    |I-T_n|   razão  ordem   previsto     |I-S_n|   razão  ordem   previsto
  4   8.940e-03                 8.949e-03   3.701e-05                 3.729e-05
  8   2.237e-03  3.997  2.00    2.237e-03   2.326e-06  15.91  3.99    2.331e-06
 16   5.593e-04  3.999  2.00    5.593e-04   1.456e-07  15.98  4.00    1.457e-07
 32   1.398e-04  4.000  2.00    1.398e-04   9.103e-09  15.99  4.00    9.104e-09
 64   3.496e-05  4.000  2.00    3.496e-05   5.690e-10  16.00  4.00    5.690e-10
128   8.740e-06  4.000  2.00    8.740e-06   3.556e-11  16.00  4.00    3.556e-11
```

Tanto $T_n - I$ quanto $S_n - I$ são positivos aqui, como os sinais dos termos de erro preveem para $f''>0$ e $f^{(4)}>0$.

### Exemplo 3: escolhendo $n$ por uma cota

O integrando de $\int_0^1 e^{-x^2}dx$ não tem primitiva elementar; o valor é $\frac{\sqrt\pi}{2}\operatorname{erf}(1) \approx 0{,}746824$. Busque erro $10^{-6}$. Aqui $f''=(4x^2-2)e^{-x^2}$ e $f^{(4)}=(16x^4-48x^2+12)e^{-x^2}$, cujos valores absolutos em $[0,1]$ têm máximo em $x=0$, valendo $2$ e $12$. Assim:

- Trapézio: $\frac{2}{12n^2}\le10^{-6}$ exige $n\ge 409$.
- Simpson: $\frac{12}{180n^4}\le10^{-6}$ exige $n\ge16{,}07$, então o primeiro valor par é $n=18$.

São 410 avaliações contra 19. As duas cotas são seguras e pessimistas: em $n=409$ o erro do trapézio é $3{,}67\times10^{-7}$, e em $n=18$ o de Simpson é $7{,}78\times10^{-8}$. Varrendo $n$ com o valor exato, a meta é atingida primeiro em $n=248$ no trapézio ($9{,}97\times10^{-7}$) e em $n=10$ em Simpson ($8{,}15\times10^{-7}$).

### Exemplo 4: onde o trapézio é exato e Simpson erra

A curva ROC de `evaluation-metrics-precision-recall-and-roc`, construída a partir de uma amostra finita com escores distintos, é uma poligonal. Ordene dez exemplos por escore, com rótulos $1,1,0,1,1,0,1,0,0,0$ (cinco positivos, cinco negativos). A regra do trapézio pelos pontos da ROC dá AUC $=0{,}84$, que é igual à fração de pares positivo-negativo ordenados corretamente, calculada em separado. Ela é exata porque a regra integra cada segmento de reta sem erro. Passar os mesmos pontos a `scipy.integrate.simpson` devolveu $0{,}68$ sem nenhum aviso (SciPy 1.15.3): a curva tem segmentos verticais, então $x$ se repete, e uma parábola por esses pontos não significa nada. A regra de ordem mais alta é a ferramenta errada para dados que não são suaves.

### Exemplo 5: conferindo com as bibliotecas

Em $e^x$ com $n=10$ e $n=100$, as duas funções acima concordam com `scipy.integrate.trapezoid` e `scipy.integrate.simpson` dentro de $4{,}5\times10^{-16}$.

Livro vs hoje: os livros dizem que $n$ deve ser par, o que significa um número ímpar de amostras. `scipy.integrate.simpson` também aceita um número par de amostras e trata o intervalo que sobra com uma correção. Com 12 amostras a ordem fica perto de 4 (medida: $3{,}96$), mas a exatidão para cúbicas some: em $x^3$ o erro é $1{,}7\times10^{-5}$ com 12 amostras e $0$ com 11. Código antigo chama `scipy.integrate.trapz` e `simps`, que não existem mais no SciPy, e `numpy.trapz`, que foi depreciada no NumPy 2.0 e removida no 2.4 em favor de `numpy.trapezoid`.

## Equívocos Comuns e Armadilhas

- **"Simpson é sempre mais precisa que o trapézio."** Ela tem ordem maior em integrandos $C^4$. Em $\sqrt x$ as ordens empatam, num integrando suave e periódico o trapézio vence, e num degrau em $x=\tfrac13$ com $n=64$ o erro de Simpson ($5{,}2\times10^{-3}$) é o dobro do erro do trapézio ($2{,}6\times10^{-3}$).
- **"Uma parábola só pode ser exata para parábolas."** Simpson é exata para cúbicas, por simetria.
- **"Dobrar $n$ divide o erro por 16."** Só sob $C^4$ e na faixa assintótica. Em $\sqrt x$ o fator é $2{,}83$, e em float32 pode ficar abaixo de 1.
- **"Grau maior significa mais precisão."** Na função de Runge, grau 20 em nós equiespaçados tem erro $5{,}92$.
- **"A cota é o erro."** É uma garantia, aqui cerca de $2{,}7$ vezes maior para o trapézio em $n=409$.
- **"Simpson precisa de um número par de pontos."** Precisa de um número par de painéis, logo um número ímpar de pontos.

## Resumo

Integrar um interpolante de grau 1 ou 2 dá as regras do trapézio e de Simpson. Para $f\in C^2$ o erro do trapézio composto é $-(b-a)h^2 f''(\xi)/12$, e para $f\in C^4$ o de Simpson composta é $-(b-a)h^4 f^{(4)}(\xi)/180$, com $n$ par. Simpson ganha um grau porque o termo cúbico integra zero. Essas ordens foram medidas em $e^x$ como $2{,}00$ e $4{,}00$, e caem em integrandos sem as derivadas ($1{,}50$ para ambas em $\sqrt x$, cerca de 1 num salto). Elas também podem ser superadas, como faz o trapézio em integrandos suaves e periódicos. Subir o grau de uma única regra equiespaçada diverge na função de Runge, então grau baixo em muitos painéis é a escolha usual. O arredondamento impõe um piso que o float32 mostra com clareza. Um $n$ fixo ainda exige uma cota de derivada que raramente se tem, e esse é o problema que a próxima lição resolve.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.6 Numerical integration](https://fncbook.com/integration): a fórmula do trapézio, seu erro, a expansão de Euler-Maclaurin e a fórmula de Simpson.
- [MIT OCW 18.330, Chapter 2: Integrals as sums and derivatives as differences](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/aab35b69b416758992779e2ad508b286_MIT18_330S12_Chapter2.pdf): regras do retângulo e do trapézio analisadas com expansões de Taylor.
- [SciPy, scipy.integrate.trapezoid](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.trapezoid.html): regra composta do trapézio sobre dados amostrados.
- [SciPy, scipy.integrate.simpson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.simpson.html): regra composta de Simpson sobre dados amostrados, com suas condições de exatidão.
- [NumPy, numpy.trapezoid](https://numpy.org/doc/stable/reference/generated/numpy.trapezoid.html): a função de trapézio do NumPy que substitui `trapz`.
