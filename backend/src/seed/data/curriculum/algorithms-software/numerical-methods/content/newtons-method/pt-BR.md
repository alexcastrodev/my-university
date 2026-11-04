---
version: 1.0
updatedAt: 2026-11-04
title: "Método de Newton"
summary: "O método de Newton deduzido da reta tangente, a convergência quadrática perto de uma raiz simples e como ele falha: chutes iniciais ruins, derivadas que se anulam e raízes múltiplas."
---
## Objetivos de Aprendizagem

- Deduzir a iteração de Newton a partir do polinômio de Taylor de grau 1 e escrevê-la como iteração de ponto fixo.
- Enunciar o teorema de convergência local com todas as hipóteses e provar a relação de erro $e_{k+1} = \frac{f''(\xi_k)}{2f'(x_k)}e_k^2$.
- Medir a ordem de convergência a partir dos erros de uma execução real em float64 e localizar a iteração em que o arredondamento encerra a medição.
- Quebrar cada hipótese por vez (suavidade, raiz simples, bom chute inicial, derivada não nula ao longo do caminho) e prever o que a execução faz.
- Explicar por que os buscadores de raízes das bibliotecas protegem a ideia de Newton com um intervalo que contém a raiz.

## Contexto e Motivação

`sequences-and-convergence` rodou a iteração de Newton para $\sqrt 2$ e mostrou os erros $2{,}45\times10^{-3}$, $2{,}12\times10^{-6}$, $1{,}59\times10^{-12}$: o expoente quase dobra a cada passo. Aquela lição provou que a sequência converge e observou os dígitos dobrando. Esta explica por que eles dobram e diz quando isso vale.

Os dois buscadores de raízes anteriores definem a comparação. `bisection-and-convergence-rate` corta um intervalo ao meio a cada passo para qualquer $f$ contínua com troca de sinal. `fixed-point-iteration` reduz o erro por um fator perto de $\lvert g'(r)\rvert$. O método de Newton escolhe uma $g$ para a qual esse fator é zero na raiz. O preço é uma derivada a cada passo e a perda da garantia da bisseção: Newton pode divergir, ciclar para sempre ou cair numa raiz longe da desejada.

## Teoria Central

### A iteração a partir da reta tangente

Perto de um chute atual $x_k$, troque $f$ pelo seu polinômio de Taylor de grau 1 (veja `taylor-and-maclaurin-series-with-error-bounds`), que é a reta tangente, e ache o zero dessa reta:

$$x_{k+1} = x_k - \frac{f(x_k)}{f'(x_k)}, \qquad f'(x_k)\neq 0.$$

Cada iteração custa uma avaliação de $f$ e uma de $f'$. A lição de Taylor chama o polinômio de grau 2 de modelo local por trás do método de Newton para minimização. Trata-se desta mesma iteração aplicada à equação $f'(x)=0$, porque a reta tangente de $f'$ é a derivada do modelo quadrático de $f$.

### Newton como iteração de ponto fixo

A iteração é $x_{k+1}=g(x_k)$ com $g(x)=x-f(x)/f'(x)$. Onde $f'\neq0$, os pontos fixos de $g$ são exatamente as raízes de $f$. Derivando,

$$g'(x) = \frac{f(x)\,f''(x)}{f'(x)^2},$$

então $g'(r)=0$ em qualquer raiz com $f'(r)\neq0$. Um fator de contração zero é o motivo de a convergência superar toda taxa linear.

### O teorema de convergência local

Escreva $e_k = x_k - r$.

**Hipóteses.** $r$ é raiz de $f$. Em $I=[r-\delta,r+\delta]$, $f$ é duas vezes continuamente derivável e $f'$ não tem zero. Com $C = \max_I\lvert f''\rvert \big/ \big(2\min_I\lvert f'\rvert\big)$, vale também $C\delta<1$.

**Conclusão.** Para todo $x_0\in I$ os iterados ficam em $I$, $x_k\to r$ e $\lvert e_{k+1}\rvert\le C e_k^2$. Se nenhum $e_k$ é zero, então

$$\lim_{k\to\infty}\frac{e_{k+1}}{e_k^2}=\frac{f''(r)}{2f'(r)}.$$

**Prova.** O teorema de Taylor com resto de Lagrange, expandido em $x_k$ e avaliado em $r$, dá um $\xi_k$ entre os dois com

$$0=f(r)=f(x_k)-f'(x_k)\,e_k+\tfrac12 f''(\xi_k)\,e_k^2.$$

Dividindo por $f'(x_k)$ e usando $e_{k+1}=e_k-f(x_k)/f'(x_k)$, vem

$$e_{k+1}=\frac{f''(\xi_k)}{2f'(x_k)}\,e_k^2.$$

Logo $\lvert e_{k+1}\rvert\le Ce_k^2\le(C\delta)\lvert e_k\rvert$, o que mantém os iterados em $I$ e leva o erro a zero. Então $x_k$ e $\xi_k$ tendem a $r$, e a continuidade de $f'$ e $f''$ dá o limite.

O teorema é suficiente e local. Ele nada diz sobre pontos de partida fora de $I$, e "quadrática" quer dizer pelo menos quadrática: se $f''(r)=0$ o limite é $0$ e a ordem pode ser maior. Para $\sin x$ em $r=0$ o passo é $x-\tan x\approx -x^3/3$, e a partir de $x_0=0{,}5$ os erros são $4{,}6\times10^{-2}$, $3{,}3\times10^{-5}$, $1{,}2\times10^{-14}$, com $\lvert e_{k+1}\rvert/\lvert e_k\rvert^3$ indo $0{,}370$, $0{,}334$, $0{,}333$.

### Raízes múltiplas

Se $f(x)=(x-r)^m h(x)$ com $m\ge2$, $h$ suave e $h(r)\neq0$, então $f'(r)=0$ e o teorema não se aplica. Calculando o limite de $g'$ obtém-se $g'(r)=1-\tfrac1m$, então Newton ainda é uma contração perto de $r$, mas só linear, com razão $\tfrac12$ numa raiz dupla. Quando $m$ é conhecido, o passo $x_{k+1}=x_k-m\,f(x_k)/f'(x_k)$ torna essa derivada zero de novo.

### Critérios de parada

Perto de uma raiz simples $f(x_k)\approx f'(r)\,e_k$, então o tamanho do passo estima o erro de $x_k$, não o de $x_{k+1}$, que é bem menor. O resíduo $\lvert f(x_k)\rvert$ é um erro reverso: $x_k$ resolve exatamente $f(x)-f(x_k)=0$. Convertê-lo em erro direto exige dividir por $\lvert f'(r)\rvert$, o que falha em funções planas. Para $(x-1)^3$ em $x=1{,}001$ o resíduo é $10^{-9}$ e o erro é $10^{-3}$. Veja `conditioning-and-numerical-stability` para essa distinção. Um laço robusto testa o passo e o resíduo e ainda limita o número de iterações, porque nenhum dos dois testes dispara num ciclo.

## Exemplos Resolvidos

### Exemplo 1: a equação de Kepler, com a ordem medida

A propagação de órbitas resolve $E-e\sin E=M$ para a anomalia excêntrica $E$. Tome $e=0{,}3$, $M=1$, de modo que $f(E)=E-0{,}3\sin E-1$ e $f'(E)=1-0{,}3\cos E$, e comece em $x_0=M$. Uma execução em float64, com erros medidos contra a raiz calculada com 80 dígitos, $r=1{,}28809131321183768\ldots$:

```text
k  x_k                  e_k         e_k/e_{k-1}^2   p_k
0  1.0                 -2.881e-01
1  1.3012752012180726   1.318e-02   0.1588
2  1.288118592417824    2.728e-05   0.1569          2.004
3  1.2880913133288192   1.170e-10   0.1572          2.000
4  1.2880913132118377  -1.177e-17
```

Aqui $p_k=\ln\lvert e_k/e_{k-1}\rvert\big/\ln\lvert e_{k-1}/e_{k-2}\rvert$ é a ordem observada. Ela concorda com o $2$ do teorema, e a razão concorda com $f''(r)/(2f'(r))=0{,}1572$. Em $k=4$ a teoria prevê $0{,}1572\,(1{,}17\times10^{-10})^2\approx2\times10^{-21}$, mas os floats perto de $1{,}29$ distam $2{,}2\times10^{-16}$ entre si. O erro de truncamento caiu abaixo do erro de arredondamento, $x_4$ é o float mais próximo de $r$, o $f(x_4)$ calculado é exatamente $0$, e a razão e $p_k$ deixam de significar algo. Quatro iterações, oito avaliações.

O teorema se aplica com folga. Em toda parte $f'\ge0{,}7$ e $\lvert f''\rvert\le0{,}3$, então $C\le3/14$ e qualquer $\delta<14/3$ serve. Uma varredura de 20.001 pontos de partida a até $4{,}66$ de $r$ convergiu em no máximo 7 iterações cada. `scipy.optimize.newton(f, 1.0, fprime=df, tol=1e-12)` devolve o mesmo float em 4 iterações.

### Exemplo 2: dividir usando só multiplicação

Para $f(x)=1/x-a$ a iteração se simplifica em $x_{k+1}=x_k(2-ax_k)$, sem nenhuma divisão. Ela ainda tem uma lei exata de erro: $1-ax_{k+1}=(1-ax_k)^2$. Logo converge se e somente se $\lvert1-ax_0\rvert<1$, isto é, $0<x_0<2/a$. Respostas globais assim são raras. Com $a=7$ e $2/a=0{,}2857\ldots$:

```text
x0 = 0.10   0.13   0.1417   0.142848   0.1428571422   (razao |e_k|/e_{k-1}^2 = 7.0000)
x0 = 0.28   0.0112   0.0215   0.0398   0.0685   0.1042   0.1324   0.1421
x0 = 0.29  -0.0087  -0.0179  -0.0381  -0.0864  -0.2250  -0.8044  -6.1387
```

A primeira linha mostra a constante prevista $\lvert f''(r)/(2f'(r))\rvert=a$. A segunda começa dentro da região, então converge, mas os primeiros passos não têm nada de quadráticos. A terceira começa $0{,}01$ adiante e dispara para $-\infty$.

### Exemplo 3: perder suavidade reduz a ordem

Tome $f(x)=x+x\sqrt{\lvert x\rvert}$. A raiz $0$ é simples e $f'$ é contínua com $f'(0)=1$, mas $f''$ é ilimitada perto de $0$, então $f\notin C^2$. Para $x>0$ o iterado seguinte se simplifica em $\tfrac12x^{3/2}/(1+\tfrac32\sqrt x)$, o que prevê ordem $\tfrac32$ com constante $\tfrac12$. A partir de $x_0=0{,}5$:

```text
k  e_k         e_k/e_{k-1}^(3/2)   p_k
2  8.728e-03   0.3474              1.296
4  3.288e-06   0.4862              1.468
6  8.105e-14   0.5000              1.500
8  6.196e-31   0.5000              1.500
```

Tire mais suavidade e a convergência também vai embora. Com $f(x)=\operatorname{sign}(x)\sqrt{\lvert x\rvert}$, cuja derivada é ilimitada na raiz, todo passo é exatamente $x\mapsto-x$, e $x_0=0{,}3$ alterna entre $0{,}3$ e $-0{,}3$ para sempre.

### Exemplo 4: uma raiz dupla, e onde o arredondamento a interrompe

$f(x)=x^3-3x+2=(x-1)^2(x+2)$ tem raiz dupla em $1$. A partir de $x_0=2$ a razão $\lvert e_k/e_{k-1}\rvert$ dá $0{,}556$, $0{,}536$, $0{,}522$, e já se assentou em $0{,}5000$ em $k=13$, o valor previsto $1-\tfrac12$. A ordem observada é $1{,}000$. Pior: mais iterações não resolvem. Com `f = x**3 - 3*x + 2` e `df = 3*x**2 - 3`, o erro chega a cerca de $2\times10^{-8}$ em $k=26$, fica errático e congela em $3{,}6\times10^{-9}$ em $k=30$. Esse valor exato pouco significa: grafias como `x*x*x` ou `3*x*x` mudam cada avaliação em cerca de 1 ulp, e em oito grafias de $f$ e $f'$ o congelamento variou de $1{,}5\times10^{-9}$ a $9{,}7\times10^{-9}$. Perto da raiz $f(x)\approx3e^2$, e quando $3e^2$ encosta no ruído de arredondamento de $10^{-16}$ da avaliação da cúbica, $f$ devolve ruído. Isso acontece em $e\approx10^{-8}$, mais ou menos a raiz quadrada da precisão da máquina, e vem do condicionamento do problema, não de Newton. A forma de escrever $f$ importa bem mais: `(x-1)**2*(x+2)` não tem esse cancelamento. Com `df = 2*(x-1)*(x+2) + (x-1)**2` ela chega exatamente a $1$ em $k=54$, e outras grafias de $f'$ param a 1 ulp de $1$ um ou dois passos antes.

Com $m=2$ conhecido, o passo modificado na forma fatorada dá erros $1{,}1\times10^{-1}$, $1{,}9\times10^{-3}$, $6{,}3\times10^{-7}$, $6{,}7\times10^{-14}$ e depois $0$, com $e_k/e_{k-1}^2$ chegando a $0{,}166$. Na forma expandida o mesmo passo, com o código acima, chega a $1{,}6\times10^{-10}$ e depois salta de volta para $4{,}8\times10^{-7}$, enquanto `x*x*x` para em $3{,}8\times10^{-11}$: agora o ruído está no numerador de um passo grande, e os últimos dígitos dependem da grafia.

### Exemplo 5: pontos de partida e regiões planas

Nos quatro primeiros casos existe uma raiz simples e a culpa é só do ponto de partida.

- **Kepler com excentricidade alta.** Com $e=0{,}99$, $M=0{,}2$, a raiz é $r=1{,}0669973652816$. A partir de $x_0=M=0{,}2$, $f'(x_0)=0{,}030$ e o primeiro passo cai em $6{,}8$. A execução visita então $-34{,}9$, $13{,}3$ e $1126{,}7$ antes de convergir, depois de 19 iterações. A partir de $x_0=\pi$ ela desce monotonicamente em 7 iterações. Aqui o teorema cobre só cerca de $\delta\le0{,}42$, então os dois pontos ficam fora dele. O ponto $\pi$ funciona por outro motivo: entre $r$ e $\pi$, $f'>0$ e $f''\ge0$, então as retas tangentes ficam abaixo do gráfico e os iterados não ultrapassam $r$.
- **Um ciclo que atrai.** $x^3-2x+2$ a partir de $x_0=0$ dá $0,1,0,1,\ldots$ exatamente. Não é um único ponto azarado: $x_0=0{,}1$ cai no mesmo ciclo, e de 4001 pontos igualmente espaçados em $[-0{,}5;\,1{,}5]$, 1437 terminam nele. Os outros chegam à raiz real $-1{,}76929$.
- **Divergência.** Para $\arctan x$, pontos de módulo abaixo de $1{,}39175$ convergem e os maiores divergem: $x_0=1{,}3$ chega a $0$, enquanto $x_0=1{,}5$ dá $-1{,}69$, $2{,}32$, $-5{,}11$, $32{,}3$, $-1575$.
- **Uma derivada que se anula.** $\cos x$ em $x_0=0$ divide por zero. Em $x_0=0{,}001$ a tangente é quase horizontal, o primeiro passo cai em $1000{,}0007$ e a execução converge para $637\pi/2\approx1000{,}597$, não para a raiz mais próxima $\pi/2$.
- **Sem raiz real.** $x^2+1$ a partir de $x_0=0{,}5$ nunca se estabiliza; os iterados vagueiam e chegam a $\lvert x\rvert=63{,}7$ em 60 iterações.

### Exemplo 6: o que as bibliotecas fazem

No problema com $e=0{,}99$, `scipy.optimize.newton` com `fprime` e `tol=1e-12` reproduz as execuções acima: 19 iterações a partir de $0{,}2$ e 7 a partir de $\pi$. `scipy.optimize.brentq` no intervalo $[0,\pi]$ com `xtol=1e-12` dispensa derivada e bom chute, usa 12 avaliações de $f$ e devolve um valor a menos de $1{,}3\times10^{-13}$ de $r$. Um intervalo com troca de sinal não se perde, e por isso um projeto comum dá um passo de Newton quando ele fica dentro do intervalo e um passo de bisseção quando não fica. Em $n$ dimensões a divisão vira um sistema linear com a jacobiana a cada passo, um dos motivos de `lu-decomposition-and-partial-pivoting` importar aqui.

## Equívocos Comuns e Armadilhas

- **"O método de Newton sempre converge quadraticamente."** A garantia é local: raiz simples, função $C^2$, ponto de partida próximo. Os Exemplos 3, 4 e 5 quebram essas hipóteses uma por vez.
- **"Quadrático desde o primeiro passo."** A ordem é um limite. No Exemplo 2 com $x_0=0{,}28$ os primeiros passos são lentos, e no Exemplo 5 os primeiros passos se afastam da raiz.
- **"Os dígitos dobram até a resposta ficar exata."** Dobram até o erro de truncamento encontrar o de arredondamento, o que levou quatro passos no Exemplo 1.
- **"Uma raiz dupla lenta só precisa de mais iterações."** O Exemplo 4 para de melhorar perto de $10^{-8}$ na forma expandida, não importa quanto rode.
- **"O $\delta$ do teorema é onde Newton funciona."** É onde a prova funciona. O ponto $\pi$ do Exemplo 5 está fora dele e converge mesmo assim.
- **"Um $\lvert f(x)\rvert$ pequeno significa que $x$ está perto da raiz."** Em $(x-1)^3$, um resíduo de $10^{-9}$ vem com um erro de $10^{-3}$.
- **"Usa menos iterações, logo é mais barato."** Cada iteração avalia $f$ e $f'$. `secant-method-and-order-of-convergence` faz a comparação por avaliação.

## Resumo

O método de Newton resolve a reta tangente a cada passo: $x_{k+1}=x_k-f(x_k)/f'(x_k)$. Como iteração de ponto fixo, tem $g'(r)=0$ numa raiz simples. O teorema de Taylor transforma isso em $e_{k+1}=\frac{f''(\xi_k)}{2f'(x_k)}e_k^2$, então para $f\in C^2$ com $f'\neq0$ perto de $r$ e um ponto de partida próximo o bastante, o erro é elevado ao quadrado a cada passo, com constante limite $f''(r)/(2f'(r))$. Uma execução real mostra isso como uma razão que se assenta e $p_k\approx2$, até o arredondamento assumir. Cada hipótese importa: sem $C^2$ a ordem caiu para $\tfrac32$ ou a execução ciclou, com $f'(r)=0$ a convergência ficou linear e empacou perto de $10^{-8}$, e com um ponto de partida ruim a execução divergiu, ciclou ou achou uma raiz distante. Quando há um intervalo com troca de sinal, `brentq` troca velocidade por garantia.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.3 Newton's method](https://fncbook.com/newton): a iteração, a expansão do erro numa raiz simples e a definição de convergência quadrática.
- [Fundamentals of Numerical Computation, 4.2 Fixed-point iteration](https://fncbook.com/fixed-point): o argumento de contração em que a visão de ponto fixo de Newton se apoia.
- [MIT OpenCourseWare 18.330, Chapter 4: Nonlinear equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): bisseção, Newton, o método da secante e Newton em várias dimensões.
- [MIT OpenCourseWare 18.335J, Lecture 1: Square roots via Newton's method](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/resources/mit18_335js19_lec1/): a iteração de Newton para raízes quadradas, com uma análise do erro e uma execução numérica.
- [SciPy, scipy.optimize.newton](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.newton.html): a rotina da biblioteca, com `fprime` para Newton e sem ele para o método da secante.
- [SciPy, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): o buscador de raízes com intervalo usado na comparação.
