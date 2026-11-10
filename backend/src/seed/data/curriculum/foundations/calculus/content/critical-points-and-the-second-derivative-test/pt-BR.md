---
version: 1.0
updatedAt: 2026-11-04
title: "Pontos Críticos e o Teste da Segunda Derivada"
summary: "Pontos críticos de funções de duas variáveis, o teste da segunda derivada pela Hessiana, pontos de sela e extremos absolutos numa região fechada."
---
## Objetivos de Aprendizagem

- Definir extremos locais e absolutos e pontos críticos de uma função de duas variáveis, e enunciar o teorema de Fermat com suas hipóteses.
- Calcular a matriz Hessiana e o discriminante $D = f_{xx} f_{yy} - f_{xy}^2$, e aplicar o teste da segunda derivada com todas as hipóteses verificadas.
- Reconhecer um ponto de sela, calcular sua Hessiana e explicar por que o teste nada diz quando $D = 0$.
- Encontrar extremos absolutos de uma função contínua numa região fechada e limitada, comparando os pontos críticos do interior com a fronteira.
- Usar a Hessiana para confirmar que a solução das equações de mínimos quadrados é um mínimo.

## Contexto e Motivação

Otimização pede o maior ou o menor valor de uma grandeza, e o primeiro movimento em várias variáveis é o que `gradients-extending-derivatives-to-several-variables` descreve: igualar $\nabla f = 0$. Essa lição também avisa, com razão, que um gradiente nulo só produz um *candidato*, que pode ser mínimo, máximo ou sela, e deixa o teste que os distingue fora do escopo. Esta lição o fornece. Em uma variável, a ferramenta é o teste da segunda derivada de `extrema-concavity-and-optimization`: $f'' > 0$ num ponto plano significa uma tigela. Com duas variáveis, a curvatura depende da direção, então o número $f''$ vira uma matriz de segundas parciais, a **Hessiana**, e o teste lê seu padrão de sinais.

Essa também é a linguagem do aprendizado de máquina, onde a perda é função de muitos parâmetros. Um ponto plano da perda com curvatura dos dois sinais é uma sela, onde o gradiente é pequeno e a descida do gradiente desacelera. Se a perda de um modelo tem um único fundo, como em mínimos quadrados com colunas independentes, ou uma paisagem de vales concorrentes é uma pergunta sobre a Hessiana.

## Teoria Central

### Pontos críticos e o teorema de Fermat

$f$ tem um **mínimo local** em $(a, b)$ se $f(x, y) \ge f(a, b)$ para todo $(x, y)$ perto de $(a, b)$, e um **mínimo absoluto** se isso vale em todo o domínio. Máximos são o inverso.

**Teorema de Fermat.** Se $f$ tem um extremo local num ponto interior $(a, b)$ e $f_x$ e $f_y$ existem ali, então $f_x(a, b) = f_y(a, b) = 0$. A prova é de uma linha: $x \mapsto f(x, b)$ tem um extremo local em $a$, então sua derivada $f_x(a, b)$ precisa se anular, e o mesmo vale em $y$.

Um **ponto crítico** é um ponto interior em que as duas parciais são zero ou pelo menos uma não existe. Extremos ocorrem apenas em pontos críticos (ou na fronteira), mas a recíproca é falsa. A origem é crítica para $f = x^2 - y^2$ e não é nem máximo nem mínimo. E pontos em que parciais não existem contam: $f = \sqrt{x^2+y^2}$ tem seu mínimo na origem, onde nenhuma derivada parcial existe.

### A Hessiana e o que ela mede

Quando as segundas parciais são contínuas, o teorema de Clairaut torna a **Hessiana** simétrica:

$$H = \begin{pmatrix} f_{xx} & f_{xy} \\ f_{xy} & f_{yy} \end{pmatrix}, \qquad D = \det H = f_{xx} f_{yy} - f_{xy}^2.$$

O motivo de ela importar é a expansão de Taylor de segunda ordem num ponto crítico. Para um deslocamento $\mathbf h$, com o termo do gradiente nulo,

$$f(\mathbf a + \mathbf h) \approx f(\mathbf a) + \tfrac12 \mathbf h^{\top} H \mathbf h.$$

Assim, perto de um ponto crítico, $f(\mathbf a + \mathbf h) - f(\mathbf a) \approx \tfrac12 \mathbf h^{\top} H \mathbf h$. Quando $D \ne 0$, o sinal dessa forma quadrática decide o comportamento; quando $H$ é degenerada (o Exemplo 2 tem $H = 0$), ela diz pouco. A forma é positiva para todo $\mathbf h \ne 0$ exatamente quando os dois autovalores de $H$ são positivos (uma tigela), negativa para todo $\mathbf h$ quando ambos são negativos (uma cúpula), e assume os dois sinais quando os autovalores têm sinais opostos (uma sela). Como $D$ é o produto dos autovalores e $f_{xx} + f_{yy}$ sua soma, isso é um teste de sinais.

### O teste da segunda derivada

**Teorema.** Suponha que $f$ tenha segundas parciais contínuas num disco em torno de $(a, b)$ e que $\nabla f(a, b) = 0$. Então:

- se $D > 0$ e $f_{xx} > 0$, $f$ tem um mínimo local em $(a, b)$;
- se $D > 0$ e $f_{xx} < 0$, um máximo local;
- se $D < 0$, um ponto de sela: $f$ sobe em algumas direções e desce em outras;
- se $D = 0$, o teste **não dá informação**.

Para $D > 0$, os autovalores têm o mesmo sinal, e $f_{xx}$ diz qual. Para $D < 0$, têm sinais opostos. Em $n$ variáveis a mesma lógica vale para os autovalores da Hessiana $n \times n$: todos positivos dão um mínimo local, todos negativos um máximo local, autovalores dos dois sinais uma sela (mesmo que outro autovalor seja zero), e um autovalor nulo é inconclusivo apenas quando os não nulos têm o mesmo sinal.

### Extremos absolutos numa região fechada

**Teorema do Valor Extremo.** Se $f$ é contínua num conjunto fechado e limitado $R$, ela atinge um máximo absoluto e um mínimo absoluto em $R$. Para encontrá-los: (1) liste os pontos críticos do interior; (2) examine $f$ na fronteira, em geral parametrizando-a e usando cálculo de uma variável, incluindo as extremidades; (3) compare todos os valores. As duas hipóteses importam. No disco unitário aberto, $f = x + y$ tem supremo $\sqrt2$ que nunca é atingido, e no plano inteiro $f = x + y$ não tem máximo nem mínimo.

## Exemplos Resolvidos

### Exemplo 1: uma sela e um mínimo

Seja $f(x, y) = x^3 + y^3 - 3xy$. Então $f_x = 3x^2 - 3y$ e $f_y = 3y^2 - 3x$. Igualar ambas a zero dá $y = x^2$ e $x = y^2$, logo $x = x^4$, cujas soluções reais são $x = 0$ e $x = 1$. Os pontos críticos são $(0, 0)$ e $(1, 1)$. A Hessiana é

$$H = \begin{pmatrix} 6x & -3 \\ -3 & 6y \end{pmatrix}.$$

Em $(0, 0)$: $H = \begin{pmatrix} 0 & -3 \\ -3 & 0 \end{pmatrix}$, $D = -9 < 0$, uma **sela**. Os autovalores são $-3$ ao longo de $(1, 1)$ e $+3$ ao longo de $(1, -1)$. Isso prevê o que acontece: em $y = x$, $f = 2t^3 - 3t^2 \approx -3t^2$ cai, enquanto em $y = -x$, $f = 3t^2$ sobe. Os números concordam:

```text
passo e       f(e, e)      f(e, -e)
0.1           -0.0280       0.0300
0.01          -0.000298     0.000300
```

Em $(1, 1)$: $H = \begin{pmatrix} 6 & -3 \\ -3 & 6 \end{pmatrix}$, $D = 27 > 0$ e $f_{xx} = 6 > 0$, um **mínimo local** com $f(1, 1) = -1$ e autovalores $3$ e $9$. Não é um mínimo absoluto: $f(-10, 0) = -1000$, e $f$ é ilimitada inferiormente. O teste é uma afirmação local.

A sela também aparece no mapa de contorno. O conjunto de nível $f = 0$ é $x^3 + y^3 = 3xy$, o fólio de Descartes: um laço mais dois ramos ilimitados, que se cruza na origem. É a situação de `directional-derivatives-and-the-direction-of-steepest-ascent` em que $\nabla f = 0$ e o conjunto de nível não tem tangente única.

### Exemplo 2: quando $D = 0$ não decide nada

Na origem, $x^4 + y^4$, $-x^4 - y^4$ e $x^4 - y^4$ têm todas $H = 0$ e $D = 0$. A primeira tem um mínimo, a segunda um máximo, a terceira uma sela (sobe ao longo do eixo $x$ e desce ao longo do eixo $y$). O mesmo resultado do teste cobre três comportamentos diferentes, então uma Hessiana degenerada exige termos de ordem superior ou um argumento direto, por exemplo restringir $f$ a retas e curvas pelo ponto e comparar os sinais, como o eixo $x$ e o eixo $y$ fazem para a terceira função. Até $f = x^2 + y^4$, com $H = \mathrm{diag}(2, 0)$, tem $D = 0$ embora tenha um mínimo.

### Exemplo 3: mínimos quadrados têm um único fundo

Ajuste uma reta $y = wx + b$ aos pontos $(0, 1)$, $(1, 3)$, $(2, 4)$ minimizando o erro quadrático

$$L(w, b) = \sum_i (w x_i + b - y_i)^2 = 5w^2 + 6wb + 3b^2 - 22w - 16b + 26.$$

Igualar $L_w = 10w + 6b - 22 = 0$ e $L_b = 6w + 6b - 16 = 0$ (as equações normais de `least-squares-via-linear-algebra`) dá $w = 3/2$ e $b = 7/6$. A Hessiana é $\begin{pmatrix} 10 & 6 \\ 6 & 6 \end{pmatrix}$, com $D = 60 - 36 = 24 > 0$ e $L_{ww} = 10 > 0$, então é um mínimo local, com autovalores de cerca de $1{,}68$ e $14{,}32$. As colunas $(1, x_i)$ da matriz de design são independentes porque os $x_i$ não são todos iguais, o que garante $D > 0$. Como $L$ é quadrática, sua Hessiana é a mesma em todo ponto e a expansão de segunda ordem é exata: $L(\mathbf p) = L(\mathbf p^*) + \tfrac12 \mathbf h^{\top} H \mathbf h \ge L(\mathbf p^*)$. Trata-se de um mínimo absoluto, com $L = 1/6$.

### Exemplo 4: extremos absolutos num disco

Encontre os extremos de $f(x, y) = x^2 + 2y^2 - 2x$ em $x^2 + y^2 \le 4$, um disco fechado e limitado, de modo que o Teorema do Valor Extremo se aplica.

*Interior.* $f_x = 2x - 2 = 0$ e $f_y = 4y = 0$ dão $(1, 0)$, dentro do disco, com $f = -1$.

*Fronteira.* Seja $x = 2\cos t$, $y = 2\sin t$ e $c = \cos t \in [-1, 1]$. Como $y^2 = 4 - 4c^2$,

$$f = 4c^2 + 8(1 - c^2) - 4c = 8 - 4c^2 - 4c.$$

Sua derivada se anula em $c = -1/2$ (valor $9$), e as extremidades dão $f = 0$ em $c = 1$ e $f = 8$ em $c = -1$. As extremidades do intervalo também precisam ser testadas.

*Compare.* Os valores são $-1$, $9$, $0$ e $8$. O mínimo absoluto é $-1$ em $(1, 0)$ e o máximo absoluto é $9$ em $(-1, \pm\sqrt3)$, pois $c = -1/2$ significa $x = -1$ e $y^2 = 3$. Uma busca por força bruta numa grade sobre o disco encontra os mesmos extremos.

## Equívocos Comuns e Armadilhas

- **"$\nabla f = 0$ significa um extremo."** O Exemplo 1 tem uma sela com gradiente nulo. Verifique o padrão de sinais da Hessiana.
- **"$D > 0$ significa um mínimo."** Máximos também têm $D > 0$. O sinal de $f_{xx}$ os separa.
- **"$D = 0$ significa uma sela."** Significa que o teste falha, e o Exemplo 2 mostra os três desfechos.
- **"Um mínimo local é o mínimo."** O mínimo local em $(1, 1)$ no Exemplo 1 vale $-1$, mas $f$ assume valores tão baixos quanto $-1000$.
- **"Otimizar numa região é resolver $\nabla f = 0$."** O extremo absoluto muitas vezes está na fronteira, como o máximo do Exemplo 4.
- **"Pontos críticos são só onde o gradiente se anula."** Incluem pontos em que uma derivada parcial não existe, como a ponta de um cone.
- **"Selas são exóticas."** Todo ponto crítico cuja curvatura tem os dois sinais é uma, e a descida do gradiente anda devagar perto dele porque o gradiente é pequeno ali.

## Resumo

Um ponto crítico de $f$ é um ponto interior em que o gradiente se anula ou não existe, e pelo teorema de Fermat todo extremo local interior é crítico, mas nem todo ponto crítico é um extremo. Num ponto crítico em que $f$ tem segundas parciais contínuas, a Hessiana decide no caso usual: $D > 0$ com $f_{xx} > 0$ dá um mínimo local, $D > 0$ com $f_{xx} < 0$ um máximo local, $D < 0$ uma sela, e $D = 0$ nenhuma conclusão. A razão é que, perto do ponto, $f - f(\mathbf a)$ é aproximadamente a forma quadrática $\tfrac12 \mathbf h^{\top} H \mathbf h$, cujo formato se lê nos autovalores quando $D \ne 0$. O teste é local, então os extremos absolutos numa região fechada e limitada vêm do Teorema do Valor Extremo: compare os pontos críticos do interior com os valores na fronteira. Com isso a unidade multivariável de derivadas está completa, e `double-integrals-cartesian-and-polar` passa à integração sobre regiões.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.7 Maxima/Minima Problems](https://openstax.org/books/calculus-volume-3/pages/4-7-maxima-minima-problems): pontos críticos, o teste do discriminante, pontos de sela e extremos absolutos em regiões fechadas.
- [Active Calculus Multivariable, Optimization](https://activecalculus.org/multi/S-mv_deriv-optimization.html): classificação de pontos críticos por atividades com a Hessiana.
- [Active Calculus Multivariable, Second-Order Partial Derivatives](https://activecalculus.org/multi/S-mv_deriv-second_order.html): segundas derivadas parciais e mistas que formam a Hessiana.
- [MIT OCW 18.02SC, Unit 2 Part A: Functions of Two Variables](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-a-functions-of-two-variables-tangent-approximation-and-optimization/): sessões de aula sobre problemas de otimização, mínimos quadrados e o teste da segunda derivada.
