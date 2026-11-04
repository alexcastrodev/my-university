---
version: 1.0
updatedAt: 2026-11-04
title: "A Derivada como Taxa de Variação"
summary: "A derivada como limite de um quociente de diferenças: taxa de variação instantânea, inclinação da reta tangente, melhor aproximação linear local, e as funções em que ela não existe."
---
## Objetivos de Aprendizagem

- Definir a derivada de $f$ em um ponto como o limite de um quociente de diferenças e calculá-la pela definição para funções simples.
- Interpretar $f'(a)$ de três maneiras equivalentes: taxa de variação instantânea com unidades, inclinação da reta tangente e coeficiente da melhor aproximação linear local.
- Escrever a reta tangente em um ponto e usá-la para estimar valores próximos, com uma ideia do tamanho do erro.
- Reconhecer as quatro maneiras usuais de a derivada não existir (quina, tangente vertical, descontinuidade, oscilação) e enunciar a relação entre diferenciabilidade e continuidade.
- Explicar por que um computador estima derivadas com um passo pequeno, mas não pequeno demais, e por que a diferença central é o melhor padrão.

## Contexto e Motivação

A lição anterior, `continuity-and-the-intermediate-value-theorem`, tratou de saber se uma pequena mudança na entrada produz uma pequena mudança na saída. Esta lição trata de quão pequena. Duas funções podem ser contínuas e mesmo assim reagir de modos muito diferentes a um empurrão: $f(x) = 0{,}001x$ quase não se move quando $x$ se move, e $g(x) = 1000x$ se desloca mil vezes mais. A **derivada** é o número que mede essa sensibilidade em um ponto.

A ideia é mais antiga que qualquer fórmula. O odômetro de um carro registra posição, enquanto o velocímetro informa outra grandeza, a velocidade. A velocidade em um instante não é uma leitura de posição: é o limite de velocidades médias em janelas cada vez menores. Transformar essa frase em matemática é toda a definição de derivada.

Na computação, a derivada é a grandeza sobre a qual a otimização funciona. Treinar um modelo é escolher parâmetros que tornem um erro pequeno, e o sinal e o tamanho da derivada do erro dizem para que lado mover um parâmetro e o quanto confiar no movimento. A lição `gradients-extending-derivatives-to-several-variables` reúne um número por variável de entrada em um vetor; cada entrada ali é uma derivada comum, do tipo definido aqui, tomada com as outras variáveis fixas. Acertar primeiro a ideia de uma variável, inclusive onde ela falha, é o que torna essa extensão direta.

## Teoria Central

### Da taxa média à taxa instantânea

Para uma função $f$, a **taxa de variação média** em $[a, a + h]$ é o **quociente de diferenças**

$$\frac{f(a + h) - f(a)}{h}.$$

Geometricamente, é a inclinação da reta secante que passa por $(a, f(a))$ e $(a + h, f(a + h))$. A **derivada de $f$ em $a$** é o valor para o qual essa inclinação se estabiliza quando a janela encolhe:

$$f'(a) = \lim_{h \to 0} \frac{f(a + h) - f(a)}{h},$$

desde que o limite exista como um número finito. Forma equivalente: $f'(a) = \lim_{x \to a} \frac{f(x) - f(a)}{x - a}$. Quando $f$ está definida dos dois lados de $a$, os dois limites laterais ($h \to 0^+$ e $h \to 0^-$) precisam coincidir. Na notação de Leibniz, $\frac{dy}{dx}$ é o mesmo número; a notação lembra que as unidades da derivada são as unidades de $y$ divididas pelas de $x$ (metros por segundo, reais por unidade vendida, perda por unidade de parâmetro).

### Três leituras do mesmo número

**Taxa de variação.** Se $s(t)$ é a posição, $s'(t)$ é a velocidade. A derivada é a versão instantânea de "quanto a saída muda por unidade de entrada".

**Inclinação da reta tangente.** A reta tangente em $a$ é a reta que passa por $(a, f(a))$ com inclinação $f'(a)$:

$$y = f(a) + f'(a)(x - a).$$

**Melhor aproximação linear local.** Reescrevendo a definição, o erro $f(a + h) - f(a) - f'(a)h$ não é apenas pequeno: é pequeno em comparação com $h$:

$$\lim_{h \to 0} \frac{f(a + h) - f(a) - f'(a)\,h}{h} = 0.$$

Logo $f(a + h) \approx f(a) + f'(a)h$ para $h$ pequeno, e nenhuma outra reta por $(a, f(a))$ tem essa propriedade. A próxima lição, `differentiation-rules-and-the-chain-rule`, transforma essa leitura na regra da cadeia.

### A derivada como função

Calcular $f'(a)$ para um $a$ genérico produz uma nova função $f'$, definida em todo ponto onde o limite existe. Três cálculos feitos a partir da definição que as próximas lições reaproveitam:

- $f(x) = x^2$: $\frac{(x+h)^2 - x^2}{h} = 2x + h \to 2x$.
- $f(x) = \frac{1}{x}$, para $x \neq 0$: $\frac{1}{h}\left(\frac{1}{x+h} - \frac{1}{x}\right) = \frac{-1}{x(x+h)} \to -\frac{1}{x^2}$.
- $f(x) = \sqrt{x}$, para $x > 0$: multiplicando pelo conjugado, obtém-se $\frac{1}{\sqrt{x+h} + \sqrt{x}} \to \frac{1}{2\sqrt{x}}$. Em $x = 0$ a função só está definida de um lado e o quociente é $\frac{1}{\sqrt{h}}$, que cresce sem limite, então $\sqrt{x}$ não tem derivada em $0$.

### Quando a derivada não existe

A derivada existe em $a$ apenas se o quociente de diferenças tiver limite finito. Quatro falhas usuais são:

- **Quina.** $f(x) = \lvert x \rvert$ em $0$: o quociente é $\frac{\lvert h \rvert}{h}$, que vale $+1$ para $h > 0$ e $-1$ para $h < 0$. Os dois lados discordam.
- **Tangente vertical.** $f(x) = \sqrt[3]{x}$ (raiz cúbica real) em $0$: o quociente é $h^{-2/3}$, que vale cerca de $4{,}6$ em $h = 0{,}1$, $100$ em $h = 10^{-3}$, $10^4$ em $h = 10^{-6}$, e cresce sem limite dos dois lados. O gráfico é contínuo e a tangente é vertical, sem inclinação finita.
- **Descontinuidade.** Se $f$ dá um salto em $a$, o quociente explode.
- **Oscilação.** $f(x) = x \sin\frac{1}{x}$ com $f(0) = 0$ é contínua em $0$, mas o quociente é $\sin\frac{1}{h}$, que vale $1$ em $h = \frac{1}{\pi/2 + 2\pi k}$ e $-1$ em $h = \frac{1}{3\pi/2 + 2\pi k}$ para todo inteiro positivo $k$, e portanto não tem limite.

**Teorema.** Se $f$ é diferenciável em $a$, então $f$ é contínua em $a$.

A demonstração tem uma linha. Para $h \neq 0$, $f(a + h) - f(a) = h \cdot \frac{f(a+h) - f(a)}{h}$. Quando $h \to 0$, o primeiro fator vai a $0$ e o segundo ao número finito $f'(a)$, então o produto vai a $0$, que é a continuidade.

A recíproca é falsa: $\lvert x \rvert$ é contínua em $0$ e não é diferenciável ali. Diferenciabilidade é uma propriedade mais forte que continuidade, não equivalente a ela. A contrapositiva é útil na prática: uma função com salto não pode ter derivada no salto, então as regras de derivação das próximas lições não se aplicam ali.

## Exemplos Resolvidos

### Exemplo 1: velocidade de um objeto em queda

Um objeto solto do repouso cai $s(t) = 4{,}9\,t^2$ metros em $t$ segundos, desprezando a resistência do ar. Encontre sua velocidade em $t = 3$.

Velocidade média em $[3, 3 + h]$, calculada a partir de $s(3) = 44{,}1$:

```text
h        velocidade média (m/s)
0.5      31.85
0.1      29.89
0.01     29.449
0.001    29.4049
```

O padrão se explica pela álgebra: $\frac{4{,}9(3+h)^2 - 44{,}1}{h} = 29{,}4 + 4{,}9h$. Quando $h \to 0$ o termo extra desaparece, então $s'(3) = 29{,}4$ m/s. As unidades vêm do quociente: metros divididos por segundos. Em uma janela curta o objeto realmente se move a cerca de $29{,}4$ m/s, e a reta tangente $y = 44{,}1 + 29{,}4(t - 3)$ prevê a posição perto de $t = 3$.

### Exemplo 2: estimando $\sqrt{4{,}1}$ com a reta tangente

Pelo cálculo acima, $f(x) = \sqrt{x}$ tem $f'(4) = \frac{1}{2\sqrt{4}} = \frac{1}{4}$ e $f(4) = 2$. A reta tangente é $y = 2 + \frac{1}{4}(x - 4)$, então

$$\sqrt{4{,}1} \approx 2 + \frac{0{,}1}{4} = 2{,}025.$$

O valor verdadeiro é $2{,}0248457\ldots$, com erro de cerca de $1{,}5 \times 10^{-4}$. Reduzir o passo mostra o erro caindo mais rápido que $h$:

```text
h       sqrt(4+h)   2 + h/4    erro
0.4     2.097618    2.100000   2.4e-03
0.1     2.024846    2.025000   1.5e-04
0.01    2.002498    2.002500   1.6e-06
```

Dividir $h$ por $10$ divide o erro por cerca de $100$, aqui aproximadamente $0{,}0156\,h^2$. A aproximação só merece confiança perto de $a$, e a curvatura da função determina a rapidez com que ela piora. A reta tangente a $\sqrt{x}$ fica acima da curva, e por isso a estimativa sai um pouco alta.

### Exemplo 3: estimando uma derivada numericamente

Um programa que consegue avaliar $f$, mas não derivá-la, pode usar a **diferença progressiva** $\frac{f(a+h) - f(a)}{h}$ ou a **diferença central** $\frac{f(a+h) - f(a-h)}{2h}$. Tome $f(x) = \sqrt{x}$ em $a = 4$, onde a derivada verdadeira é exatamente $0{,}25$, em precisão dupla:

```text
h        erro progressiva   erro central
1e-01    1.5e-03            2.0e-05
1e-02    1.6e-04            2.0e-07
1e-04    1.6e-06            2.1e-11
1e-05    1.6e-07            1.6e-12
1e-06    1.6e-08            7.6e-11
1e-07    1.5e-09            4.1e-10
1e-08    2.4e-08            1.3e-08
1e-10    2.1e-08            2.1e-08
1e-12    2.2e-05            2.2e-05
1e-16    2.5e-01            2.5e-01
```

Dois efeitos competem. Para $h$ maior, o erro vem da aproximação: o erro da progressiva diminui proporcionalmente a $h$, o da central proporcionalmente a $h^2$. Para $h$ menor, o erro vem do arredondamento: $f(a + h)$ e $f(a)$ coincidem na maioria dos dígitos, então a diferença perde precisão, e dividir por um $h$ minúsculo amplifica o que sobra. Em $h = 10^{-16}$ a soma $4 + h$ arredonda de volta para exatamente $4$, o quociente é $0$ e o erro é a derivada inteira. O melhor passo não é nem o menor nem o maior. Para esta função, a diferença central chega a um erro perto de $10^{-12}$ com um passo perto de $10^{-5}$, enquanto a progressiva não passa de cerca de $10^{-9}$, com um passo perto de $10^{-7}$. Os números exatos dependem da função e da máquina, e o formato da curva, não.

## Equívocos Comuns e Armadilhas

- **"A derivada é a inclinação de uma reta secante."** A secante tem largura finita $h$; a derivada é o limite das inclinações das secantes. Colocar $h = 0$ direto no quociente dá $\frac{0}{0}$, e é por isso que o limite é necessário.
- **"Contínua implica diferenciável."** $\lvert x \rvert$ e $\sqrt[3]{x}$ são contínuas em $0$ e não têm derivada ali. O sentido verdadeiro é o do teorema acima: diferenciável implica contínua.
- **"Quanto menor o passo, mais precisa a derivada numérica."** O Exemplo 3 mostra o contrário abaixo de aproximadamente $10^{-5}$ para a diferença central e $10^{-7}$ para a progressiva. O arredondamento assume o controle.
- **"A aproximação pela reta tangente é boa em toda parte."** Ela é boa perto de $a$, com erro que diminui mais rápido que $h$. Longe de $a$ pode estar muito errada: para $\sqrt{x}$ em $a = 4$, a reta tangente prevê $2 + \frac{12}{4} = 5$ em $x = 16$, onde o valor verdadeiro é $4$, um erro de $25\%$.
- **"$f'(a)$ é a derivada da constante $f(a)$."** A derivada de uma constante é $0$. $f'(a)$ significa derivar $f$ primeiro e só depois avaliar em $a$. Inverter a ordem dá $0$.

## Resumo

A derivada de $f$ em $a$ é o limite do quociente de diferenças $\frac{f(a+h) - f(a)}{h}$ quando $h \to 0$, quando esse limite é um número finito. Ela é, ao mesmo tempo, uma taxa de variação instantânea com unidades, a inclinação da reta tangente e o coeficiente da melhor aproximação linear, no sentido de que o erro da aproximação é pequeno em comparação com $h$. Pela definição, $x^2$ tem derivada $2x$, $\frac{1}{x}$ tem derivada $-\frac{1}{x^2}$ para $x \neq 0$, e $\sqrt{x}$ tem derivada $\frac{1}{2\sqrt{x}}$ para $x > 0$. Diferenciabilidade implica continuidade, e a recíproca falha em quinas e tangentes verticais. Numericamente, é preciso um passo pequeno o bastante para aproximar o limite e grande o bastante para evitar o arredondamento, e, enquanto domina o erro de truncamento e $f''(a) \neq 0$, a diferença central é mais precisa que a progressiva com o mesmo passo. Quando domina o arredondamento, nenhuma das duas é melhor que a outra, e para $\sin x$ em $0$ as duas fórmulas são idênticas. A próxima lição, `differentiation-rules-and-the-chain-rule`, troca os cálculos repetidos de limites por regras.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.1 Defining the Derivative](https://openstax.org/books/calculus-volume-1/pages/3-1-defining-the-derivative): retas tangentes, velocidade e a definição da derivada por limite
- [OpenStax Calculus Volume 1, 3.2 The Derivative as a Function](https://openstax.org/books/calculus-volume-1/pages/3-2-the-derivative-as-a-function): a função derivada, diferenciabilidade e continuidade, e casos em que a derivada não existe
- [OpenStax Calculus Volume 1, 3.4 Derivatives as Rates of Change](https://openstax.org/books/calculus-volume-1/pages/3-4-derivatives-as-rates-of-change): velocidade, rapidez e outras taxas, com unidades
- [MIT OCW 18.01SC, Session 3: Derivative as Rate of Change](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-3-derivative-as-rate-of-change/): a derivada vista como taxa de variação, com videoaulas e notas
- [Active Calculus, 1.8 The tangent line approximation](https://activecalculus.org/single/sec-1-8-tan-line-approx.html): a reta tangente como aproximação linear local
