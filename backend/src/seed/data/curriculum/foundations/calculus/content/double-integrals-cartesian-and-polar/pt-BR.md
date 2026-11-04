---
version: 1.0
updatedAt: 2026-11-04
title: "Integrais Duplas, Cartesianas e Polares"
summary: "Integrais duplas sobre retângulos e regiões gerais, integrais iteradas e o teorema de Fubini, troca da ordem de integração e a mudança para coordenadas polares que calcula a integral gaussiana."
---
## Objetivos de Aprendizagem

- Calcular uma integral dupla como integral iterada sobre um retângulo ou sobre uma região limitada por curvas, e trocar a ordem de integração redescrevendo a região.
- Enunciar as hipóteses do teorema de Fubini e reconhecer um caso em que as duas integrais iteradas discordam porque uma hipótese falha.
- Enunciar o teorema de mudança de variáveis com suas condições, calcular um jacobiano e deduzir o fator $r$ das coordenadas polares.
- Calcular $\int_{-\infty}^{\infty} e^{-x^2}\, dx$ passando para coordenadas polares e usar o resultado para mostrar que a densidade Normal integra 1.

## Contexto e Motivação

Uma integral dupla soma uma quantidade espalhada por uma região do plano: o volume sob uma superfície $z = f(x, y)$, ou a massa de uma placa cuja densidade varia de ponto a ponto. Como em `the-definite-integral-and-riemann-sums`, ela é definida como limite de somas e é calculada reduzindo-a a duas integrais simples.

A lição `the-normal-distribution` escreve a densidade $\frac{1}{\sigma\sqrt{2\pi}}e^{-(x-\mu)^2/(2\sigma^2)}$ e diz apenas que a constante na frente faz a área valer 1. Essa constante não é óbvia, porque $e^{-x^2}$ não tem primitiva escrita com funções elementares, então o teorema fundamental do cálculo não calcula a integral diretamente. O caminho alternativo usa duas dimensões: o quadrado da integral é uma integral dupla sobre o plano, e em coordenadas polares ela fica fácil. A mesma ideia dá o método de Box-Muller para transformar números aleatórios uniformes em Normais.

## Teoria Central

### Integrais duplas sobre retângulos

Divida um retângulo $R = [a, b] \times [c, d]$ em sub-retângulos pequenos de área $\Delta A$, escolha um ponto de amostra em cada um e forme $\sum f(x_i^*, y_j^*)\, \Delta A$. Quando as somas convergem para o mesmo número à medida que os sub-retângulos encolhem, o limite é $\iint_R f\, dA$. Ele existe quando $f$ é contínua em $R$, e também quando $f$ é limitada e descontínua apenas ao longo de um número finito de curvas suaves. Onde $f \ge 0$, é o volume sob o gráfico.

### Integrais iteradas e o teorema de Fubini

**Teorema de Fubini (caso contínuo).** Se $f$ é contínua no retângulo fechado $R = [a, b] \times [c, d]$, então

$$\iint_R f\, dA = \int_a^b \left(\int_c^d f(x, y)\, dy\right) dx = \int_c^d \left(\int_a^b f(x, y)\, dx\right) dy.$$

As hipóteses são um retângulo fechado e limitado e a continuidade. A versão para funções integráveis em geral (integral de Lebesgue) troca a continuidade pela integrabilidade absoluta: se $\iint |f|\, dA < \infty$, as duas integrais iteradas existem e valem $\iint f\, dA$. O **teorema de Tonelli** cobre $f \ge 0$: as duas integrais iteradas sempre igualam a integral dupla, como valores em $[0, \infty]$, sem exigir finitude.

Quando a hipótese falha, a conclusão pode falhar. Tome $f(x, y) = \dfrac{x^2 - y^2}{(x^2 + y^2)^2}$ em $(0, 1)^2$, que explode na origem. Como $\frac{\partial}{\partial x}\frac{x}{x^2 + y^2} = \frac{y^2 - x^2}{(x^2 + y^2)^2}$, integrar primeiro em $x$ dá $-\frac{1}{1 + y^2}$, e então

$$\int_0^1\!\!\int_0^1 f\, dx\, dy = -\frac{\pi}{4}, \qquad \text{mas} \qquad \int_0^1\!\!\int_0^1 f\, dy\, dx = +\frac{\pi}{4}.$$

Os dois valores foram confirmados numericamente. A função não é absolutamente integrável: $\iint |f|\, dA$ sobre $[\varepsilon, 1]^2$ cresce cerca de $2{,}3$ cada vez que $\varepsilon$ encolhe dez vezes (tende a $\ln 10$ por passo), o que é divergência logarítmica. Sem integrabilidade absoluta, a ordem pode importar.

### Regiões gerais e troca da ordem

Uma região é do **tipo I** se é $a \le x \le b$, $g_1(x) \le y \le g_2(x)$ com $g_1, g_2$ contínuas, e do **tipo II** se os papéis de $x$ e $y$ são trocados. Para $f$ contínua em tal região $D$,

$$\iint_D f\, dA = \int_a^b \int_{g_1(x)}^{g_2(x)} f(x, y)\, dy\, dx.$$

Trocar a ordem não é trocar os limites. A região precisa ser redescrita pelo outro lado, então o esboço vem primeiro: leia os valores extremos da nova variável externa e depois os limites da interna como funções dela.

### Mudança de variáveis e o jacobiano

Suponha que $T(u, v) = (x(u, v), y(u, v))$ leve uma região $S$ do plano $uv$ sobre uma região $D$ do plano $xy$. O **jacobiano** é o determinante

$$\frac{\partial(x, y)}{\partial(u, v)} = \det\begin{pmatrix} x_u & x_v \\ y_u & y_v \end{pmatrix}.$$

**Mudança de variáveis.** Se $T$ é continuamente diferenciável ($C^1$), injetora no interior de $S$ e tem jacobiano não nulo no interior de $S$, e se $f$ é contínua em $D$, então

$$\iint_D f(x, y)\, dA = \iint_S f\big(x(u, v), y(u, v)\big)\,\left\lvert \frac{\partial(x, y)}{\partial(u, v)} \right\rvert du\, dv.$$

A razão é a aproximação linear local de `partial-derivatives-and-the-multivariable-chain-rule`: um pequeno retângulo $\Delta u \times \Delta v$ é levado quase num paralelogramo de área $\lvert\det\rvert\, \Delta u\, \Delta v$. Para a aplicação linear $x = (u + v)/2$, $y = (u - v)/2$ o determinante é $-1/2$, então as áreas são reduzidas à metade e o fator é $1/2$.

Para **coordenadas polares**, $x = r\cos\theta$ e $y = r\sin\theta$ dão

$$\frac{\partial(x, y)}{\partial(r, \theta)} = \det\begin{pmatrix} \cos\theta & -r\sin\theta \\ \sin\theta & r\cos\theta \end{pmatrix} = r,$$

logo $dA = r\, dr\, d\theta$, o fator antecipado em `polar-coordinates`. A aplicação de $[0, R] \times [0, 2\pi]$ no disco de raio $R$ quebra as hipóteses na fronteira: o segmento inteiro $r = 0$ cai na origem, as semirretas $\theta = 0$ e $\theta = 2\pi$ coincidem, e $r = 0$ anula o jacobiano. Esses conjuntos têm área zero e o teorema só exige o interior, então para $f$ contínua a integral não muda.

Uma hipótese que importa é a injetividade. Se $\theta$ percorre $[0, 4\pi]$, o disco unitário é coberto duas vezes: $\int_0^{4\pi}\int_0^1 r\, dr\, d\theta = 2\pi$, o dobro da área verdadeira $\pi$.

### Regiões ilimitadas

Uma integral sobre o plano todo é um limite, como em `improper-integrals`: integra-se sobre um disco ou quadrado que cresce, e depois deixa-se crescer sem limite. Para $f \ge 0$ o resultado não depende da família crescente usada. Para uma função que muda de sinal, a integrabilidade absoluta é a exigência segura.

## Exemplos Resolvidos

### Exemplo 1: escolhendo a ordem num retângulo

Calcule $\iint_R x e^{xy}\, dA$ em $R = [0, 1] \times [0, 2]$. O integrando é contínuo num retângulo fechado, então qualquer ordem vale. Integrar $y$ primeiro é fácil:

$$\int_0^2 x e^{xy}\, dy = e^{2x} - 1, \qquad \int_0^1 (e^{2x} - 1)\, dx = \frac{e^2 - 3}{2} \approx 2{,}1945.$$

Integrar $x$ primeiro exige integração por partes e dá $\frac{(y - 1)e^y + 1}{y^2}$, um segundo passo mais difícil. A avaliação simbólica nas duas ordens dá $(e^2 - 3)/2$, e a quadratura numérica dá $2{,}19453$.

### Exemplo 2: uma integral que só funciona depois de trocar a ordem

Calcule $\int_0^1\!\int_x^1 e^{y^2}\, dy\, dx$. A integral interna é $\frac{\sqrt\pi}{2}(\operatorname{erfi}(1) - \operatorname{erfi}(x))$, não elementar. A região é $0 \le x \le y \le 1$, um triângulo. Descrita do outro lado, $0 \le y \le 1$ e $0 \le x \le y$, então

$$\int_0^1\!\int_0^y e^{y^2}\, dx\, dy = \int_0^1 y e^{y^2}\, dy = \frac{e - 1}{2} \approx 0{,}8591.$$

A quadratura numérica da forma original devolve $0{,}85914$.

### Exemplo 3: volume sob um paraboloide

Ache o volume entre $z = 4 - x^2 - y^2$ e o plano $z = 0$. A superfície encontra o plano em $r = 2$, então $D$ é o disco $r \le 2$ e

$$V = \int_0^{2\pi}\!\int_0^2 (4 - r^2)\, r\, dr\, d\theta = 2\pi\left[2r^2 - \frac{r^4}{4}\right]_0^2 = 8\pi \approx 25{,}1327.$$

Uma integral dupla numérica sobre o disco em $x, y$ dá $25{,}13274$. Omitir o jacobiano, $\int_0^{2\pi}\int_0^2 (4 - r^2)\, dr\, d\theta$, dá $32\pi/3 \approx 33{,}51$, que está errado.

### Exemplo 4: a integral gaussiana

Seja $I = \int_{-\infty}^{\infty} e^{-x^2}\, dx$. Então

$$I^2 = \int_{-\infty}^{\infty} e^{-x^2}\, dx \int_{-\infty}^{\infty} e^{-y^2}\, dy = \iint_{\mathbb{R}^2} e^{-(x^2 + y^2)}\, dA.$$

A passagem de um produto para uma integral dupla é Fubini na forma de Tonelli: o integrando é positivo, então nenhuma finitude é assumida. Calcule a integral dupla como limite das integrais sobre o disco $D_R$ de raio $R$ (permitido porque o integrando é não negativo). Em $D_R$ valem as coordenadas polares, com $e^{-(x^2+y^2)} = e^{-r^2}$ contínua:

$$\iint_{D_R} e^{-(x^2 + y^2)}\, dA = \int_0^{2\pi}\!\int_0^R e^{-r^2}\, r\, dr\, d\theta = 2\pi\cdot\frac{1 - e^{-R^2}}{2} = \pi\big(1 - e^{-R^2}\big) \to \pi.$$

O fator extra $r$ é o que torna a integral interna elementar: $r\, e^{-r^2}$ tem primitiva $-\tfrac{1}{2}e^{-r^2}$. Assim $I^2 = \pi$ e, como $I > 0$, $I = \sqrt\pi \approx 1{,}77245$, o que a quadratura numérica confirma. Quadrados também esgotam o plano e dão o mesmo limite:

```text
R   disco: pi(1 - e^-R^2)   quadrado [-R,R]^2: pi erf(R)^2
1   1.9859                  2.2310
2   3.0841                  3.1123
3   3.1412                  3.1415     (pi = 3.1416)
```

**De volta à densidade Normal.** Substituindo $u = (x - \mu)/(\sigma\sqrt 2)$, de modo que $dx = \sigma\sqrt 2\, du$,

$$\int_{-\infty}^{\infty} e^{-(x - \mu)^2/(2\sigma^2)}\, dx = \sigma\sqrt{2}\int_{-\infty}^{\infty} e^{-u^2}\, du = \sigma\sqrt{2\pi}.$$

Dividir por $\sigma\sqrt{2\pi}$ produz área total 1, que é a constante de `the-normal-distribution`. Para $\mu = 175$ e $\sigma = 7$ uma integral numérica dá $17{,}5464 = 7\sqrt{2\pi}$. Isso deduz a constante de normalização; por que o formato de sino aparece é trabalho do Teorema Central do Limite.

### Exemplo 5: Box-Muller

Se $X, Y$ são Normais padrão independentes, sua densidade conjunta é $\frac{1}{2\pi}e^{-(x^2 + y^2)/2}$. Em forma polar a densidade vira $\frac{1}{2\pi}e^{-r^2/2}\, r\, dr\, d\theta$: o ângulo é uniforme em $[0, 2\pi)$, e $R$ tem função de distribuição $1 - e^{-r^2/2}$. Invertê-la dá $R = \sqrt{-2\ln U_1}$ e $\Theta = 2\pi U_2$ para $U_1, U_2$ uniformes, com $X = R\cos\Theta$ e $Y = R\sin\Theta$. Numa execução com $10^6$ pares (semente 7) as variâncias amostrais foram $0{,}9986$ e $0{,}9980$, a correlação foi $-0{,}00003$, e a fração com $\lvert X\rvert \le 1$ foi $0{,}6826$ contra o valor exato $0{,}6827$.

## Equívocos Comuns e Armadilhas

- **"Fubini sempre permite trocar a ordem."** Ele exige continuidade num retângulo fechado (ou integrabilidade absoluta, ou $f \ge 0$). O exemplo com $-\pi/4$ e $+\pi/4$ mostra a ordem mudando a resposta.
- **"Trocar a ordem é trocar os limites."** Os novos limites vêm do desenho da região, não da troca de números.
- **"Coordenadas polares só trocam $dx\, dy$ por $dr\, d\theta$."** O elemento de área é $r\, dr\, d\theta$, e no Exemplo 3 o $r$ ausente mudou a resposta de $8\pi$ para $32\pi/3$. Confira também se a faixa do ângulo cobre a região uma só vez. Um círculo não centrado na origem, como $x^2 + y^2 \le 2x$, vira $0 \le r \le 2\cos\theta$ com $-\pi/2 \le \theta \le \pi/2$.
- **"O fator de escala é o próprio determinante jacobiano."** O determinante pode ser negativo porque registra a orientação, mas o fator é o seu valor absoluto. A aplicação linear acima tem determinante $-1/2$ e fator $1/2$.

## Resumo

Uma integral dupla é um limite de somas, calculada como integral iterada quando Fubini se aplica: continuidade num retângulo fechado, ou integrabilidade absoluta, ou integrando não negativo (Tonelli). Sem isso, as duas ordens podem discordar, como mostra $\pm\pi/4$. Em regiões gerais a ordem se troca redescrevendo a região. Uma mudança de variáveis exige uma aplicação $C^1$ injetora no interior e com jacobiano não nulo ali, e multiplica o integrando por $\lvert\partial(x, y)/\partial(u, v)\rvert$; para coordenadas polares isso é $r$. Com ele, $\iint e^{-(x^2 + y^2)}\, dA = \pi$ dá $\int e^{-x^2}\, dx = \sqrt\pi$, a constante de normalização $\sigma\sqrt{2\pi}$ da densidade Normal e o gerador de Box-Muller.

## Documentation Links

- [OpenStax Calculus Volume 3, 5.1 Double Integrals over Rectangular Regions](https://openstax.org/books/calculus-volume-3/pages/5-1-double-integrals-over-rectangular-regions): definição por somas de Riemann e teorema de Fubini para funções contínuas.
- [OpenStax Calculus Volume 3, 5.2 Double Integrals over General Regions](https://openstax.org/books/calculus-volume-3/pages/5-2-double-integrals-over-general-regions): regiões dos tipos I e II e troca da ordem de integração.
- [OpenStax Calculus Volume 3, 5.3 Double Integrals in Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/5-3-double-integrals-in-polar-coordinates): retângulos polares, o fator $r$ e um exercício sobre a integral gaussiana.
- [OpenStax Calculus Volume 3, 5.7 Change of Variables in Multiple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-7-change-of-variables-in-multiple-integrals): o jacobiano e o teorema de mudança de variáveis com suas hipóteses.
- [MIT OpenCourseWare 18.02SC, Part A: Double Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/3.-double-integrals-and-line-integrals-in-the-plane/part-a-double-integrals/): sessões sobre integrais duplas, troca da ordem, coordenadas polares e mudança de variáveis.
