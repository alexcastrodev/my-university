---
version: 1.0
updatedAt: 2026-11-04
title: "Continuidade e o Teorema do Valor Intermediário"
summary: "Continuidade em um ponto e em um intervalo, os tipos de descontinuidade e o Teorema do Valor Intermediário, a garantia de existência por trás da busca por bisseção."
---
## Objetivos de Aprendizagem

- Enunciar as três condições que tornam uma função contínua em um ponto e usá-las para decidir se uma função dada é contínua ali.
- Classificar uma descontinuidade como removível, de salto, infinita ou oscilante, e dizer qual tipo pode ser consertado redefinindo um único valor.
- Construir funções contínuas a partir de peças contínuas conhecidas e escolher um parâmetro para que uma função definida por partes seja contínua.
- Enunciar o Teorema do Valor Intermediário com todas as hipóteses e mostrar, por exemplos, o que dá errado quando cada uma é retirada.
- Explicar por que o teorema é a garantia de existência por trás da busca por bisseção e reconhecer entradas em que uma troca de sinal não garante uma raiz.

## Contexto e Motivação

A lição `guess-and-check-and-bisection-search` resolve equações sem fórmula dividindo um intervalo ao meio: mantém um `low` e um `high`, testa o ponto médio e descarta a metade que não pode conter a resposta. O laço da raiz quadrada funciona, e a lição explica por que ele é rápido. O que ela deixa em aberto é uma pergunta anterior: por que existe uma resposta dentro de `[low, high]`? Um programa pode dividir um intervalo ao meio para sempre sem que ninguém garanta que aquilo que ele procura existe.

O cálculo responde a isso com o **Teorema do Valor Intermediário**. Em linhas gerais, uma função cujo gráfico não tem quebras não consegue passar de negativa para positiva sem passar por zero. A expressão "em linhas gerais" esconde toda a dificuldade, porque "sem quebras" precisa virar uma propriedade precisa e verificável de $f$. Essa propriedade é a **continuidade**, e é o primeiro ponto desta disciplina em que um limite serve para definir uma propriedade de uma função, e não para calcular um número.

A continuidade importa além da bisseção. Quase todo teorema sobre derivadas e integrais nas lições seguintes começa com "suponha que $f$ seja contínua em $[a, b]$", e as falhas ensinam: uma descontinuidade é onde métodos numéricos, otimizadores e simulações costumam se comportar mal, porque uma pequena mudança na entrada produz uma grande mudança na saída.

## Teoria Central

### Continuidade em um ponto

Uma função $f$ é **contínua em $a$** quando as três condições abaixo valem:

1. $f(a)$ está definida.
2. $\lim_{x \to a} f(x)$ existe.
3. $\lim_{x \to a} f(x) = f(a)$.

Em palavras: o valor do qual a função se aproxima (`limits-intuition-and-the-formal-definition`) é o valor que ela de fato assume. Forma equivalente: $f(a + h) \to f(a)$ quando $h \to 0$, ou seja, uma mudança minúscula na entrada produz uma mudança minúscula na saída.

Uma função é **contínua em um intervalo** se for contínua em todos os pontos dele. Nas extremidades de um intervalo fechado $[a, b]$ exige-se apenas o limite lateral vindo de dentro do intervalo.

A continuidade se constrói por peças. Polinômios, $\sin x$, $\cos x$ e $e^x$ são contínuos em todo número real. Somas, diferenças, produtos e composições de funções contínuas são contínuos, e um quociente $f/g$ é contínuo onde $g \neq 0$. Esses fatos são as leis dos limites (`limit-laws-and-indeterminate-forms`) reescritas, e por isso a maioria das verificações de continuidade se reduz a procurar um ponto onde o denominador se anula ou a fórmula muda.

### Tipos de descontinuidade

Quando uma das três condições falha, a forma da falha tem nome:

- **Removível:** $\dfrac{x^2 - 1}{x - 1}$ em $1$. O limite é $2$, mas $f(1)$ não está definida.
- **De salto:** $\lfloor x \rfloor$ em $0$. Os limites laterais são $-1$ e $0$, então o limite não existe.
- **Infinita:** $\dfrac{1}{x}$ em $0$. A função é ilimitada perto de $a$.
- **Oscilante:** $\sin\!\left(\dfrac{1}{x}\right)$ em $0$. Os valores ficam oscilando entre $-1$ e $1$.

Só o tipo removível pode ser consertado, atribuindo a $f(a)$ o valor do limite. Definir $f(1) = 2$ transforma $\frac{x^2-1}{x-1}$ na função contínua $x + 1$.

Um ponto onde $f$ não está definida é um ponto onde $f$ não é contínua, mas isso não faz de $\frac{1}{x}$ uma função "quebrada": ela é contínua em todos os pontos do seu domínio, que simplesmente tem uma lacuna em $0$. Essa distinção volta no teorema a seguir.

### O Teorema do Valor Intermediário

**Teorema.** Seja $f$ contínua no intervalo fechado $[a, b]$, e seja $N$ qualquer número estritamente entre $f(a)$ e $f(b)$. Então existe pelo menos um $c$ em $(a, b)$ com $f(c) = N$.

O caso especial mais usado é $N = 0$: se $f$ é contínua em $[a, b]$ e $f(a)$ e $f(b)$ têm sinais opostos, então $f$ tem uma raiz em $(a, b)$.

Cada hipótese tem sua função, e o jeito mais rápido de ver isso é retirá-la.

- **Retire a continuidade.** Seja $f(x) = -1$ para $x < 0$ e $f(x) = 1$ para $x \geq 0$, em $[-1, 1]$. Os valores nas extremidades são $-1$ e $1$, e mesmo assim $f$ nunca vale $0$, nem qualquer outro número intermediário.
- **Retire o intervalo.** $f(x) = \frac{1}{x}$ tem $f(-1) = -1$ e $f(1) = 1$ e é contínua em todo ponto onde está definida, mas não tem raiz. O intervalo $[-1, 1]$ não está contido no domínio, porque falta o $0$.
- **Inverta a implicação.** O teorema não diz que uma raiz obriga uma troca de sinal. $f(x) = x^2$ tem raiz em $0$ no intervalo $[-1, 1]$ embora $f(-1) = f(1) = 1$.
- **Troque o sistema numérico.** O teorema depende de os reais não terem lacunas. Nos racionais, $f(x) = x^2 - 2$ é contínua, $f(0) = -2$ e $f(2) = 2$, e ainda assim não há raiz racional.

A conclusão também é fraca de duas maneiras que vale registrar. Ela diz "pelo menos um", não "exatamente um": $x^3 - x$ tem três raízes em $[-2, 2]$. E não diz nada sobre onde está $c$. É um enunciado de existência, e achar $c$ é outro trabalho.

### Do teorema à bisseção

Suponha $f$ contínua em $[a, b]$, com $f(a)$ e $f(b)$ de sinais opostos. Seja $m = \frac{a + b}{2}$. Se $f(m) = 0$, a busca terminou. Caso contrário, $f(m)$ tem o sinal de exatamente uma das extremidades, então uma das metades $[a, m]$ e $[m, b]$ volta a ter extremidades de sinais opostos. O teorema, aplicado a essa metade, garante uma raiz dentro dela. Repetindo o passo, após $n$ passos o intervalo tem largura $\frac{b - a}{2^n}$ e contém uma raiz.

Esse é o laço de `guess-and-check-and-bisection-search`. A busca pela raiz quadrada de $x > 0$ é a bisseção de $f(t) = t^2 - x$ em $[0, \max(1, x)]$. Na extremidade esquerda, $f(0) = -x < 0$; na direita, $f(\text{high}) \geq 0$ (para $x \geq 1$ vale $x^2 - x$; para $x < 1$ vale $1 - x$). O teste `guess ** 2 < x` é o sinal de $f(\text{guess})$. Um polinômio é contínuo, então o teorema é o que torna verdadeiro, a cada passo, o invariante "há uma raiz entre `low` e `high`". Aquela lição enuncia a pré-condição como um espaço ordenado em que cada verificação revela uma direção. O teorema dá uma mais fraca e mais geral: uma troca de sinal em um intervalo onde $f$ é contínua, sem exigir que $f$ seja monótona.

## Exemplos Resolvidos

### Exemplo 1: escolhendo um parâmetro para a continuidade

Encontre $a$ para que

$$f(x) = \begin{cases} a x + 1 & x \leq 2 \\ x^2 - a & x > 2 \end{cases}$$

seja contínua em toda parte.

Cada peça é um polinômio, logo contínuo na sua região, então o único risco está em $x = 2$. A peça da esquerda dá $f(2) = 2a + 1$, que também é o limite pela esquerda. O limite pela direita é $2^2 - a = 4 - a$. A condição 3 pede $2a + 1 = 4 - a$, portanto $a = 1$.

Conferência com $a = 1$: os dois lados dão $3$, então o limite existe e vale $f(2) = 3$. Com qualquer outro $a$, os limites laterais diferem e $f$ tem um salto em $2$.

### Exemplo 2: resolvendo $\cos x = x$ por bisseção

Seja $f(x) = \cos x - x$ em $[0, 1]$. Ela é contínua (diferença de funções contínuas), $f(0) = 1 > 0$ e $f(1) \approx -0{,}4597 < 0$. O teorema garante uma raiz em $(0, 1)$. Bisseção, mantendo a metade cujas extremidades ainda têm sinais opostos:

```text
passo    a         b         m       f(m)      mantém
1     0.000000  1.000000  0.500000  +0.377583  direita
2     0.500000  1.000000  0.750000  -0.018311  esquerda
3     0.500000  0.750000  0.625000  +0.185963  direita
4     0.625000  0.750000  0.687500  +0.085335  direita
5     0.687500  0.750000  0.718750  +0.033879  direita
6     0.718750  0.750000  0.734375  +0.007875  direita
7     0.734375  0.750000  0.742188  -0.005196  esquerda
8     0.734375  0.742188  0.738281  +0.001345  direita
```

Após oito passos, a raiz está em $[0{,}738281, 0{,}742188]$, um intervalo de largura $2^{-8} \approx 0{,}0039$. A raiz verdadeira, $0{,}7390851\ldots$, está dentro dele, como o teorema exige. Para fixar a raiz em largura $10^{-6}$ partindo de largura $1$, é preciso o menor $n$ com $2^{-n} \leq 10^{-6}$, que é $n = 20$.

Essa função não tem solução em forma fechada, que é justamente a situação em que o teorema e o algoritmo se justificam.

### Exemplo 3: uma troca de sinal sem raiz

Tome $f(x) = \frac{1}{x}$ em $[-1, 2]$. Os valores nas extremidades são $-1$ e $0{,}5$, sinais opostos, então o laço de bisseção começa sem reclamar. Os pontos médios se apertam em torno de $0$:

```text
passo  intervalo após o passo         f(m)
1      [-1.0, 0.5]                    +2
5      [-0.0625, 0.03125]             +32
10     [-0.00098, 0.00195]            -1024
20     [-9.5e-07, 1.9e-06]            -1048576
```

O intervalo encolhe como prometido, mas $\lvert f(m) \rvert$ dobra a cada passo em vez de diminuir. O laço está convergindo para a descontinuidade, não para uma raiz. Uma proteção prática é conferir, no fim, se $\lvert f \rvert$ no ponto final é de fato pequeno. Uma troca de sinal só garante uma raiz quando a hipótese de continuidade foi verificada à parte.

## Equívocos Comuns e Armadilhas

- **"Contínua significa que dá para desenhar o gráfico sem tirar o lápis do papel."** A imagem é razoável para uma função em um intervalo, e é como o teorema costuma ser lembrado. Ela engana em domínios com lacunas: $\frac{1}{x}$ é contínua em todo ponto onde está definida, embora o gráfico venha em dois pedaços.
- **"O teorema encontra a raiz, ou diz que ela é única."** Ele só afirma que existe pelo menos uma no intervalo aberto. Onde está e quantas são, são perguntas à parte. A bisseção de $x^3 - x$ em $[-2, 1{,}5]$ converge para $-1$ e ignora as raízes em $0$ e $1$.
- **"Se não há troca de sinal, não há raiz."** $x^2$ em $[-1, 1]$ toca o zero sem trocar de sinal, então uma bisseção iniciada ali não tem o que usar. O teorema dá uma condição suficiente, não necessária.
- **"Qualquer intervalo com sinais opostos torna a bisseção segura."** O Exemplo 3 é o contraexemplo. A continuidade em todo o intervalo faz parte da hipótese, e a bisseção não consegue verificá-la.
- **"No computador, a bisseção divide ao meio para sempre."** Números reais podem ser divididos indefinidamente; doubles não. Aplicada a $\cos x - x$ em $[0, 1]$ em precisão dupla, um laço sem teste de zero divide o intervalo 53 vezes até que o ponto médio coincida com uma extremidade, deixando uma largura de cerca de $1{,}1 \times 10^{-16}$. Com o teste de zero do algoritmo acima, a execução para um passo antes, no passo 52, em que `cos(m) - m` vale exatamente `0.0`, uma coincidência de arredondamento e não uma prova de que $m$ é a raiz exata. Um laço que para quando o ponto médio repete uma extremidade sempre termina. Um laço que para pela largura do intervalo só termina se a tolerância não for menor que o espaçamento dos doubles perto da raiz, cerca de $1{,}1 \times 10^{-16}$ aqui, de modo que `while b - a > 1e-20` nunca sai. Um laço que exige $\lvert f(m) \rvert$ abaixo de uma tolerância minúscula pode nunca chegar lá, como a lição de bisseção avisa.

## Resumo

Uma função é contínua em $a$ quando $f(a)$ está definida, o limite em $a$ existe e os dois coincidem. As falhas são de quatro tipos: removível, de salto, infinita e oscilante, e só a primeira pode ser consertada redefinindo um valor. O Teorema do Valor Intermediário diz que, se $f$ é contínua em $[a, b]$, então $f$ assume todo valor entre $f(a)$ e $f(b)$ em algum ponto do intervalo; com sinais opostos nas pontas, garante uma raiz. Cada hipótese é necessária: retirar a continuidade, usar um intervalo com lacuna ou sair dos números reais quebra a conclusão, e a recíproca é falsa. A bisseção é o teorema transformado em algoritmo: cada passo mantém a metade com troca de sinal, de modo que a raiz continua presa enquanto a largura cai como $2^{-n}$. O teorema garante existência, não unicidade nem localização, e a bisseção não detecta sozinha uma descontinuidade. A próxima lição, `the-derivative-as-a-rate-of-change`, usa a mesma maquinaria de limites para perguntar com que rapidez $f$ varia em um ponto.

## Documentation Links

- [OpenStax Calculus Volume 1, 2.4 Continuity](https://openstax.org/books/calculus-volume-1/pages/2-4-continuity): continuidade em um ponto e em um intervalo, tipos de descontinuidade e o Teorema do Valor Intermediário
- [MIT OCW 18.01SC, Session 5: Discontinuity](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-5-discontinuity/): descontinuidades de salto e removíveis em videoaulas e notas
- [MIT OCW 18.01SC, Session 4: Limits and Continuity](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-4-limits-and-continuity/): limites e a noção relacionada de continuidade, com videoaulas e um mathlet
- [Active Calculus, 1.7 Limits, continuity, and differentiability](https://activecalculus.org/single/sec-1-7-lim-cont-diff.html): continuidade e sua relação com a diferenciabilidade
