---
version: 1.0
updatedAt: 2026-11-04
title: "Iteração de Ponto Fixo"
summary: "A iteração de ponto fixo, a condição de contração sobre a derivada que decide a convergência e como reescrever a mesma equação muda o resultado."
---
## Objetivos de Aprendizagem

- Reescrever $f(x) = 0$ como $x = g(x)$ de mais de uma forma e rodar a iteração $x_{n+1} = g(x_n)$.
- Enunciar o teorema da contração com todas as hipóteses, provar a convergência com o Teorema do Valor Médio e mostrar com exemplos o que cada hipótese garante.
- Prever a taxa linear $\lvert g'(r)\rvert$, medi-la e classificar um ponto fixo como atrator, repulsor ou indefinido.
- Explicar por que reescrever a mesma equação muda o resultado, e usar relaxação para consertar uma iteração que falha.
- Transformar o tamanho do passo numa estimativa de erro, e reconhecer o ponto em que o arredondamento para a iteração.

## Contexto e Motivação

`bisection-and-convergence-rate` compra um bit por avaliação e pede apenas uma troca de sinal, e esse teste de sinal não tem análogo direto para um sistema de equações. Um padrão mais amplo está por trás de boa parte da computação iterativa: transformar o problema em $x = g(x)$ e aplicar $g$ repetidamente. `newtons-method` é uma dessas $g$. `iterative-methods-jacobi-and-gauss-seidel` aplica o padrão a sistemas lineares. A atualização em `value-iteration-and-policy-iteration` é outra: com desconto $\gamma < 1$, a atualização de Bellman é uma contração de fator $\gamma$ na norma do máximo, e é por isso que os valores se estabilizam.

O assunto inteiro gira em torno de um número. Perto de uma solução, $g$ se comporta como uma reta de inclinação $g'(r)$, e cada passo multiplica o erro por essa inclinação. Inclinação menor que $1$ em módulo significa convergência, maior que $1$ significa fuga, e a inclinação depende de como a equação foi escrita, não só de qual equação ela é.

## Teoria Central

### De raízes a pontos fixos

Um **ponto fixo** de $g$ é um número $r$ com $g(r) = r$. No gráfico, é um cruzamento de $y = g(x)$ com $y = x$. Qualquer equação $f(x) = 0$ pode ser escrita assim, por exemplo como $g(x) = x - \lambda f(x)$ com $\lambda \ne 0$, cujos pontos fixos são exatamente as raízes de $f$. Outros rearranjos também são possíveis, e podem mudar o domínio.

### O teorema da contração

Seja $g$ contínua em $[a, b]$ e derivável em $(a, b)$.

**Existência.** Se $g$ leva $[a, b]$ em si mesmo, $g$ tem um ponto fixo ali. Seja $h(x) = g(x) - x$. Então $h(a) \ge 0$ e $h(b) \le 0$, e o Teorema do Valor Intermediário se aplica.

**Unicidade e convergência.** Se além disso $\lvert g'(x)\rvert \le L < 1$ em $(a, b)$, o ponto fixo $r$ é único e todo $x_0 \in [a, b]$ gera uma sequência com

$$\lvert x_n - r\rvert \le L^n\lvert x_0 - r\rvert, \qquad \lvert x_n - r\rvert \le \frac{L^n}{1-L}\lvert x_1 - x_0\rvert, \qquad \lvert x_n - r\rvert \le \frac{L}{1-L}\lvert x_n - x_{n-1}\rvert.$$

A prova é o Teorema do Valor Médio (`the-mean-value-theorem-and-monotonicity`): $\lvert x_{n+1} - r\rvert = \lvert g(x_n) - g(r)\rvert = \lvert g'(\xi_n)\rvert\,\lvert x_n - r\rvert \le L\lvert x_n - r\rvert$, e a hipótese de levar o intervalo em si mesmo mantém todo $x_n$ dentro dele. As outras duas cotas saem da desigualdade triangular.

Retirar uma hipótese tem um custo específico:

- **Continuidade.** $g(x) = 1$ para $x \le \tfrac12$ e $g(x) = 0$ para $x > \tfrac12$ leva $[0, 1]$ em si mesmo e não tem ponto fixo. A partir de $x_0 = 0{,}3$ as iterações alternam entre $1$ e $0$.
- **Levar o intervalo em si mesmo.** $g(x) = \tfrac12 x + 2$ em $[0, 1]$ tem $\lvert g'\rvert = \tfrac12$ e nenhum ponto fixo ali, porque seu ponto fixo $4$ está fora.
- **Uma cota para a inclinação.** $g(x) = x^2$ em $[0, 1]$ leva o intervalo em si mesmo, mas $g'$ chega a $2$, e tanto $0$ quanto $1$ são fixos, então a unicidade se perde.
- **Um $L < 1$ uniforme.** Num $[a, b]$ limitado, pedir só $\lvert g'(x)\rvert < 1$ em cada ponto ainda dá unicidade e convergência. O que some é a taxa $L^n$. $g(x) = \sin x$ em $[0, 1]$ tem $g'(x) = \cos x < 1$ em $(0, 1)$, mas $\cos x \to 1$ em $0$, então nenhum $L$ serve, e a partir de $x_0 = 1$ ela chega só a $x_{10^6} = 1{,}73\times10^{-3}$, acompanhando $\sqrt{3/n}$. Num intervalo ilimitado até a existência pode falhar. $g(x) = x + 1/x$ em $[1, \infty)$ leva o intervalo em si mesmo com $0 \le g'(x) < 1$ e não tem ponto fixo. A partir de $x_0 = 1$, $x_{10000} = 141{,}44$, acompanhando $\sqrt{2n} = 141{,}42$.
- **Derivabilidade.** Esta é uma conveniência. A prova usa só $\lvert g(x) - g(y)\rvert \le L\lvert x - y\rvert$, que $g(x) = \lvert x\rvert/2$ em $[-1, 1]$ satisfaz com $L = \tfrac12$ apesar do bico em $0$.
- **Global contra local.** $g(x) = x^2$ tem um ponto fixo atrator em $0$ e um repulsor em $1$. A partir de $x_0 = 0{,}9$ as iterações chegam a $1{,}9\times10^{-12}$ em 8 passos. A partir de $x_0 = 1{,}1$ chegam a $3{,}9\times10^{10}$.

### Comportamento perto de um ponto fixo

Se $g'$ é contínua perto de $r$ e $\lvert g'(r)\rvert < 1$, algum intervalo em torno de $r$ satisfaz o teorema, então a iteração converge para $x_0$ perto o bastante. Se além disso $g'(r) \ne 0$ e nenhuma iteração cai em $r$, então

$$\frac{\lvert x_{n+1} - r\rvert}{\lvert x_n - r\rvert} \longrightarrow \lvert g'(r)\rvert.$$

A convergência é linear com taxa $\rho = \lvert g'(r)\rvert$, o que dá $\log_2(1/\rho)$ bits por iteração. Por avaliação, isso supera o bit único da bisseção só quando $\rho < \tfrac12$. Inclinação positiva se aproxima por um lado, e inclinação negativa alterna em torno de $r$. Os outros casos:

- $\lvert g'(r)\rvert > 1$: repulsor. A sequência não pode convergir para $r$, a menos que caia exatamente nele. Ela não precisa explodir: $g(x) = 3{,}2x(1-x)$ tem $r = 0{,}6875$ com $g'(r) = -1{,}2$, e as iterações a partir de $0{,}3$ se acomodam no ciclo de período 2 entre $0{,}5130$ e $0{,}7995$.
- $\lvert g'(r)\rvert = 1$: este teste não decide nada. $\sin x$ converge para $0$ bem devagar, enquanto $x + x^3$ foge de $0$ (a partir de $x_0 = 0{,}1$ passa de $10^6$ no passo 57).
- $g'(r) = 0$ com $g''$ contínua: pelo menos segunda ordem, $e_{n+1} \approx \tfrac12\lvert g''(r)\rvert e_n^2$.

### Reescrita e relaxação

Dois rearranjos da mesma equação compartilham raízes, mas em geral não inclinações. Se $g$ tem inversa perto de $r$, então $g^{-1}$ tem o mesmo ponto fixo com inclinação $1/g'(r)$, então inverter troca atrator por repulsor. A **relaxação** ajusta a inclinação diretamente:

$$g_\omega(x) = (1-\omega)x + \omega\, g(x), \qquad \omega \ne 0,$$

mantém os pontos fixos e tem $g_\omega'(r) = 1 - \omega + \omega g'(r)$, que se anula em $\omega = 1/(1 - g'(r))$ quando $g'(r) \ne 1$.

### Parada e arredondamento

Perto de $r$, linearizar dá

$$\lvert x_{n+1} - r\rvert \approx \frac{\lvert g'(r)\rvert}{\lvert 1 - g'(r)\rvert}\,\lvert x_{n+1} - x_n\rvert.$$

Uma inclinação perto de $+1$ torna esse fator grande, então passo pequeno não quer dizer erro pequeno, enquanto uma inclinação perto de $-1$ o deixa em torno de $\tfrac12$. A razão entre passos sucessivos estima a inclinação. Um ruído de tamanho $\delta$ ao avaliar $g$ desloca o ponto fixo em cerca de $\delta/\lvert 1 - g'(r)\rvert$, que é o condicionamento do problema de ponto fixo.

## Exemplos Resolvidos

### Exemplo 1: uma equação, três iterações

Resolva $x = e^{-x}$, com raiz $r = 0{,}5671432904$.

**(a) $g_1(x) = e^{-x}$.** Ela leva $[0{,}4, 0{,}7]$ em $[0{,}4966, 0{,}6703]$, com $\lvert g_1'\rvert \le 0{,}6703$ ali, então o teorema se aplica. A taxa prevista é $\lvert g_1'(r)\rvert = r = 0{,}5671$. A partir de $x_0 = 0{,}5$:

```text
n    x_n                  e_n        e_n/e_(n-1)
0    0.5                  6.71e-02
1    0.6065306597126334   3.94e-02   0.5866
2    0.545239211892605    2.19e-02   0.5561
5    0.5711721489772151   4.03e-03   0.5692
10   0.5669072129354714   2.36e-04   0.5670
20   0.5671424775509449   8.13e-07   0.5671
30   0.5671432876111684   2.80e-09   0.5671
50   0.5671432904097508   3.31e-14   0.5663
62   0.5671432904097838   3.29e-17
```

O erro cai abaixo de $10^{-10}$ pela primeira vez em $n = 36$, como $\ln(10^{-10}/0{,}0671)/\ln 0{,}5671 = 35{,}8$ prevê. Em $n = 62$ a iteração para de mudar. A taxa $0{,}5671$ dá $0{,}82$ bit por iteração contra $1$ da bisseção, e aqui os dois empatam mais ou menos: a bisseção em $[0, 1]$ chega à largura $10^{-10}$ em 34 iterações mais 2 avaliações dos extremos, partindo de mais longe. As grandezas de parada são diferentes, então a comparação é só aproximada. Em float32 a iteração nunca se assenta num valor: de $x_{25}$ em diante ela alterna entre os floats vizinhos $0{,}56714332$ e $0{,}56714326$, com erro em torno de $3\times10^{-8}$.

**(b) $g_2(x) = -\ln x$.** É a inversa de $g_1$, com inclinação $-1/r = -1{,}7632$, e exige $x > 0$. A partir de $0{,}5$ ela dá $0{,}6931$, $0{,}3665$, $1{,}0037$, $-0{,}0037$, e o passo seguinte sai do domínio. Partindo bem mais perto, de $0{,}5671$, o erro $4{,}3\times10^{-5}$ cresce por um fator medido de $1{,}763$ a cada passo, e $x_{18} = -0{,}40$ falha do mesmo jeito.

**(c) $g_2$ relaxada.** Tome $\omega = 1/(1 + 1/r) = 0{,}36190$, de modo que $g_\omega'(r) = 0$. Os erros são $6{,}71\times10^{-2}$, $2{,}76\times10^{-3}$, $4{,}26\times10^{-6}$, $1{,}02\times10^{-11}$, $3{,}29\times10^{-17}$. As razões $e_{n+1}/e_n^2$ são $0{,}611$, $0{,}561$, $0{,}563$, contra $\tfrac12 g_\omega''(r) = \omega/(2r^2) = 0{,}5626$. Escolher $\omega$ assim exige conhecer $r$. Com $\omega = 0{,}5$ a inclinação é $-0{,}38$, e a mesma iteração é apenas linear. Recalcular $\omega$ a partir do $x$ atual em cada passo dá o método de Newton em $x + \ln x$, assunto de `newtons-method`.

### Exemplo 2: a equação de Kepler

A posição de um corpo numa órbita elíptica vem de $E - e\sin E = M$, com excentricidade $0 \le e < 1$ e anomalia média $M$. Tome $g(E) = M + e\sin E$. Ela leva $[M-e, M+e]$ em si mesmo, e $\lvert g'(E)\rvert = \lvert e\cos E\rvert \le e$, então o teorema se aplica com $L = e$ a partir de $E_0 = M$.

```text
e      M     E*         g'(E*)    taxa medida   iterações até 1e-10   cota a priori
0.1    1.0   1.088598   +0.0464   0.0464        7                     9
0.5    1.0   1.498701   +0.0360   0.0360        8                     33
0.9    1.0   1.862087   -0.2585   0.2585        17                    238
0.97   0.2   1.033148   +0.4968   0.4968        36                    818
```

A cota a priori é o menor $n$ com $e^n\lvert x_1 - x_0\rvert/(1-e) \le 10^{-10}$. Ela vale em toda linha e é bem pessimista para $e$ grande, porque $L = e$ é a pior inclinação possível em qualquer ponto, enquanto a taxa depende da inclinação na raiz. Uma execução de `scipy.optimize.brentq` em $[0, \pi]$ concorda com cada $E^*$ a menos de $4\times10^{-13}$.

### Exemplo 3: um passo pequeno, um erro grande

Tome $e = 0{,}999$ e $M = 0{,}002$, de modo que $E^* = 0{,}22045$ e $g'(E^*) = 0{,}97482$. Parar quando o passo fica abaixo de $10^{-8}$ termina em $n = 573$ com passo $9{,}91\times10^{-9}$ e erro verdadeiro $3{,}84\times10^{-7}$, que é 39 vezes o passo. O fator da teoria é $0{,}97482/0{,}02518 = 38{,}7$. Usando a razão dos dois últimos passos como estimativa $\hat L$, o valor $\hat L/(1-\hat L)$ vezes o passo dá $3{,}84\times10^{-7}$, então a própria iteração forneceu uma estimativa confiável.

Deixada rodar, a iteração para de mudar em $n = 1371$ com erro $4{,}1\times10^{-16}$. Para $e = 0{,}1$, $M = 1$ ela para em $n = 12$ com erro $4{,}3\times10^{-17}$. A amplificação $1/\lvert 1 - g'(r)\rvert$ é $39{,}7$ no primeiro caso e $1{,}05$ no segundo.

## Equívocos Comuns e Armadilhas

- **"Qualquer rearranjo serve, já que as raízes são as mesmas."** O Exemplo 1 tem um que converge, um que falha e um que é quadrático.
- **"$\lvert g'(r)\rvert < 1$ significa convergência de qualquer ponto."** É uma afirmação local, como $x^2$ a partir de $1{,}1$ mostra. A convergência global exige o teorema completo.
- **"$\lvert g'\rvert < 1$ em toda parte garante um ponto fixo."** Num intervalo ilimitado, não: $x + 1/x$ em $[1, \infty)$ não tem nenhum. Num $[a, b]$ limitado, o ponto fixo vem da continuidade e de levar o intervalo em si mesmo, não da inclinação.
- **"Passo pequeno quer dizer erro pequeno."** Com $g(x) = \sin x$ a partir de $x_0 = 1$, depois de $10^6$ passos o passo é $8{,}7\times10^{-10}$ e o erro é $1{,}7\times10^{-3}$. Inclinação $1$ na raiz não deixa fator finito entre os dois.
- **"Não convergir é divergir."** A aplicação logística acima fica limitada num ciclo de período 2.
- **"Pare quando `x_new == x`."** A execução em float32 do Exemplo 1 alterna para sempre e nunca pararia. Use uma tolerância e um limite de iterações.
- **"`scipy.optimize.fixed_point` roda a iteração desta lição."** Seu padrão `method='del2'` usa o método de Steffensen com aceleração de Aitken. O laço simples é `method='iteration'`.

## Resumo

A iteração de ponto fixo reescreve $f(x) = 0$ como $x = g(x)$ e repete $x_{n+1} = g(x_n)$. Se $g$ é contínua em $[a, b]$, leva o intervalo em si mesmo e satisfaz $\lvert g'\rvert \le L < 1$, o ponto fixo é único, todo início no intervalo converge e o erro encolhe pelo menos como $L^n$. Perto de um ponto fixo a taxa observada tende a $\lvert g'(r)\rvert$, então uma inclinação abaixo de $\tfrac12$ em módulo supera a bisseção, inclinação $0$ dá segunda ordem, inclinação acima de $1$ repele, e inclinação exatamente $1$ pede um exame mais de perto. A inclinação é da reescrita, e é por isso que inverter ou relaxar $g$ pode transformar falha em convergência rápida. O erro é cerca de $\lvert g'\rvert/\lvert 1 - g'\rvert$ vezes o passo, o que pesa quando a inclinação está perto de $+1$, e o arredondamento para a iteração perto de $\delta/\lvert 1 - g'(r)\rvert$.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.2 Fixed-point iteration](https://fncbook.com/fixed-point): a iteração, a análise do erro por séries, a taxa linear e as aplicações de contração.
- [Fundamentals of Numerical Computation, 4.1 The rootfinding problem](https://fncbook.com/rootproblem): a equação de Kepler em contexto e o condicionamento de uma raiz.
- [SciPy documentation, scipy.optimize.fixed_point](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.fixed_point.html): os métodos `del2` e `iteration` e seus parâmetros.
- [SciPy documentation, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): o solver com confinamento usado como conferência independente.
