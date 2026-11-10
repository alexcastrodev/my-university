---
version: 1.0
updatedAt: 2026-11-04
title: "Coordenadas Polares"
summary: "Coordenadas polares, conversão de e para a forma cartesiana, curvas como círculos, cardioides e rosáceas, e área em forma polar."
---
## Objetivos de Aprendizagem

- Converter pontos entre a forma polar $(r, \theta)$ e a cartesiana $(x, y)$, escolhendo o quadrante correto de $\theta$ e explicando por que um ponto tem vários nomes polares.
- Reconhecer círculos, cardioides e rosáceas a partir de suas equações polares e reescrever uma equação polar simples em forma cartesiana.
- Calcular a área delimitada por uma curva polar com $A = \tfrac{1}{2}\int r^2\, d\theta$, enunciar quando a fórmula conta cada ponto da região exatamente uma vez e achar a área entre duas curvas polares.
- Explicar de onde vem o elemento de área $r\, dr\, d\theta$, como preparação para integrais duplas em forma polar.

## Contexto e Motivação

Uma grade de valores $x$ e $y$ nem sempre é o jeito natural de descrever uma forma. Um círculo centrado na origem exige a relação $x^2 + y^2 = a^2$ em forma cartesiana, mas em termos de distância e direção ele é simplesmente $r = a$. A varredura de um radar, a fase de um número complexo e um braço robótico girando em torno de uma junta são descritos por uma distância e um ângulo, não por dois deslocamentos perpendiculares.

As coordenadas polares dão a cada ponto uma distância $r$ até a origem e um ângulo $\theta$ medido no sentido anti-horário a partir do eixo $x$ positivo. O preço é que a descrição deixa de ser única, e várias regras conhecidas (área, limites de integração) mudam de forma. Esta lição constrói o vocabulário e a fórmula de área de uma variável. A próxima, `double-integrals-cartesian-and-polar`, a usa para integrar sobre regiões incômodas em $x$ e $y$. A trigonometria usada aqui é a das famílias revistas em `functions-and-the-elementary-families`, e a fórmula de área reaproveita a integral de `applications-area-volume-and-average-value`.

## Teoria Central

### Conversão e os vários nomes de um ponto

Os dois sistemas se ligam por

$$x = r\cos\theta, \qquad y = r\sin\theta, \qquad r^2 = x^2 + y^2.$$

Passar de polar para cartesiano é substituição direta. No sentido oposto, $r = \sqrt{x^2 + y^2}$ é seguro, mas o ângulo pede cuidado. A relação $\tan\theta = y/x$ tem duas soluções a cada volta completa, então $\theta = \arctan(y/x)$ cai em $(-\pi/2, \pi/2)$ e erra para todo ponto com $x < 0$. Também falha em $x = 0$, onde $y/x$ não existe embora o ângulo seja $\pm\pi/2$. A regra robusta é escolher o $\theta$ cujo cosseno tem o sinal de $x$ e cujo seno tem o sinal de $y$. As linguagens de programação empacotam isso na função de dois argumentos `atan2(y, x)`, que devolve um ângulo em $(-\pi, \pi]$; somar $2\pi$ a um resultado negativo leva ao intervalo $[0, 2\pi)$.

Um ponto tem infinitos nomes polares. Somar qualquer múltiplo de $2\pi$ a $\theta$ dá o mesmo ponto, e um $r$ negativo significa "andar a mesma distância no sentido oposto":

$$(r, \theta) = (r, \theta + 2\pi k) = (-r, \theta + \pi).$$

A origem é $(0, \theta)$ para todo $\theta$. Essa falta de unicidade afeta toda fórmula posterior: a mesma curva pode ser percorrida duas vezes, ou passar pela origem em ângulos diferentes, e uma fórmula que soma sobre $\theta$ passa a contar alguns pontos mais de uma vez.

### Três famílias de curvas

Três equações cobrem quase tudo o que aparece na prática.

- **Círculos pela origem.** $r = 2a\cos\theta$ é o círculo de raio $a$ centrado em $(a, 0)$. Multiplicar por $r$ dá $x^2 + y^2 = 2ax$, ou seja, $(x - a)^2 + y^2 = a^2$. A multiplicação é inofensiva aqui porque a origem já está na curva (em $\theta = \pi/2$). A curva é percorrida exatamente uma vez para $\theta \in [0, \pi]$ e uma segunda vez para $\theta \in [\pi, 2\pi]$, porque $r(\theta + \pi) = -r(\theta)$, de modo que $(r(\theta + \pi), \theta + \pi)$ nomeia o mesmo ponto que $(r(\theta), \theta)$.
- **Cardioides.** $r = a(1 + \cos\theta)$ é uma curva em forma de coração, com uma ponta (cúspide) na origem. Em forma cartesiana, para $a = 1$, é $(x^2 + y^2 - x)^2 = x^2 + y^2$.
- **Rosáceas.** $r = \cos(n\theta)$ tem $n$ pétalas quando $n$ é ímpar e $2n$ quando $n$ é par. Em $r = \cos 2\theta$, as duas pétalas sobre o eixo $x$ são desenhadas onde $\cos 2\theta > 0$, e as duas sobre o eixo $y$ vêm dos ângulos em que $r < 0$, de modo que a curva é desenhada no sentido oposto ali.

### Área em forma polar

Um setor fino de raio $r$ e ângulo $\Delta\theta$ tem área $\tfrac{1}{2} r^2\, \Delta\theta$ (a fração $\Delta\theta / 2\pi$ da área $\pi r^2$ do disco). Somar esses setores e passar ao limite, como na integral definida de `the-definite-integral-and-riemann-sums`, dá

$$A = \frac{1}{2}\int_{\alpha}^{\beta} r(\theta)^2\, d\theta.$$

As hipóteses são o que importa. A função $r(\theta)$ precisa ser contínua em $[\alpha, \beta]$. A fórmula mede a área varrida pelo segmento que vai da origem até a curva, contando um ponto uma vez a cada passagem da varredura por ele. Por isso ela só iguala a área da região delimitada quando todo ponto da região é varrido exatamente uma vez, o que exige em particular $\beta - \alpha \le 2\pi$ e uma curva que não se repete no intervalo escolhido. Quando a varredura cobre parte da região duas vezes, a integral superestima a área, como mostra a segunda armadilha abaixo.

Para duas curvas, com $r_{\text{ext}}(\theta) \ge r_{\text{int}}(\theta) \ge 0$ no intervalo, a região entre elas tem área $\tfrac{1}{2}\int (r_{\text{ext}}^2 - r_{\text{int}}^2)\, d\theta$. A curva externa e a interna podem trocar de papel no meio do caminho, então o intervalo deve ser dividido nos ângulos em que as curvas se cruzam.

### De onde virá o fator $r$

Tome o "retângulo polar" entre os raios $r$ e $r + \Delta r$ e os ângulos $\theta$ e $\theta + \Delta\theta$. É uma fatia de anel, com área $\tfrac{1}{2}\big((r + \Delta r)^2 - r^2\big)\Delta\theta = \bar r\, \Delta r\, \Delta\theta$, onde $\bar r = r + \Delta r/2$ é o raio do meio. Diferente de um retângulo no plano $xy$, sua área não é o produto dos incrementos dos lados: ela também cresce com $r$. Esse $r$ extra é o elemento de área $dA = r\, dr\, d\theta$ que a próxima lição prova com um jacobiano.

## Exemplos Resolvidos

### Exemplo 1: convertendo pontos

O ponto $(-1, 1)$ tem $r = \sqrt{2}$. Como $x < 0$ e $y > 0$, ele está no segundo quadrante, então $\theta = 3\pi/4$. A fórmula $\arctan(y/x) = \arctan(-1) = -\pi/4$ nomeia o ponto diferente $(1, -1)$. Em Python, `math.atan2(1, -1)` devolve $2{,}3562 = 3\pi/4$, enquanto `math.atan(1 / -1)` devolve $-0{,}7854$. Para $(3, -4)$, $r = 5$ e $\theta \approx -0{,}9273$ rad, ou $5{,}3559$ rad em $[0, 2\pi)$.

No sentido contrário, $(2, 5\pi/6)$ vira $(2\cos 5\pi/6,\ 2\sin 5\pi/6) = (-\sqrt{3}, 1)$. O nome $(-2, \pi/6)$ dá $(-\sqrt{3}, -1)$, que é o ponto $(2, 7\pi/6)$: o raio negativo inverte a direção.

### Exemplo 2: área de uma cardioide

Para $r = 1 + \cos\theta$ em $[0, 2\pi]$ a curva é percorrida uma vez, então

$$A = \frac{1}{2}\int_0^{2\pi} (1 + \cos\theta)^2\, d\theta = \frac{1}{2}\int_0^{2\pi} \Big(1 + 2\cos\theta + \frac{1 + \cos 2\theta}{2}\Big) d\theta = \frac{1}{2}\Big(2\pi + 0 + \pi\Big) = \frac{3\pi}{2}.$$

Uma quadratura numérica dá $4{,}7124 = 3\pi/2$, e uma contagem Monte Carlo dos pontos com $r \le 1 + \cos\theta$ em uma caixa envolvente dá $4{,}714$ com $2\times 10^6$ amostras (semente 1).

### Exemplo 3: área de uma rosácea de quatro pétalas

Para $r = \cos 2\theta$, cada pétala é percorrida uma vez em $[0, 2\pi]$. A área das quatro é

$$A = \frac{1}{2}\int_0^{2\pi} \cos^2 2\theta\, d\theta = \frac{1}{2}\cdot\pi = \frac{\pi}{2},$$

então cada pétala tem área $\pi/8$. Integrar só em $[-\pi/4, \pi/4]$ dá uma pétala, $\pi/8 = 0{,}3927$ na conferência numérica.

### Exemplo 4: área dentro de dois círculos

Ache a área dentro de $r = 1$ e de $r = 2\cos\theta$ ao mesmo tempo. Igualar $1 = 2\cos\theta$ dá os ângulos de cruzamento $\theta = \pm\pi/3$. Perto de $\theta = 0$ o círculo $r = 1$ está mais perto da origem, e de $\pi/3$ a $\pi/2$ é o círculo $r = 2\cos\theta$ que está mais perto. Por simetria em relação ao eixo $x$,

$$A = 2\left[\frac{1}{2}\int_0^{\pi/3} 1\, d\theta + \frac{1}{2}\int_{\pi/3}^{\pi/2} 4\cos^2\theta\, d\theta\right] = \frac{2\pi}{3} - \frac{\sqrt{3}}{2} \approx 1{,}2284.$$

A primeira parte contribui com $\pi/3$ e a segunda com $\pi/3 - \sqrt{3}/2$. A integração numérica do menor dos dois raios dá $1{,}2284$, e uma estimativa Monte Carlo ($2\times 10^6$ amostras, semente 1) dá $1{,}2278$. Uma única fórmula em todo o intervalo estaria errada, porque a curva interna muda em $\pi/3$.

## Equívocos Comuns e Armadilhas

- **"$\theta = \arctan(y/x)$ sempre funciona."** Só está correto para $x > 0$. Para $x < 0$ erra por $\pi$, e em $x = 0$ divide por zero (`math.atan(1 / 0)` levanta `ZeroDivisionError` em Python, enquanto `math.atan2(1, 0)` devolve $\pi/2$). Use uma arco-tangente de dois argumentos.
- **"Integre $\tfrac{1}{2}r^2$ em $[0, 2\pi]$ para qualquer curva."** Para $r = 2\cos\theta$ isso dá $\tfrac{1}{2}\int_0^{2\pi} 4\cos^2\theta\, d\theta = 2\pi$, mas o disco delimitado tem área $\pi$ (raio 1). A varredura cobre o disco duas vezes. Em $[0, \pi]$ a integral é $\pi$, a área correta. A rosácea $r = \cos 3\theta$ se comporta do mesmo modo: é percorrida uma vez em $[0, \pi]$ (área $\pi/4$) e duas vezes em $[0, 2\pi]$ (valor $\pi/2$). Já $r = \cos 2\theta$ é percorrida uma vez em $[0, 2\pi]$, então ali o intervalo maior é o certo. Pergunte sempre em que intervalo a curva se fecha sem se repetir.
- **"Duas curvas polares se encontram onde suas equações são iguais."** Resolver $r_1(\theta) = r_2(\theta)$ pode perder interseções, porque um ponto tem vários nomes. As cardioides $r = 1 + \cos\theta$ e $r = 1 - \cos\theta$ são iguais apenas em $\theta = \pm\pi/2$, mas ambas também passam pela origem, a primeira em $\theta = \pi$ e a segunda em $\theta = 0$. Verifique a origem e os nomes alternativos $(-r, \theta + \pi)$ à parte, e confirme com um esboço.
- **"O elemento de área é $dr\, d\theta$."** O pequeno retângulo polar tem área aproximada $r\, \Delta r\, \Delta\theta$. Esquecer o $r$ é o erro mais comum quando as coordenadas polares entram numa integral dupla.

## Resumo

As coordenadas polares descrevem um ponto por distância $r$ e ângulo $\theta$, ligados a $(x, y)$ por $x = r\cos\theta$, $y = r\sin\theta$ e $r^2 = x^2 + y^2$. O ângulo deve ser escolhido pelo quadrante (`atan2`), e todo ponto tem vários nomes, inclusive com $r$ negativo. Círculos pela origem, cardioides e rosáceas são as curvas padrão. A área varrida por $r(\theta)$ é $\tfrac{1}{2}\int r^2\, d\theta$, válida como área delimitada só quando cada ponto é varrido uma vez, e a área entre curvas exige dividir o intervalo nos ângulos de cruzamento. O pequeno retângulo polar tem área $r\, \Delta r\, \Delta\theta$, a semente do elemento de área usado na próxima lição.

## Documentation Links

- [OpenStax Calculus Volume 3, 1.3 Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/1-3-polar-coordinates): definição de coordenadas polares, conversão e as curvas padrão.
- [OpenStax Calculus Volume 3, 1.4 Area and Arc Length in Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/1-4-area-and-arc-length-in-polar-coordinates): a fórmula de área e as regiões entre curvas polares.
- [MIT OpenCourseWare 18.02SC, Part A: Double Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/3.-double-integrals-and-line-integrals-in-the-plane/part-a-double-integrals/): lista de sessões sobre integrais duplas, incluindo integrais duplas em coordenadas polares.
