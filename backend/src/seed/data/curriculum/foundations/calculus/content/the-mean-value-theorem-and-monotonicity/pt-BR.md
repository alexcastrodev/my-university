---
version: 1.0
updatedAt: 2026-11-04
title: "O Teorema do Valor Médio e a Monotonicidade"
summary: "O teorema de Rolle e o Teorema do Valor Médio, e o que eles justificam: derivada positiva significa função crescente, e derivada nula em um intervalo significa função constante."
---
## Objetivos de Aprendizagem

- Enunciar o teorema de Rolle e o Teorema do Valor Médio com todas as hipóteses, explicando para que serve cada uma.
- Mostrar, com uma função concreta, que a conclusão falha quando se tira a continuidade no intervalo fechado ou a derivabilidade no intervalo aberto.
- Usar o Teorema do Valor Médio para provar que derivada nula em um intervalo significa função constante, e que duas funções com a mesma derivada diferem por uma constante.
- Decidir onde uma função cresce ou decresce pelo sinal da derivada, e explicar por que a palavra "intervalo" importa.
- Transformar o teorema em ferramenta quantitativa: limitar a variação de uma função a partir de uma cota para a derivada.

## Contexto e Motivação

A derivada é informação local: a inclinação em um ponto. A maior parte das perguntas é global. A função é maior em $b$ do que em $a$? Quanto, no máximo? Se dois carros largam juntos e o primeiro nunca é mais lento que o segundo, o segundo pode estar na frente na chegada? O Teorema do Valor Médio é a ponte entre o local e o global: se a função é suficientemente bem comportada, a taxa média de variação em um intervalo é igual à taxa instantânea em algum ponto dentro dele.

As consequências aparecem o tempo todo: o teste da primeira derivada para extremos, o fato de que uma função fica determinada pela derivada a menos de uma constante e as cotas de erro dos métodos numéricos dependem dele. Em computação, a mesma ideia surge como cota de Lipschitz: se $\lvert f'\rvert \le L$ em todo ponto, mudar a entrada em $\delta$ muda a saída em no máximo $L\delta$. Aplicado a um gradiente, isso está por trás das regras de passo do gradient descent; aplicado a uma função de ativação, limita quanto ruído na entrada pode chegar à saída. Esta lição parte de `the-derivative-as-a-rate-of-change` e `continuity-and-the-intermediate-value-theorem`, e prepara `extrema-concavity-and-optimization`.

## Teoria Central

### A observação de Fermat

Suponha que $f$ tenha um máximo local em um ponto interior $c$ e que $f'(c)$ exista. Para $h > 0$ pequeno, o quociente $\frac{f(c+h) - f(c)}{h}$ é no máximo $0$, e para $h < 0$ pequeno ele é no mínimo $0$. O limite existe, então é ao mesmo tempo $\le 0$ e $\ge 0$, logo $f'(c) = 0$. O mesmo argumento vale para um mínimo local. A hipótese "$f'(c)$ existe" importa: $\lvert x\rvert$ tem mínimo em $0$ sem que a derivada seja zero, porque ela não existe ali.

### O teorema de Rolle

**Teorema de Rolle.** Seja $f$ contínua em $[a, b]$ e derivável em $(a, b)$, com $f(a) = f(b)$. Então existe $c \in (a, b)$ com $f'(c) = 0$.

A ideia: uma função contínua em um intervalo fechado atinge um valor máximo e um mínimo (o Teorema de Weierstrass, ou do Valor Extremo, enunciado com cuidado na próxima lição). Se os dois forem iguais a $f(a)$, a função é constante e qualquer ponto serve. Caso contrário, um deles difere de $f(a) = f(b)$, logo é atingido em um ponto interior, e a observação de Fermat dá $f'(c) = 0$.

### O Teorema do Valor Médio

**Teorema do Valor Médio (TVM).** Seja $f$ contínua em $[a, b]$ e derivável em $(a, b)$. Então existe $c \in (a, b)$ com

$$f'(c) = \frac{f(b) - f(a)}{b - a}.$$

Demonstração a partir de Rolle: seja $m = \frac{f(b) - f(a)}{b - a}$ e defina $g(x) = f(x) - f(a) - m(x - a)$. É $f$ menos a reta secante, então $g(a) = g(b) = 0$, e $g$ herda a continuidade e a derivabilidade. Rolle dá $c$ com $g'(c) = f'(c) - m = 0$.

Geometricamente, alguma reta tangente é paralela à secante. O teorema não diz onde está $c$, só que existe um; pode haver vários.

### O que falha quando uma hipótese cai

Cada hipótese tem seu papel. Três funções mostram isso.

- $f(x) = \lvert x\rvert$ em $[-1, 1]$: contínua, com $f(-1) = f(1)$, mas não derivável em $0$. Para $x \ne 0$ a derivada é $\pm 1$, nunca $0$. A conclusão de Rolle falha. Em $[-1, 2]$ a inclinação da secante é $\frac{2 - 1}{3} = \frac13$, mas $f' \in \{-1, 1\}$ onde existe, então a conclusão do TVM também falha. Uma única quina basta.
- $f(x) = x - \lfloor x\rfloor$ em $[0, 1]$: vale $x$ em $[0, 1)$ e volta a $0$ em $x = 1$, então $f(0) = f(1) = 0$ e $f$ é derivável em $(0, 1)$, mas não é contínua em $1$. Aqui $f'(x) = 1$ em todo o interior, nunca $0$.
- As hipóteses são suficientes, não necessárias. Seja $f(x) = x^2$ em $[-1, 1)$ e $f(1) = 2$. É descontínua em $1$, e mesmo assim a inclinação da secante é $\frac{2 - 1}{2} = \frac12$ e $f'(c) = 2c = \frac12$ em $c = \frac14$. Falhar uma hipótese deixa o teorema mudo, não torna a conclusão falsa.

### Consequências para a monotonicidade

Seja $I$ um intervalo, e sejam $f$ (e $g$, no item 2) contínuas em $I$ e deriváveis nos pontos interiores.

1. Se $f' = 0$ no interior de $I$, então $f$ é constante em $I$. Para quaisquer $x_1 < x_2$ em $I$, o TVM dá $f(x_2) - f(x_1) = f'(c)(x_2 - x_1) = 0$.
2. Se $f' = g'$ no interior de $I$, então $f - g$ é constante em $I$. Aplique o item 1 a $f - g$, que é contínua em $I$ porque as duas funções são. A continuidade de $g$ em todo $I$ é necessária: em $I = [0, 1]$, tome $f = 0$ e $g = 0$ em $[0, 1)$ com $g(1) = 1$. Então $f' = g'$ em $(0, 1)$, mas $f - g$ não é constante.
3. Se $f' > 0$ no interior de $I$, então $f$ é estritamente crescente em $I$. A mesma fórmula dá $f(x_2) - f(x_1) = f'(c)(x_2 - x_1) > 0$. Se $f' \ge 0$, $f$ é não decrescente. Trocando os sinais, obtém-se decrescente.

Os três valem em um intervalo: as demonstrações precisam que dois pontos quaisquer sejam ligados por um trecho dentro do domínio.

## Exemplos Resolvidos

### Exemplo 1: achando $c$, e um caso que falha

Rolle em $f(x) = x^3 - 3x$ sobre $[-\sqrt3, \sqrt3]$. Os dois valores nas extremidades são $0$, pois $x(x^2 - 3)$ se anula em $x = 0, \pm\sqrt3$. A derivada é $3x^2 - 3 = 3(x - 1)(x + 1)$, nula em $c = \pm 1$, ambos dentro do intervalo. Rolle prometia ao menos um; aqui há dois.

TVM em $f(x) = \sqrt x$ sobre $[1, 4]$: $f$ é contínua em $[1, 4]$ e derivável em $(1, 4)$. A inclinação da secante é $\frac{2 - 1}{3} = \frac13$. Resolvendo $\frac{1}{2\sqrt c} = \frac13$ obtém-se $\sqrt c = \frac32$, logo $c = \frac94 \in (1, 4)$.

Agora um caso que falha. Aqui $x^{2/3}$ significa $(\sqrt[3]{x})^2$, o quadrado da raiz cúbica real, e $x^{-1/3}$ significa $1/\sqrt[3]{x}$, então ambas estão definidas para $x$ negativo. (Em código, `numpy.power(-1.0, 2/3)` devolve `nan`, enquanto `numpy.cbrt(-1.0)**2` dá `1.0`.) A função $g(x) = x^{2/3}$ em $[-1, 1]$ tem $g(-1) = g(1) = 1$ e uma cúspide em $0$, onde $g'$ não existe. Para $x \ne 0$, $g'(x) = \frac{2}{3}x^{-1/3}$ nunca é $0$, então a conclusão de Rolle falha. O hábito a criar: conferir a derivabilidade em todo ponto interior, não só nos típicos.

### Exemplo 2: limitando um valor

Quanto vale $\sqrt{26}$? Aplique o TVM a $\sqrt x$ em $[25, 26]$: $\sqrt{26} - 5 = \frac{1}{2\sqrt c}$ para algum $c \in (25, 26)$. Como $c > 25$, $\sqrt c > 5$, logo $\sqrt{26} - 5 < \frac{1}{10}$, o que dá $\sqrt{26} < 5{,}1$. Agora $\sqrt c < \sqrt{26} < 5{,}1$, então $\sqrt{26} - 5 > \frac{1}{2 \cdot 5{,}1} = \frac{1}{10{,}2} \approx 0{,}09804$. Juntando, $5{,}0980 < \sqrt{26} < 5{,}1$, um intervalo rigoroso que nunca usa o valor de $\sqrt{26}$. O valor verdadeiro é $5{,}09902$.

A mesma técnica prova $e^x > 1 + x$ para $x \ne 0$. Para $x > 0$: $e^x - 1 = e^c x$ com $0 < c < x$, e $e^c > 1$, então $e^x - 1 > x$. Para $x < 0$: $e^x - 1 = e^c x$ com $x < c < 0$, então $e^c < 1$, e multiplicar pelo número negativo $x$ inverte a desigualdade: $e^c x > x$. O sinal de $x$ muda o argumento, por isso os dois casos são escritos.

### Exemplo 3: uma cota de Lipschitz para a sigmoide

A sigmoide logística $\sigma(t) = \frac{1}{1 + e^{-t}}$ tem $\sigma'(t) = \sigma(t)\,(1 - \sigma(t))$. Como $u(1 - u) \le \frac14$ para qualquer $u$, temos $0 < \sigma' \le \frac14$ em toda parte. O TVM então diz que, para quaisquer $a < b$,

$$\lvert\sigma(b) - \sigma(a)\rvert = \sigma'(c)\,(b - a) \le \frac{b - a}{4}.$$

Tome $a = 0{,}5$ e $b = 3$. A diferença verdadeira é $\sigma(3) - \sigma(0{,}5) \approx 0{,}3301$, a cota dá $0{,}625$, e a inclinação da secante é $\approx 0{,}1320$, que é igual a $\sigma'(c)$ em $c \approx 1{,}684$. A cota é folgada aqui, mas vale para qualquer par de entradas, e $\sigma' > 0$ também mostra que $\sigma$ é estritamente crescente.

### Exemplo 4: a constante pode mudar através de um buraco

Seja $h(x) = \arctan x + \arctan\frac1x$, definida para $x \ne 0$. Usando $\frac{d}{dx}\arctan x = \frac{1}{1 + x^2}$, a derivada é $\frac{1}{1 + x^2} + \frac{1}{1 + 1/x^2}\cdot\left(-\frac{1}{x^2}\right) = 0$ para todo $x \ne 0$. Então $h$ é constante em $(0, \infty)$ e constante em $(-\infty, 0)$, mas o domínio não é um intervalo. De fato $h(2) = h(\tfrac12) \approx 1{,}5708 = \frac{\pi}{2}$, enquanto $h(-2) \approx -1{,}5708 = -\frac{\pi}{2}$. Duas constantes, uma para cada pedaço.

## Equívocos Comuns e Armadilhas

- **"Derivada positiva em um ponto significa crescente perto dele."** Falso. Seja $f(x) = \frac{x}{2} + x^2 \sin\frac1x$ com $f(0) = 0$. Então $f'(0) = \frac12 > 0$, mas para $x \ne 0$, $f'(x) = \frac12 + 2x\sin\frac1x - \cos\frac1x$, e em $x = \frac{1}{2\pi k}$ isso vale $-\frac12$. Inclinações negativas aparecem arbitrariamente perto de $0$, então $f$ não é crescente em nenhum intervalo ao redor de $0$. O teorema exige $f' > 0$ em um intervalo inteiro.
- **"Derivada negativa em todo lugar significa decrescente."** Só em um intervalo. $f(x) = \frac1x$ tem $f'(x) = -\frac{1}{x^2} < 0$ em todo ponto do domínio, mas $f(-1) = -1 < f(1) = 1$. Ela decresce em $(-\infty, 0)$ e em $(0, \infty)$ separadamente.
- **"Estritamente crescente exige $f' > 0$ em todo ponto."** Não: $f(x) = x^3$ tem $f'(0) = 0$ e continua estritamente crescente. Derivada positiva é suficiente, não necessária. O que se conclui é que $f'$ não pode se anular em um intervalo inteiro.
- **"O TVM entrega o ponto $c$."** Ele só afirma a existência. No Exemplo 3, $c \approx 1{,}684$ precisou ser calculado à parte, e em geral pode não ter forma fechada.

## Resumo

O teorema de Rolle e o Teorema do Valor Médio exigem continuidade em $[a, b]$ e derivabilidade em $(a, b)$, e Rolle exige também $f(a) = f(b)$. Tirar uma das hipóteses pode fazer a conclusão falhar: $\lvert x\rvert$ tem uma quina, $x - \lfloor x\rfloor$ tem um salto, e nos dois casos nenhum ponto tem a inclinação pedida. Do TVM em um intervalo saem três fatos de uso diário: derivada nula dá função constante, derivadas iguais dão funções que diferem por uma constante, e derivada positiva dá função estritamente crescente. A palavra "intervalo" não pode ser descartada, como mostram $\frac1x$ e $\arctan x + \arctan\frac1x$. O teorema também converte cotas sobre $f'$ em cotas sobre $f$, o que deu um intervalo rigoroso para $\sqrt{26}$ e a constante de Lipschitz $\frac14$ da sigmoide. A próxima lição, `extrema-concavity-and-optimization`, usa esses fatos para transformar sinais de derivadas em máximos e mínimos.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.4: The Mean Value Theorem](https://openstax.org/books/calculus-volume-1/pages/4-4-the-mean-value-theorem): o teorema de Rolle, o Teorema do Valor Médio e os corolários sobre funções constantes e derivadas iguais.
- [OpenStax Calculus Volume 1, 4.5: Derivatives and the Shape of a Graph](https://openstax.org/books/calculus-volume-1/pages/4-5-derivatives-and-the-shape-of-a-graph): como o sinal da derivada decide os intervalos de crescimento e decrescimento.
- [MIT OCW 18.01SC, Unit 2, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): sessões de aula que introduzem e usam o Teorema do Valor Médio.
