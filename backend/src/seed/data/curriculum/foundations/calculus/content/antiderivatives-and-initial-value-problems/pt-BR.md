---
version: 1.0
updatedAt: 2026-11-04
title: "Primitivas e Problemas de Valor Inicial"
summary: "Reverter a derivação: a família de primitivas, a constante de integração e como uma condição inicial escolhe uma única solução."
---
## Objetivos de Aprendizagem

- Definir uma primitiva em um intervalo e explicar por que a primitiva geral é $F(x) + C$ nesse intervalo, e somente nele.
- Calcular primitivas das famílias básicas e conferir cada resposta derivando-a.
- Resolver problemas de valor inicial de primeira e segunda ordem para $y' = f(x)$, usando as condições para fixar as constantes.
- Reconhecer situações em que uma primitiva não existe, não é elementar ou só vale em parte do domínio.

## Contexto e Motivação

A derivação responde "com que rapidez está mudando?". A antiderivação pergunta o contrário: dada a taxa, qual era a grandeza? Dada a velocidade de um objeto em queda, ache a posição. Dada a taxa de chegada de requisições a um servidor, ache quantas já foram atendidas. Dado o custo marginal de mais uma unidade, ache o custo total. Em todos os casos a taxa determina a resposta só a menos de uma constante, e uma medição (a posição inicial, a contagem inicial) escolhe uma função da família. Esse par de uma equação com um valor inicial é um **problema de valor inicial**, e é o caso mais simples das equações diferenciais de `differential-equations-and-initial-value-problems`.

Esta lição é a leitura inversa das regras de `differentiation-rules-and-the-chain-rule` e `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, e precisa dos fatos de monotonicidade de `the-mean-value-theorem-and-monotonicity`, que são exatamente o que justifica o "$+\,C$". Ela prepara `the-definite-integral-and-riemann-sums`, onde aparece a área, e `the-fundamental-theorem-of-calculus`, onde as duas ideias se encontram.

## Teoria Central

### Definição e a constante de integração

Uma função $F$ é uma **primitiva** (ou antiderivada) de $f$ em um intervalo $I$ se $F'(x) = f(x)$ para todo $x \in I$. Se $F$ é uma primitiva, $F + C$ também é, para qualquer constante $C$, já que a derivada de uma constante é $0$.

Reciprocamente, se $F$ e $G$ são ambas primitivas de $f$ em um intervalo $I$, então $(F - G)' = 0$ em $I$, e a consequência do Teorema do Valor Médio vista em `the-mean-value-theorem-and-monotonicity` diz que $F - G$ é constante em $I$. Logo, em um intervalo, toda primitiva tem a forma $F(x) + C$. A notação

$$\int f(x)\,dx = F(x) + C$$

representa toda essa família, chamada de **integral indefinida**. A palavra "intervalo" é essencial. Para $f(x) = \frac1x$, cujo domínio é $(-\infty, 0) \cup (0, \infty)$, a função

$$F(x) = \begin{cases} \ln x + 1 & x > 0 \\ \ln\lvert x\rvert + 5 & x < 0 \end{cases}$$

é derivável em todo o domínio com $F' = \frac1x$, mas não tem a forma $\ln\lvert x\rvert + C$ com um único $C$. Em cada um dos dois intervalos existe uma constante própria.

### A tabela básica, lida ao contrário

Cada linha é uma fórmula de derivada rodada ao contrário. Toda resposta pode e deve ser conferida derivando-a.

- $\int x^n\,dx = \frac{x^{n+1}}{n+1} + C$ para $n \ne -1$ (em $(0, \infty)$ se $n$ não for inteiro; para $n$ inteiro negativo a fórmula vale em $(-\infty, 0)$ e em $(0, \infty)$ separadamente, com uma constante independente em cada um).
- $\int \frac1x\,dx = \ln\lvert x\rvert + C$ em cada um de $(-\infty, 0)$ e $(0, \infty)$. O valor absoluto é necessário porque $\frac{d}{dx}\ln(-x) = \frac1x$ também.
- $\int e^x\,dx = e^x + C$, $\int \cos x\,dx = \sin x + C$, $\int \sin x\,dx = -\cos x + C$, $\int \sec^2 x\,dx = \tan x + C$, $\int \frac{dx}{1 + x^2} = \arctan x + C$. A fórmula de $\sec^2 x$ vale em cada intervalo $\left(-\frac\pi2 + k\pi, \frac\pi2 + k\pi\right)$ separadamente, de novo com constante independente em cada um, pelo mesmo motivo de $\frac1x$.
- Linearidade: $\int (a f + b g)\,dx = a\int f\,dx + b\int g\,dx$.
- Para uma função interna linear, $\int \cos(kx)\,dx = \frac{\sin(kx)}{k} + C$ com $k \ne 0$: o fator $\frac1k$ desfaz o fator $k$ que a regra da cadeia produz.

Não existe fórmula simples para a integral de um produto: $\int f g\,dx \ne \int f\,dx \cdot \int g\,dx$. A integração por partes é a regra do produto ao contrário, mas é um método com contabilidade própria, não uma fórmula para $\int fg\,dx$. Os métodos para produtos e composições chegam em `integration-by-substitution-and-by-parts`.

### Quando não há primitiva disponível

Nem toda função tem uma. Uma função com salto não pode ser derivada de uma primitiva em um intervalo que contém o salto. Tome $f(x) = \operatorname{sgn}(x)$, que vale $-1$ para $x < 0$ e $1$ para $x > 0$. Se $F' = f$ em $\mathbb{R}$, então $F$ é derivável e portanto contínua, e de cada lado $F$ é $\lvert x\rvert$ mais uma constante, e a continuidade em $0$ força a mesma constante: $F(x) = \lvert x\rvert + C$. Mas $\lvert x\rvert$ tem uma quina em $0$, então $F'(0)$ não existe. Não há primitiva em $\mathbb{R}$.

Funções contínuas sempre têm primitivas (isso é garantido por `the-fundamental-theorem-of-calculus`), mas a primitiva pode não ter fórmula em funções elementares. O caso clássico é $e^{-x^2}$, cujas primitivas são $\frac{\sqrt\pi}{2}\operatorname{erf}(x) + C$, onde a função erro $\operatorname{erf}$ é definida por uma integral e não por uma forma fechada. É por isso que probabilidades da densidade Normal são consultadas em tabelas ou calculadas numericamente.

### Problemas de valor inicial

Um **problema de valor inicial** une $y' = f(x)$ a uma condição $y(x_0) = y_0$. Integre para obter $y = F(x) + C$ e depois substitua a condição para achar $C$. A solução é única em qualquer intervalo que contenha $x_0$ e no qual $f$ tenha primitiva, porque duas soluções diferem por uma constante que a condição obriga a ser $0$. Para um problema de segunda ordem $y'' = f(x)$, integre duas vezes para obter duas constantes e forneça duas condições, como $y(0)$ e $y'(0)$.

## Exemplos Resolvidos

### Exemplo 1: primitivas, conferidas

Ache a primitiva geral de $f(x) = 3\sqrt x + \cos 3x - e^{-x}$ em $(0, \infty)$. Termo a termo: $\int 3x^{1/2}\,dx = 2x^{3/2}$, $\int \cos 3x\,dx = \frac13\sin 3x$ e $\int -e^{-x}\,dx = e^{-x}$ (a derivada de $e^{-x}$ é $-e^{-x}$). Então

$$F(x) = 2x^{3/2} + \tfrac13\sin 3x + e^{-x} + C.$$

Conferência: $F'(x) = 3x^{1/2} + \cos 3x - e^{-x}$. É o original, como se exigia.

### Exemplo 2: um problema de valor inicial de primeira ordem

Resolva $F'(x) = 3x^2 - 4x + 5$ com $F(1) = 2$. Integrando: $F(x) = x^3 - 2x^2 + 5x + C$. A condição dá $F(1) = 1 - 2 + 5 + C = 4 + C = 2$, logo $C = -2$ e $F(x) = x^3 - 2x^2 + 5x - 2$. Confira os dois requisitos: $F(1) = 1 - 2 + 5 - 2 = 2$ e $F'(x) = 3x^2 - 4x + 5$.

### Exemplo 3: movimento com aceleração constante

Uma bola é lançada para cima, de uma altura de $5$ m, a $20$ m/s. Com aceleração $s''(t) = -9{,}8$ m/s$^2$ (desprezando a resistência do ar), ache a posição. Integrando uma vez: $s'(t) = -9{,}8t + C_1$, e $s'(0) = 20$ dá $C_1 = 20$. Integrando de novo: $s(t) = -4{,}9t^2 + 20t + C_2$, e $s(0) = 5$ dá $C_2 = 5$. Então

$$s(t) = -4{,}9t^2 + 20t + 5.$$

O pico ocorre onde $s'(t) = 0$: $t = \frac{20}{9{,}8} \approx 2{,}041$ s, na altura $s \approx 25{,}41$ m. A bola cai quando $s(t) = 0$. A equação quadrática tem raízes $t \approx 4{,}318$ e $t \approx -0{,}236$. Só a positiva interessa, pois o modelo começa em $t = 0$. Cada condição fixa a sua constante: $s'(0)$ fixa $C_1$ depois da primeira integração, e $s(0)$ fixa $C_2$ depois da segunda.

### Exemplo 4: uma condição inicial em um domínio dividido

Resolva $y' = \frac1x$ com $y(-2) = 3$. A condição está em um $x$ negativo, então o intervalo que contém $x_0 = -2$ e no qual $\frac1x$ está definida é $(-\infty, 0)$. Ali, $y = \ln\lvert x\rvert + C$, e $y(-2) = \ln 2 + C = 3$ dá $C = 3 - \ln 2 \approx 2{,}307$. Então $y = \ln\lvert x\rvert + 3 - \ln 2$ em $(-\infty, 0)$. O problema não diz nada sobre $x > 0$, e a solução não pode ser estendida através de $x = 0$, onde $\frac1x$ não está definida. Escrever $y = \ln x + 3 - \ln 2$ estaria errado duas vezes: $\ln x$ não está definido onde a condição é dada, e a constante do outro lado não é determinada.

### Exemplo 5: primitiva exata versus simulação passo a passo

Um loop de jogo atualiza a bola do Exemplo 3 em passos de tamanho $\Delta t$. O Euler explícito usa a velocidade antiga para atualizar a posição, $s \leftarrow s + v\,\Delta t$, e depois $v \leftarrow v - 9{,}8\,\Delta t$. O Euler semi-implícito atualiza $v$ primeiro. Em $t = 2$, o resultado exato pela primitiva é $s(2) = -19{,}6 + 40 + 5 = 25{,}4$ e $s'(2) = 0{,}4$.

```text
dt      explicit Euler   semi-implicit Euler   exact
0.1     26.380           24.420                25.400
0.01    25.498           25.302                25.400
```

Os dois métodos acertam a velocidade exatamente (aceleração constante), enquanto o erro de posição em $t = 2$ é $\pm 9{,}8\,\Delta t$ (mais no explícito, menos no semi-implícito): ele diminui em proporção a $\Delta t$. Quando a primitiva está disponível em forma fechada, ela é a referência contra a qual se julga um integrador numérico.

## Equívocos Comuns e Armadilhas

- **Esquecer o $+\,C$.** Sem ele você nomeou uma primitiva só, e uma condição inicial não tem o que ajustar.
- **"$\int \frac1x\,dx = \ln x + C$."** Vale apenas para $x > 0$. O enunciado geral é $\ln\lvert x\rvert + C$ em cada intervalo, com constantes possivelmente diferentes.
- **Uma só constante para um domínio desconexo.** A unicidade de $C$ vem do Teorema do Valor Médio e exige um intervalo.
- **Regra da cadeia ao contrário sem a derivada interna.** A derivada de $\sin(x^2)$ é $2x\cos(x^2)$, então $\int \cos(x^2)\,dx$ não é $\sin(x^2)$ a menos de um fator constante. O atalho $\frac{\sin(kx)}{k}$ funciona só porque $kx$ tem derivada constante.
- **"Todo problema de valor inicial tem exatamente uma solução."** Para $y' = f(x)$ com $f$ contínua em um intervalo, tem: a existência vem da primitiva, a unicidade vem da constante. Sem continuidade, a existência pode falhar: $y' = \operatorname{sgn}(x)$ com $y(0) = 0$ não tem solução em $\mathbb{R}$. Em equações em que o lado direito depende de $y$, a unicidade pode falhar: $y' = 3y^{2/3}$ (com $y^{2/3}$ lido como o quadrado da raiz cúbica real) com $y(0) = 0$ tem como soluções tanto $y = 0$ quanto $y = x^3$. Existência e unicidade são tratadas em `differential-equations-and-initial-value-problems`.
- **Primitiva versus integral definida.** Uma integral indefinida é uma família de funções. Uma integral definida é um número, apresentado nas próximas lições.

## Resumo

Uma primitiva de $f$ em um intervalo é uma função cuja derivada é $f$ ali. Pelo Teorema do Valor Médio, duas primitivas em um intervalo diferem por uma constante, então a primitiva geral é $F + C$, e a exigência do intervalo é real: $\frac1x$ dá constantes independentes em $(-\infty, 0)$ e em $(0, \infty)$. A tabela básica é a tabela de derivadas lida ao contrário, e toda resposta se verifica derivando. Algumas funções não têm primitiva em um intervalo (um salto, como $\operatorname{sgn}(x)$), e outras têm uma que nenhuma fórmula elementar expressa ($e^{-x^2}$). Um problema de valor inicial usa condições para fixar as constantes, uma por integração, e a solução escolhida vive no intervalo que contém o ponto inicial. Primitivas de aceleração constante dão o movimento exato e servem de referência para integradores numéricos. A próxima lição, `the-definite-integral-and-riemann-sums`, apresenta a área, e depois `the-fundamental-theorem-of-calculus` explica como ela se liga ao que você fez aqui.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.10: Antiderivatives](https://openstax.org/books/calculus-volume-1/pages/4-10-antiderivatives): primitivas, a integral indefinida, a tabela de fórmulas básicas e problemas de valor inicial.
- [MIT OCW 18.01SC, Unit 2, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): sessões de aula sobre primitivas e introdução às equações diferenciais.
