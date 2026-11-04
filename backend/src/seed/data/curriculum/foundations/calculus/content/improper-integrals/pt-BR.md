---
version: 1.0
updatedAt: 2026-11-04
title: "Integrais Impróprias"
summary: "Integrais sobre intervalos ilimitados ou de funções que explodem em um ponto, definidas como limites; convergência e divergência, o teste-p, o teorema da comparação e por que uma densidade de probabilidade precisa ter integral 1 na reta toda."
---
## Objetivos de Aprendizagem

- Definir uma integral imprópria sobre um intervalo ilimitado, e sobre um intervalo em que o integrando explode, como limite de integrais comuns, e dizer quando ela converge ou diverge.
- Classificar $\int_1^\infty x^{-p}\,dx$ e $\int_0^1 x^{-p}\,dx$ para todo $p$ real (o teste-$p$) e calcular o valor quando há convergência.
- Aplicar o teorema da comparação com todas as hipóteses para decidir a convergência sem achar uma primitiva.
- Reconhecer as duas armadilhas clássicas: usar o Teorema Fundamental do Cálculo atravessando uma singularidade e deixar um limite simétrico esconder uma divergência.
- Explicar por que "a densidade tem área total 1" é uma integral imprópria sobre a reta toda, e por que uma densidade pode ter integral 1 sem que sua média exista.

## Contexto e Motivação

A integral definida que você construiu com somas de Riemann (`the-definite-integral-and-riemann-sums`) e calculou com primitivas (`the-fundamental-theorem-of-calculus`) foi definida para uma função em um intervalo fechado e limitado $[a, b]$, e o Teorema Fundamental exige que a função seja contínua em todo ele. Duas situações quebram essas hipóteses, e as duas aparecem o tempo todo na prática: um intervalo que nunca termina, como a cauda de uma distribuição, e um integrando que dispara para o infinito em uma extremidade. A área em jogo ainda pode ser um número finito perfeitamente razoável, então o trabalho é dizer com precisão quando isso acontece e como calculá-la.

A lição `continuous-random-variables-and-pdfs` apresentou a densidade de probabilidade como uma curva não negativa com área total 1, e conferiu essa condição com retângulos e triângulos sobre um intervalo limitado. As densidades que importam na prática, entre elas a exponencial e a normal, têm formas curvas e caudas que ficam positivas para sempre, então a "área total" é a área sob uma cauda infinita. Essa área é um limite, e é isso que esta lição torna preciso. A mesma maquinaria decide se uma média ou uma variância existe, o que é uma pergunta real para grandezas de cauda pesada.

## Teoria Central

### Tipo I: intervalo ilimitado

Se $f$ é contínua em $[a, \infty)$, define-se

$$\int_a^\infty f(x)\,dx = \lim_{b\to\infty} \int_a^b f(x)\,dx$$

A integral **converge** se esse limite existe e é um número finito, e **diverge** caso contrário (o limite é $\pm\infty$ ou não existe). O caso $(-\infty, b]$ é o espelho. Para a reta toda, escolha qualquer $c$ e exija que cada metade convirja sozinha:

$$\int_{-\infty}^{\infty} f(x)\,dx = \int_{-\infty}^{c} f(x)\,dx + \int_{c}^{\infty} f(x)\,dx$$

Se uma das metades diverge, a integral toda diverge. A escolha de $c$ não altera a resposta.

### Tipo II: integrando que explode

Se $f$ é contínua em $(a, b]$ mas ilimitada perto de $a$, define-se

$$\int_a^b f(x)\,dx = \lim_{t\to a^+} \int_t^b f(x)\,dx$$

e uma explosão na extremidade direita é tratada do mesmo jeito. Se o ponto problemático $c$ está no interior de $(a, b)$, divida em $c$ e exija que os dois pedaços convirjam separadamente. Uma função que tem apenas um buraco removível, como $\sin x / x$ em $0$, não torna a integral imprópria, porque a função se estende a uma função contínua.

### O teste-$p$

Para $p \neq 1$ a primitiva de $x^{-p}$ é $x^{1-p}/(1-p)$, logo $\int_1^b x^{-p}\,dx = (b^{1-p} - 1)/(1-p)$. Quando $b \to \infty$, a potência $b^{1-p}$ tende a $0$ se $p > 1$ e a $\infty$ se $p < 1$. Para $p = 1$ a integral vale $\ln b \to \infty$. Na outra ponta, $\int_t^1 x^{-p}\,dx$ se trata do mesmo modo com $t \to 0^+$. O resultado:

- $\int_1^\infty x^{-p}\,dx$ converge exatamente quando $p > 1$, e então vale $\dfrac{1}{p-1}$.
- $\int_0^1 x^{-p}\,dx$ converge exatamente quando $p < 1$, e então vale $\dfrac{1}{1-p}$.

O caso limite $p = 1$ diverge nos dois. A cauda quer decaimento rápido ($p$ grande); a singularidade quer uma explosão branda ($p$ pequeno).

### O teorema da comparação

Suponha que $f$ e $g$ sejam contínuas em $[a, \infty)$ e que $0 \le f(x) \le g(x)$ para todo $x \ge a$. Então:

- se $\int_a^\infty g$ converge, $\int_a^\infty f$ também converge, e $\int_a^\infty f \le \int_a^\infty g$;
- se $\int_a^\infty f$ diverge, $\int_a^\infty g$ também diverge.

O motivo é curto. Como $f \ge 0$, a função $b \mapsto \int_a^b f$ nunca decresce, e como $f \le g$ ela fica limitada por $\int_a^\infty g$. Uma grandeza não decrescente e limitada superiormente tem limite (a versão para sequências desse fato é o tema de `sequences-and-convergence`). O teorema não diz nada quando a integral menor converge ou quando a maior diverge. Ele também falha sem a hipótese $f \ge 0$: com $f(x) = -1$ e $g(x) = 1/x^2$ temos $f \le g$ e $\int_1^\infty g = 1$, mas $\int_1^b f = -(b-1) \to -\infty$.

### Densidades, normalização e momentos

Uma densidade $f$ na reta precisa satisfazer $f \ge 0$ e $\int_{-\infty}^{\infty} f = 1$, agora lida como um par de integrais impróprias. A densidade normal de `the-normal-distribution` é enunciada ali sem dedução, e sua constante é exatamente o que essa integral exige: $\int_{-\infty}^{\infty} e^{-x^2/2}\,dx = \sqrt{2\pi}$, de modo que dividir por $\sqrt{2\pi}$ (e reescalar por $\sigma$) dá área total 1. Não existe primitiva elementar de $e^{-x^2/2}$, então esse valor vem de outro argumento, enquanto a convergência por si só segue da comparação: para $x \ge 1$, $x^2/2 \ge x/2$, logo $0 < e^{-x^2/2} \le e^{-x/2}$, e $\int_1^\infty e^{-x/2}\,dx = 2e^{-1/2}$ é finita (o Exemplo 3 faz o mesmo para $e^{-x^2}$).

A média de uma variável aleatória contínua é $\int x f(x)\,dx$, outra integral imprópria. A normalização não garante que ela convirja, e o Exemplo 4 mostra densidades em que ela falha.

## Exemplos Resolvidos

### Exemplo 1: as $p$-integrais com números

Calcule $\int_1^b x^{-2}\,dx = 1 - 1/b$ e $\int_1^b x^{-1}\,dx = \ln b$ para $b$ crescente:

```text
b          int_1^b x^-2    int_1^b x^-1    int_1^b x^(-1/2)
10         0.9             2.3026          4.3246
100        0.99            4.6052          18.0
1000       0.999           6.9078          61.2456
1000000    0.999999        13.8155         1998.0
```

A primeira coluna se estabiliza em $1$, então $\int_1^\infty x^{-2}\,dx = 1$. As outras duas crescem sem parar, então $\int_1^\infty x^{-1}\,dx$ e $\int_1^\infty x^{-1/2}\,dx$ divergem. Repare como $\ln b$ é lento: precisa de $b = 10^6$ para chegar a cerca de $13{,}8$. Uma tabela pode sugerir divergência, mas é a fórmula que prova.

Perto de zero os papéis se invertem. $\int_t^1 x^{-1/2}\,dx = 2 - 2\sqrt{t}$, que tende a $2$ quando $t \to 0^+$, então $\int_0^1 x^{-1/2}\,dx = 2$ mesmo com o integrando ilimitado. Já $\int_t^1 x^{-1}\,dx = -\ln t$ cresce sem limite, então $\int_0^1 x^{-1}\,dx$ diverge.

### Exemplo 2: duas armadilhas

**Atravessando uma singularidade.** Considere $\int_{-1}^{1} x^{-2}\,dx$. A primitiva $-1/x$ dá $(-1/1) - (-1/(-1)) = -2$, uma resposta negativa para um integrando positivo, o que já denuncia o erro. A função $x^{-2}$ não é contínua em $0$, então o Teorema Fundamental não se aplica em $[-1, 1]$. Dividindo em $0$, $\int_t^1 x^{-2}\,dx = 1/t - 1$, que vale $9, 99, 999$ para $t = 0{,}1;\ 0{,}01;\ 0{,}001$ e tende a $\infty$. A integral diverge para $+\infty$.

**Um limite simétrico.** Para $f(x) = x$, o limite simétrico é $\lim_{R\to\infty} \int_{-R}^{R} x\,dx = 0$. Mas $\int_0^R x\,dx = R^2/2 \to \infty$, então $\int_{-\infty}^{\infty} x\,dx$ diverge. Cortando a reta em $-R$ e $2R$, em vez disso, obtém-se $\int_{-R}^{2R} x\,dx = 3R^2/2$, outra "resposta". Quando as duas metades não convergem cada uma, o valor depende de como os cortes são feitos, e por isso nenhum valor é atribuído.

### Exemplo 3: comparação nos dois sentidos

**Convergência.** Para $x \ge 1$ vale $x^2 \ge x$, logo $0 < e^{-x^2} \le e^{-x}$. Como $\int_1^\infty e^{-x}\,dx = e^{-1} \approx 0{,}3679$ converge, $\int_1^\infty e^{-x^2}\,dx$ converge e é no máximo $0{,}3679$. A integração numérica dá $0{,}1394$, consistente com a cota. Junto com o trecho em $[0, 1]$, que é uma integral comum, e a simetria, isso dá a convergência na reta toda.

**Divergência.** Para $x \ge 1$, $(2 + \sin x)/x \ge 1/x > 0$. Como $\int_1^\infty x^{-1}\,dx$ diverge, $\int_1^\infty (2+\sin x)/x\,dx$ também diverge. As integrais parciais confirmam:

```text
b          int_1^b (2+sin x)/x     cota inferior ln b
100        9.83                    4.61
10000      19.05                   9.21
1000000    28.26                   13.82
```

A oscilação de $\sin x$ não salva a convergência: a cota $2 + \sin x \ge 1$ mantém o integrando acima de uma integral divergente.

### Exemplo 4: densidades, caudas e médias que não existem

**Exponencial.** Para taxa $\lambda > 0$, $f(x) = \lambda e^{-\lambda x}$ em $x \ge 0$ tem $\int_0^b f = 1 - e^{-\lambda b} \to 1$, então a área total é $1$, e $P(X > t) = \int_t^\infty f = e^{-\lambda t}$. Com $\lambda = 2$ e $t = 1{,}5$ isso dá $e^{-3} \approx 0{,}0498$.

**Pareto.** Para $\alpha > 0$, $f(x) = \alpha x^{-\alpha-1}$ em $x \ge 1$ tem integral $1$ pelo teste-$p$ com $p = \alpha + 1$. A média é $\int_1^\infty x \cdot \alpha x^{-\alpha-1}\,dx = \alpha \int_1^\infty x^{-\alpha}\,dx$, que converge apenas para $\alpha > 1$, com valor $\alpha/(\alpha-1)$. Para $\alpha = 3$ a média é $1{,}5$ e para $\alpha = 1{,}5$ é $3$. Para $\alpha = 1$ a densidade é válida, mas $\int_1^b x \cdot x^{-2}\,dx = \ln b$ vale $4{,}61;\ 9{,}21;\ 13{,}82$ para $b = 10^2, 10^4, 10^6$ e nunca se estabiliza: a média não existe.

**Cauchy.** A densidade $1/(\pi(1+x^2))$ tem $\int_{-\infty}^{\infty} f = 1$, mas $\int_0^b x f\,dx = \ln(1+b^2)/(2\pi)$ vale $0{,}73;\ 2{,}20;\ 4{,}40$ em $b = 10, 10^3, 10^6$ e diverge. Por simetria, a metade esquerda diverge para $-\infty$, então a média não existe, embora o limite simétrico sugerisse $0$ (a armadilha do Exemplo 2).

**Altura ilimitada.** A densidade $1/(\pi\sqrt{x(1-x)})$ em $(0, 1)$ tem área total $1$ como integral do Tipo II nas duas pontas, e ainda assim $f(10^{-4}) \approx 31{,}8$ e $f$ é ilimitada. A observação de `continuous-random-variables-and-pdfs` de que a altura de uma densidade pode passar de $1$ não é, portanto, um efeito pequeno: não existe cota superior alguma.

## Equívocos Comuns e Armadilhas

- **"Se $f(x) \to 0$, então $\int_a^\infty f$ converge."** A função $1/x$ tende a $0$ e sua integral diverge. A velocidade importa, e por isso o teste-$p$ tem o limiar em $p = 1$.
- **"Se $\int_a^\infty f$ converge, então $f(x) \to 0$."** Vale quando $f$ é não negativa e não crescente, mas é falso em geral, mesmo para $f$ contínua e não negativa. Coloque um pico triangular de altura $n$ e base $2/n^3$ em torno de cada inteiro $n \ge 2$. Sua área é $\tfrac12 \cdot \tfrac{2}{n^3} \cdot n = 1/n^2$, e a área total é a série $\sum_{n\ge 2} 1/n^2 = \pi^2/6 - 1 \approx 0{,}645$ (séries são o tema de `infinite-series-and-partial-sums`). A integral converge enquanto $f$ continua voltando à altura $n$.
- **"Use a primitiva mesmo assim, o resultado é um número."** Atravessando uma descontinuidade no interior do intervalo, o Teorema Fundamental não se aplica, e a resposta formal pode até sair com o sinal errado (Exemplo 2).
- **"Intervalo simétrico e função ímpar dão sempre $0$."** Só quando cada metade converge. Caso contrário, $\infty - \infty$ não é um número.
- **"A comparação funciona com qualquer desigualdade."** Ela exige $0 \le f \le g$ em toda a cauda, continuidade e o sentido certo: uma cota superior convergente força convergência, uma cota inferior divergente força divergência, e as outras duas combinações não provam nada.
- **"Uma densidade com integral $1$ tem média."** O Exemplo 4 traz a densidade de Pareto com $\alpha = 1$ e a de Cauchy, em que a integral da média diverge.

## Resumo

Uma integral imprópria troca uma extremidade no infinito, ou um ponto em que o integrando explode, por um limite de integrais comuns, e só converge quando esse limite é finito. Em um intervalo duplamente infinito ou com singularidade interior, cada pedaço precisa convergir separadamente. O teste-$p$ é a referência: $\int_1^\infty x^{-p}\,dx$ converge exatamente quando $p > 1$ (valor $1/(p-1)$), e $\int_0^1 x^{-p}\,dx$ converge exatamente quando $p < 1$ (valor $1/(1-p)$). O teorema da comparação decide a convergência de integrandos contínuos e não negativos prendendo-os contra uma $p$-integral. Essas ferramentas transformam "a área total sob uma densidade é 1" em uma afirmação verificável sobre um limite, e mostram que momentos como a média podem não existir mesmo para uma densidade válida. A próxima lição, `sequences-and-convergence`, aplica a mesma ideia de limite a listas de números em vez de áreas.

## Documentation Links

- [OpenStax Calculus Volume 2: 3.7 Improper Integrals](https://openstax.org/books/calculus-volume-2/pages/3-7-improper-integrals): intervalos infinitos, descontinuidades infinitas e o teorema da comparação com problemas resolvidos.
- [Active Calculus: 6.5 Improper integrals](https://activecalculus.org/single/sec-6-5-improper.html): integrais impróprias por meio de atividades guiadas, incluindo convergência e divergência de exemplos típicos.
- [MIT OCW 18.01SC: Unit 5, Exploring the Infinite](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/): as sessões sobre integrais impróprias, comparação de integrais e singularidades, com notas e vídeos.
