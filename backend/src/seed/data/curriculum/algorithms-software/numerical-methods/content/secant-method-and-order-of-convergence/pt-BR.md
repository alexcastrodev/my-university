---
version: 1.0
updatedAt: 2026-11-04
title: "Método da Secante e Ordem de Convergência"
summary: "O método da secante como Newton sem derivada, a definição formal de ordem de convergência e como se deduz a ordem do método da secante."
---
## Objetivos de Aprendizagem

- Deduzir o método da secante a partir do método de Newton e contar seu custo em avaliações de função.
- Enunciar a definição formal de ordem de convergência e distinguir uma ordem verdadeira de uma cota sobre um intervalo.
- Deduzir a relação de erro $\varepsilon_{k+1}\approx C\varepsilon_k\varepsilon_{k-1}$ e, a partir dela, a ordem $\phi=(1+\sqrt5)/2$.
- Medir essa ordem a partir dos erros de uma execução e explicar por que float64 sozinho dá só um valor grosseiro.
- Comparar Newton e o método da secante por avaliação, sob um modelo de custo declarado, e quebrar cada hipótese do teorema da ordem.

## Contexto e Motivação

`newtons-method` precisa de $f'$ a cada passo. Muitas vezes não existe fórmula para ela: $f$ pode ser uma simulação, uma chamada a um solver ou uma biblioteca fechada. O método da secante mantém a ideia de resolver uma reta e troca a tangente pela reta que passa pelos dois últimos pontos, então só precisa de valores de $f$.

O custo é uma ordem menor, e a surpresa é que a ordem menor ainda pode vencer. Ordem por iteração é a régua errada quando as iterações custam quantias diferentes. Esta lição torna "ordem" precisa, deduz o valor incomum $1{,}618\ldots$ e o mede.

## Teoria Central

### De Newton à secante

Troque $f'(x_k)$ na iteração de Newton pela inclinação entre os dois últimos iterados:

$$x_{k+1}=x_k-f(x_k)\,\frac{x_k-x_{k-1}}{f(x_k)-f(x_{k-1})}.$$

O método precisa de dois pontos iniciais distintos, que não precisam cercar a raiz. Como $f(x_{k-1})$ já está guardado, cada iteração custa uma avaliação nova, então $x_k$ custa $k$ avaliações no total para $k\ge2$. O passo fica indefinido quando $f(x_k)=f(x_{k-1})$, caso em que a reta secante é horizontal.

### Ordem de convergência, formalmente

Seja $x_k\to r$ com $e_k=\lvert x_k-r\rvert\neq0$. A sequência **tem ordem $p\ge1$ com constante $A$** se

$$\lim_{k\to\infty}\frac{e_{k+1}}{e_k^{\,p}}=A,\qquad 0<A<\infty,$$

exigindo-se também $A<1$ quando $p=1$. Ordem 1 é linear e ordem 2 é quadrática. Se $e_{k+1}/e_k\to0$ a convergência é superlinear, o que todo $p>1$ satisfaz. É uma afirmação assintótica sobre uma sequência, sob as hipóteses do teorema que a produziu.

Nem toda sequência convergente tem ordem. Uma noção mais fraca só pede $e_k\le b_k$ para alguma sequência $b_k$ que tenha ordem $p$. A bisseção é o caso padrão: a meia-largura do intervalo tem ordem 1 com constante $\tfrac12$, mas os erros dos pontos médios em geral não têm. Na equação do Exemplo 1, a partir de $[0,2]$, a razão $e_{k+1}/e_k$ variou de $0{,}005$ a $89{,}8$ em 15 passos e não se assentou em nada. Há casos especiais: para $3x-1$ em $[0,1]$ a razão é exatamente $\tfrac12$.

Se $e_{k+1}=Ae_k^{\,p}$ valesse exatamente, teríamos $e_k/e_{k-1}=(e_{k-1}/e_{k-2})^p$, o que dá a medida usada em toda a lição:

$$p_k=\frac{\ln(e_k/e_{k-1})}{\ln(e_{k-1}/e_{k-2})}.$$

### A relação de erro

Sejam $f[a,b]=\frac{f(b)-f(a)}{b-a}$ e $f[a,b,c]=\frac{f[b,c]-f[a,b]}{c-a}$, e escreva o erro com sinal $\varepsilon_k=x_k-r$. A reta secante por $x_{k-1}$ e $x_k$ é o interpolante de grau 1 de $f$, então para todo $x$

$$f(x)=f(x_k)+f[x_{k-1},x_k]\,(x-x_k)+f[x_{k-1},x_k,x]\,(x-x_{k-1})(x-x_k).$$

Faça $x=r$, use $f(r)=0$ e note que os dois primeiros termos são a reta, que se anula em $x_{k+1}$. Isso dá uma fórmula exata:

$$\varepsilon_{k+1}=\frac{f[x_{k-1},x_k,r]}{f[x_{k-1},x_k]}\;\varepsilon_k\,\varepsilon_{k-1}.$$

Para $f\in C^2$, $f[a,b]=f'(\eta)$ e $f[a,b,c]=\tfrac12f''(\zeta)$ para pontos entre os argumentos. Assim, perto de uma raiz simples, a fração tende a $C=f''(r)/(2f'(r))$, a mesma constante de Newton. O erro de Newton é proporcional a $\varepsilon_k^2$; aqui um dos dois fatores é o erro mais antigo, que é maior.

### A ordem é a razão áurea

**Hipóteses.** $f\in C^2$ perto de $r$, $f(r)=0$, $f'(r)\neq0$, $f''(r)\neq0$, e $x_0\neq x_1$ estão perto o bastante de $r$. **Conclusão.** $x_k\to r$ com ordem $\phi=(1+\sqrt5)/2\approx1{,}618$ e constante $\lvert C\rvert^{\phi-1}$.

O motivo aparece num logaritmo. Com $y_k=\ln(\lvert C\rvert e_k)$, a relação $e_{k+1}\approx\lvert C\rvert e_ke_{k-1}$ vira $y_{k+1}\approx y_k+y_{k-1}$, a recorrência de Fibonacci. Suas soluções são $y_k=\alpha\phi^k+\beta(-1/\phi)^k$. Convergir significa $y_k\to-\infty$, logo $\alpha<0$, o segundo termo some e $y_{k+1}/y_k\to\phi$. Para a constante, suponha $e_{k+1}=Ae_k^{\,p}$. Então $e_{k-1}=(e_k/A)^{1/p}$, e substituir dá $Ae_k^{\,p}=\lvert C\rvert A^{-1/p}e_k^{\,1+1/p}$. Igualar expoentes dá $p^2=p+1$, e igualar constantes dá $A=\lvert C\rvert^{1/p}=\lvert C\rvert^{p-1}$. Esse argumento trata $\approx$ como $=$; uma prova completa limita a fração acima.

## Exemplos Resolvidos

### Exemplo 1: a ordem medida

Resolva a equação de Kepler de `newtons-method`, $f(E)=E-0{,}3\sin E-1$, com $x_0=1$, $x_1=1{,}5$. Em float64, contra uma raiz de referência calculada com 2000 dígitos:

```text
k  x_k                 e_k        e_k/(e_{k-1}e_{k-2})   p_k
0  1.0                 2.881e-01
1  1.5                 2.119e-01
2  1.2785142391301476  9.577e-03  0.1569
3  1.2877773371566017  3.140e-04  0.1547                 1.104
4  1.2880917861898569  4.730e-07  0.1573                 1.901
5  1.2880913131884923  2.335e-11  0.1572                 1.526
6  1.2880913132118377  1.177e-17
```

A razão de dois termos já bate com $C=0{,}1572$. A coluna da ordem não se assenta: float64 só dá três valores limpos, $1{,}10$, $1{,}90$, $1{,}53$, e o termo $(-1/\phi)^k$ ainda pesa nessa fase. Em $k=6$ a relação prevê $1{,}7\times10^{-18}$, abaixo do erro de arredondamento, e $x_6$ é simplesmente o float mais próximo de $r$. Depois $f(x_6)=0$, $x_7=x_6$, e a fórmula de $x_8$ é $0/0$, então um teste de parada é obrigatório, não opcional. `scipy.optimize.newton(f, 1.0, x1=1.5, tol=1e-12)`, que roda o método da secante quando não recebe `fprime`, para depois de 6 iterações com um resultado a um float de distância, porque escreve a atualização de outro jeito.

O limite exige mais dígitos, então aqui vai a mesma iteração com 2000 dígitos:

```text
k   e_k         e_k/(e_{k-1}e_{k-2})   e_k/e_{k-1}^phi   p_k
6   1.736e-18   0.1572012              0.27676           1.6553
8   1.738e-48   0.1572012              0.30198           1.6234
10  4.757e-127  0.1572012              0.31221           1.6188
12  9.732e-333  0.1572012              0.31620           1.6181
14  3.047e-871  0.1572012              0.31774           1.6181
```

$p_k$ se aproxima de $\phi=1{,}61803$ e a terceira coluna caminha para $\lvert C\rvert^{\phi-1}=0{,}31870$, de acordo com o teorema.

### Exemplo 2: Newton contra a secante, por avaliação

Mesma equação, com Newton a partir de $x_0=1$. Contando $f$ e $f'$ como uma avaliação cada, e listando o erro do melhor iterado que essas avaliações conseguem produzir:

```text
avaliacoes   Newton     Secante (x1 = 1.5)
2            1.3e-02    9.6e-03
3                       3.1e-04
4            2.7e-05    4.7e-07
5                       2.3e-11
6            1.2e-10    1.2e-17
8            1.2e-17
```

A secante vence aqui apesar da ordem menor. O resultado depende de $x_1$: com $x_1=2$ ela atinge o piso de arredondamento em 7 avaliações, e com $x_1=1{,}0001$ em 6.

Assintoticamente, o número de dígitos corretos é multiplicado por $p$ a cada iteração, então por unidade de trabalho é multiplicado por $p^{1/w}$, em que $w$ é o trabalho de uma iteração. Se $f'$ custa $\theta$ vezes o que custa $f$, Newton obtém $2^{1/(1+\theta)}$ e a secante obtém $\phi$. Em $\theta=1$ isso dá $1{,}414$ contra $1{,}618$. Os dois empatam em $\theta=\ln2/\ln\phi-1=0{,}44$, então Newton só fica à frente quando $f'$ custa menos de cerca de 44% de $f$. Em Kepler, $f'$ só acrescenta um $\cos E$ ao $\sin E$ de $f$, e se os dois vêm de uma só chamada então $\theta$ fica perto de $0$ e Newton fica à frente, embora a tabela acima, que cobra preço cheio por $f'$, favoreça a secante. O modelo ignora a fase inicial e o arredondamento, e supõe os dois métodos no regime assintótico.

### Exemplo 3: cada hipótese removida

**$f'(r)\neq0$.** Para $f(x)=x^2$ a iteração é exatamente $1/x_{k+1}=1/x_k+1/x_{k-1}$, de novo Fibonacci, então a razão tende a $1/\phi=0{,}618$ e a ordem é 1. Em $x^3-3x+2$, com raiz dupla $1$ e pontos iniciais $2$ e $1{,}8$, a razão chega a $0{,}6180$ em $k=20$, depois o arredondamento a quebra e a execução congela em $2{,}7\times10^{-9}$ em $k=40$, perto do piso que Newton atingiu. Por avaliação isso ainda supera o $0{,}5$ de Newton a cada duas avaliações, que dá $0{,}707$ por avaliação.

**$f\in C^2$.** Para $f(x)=x+x\sqrt{\lvert x\rvert}$ e $a,b>0$, $f[a,b,0]=1/(\sqrt a+\sqrt b)$, então agora $e_{k+1}\approx e_ke_{k-1}^{1/2}$. O mesmo argumento dá $p=1+1/(2p)$, logo $p=(1+\sqrt3)/2=1{,}36603$. Medido a partir de $x_0=0{,}5$, $x_1=0{,}4$, em float64 (a raiz em $0$ deixa muita faixa de expoente):

```text
k   e_k         e_k/(e_{k-1}e_{k-2}^(1/2))   p_k
6   8.657e-06   0.7315                       1.349
9   8.960e-14   0.9508                       1.359
13  3.609e-46   1.0002                       1.366
```

**$f''(r)\neq0$.** Remover esta acelera o método. Para $\sin x$ em $r=0$, $f[a,b,0]\approx-(a+b)/6$, então $e_{k+1}\approx\tfrac16e_ke_{k-1}^2$, e $p=1+2/p$ dá $p=2$. Uma execução com 6000 dígitos a partir de $0{,}5$ e $0{,}4$ dá $p_k$ iguais a $1{,}961$, $2{,}020$, $1{,}990$, $2{,}005$, e a razão $e_{k+1}/(e_ke_{k-1}^2)$ se assenta em $0{,}166667$. Ainda assim, pela definição acima, essa sequência não tem ordem. Aqui $y_k=\ln e_k$ mais uma constante obedece a $y_{k+1}=y_k+2y_{k-1}$, com raízes $2$ e $-1$, e o termo $(-1)^k$ nunca some em relação à constante: $e_k/e_{k-1}^2$ alterna entre $0{,}781909$ e $0{,}213153$ de $k=5$ a $k=12$, sem deriva. Logo $p_k\to2$, mas nenhum limite $A$ existe, a mesma distinção feita para a bisseção. O valor $1{,}618$ é, portanto, uma afirmação sob suas hipóteses, não uma propriedade do método sozinho.

**Bons pontos iniciais.** Para $x^2-4$ com $x_0=-3$, $x_1=3$ os dois valores de $f$ são iguais e o primeiro passo divide por zero, embora haja raízes entre os pontos. Para $\arctan x$, os pontos $3$ e $4$ dão $-13{,}3$, $-4{,}1$, $70{,}6$, $30{,}4$, $-3270$ e divergem, enquanto $1{,}2$ e $2$ convergem. Com excentricidade alta ($e=0{,}99$, $M=0{,}2$), os pontos $0{,}2$ e $0{,}3$ ficam abaixo de $5$ e chegam à raiz em $k=13$, uma execução mais calma que a excursão de Newton até $1126{,}7$ em `newtons-method`. É um caso só: nenhum dos dois métodos está a salvo de um mau começo.

### Exemplo 4: uma caixa-preta, em que $f'$ não existe como código

Um projétil com arrasto quadrático obedece a $\dot{\mathbf v}=-g\hat{\mathbf y}-k\lVert\mathbf v\rVert\mathbf v$, com $g=9{,}81$ m/s², $k=0{,}005$ por metro e velocidade de lançamento $100$ m/s. Ache o ângulo $\theta$ abaixo do ângulo de alcance máximo que cai a $250$ m. O alcance não tem fórmula, então $f(\theta)=\text{alcance}(\theta)-250$ é uma chamada a `scipy.integrate.solve_ivp` com `method='DOP853'`, com cerca de 270 avaliações do lado direito. Com pontos iniciais $15^\circ$ e $20^\circ$, `rtol=1e-11` e `atol=1e-13`:

```text
avaliacoes  theta (graus)         f(theta) (m)
3           22.160585688          -2.93
4           22.957456986          -3.83e-01
5           23.077269499          -1.70e-02
6           23.082829199          -1.06e-04
7           23.082864214          -2.98e-08
8           23.082864223534        1.47e-10
```

Os iterados seguintes só oscilam: $\lvert f\rvert$ fica entre $7\times10^{-11}$ e $5\times10^{-10}$, o ruído do integrador. Repetir com `rtol=1e-5` e `atol=1e-7` leva o mesmo número de passos e chega a $23{,}0828668^\circ$, errado em $2{,}6\times10^{-6}$ graus. O método da secante converge com a mesma rapidez para a raiz da função que recebeu. A ordem descreve essa rapidez e não diz nada sobre a precisão com que $f$ foi calculada.

### Exemplo 5: mantendo um intervalo

O método da secante pode sair da vizinhança da raiz, então uma correção tentadora é a **regula falsi**: usar a mesma reta, mas substituir a ponta que preserva uma troca de sinal. Contando a avaliação em que um ponto a menos de $10^{-10}$ de $r$ é avaliado pela primeira vez, na equação do Exemplo 1 em $[0,2]$:

```text
bissecao                       36
regula falsi                   13
scipy.optimize.brentq           7
secante (1, 1.5, sem intervalo) 6
```

A regula falsi é só linear aqui. A função é convexa no intervalo, então a ponta $2$ nunca se move, e a razão de erro se assenta em $0{,}103$. Manter o intervalo desse jeito sacrifica a ordem superlinear. `brentq` mantém um intervalo e combina bisseção com interpolação quadrática inversa, motivo de ser a escolha padrão quando se conhece uma troca de sinal.

## Equívocos Comuns e Armadilhas

- **"Ordem 1,618 significa que é mais lento que Newton."** Por iteração, sim. Por avaliação pode ser mais rápido (Exemplo 2), a menos que $f'$ seja barata.
- **"Os pontos iniciais precisam cercar a raiz."** Não precisam, e pontos que cercam também não são seguros: $x^2-4$ a partir de $\pm3$ falha no primeiro passo.
- **"O método da secante é a regula falsi."** Mesma reta, contabilidade diferente. A regula falsi preserva uma troca de sinal e cai para ordem linear (Exemplo 5).
- **"Uma execução em float64 mostra a ordem."** Ela dá poucos valores ruidosos de $p_k$. No Exemplo 1 a razão $e_k/(e_{k-1}e_{k-2})$ informou bem mais.
- **"A ordem é sempre $1{,}618$."** Isso exige raiz simples, $C^2$ e $f''(r)\neq0$. Sem essas condições, o Exemplo 3 mediu $1$ e $1{,}366$, e um caso em que $p_k\to2$ sem ordem nenhuma.
- **"A bisseção tem ordem 1."** O intervalo dela tem; os erros dos pontos médios em geral não têm razão limite.
- **"Ordem maior significa resposta mais precisa."** O Exemplo 4 convergiu a toda velocidade para um valor limitado pela precisão de $f$.
- **"Continue iterando por segurança."** Depois da convergência o denominador é puro ruído de arredondamento, ou exatamente zero. Pare pelo tamanho do passo e pelo resíduo, e limite as iterações.

## Resumo

O método da secante troca $f'(x_k)$ pela inclinação entre os dois últimos pontos, então custa uma avaliação por iteração e dispensa derivada. A ordem é definida por $e_{k+1}/e_k^{\,p}\to A$ e medida com $p_k$; os pontos médios da bisseção em geral não têm esse limite, só uma cota. A relação exata $\varepsilon_{k+1}=\frac{f[x_{k-1},x_k,r]}{f[x_{k-1},x_k]}\varepsilon_k\varepsilon_{k-1}$ dá $e_{k+1}\approx\lvert C\rvert e_ke_{k-1}$, uma recorrência de Fibonacci nos logaritmos, e daí a ordem $\phi$ com constante $\lvert C\rvert^{\phi-1}$, para uma raiz simples de uma função $C^2$ com $f''(r)\neq0$ e bons pontos iniciais. Execuções de alta precisão chegam a $1{,}6181$ e $0{,}3187$; float64 dá só um valor grosseiro. Assintoticamente, por avaliação, a secante supera Newton quando $f'$ custa mais de cerca de 44% de $f$. Sem as hipóteses, a ordem medida mudou para $1$ ou $1{,}366$, $p_k$ tendeu a $2$ sem ordem verdadeira, ou a execução falhou. Quando se conhece um intervalo, `brentq` é a escolha usual.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.4 Interpolation-based methods](https://fncbook.com/secant): o método da secante, convergência superlinear, a ordem da razão áurea e interpolação quadrática inversa.
- [MIT OpenCourseWare 18.330, Chapter 4: Nonlinear equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): o método da secante com o produto de erros e o argumento da ordem.
- [SciPy, scipy.optimize.newton](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.newton.html): a rotina que roda o método da secante quando nenhuma derivada é passada.
- [SciPy, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): o método de Brent com intervalo.
- [SciPy, scipy.optimize.bisect](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.bisect.html): a rotina de bisseção usada nas contagens de avaliações.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): o integrador que serve de função caixa-preta no Exemplo 4.
