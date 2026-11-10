---
version: 1.0
updatedAt: 2026-11-04
title: "Sequências e Convergência"
summary: "Sequências como funções nos números naturais, a definição formal de convergência com epsilon e N, limites por leis, confronto e funções contínuas, e o teorema da convergência monótona para sequências limitadas."
---
## Objetivos de Aprendizagem

- Descrever uma sequência como uma função nos números naturais, dada por uma fórmula explícita ou por uma recorrência.
- Enunciar a definição de convergência com $\varepsilon$ e $N$, ler corretamente seus quantificadores e usá-la para achar $N$ dada uma tolerância.
- Calcular limites de sequências com as leis de limites, o teorema do confronto e funções contínuas, conferindo cada hipótese.
- Enunciar o teorema da convergência monótona, usá-lo em uma sequência definida por recorrência e mostrar que, sem qualquer uma das hipóteses, a conclusão falha.
- Explicar por que "termos consecutivos ficam próximos" não implica convergência, e o que isso significa para critérios de parada em algoritmos iterativos.

## Contexto e Motivação

A lição anterior, `improper-integrals`, tomou um limite quando uma variável contínua $b$ crescia sem parar. Boa parte da computação troca essa variável contínua por um contador de passos: o método de Newton refina uma estimativa a cada iteração, o gradiente descendente produz uma lista de vetores de parâmetros, uma média acumulada é recalculada conforme os dados chegam. Em cada caso a pergunta é a mesma: a lista de números se estabiliza, e em quê?

Uma **sequência** é uma lista $a_1, a_2, a_3, \dots$ de números reais, formalmente uma função de $\{1, 2, 3, \dots\}$ em $\mathbb{R}$, escrita $(a_n)$. Os termos podem ser dados por uma fórmula, como $a_n = 1/n$, ou por uma regra que constrói cada termo a partir dos anteriores, como $a_{n+1} = \sqrt{2 + a_n}$ com $a_1 = 1$. Começar o índice em $0$ ou em $1$ é questão de conveniência e não afeta nada do que segue. Os limites de funções quando $x \to \infty$ foram estudados em `limits-at-infinity-and-asymptotic-growth`; aqui a variável só assume valores inteiros, o que facilita alguns argumentos e muda algumas afirmações.

## Teoria Central

### A definição de convergência

A sequência $(a_n)$ **converge** para $L$ se, para todo $\varepsilon > 0$, existe um índice $N$ tal que

$$\lvert a_n - L \rvert < \varepsilon \quad \text{para todo } n \ge N$$

Em palavras: qualquer que seja a tolerância exigida, os termos acabam dentro dela e ficam lá. A ordem dos quantificadores importa. O índice $N$ pode depender de $\varepsilon$, e em geral precisa depender, já que uma tolerância menor pede um início mais tardio. Uma sequência que não converge para nenhum número real **diverge**. Isso inclui sequências que crescem sem limite (podemos escrever $a_n \to \infty$ como abreviação, mas o limite não é um número real) e sequências que oscilam, como $(-1)^n$.

Dois fatos básicos decorrem daí. O limite é único. E uma sequência convergente é limitada, porque depois do índice $N$ todos os termos estão a distância menor que $1$ de $L$, e só há finitos termos antes. A recíproca é falsa: $(-1)^n$ é limitada e diverge.

Alterar finitos termos nunca muda se a sequência converge, nem o seu limite. Por isso afirmações como "a sequência é monótona a partir de certo ponto" bastam nas demonstrações.

### Calculando limites

Se $a_n \to L$ e $b_n \to M$, então $a_n + b_n \to L + M$, $a_n b_n \to LM$ e $a_n / b_n \to L/M$ desde que $M \neq 0$ (e $b_n \neq 0$). Para uma constante $c$, $c \cdot a_n \to cL$. Essas leis espelham as leis de limites de funções, e só valem quando os dois limites existem: separar uma soma em duas parcelas divergentes não prova nada.

**Teorema do confronto.** Se $a_n \le c_n \le b_n$ para todo $n \ge n_0$ e $a_n \to L$, $b_n \to L$, então $c_n \to L$.

**Funções contínuas.** Se $a_n \to L$, todo $a_n$ está no domínio de $f$ e $f$ é contínua em $L$, então $f(a_n) \to f(L)$. A continuidade em $L$ é essencial. Seja $f(x) = 0$ para $x \neq 0$ e $f(0) = 1$. Então $a_n = 1/n \to 0$ e $f(a_n) = 0$ para todo $n$, de modo que $f(a_n) \to 0 \neq f(0)$.

**De funções para sequências.** Se $f(x) \to L$ quando $x \to \infty$ e $a_n = f(n)$, então $a_n \to L$. A volta falha: $a_n = \sin(\pi n) = 0$ converge, enquanto $\sin(\pi x)$ não tem limite quando $x \to \infty$.

### O teorema da convergência monótona

Uma sequência é **não decrescente** se $a_{n+1} \ge a_n$ para todo $n$, e **não crescente** se $a_{n+1} \le a_n$. O teorema:

> Se $(a_n)$ é não decrescente e limitada superiormente, ela converge. Se é não crescente e limitada inferiormente, ela converge.

Quando converge, o limite de uma sequência não decrescente é a menor cota superior dos seus termos. Essa é a grande conveniência do teorema: ele prova que o limite existe sem saber qual é. As duas hipóteses são necessárias. A sequência $a_n = n$ é monótona e não é limitada, e diverge. A sequência $(-1)^n$ é limitada e não é monótona, e também diverge. Além disso, uma cota superior não é, em geral, o limite: $a_n = 1 - 1/n$ é limitada superiormente por $2$ e converge para $1$.

O teorema depende de os números reais não terem lacunas. Dentro dos racionais ele falha: a sequência de frações do Exemplo 3 abaixo é monótona a partir do segundo termo e limitada, mas seu limite $\sqrt{2}$ não é racional.

Um uso clássico: a sequência $(1 + 1/n)^n$ é crescente e limitada superiormente por $3$ (os dois fatos podem ser provados com o binômio de Newton), logo converge, e seu limite é o número $e$:

```text
n          (1 + 1/n)^n
1          2.0
10         2.5937
100        2.7048
1000       2.7169
1000000    2.7183
```

## Exemplos Resolvidos

### Exemplo 1: achando $N$ a partir de $\varepsilon$

Mostre que $a_n = \dfrac{3n+1}{n+2} \to 3$. Calcule a distância até o limite proposto:

$$\lvert a_n - 3 \rvert = \left\lvert \frac{3n + 1 - 3(n+2)}{n+2} \right\rvert = \frac{5}{n+2}$$

Isso fica abaixo de $\varepsilon$ exatamente quando $n > 5/\varepsilon - 2$. Então, para qualquer $\varepsilon$, qualquer inteiro $N > 5/\varepsilon - 2$ serve.

```text
epsilon    n deve superar    menor N
0.1        48                49
0.01       498               499
0.001      4998              4999
```

Conferindo $\varepsilon = 0{,}01$: em $n = 499$ a distância é $5/501 \approx 0{,}00998 < 0{,}01$, enquanto em $n = 498$ ela vale exatamente $0{,}01$, que não é menor que $0{,}01$. A demonstração está completa porque a mesma álgebra vale para todo $\varepsilon$, e não porque três valores foram testados.

### Exemplo 2: uma recorrência e o teorema da convergência monótona

Seja $a_1 = 1$ e $a_{n+1} = \sqrt{2 + a_n}$. Os primeiros termos são $1;\ 1{,}7321;\ 1{,}9319;\ 1{,}9829;\ 1{,}9957;\ 1{,}9989$.

**Limitada.** Se $0 < a_n < 2$, então $a_{n+1} < \sqrt{4} = 2$ e $a_{n+1} > 0$. Como $a_1 = 1$, a indução dá $0 < a_n < 2$ para todo $n$.

**Crescente.** De $a_{n+1}^2 = 2 + a_n$,

$$a_{n+1}^2 - a_n^2 = 2 + a_n - a_n^2 = (2 - a_n)(1 + a_n) > 0$$

e, como os termos são positivos, $a_{n+1} > a_n$.

**O limite.** Pelo teorema da convergência monótona, $a_n \to L$ para algum $L$. Só agora é legítimo tomar limites nos dois lados da recorrência. Como a raiz quadrada é contínua, $L = \sqrt{2 + L}$, logo $L^2 - L - 2 = 0$ e $L = 2$ ou $L = -1$. Todo termo é pelo menos $1$, então $L = 2$.

A distância $2 - a_n$ vale $0{,}268;\ 0{,}0681;\ 0{,}0171;\ 0{,}00428$ para $n = 2, 3, 4, 5$, encolhendo por um fator próximo de $1/4$ a cada passo (as razões são $0{,}254;\ 0{,}251;\ 0{,}250$).

### Exemplo 3: a iteração de Newton para $\sqrt{2}$

Comece com $a_1 = 1$ e faça $a_{n+1} = \tfrac12\left(a_n + \dfrac{2}{a_n}\right)$. Em frações exatas os termos são $1,\ \tfrac32,\ \tfrac{17}{12},\ \tfrac{577}{408}$. O erro $a_n - \sqrt{2}$, calculado em alta precisão, é:

```text
n    a_n                     a_n - sqrt(2)
1    1                       -0.4142
2    1.5                      0.0858
3    1.416667                 2.45e-3
4    1.4142157                2.12e-6
5    1.41421356237469         1.59e-12
6    1.41421356237309505      9.0e-25
```

O número de dígitos corretos mais ou menos dobra a cada passo. Para provar a convergência, note que, para $a_n > 0$, a desigualdade entre as médias aritmética e geométrica dá $a_{n+1} \ge \sqrt{a_n \cdot 2/a_n} = \sqrt{2}$ para todo $n \ge 1$. Então, para $n \ge 2$, temos $a_n \ge \sqrt{2}$, e

$$a_{n+1} - a_n = \frac{2 - a_n^2}{2 a_n} \le 0$$

A sequência é não crescente a partir de $n = 2$ e limitada inferiormente por $\sqrt{2}$, logo converge. (O primeiro termo $1$ está abaixo de $\sqrt{2}$, e por isso a monotonicidade começa em $n = 2$.) O limite satisfaz $L = \tfrac12 (L + 2/L)$, portanto $L^2 = 2$.

Em aritmética de precisão dupla, os iterados calculados param de mudar no sexto termo, de modo que o programa chega a um ponto fixo, uma versão concreta de uma sequência eventualmente constante. Uma versão com frações exatas nunca para, porque os denominadores não param de crescer.

### Exemplo 4: espremendo um fatorial

Mostre que $n!/n^n \to 0$. Escreva $\dfrac{n!}{n^n} = \dfrac{1}{n} \cdot \dfrac{2}{n} \cdot \dfrac{3}{n} \cdots \dfrac{n}{n}$. Todo fator, exceto o primeiro, é no máximo $1$, então $0 \le n!/n^n \le 1/n$, e as duas cotas tendem a $0$. O teorema do confronto dá o limite. Os valores reais caem muito mais rápido que a cota:

```text
n     n!/n^n         1/n
5     0.0384         0.2
10    3.6288e-04     0.1
20    2.3202e-08     0.05
50    3.4243e-21     0.02
```

A cota é válida mas grosseira, e uma cota válida e grosseira é tudo de que o confronto precisa.

## Equívocos Comuns e Armadilhas

- **"Toda sequência limitada converge."** A sequência $(-1)^n$ é limitada por $1$ e diverge. Ser limitada é metade do teorema da convergência monótona, nunca ele inteiro.
- **"Se $a_{n+1} - a_n \to 0$, a sequência converge."** Tome $a_n = \sqrt{n}$. O passo $\sqrt{10^6 + 1} - \sqrt{10^6}$ vale cerca de $0{,}0005$, e a sequência chega a $1000$ em $n = 10^6$ sem teto. Um laço que para "quando valores sucessivos diferem menos que uma tolerância" pode parar sobre uma sequência que diverge. A regra é uma heurística; ela se justifica quando a taxa de convergência é conhecida, como no Exemplo 3.
- **"Resolva $L = f(L)$ para achar o limite."** Isso só é válido depois de a convergência estar estabelecida. Seja $a_1 = 1$ e $a_{n+1} = 2a_n + 1$. Resolver $L = 2L + 1$ dá $L = -1$, mas os termos são $1, 3, 7, 15, 31, 63, \dots$, que crescem sem limite.
- **"A cota superior é o limite."** A sequência $(1 + 1/n)^n$ é limitada por $3$ e converge para $2{,}71828\dots$. Só a menor cota superior é o limite de uma sequência não decrescente.
- **"$N$ não depende de $\varepsilon$."** Em geral, depende. No Exemplo 1, $N$ vai de $49$ a $4999$ conforme $\varepsilon$ cai de $0{,}1$ para $0{,}001$.
- **"Se $f(n) \to L$, então $f(x) \to L$."** Falso, como $\sin(\pi n)$ mostra. A implicação vai da função para a sequência, e só nesse sentido.
- **"As leis de limites separam qualquer limite."** Elas valem quando cada parcela converge. Para $a_n = n$ e $b_n = -n$, ambas divergem, mas $a_n + b_n = 0$ converge.

## Resumo

Uma sequência é uma função nos números naturais, e converge para $L$ quando, para toda tolerância $\varepsilon$, os termos acabam permanentemente a menos de $\varepsilon$ de $L$. Sequências convergentes têm limite único e são limitadas, embora sequências limitadas não precisem convergir. Os limites se calculam com as leis de limites (só quando cada parcela converge), o teorema do confronto e funções contínuas (contínuas no limite). O teorema da convergência monótona diz que uma sequência não decrescente e limitada superiormente, ou não crescente e limitada inferiormente, converge, e é a ferramenta para recorrências cujo limite não se conhece de antemão: primeiro provar a existência, depois resolver para o valor. Termos sucessivos ficarem próximos não basta, o que importa para critérios de parada. A próxima lição, `arithmetic-and-geometric-progressions`, estuda em forma fechada as duas famílias mais simples de sequências e decide exatamente quando a geométrica converge.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.1 Sequences](https://openstax.org/books/calculus-volume-2/pages/5-1-sequences): termo geral, limites de sequências, teorema do confronto e teorema da convergência monótona.
- [OpenStax Calculus Volume 1: 2.5 The Precise Definition of a Limit](https://openstax.org/books/calculus-volume-1/pages/2-5-the-precise-definition-of-a-limit): a ideia de epsilon e delta para funções, que a definição com epsilon e N espelha.
- [OpenStax Calculus Volume 1: 2.3 The Limit Laws](https://openstax.org/books/calculus-volume-1/pages/2-3-the-limit-laws): as leis algébricas e o teorema do confronto que passam para sequências.
