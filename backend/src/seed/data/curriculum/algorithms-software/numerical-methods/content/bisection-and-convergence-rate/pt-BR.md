---
version: 1.0
updatedAt: 2026-11-04
title: "Bisseção e Taxa de Convergência"
summary: "A bisseção como método numérico: a garantia de confinamento dada pelo Teorema do Valor Intermediário, a convergência linear, a contagem exata de iterações para uma tolerância e os critérios de parada."
---
## Objetivos de Aprendizagem

- Enunciar a garantia de confinamento da bisseção com suas hipóteses, e dizer o que ela não promete.
- Calcular a contagem exata de iterações para uma tolerância, distinguir iterações de avaliações de função e conferir a contagem com `scipy.optimize.bisect`.
- Medir a convergência da bisseção e explicar por que a largura do intervalo cai exatamente à metade enquanto o erro não cai.
- Escolher entre os testes de parada por largura, largura relativa, resíduo e limite de iterações, e dizer o que cada um certifica.
- Prever a precisão atingível a partir do condicionamento, e reconhecer onde o arredondamento encerra a convergência.

## Contexto e Motivação

`guess-and-check-and-bisection-search` constrói o laço, e `continuity-and-the-intermediate-value-theorem` explica por que há uma raiz dentro do intervalo, mostra uma troca de sinal num polo e acompanha como os doubles se esgotam. Nenhuma delas responde às perguntas que um engenheiro faz a um método numérico. Quantas iterações custa uma tolerância, exatamente? O que o teste de parada certifica de verdade? Qual a precisão possível, dado o condicionamento de `conditioning-and-numerical-stability`?

O exemplo condutor é a **taxa interna de retorno** (TIR), a função das planilhas que leva esse nome. Fluxos de caixa $c_0, \ldots, c_N$ nos anos $0, \ldots, N$ têm valor presente líquido $\operatorname{VPL}(r) = \sum_t c_t (1+r)^{-t}$, e a TIR é uma raiz dele. Em geral não há forma fechada. A bisseção é lenta, mas pede apenas uma troca de sinal, e é por isso que solvers como o de Brent a mantêm como rede de segurança.

## Teoria Central

### O método e sua garantia

**Hipóteses.** $f$ é contínua em $[a, b]$, e $f(a)$ e $f(b)$ são não nulos e têm sinais opostos.

**Método.** Faça $[a_0, b_0] = [a, b]$. Para $n \ge 1$, seja $m_n$ o ponto médio de $[a_{n-1}, b_{n-1}]$. Se $f(m_n) = 0$, pare. Caso contrário, $[a_n, b_n]$ é a metade cujos extremos têm sinais opostos.

**Conclusão.** O Teorema do Valor Intermediário coloca uma raiz em cada intervalo. Os intervalos encaixados encolhem até um único ponto $r$, e a continuidade força $f(r) = 0$. Para todo $n$,

$$b_n - a_n = \frac{b-a}{2^n}, \qquad \lvert m_n - r\rvert \le \frac{b-a}{2^n}.$$

Cada iteração custa uma avaliação de $f$ e não precisa de derivada. A garantia não diz que a raiz é única, nem qual raiz será encontrada.

### Contando iterações

A largura do intervalo atinge uma tolerância $\tau$ no menor $n$ com $(b-a)2^{-n} \le \tau$:

$$n = \left\lceil \log_2\frac{b-a}{\tau} \right\rceil.$$

Essa contagem é incomum entre métodos numéricos: não depende de $f$, a não ser que um acerto exato $f(m_n) = 0$ encerre a execução mais cedo. As avaliações de função somam $n + 2$, porque os dois extremos são testados antes. Cada dígito decimal custa $\log_2 10 \approx 3{,}32$ iterações.

### Convergência linear, dita com cuidado

Uma sequência com erros $e_n$ converge **linearmente** com taxa $0 < \rho < 1$ quando $e_{n+1}/e_n$ tende a $\rho$. A cota $E_n = (b-a)2^{-n}$ satisfaz $E_{n+1} = E_n/2$ exatamente. O erro verdadeiro $e_n = \lvert m_n - r\rvert$ em geral não satisfaz, porque um ponto médio pode cair perto de $r$ por sorte e o seguinte, mais longe. Assim, a taxa $\tfrac12$ descreve a cota que domina o erro, um dígito binário por iteração em média, e não uma razão observada a cada passo. `secant-method-and-order-of-convergence` formaliza a ordem de convergência.

### Critérios de parada

| Teste | Certifica | Fraqueza |
|---|---|---|
| Largura: $b - a \le \tau$ | $r$ a menos de $\tau$, se os sinais estão certos | Diz pouco se $r$ é bem menor que $\tau$; pode nunca terminar se $\tau$ está abaixo do espaçamento dos floats em $r$ |
| Largura relativa: $b - a \le \tau\lvert m\rvert$ | Dígitos de $r$ | Não pode ser satisfeito quando $r = 0$ |
| Resíduo: $\lvert f(m)\rvert \le \tau$ | $m$ é raiz exata de $f - f(m)$ | Depende das unidades de $f$ |
| Limite de iterações | O laço termina | Nada sobre a precisão |

Código real combina esses testes. `scipy.optimize.bisect` recebe `xtol`, `rtol` e `maxiter`, com padrões $2\times10^{-12}$, $4\epsilon$ e $100$, e documenta que o resultado satisfaz `np.isclose(x, x0, atol=xtol, rtol=rtol)`. Seu `xtol` padrão é um teste absoluto: em $f(x) = x - 10^{-12}$ sobre $[0, 1]$ ele informa sucesso em $1{,}8\times10^{-12}$, um erro relativo de 82 por cento, enquanto `xtol=1e-20` dá $1{,}0000000028\times10^{-12}$ em 67 iterações.

### Resíduo, largura e condicionamento

A largura limita o erro direto. O resíduo é o erro reverso: $m$ resolve exatamente $f(x) - f(m) = 0$. Para uma raiz simples ($f'(r) \ne 0$ com $f'$ contínua por perto), a expansão de primeira ordem liga os dois, $\lvert m - r\rvert \approx \lvert f(m)\rvert/\lvert f'(r)\rvert$, então $1/\lvert f'(r)\rvert$ é o número de condição absoluto da raiz.

Isso também fixa o piso de precisão. Se os valores calculados de $f$ têm ruído de tamanho $\delta$, os sinais só merecem confiança onde $\lvert f\rvert > \delta$, então perto de uma raiz simples a zona de dúvida tem meia-largura em torno de $\delta/\lvert f'(r)\rvert$. Dentro dela, o intervalo continua caindo à metade em volta de uma troca de sinal calculada, e sua largura deixa de medir o erro.

## Exemplos Resolvidos

### Exemplo 1: uma TIR com tolerância $10^{-8}$

Tome os fluxos de caixa $-1000, 300, 420, 680$. O $\operatorname{VPL}$ é contínuo em $(-1, \infty)$, com $\operatorname{VPL}(0) = 400$ e $\operatorname{VPL}(1) = -660$. Substituir $v = 1/(1+r)$ dá uma cúbica com uma única troca de sinal nos coeficientes, então pela regra de Descartes há exatamente uma raiz com $r > -1$: $r = 0{,}16340560068899$. Para $\tau = 10^{-8}$, $n = \lceil\log_2 10^8\rceil = 27$. A execução, com a cota $2^{-n}$ ao lado do erro verdadeiro:

```text
n    m_n          f(m_n)      e_n        2^-n       e_n/e_(n-1)
1    0.5          -4.12e+02   3.37e-01   5.00e-01
2    0.25         -1.43e+02   8.66e-02   2.50e-01   0.26
3    0.125        +7.61e+01   3.84e-02   1.25e-01   0.44
4    0.1875       -4.35e+01   2.41e-02   6.25e-02   0.63
5    0.15625      +1.35e+01   7.16e-03   3.13e-02   0.30
6    0.171875     -1.56e+01   8.47e-03   1.56e-02   1.18
7    0.1640625    -1.23e+00   6.57e-04   7.81e-03   0.08
8    0.16015625   +6.10e+00   3.25e-03   3.91e-03   4.95
...
26   0.16340561   -2.13e-05   1.14e-08   1.49e-08   0.43
27   0.16340560   -7.42e-06   3.97e-09   7.45e-09   0.35
```

A cota vale em toda linha. O erro sobe em 7 das 26 transições, e mesmo assim a inclinação ajustada de $\log_2 e_n$ contra $n$ é $-0{,}993$ e a média geométrica das razões é $0{,}496$. O método gastou 29 avaliações. `scipy.optimize.bisect(npv, 0, 1, xtol=1e-8)` informa 27 iterações e 29 chamadas de função e devolve o mesmo $m_{27}$. Com o mesmo `xtol`, `scipy.optimize.brentq` usa 9 chamadas e cai a $1{,}0\times10^{-11}$ de $r$.

### Exemplo 2: o teste de resíduo depende das unidades

Expresse os mesmos fluxos de caixa em escalas diferentes e pare em $\lvert f(m)\rvert < 0{,}01$ ou em largura $10^{-8}$:

```text
escala dos fluxos     iterações, teste de resíduo   erro em r    iterações, teste de largura
0.001                 7                             6.57e-04     27
1                     16                            7.71e-07     27
1000                  24                            3.48e-09     27
1000000               36                            1.15e-12     27
```

A mesma taxa de retorno, o mesmo teste, e um erro que muda em oito ordens de grandeza. O teste de largura nem nota a escala. Na escala $1$, $\lvert f'(r)\rvert = 1868{,}6$, e o resíduo de parada $0{,}00144$ prevê um erro de $7{,}7\times10^{-7}$, como na tabela. Um teste de resíduo é o certo quando $f$ tem significado próprio, como em "as contas fecham a menos de $0{,}01$", e é o errado como substituto para dígitos de $r$.

### Exemplo 3: onde a convergência para

Rode a TIR até o fim dos floats, parando quando o ponto médio coincide com um extremo:

```text
formato   divisões   largura final   erro verdadeiro
float64   55         2.8e-17         5.4e-17
float32   26         1.5e-08         3.5e-09
```

A contagem é 55 e não 53, como acontece com a raiz perto de $0{,}74$ em `continuity-and-the-intermediate-value-theorem`, porque perto de $0{,}163$ o espaçamento do double é $2^{-55}$. Em geral a contagem fica em torno de $\log_2((b-a)/\text{espaçamento em } r)$. Em float64 o erro verdadeiro é o dobro da largura final, então $r$ está fora do último intervalo. É o piso de ruído em ação: nos 801 doubles consecutivos centrados em $r$ o VPL calculado erra até $3{,}0\times10^{-13}$, o que dividido por $1868{,}6$ dá uma zona de $1{,}6\times10^{-16}$, alguns espaçamentos de float, e dentro dela os sinais calculados podem estar errados. Esses resultados dependem de como o VPL é escrito. A tabela o avalia termo a termo, e em float64 a regra de Horner em $1/(1+r)$ acerta um `0.0` exato depois de 46 iterações, com erro $5{,}7\times10^{-17}$.

Agora tome uma raiz mal condicionada. $(x-1)^7$ tem $f'(1) = 0$, e sua forma expandida é avaliada pela regra de Horner:

```text
intervalo      pontos médios   largura final   resultado    erro verdadeiro
[0.8, 1.1]     7               4.7e-03         0.99453125   5.5e-03
[0.9, 1.4]     15              3.1e-05         0.99248352   7.5e-03
[0.7, 1.2]     21              4.8e-07         0.99500604   5.0e-03
[0.95, 1.02]   47              1.1e-15         1.00734781   7.3e-03
```

Toda execução para porque Horner devolve exatamente `0.0`, uma coincidência de arredondamento e não uma raiz. Esse último ponto médio encerra a execução antes de o intervalo cair à metade, então $n$ pontos médios deixam uma largura de cerca de $(b-a)/2^{n-1}$. A última linha informa uma largura perto de $10^{-15}$ com um erro mais de $10^{12}$ vezes maior. Numa grade de 600.001 pontos em $[0{,}97, 1{,}03]$ o sinal calculado troca 73.860 vezes, entre $0{,}99098$ e $1{,}00909$. Nos 100.000 pontos da grade com $\lvert x-1\rvert < 0{,}005$ o maior $\lvert f\rvert$ calculado é $6{,}7\times10^{-15}$, tudo ruído, já que o valor verdadeiro ali fica abaixo de $7{,}9\times10^{-17}$. E $\lvert x-1\rvert^7$ atinge esse valor em $\lvert x-1\rvert = 0{,}0094$, que é a zona prevista. `scipy.optimize.bisect` e `brentq` no último intervalo devolvem $1{,}00731$ e $0{,}99775$, então um solver melhor não ajuda. A bisseção na forma fatorada `(x - 1)**7` devolve exatamente $1{,}0$ nos quatro intervalos: o problema estava na representação de $f$.

### Exemplo 4: hipóteses que faltam

*Duas raízes, nenhuma troca de sinal.* Os fluxos $-1000, 2300, -1320$ têm TIRs de 10 e 20 por cento, mas $\operatorname{VPL}(0) = -20$ e $\operatorname{VPL}(1) = -180$. `scipy.optimize.bisect` levanta `ValueError` em $[0, 1]$. Em $[0, 0{,}15]$ e $[0{,}15, 1]$ ele encontra cada raiz. Uma troca de sinal é suficiente para haver raiz, não necessária, e um número par de raízes se esconde dela.

*Um polo.* `scipy.optimize.bisect(math.tan, 1, 2)` informa convergência depois de 39 iterações em $1{,}5707963267941$, onde $\tan$ vale $1{,}3\times10^{12}$. A continuidade falha, como para $1/x$ em `continuity-and-the-intermediate-value-theorem`, e o teste de largura não consegue ver isso. Uma conferência de $\lvert f\rvert$ no final consegue.

## Equívocos Comuns e Armadilhas

- **"Convergência linear quer dizer que o erro cai à metade a cada passo."** A cota cai. No Exemplo 1 o erro chegou a crescer por um fator de $8{,}9$, entre $n = 16$ e $n = 17$.
- **"Testar `f(a) * f(m) < 0` é o mesmo que comparar sinais."** Com $f(x) = 10^{-200}(x - 0{,}3)$ o produto sofre underflow para `-0.0`, o teste é sempre falso e o laço converge para $1{,}0$. Comparar os sinais diretamente dá $0{,}3$.
- **"`(a + b) / 2` é sempre seguro."** Ele estoura quando $a$ e $b$ são enormes e têm o mesmo sinal: `1.6e308 + 1.7e308` dá `inf`. `a + (b - a) / 2` conserta esse caso e falha no oposto: com `a = -1.7e308` e `b = 1.7e308`, `b - a` estoura e o resultado é `inf`, enquanto `(a + b) / 2` dá `0.0`. Um intervalo que atravessa o zero é o caso normal para uma raiz perto de $0$, então nenhuma das duas escritas é segura para todo intervalo nessa escala. `a / 2 + b / 2` resolve os dois casos, ao custo de arredondamento quando os extremos são subnormais.
- **"Largura abaixo da tolerância quer dizer que a resposta é boa assim."** Só se os sinais calculados estiverem certos, e o Exemplo 3 mostra que isso pode falhar.
- **"Um teste relativo serve para qualquer raiz."** Só com um teste relativo, $f(x) = x$ em $[-1, 2]$ não tem saída até os floats acabarem, depois de 1076 iterações que descem pelos subnormais até `5e-324`. Uma raiz em $0$ precisa de um piso absoluto.
- **"A bisseção está obsoleta."** A documentação do SciPy considera `brentq` em geral a melhor de suas rotinas de busca de raízes, e o descreve como uma combinação de confinamento, bisseção e interpolação quadrática inversa. A bisseção sobrevive dentro dele, e a bisseção pura continua sendo um método cujo custo pode ser dito antes de rodar.

## Resumo

Para $f$ contínua com troca de sinal em $[a, b]$, a bisseção mantém uma raiz num intervalo de largura $(b-a)2^{-n}$, com uma avaliação por iteração, e precisa de $\lceil\log_2((b-a)/\tau)\rceil$ iterações para a largura $\tau$, seja qual for $f$. A taxa $\tfrac12$ é da cota: o erro verdadeiro pode subir de um passo para o outro e ainda assim render um bit por iteração em média. A largura controla o erro direto, o resíduo controla o erro reverso, e $1/\lvert f'(r)\rvert$ liga os dois perto de uma raiz simples. Testes absolutos falham para raízes minúsculas, testes relativos falham em zero, testes de resíduo dependem das unidades e um limite de iterações só encerra o laço. O arredondamento encerra a convergência perto do espaçamento dos floats numa raiz bem condicionada, e muito antes numa raiz mal condicionada, onde a largura do intervalo deixa de medir o erro.

## Documentation Links

- [SciPy documentation, scipy.optimize.bisect](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.bisect.html): parâmetros, tolerâncias padrão e o significado de `xtol` e `rtol`.
- [SciPy documentation, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): o método de Brent como solver com confinamento.
- [Fundamentals of Numerical Computation, 4.1 The rootfinding problem](https://fncbook.com/rootproblem): condicionamento de uma raiz, o resíduo como erro reverso e raízes múltiplas.
- [MIT OpenCourseWare 18.330, Lecture Notes: Nonlinear Equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): a bisseção, sua garantia e sua convergência linear ao lado de métodos mais rápidos.
- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): underflow, números desnormalizados e o arredondamento por trás das armadilhas acima.
