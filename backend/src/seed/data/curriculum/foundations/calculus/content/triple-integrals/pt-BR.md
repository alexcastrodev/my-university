---
version: 1.0
updatedAt: 2026-11-04
title: "Integrais Triplas"
summary: "Integrais triplas em coordenadas cartesianas, cilíndricas e esféricas, com volume e massa como aplicações e o determinante jacobiano como fator de escala de uma mudança de variáveis."
---
## Objetivos de Aprendizagem

- Montar uma integral tripla sobre uma caixa ou sobre um sólido limitado por superfícies, escolhendo a ordem de integração e escrevendo cada limite como função das variáveis que ficam fora dele.
- Enunciar as condições sob as quais uma integral tripla pode ser calculada em qualquer ordem, e as condições do teorema de mudança de variáveis em três dimensões.
- Calcular um jacobiano $3 \times 3$ e deduzir os fatores $r$ (cilíndricas) e $\rho^2\sin\varphi$ (esféricas), incluindo a faixa de $\varphi$ que torna o fator válido.
- Calcular volume e massa, e estimar um volume por amostragem Monte Carlo, notando como o erro escala.

## Contexto e Motivação

Uma integral tripla soma uma quantidade espalhada por um sólido: a massa de um corpo cuja densidade muda de ponto a ponto, o volume de uma região curva demais para fatiar, ou a posição do seu centro de massa. Com $f = 1$ ela dá o volume, a mesma grandeza que o fatiamento calcula em `applications-area-volume-and-average-value`, agora sem precisar de uma fórmula para a seção transversal.

O trabalho tem duas partes: descrever o sólido e escolher as coordenadas em que essa descrição é simples. Uma bola é incômoda em $x, y, z$, pois os limites de $y$ dependem de $x$ por uma raiz quadrada e os de $z$ dependem de ambos, mas em coordenadas esféricas ela é uma caixa. A lição anterior, `double-integrals-cartesian-and-polar`, construiu as ferramentas usadas aqui: integrais iteradas, o teorema de Fubini e o jacobiano. Esta lição estende cada uma delas por uma dimensão.

## Teoria Central

### Integrais triplas sobre caixas

Para uma caixa $B = [a, b] \times [c, d] \times [e, f]$, divida-a em caixas pequenas de volume $\Delta V$, amostre $f$ em cada uma e some $f\,\Delta V$. O limite, se existe, é $\iiint_B f\, dV$, e ele existe quando $f$ é contínua em $B$. O **teorema de Fubini** diz então que, quando $f$ é contínua na caixa fechada, a integral é igual a uma integral iterada em qualquer uma das seis ordens de $x, y, z$. Como em duas dimensões, a versão geral exige $\iiint |f|\, dV < \infty$, e Tonelli cobre $f \ge 0$. Uma função que não cumpre isso pode dar valores iterados diferentes em ordens diferentes, como mostra o exemplo da lição anterior.

### Regiões sólidas

Um sólido $E$ é **do tipo 1** se fica entre duas superfícies sobre uma região plana $D$:

$$E = \{(x, y, z) : (x, y) \in D,\ u_1(x, y) \le z \le u_2(x, y)\},$$

com $u_1, u_2$ contínuas e $D$ uma região do tipo I ou II. Para $f$ contínua em $E$,

$$\iiint_E f\, dV = \iint_D \left(\int_{u_1(x, y)}^{u_2(x, y)} f(x, y, z)\, dz\right) dA.$$

A regra para os limites é que a integral mais interna pode depender das duas variáveis externas, a do meio da mais externa, e a mais externa apenas de constantes. Duas aplicações usam isso diretamente. O **volume** de $E$ é $\iiint_E 1\, dV$. Para uma densidade $\rho(x, y, z)$ a **massa** é $M = \iiint_E \rho\, dV$, e a coordenada $x$ do centro de massa é $\bar x = \frac{1}{M}\iiint_E x\,\rho\, dV$, e de modo análogo $\bar y$ e $\bar z$.

### Mudança de variáveis em três dimensões

Se $T(u, v, w) = (x, y, z)$ leva um sólido $S$ sobre $E$, o jacobiano é

$$\frac{\partial(x, y, z)}{\partial(u, v, w)} = \det\begin{pmatrix} x_u & x_v & x_w \\ y_u & y_v & y_w \\ z_u & z_v & z_w \end{pmatrix}.$$

**Mudança de variáveis.** Se $T$ é $C^1$, injetora no interior de $S$ e tem jacobiano não nulo no interior de $S$, e se $f$ é contínua em $E$, então

$$\iiint_E f\, dV = \iiint_S f\big(T(u, v, w)\big)\,\left\lvert \frac{\partial(x, y, z)}{\partial(u, v, w)} \right\rvert du\, dv\, dw.$$

O determinante é o fator de escala do volume: uma pequena caixa $\Delta u \times \Delta v \times \Delta w$ é levada, em primeira ordem, a um paralelepípedo gerado pelas três colunas da matriz, e o volume desse paralelepípedo é o valor absoluto do determinante vezes $\Delta u\,\Delta v\,\Delta w$. Como em duas dimensões, os pontos excepcionais onde a injetividade ou o jacobiano não nulo falham devem formar um conjunto de volume zero.

### Coordenadas cilíndricas

Mantenha $z$ e use coordenadas polares no plano $xy$: $x = r\cos\theta$, $y = r\sin\theta$, $z = z$. O jacobiano é $r$, então $dV = r\, dz\, dr\, d\theta$. A aplicação é injetora para $r > 0$ e $\theta \in [0, 2\pi)$, e o jacobiano só se anula no eixo $r = 0$, que tem volume zero. É a escolha quando o sólido tem um eixo de simetria, como em `polar-coordinates`, mas levado para o espaço.

### Coordenadas esféricas

Seja $\rho \ge 0$ a distância até a origem, $\varphi$ o ângulo a partir do eixo $z$ positivo e $\theta$ o azimute, como nas coordenadas polares:

$$x = \rho\sin\varphi\cos\theta, \qquad y = \rho\sin\varphi\sin\theta, \qquad z = \rho\cos\varphi.$$

O jacobiano em relação a $(\rho, \varphi, \theta)$ é $\rho^2\sin\varphi$, então $dV = \rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta$. A convenção importa: esta lição, como o OpenStax, usa $\varphi$ para o ângulo a partir de $z$, enquanto muitos textos de física trocam os nomes $\theta$ e $\varphi$, então uma fórmula de outra fonte precisa ser conferida antes do uso. O fator $\rho^2\sin\varphi$ só é não negativo porque $\varphi \in [0, \pi]$, e a aplicação é injetora em $\rho > 0$, $0 < \varphi < \pi$, $\theta \in [0, 2\pi)$. O jacobiano é zero em $\rho = 0$ e no eixo $z$ ($\sin\varphi = 0$), um conjunto de volume zero.

Se $\varphi$ puder passar de $\pi$, a aplicação deixa de ser injetora. Com $\varphi \in [0, 2\pi]$ o fator com sinal integra $0$ sobre a bola, e o valor absoluto cobre a bola duas vezes, dando $8\pi a^3/3$ em vez de $4\pi a^3/3$.

## Exemplos Resolvidos

### Exemplo 1: um tetraedro, em coordenadas cartesianas

Seja $E$ o tetraedro $x, y, z \ge 0$, $x + y + z \le 1$. Os limites são $0 \le x \le 1$, $0 \le y \le 1 - x$, $0 \le z \le 1 - x - y$. O volume é

$$\int_0^1\!\int_0^{1-x}\!\int_0^{1-x-y} dz\, dy\, dx = \frac{1}{6}.$$

Para a densidade $\rho = x + y + z$ a massa é $\iiint (x + y + z)\, dV = \frac{1}{8}$, e integrar com $x$ por dentro e $z$ por fora também dá $1/8$, como Fubini promete. O momento $\iiint x\,\rho\, dV = \frac{1}{30}$, então $\bar x = \frac{1/30}{1/8} = \frac{4}{15} \approx 0{,}2667$. Com densidade uniforme o centroide está em $x = 1/4$, de modo que a densidade que cresce com a distância da origem empurra o centro de massa para fora. Todos os valores coincidem com a quadratura tripla numérica.

### Exemplo 2: coordenadas cilíndricas

Ache o volume entre $z = x^2 + y^2$ e $z = 4 - x^2 - y^2$. As superfícies se encontram onde $r^2 = 4 - r^2$, ou seja, $r = \sqrt 2$, e

$$V = \int_0^{2\pi}\!\int_0^{\sqrt 2}\!\int_{r^2}^{4 - r^2} r\, dz\, dr\, d\theta = 2\pi\int_0^{\sqrt 2}(4 - 2r^2)\, r\, dr = 2\pi\left[2r^2 - \frac{r^4}{2}\right]_0^{\sqrt 2} = 4\pi \approx 12{,}5664.$$

Uma integral tripla numérica em $x, y, z$ dá $12{,}56637$.

### Exemplo 3: coordenadas esféricas

Para uma bola de raio $a$,

$$V = \int_0^{2\pi}\!\int_0^{\pi}\!\int_0^{a} \rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta = 2\pi\cdot 2\cdot\frac{a^3}{3} = \frac{4\pi a^3}{3}.$$

Se a densidade é $k\rho$, proporcional à distância ao centro, a massa é $\int_0^{2\pi}\!\int_0^\pi\!\int_0^a k\rho\cdot\rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta = k\pi a^4$.

Agora a "casquinha de sorvete": dentro da esfera unitária e acima do cone $z = \sqrt{x^2 + y^2}$. No cone $\cos\varphi = \sin\varphi$, então o cone é $\varphi = \pi/4$, e o sólido é $0 \le \rho \le 1$, $0 \le \varphi \le \pi/4$, $0 \le \theta \le 2\pi$:

$$V = 2\pi\cdot\frac{1}{3}\int_0^{\pi/4}\sin\varphi\, d\varphi = \frac{2\pi}{3}\left(1 - \frac{\sqrt 2}{2}\right) = \frac{\pi(2 - \sqrt 2)}{3} \approx 0{,}6134.$$

Uma integral tripla cartesiana sobre $\sqrt{x^2 + y^2} \le z \le \sqrt{1 - x^2 - y^2}$ dá $0{,}61343$. Tirar o jacobiano da bola dá $\int_0^{2\pi}\!\int_0^\pi\!\int_0^1 d\rho\, d\varphi\, d\theta = 2\pi^2 \approx 19{,}74$ em vez de $4\pi/3 \approx 4{,}19$ (para $a = 1$).

### Exemplo 4: volume de uma bola por Monte Carlo

Quando uma região não tem descrição conveniente, amostre-a. Sorteie $N$ pontos uniformes no cubo $[-1, 1]^3$ (volume 8) e conte a fração $\hat p$ que cai dentro da bola unitária. Então $8\hat p$ estima $4\pi/3 = 4{,}18879$. O erro-padrão é $8\sqrt{p(1 - p)/N}$ com $p = \pi/6$, ou seja, $3{,}9955/\sqrt N$. Uma execução (semente 2026) deu:

```text
N        estimativa  erro abs.  erro-padrao
10^3     4.2640      0.0752     0.1264
10^4     4.1808      0.0080     0.0400
10^5     4.1632      0.0256     0.0126
10^6     4.1878      0.0010     0.0040
```

Uma única execução flutua nessa escala: o erro em $N = 10^5$ é de dois erros-padrão. Na média de 300 execuções (sementes 0 a 299), a raiz do erro quadrático médio em $N = 10^4$ foi $0{,}0408$, perto do previsto $0{,}0400$. O erro cai como $1/\sqrt N$ em qualquer dimensão, mas a constante depende do problema. Uma grade com 100 pontos por eixo exige $100^3 = 10^6$ avaliações em três dimensões e $100^{10}$ em dez, enquanto o Monte Carlo ainda roda em dez. Ali a bola unitária ocupa só cerca de $0{,}25\%$ do cubo envolvente, e $10^6$ amostras (semente 5) deram $2{,}51$ contra o valor exato $\pi^5/120 = 2{,}55$, com erro-padrão de $0{,}05$.

## Equívocos Comuns e Armadilhas

- **"Em coordenadas esféricas basta $d\rho\, d\varphi\, d\theta$."** O elemento de volume é $\rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta$. O $\rho^2$ reflete que a área de uma casca cresce com o quadrado do raio, e o $\sin\varphi$ que os círculos de latitude encolhem em direção aos polos. As cilíndricas precisam do fator $r$.
- **"Qualquer faixa de ângulo serve."** A aplicação precisa ser injetora no interior. $\varphi$ pertence a $[0, \pi]$ e $\theta$ a uma janela de comprimento $2\pi$; uma faixa maior cobre o sólido duas vezes.
- **"Cilíndricas e esféricas usam os mesmos ângulos em todo lugar."** Os ângulos geométricos são os mesmos, mas os nomes mudam entre livros: textos de física costumam chamar de $\theta$ o ângulo a partir do eixo $z$ e de $\varphi$ o azimute. Anote qual ângulo é qual antes de usar uma tabela de fórmulas.
- **"Os limites da integral externa podem depender das variáveis internas."** Uma variável interna não pode aparecer nos limites de uma integral externa. Se um limite se refere a $z$, então $z$ precisa ser integrada por fora dessa integral, e a região tem de ser redescrita.
- **"O Monte Carlo converge mais rápido que uma grade porque é aleatório."** Ele converge à taxa $1/\sqrt N$, que é lenta, e sua vantagem é que essa taxa não piora com a dimensão (a constante na frente pode piorar).

## Resumo

Uma integral tripla é um limite de somas sobre caixas pequenas. Para um integrando contínuo numa caixa fechada, Fubini faz as seis ordens concordarem, e os teoremas gerais exigem integrabilidade absoluta ou integrando não negativo. Sólidos do tipo 1 são descritos por uma região-base e duas superfícies. Sob uma aplicação $C^1$ injetora no interior e com jacobiano não nulo ali, o integrando recebe o valor absoluto do determinante $3 \times 3$: $r$ nas coordenadas cilíndricas e $\rho^2\sin\varphi$ nas esféricas, válido para $\varphi \in [0, \pi]$. Volume e massa são os usos padrão. Quando uma região resiste à descrição, a amostragem aleatória dá uma estimativa cujo erro cai como $1/\sqrt N$ em qualquer dimensão.

## Documentation Links

- [OpenStax Calculus Volume 3, 5.4 Triple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-4-triple-integrals): integrais triplas sobre caixas e regiões gerais, teorema de Fubini e aplicações.
- [OpenStax Calculus Volume 3, 5.5 Triple Integrals in Cylindrical and Spherical Coordinates](https://openstax.org/books/calculus-volume-3/pages/5-5-triple-integrals-in-cylindrical-and-spherical-coordinates): os dois sistemas de coordenadas e seus elementos de volume.
- [OpenStax Calculus Volume 3, 5.7 Change of Variables in Multiple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-7-change-of-variables-in-multiple-integrals): o determinante jacobiano e o teorema de mudança de variáveis.
- [MIT OpenCourseWare 18.02SC, Part A: Triple Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/4.-triple-integrals-and-surface-integrals-in-3-space/part-a-triple-integrals/): sessões sobre integrais triplas em coordenadas retangulares, cilíndricas e esféricas.
