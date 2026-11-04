---
version: 1.0
updatedAt: 2026-11-04
title: "A Regra de L'Hôpital"
summary: "A regra de L'Hôpital para 0/0 e infinito sobre infinito, quando suas hipóteses falham, e como reescrever as outras formas indeterminadas para que ela se aplique, incluindo a comparação de taxas de crescimento."
---
## Objetivos de Aprendizagem

- Enunciar a Regra de L'Hôpital para $\frac00$ e $\frac{\infty}{\infty}$ com todas as hipóteses, inclusive a mais esquecida: o limite do quociente das derivadas precisa existir.
- Reconhecer limites em que a regra não se aplica e limites em que ela se aplica mas não ajuda.
- Reescrever as formas $0 \cdot \infty$, $\infty - \infty$, $1^\infty$, $0^0$ e $\infty^0$ para que a regra se torne utilizável.
- Provar que logaritmos crescem mais devagar que qualquer potência positiva, e potências mais devagar que exponenciais, e ligar isso à comparação de tempos de execução de algoritmos.

## Contexto e Motivação

As leis de limites de `limit-laws-and-indeterminate-forms` não dizem nada quando um quociente tem a forma $\frac00$ ou $\frac{\infty}{\infty}$. Fatorar e racionalizar funcionam para expressões algébricas, mas não ajudam em algo como $\frac{e^x - 1 - x}{x^2}$ quando $x \to 0$. A Regra de L'Hôpital troca o quociente de duas funções pelo quociente de suas derivadas, que costuma ser bem mais simples. A ideia é que, perto do ponto do limite, uma função derivável se comporta como sua reta tangente, então a razão das funções se comporta como a razão das inclinações.

A regra também é a ferramenta padrão para a hierarquia de dominância de `limits-at-infinity-and-asymptotic-growth`, que é o cálculo por baixo de `big-o-and-asymptotic-complexity`: ela prova que $n \ln n$ cresce mais devagar que $n^{1,5}$ e que polinômios crescem mais devagar que exponenciais. Mas a regra é um teorema com hipóteses, e tratá-la como o hábito mecânico de "derivar em cima e embaixo" é uma fonte confiável de respostas erradas. Esta lição dedica tanto tempo a quando ela falha quanto a quando funciona.

## Teoria Central

### O enunciado

**Regra de L'Hôpital.** Sejam $f$ e $g$ deriváveis em um intervalo aberto que contém $a$, exceto possivelmente em $a$, com $g'(x) \ne 0$ para $x \ne a$ nesse intervalo. Suponha que

1. $\lim_{x \to a} f(x) = 0$ e $\lim_{x \to a} g(x) = 0$, ou que $\lvert f\rvert$ e $\lvert g\rvert$ tendam ambos a $\infty$; e
2. $\lim_{x \to a} \frac{f'(x)}{g'(x)}$ exista, como número finito ou como $\pm\infty$.

Então

$$\lim_{x \to a} \frac{f(x)}{g(x)} = \lim_{x \to a} \frac{f'(x)}{g'(x)}.$$

O mesmo enunciado vale para limites laterais e para $x \to \pm\infty$. A demonstração é um refinamento do Teorema do Valor Médio (a forma de Cauchy, que compara duas funções no mesmo ponto intermediário). Uma checagem rápida de plausibilidade para $\frac00$: se $f(a) = g(a) = 0$ e ambas são deriváveis em $a$ com $g'(a) \ne 0$, então $\frac{f(x)}{g(x)} = \frac{f(x) - f(a)}{g(x) - g(a)}$, e dividir em cima e embaixo por $x - a$ dá $\frac{f'(a)}{g'(a)}$ no limite.

Repare no sentido da implicação. Se o quociente das derivadas tem limite, o original também tem. A recíproca é falsa. A condição 1 diz que a regra serve só para formas indeterminadas. A condição 2 diz que um quociente de derivadas que fica oscilando não informa nada.

### Reescrevendo as outras formas indeterminadas

A regra precisa de um quociente. As outras formas são convertidas antes.

- **$0 \cdot \infty$:** escreva $f \cdot g$ como $\frac{f}{1/g}$ ou $\frac{g}{1/f}$, o que tiver derivadas mais simples.
- **$\infty - \infty$:** junte em uma só fração, ou fatore.
- **$1^\infty$, $0^0$, $\infty^0$:** para $y = f(x)^{g(x)}$ com $f > 0$, tome logaritmos: $\ln y = g(x)\ln f(x)$ é uma forma $0 \cdot \infty$. Se $\ln y \to \ell$, então $y \to e^\ell$, porque a exponencial é contínua. É a positividade de $f$ que torna o logaritmo legítimo.

## Exemplos Resolvidos

### Exemplo 1: a regra em ação

Calcule $\lim_{x \to 0} \frac{e^x - 1 - x}{x^2}$. Numerador e denominador tendem a $0$, então a forma é $\frac00$. Derivar dá $\frac{e^x - 1}{2x}$, que de novo é $\frac00$. Derivar mais uma vez dá $\frac{e^x}{2}$, que tende a $\frac12$. A segunda aplicação só foi válida porque o primeiro resultado ainda era indeterminado. Pare no momento em que a forma deixa de ser indeterminada: aplicar a regra a $\frac{e^x}{2}$ seria um erro. Uma conferência numérica concorda: em $x = 0{,}1;\ 0{,}01;\ 0{,}001$ o quociente vale $0{,}51709$, $0{,}50167$ e $0{,}50017$.

### Exemplo 2: três maneiras de a regra falhar

**Não se aplica: a forma não é indeterminada.** Tome $\lim_{x \to 1} \frac{x^2 + 1}{x + 1}$. O numerador tende a $2$ e o denominador a $2$, então a continuidade dá o limite $1$. Derivar assim mesmo dá $\frac{2x}{1} \to 2$, uma resposta errada.

**Não se aplica: o quociente das derivadas não tem limite.** Tome $\lim_{x \to \infty} \frac{x + \sin x}{x}$. A forma é $\frac{\infty}{\infty}$ e as funções são deriváveis, mas o quociente das derivadas é $\frac{1 + \cos x}{1}$, que fica oscilando entre $0$ e $2$ e não tem limite. A condição 2 falha, então a regra não diz nada. O limite original existe do mesmo jeito: $\frac{x + \sin x}{x} = 1 + \frac{\sin x}{x}$ e $\frac{\lvert\sin x\rvert}{x} \le \frac1x \to 0$ pelo teorema do confronto, logo o limite é $1$. Um segundo exemplo do mesmo problema é $\lim_{x \to 0} \frac{x^2 \sin(1/x)}{\sin x}$. É $\frac00$, mas o quociente das derivadas $\frac{2x\sin(1/x) - \cos(1/x)}{\cos x}$ oscila perto de $0$. Já o original é $\frac{x}{\sin x} \cdot x\sin\frac1x \to 1 \cdot 0 = 0$.

**Aplica-se, mas não ajuda.** Tome $\lim_{x \to \infty} \frac{x}{\sqrt{x^2 + 1}}$. É $\frac{\infty}{\infty}$ e as hipóteses valem. O quociente das derivadas é $\frac{1}{x/\sqrt{x^2 + 1}} = \frac{\sqrt{x^2 + 1}}{x}$, o inverso do que tínhamos. Aplique a regra de novo e a expressão original volta, para sempre. A ferramenta certa é a álgebra: divida em cima e embaixo por $x$, obtendo $\frac{1}{\sqrt{1 + 1/x^2}} \to 1$. (Para $x > 0$, $\sqrt{x^2} = x$; para $x \to -\infty$ o mesmo truque dá $-1$.)

### Exemplo 3: outras formas indeterminadas

**$0 \cdot \infty$.** $\lim_{x \to 0^+} x\ln x$. Escreva como $\frac{\ln x}{1/x}$, uma forma $\frac{-\infty}{\infty}$. O quociente das derivadas é $\frac{1/x}{-1/x^2} = -x \to 0$, então o limite é $0$. A outra reescrita, $\frac{x}{1/\ln x}$, é válida mas produz $-x\ln^2 x$, outra forma $0 \cdot \infty$ mais difícil que a inicial. Escolha a reescrita cuja derivada simplifica.

**$\infty - \infty$.** $\lim_{x \to 0} \left(\frac{1}{\sin x} - \frac1x\right) = \lim \frac{x - \sin x}{x\sin x}$, que é $\frac00$. Uma aplicação dá $\frac{1 - \cos x}{\sin x + x\cos x}$, ainda $\frac00$. Uma segunda dá $\frac{\sin x}{2\cos x - x\sin x} \to \frac02 = 0$. Os valores em $x = 0{,}1$ e $0{,}01$ são $0{,}016686$ e $0{,}001667$, coerentes com limite $0$.

**$0^0$.** $\lim_{x \to 0^+} x^x$. Para $x > 0$, $\ln(x^x) = x\ln x \to 0$ pelo item anterior, então $x^x \to e^0 = 1$. A restrição a $x \to 0^+$ importa: $x^x$ em geral não está definida para $x$ negativo, então não existe limite bilateral.

**$1^\infty$.** $\lim_{x \to \infty} \left(1 + \frac1x\right)^x$ tem $\ln y = x\ln\left(1 + \frac1x\right) = \frac{\ln(1 + 1/x)}{1/x}$, uma forma $\frac00$ cujo quociente das derivadas é $\frac{1}{1 + 1/x} \to 1$. Logo o limite é $e^1 = e$.

### Exemplo 4: comparando taxas de crescimento

Para qualquer $p > 0$, $\lim_{x \to \infty} \frac{\ln x}{x^p}$ é $\frac{\infty}{\infty}$, e o quociente das derivadas é $\frac{1/x}{p\,x^{p-1}} = \frac{1}{p\,x^p} \to 0$. Portanto toda potência positiva acaba vencendo o logaritmo. Do mesmo modo, $\lim_{x \to \infty} \frac{x^n}{e^x}$ vira $\frac{n\,x^{n-1}}{e^x}$, depois $\frac{n(n-1)x^{n-2}}{e^x}$, e após $n$ aplicações $\frac{n!}{e^x} \to 0$, para qualquer inteiro positivo $n$. Para um expoente real $p > 0$ e $x \ge 1$, $x^p \le x^{\lceil p\rceil}$, logo $\frac{x^p}{e^x} \le \frac{x^{\lceil p\rceil}}{e^x} \to 0$. Logo $e^x$ acaba vencendo qualquer potência de $x$.

Consequência para algoritmos: $\frac{n \ln n}{n^{1,5}} = \frac{\ln n}{\sqrt n} \to 0$, então $n \ln n$ cresce mais devagar que $n^{1,5}$. Para este par não há cruzamento a procurar: $\frac{\ln x}{\sqrt x}$ atinge o pico em $x = e^2$ com valor $\frac2e \approx 0{,}736$ e depois cai, então $n \ln n < n^{1,5}$ para todo $n \ge 1$. A convergência para $0$, porém, é lenta:

```text
n          ln(n)/sqrt(n)
10         0.7281
100        0.4605
10^4       0.0921
10^6       0.0138
10^8       0.0018
```

O limite de uma variável real $x$ dá o limite da sequência de inteiros $n$ por restrição. Um cruzamento distante ocorre em outros pares, como polinômio contra exponencial. $n^{10}$ é maior que $2^n$ para todo $n$ de $2$ a $58$ (em $n = 58$: $2^{58} \approx 2{,}88 \times 10^{17}$ contra $58^{10} \approx 4{,}31 \times 10^{17}$), e $2^n$ assume a liderança a partir de $n = 59$ ($2^{59} \approx 5{,}76 \times 10^{17}$ contra $59^{10} \approx 5{,}11 \times 10^{17}$). O limite diz quem vence no fim, não onde fica o ponto de cruzamento.

## Equívocos Comuns e Armadilhas

- **Derivar o quociente em vez de derivar em cima e embaixo.** A regra usa $\frac{f'}{g'}$, não $\left(\frac fg\right)'$.
- **Aplicar quando a forma não é indeterminada.** O Exemplo 2 dá $2$ em vez de $1$. Substitua primeiro.
- **"Se $\frac{f'}{g'}$ não tem limite, $\frac fg$ também não tem."** Os exemplos de oscilação refutam isso; a regra fica muda, não negativa.
- **Parar tarde ou cedo demais.** Reconfira a forma a cada aplicação e simplifique antes de derivar de novo.
- **Usar diretamente em sequências.** Uma sequência $a_n$ não tem derivada. Estenda para uma função de variável real $x$, aplique a regra e conclua sobre a sequência a partir do limite da função.
- **Raciocínio circular.** Usar a regra para provar que $\lim_{x \to 0}\frac{\sin x}{x} = 1$ pressupõe a derivada de $\sin x$, que no desenvolvimento usual é provada justamente a partir desse limite.
- **Recorrer a ela por reflexo.** Quando a álgebra funciona (dividir pela maior potência, fatorar), costuma ser mais curta e mais segura.

## Resumo

A Regra de L'Hôpital diz que, se $\frac{f}{g}$ tem a forma $\frac00$ ou $\frac{\infty}{\infty}$ perto de $a$, as funções são deriváveis com $g' \ne 0$ e $\frac{f'}{g'}$ tem limite (finito ou infinito), então $\frac fg$ tem o mesmo limite. Todas as hipóteses sustentam o resultado. Uma forma não indeterminada dá respostas erradas, como em $\frac{x^2 + 1}{x + 1}$ em $1$. Um quociente de derivadas que oscila deixa a regra muda, como em $\frac{x + \sin x}{x}$, cujo limite é $1$ por confronto. E um limite como $\frac{x}{\sqrt{x^2 + 1}}$ gira em círculos sem progresso e cede à álgebra. As outras formas indeterminadas são reescritas como quocientes, e as potências, tomando logaritmos de uma base positiva. Aplicada a taxas de crescimento, a regra mostra que $\ln x \ll x^p \ll e^x$ quando $x \to \infty$, o cálculo por baixo da comparação de tempos como $n\ln n$ contra $n^{1,5}$. O limite diz quem vence no fim, não onde cai um cruzamento, como mostra $n^{10}$ contra $2^n$. A próxima lição, `antiderivatives-and-initial-value-problems`, roda a derivação ao contrário.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.8: L'Hôpital's Rule](https://openstax.org/books/calculus-volume-1/pages/4-8-lhopitals-rule): a regra para $\frac00$ e $\frac{\infty}{\infty}$, as outras formas indeterminadas e a comparação de taxas de crescimento.
- [MIT OCW 18.01SC, Unit 5, Part A: L'Hospital's Rule and Improper Integrals](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-a-lhospitals-rule-and-improper-integrals/): sessões de aula sobre a regra e suas aplicações.
