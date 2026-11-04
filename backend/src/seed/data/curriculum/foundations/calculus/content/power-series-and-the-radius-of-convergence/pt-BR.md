---
version: 1.0
updatedAt: 2026-11-04
title: "Séries de Potências e o Raio de Convergência"
summary: "Séries de potências como funções, o raio e o intervalo de convergência, e derivação e integração termo a termo."
---
## Objetivos de Aprendizagem

- Definir uma série de potências centrada em $a$ e enunciar a tricotomia da convergência: só em $a$, num intervalo simétrico em torno de $a$, ou em toda parte.
- Calcular o raio de convergência com o teste da razão ou da raiz e depois testar os dois extremos separadamente com os testes de `convergence-tests`.
- Explicar por que uma série de potências só é igual à sua "forma fechada" dentro do intervalo de convergência, mesmo quando a forma fechada está definida mais longe.
- Enunciar quando a derivação e a integração termo a termo são válidas e mostrar como o comportamento nos extremos pode mudar.
- Ler o raio como a taxa de crescimento exponencial dos coeficientes, e obtê-lo a partir do denominador de uma função geradora como a de Fibonacci.

## Contexto e Motivação

Uma série de potências é uma série com uma variável dentro:

$$\sum_{n=0}^{\infty} c_n (x-a)^n = c_0 + c_1(x-a) + c_2(x-a)^2 + \cdots$$

Para cada $x$ fixo é uma série numérica comum, então valem os testes de `convergence-tests`. A pergunta nova é para quais $x$ a série converge, porque a resposta define o domínio de uma nova função $f(x)$. Polinômios são o caso em que só finitos $c_n$ são não nulos; uma série de potências é "um polinômio de grau infinito", e muitas funções importantes na prática, como $e^x$, $\sin x$ e $\ln(1+x)$, podem ser escritas assim. A próxima lição, `taylor-and-maclaurin-series-with-error-bounds`, mostra como achar os coeficientes e quão precisa é uma truncagem.

Séries de potências importam em computação de duas formas. Na parte numérica, uma série de potências truncada é um tipo de aproximação polinomial (polinômios de Chebyshev, minimax e de interpolação são outros), e para ela o intervalo de convergência decide onde a aproximação é confiável. Na parte combinatória, uma sequência $c_n$ pode ser empacotada numa função geradora $\sum c_n x^n$. O raio de convergência dessa função informa então quão rápido $c_n$ cresce. Para uma recorrência linear, a função geradora é racional, e seu raio vem das raízes do denominador.

## Teoria Central

### A tricotomia da convergência

Para uma série de potências $\sum c_n (x-a)^n$, vale exatamente uma das opções:

1. Converge só em $x = a$ (raio $R = 0$).
2. Converge absolutamente para todo $x$ real (raio $R = \infty$).
3. Existe um número $0 < R < \infty$ tal que converge absolutamente para $\lvert x - a\rvert < R$ e diverge para $\lvert x - a\rvert > R$.

O conjunto dos $x$ em que converge é o **intervalo de convergência**: $(a-R, a+R)$ mais, possivelmente, um ou os dois extremos. O teorema não diz nada sobre os extremos $x = a \pm R$. Eles precisam ser verificados um a um, e as quatro combinações acontecem.

### Calculando o raio

Aplique o teste da razão aos termos da série em $x$, e não só aos coeficientes. Se $\lim \lvert c_{n+1}/c_n\rvert = \rho$ existe, os termos têm razão $\rho\,\lvert x-a\rvert$, que é menor que $1$ exatamente quando $\lvert x-a\rvert < 1/\rho$, então $R = 1/\rho$ (com $R = \infty$ se $\rho = 0$ e $R = 0$ se $\rho = \infty$). O teste da raiz dá a fórmula geral, que sempre se aplica:

$$R = \frac{1}{\limsup_{n\to\infty} \lvert c_n\rvert^{1/n}}$$

Aplicar o teste da razão aos coeficientes falha em silêncio quando infinitos $c_n$ são zero, por exemplo em $\sum x^{2n+1}/(2n+1)$, onde $c_{2n} = 0$. Nesse caso, rode o teste da razão nos termos completos, como faz o Exemplo 2.

### Os extremos

Em $x = a \pm R$, os testes da razão e da raiz dão $L = 1$ e são inconclusivos. Substitua o extremo para obter uma série numérica comum e use o teste da divergência, a comparação, o teste da integral ou o da série alternada. Por exemplo, $\sum x^n$ tem $R=1$ e diverge nos dois extremos (os termos não tendem a $0$); $\sum x^n/n$ converge em $-1$ e diverge em $1$; $\sum x^n/n^2$ converge nos dois.

### Uma série de potências só é função dentro do seu intervalo

Dentro do intervalo de convergência, $f(x) = \sum c_n (x-a)^n$ é uma função. A série geométrica é o modelo: $\sum_{n\ge0} x^n = \frac{1}{1-x}$ para $\lvert x\rvert < 1$. O lado direito está definido para todo $x \ne 1$, mas em $x = -3$ a série é $1 - 3 + 9 - 27 + \cdots$, que diverge, embora $\frac1{1-(-3)} = \frac14$. A igualdade vale no intervalo de convergência e em nenhum outro lugar.

### Derivando e integrando termo a termo

Suponha que $f(x) = \sum c_n (x-a)^n$ tem raio $R > 0$. Então, **para $\lvert x-a\rvert < R$ (o intervalo aberto)**, $f$ é derivável e

$$f'(x) = \sum_{n\ge 1} n c_n (x-a)^{n-1}, \qquad \int f(x)\,dx = C + \sum_{n\ge0} \frac{c_n}{n+1}(x-a)^{n+1}.$$

As duas novas séries têm o mesmo raio $R$. Os extremos podem mudar, porque os fatores $n$ e $1/(n+1)$ alteram a velocidade com que os termos decaem. Séries de potências são especiais nisso: para uma série de funções qualquer, derivar termo a termo não é permitido. Para $\sum \sin(nx)/n^2$, que converge para todo $x$ por comparação com $\sum 1/n^2$, a série derivada $\sum \cos(nx)/n$ é a série harmônica em $x = 0$ e diverge.

### Combinando séries de potências

Somas e múltiplos constantes são termo a termo, e o resultado converge pelo menos onde as duas convergem dentro dos intervalos abertos, então o raio é pelo menos o menor dos dois raios. O produto se calcula com o produto de Cauchy, $\sum_n \big(\sum_{k=0}^n a_k b_{n-k}\big) x^n$, e o produto tem raio pelo menos igual ao menor dos dois raios. A convergência num extremo não é herdada: $a_n = (-1)^n/\sqrt{n+1}$ dá uma série que converge em $x=1$, mas o quadrado de Cauchy tem coeficientes de módulo $\sum_{k=0}^n 1/\sqrt{(k+1)(n-k+1)}$, que vale $2{,}29$ em $n=10$, $2{,}85$ em $n=100$ e $3{,}05$ em $n=1000$ (tendendo a $\pi$), então o produto diverge em $x=1$. Substituir $x \mapsto x^2$ ou $x \mapsto 2x$ numa série muda o intervalo de acordo: $\sum (2x)^n$ converge para $\lvert x\rvert < \tfrac12$. Os coeficientes de uma série de potências são determinados pela função: $c_n = f^{(n)}(a)/n!$ (segue de derivar termo a termo e avaliar em $a$), que é o ponto de partida da próxima lição.

## Exemplos Resolvidos

### Exemplo 1: centro deslocado e extremos de lados diferentes

Ache o intervalo de convergência de $\sum_{n\ge1} \dfrac{(-1)^n (x+3)^n}{\sqrt n\,4^n}$. A razão entre termos consecutivos tem módulo $\frac{\lvert x+3\rvert}{4}\sqrt{\frac{n}{n+1}} \to \frac{\lvert x+3\rvert}{4}$ (o teste da raiz dá o mesmo $\tfrac14$ para os coeficientes), então $R = 4$ e o intervalo aberto é $(-7, 1)$, centrado em $-3$.

Em $x = 1$ a série é $\sum (-1)^n/\sqrt n$, que converge pelo teste da série alternada (soma cerca de $-0{,}605$). Em $x = -7$ é $\sum 1/\sqrt n$, uma série $p$ com $p=\tfrac12$, que diverge (as somas parciais são $18{,}6$, $198{,}5$ e $1998{,}5$ com $10^2$, $10^4$ e $10^6$ termos). O intervalo de convergência é $(-7, 1]$. Fora dele, em $x=2$ os módulos dos termos $(5/4)^n/\sqrt n$ crescem sem limite, então vale o teste da divergência.

### Exemplo 2: convergindo nos dois extremos, e o arco tangente

Considere $\sum_{n\ge0} (-1)^n \dfrac{x^{2n+1}}{2n+1}$. Metade dos coeficientes é zero, então rode o teste da razão nos termos: $\left\lvert \frac{x^{2n+3}/(2n+3)}{x^{2n+1}/(2n+1)}\right\rvert \to x^2$, que é menor que $1$ para $\lvert x\rvert<1$, logo $R = 1$.

Em $x = \pm1$ a série é $\pm\sum (-1)^n/(2n+1)$, que converge pelo teste da série alternada, então o intervalo é $[-1,1]$. Essa série é $\arctan x$. Em $x=1$ ela dá $\arctan 1 = \pi/4$ (esse passo precisa do teorema de Abel: se uma série de potências converge num extremo do intervalo, o valor da função ali é o limite da série quando $x$ se aproxima do extremo por dentro). A convergência no extremo é lenta: a cota alternada $\lvert R_N\rvert \le 1/(2N+3)$ tem a ordem de grandeza certa, embora o erro real seja cerca de metade da cota. Somando até $n=10^5$ (isto é, $10^5+1$ termos), o erro é $2{,}5\times10^{-6}$ contra a cota $5{,}0\times10^{-6}$, por isso $\pi \approx 4\,(1 - \tfrac13 + \tfrac15 - \cdots)$ é uma forma ruim de calcular $\pi$. Para $x = 0{,}5$ a mesma série dá $\arctan 0{,}5 = 0{,}4636476\ldots$ com cerca de vinte dígitos usando 31 termos (até $n=30$).

### Exemplo 3: derivar muda o extremo

Seja $f(x) = \sum_{n\ge1} x^n/n^2$, com intervalo $[-1,1]$ (em $x=1$ vale $\pi^2/6$ e em $x=-1$ vale $-\pi^2/12$, ambas convergentes por comparação com $\sum1/n^2$). Derivando termo a termo, $f'(x) = \sum_{n\ge 1} x^{n-1}/n$, com o mesmo raio $1$. Em $x = 1$ é a série harmônica, que diverge; em $x=-1$ é $\sum(-1)^{n-1}/n = \ln 2$, que converge. O intervalo encolhe de $[-1,1]$ para $[-1,1)$.

Integrando a série geométrica $\sum t^n = \frac1{1-t}$ de $0$ a $x$ obtém-se $-\ln(1-x) = \sum_{n\ge1} x^n/n$ para $\lvert x\rvert<1$, e o teorema de Abel estende isso a $x=-1$, dando $-\ln 2 = -1 + \tfrac12 - \tfrac13 + \cdots$. Como conferência numérica, $f'(0{,}5) = \sum_{n\ge1}(0{,}5)^{n-1}/n = 1{,}3862944$, igual a $-\ln(0{,}5)/0{,}5$ e à inclinação de $f$ por diferenças finitas.

### Exemplo 4: o raio como taxa de crescimento (Fibonacci)

Os números de Fibonacci $F_0=0, F_1=1, F_2=1, F_3 = 2, \ldots$ satisfazem $\sum_{n\ge0} F_n x^n = \dfrac{x}{1-x-x^2}$ perto de $x=0$ (expandir o lado direito dá $x + x^2 + 2x^3 + 3x^4 + 5x^5 + 8x^6 + \cdots$). O denominador fatora como $1-x-x^2 = (1-\varphi x)(1-\psi x)$ com $\varphi = \frac{1+\sqrt5}{2} = 1{,}618034$ e $\psi = \frac{1-\sqrt5}{2} = -0{,}618034$, e as frações parciais dão

$$\frac{x}{1-x-x^2} = \frac{1}{\sqrt5}\left(\frac{1}{1-\varphi x} - \frac{1}{1-\psi x}\right).$$

Cada fração é uma série geométrica, convergente para $\lvert \varphi x\rvert < 1$ e $\lvert \psi x\rvert < 1$, respectivamente. A primeira é a condição que manda, porque $\lvert\varphi\rvert > \lvert\psi\rvert$, então $R = 1/\varphi = 0{,}618034$, a menor raiz do denominador em módulo (as raízes são $0{,}618$ e $-1{,}618$). Lendo os coeficientes, $F_n = (\varphi^n - \psi^n)/\sqrt5$, logo $F_n^{1/n} \to \varphi = 1/R$: o raio e a taxa de crescimento exponencial são o mesmo fato. O teste da razão concorda, já que $F_{n+1}/F_n \to \varphi$.

Nos extremos $x = \pm R$ os termos cumprem $\lvert F_n R^n\rvert = \lvert 1 - (\psi/\varphi)^n\rvert/\sqrt5 \to 1/\sqrt5 = 0{,}4472 \ne 0$, então pelo teste da divergência os dois extremos divergem: o intervalo é o aberto $(-0{,}618, 0{,}618)$. Dentro, em $x = \tfrac12$ a série soma $2$, igual a $\frac{0{,}5}{1-0{,}5-0{,}25}$. Fora, em $x = 0{,}7$, onde a fórmula dá $-3{,}68$, as somas parciais disparam: $9{,}6$ até o termo $x^{10}$, $42$ até $x^{20}$, $553$ até $x^{40}$ e $81\,061$ até $x^{80}$.

### Exemplo 5: o raio não depende de onde a função está definida

$\dfrac1{1+x^2} = \sum_{n\ge0}(-1)^n x^{2n}$ tem raio $1$, embora a função seja suave para todo $x$ real. Em $x = 0{,}9$ a série converge ($0{,}5525$, igual a $1/1{,}81$). Em $x = 1{,}1$, onde $1/(1+x^2) = 0{,}4525$, as somas parciais são $1{,}63$, $-2{,}59$ e $-20{,}03$ com $5$, $10$ e $20$ termos (até $x^{8}$, $x^{18}$ e $x^{38}$), e continuam crescendo em módulo. O obstáculo está em $x = \pm i$, dois pontos do plano complexo a distância $1$ do centro, que o gráfico real nunca mostra. Em $x=\pm1$ os termos são $(-1)^n$, que não tendem a $0$, então vale o teste da divergência.

## Equívocos Comuns e Armadilhas

- **"O intervalo de convergência é $(a-R, a+R)$."** Esse é o intervalo em que a convergência absoluta é garantida; se os extremos pertencem a ele é outra questão. Cada extremo é uma pergunta à parte, e os testes da razão e da raiz não a respondem.
- **"Se a função está definida em $x$, a série converge ali."** O Exemplo 5 e a série geométrica discordam: a série reproduz a função só dentro do intervalo.
- **"O teste da razão nos coeficientes sempre funciona."** Falha quando há infinitos coeficientes nulos. Use os termos, ou a fórmula do teste da raiz.
- **"Derivar preserva o intervalo."** O raio é preservado; os extremos podem não ser (Exemplo 3).
- **"O raio é determinado pelo ponto em que a função tem problema na reta real."** O Exemplo 5 mostra uma função suave em toda a reta com raio $1$.
- **"O raio de uma soma é o menor dos dois raios."** É pelo menos o menor, e pode ser maior: $\sum x^n - \sum x^n$ é identicamente $0$, com $R=\infty$.

## Resumo

Uma série de potências $\sum c_n (x-a)^n$ converge num intervalo centrado em $a$ com raio $R = 1/\limsup\lvert c_n\rvert^{1/n}$. Converge absolutamente por dentro, diverge por fora, e cada extremo precisa ser testado à parte (com os testes da divergência, de comparação, da integral ou da série alternada), onde os quatro desfechos são possíveis. Uma série de potências só é igual à função associada dentro do intervalo. No intervalo aberto ela pode ser derivada e integrada termo a termo com o mesmo raio, mas o comportamento nos extremos pode mudar. O raio também mede o crescimento dos coeficientes, como mostra a função geradora de Fibonacci, e pode ser limitado por singularidades que vivem no plano complexo. A próxima lição, `taylor-and-maclaurin-series-with-error-bounds`, constrói essas séries a partir das derivadas de uma função e quantifica o erro de cortá-las.

## Documentation Links

- [OpenStax Calculus Volume 2, 6.1 Power Series and Functions](https://openstax.org/books/calculus-volume-2/pages/6-1-power-series-and-functions): séries de potências, raio e intervalo de convergência e a tricotomia da convergência.
- [OpenStax Calculus Volume 2, 6.2 Properties of Power Series](https://openstax.org/books/calculus-volume-2/pages/6-2-properties-of-power-series): combinação de séries de potências e derivação e integração termo a termo.
- [MIT OpenCourseWare 18.01SC, Session 97: Power Series](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-97-power-series/): séries de potências como funções e seus intervalos de convergência.
