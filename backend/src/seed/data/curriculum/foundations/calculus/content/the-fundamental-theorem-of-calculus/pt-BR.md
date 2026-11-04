---
version: 1.0
updatedAt: 2026-11-04
title: "O Teorema Fundamental do Cálculo"
summary: "As duas partes do Teorema Fundamental do Cálculo, que ligam acúmulo a taxas de variação e reduzem uma integral definida à avaliação de uma antiderivada."
---
## Objetivos de Aprendizagem

- Enunciar as duas partes do Teorema Fundamental do Cálculo com todas as hipóteses, e dizer qual delas responde "qual é a derivada de uma integral" e qual responde "como avalio uma integral".
- Derivar funções definidas por integrais, inclusive com limites variáveis, usando a regra da cadeia.
- Calcular integrais definidas como $F(b)-F(a)$ e explicar por que a constante de integração desaparece.
- Separar deslocamento de distância total quando a velocidade troca de sinal.
- Mostrar com um caso concreto que, sem uma das hipóteses, cada parte falha.
- Usar funções de acúmulo para grandezas sem antiderivada elementar, como a $\operatorname{erf}$.

## Contexto e Motivação

Em `the-definite-integral-and-riemann-sums` a integral era um limite de somas, e o valor exato até de $\int_0^b x^2\,dx$ exigiu uma fórmula de somatório e um limite. Já `antiderivatives-and-initial-value-problems` inverteu a derivação sem falar de área. O Teorema Fundamental do Cálculo (TFC) diz que esses dois projetos são o mesmo projeto: acumular uma taxa e desfazer uma derivada são operações inversas. Ele transforma um limite de $n$ termos em duas avaliações de função.

Em computação o teorema aparece de duas formas. Toda grandeza acumulada (total de bytes enviados a partir de uma taxa, uma função de distribuição acumulada a partir de uma densidade) tem a taxa como derivada. E quando não dá para escrever uma antiderivada, como no caso da curva em sino, o teorema ainda informa a derivada da grandeza acumulada, que é o que métodos numéricos e ajuste por gradiente precisam.

Uma observação sobre nomes: o OpenStax chama o enunciado da derivada de Parte 1 e o da avaliação de Parte 2, como esta lição faz. O MIT 18.01SC e o Active Calculus chamam o enunciado da avaliação de primeiro teorema e o da derivada de segundo. Confira a convenção da fonte antes de citar "o primeiro teorema".

## Teoria Central

### Funções de acúmulo

Para $f$ integrável em $[a,b]$, defina $F(x) = \int_a^x f(t)\,dt$ para $x\in[a,b]$. A variável de integração é muda, então use uma letra ($t$) diferente da do limite superior ($x$). $F(x)$ é a área líquida acumulada de $a$ até $x$.

### Parte 1: a derivada de um acúmulo

**Teorema.** Se $f$ é contínua em $[a,b]$ e $F(x)=\int_a^x f(t)\,dt$, então $F$ é contínua em $[a,b]$, derivável em $(a,b)$ e $F'(x) = f(x)$ para todo $x\in(a,b)$ (derivadas laterais nas extremidades).

A ideia: $\frac{F(x+h)-F(x)}{h} = \frac1h\int_x^{x+h} f(t)\,dt$ é a média de $f$ em $[x,x+h]$. Quando $h\to0$ esse intervalo colapsa em $x$, e a continuidade força a média a se aproximar de $f(x)$. Numericamente, para $f=\cos$ em $x=0{,}5$ as médias são 0,7241 ($h=0{,}5$), 0,8522 ($0{,}1$), 0,87517 ($0{,}01$), 0,87734 ($0{,}001$), rumo a $\cos 0{,}5 = 0{,}87758$.

Com limites variáveis, $f$ contínua e $g,h$ deriváveis:

$$\frac{d}{dx}\int_{h(x)}^{g(x)} f(t)\,dt = f(g(x))\,g'(x) - f(h(x))\,h'(x)$$

### Parte 2: avaliação

**Teorema.** Se $f$ é contínua em $[a,b]$ e $F$ é uma antiderivada qualquer de $f$ em $[a,b]$ (isto é, $F'=f$ ali), então

$$\int_a^b f(x)\,dx = F(b) - F(a) = \big[F(x)\big]_a^b$$

Por quê: $G(x)=\int_a^x f$ é uma antiderivada pela Parte 1. Duas antiderivadas num intervalo diferem por uma constante (derivada zero num intervalo significa função constante, veja `the-mean-value-theorem-and-monotonicity`), então $F = G + C$ e $F(b)-F(a) = G(b)-G(a) = \int_a^b f$. Se você escrever $F+C$, o $C$ some na subtração, então integrais definidas não precisam de constante.

A continuidade de $f$ é a condição suficiente simples. O teorema vale de forma mais geral quando $f$ é integrável e $F$ é contínua em $[a,b]$ com $F'=f$ exceto em finitos pontos. Por exemplo, $F(x)=x^2\sin(1/x)$ com $F(0)=0$ tem $F'(x)=2x\sin(1/x)-\cos(1/x)$ para $x\ne0$ e $F'(0)=0$, que é limitada mas descontínua em $0$, e $\int_0^1F'=F(1)-F(0)=\sin1\approx0{,}8415$.

### Variação líquida

Leia a Parte 2 com $F$ como uma grandeza e $f=F'$ como sua taxa: $\int_a^b F'(x)\,dx = F(b)-F(a)$, a variação líquida. Para uma velocidade $v$, $\int_a^b v\,dt$ é o **deslocamento** e $\int_a^b \lvert v\rvert\,dt$ é a **distância percorrida**. Elas diferem sempre que $v$ troca de sinal.

Programas usam o gêmeo discreto dessa ideia o tempo todo. Com um vetor de somas prefixadas $P[k]=\sum_{i\le k} a_i$, a soma de qualquer faixa é $P[b]-P[a-1]$: a soma da taxa, obtida como diferença de dois valores acumulados, sem percorrer a faixa. A Parte 2 é a mesma troca para $f$ contínua, e a diferença $a_k = P[k]-P[k-1]$ faz o papel de $F'=f$.

### Quando as hipóteses falham

- **Parte 2 com $f$ ilimitada.** Em $[-1,1]$ tome $f(x)=1/x^2$ e $F(x)=-1/x$. Então $F'=f$ para $x\ne0$, mas $F$ não é contínua em $0$ e $f$ é ilimitada ali. A subtração mecânica dá $F(1)-F(-1) = -1-1 = -2$, um número negativo para uma função positiva. A função é ilimitada em $0$, então não tem integral de Riemann. Somas de ponto médio com $n=10, 100, 1000, 10000$ valem 47,4, 491,5, 4932,8, 49346,0: crescem aproximadamente como $n$ e nunca se estabilizam (o sympy responde $\infty$).
- **Parte 1 sem continuidade.** Seja $f(x)=1$ para $x\ne0$ e $f(0)=0$. Mudar um valor não altera nenhuma integral, então $\int_0^x f = x$, cuja derivada em $0$ é $1$, e não $f(0)=0$. Do mesmo modo, $f(t)=\operatorname{sgn}t$ dá $\int_0^x f=\lvert x\rvert$, sem derivada em $0$.

### Integrais sem antiderivada elementar

$e^{-t^2}$ é contínua, então $\int_0^x e^{-t^2}dt$ existe e a Parte 1 dá sua derivada, mas nenhuma combinação de funções elementares tem $e^{-x^2}$ como derivada. O acúmulo é uma função nova, $\operatorname{erf}(x) = \frac{2}{\sqrt\pi}\int_0^x e^{-t^2}dt$, com $\operatorname{erf}'(x) = \frac{2}{\sqrt\pi}e^{-x^2}$. Os valores vêm de integração numérica.

## Exemplos Resolvidos

### Exemplo 1: limites variáveis

Seja $G(x)=\int_x^{x^2}\frac{dt}{1+t^4}$. Os dois limites dependem de $x$:

$$G'(x) = \frac{2x}{1+x^8} - \frac{1}{1+x^4}$$

Em $x=1{,}3$ a fórmula dá $0{,}02459688709$. Uma diferença central de integrais numéricas dá $0{,}02459688711$. Para um único limite variável, $\frac{d}{dx}\int_0^{x^2}e^{-t^2}dt = 2x\,e^{-x^4}$, com o fator $2x$ vindo da regra da cadeia.

### Exemplo 2: avaliando com uma antiderivada

$$\int_1^4\Big(3\sqrt{x}+\frac2x\Big)dx = \Big[2x^{3/2} + 2\ln x\Big]_1^4 = (16 + 2\ln4) - 2 = 14 + 4\ln 2 \approx 16{,}7726$$

Derivar $2x^{3/2}+2\ln x$ devolve $3\sqrt x + 2/x$, e a quadratura dá $16{,}77258872$. O $\ln$ é legítimo porque $[1,4]$ está em $x>0$, onde $1/x$ é contínua.

### Exemplo 3: deslocamento contra distância

Uma partícula tem $v(t)=t^2-4t+3=(t-1)(t-3)$ em $[0,4]$, com antiderivada $\frac{t^3}{3}-2t^2+3t$. O sinal muda em $t=1$ e $t=3$, então divida ali:

$$\int_0^1 v = \tfrac43, \qquad \int_1^3 v = -\tfrac43, \qquad \int_3^4 v = \tfrac43$$

O deslocamento é $\frac43-\frac43+\frac43 = \frac43$; a distância é $\frac43+\frac43+\frac43 = 4$. Integrar $v$ no intervalo inteiro e chamar de "distância" informaria $\frac43$, errado por um fator 3.

### Exemplo 4: lendo uma função de acúmulo

Seja $F(x)=\int_0^x (t-1)(t-2)\,dt = \frac{x^3}{3}-\frac{3x^2}{2}+2x$. Pela Parte 1, $F'(x)=(x-1)(x-2)$, positiva para $x<1$, negativa em $(1,2)$ e positiva para $x>2$. Então $F$ sobe, desce e sobe: máximo local em $x=1$ com $F(1)=\frac56$ e mínimo local em $x=2$ com $F(2)=\frac23$. A integração numérica dá $0{,}8333$ e $0{,}6667$, e $F(3)=\frac32$. O formato de $F$ foi lido do sinal de $f$ sem calcular $F$.

### Exemplo 5: uma função sem fórmula

Pela Parte 1, $\operatorname{erf}'(0{,}7) = \frac{2}{\sqrt\pi}e^{-0{,}49} = 0{,}69127486$, e uma diferença finita da $\operatorname{erf}$ da biblioteca concorda a $10^{-11}$. Somas de ponto médio de $\frac{2}{\sqrt\pi}\int_0^1 e^{-t^2}dt$ com $n=4, 8, 16, 64, 256$ dão 0,84487, 0,84324, 0,84284, 0,842709, 0,842701, contra $\operatorname{erf}(1)=0{,}8427007929$. Valores como os da tabela Z de `the-normal-distribution` vêm desse tipo de integração numérica: $P(\lvert Z\rvert<1) = \operatorname{erf}(1/\sqrt2) = 0{,}6827$, os cerca de 68% da regra 68-95-99,7.

## Equívocos Comuns e Armadilhas

- **"Qualquer $F$ com $F'=f$ fora de alguns pontos serve."** $F$ também precisa ser contínua em $[a,b]$. Tome $f=0$ e $F=\lfloor x\rfloor$ em $[0,2]$: $F'=f$ exceto nos inteiros, mas $F(2)-F(0)=2$ enquanto $\int_0^2f=0$. O salto de $-1/x$ em $0$ (Teoria Central) é a mesma falha. Uma quina é inofensiva: $F=\lvert x\rvert$ com $f=\operatorname{sgn}$ em $[-1,2]$ dá $F(2)-F(-1)=1=\int_{-1}^{2}\operatorname{sgn}$.
- **"A derivada de $\int_a^{g(x)} f$ é $f(g(x))$."** Falta a derivada interna: é $f(g(x))\,g'(x)$. E se os dois limites são constantes, a derivada é $0$, porque a integral é um número.
- **"Integral definida precisa de $+C$."** A constante some. Escrevê-la não faz mal, mas não faz parte da resposta.
- **"A integral da velocidade é a distância."** É o deslocamento. A distância pede $\int\lvert v\rvert$, dividida nas trocas de sinal.
- **"Parte 1 e Parte 2 são o mesmo fato."** A Parte 1 produz antiderivadas para toda $f$ contínua (inclusive as sem fórmula); a Parte 2 usa uma antiderivada que você já tem para calcular um número.
- **Reusar $x$ como limite e como variável**, como em $\int_0^x f(x)\,dx$. Funciona, mas convida a erros na derivação. Renomeie a variável interna.

## Resumo

Para $f$ contínua em $[a,b]$, a Parte 1 diz que o acúmulo $F(x)=\int_a^x f(t)\,dt$ é derivável com $F'=f$, e com limites variáveis a regra da cadeia acrescenta fatores $g'(x)$. A Parte 2 diz que $\int_a^b f = F(b)-F(a)$ para qualquer antiderivada $F$, então integrais definidas viram duas avaliações e a constante de integração se cancela. Lida como variação líquida, a integral de uma taxa é a variação da grandeza, e por isso a velocidade dá o deslocamento e $\int\lvert v\rvert$ dá a distância. A Parte 1 exige continuidade de $f$ no ponto em questão (um único valor alterado a quebra ali). A Parte 2 exige $f$ integrável e $F$ contínua em $[a,b]$: $1/x^2$ em $[-1,1]$ falha nas duas, e $F=\lfloor x\rfloor$ com $f=0$ mostra que um salto em $F$ quebra a fórmula. Quando não existe antiderivada elementar, como em $e^{-t^2}$, a função de acúmulo continua bem definida e com derivada conhecida, e seus valores vêm de integração numérica. A próxima lição, `integration-by-substitution-and-by-parts`, constrói as técnicas para achar antiderivadas.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.3 The Fundamental Theorem of Calculus](https://openstax.org/books/calculus-volume-1/pages/5-3-the-fundamental-theorem-of-calculus): as duas partes, o teorema do valor médio para integrais e a regra da cadeia com limites variáveis.
- [OpenStax Calculus Volume 1, 5.4 Integration Formulas and the Net Change Theorem](https://openstax.org/books/calculus-volume-1/pages/5-4-integration-formulas-and-the-net-change-theorem): o teorema da variação líquida e deslocamento contra distância total.
- [Active Calculus, 4.4 The Fundamental Theorem of Calculus](https://activecalculus.org/single/sec-4-4-FTC.html): o teorema da avaliação, motivado por velocidade e distância.
- [Active Calculus, 5.2 The Second Fundamental Theorem of Calculus](https://activecalculus.org/single/sec-5-2-FTC2.html): funções de acúmulo e suas derivadas.
- [MIT OCW 18.01SC, Unit 3 Part B](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-b-second-fundamental-theorem-areas-volumes/): aulas sobre o segundo teorema fundamental e sua demonstração.
