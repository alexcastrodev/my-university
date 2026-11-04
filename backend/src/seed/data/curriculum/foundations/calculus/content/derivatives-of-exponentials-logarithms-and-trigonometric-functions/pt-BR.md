---
version: 1.0
updatedAt: 2026-11-04
title: "Derivadas de Exponenciais, Logaritmos e Funções Trigonométricas"
summary: "Por que e é a base cuja exponencial é a própria derivada, as derivadas de logaritmos e funções trigonométricas, e a derivação implícita e logarítmica para expressões que as regras básicas não alcançam."
---
## Objetivos de Aprendizagem

- Explicar por que $e$ é a base cuja função exponencial é a própria derivada, e deduzir $\frac{d}{dx} b^x = b^x \ln b$.
- Deduzir $\frac{d}{dx}\ln x = \frac{1}{x}$ a partir da exponencial e indicar seu domínio.
- Enunciar as derivadas de $\sin$, $\cos$ e $\tan$, a necessidade de usar radianos, e combiná-las com a regra da cadeia.
- Derivar uma expressão definida implicitamente e reconhecer os pontos em que o método falha.
- Usar a derivação logarítmica em expressões como $x^x$, que as regras básicas não alcançam.

## Contexto e Motivação

A lição anterior, `differentiation-rules-and-the-chain-rule`, deriva qualquer combinação de potências, somas, produtos, quocientes e composições. Seu alcance termina na primeira função que não é uma potência de $x$. Exponenciais, logaritmos e funções trigonométricas são as funções que modelam crescimento, decaimento, escala e oscilação: juros compostos, tempos de execução de algoritmos medidos em $\log n$, probabilidades em um classificador, uma mola vibrando, um sistema de coordenadas girando. Um conjunto de ferramentas de derivação que não as trata não serve.

A exponencial, o seno e o cosseno têm uma propriedade que os polinômios não têm: derivar os mantém dentro da própria família e nunca os reduz a $0$. A derivada da exponencial é um múltiplo dela mesma, e $\sin$ e $\cos$ se derivam um no outro, enquanto derivar um polinômio baixa seu grau até não sobrar nada. O logaritmo e a tangente saem da família, dando $\frac{1}{x}$ e $\frac{1}{\cos^2 x}$, mas os resultados são expressões simples em funções já conhecidas. O trabalho com limites varia de um caso a outro: a exponencial precisa de um limite, o seno e o cosseno de dois, e o logaritmo de nenhum limite novo, porque sai da exponencial pela relação de inversa. Uma vez encontrada a derivada, a regra da cadeia a leva para toda parte.

A lição também cobre duas técnicas para expressões em que a variável aparece onde uma regra básica não a espera: a **derivação implícita**, para curvas como $x^2 + y^2 = 25$ que não vêm na forma $y = f(x)$, e a **derivação logarítmica**, para expressões como $x^x$.

## Teoria Central

### O número $e$ e a exponencial

Para uma base $b > 0$, o quociente de diferenças de $b^x$ se fatora:

$$\frac{b^{x+h} - b^x}{h} = b^x \cdot \frac{b^h - 1}{h}.$$

O fator $b^x$ não depende de $h$. Se o limite $L(b) = \lim_{h \to 0} \frac{b^h - 1}{h}$ existe, então $\frac{d}{dx} b^x = L(b)\, b^x$: a derivada de uma exponencial é proporcional a ela mesma, e toda a questão é a constante. Numericamente, com $h = 10^{-6}$:

```text
b          L(b)
2          0.693147
2.5        0.916291
3          1.098613
10         2.302588
```

$L(2) < 1 < L(3)$. Três fatos são aceitos aqui sem demonstração: o limite $L(b)$ existe para todo $b > 0$, varia continuamente com $b$ e é estritamente crescente em $b$. A continuidade e o Teorema do Valor Intermediário de `continuity-and-the-intermediate-value-theorem` dão então uma base entre $2$ e $3$ com $L(b) = 1$, e o crescimento estrito a torna a única. Essa base é chamada $e \approx 2{,}718281828$. Com $b = e$ a constante é $1$:

$$\frac{d}{dx} e^x = e^x.$$

Portanto $e$ não é uma escolha arbitrária: é a base para a qual a inclinação do gráfico é igual à sua altura em todo ponto. O mesmo número é o limite de $\left(1 + \frac{1}{n}\right)^n$, que assume os valores $2$, $2{,}5937$, $2{,}7048$, $2{,}71815$, $2{,}718280$ para $n = 1, 10, 100, 10^4, 10^6$ (a equivalência das duas descrições é demonstrada nos livros-texto citados abaixo).

O logaritmo natural $\ln$ é a inversa de $e^x$, de modo que $b = e^{\ln b}$ para todo $b > 0$. Escrevendo $b^x = e^{x \ln b}$ e usando a regra da cadeia:

$$\frac{d}{dx} b^x = b^x \ln b.$$

Isso também identifica a constante da tabela, $L(b) = \ln b$: de fato, $\ln 2 = 0{,}693147$ e $\ln 10 = 2{,}302585$. Exemplo: $\frac{d}{dx}2^x$ em $x = 3$ vale $8 \ln 2 \approx 5{,}545$. Uma regra da potência mal aplicada daria $x \cdot 2^{x-1} = 12$ em $x = 3$, o que está errado, porque $2^x$ não é uma potência de $x$.

### O logaritmo

Seja $y = \ln x$ para $x > 0$, de modo que $e^y = x$. Derive os dois lados em relação a $x$. O lado direito dá $1$. O lado esquerdo, pela regra da cadeia, dá $e^y \cdot y'$. Portanto

$$\frac{d}{dx} \ln x = \frac{1}{e^y} = \frac{1}{x}, \qquad x > 0.$$

Esse passo supõe que $y$ seja diferenciável, o que vale porque a inversa de uma função diferenciável com derivada não nula é diferenciável; $e^y > 0$ garante isso. Para $x \neq 0$, $\frac{d}{dx}\ln\lvert x \rvert = \frac{1}{x}$, e é por isso que as primitivas de $\frac{1}{x}$ mais adiante levam um valor absoluto. Com a regra da cadeia, $\frac{d}{dx} \ln g(x) = \frac{g'(x)}{g(x)}$ onde $g(x) > 0$. Para outra base, $\log_b x = \frac{\ln x}{\ln b}$ dá $\frac{1}{x \ln b}$.

### Seno, cosseno e tangente

As derivadas de $\sin$ e $\cos$ vêm da fórmula da soma de ângulos e de dois limites. O primeiro, $\lim_{h \to 0} \frac{\sin h}{h} = 1$, é o resultado do teorema do confronto em `limit-laws-and-indeterminate-forms`. O segundo, $\lim_{h \to 0} \frac{\cos h - 1}{h} = 0$, decorre do limite $\frac{1 - \cos h}{h^2} \to \frac{1}{2}$ dessa lição, porque $\frac{\cos h - 1}{h} = -h \cdot \frac{1 - \cos h}{h^2} \to 0 \cdot \frac{1}{2}$. Então:

$$\frac{\sin(x+h) - \sin x}{h} = \sin x \cdot \frac{\cos h - 1}{h} + \cos x \cdot \frac{\sin h}{h} \to \cos x.$$

O mesmo cálculo para o cosseno dá $-\sin x$:

$$\frac{d}{dx}\sin x = \cos x, \qquad \frac{d}{dx}\cos x = -\sin x.$$

Os dois limites são afirmações sobre ângulos em **radianos**. Em graus, $\sin h^\circ \approx \frac{\pi}{180} h$, então $\frac{d}{dx}\sin(x^\circ) = \frac{\pi}{180}\cos(x^\circ)$, cerca de $0{,}017453$ em $x = 0$. Os radianos são o que deixa a fórmula da derivada limpa. Pela regra do quociente, $\frac{d}{dx}\tan x = \frac{1}{\cos^2 x} = 1 + \tan^2 x$, válida onde $\cos x \neq 0$. Duas funções inversas seguem do mesmo argumento usado para o logaritmo: $\frac{d}{dx}\arctan x = \frac{1}{1 + x^2}$ para todo $x$, e $\frac{d}{dx}\arcsin x = \frac{1}{\sqrt{1 - x^2}}$ somente em $(-1, 1)$. A última cresce sem limite perto das extremidades: vale $2{,}29$ em $x = 0{,}9$, $7{,}09$ em $0{,}99$ e $707$ em $0{,}999999$.

### Derivação implícita

Às vezes uma curva é dada por uma equação relacionando $x$ e $y$, e não por uma fórmula $y = f(x)$. Se, perto de um ponto, $y$ é uma função diferenciável de $x$, derive os dois lados da equação em relação a $x$, tratando $y$ como $y(x)$ para que a regra da cadeia acrescente um fator $y'$ a cada termo que contém $y$, e depois resolva para $y'$.

Para $x^2 + y^2 = 25$, derivar dá $2x + 2y\,y' = 0$, logo $y' = -\frac{x}{y}$, válido onde $y \neq 0$. Em $y = 0$ o círculo tem tangente vertical e $y$ não é função de $x$ perto desse ponto, então não há $y'$ a encontrar. O método supõe em silêncio aquilo de que precisa: ele devolve uma fórmula mesmo onde a suposição é falsa, e o denominador é onde olhar.

### Derivação logarítmica

Quando a variável está ao mesmo tempo na base e no expoente, ou uma expressão é um produto e quociente longos, tome o logaritmo antes. Para $y = f(x) > 0$:

$$\ln y = \ln f(x) \quad\Rightarrow\quad \frac{y'}{y} = \frac{d}{dx}\ln f(x) \quad\Rightarrow\quad y' = y \cdot \frac{d}{dx}\ln f(x).$$

Se $y$ pode ser negativo mas não nulo, use $\ln\lvert y \rvert$, cuja derivada também é $\frac{y'}{y}$. A mesma ideia demonstra a regra geral da potência: para $x > 0$ e qualquer real $r$, $x^r = e^{r \ln x}$ e $\frac{d}{dx} x^r = e^{r \ln x} \cdot \frac{r}{x} = r x^{r-1}$.

## Exemplos Resolvidos

### Exemplo 1: a sigmoide

A função logística $\sigma(z) = \dfrac{1}{1 + e^{-z}}$ está definida para todo $z$ real e transforma qualquer pontuação real em um número em $(0, 1)$. Pela regra da cadeia aplicada ao inverso,

$$\sigma'(z) = \frac{e^{-z}}{(1 + e^{-z})^2} = \sigma(z)\big(1 - \sigma(z)\big).$$

A segunda forma sai de escrever $\frac{e^{-z}}{1 + e^{-z}} = 1 - \sigma(z)$. Valores, conferidos com uma diferença central:

```text
z      sigma(z)   sigma'(z)
-5     0.006693   0.006648
 0     0.500000   0.250000
 2     0.880797   0.104994
 5     0.993307   0.006648
```

A derivada é máxima em $z = 0$, com valor $\frac{1}{4}$, porque $p(1-p) \leq \frac{1}{4}$ para qualquer $p$, e decai dos dois lados. É o fator que cada camada sigmoide contribui ao produto em uma passada para trás: dez delas, no melhor caso, multiplicam-se em no máximo $0{,}25^{10} \approx 9{,}5 \times 10^{-7}$, uma razão concreta para pilhas profundas de sigmoides treinarem devagar.

### Exemplo 2: oscilação

Uma massa presa a uma mola tem posição $x(t) = 3\cos(2t)$ (metros, $t$ em segundos). Com a regra da cadeia:

$$v(t) = x'(t) = -6\sin(2t), \qquad a(t) = v'(t) = -12\cos(2t).$$

Comparando, $a(t) = -4\,x(t)$: a aceleração é proporcional ao deslocamento e de sinal oposto, a assinatura do movimento harmônico. Em $t = 0{,}5$: $x = 1{,}6209$, $v = -5{,}0488$ m/s, $a = -6{,}4836$ m/s$^2$, e de fato $-4 \times 1{,}6209 = -6{,}4836$. Como a função é $\cos(2t)$ e não $\cos t$, cada derivada ganha um fator $2$ da regra da cadeia.

### Exemplo 3: derivação implícita

Para $x^3 + y^3 = 6xy$ (uma curva chamada fólio de Descartes), o ponto $(3, 3)$ pertence a ela, pois $27 + 27 = 54 = 6 \cdot 9$. Derive os dois lados, usando a regra do produto em $6xy$:

$$3x^2 + 3y^2 y' = 6y + 6x y' \quad\Rightarrow\quad y' = \frac{2y - x^2}{y^2 - 2x}.$$

Resolver exige $y^2 \neq 2x$. Em $(3, 3)$: $y' = \frac{6 - 9}{9 - 6} = -1$. A reta tangente é $y - 3 = -(x - 3)$. Para o círculo em $(3, 4)$ o mesmo método dá $y' = -\frac{3}{4}$, e em $(5, 0)$ o denominador $y$ é zero, o que combina com a tangente vertical.

### Exemplo 4: derivação logarítmica de $x^x$

Para $x > 0$, seja $y = x^x$. Então $\ln y = x \ln x$. Derive os dois lados, usando a regra do produto à direita:

$$\frac{y'}{y} = \ln x + x \cdot \frac{1}{x} = \ln x + 1 \quad\Rightarrow\quad y' = x^x(\ln x + 1).$$

Em $x = 2$: $y' = 4(\ln 2 + 1) \approx 6{,}7726$, e uma diferença central dá $6{,}77259$. A regra da potência daria aqui $x \cdot x^{x-1} = x^x$, e a regra da exponencial sozinha daria $x^x \ln x$; cada uma captura apenas um dos dois lugares em que a variável aparece, e por isso a derivada verdadeira é a soma das duas contribuições.

## Equívocos Comuns e Armadilhas

- **"$\frac{d}{dx} e^x = x e^{x-1}$."** A regra da potência vale para base variável com expoente constante. Em $e^x$ a variável está no expoente, e a derivada é $e^x$.
- **"$\frac{d}{dx}\ln(x^2) = \frac{1}{x^2}$."** A regra da cadeia dá $\frac{2x}{x^2} = \frac{2}{x}$, o mesmo que a derivada de $2\ln\lvert x \rvert$.
- **"A derivada de $\cos x$ é $\sin x$."** O sinal é negativo. Uma conferência rápida: $\cos$ é decrescente logo depois de $x = 0$, então sua inclinação ali tem de ser negativa, e $-\sin x$ é negativo para $x > 0$ pequeno.
- **"As fórmulas das derivadas trigonométricas valem em qualquer unidade de ângulo."** Valem em radianos. Usar graus traz um fator $\frac{\pi}{180}$ para cada derivada.
- **"A derivação implícita sempre fornece $y'$."** Ela fornece $y'$ onde $y$ é localmente uma função diferenciável de $x$. Onde o denominador se anula, como em $(5, 0)$ no círculo, a curva pode ter tangente vertical e nenhum $y'$.
- **"A derivação logarítmica funciona para qualquer $y$."** Ela exige $y \neq 0$ (use $\ln\lvert y \rvert$ se $y < 0$), e $x^x$ só está definida como função real, aqui, para $x > 0$.

## Resumo

A exponencial $b^x$ tem derivada $L(b)\,b^x$, e $e$ é a base para a qual $L(e) = 1$, de modo que $\frac{d}{dx}e^x = e^x$ e, em geral, $\frac{d}{dx} b^x = b^x \ln b$. O logaritmo segue da relação de inversa: $\frac{d}{dx}\ln x = \frac{1}{x}$ para $x > 0$, e $\frac{g'}{g}$ para $\ln g$ onde $g > 0$. Nas funções trigonométricas, $\sin' = \cos$, $\cos' = -\sin$ e $\tan' = \frac{1}{\cos^2}$ onde $\cos \neq 0$, tudo em radianos. Com a regra da cadeia, essas derivadas alcançam sigmoides, oscilações e leis de crescimento. A derivação implícita trata curvas dadas por uma equação, com o denominador indicando onde ela falha, e a derivação logarítmica trata expoentes variáveis, dando $\frac{d}{dx}x^x = x^x(\ln x + 1)$ para $x > 0$ e a regra geral da potência para expoentes reais. Essas derivadas completam a caixa de ferramentas para as funções elementares, e a próxima lição, `the-mean-value-theorem-and-monotonicity`, começa a usar derivadas para tirar conclusões sobre o que uma função faz.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.9 Derivatives of Exponential and Logarithmic Functions](https://openstax.org/books/calculus-volume-1/pages/3-9-derivatives-of-exponential-and-logarithmic-functions): derivadas de $e^x$, $\ln x$ e bases gerais, e derivação logarítmica
- [OpenStax Calculus Volume 1, 3.5 Derivatives of Trigonometric Functions](https://openstax.org/books/calculus-volume-1/pages/3-5-derivatives-of-trigonometric-functions): derivadas das seis funções trigonométricas
- [OpenStax Calculus Volume 1, 3.8 Implicit Differentiation](https://openstax.org/books/calculus-volume-1/pages/3-8-implicit-differentiation): derivação implícita e retas tangentes a curvas definidas implicitamente
- [MIT OCW 18.01SC, Session 17: The Exponential Function, its Derivative, and its Inverse](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-b-implicit-differentiation-and-inverse-functions/session-17-the-exponential-function-its-derivative-and-its-inverse/): a função exponencial, sua derivada e sua inversa em videoaulas e notas
- [MIT OCW 18.01SC, Session 19: An Interesting Limit Involving e](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-b-implicit-differentiation-and-inverse-functions/session-19-an-interesting-limit-involving-e/): o limite de $(1 + 1/n)^n$ e sua ligação com $e$
- [Active Calculus, 2.7 Derivatives of functions given implicitly](https://activecalculus.org/single/sec-2-7-implicit.html): derivação implícita com exercícios
