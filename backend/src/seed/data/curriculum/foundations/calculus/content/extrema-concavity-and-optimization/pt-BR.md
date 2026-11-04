---
version: 1.0
updatedAt: 2026-11-04
title: "Extremos, Concavidade e Otimização"
summary: "Pontos críticos, os testes da primeira e da segunda derivada, concavidade e pontos de inflexão, e como transformar um problema de enunciado em uma otimização em um intervalo fechado."
---
## Objetivos de Aprendizagem

- Definir extremos absolutos e locais, enunciar o Teorema do Valor Extremo com suas hipóteses e dar exemplos em que tirar uma hipótese destrói a conclusão.
- Encontrar pontos críticos e explicar por que um ponto crítico é um candidato, não um veredito.
- Localizar os extremos absolutos de uma função contínua em um intervalo fechado, incluindo as extremidades.
- Classificar pontos críticos com os testes da primeira e da segunda derivada, e reconhecer o caso em que o teste da segunda derivada não diz nada.
- Ler concavidade e pontos de inflexão pelo sinal de $f''$, e montar e resolver um problema de otimização com o domínio correto.

## Contexto e Motivação

Treinar um modelo, ajustar o tamanho de um cache, escolher o comprimento de bloco de uma estrutura de dados e dimensionar uma embalagem são a mesma pergunta: que entrada torna uma quantidade a menor ou a maior possível? O cálculo de uma variável dá um método completo. Derive, ache onde a inclinação se anula ou deixa de existir e compare. O mesmo padrão se generaliza: `gradients-extending-derivatives-to-several-variables` iguala o gradiente a zero em várias variáveis, e `critical-points-and-the-second-derivative-test` trata a etapa de classificação com uma matriz de segundas derivadas.

Esta lição se apoia em `the-mean-value-theorem-and-monotonicity`: o teste da primeira derivada é o resultado sobre o sinal da derivada daquela lição aplicado dos dois lados de um ponto, e o teste da segunda derivada é o mesmo resultado aplicado a $f'$. O cuidado que o assunto exige está nos detalhes: quais pontos precisam ser examinados, quais testes se aplicam e em que domínio o problema realmente vive.

## Teoria Central

### Extremos e o Teorema do Valor Extremo

Um valor $f(c)$ é um **máximo absoluto** em um conjunto $D$ se $f(c) \ge f(x)$ para todo $x \in D$, e um **máximo local** se essa desigualdade vale para todo $x$ em algum intervalo aberto ao redor de $c$. Mínimos se definem com a desigualdade invertida.

**Teorema do Valor Extremo.** Se $f$ é contínua em um intervalo fechado e limitado $[a, b]$, então $f$ atinge um máximo absoluto e um mínimo absoluto em $[a, b]$.

As duas hipóteses são necessárias. A função $f(x) = x$ no intervalo aberto $(0, 1)$ é contínua mas não tem máximo nem mínimo, pois os valores chegam arbitrariamente perto de $1$ e de $0$ sem alcançá-los. No intervalo fechado $[0, 1]$, defina $f(x) = x$ para $x < 1$ e $f(1) = 0$. Ela não é contínua em $1$, os valores se aproximam de $1$ sem nunca chegar, e não há máximo. O teorema garante a existência; ele não diz onde está o extremo.

### Pontos críticos

Pela observação de Fermat da lição anterior, se $f$ tem um extremo local em um ponto interior $c$ e $f'(c)$ existe, então $f'(c) = 0$. Um **ponto crítico** é um ponto interior $c$ do domínio em que $f'(c) = 0$ ou $f'(c)$ não existe. Todo extremo local interior está em um ponto crítico. A recíproca é falsa: $f(x) = x^3$ tem $f'(0) = 0$ mas nenhum extremo.

### O método do intervalo fechado

Para $f$ contínua em $[a, b]$:

1. Ache todos os pontos críticos em $(a, b)$.
2. Calcule $f$ em cada ponto crítico e em $a$ e $b$.
3. O maior valor é o máximo absoluto e o menor é o mínimo absoluto.

O Teorema do Valor Extremo garante que os extremos existem, e Fermat garante que todo extremo fora das extremidades está em um ponto crítico. Por isso as extremidades entram na lista: um extremo pode estar onde a derivada está longe de zero.

### Testes da primeira e da segunda derivada

**Teste da primeira derivada.** Seja $c$ um ponto crítico e $f$ contínua em $c$, e suponha que $f'$ tenha sinal constante de cada lado de $c$. Se $f'$ passa de negativa a positiva em $c$, $f(c)$ é um mínimo local. Se passa de positiva a negativa, um máximo local. Se $f'$ mantém o mesmo sinal dos dois lados, não há extremo. Isso decorre dos resultados de monotonicidade da lição anterior em cada lado de $c$, e funciona mesmo quando $f'(c)$ não existe. Se $f'$ muda de sinal infinitas vezes perto de $c$, o teste não se aplica (Exemplo 2).

**Teste da segunda derivada.** Suponha $f'(c) = 0$ e que $f''$ exista perto de $c$ e seja contínua em $c$. Se $f''(c) > 0$, $f$ tem um mínimo local em $c$; se $f''(c) < 0$, um máximo local. Se $f''(c) = 0$, o teste é **inconclusivo**: qualquer um dos três resultados pode ocorrer, como o Exemplo 2 mostra. O teste também exige que $f'(c)$ exista e seja zero, então não classifica uma quina nem uma cúspide.

### Concavidade e pontos de inflexão

Se $f'' > 0$ em um intervalo, então $f'$ é crescente ali (lição anterior, aplicada a $f'$), as inclinações crescem da esquerda para a direita e o gráfico se curva para cima: $f$ tem **concavidade para cima**. Se $f'' < 0$, a concavidade é **para baixo**. Um **ponto de inflexão** é um ponto em que $f$ é contínua e a concavidade muda. Num ponto assim, $f''(c) = 0$ ou $f''(c)$ não existe, mas nenhuma das duas condições basta sozinha. O sinal de $f''$ precisa de fato mudar.

## Exemplos Resolvidos

### Exemplo 1: extremos absolutos em um intervalo fechado

Ache os extremos absolutos de $f(x) = x^3 - 3x$ em $[-2, 3]$. A função é um polinômio, logo contínua, e o método se aplica. Como $f'(x) = 3x^2 - 3 = 3(x - 1)(x + 1)$, os pontos críticos são $x = \pm 1$, ambos dentro do intervalo. Calculando:

```text
x     = -2   -1    1    3
f(x)  = -2    2   -2   18
```

O máximo absoluto é $18$ na extremidade $x = 3$, onde $f'(3) = 24 \ne 0$. O mínimo absoluto é $-2$, atingido em dois pontos diferentes, $x = -2$ e $x = 1$. O valor $f(-1) = 2$ é apenas um máximo local. A segunda derivada $f''(x) = 6x$ confirma: $f''(-1) = -6 < 0$ (máximo local) e $f''(1) = 6 > 0$ (mínimo local). Como $f''$ muda de sinal em $x = 0$, há um ponto de inflexão em $(0, 0)$, com $f$ côncava para baixo à esquerda e côncava para cima à direita.

### Exemplo 2: quando os testes calam

Cinco funções, todas com ponto crítico em $x = 0$.

- $x^4$: $f'(0) = 0$ e $f''(0) = 0$. Mínimo local e absoluto.
- $-x^4$: $f'(0) = 0$ e $f''(0) = 0$. Máximo local e absoluto.
- $x^3$: $f'(0) = 0$ e $f''(0) = 0$. Nenhum extremo.
- $x^{2/3}$: nem $f'(0)$ nem $f''(0)$ existem. Mínimo absoluto.
- $x^2\left(2 + \sin\frac1x\right)$ com $f(0) = 0$: $f'(0) = 0$, e $f''(0)$ não existe. Mínimo absoluto estrito.

Aqui $x^{2/3}$ significa $(\sqrt[3]{x})^2$, e $x^{-1/3}$ e $x^{-5/3}$ abaixo significam $1/\sqrt[3]{x}$ e $1/(\sqrt[3]{x})^5$: a leitura pela raiz real, definida para $x$ negativo. Em código, use `numpy.cbrt`, pois `numpy.power(-1.0, 2/3)` dá `nan`.

O teste da segunda derivada não diz nada nas três primeiras, pois $f''(0) = 0$ em todas. O teste da primeira derivada resolve: para $x^4$, $f' = 4x^3$ é negativa e depois positiva; para $-x^4$ é o contrário; para $x^3$, $f' = 3x^2$ é positiva dos dois lados. Para $x^{2/3}$, $f'(x) = \frac23 x^{-1/3}$ é negativa se $x < 0$ e positiva se $x > 0$, então o teste da primeira derivada encontra um mínimo em uma cúspide, onde o teste da segunda derivada nem pode ser enunciado.

A quinta função derrota os dois testes. Como $f(x) \ge x^2 > 0 = f(0)$ para $x \ne 0$, o mínimo é evidente. Mas $f'(0) = \lim_{h \to 0} h\left(2 + \sin\frac1h\right) = 0$, enquanto para $x \ne 0$, $f'(x) = 2x\left(2 + \sin\frac1x\right) - \cos\frac1x$, que vale $4x - 1 < 0$ em $x = \frac{1}{2\pi k}$ e $4x + 1 > 0$ em $x = \frac{1}{(2k+1)\pi}$ para todo inteiro $k$ grande. Logo $f'$ muda de sinal infinitas vezes perto de $0$ (sem padrão de sinal para o teste da primeira derivada), e $f'(h)/h$ não tem limite, então $f''(0)$ não existe. Só a comparação direta de valores resolve.

A concavidade tem armadilhas correspondentes. Para $x^4$, $f''(0) = 0$, mas $f'' = 12x^2 \ge 0$ dos dois lados, então não há ponto de inflexão em $0$. Para $f(x) = \sqrt[3]{x}$, $f''(x) = -\frac29 x^{-5/3}$ não existe em $0$, é positiva se $x < 0$ e negativa se $x > 0$, logo há um ponto de inflexão exatamente onde $f''$ é indefinida.

### Exemplo 3: otimização em um domínio aberto

Uma lata cilíndrica deve conter $1000\ \text{cm}^3$. Que raio minimiza a área de superfície? Com raio $r$ e altura $h$, o volume dá $h = \frac{1000}{\pi r^2}$, e a área das duas tampas mais a lateral é

$$S(r) = 2\pi r^2 + 2\pi r h = 2\pi r^2 + \frac{2000}{r}, \qquad r > 0.$$

Então $S'(r) = 4\pi r - \frac{2000}{r^2} = 0$ dá $r^3 = \frac{500}{\pi}$, ou seja, $r = \left(\frac{500}{\pi}\right)^{1/3} \approx 5{,}419$ cm. O domínio $(0, \infty)$ não tem extremidades para comparar, então precisamos de um argumento de que esse ponto crítico é o mínimo. Aqui $S''(r) = 4\pi + \frac{4000}{r^3} > 0$ para todo $r > 0$, logo $S'$ é crescente. Com $S'(r^*) = 0$ em $r^* \approx 5{,}419$, isso significa $S' < 0$ em todo $(0, r^*)$ e $S' > 0$ em todo $(r^*, \infty)$. Pelos resultados de monotonicidade da lição anterior, $S$ decresce até $r^*$ e cresce depois, então $S(r^*)$ é o mínimo absoluto. Uma conferência numérica concorda:

```text
r = 4.0   S = 600.53
r = 5.0   S = 557.08
r = 5.419 S = 553.58   (minimo)
r = 6.0   S = 559.53
r = 7.0   S = 593.59
```

No ótimo, $h = \frac{1000}{\pi r^2} \approx 10{,}839 = 2r$: a lata ideal é tão alta quanto larga.

### Exemplo 4: escolhendo o tamanho do bloco

A busca por saltos (jump search) em $n$ itens ordenados avança em blocos de tamanho $b$ e depois varre dentro de um bloco. Um modelo de custo simples conta cerca de $\frac nb$ saltos mais até $b$ passos dentro do bloco: $C(b) = \frac nb + b$. É um modelo da contagem de operações, não uma contagem exata de comparações. Tome $n = 10\,000$ e o intervalo fechado $1 \le b \le n$, de modo que o método do intervalo fechado se aplica. $C'(b) = -\frac{n}{b^2} + 1 = 0$ dá $b = \sqrt n = 100$, com $C(100) = 200$. As extremidades dão $C(1) = C(10\,000) = 10\,001$. O mínimo $2\sqrt n$ é o motivo de essa estratégia ser $O(\sqrt n)$. Na prática $b$ precisa ser inteiro, então para $n$ que não é quadrado perfeito comparam-se os dois inteiros vizinhos de $\sqrt n$.

## Equívocos Comuns e Armadilhas

- **"Ponto crítico significa extremo."** Significa candidato. $x^3$ em $0$ é um ponto crítico sem extremo.
- **"$f''(c) = 0$ significa ponto de inflexão."** $x^4$ refuta. Um ponto de inflexão exige que $f''$ mude de sinal.
- **"O teste da segunda derivada sempre decide."** Quando $f''(c) = 0$ ele cala, e não se aplica onde $f'(c)$ não existe. Recorra ao teste da primeira derivada e, se $f'$ não tem padrão de sinal perto de $c$, compare os valores diretamente (Exemplo 2).
- **Esquecer as extremidades.** No Exemplo 1 o máximo está em $x = 3$, onde a derivada vale $24$.
- **Confundir local com absoluto.** No Exemplo 1, $f(-1) = 2$ é um máximo local, mas está longe do maior valor.
- **Ignorar o domínio.** A fórmula de $S(r)$ não faz sentido para $r \le 0$, e uma otimização em domínio aberto ou ilimitado exige um argumento, como o sinal de $S'$ ou o comportamento quando $r \to 0^+$ e $r \to \infty$, porque o Teorema do Valor Extremo não se aplica.

## Resumo

Um extremo absoluto de uma função contínua em um intervalo fechado e limitado sempre existe. Ele ocorre em uma extremidade ou em um ponto crítico interior, onde $f' = 0$ ou $f'$ não existe. Um ponto crítico é apenas um candidato: $x^3$ tem um e nenhum extremo. O teste da primeira derivada o classifica pela mudança de sinal de $f'$ e funciona até numa cúspide, desde que $f'$ tenha sinal constante de cada lado. O teste da segunda derivada é mais rápido quando $f''(c) \ne 0$ e silencia quando $f''(c) = 0$, como em $x^4$, $-x^4$ e $x^3$. A concavidade acompanha o sinal de $f''$, e um ponto de inflexão exige mudança de sinal, não só $f'' = 0$. Otimizar é modelar mais aplicar este método: escrever a fórmula em uma variável, fixar o domínio, achar os candidatos, compará-los e justificar o vencedor. A próxima lição, `lhopitals-rule`, usa derivadas para outro trabalho, resolver limites que as leis de limites não resolvem.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.3: Maxima and Minima](https://openstax.org/books/calculus-volume-1/pages/4-3-maxima-and-minima): extremos absolutos e locais, o Teorema do Valor Extremo, o teorema de Fermat, pontos críticos e o método do intervalo fechado.
- [OpenStax Calculus Volume 1, 4.5: Derivatives and the Shape of a Graph](https://openstax.org/books/calculus-volume-1/pages/4-5-derivatives-and-the-shape-of-a-graph): os testes da primeira e da segunda derivada, concavidade e pontos de inflexão.
- [OpenStax Calculus Volume 1, 4.7: Applied Optimization Problems](https://openstax.org/books/calculus-volume-1/pages/4-7-applied-optimization-problems): uma estratégia geral para traduzir problemas de enunciado em otimização de uma variável.
- [MIT OCW 18.01SC, Unit 2, Part B: Optimization, Related Rates and Newton's Method](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-b-optimization-related-rates-and-newtons-method/): sessões de aula sobre problemas de otimização.
