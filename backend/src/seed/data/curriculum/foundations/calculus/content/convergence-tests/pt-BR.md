---
version: 1.0
updatedAt: 2026-11-04
title: "Testes de Convergência"
summary: "Os testes da comparação, da integral, da razão, da raiz e da série alternada, convergência absoluta versus condicional, e como escolher um teste para uma série dada."
---
## Objetivos de Aprendizagem

- Enunciar os testes da divergência, da integral, de comparação, de comparação no limite, da série alternada, da razão e da raiz com todas as hipóteses, dizendo o que cada um conclui em cada caso.
- Reconhecer quando um teste é inconclusivo e citar uma série de cada lado da fronteira que prova isso (por exemplo $\sum 1/n$ e $\sum 1/n^2$ para o teste da razão).
- Mostrar, numa série concreta, por que remover uma hipótese (positividade, monotonicidade, um limite que de fato existe) pode fazer o teste dar a resposta errada.
- Distinguir convergência absoluta de condicional e explicar por que reordenar uma série condicionalmente convergente pode mudar a soma.
- Usar o teste da integral e o da série alternada para limitar o erro que sobra depois de $N$ termos, e escolher um teste para uma série dada.

## Contexto e Motivação

A maioria das séries infinitas não tem fórmula fechada para as somas parciais. A série geométrica e as somas telescópicas de `infinite-series-and-partial-sums` são exceções, então a pergunta usual não é "qual é a soma?", e sim "ela converge?". Os testes desta lição respondem sem calcular a soma, e os que trazem cotas de erro dizem também o quanto uma soma truncada pode estar longe do valor verdadeiro.

Em computação isso importa porque um programa só soma finitos termos, e uma soma parcial sozinha não decide a convergência. A série $\sum_{n\ge 2} 1/(n\ln n)$ diverge, mas a soma parcial até $n = 10^7$ é só cerca de $3{,}57$. Olhando os números, qualquer um suspeitaria de um limite que não existe. Os testes de convergência são o argumento que substitui o palpite numérico.

Séries também aparecem na análise de algoritmos. O custo esperado do quicksort envolve os números harmônicos $H_n = \sum_{k=1}^n 1/k$, cujo crescimento como $\ln n$ vem do teste da integral. A cota linear para construir um heap binário se reduz a $\sum_{h\ge 1} h/2^h$, série que o teste da razão aceita e cuja soma é exatamente $2$.

## Teoria Central

Daqui em diante, $S_N = \sum_{n=1}^{N} a_n$ é a soma parcial e $R_N = S - S_N$ é o resto quando a série converge para $S$.

### O teste da divergência

Se $\sum a_n$ converge, então $a_n \to 0$. Equivalentemente: se $a_n$ não tende a $0$ (inclusive quando o limite não existe), a série diverge. O teste só consegue provar divergência. A série harmônica $\sum 1/n$ tem $a_n \to 0$ e mesmo assim diverge, então $a_n \to 0$ é inconclusivo.

### O teste da integral

Hipóteses: $f$ é contínua, positiva e decrescente em $[N, \infty)$, e $a_n = f(n)$ para $n \ge N$. Conclusão: $\sum_{n\ge N} a_n$ e $\int_N^\infty f(x)\,dx$ ou convergem as duas ou divergem as duas. Quando convergem, o resto fica preso entre duas integrais:

$$\int_{N+1}^{\infty} f(x)\,dx \;\le\; R_N \;\le\; \int_{N}^{\infty} f(x)\,dx$$

Para séries $p$, $\int_1^\infty x^{-p}\,dx$ converge exatamente quando $p > 1$, então $\sum 1/n^p$ converge exatamente quando $p > 1$. As hipóteses não são enfeite. Tome $f(x) = \sin^2(\pi x)$: ela é contínua e não negativa, mas não é decrescente. Então $a_n = \sin^2(\pi n) = 0$ para todo inteiro $n$, a série converge para $0$, enquanto $\int_1^M \sin^2(\pi x)\,dx = (M-1)/2$ para $M$ inteiro, o que cresce sem limite. Os dois se comportam de modo diferente porque falta a monotonicidade.

### Testes de comparação

Comparação direta. Hipótese: $0 \le a_n \le b_n$ para todo $n \ge N$. Se $\sum b_n$ converge, $\sum a_n$ também converge; se $\sum a_n$ diverge, $\sum b_n$ também diverge. As outras duas direções não dizem nada: saber que uma série pequena converge, ou que uma grande diverge, não informa sobre a outra. A não negatividade é essencial: $a_n = -1 \le 1/n^2$ vale para todo $n$ e $\sum 1/n^2$ converge, mas $\sum(-1)$ diverge.

Comparação no limite. Hipótese: $a_n > 0$ e $b_n > 0$, e $L = \lim a_n/b_n$ existe com $0 < L < \infty$. Conclusão: as duas séries convergem ou as duas divergem. Se $L = 0$, só sobrevive "$\sum b_n$ converge implica $\sum a_n$ converge"; se $L = \infty$, só sobrevive "$\sum b_n$ diverge implica $\sum a_n$ diverge". Com $b_n = 1/n$ e $a_n = 1/n^2$ temos $L = 0$ e $\sum b_n$ diverge, então nada se conclui, e de fato $\sum a_n$ converge. Trocando os papéis, aparece $L = \infty$ com a mesma moral.

### O teste da série alternada

Hipóteses: a série é $\sum (-1)^n b_n$ com $b_n \ge 0$, $b_n$ decrescente (ao menos a partir de algum índice $n_0$) e $b_n \to 0$. Conclusão: a série converge e o resto satisfaz $\lvert R_N \rvert \le b_{N+1}$ para todo $N$ com $N+1 \ge n_0$, isto é, depois que a monotonicidade começou. As três condições são necessárias. Sem $b_n \to 0$, o teste da divergência derruba a série. Sem monotonicidade, a conclusão pode falhar mesmo com $b_n \to 0$ (veja o Exemplo 4).

### Os testes da razão e da raiz

Teste da razão. Hipótese: $a_n \ne 0$ a partir de algum ponto e $L = \lim \lvert a_{n+1}/a_n \rvert$ existe (possivelmente $\infty$). Se $L < 1$, a série converge absolutamente; se $L > 1$ (ou $L = \infty$), diverge; se $L = 1$, o teste é inconclusivo.

Teste da raiz. Hipótese: $L = \limsup \lvert a_n \rvert^{1/n}$, que sempre existe em $[0,\infty]$. Os três casos são os mesmos do teste da razão, e de novo $L = 1$ é inconclusivo. Sempre que o limite da razão existe, o limite da raiz existe e é igual a ele, então o teste da raiz nunca é mais fraco; ele também resolve séries em que a razão não tem limite.

Os dois testes ficam cegos em $L = 1$ porque um limite menor que $1$ significa decaimento geométrico, e $L = 1$ cobre todo decaimento mais lento que qualquer taxa geométrica. Isso inclui o decaimento polinomial, mas também $e^{-\sqrt n}$ (mais rápido que qualquer polinômio, e ainda assim $L=1$) e $1/\ln n$ (mais lento que qualquer polinômio). Em $\sum 1/n$ e $\sum 1/n^2$ a razão tende a $1$ nos dois casos, mas uma série diverge e a outra converge.

### Convergência absoluta e condicional

Se $\sum \lvert a_n \rvert$ converge, então $\sum a_n$ converge (convergência absoluta implica convergência). A recíproca falha: $\sum (-1)^{n+1}/n$ converge pelo teste da série alternada, mas $\sum 1/n$ diverge, então a convergência é apenas condicional.

A distinção tem consequências. Se a série converge absolutamente, toda reordenação tem a mesma soma. Se converge só condicionalmente, o teorema de reordenação de Riemann diz que é possível reordenar para somar qualquer número real, ou para divergir. Somar infinitos termos não é comutativo.

### Escolhendo um teste

| Procure | Tente |
| --- | --- |
| $a_n \not\to 0$ é plausível | teste da divergência primeiro |
| fatoriais, exponenciais ou potências n-ésimas | teste da razão, ou da raiz para potências n-ésimas |
| racional ou algébrica em n | comparação no limite com uma série p |
| $f(n)$ com primitiva fácil (logaritmos, $1/(x\ln x)$) | teste da integral |
| os sinais alternam | teste da série alternada; depois verifique $\sum \lvert a_n \rvert$ |
| razão ou raiz dá 1 | comparação ou teste da integral |

## Exemplos Resolvidos

### Exemplo 1: o teste da razão, e uma soma que vale exatamente 2

Para $\sum_{n\ge1} n/2^n$, a razão é $\frac{(n+1)/2^{n+1}}{n/2^n} = \frac{n+1}{2n} \to \tfrac12 < 1$, então a série converge. Sua soma é $2$. As somas parciais $S_5 = 1{,}78125$, $S_{10} = 1{,}98828\ldots$ e $S_{20} = 1{,}99998\ldots$ se aproximam rápido, como uma razão de $\tfrac12$ prevê. É a série por trás da construção de heap em tempo linear.

### Exemplo 2: comparação no limite

Para $\sum (n+1)/(n^3+5)$, compare com $b_n = 1/n^2$. Então $a_n/b_n = n^2(n+1)/(n^3+5) \to 1$, um limite finito e positivo, e $\sum 1/n^2$ converge, logo a série converge. Uma conferência numérica concorda com o limite: a razão vale $1{,}0945$ em $n=10$, $1{,}0100$ em $n=100$ e $1{,}0010$ em $n=1000$. A série soma cerca de $1{,}0039$.

### Exemplo 3: o teste da integral e sua cota de erro

Para $\sum 1/n^2$, tome $f(x) = 1/x^2$, contínua, positiva e decrescente em $[1,\infty)$. Depois de $N = 10$ termos, $S_{10} = 1{,}549768$, e a cota do resto dá $S_{10} + \tfrac1{11} \le S \le S_{10} + \tfrac1{10}$, isto é, $1{,}6407 \le S \le 1{,}6498$. A soma verdadeira é $\pi^2/6 = 1{,}644934$, dentro da janela. Para garantir erro abaixo de $10^{-3}$ usando só a cota superior, tome $N = 1000$; o erro real aí é $0{,}0009995$, logo abaixo da garantia.

### Exemplo 4: o teste da série alternada, e o que acontece sem monotonicidade

A série harmônica alternada $\sum (-1)^{n+1}/n$ cumpre as três hipóteses com $b_n = 1/n$, e converge para $\ln 2 = 0{,}693147$. A cota $\lvert R_N\rvert \le 1/(N+1)$ é honesta, mas conservadora: para $N = 999$ ele promete $0{,}001$, e o erro real é $0{,}0005$. A cota precisa de $999$ termos para garantir $0{,}001$, enquanto o erro real cai a $0{,}001$ pela primeira vez perto de $N=500$. A lentidão é o ponto: um dígito de precisão a cada dez vezes mais termos.

Agora tome $\sum_{n\ge2} \dfrac{(-1)^n}{\sqrt n + (-1)^n}$ (começa em $n=2$ porque o denominador de $n=1$ é $0$). Aqui $b_n = 1/(\sqrt n + (-1)^n) \to 0$, mas $b_2 = 0{,}414$ e $b_3 = 1{,}366$, então $b_n$ não é decrescente. O teste não se aplica, e a série diverge: racionalizar o denominador separa o termo em $(-1)^n\sqrt n/(n-1) - 1/(n-1)$. A primeira parte converge pelo teste alternado e a segunda é uma cauda harmônica. As somas parciais se comportam como $-\ln N$: $-4{,}21$ em $N=10^2$, $-8{,}87$ em $N=10^4$ e $-13{,}48$ em $N=10^6$, contra $-4{,}61$, $-9{,}21$ e $-13{,}82$ para $-\ln N$ (a diferença se estabiliza perto de $0{,}34$). Tirar uma hipótese inverteu a conclusão.

### Exemplo 5: quando o teste da razão não diz nada e o da raiz decide

Seja $a_n = 2^{-(n + (-1)^n)}$, com termos $1, \tfrac18, \tfrac14, \tfrac1{32}, \tfrac1{16}, \ldots$. As razões $a_{n+1}/a_n$ alternam entre $\tfrac18$ e $2$, então o limite não existe e o teste da razão, como enunciado, não se aplica. (Mesmo a versão com limsup/liminf é inconclusiva: ela precisa de $\limsup < 1$ para convergir ou de $\liminf > 1$ para divergir, e aqui $\limsup = 2$ e $\liminf = \tfrac18$.) O teste da raiz dá $\lvert a_n\rvert^{1/n} = 2^{-1-(-1)^n/n} \to \tfrac12 < 1$, então a série converge, e soma exatamente $\tfrac32$.

### Exemplo 6: uma série condicionalmente convergente reordenada

Pegue a série harmônica alternada e reordene com dois termos positivos seguidos de um negativo: $1 + \tfrac13 - \tfrac12 + \tfrac15 + \tfrac17 - \tfrac14 + \cdots$. São exatamente os mesmos termos, mas a soma é $\tfrac32\ln 2 \approx 1{,}03972$ em vez de $\ln 2 \approx 0{,}69315$. Um script somando o primeiro milhão de grupos dessa ordem dá $1{,}0397205$.

### Exemplo 7: quando as somas parciais enganam

$\sum_{n\ge2} 1/(n\ln n)$: com $f(x) = 1/(x\ln x)$, $\int_2^\infty f = \lim_{M\to\infty}\ln\ln M - \ln\ln 2 = \infty$, então a série diverge, e a soma até $N$ acompanha $\ln\ln N$ mais uma constante. Em $N = 10^7$, $\ln\ln N = 2{,}78$ e a soma parcial é $3{,}57$. Já $\sum 1/(n\ln^2 n)$ converge (a integral a partir de $x=2$ vale $1/\ln 2$) e sua soma é $2{,}1097$ (calculada com uma cauda de Euler-Maclaurin; a convergência é tão lenta que a soma parcial em $N=10^7$ é só $2{,}0477$). O teste da razão é inútil nas duas, porque a razão entre termos consecutivos tende a $1$.

## Equívocos Comuns e Armadilhas

- **"Se $a_n \to 0$, a série converge."** Só vale a recíproca. A série harmônica é o contraexemplo padrão, e $1/(n\ln n)$ mostra como a divergência pode demorar a aparecer.
- **"O teste da razão deu $L=1$, então a série diverge (ou converge)."** Em $L=1$ o teste não diz nada. Passe para comparação ou para o teste da integral.
- **"A comparação vale nos dois sentidos."** Uma série menor que uma divergente, ou maior que uma convergente, não informa nada. Confira o sentido e confira que todos os termos são não negativos.
- **"Sinais alternados com $b_n \to 0$ bastam."** A monotonicidade é uma hipótese. O Exemplo 4 diverge apesar de $b_n \to 0$.
- **"Uma soma parcial que parou de mudar indica convergência."** Somas parciais de séries divergentes podem variar menos do que qualquer precisão exibida por muito tempo.
- **"Reordenar termos é inofensivo."** Só é inofensivo para séries absolutamente convergentes.

## Resumo

O teste da divergência só detecta divergência. Os testes da integral, de comparação, de comparação no limite, da razão e da raiz se aplicam a séries de termos (eventualmente) positivos ou tomadas em valor absoluto. O teste da integral decide sempre que as hipóteses valem, os testes de comparação não dizem nada quando a desigualdade aponta para o lado errado (ou quando $L=0$ ou $L=\infty$), e os testes da razão e da raiz não dizem nada em $L=1$. O teste da série alternada exige $b_n$ decrescente a $0$ e então dá a convergência e a cota $\lvert R_N \rvert \le b_{N+1}$; o teste da integral dá cotas de resto dos dois lados. A convergência absoluta é o caso seguro: implica convergência e permite reordenar à vontade, o que a condicional não permite. A próxima lição, `power-series-and-the-radius-of-convergence`, aplica os testes da razão e da raiz a séries com uma variável $x$, onde eles decidem um intervalo de convergência e os extremos são resolvidos com os outros testes desta lição.

## Documentation Links

- [OpenStax Calculus Volume 2, 5.3 The Divergence and Integral Tests](https://openstax.org/books/calculus-volume-2/pages/5-3-the-divergence-and-integral-tests): teste da divergência, teste da integral, séries $p$ e estimativas de resto.
- [OpenStax Calculus Volume 2, 5.4 Comparison Tests](https://openstax.org/books/calculus-volume-2/pages/5-4-comparison-tests): comparação direta e no limite, com exemplos.
- [OpenStax Calculus Volume 2, 5.5 Alternating Series](https://openstax.org/books/calculus-volume-2/pages/5-5-alternating-series): teste da série alternada, cota do resto, convergência absoluta e condicional.
- [OpenStax Calculus Volume 2, 5.6 Ratio and Root Tests](https://openstax.org/books/calculus-volume-2/pages/5-6-ratio-and-root-tests): testes da razão e da raiz e uma estratégia para escolher entre os testes.
- [MIT OpenCourseWare 18.01SC, Session 95: Series Comparison](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-95-series-comparison/): comparação de séries com integrais e com séries conhecidas.
