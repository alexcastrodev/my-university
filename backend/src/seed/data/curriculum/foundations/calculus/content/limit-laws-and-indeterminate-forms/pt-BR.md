---
version: 1.0
updatedAt: 2026-11-04
title: "Leis dos Limites e Formas Indeterminadas"
summary: "As leis algébricas que permitem calcular limites em vez de adivinhá-los, o teorema do confronto e como fatoração e racionalização resolvem 0/0, enquanto dividir pela maior potência resolve infinito sobre infinito."
---
## Objetivos de Aprendizagem

- Enunciar as leis dos limites com suas hipóteses e dizer em que sentido cada implicação vale.
- Calcular limites de polinômios e funções racionais por substituição direta, e reconhecer quando a substituição não é permitida.
- Explicar por que $0/0$ é chamado de indeterminado e resolvê-lo por fatoração, racionalização ou soma de frações.
- Enunciar e aplicar o Teorema do Confronto, incluindo o que dá errado quando suas hipóteses são enfraquecidas.
- Explicar por que uma reescrita algebricamente equivalente pode dar a resposta certa em ponto flutuante quando a expressão original dá a errada.

## Contexto e Motivação

A lição anterior, `limits-intuition-and-the-formal-definition`, definiu limite e demonstrou dois deles com $\varepsilon$ e $\delta$. Isso não escala. Um cálculo real de derivada envolve dezenas de limites, e ninguém escreve uma demonstração $\varepsilon$-$\delta$ para cada um. As leis dos limites são a solução: elas dizem que limites atravessam somas, produtos e quocientes, de modo que o limite de uma expressão complicada é montado a partir dos limites de partes simples, como um compilador avalia uma árvore de expressão das folhas para cima.

As leis têm uma lacuna, e ela é a parte interessante. A lei do quociente exige que o limite do denominador seja diferente de zero. Os limites mais importantes do cálculo são exatamente aqueles em que numerador e denominador vão a zero. Essas são as **formas indeterminadas**, e pedem outro método: reescrever a expressão até que o fator problemático desapareça. Essa reescrita também é uma técnica numérica prática. Avaliar diretamente expressões do tipo $0/0$ em ponto flutuante perde dígitos, e a forma algebricamente simplificada os recupera, como mostra uma tabela no Exemplo 2.

## Teoria Central

### As leis dos limites

**Teorema (leis dos limites).** Suponha $\lim_{x\to a}f(x)=A$ e $\lim_{x\to a}g(x)=B$, com $A$ e $B$ números reais (os dois limites existem e são finitos). Então:

- $\lim (f+g)=A+B$ e $\lim (f-g)=A-B$;
- $\lim (cf)=cA$ para qualquer constante $c$;
- $\lim (fg)=AB$;
- $\lim (f/g)=A/B$, desde que $B\ne0$;
- $\lim f(x)^n=A^n$ para $n$ inteiro positivo;
- $\lim \sqrt[n]{f(x)}=\sqrt[n]{A}$ para $n$ inteiro positivo, desde que, quando $n$ é par, $A>0$, ou $A=0$ com $f(x)\ge0$ perto de $a$.

As leis vêm da definição. Para a soma, dado $\varepsilon$, tome $\delta_1$ que põe $f$ a menos de $\varepsilon/2$ de $A$ e $\delta_2$ que põe $g$ a menos de $\varepsilon/2$ de $B$. Com $\delta=\min(\delta_1,\delta_2)$, a desigualdade triangular dá $\lvert f+g-(A+B)\rvert\le\lvert f-A\rvert+\lvert g-B\rvert<\varepsilon$.

Cada hipótese trabalha, e as implicações vão em um sentido só:

- **As partes precisam ter limite.** As funções $1/x$ e $-1/x$ não têm limite em $0$, mas sua soma é a constante $0$, cujo limite é $0$. O produto $x\cdot\tfrac1x$ tem limite $1$ em $0$, embora os fatores tenham limites $0$ e "nenhum". Quando uma parte não tem limite, a lei se cala: a combinação pode ou não ter um.
- **O quociente exige $B\ne0$.** Quando $B=0$ a lei não dá resposta. (Veja Formas indeterminadas abaixo.)
- **A raiz de índice par exige $A>0$, ou $A=0$ com $f\ge0$ perto de $a$.** Para $f(x)=x^2$ em $0$ temos $A=0$ e $\sqrt{x^2}=\lvert x\rvert\to0$, o que está certo. Para $f(x)=x$ em $0$ também temos $A=0$, mas $f<0$ à esquerda, então $\sqrt{x}$ é indefinida ali e o limite bilateral não existe. Só existe o limite à direita.
- **A composição exige mais que um limite.** Se $\lim_{x\to a}g(x)=B$, a regra tentadora $\lim f(g(x))=\lim_{u\to B}f(u)$ falha em geral. Seja $g(x)=0$ para todo $x$, e $f(u)=1$ para $u\ne0$ com $f(0)=0$. Então $f(g(x))=0$ para todo $x$, e seu limite é $0$, enquanto $\lim_{u\to0}f(u)=1$. A regra vale em duas situações. Uma é $f$ ser contínua em $B$ (precisado em `continuity-and-the-intermediate-value-theorem`), o que é verdade para todo polinômio, função racional longe de seus polos, exponencial e assim por diante. A outra é $g(x)\ne B$ para $x\ne a$ perto de $a$, de modo que o valor de $f$ em $B$ nunca é usado.

**Substituição direta.** Aplicando as leis repetidamente a $x\to a$: para um polinômio $p$, $\lim_{x\to a}p(x)=p(a)$; para uma função racional $p/q$ com $q(a)\ne0$, $\lim_{x\to a}p(x)/q(x)=p(a)/q(a)$. Por exemplo, $\lim_{x\to3}\dfrac{x^2+1}{x+1}=\dfrac{10}{4}=\dfrac52$.

### Formas indeterminadas

Quando a substituição num quociente dá $0/0$, as leis não decidem o limite. A forma é chamada de **indeterminada** porque o mesmo formato pode esconder respostas diferentes. Todos estes quatro têm a forma $0/0$ em $x=0$:

```text
f(x)        limite com x->0+   limite com x->0-
x/x                   1                  1
2x/x                  2                  2
x^2/x                 0                  0
x/x^2         +infinito          -infinito
```

Saber que numerador e denominador vão a zero não diz nada sobre a razão; importa a velocidade com que cada um vai. Distinga isso de um numerador não nulo sobre um denominador que vai a zero, que não é indeterminado: $\dfrac{x+2}{x-1}$ em $x=1$ tem numerador tendendo a $3$ e denominador a $0$, então os valores crescem sem limite, para $+\infty$ pela direita e $-\infty$ pela esquerda, e o limite bilateral não existe.

A estratégia para $0/0$ é reescrever a expressão, para $x\ne a$, numa que as leis consigam tratar. Como um limite nunca usa o valor em $x=a$, a reescrita só precisa ser válida para $x\ne a$.

- **Fatorar e cancelar** um fator comum que se anula em $a$.
- **Racionalizar** uma expressão com raiz quadrada multiplicando numerador e denominador pelo conjugado.
- **Somar frações** sobre um denominador comum.

Para $\infty/\infty$ com $x\to\infty$, divida numerador e denominador pela maior potência de $x$. Por exemplo, $\dfrac{3x^2-x}{x^2+5}=\dfrac{3-1/x}{1+5/x^2}$, e como $1/x\to0$ e $1/x^2\to0$ (para todo $\varepsilon>0$, $1/x<\varepsilon$ quando $x>1/\varepsilon$, e $1/x^2\le1/x$ para $x\ge1$; `limits-at-infinity-and-asymptotic-growth` enuncia a definição no infinito), o limite é $\dfrac{3-0}{1+0}=3$. As outras formas indeterminadas ($0\cdot\infty$, $\infty-\infty$, $1^\infty$ e assim por diante) são reescritas nessas duas; `lhopitals-rule` as trata de forma sistemática.

### O Teorema do Confronto

**Teorema (Confronto).** Suponha $g(x)\le f(x)\le h(x)$ para todo $x$ num intervalo aberto que contém $a$, exceto possivelmente em $a$, e $\lim_{x\to a}g(x)=\lim_{x\to a}h(x)=L$. Então $\lim_{x\to a}f(x)=L$.

As duas hipóteses são necessárias. Se a desigualdade vale só de um lado de $a$, no máximo se obtém uma conclusão lateral. Se as cotas têm limites diferentes, nada se conclui: $-1\le\sin(1/x)\le1$ vale em toda parte, mas $-1$ e $1$ não prendem nenhum valor único, e, como a lição anterior mostrou, $\lim_{x\to0}\sin(1/x)$ não existe.

A aplicação mais útil é $\lim_{x\to0}\dfrac{\sin x}{x}=1$. Comparar áreas no círculo unitário dá $\sin x<x<\tan x$ para $0<x<\pi/2$. Dividir por $\sin x$ e inverter dá $\cos x<\dfrac{\sin x}{x}<1$. Como $\cos x\to1$ e a função $\sin x/x$ é par, os mesmas cotas valem para $-\pi/2<x<0$, e o confronto dá o limite $1$. Numericamente, em $x=0{,}1$ as três quantidades são $0{,}99500$, $0{,}99833$ e $1$.

## Exemplos Resolvidos

### Exemplo 1: fatorar e cancelar

Encontre $\lim_{x\to2}\dfrac{x^2-5x+6}{x-2}$. A substituição dá $0/0$, e a lei do quociente não se aplica. Fatore o numerador: $x^2-5x+6=(x-2)(x-3)$. Para $x\ne2$, o quociente é igual a $x-3$, então o limite é $2-3=-1$.

Confira pelos dois lados: em $x=1{,}99$ o quociente é $-1{,}01$, em $2{,}01$ é $-0{,}99$. Note o que foi e o que não foi afirmado: a função original continua indefinida em $2$. O limite é $-1$ porque a função coincide com $x-3$ em todos os outros pontos.

### Exemplo 2: racionalizar, e por que isso importa em ponto flutuante

Encontre $\lim_{x\to0}\dfrac{\sqrt{x+4}-2}{x}$. Multiplique pelo conjugado $\sqrt{x+4}+2$:

$$\frac{\sqrt{x+4}-2}{x}\cdot\frac{\sqrt{x+4}+2}{\sqrt{x+4}+2}=\frac{(x+4)-4}{x(\sqrt{x+4}+2)}=\frac{1}{\sqrt{x+4}+2}\quad(x\ne0).$$

Pelas leis da raiz, da soma e do quociente, o limite é $\dfrac{1}{\sqrt4+2}=\dfrac14$.

Agora avalie as duas formas em precisão dupla:

```text
       x   (sqrt(x+4)-2)/x   1/(sqrt(x+4)+2)
   1e-01       0.2484567313      0.2484567313
   1e-04       0.2499984375      0.2499984375
   1e-08       0.2499999763      0.2499999998
   1e-12       0.2500222251      0.2500000000
   1e-14       0.2220446049      0.2500000000
   1e-15       0.0000000000      0.2500000000
```

A primeira coluna subtrai dois números quase iguais, $\sqrt{x+4}$ e $2$, e a subtração expõe erros de arredondamento cometidos antes, no cálculo de $x+4$ e de sua raiz quadrada. A subtração em si é exata, mas o erro que ela deixa é dividido por um $x$ minúsculo. Em $x=10^{-15}$ ela devolve $0$. A forma racionalizada não tem subtração de valores próximos e fica em $0{,}25$. A álgebra que resolve o limite à mão é a mesma que torna o código preciso.

### Exemplo 3: o Teorema do Confronto

Mostre que $\lim_{x\to0}x^2\sin(1/x)=0$. As leis não podem ser usadas diretamente, porque $\sin(1/x)$ não tem limite. Mas $-1\le\sin(1/x)\le1$ para $x\ne0$, e multiplicar por $x^2\ge0$ preserva as desigualdades:

$$-x^2\le x^2\sin(1/x)\le x^2.$$

As duas cotas tendem a $0$ quando $x\to0$, então o limite é $0$. Numericamente, em $x=0{,}1$ o valor do meio é $-0{,}00544$ com cotas $\pm0{,}01$; em $x=0{,}001$ é $8{,}27\times10^{-7}$ com cotas $\pm10^{-6}$. A multiplicação por $x^2\ge0$ era necessária: multiplicar uma desigualdade por um número negativo a inverte, o que é um deslize comum quando o fator que serve de cota pode mudar de sinal.

### Exemplo 4: um limite pelas leis e por um limite conhecido

Encontre $\lim_{x\to0}\dfrac{1-\cos x}{x^2}$, o limite que enganou a tabela em ponto flutuante da lição anterior. Use $1-\cos x=2\sin^2(x/2)$:

$$\frac{1-\cos x}{x^2}=\frac{2\sin^2(x/2)}{x^2}=\frac12\left(\frac{\sin(x/2)}{x/2}\right)^2.$$

Quando $x\to0$, também $x/2\to0$, e $x/2\ne0$ para $x\ne0$, então a segunda situação da regra da composição se aplica e $\dfrac{\sin(x/2)}{x/2}\to1$ pelo resultado do Teorema do Confronto acima. As leis da potência e do múltiplo constante dão $\tfrac12\cdot1^2=\tfrac12$. A reescrita é a mesma usada na coluna estável da tabela anterior.

## Equívocos Comuns e Armadilhas

- **"$0/0=1$"** ou **"$0/0=0$".** Nenhum dos dois: a forma é indeterminada, e a tabela acima mostra quatro resultados diferentes a partir dela. Cada limite precisa da sua própria reescrita.
- **"Se $\lim(f+g)$ existe, então $\lim f$ e $\lim g$ existem."** A recíproca é a lei; esse sentido é falso ($1/x$ e $-1/x$).
- **"Substituí, deu $k/0$ com $k\ne0$, então o limite é $\infty$."** Só se o sinal for o mesmo dos dois lados. Em $(x+2)/(x-1)$ não é, e o limite bilateral não existe.
- **"Cancelar mudou a função, então o limite está errado."** O limite nunca olha para $x=a$. Cancelar um fator válido para $x\ne a$ é legítimo.
- **"Valor absoluto se comporta como álgebra comum."** $\lvert x-3\rvert/(x-3)$ tende a $1$ pela direita e a $-1$ pela esquerda. Separe nos dois casos antes de simplificar.
- **"Uma calculadora que mostra $0$ resolve."** A tabela do Exemplo 2 devolveu $0$ em $x=10^{-15}$ para um limite de $1/4$.
- **"Confronto com quaisquer cotas."** As cotas precisam valer perto de $a$ e ter o mesmo limite. Cotas como $\pm1$ para $\sin(1/x)$ não prendem nada.

## Resumo

As leis dos limites permitem calcular limites de somas, produtos, quocientes, potências e raízes a partir dos limites das partes, desde que as partes tenham limites finitos (o quociente também exige limite do denominador diferente de zero, e a raiz par exige limite positivo, ou zero com argumento não negativo). Elas valem em um sentido só: uma combinação pode ter limite quando suas partes não têm. A substituição funciona para polinômios e para funções racionais longe de denominadores nulos. Quando ela produz $0/0$, a resposta não é determinada pela forma, e o remédio é reescrever para $x\ne a$ fatorando, racionalizando ou somando frações; para $\infty/\infty$ divide-se pela maior potência. O Teorema do Confronto trata fatores oscilantes prendendo-os entre duas funções com o mesmo limite, e dá $\sin x/x\to1$, que por sua vez dá $(1-\cos x)/x^2\to\tfrac12$. As mesmas reescritas que resolvem esses limites à mão são as que mantêm precisa a avaliação em ponto flutuante. A próxima lição, `limits-at-infinity-and-asymptotic-growth`, aplica essas ferramentas quando $x$ cresce sem limite.

## Documentation Links

- [OpenStax Calculus Volume 1: 2.3 The Limit Laws](https://openstax.org/books/calculus-volume-1/pages/2-3-the-limit-laws): as leis dos limites, limites de polinômios e funções racionais, fatoração, multiplicação pelo conjugado e o Teorema do Confronto.
- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): limites laterais e infinitos, nos quais a discussão de formas indeterminadas acima se apoia.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): uma unidade de curso gratuita cujas sessões 4 e 8 cobrem limites e continuidade e os limites de seno e cosseno, com vídeos e notas.
