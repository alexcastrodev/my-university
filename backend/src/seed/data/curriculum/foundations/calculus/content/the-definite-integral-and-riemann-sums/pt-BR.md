---
version: 1.0
updatedAt: 2026-11-04
title: "A Integral Definida e as Somas de Riemann"
summary: "A área como limite de somas de Riemann, as regras da esquerda, da direita e do ponto médio, a definição formal da integral definida e suas propriedades básicas."
---
## Objetivos de Aprendizagem

- Montar e calcular somas de Riemann pela esquerda, pela direita, pelo ponto médio e pelos trapézios para uma função em $[a,b]$ com $n$ subintervalos.
- Enunciar a definição da integral definida como limite sobre todas as partições com tags cuja malha tende a zero, e dizer quais funções têm integral garantida.
- Distinguir área líquida (com sinal) de área total, e explicar por que $\int_0^{2\pi}\sin x\,dx = 0$.
- Aplicar linearidade, aditividade em intervalos, inversão de orientação e comparação para reescrever integrais e obter cotas para elas.
- Prever quão rápido cada regra converge quando $n$ dobra, e reconhecer quando essa taxa piora.
- Usar integrais para estimar o custo de um somatório, como o trabalho de um laço aninhado.

## Contexto e Motivação

A lição anterior, `antiderivatives-and-initial-value-problems`, rodou a derivação ao contrário. Esta começa por uma pergunta que parece não ter relação: quanto se acumula sob uma curva? Distância a partir de um registro de velocidade, energia total a partir da leitura de potência, massa de probabilidade a partir de uma densidade, custo total de um laço cujo corpo fica mais caro a cada iteração: tudo isso é uma taxa multiplicada por um passo pequeno e somada. A integral definida é o valor exato dessa soma quando os passos encolhem.

A definição abaixo não menciona derivada em momento algum, e isso é proposital. Ela faz da integral um limite de somas finitas, que um computador consegue calcular de fato, e transforma a lição seguinte, `the-fundamental-theorem-of-calculus`, numa descoberta de verdade: as duas ideias (taxas e acúmulo) foram definidas de forma independente e acabam sendo inversas uma da outra.

## Teoria Central

### Partições e somas de Riemann

Uma **partição** de $[a,b]$ é uma lista de pontos $a = x_0 < x_1 < \dots < x_n = b$. As larguras dos subintervalos são $\Delta x_i = x_i - x_{i-1}$ e a **malha** $\lVert P\rVert$ é a maior delas. Escolha uma **tag** $x_i^*$ em cada subintervalo $[x_{i-1}, x_i]$. A **soma de Riemann** é

$$S(f, P, x^*) = \sum_{i=1}^{n} f(x_i^*)\,\Delta x_i$$

Cada termo é a área com sinal de um retângulo: largura vezes altura, com altura negativa onde $f<0$. Com larguras iguais $\Delta x = (b-a)/n$ e $x_i = a + i\,\Delta x$, três escolhas de tag dão as regras padrão:

- **Esquerda**: $L_n = \Delta x\sum_{i=0}^{n-1} f(x_i)$
- **Direita**: $R_n = \Delta x\sum_{i=1}^{n} f(x_i)$
- **Ponto médio**: $M_n = \Delta x\sum_{i=1}^{n} f\big(\tfrac{x_{i-1}+x_i}{2}\big)$

A regra dos **trapézios** faz a média das duas primeiras: $T_n = (L_n + R_n)/2$.

### A definição

Seja $f$ limitada em $[a,b]$. Ela é **integrável à Riemann** com integral $I$ se, para todo $\varepsilon > 0$, existe $\delta > 0$ tal que toda partição com tags e malha $\lVert P\rVert < \delta$ satisfaz $\lvert S(f,P,x^*) - I\rvert < \varepsilon$. Escrevemos então $I = \int_a^b f(x)\,dx$.

A expressão "toda partição com tags" importa: larguras iguais e tags à esquerda são só uma família. Um teste numérico com $f(x)=x^2$ em $[0,1]$, com pontos de partição aleatórios e uma tag aleatória em cada pedaço, dá somas de 0,3460 (10 pedaços), 0,33360 (100), 0,333304 (1000) e 0,33333335 (100000 pedaços, maior pedaço com cerca de 0,0001). Todas caminham para o mesmo $1/3$.

Quais funções se qualificam? Toda função contínua em $[a,b]$ é integrável; o mesmo vale para funções limitadas com um número finito de descontinuidades e para funções monótonas. As hipóteses não são enfeite, e vale ver duas falhas.

- **Ilimitada.** Defina $f(x)=1/x$ em $(0,1]$ e $f(0)=0$. As somas pela direita com $n$ pedaços são o número harmônico $H_n$: 2,93 para $n=10$, 5,19 para $100$, 7,49 para $1000$, 12,09 para $10^5$. Elas continuam crescendo, e uma tag escolhida perto de $0$ infla a soma o quanto se quiser. Não existe limite. Algumas funções ilimitadas, como $1/\sqrt{x}$, ganham um valor por meio de um segundo limite (veja `improper-integrals`), que é outro objeto.
- **Limitada, mas descontínua demais.** Seja $f(x)=1$ nos racionais e $0$ nos irracionais de $[0,1]$. Todo subintervalo, por menor que seja, contém os dois tipos de número. Tags racionais dão $S=1$ para toda partição e tags irracionais dão $S=0$, então nenhum $I$ serve.

### Área líquida

A integral conta área acima do eixo como positiva e abaixo como negativa. Para $\sin$ em $[0,2\pi]$ as duas corcovas se cancelam, então a integral vale $0$, enquanto a área total é $\int_0^{2\pi}\lvert\sin x\rvert\,dx = 4$.

### Propriedades

Para $f$ e $g$ integráveis nos intervalos envolvidos:

$$\int_a^b (c f + g)\,dx = c\int_a^b f\,dx + \int_a^b g\,dx, \qquad \int_a^b f = \int_a^c f + \int_c^b f, \qquad \int_b^a f = -\int_a^b f$$

Também valem $\int_a^a f = 0$, $\int_a^b c\,dx = c(b-a)$, se $f\le g$ então $\int_a^b f \le \int_a^b g$ (para $a<b$), e $\big\lvert\int_a^b f\big\rvert \le \int_a^b \lvert f\rvert$. As duas desigualdades supõem $a\le b$: com $f=1$, $a=1$, $b=0$ a segunda diria $1\le-1$. Não existe regra do produto desse tipo: em geral $\int fg \ne \int f\int g$.

### Cotas para o valor e velocidade de convergência

Se $f$ é crescente em $[a,b]$, cada retângulo à esquerda fica abaixo da curva e cada retângulo à direita fica acima, então $L_n \le I \le R_n$ e $R_n - L_n = (f(b)-f(a))\,\Delta x$. Isso dá uma barra de erro certificada só com as somas. (Para $f$ decrescente as desigualdades se invertem.) Para $x^2$ em $[0,1]$ com $n=4$: $0{,}21875 \le I \le 0{,}46875$, largura $0{,}25 = 1\cdot\frac14$.

Com que velocidade as regras se aproximam? A saída do script abaixo é para $x^2$ em $[0,1]$, onde $I = 1/3$.

```text
  n      left      right    midpoint  trapezoid   |err L|    |err M|
  4    0.21875   0.46875   0.328125   0.34375    1.15e-01   5.21e-03
  8    0.27344   0.39844   0.332031   0.33594    5.99e-02   1.30e-03
 16    0.30273   0.36523   0.333008   0.33398    3.06e-02   3.26e-04
 64    0.32556   0.34119   0.333313   0.33337    7.77e-03   2.03e-05
128    0.32944   0.33725   0.333328   0.33334    3.90e-03   5.09e-06
```

Dobrar $n$ divide por dois os erros da esquerda e da direita (razão 1,995 e 2,005 de $n=64$ para $128$) e divide por quatro os do ponto médio e dos trapézios (razão 4,0). Para $f$ suave com $f(b)\ne f(a)$, os erros da esquerda e da direita se comportam como $(f(b)-f(a))\Delta x/2$, ou seja, $O(1/n)$; ponto médio e trapézios são $O(1/n^2)$. Na regra do ponto médio, as sobre e subestimativas dentro de cada pedaço em grande parte se cancelam. Na regra dos trapézios, os erros principais $\pm(f(b)-f(a))\Delta x/2$ das somas da esquerda e da direita têm sinais opostos, então tirar a média dos dois os elimina. A garantia exige suavidade. Para $\sqrt{x}$ em $[0,1]$ a inclinação é ilimitada em $0$, e a razão do erro do ponto médio ao dobrar de $64$ para $128$ é só 2,79, cerca de $2^{3/2}$, e não 4.

## Exemplos Resolvidos

### Exemplo 1: somas à mão

Tome $f(x)=x^2$ em $[0,1]$ com $n=4$, então $\Delta x = \tfrac14$.

$$L_4 = \tfrac14\big(0 + \tfrac1{16} + \tfrac4{16} + \tfrac9{16}\big) = \tfrac{14}{64} = 0{,}21875, \qquad R_4 = \tfrac14\cdot\tfrac{30}{16} = 0{,}46875$$

$$M_4 = \tfrac14\big(\tfrac1{64} + \tfrac9{64} + \tfrac{25}{64} + \tfrac{49}{64}\big) = \tfrac{84}{256} = 0{,}328125$$

O valor dos trapézios é $0{,}34375$. O ponto médio já está a $0{,}0052$ de $1/3$, um erro mais de 20 vezes menor que o $0{,}115$ da soma pela esquerda.

### Exemplo 2: o valor exato como limite

Use $\sum_{i=1}^n i^2 = \frac{n(n+1)(2n+1)}{6}$ com tags à direita em $[0,b]$:

$$R_n = \sum_{i=1}^{n}\Big(\frac{ib}{n}\Big)^2\frac{b}{n} = \frac{b^3}{n^3}\cdot\frac{n(n+1)(2n+1)}{6} = b^3\,\frac{(n+1)(2n+1)}{6n^2}$$

Quando $n\to\infty$ a fração tende a $\frac13$, então $\int_0^b x^2\,dx = \frac{b^3}{3}$. Conferência: $b=1$, $n=4$ dá $\frac{5\cdot 9}{96} = 0{,}46875$, o valor do Exemplo 1. Escrever $R_n = \frac13 + \frac1{2n} + \frac1{6n^2}$ também explica o erro $O(1/n)$ visto na tabela. Uma integração simbólica e uma quadratura numérica retornam $9$ para $b=3$.

### Exemplo 3: área líquida contra área total

As somas de ponto médio de $\sin$ em $[0,2\pi]$ para $n=4, 8, 100$ dão todas zero a menos de arredondamento ($10^{-16}$), porque os pontos médios se emparelham com senos de sinais opostos. Logo $\int_0^{2\pi}\sin x\,dx = 0$, enquanto $\int_0^{2\pi}\lvert\sin x\rvert\,dx = 4$ (ambos conferidos simbolicamente e por quadratura).

### Exemplo 4: cotas para o custo de um laço

Suponha que a iteração $i$ de um laço faça $i^2$ unidades de trabalho, para $i=1,\dots,n$. O trabalho total é $\sum_{i=1}^n i^2$, uma soma pela direita com $\Delta x = 1$ para $x^2$ em $[0,n]$. Como $x^2$ é crescente,

$$\int_0^n x^2\,dx \le \sum_{i=1}^n i^2 \le \int_1^{n+1} x^2\,dx, \qquad\text{isto é}\qquad \frac{n^3}{3} \le \sum_{i=1}^n i^2 \le \frac{(n+1)^3 - 1}{3}$$

Para $n=10$ a soma verdadeira é $385$, entre $333{,}3$ e $443{,}3$. A razão entre a soma e $n^3/3$ é 1,155 em $n=10$, 1,015 em $100$ e 1,0015 em $1000$. O trabalho é $\Theta(n^3)$, sem precisar de fórmula fechada.

## Equívocos Comuns e Armadilhas

- **"A integral é a área, ponto."** Ela é a área líquida com sinal. Regiões abaixo do eixo subtraem. Use $\int\lvert f\rvert$ para a área total (e divida nos pontos de troca de sinal para calculá-la).
- **"Toda função limitada é integrável."** A função indicadora dos racionais é limitada e não tem integral de Riemann. Continuidade, ou pelo menos um número finito de saltos, é o que os teoremas usuais supõem.
- **"As regras da esquerda, da direita e do ponto médio são igualmente boas."** Convergem ao mesmo limite, mas, para funções suaves, os erros do ponto médio e dos trapézios caem como $1/n^2$, contra $1/n$ nas outras. A exceção confirma a regra: para $\sin$ em $[0,\pi]$ os valores nas extremidades são ambos $0$, então as somas da esquerda, da direita e dos trapézios coincidem e as três são $O(1/n^2)$.
- **"Somas pela esquerda sempre subestimam."** Só para $f$ crescente isso é garantido. Para $f$ decrescente superestimam, e numa função que sobe e desce nenhuma das duas cotas é garantida (para $\sin$ em $[0,\pi]$ toda soma pela esquerda fica abaixo de $2$, mas isso não é regra).
- **"$\int fg = \int f\cdot\int g$."** A integral é linear em $f$, não multiplicativa. Com $f=g=x$ em $[0,1]$: $\int fg = \frac13$, mas $\int f\int g = \frac14$.

## Resumo

Uma soma de Riemann adiciona $f(x_i^*)\,\Delta x_i$ sobre uma partição. A integral definida $\int_a^b f$ é o número do qual todas essas somas se aproximam quando a malha vai a zero, para qualquer escolha de partição e de tags, e existe para funções contínuas e para funções limitadas com um número finito de descontinuidades. Ela não existe para funções ilimitadas nem para funções como a indicadora dos racionais, descontínuas demais. A integral mede a área líquida com sinal. Para integrandos suaves, as regras da esquerda e da direita têm erro $O(1/n)$ e as do ponto médio e dos trapézios $O(1/n^2)$, como a tabela acima mostra diretamente, e para $f$ crescente as somas da esquerda e da direita cercam o valor verdadeiro. Comparar uma soma com uma integral é um jeito padrão de obter cotas para o tempo de execução de um laço. Calcular integrais por limite de somas funciona, mas é lento, e a próxima lição, `the-fundamental-theorem-of-calculus`, o substitui por antiderivadas.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.1 Approximating Areas](https://openstax.org/books/calculus-volume-1/pages/5-1-approximating-areas): notação sigma e somas pela esquerda, pela direita e pelo ponto médio como aproximações de área.
- [OpenStax Calculus Volume 1, 5.2 The Definite Integral](https://openstax.org/books/calculus-volume-1/pages/5-2-the-definite-integral): a definição por limite, a área líquida e as propriedades da integral.
- [Active Calculus, 4.2 Riemann sums](https://activecalculus.org/single/sec-4-2-Riemann.html): notação sigma e somas de Riemann construídas a partir de um problema de velocidade.
- [Active Calculus, 4.3 The definite integral](https://activecalculus.org/single/sec-4-3-definite-integral.html): a definição, a área com sinal e as propriedades.
- [MIT OCW 18.01SC, Unit 3 Part A](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-a-definition-of-the-definite-integral-and-first-fundamental-theorem/): aulas e exercícios sobre a definição da integral definida.
