---
version: 1.0
updatedAt: 2026-11-04
title: "Séries de Taylor e Maclaurin com Cotas de Erro"
summary: "Séries de Taylor e Maclaurin, o resto e sua cota de erro, e quantos termos uma precisão-alvo exige, que é a base da aproximação numérica."
---
## Objetivos de Aprendizagem

- Construir o polinômio de Taylor $T_n$ e a série de Taylor de uma função num ponto $a$, e a série de Maclaurin quando $a = 0$.
- Enunciar o teorema de Taylor com resto de Lagrange, incluindo as hipóteses, e usar $\lvert R_n\rvert \le M\lvert x-a\rvert^{n+1}/(n+1)!$ com $M$ tomado em todo o intervalo entre $a$ e $x$.
- Calcular quantos termos uma precisão-alvo exige e conferir que a cota vale contra o erro verdadeiro.
- Explicar por que uma série de Taylor pode convergir sem convergir para a função, e por que pode não convergir onde a função está perfeitamente definida.
- Escolher entre expansões (ou entre centros diferentes) para atingir uma precisão com bem menos termos.

## Contexto e Motivação

Um computador sabe somar, subtrair, multiplicar e dividir. Todo o resto, como $e^x$, $\sin x$ ou $\ln x$, precisa ser reduzido a essas quatro operações, e o caminho natural é um polinômio. O polinômio de Taylor é o polinômio que coincide com a função e com suas $n$ primeiras derivadas num ponto. A versão de grau 1 é a reta tangente, a linearização por trás da otimização baseada em gradiente. A de grau 2 acrescenta curvatura, que é o modelo local por trás do método de Newton para minimização.

Aproximar sem conhecer o erro é chutar. O assunto real desta lição é o **resto**: uma cota para $f(x) - T_n(x)$ que depende só das derivadas de $f$ e que, portanto, pode ser calculado antes de a aproximação ser avaliada. A cota transforma "quantos termos eu preciso?" numa desigualdade que se resolve. A lição se apoia em `power-series-and-the-radius-of-convergence`: a série de Taylor de uma função é uma série de potências, então tem um raio, e seu comportamento nos extremos segue os testes de `convergence-tests`.

## Teoria Central

### Polinômios e séries de Taylor

Suponha que $f$ tem derivadas de todas as ordens em $a$. O **polinômio de Taylor** de grau $n$ em $a$ é

$$T_n(x) = \sum_{k=0}^{n} \frac{f^{(k)}(a)}{k!}(x-a)^k,$$

e a **série de Taylor** é a série $\sum_{k=0}^\infty \frac{f^{(k)}(a)}{k!}(x-a)^k$ cujas somas parciais são esses polinômios. Ela é definida só pelos coeficientes; se converge num dado $x$ é outra questão. Em $a=0$ ela se chama **série de Maclaurin**. Os coeficientes são forçados pela exigência de que $T_n$ coincida com $f$ e com suas $n$ primeiras derivadas em $a$, que é a mesma fórmula $c_k = f^{(k)}(a)/k!$ que a derivação termo a termo deu na lição anterior. O erro é $R_n(x) = f(x) - T_n(x)$.

### O teorema de Taylor e o resto de Lagrange

**Hipóteses.** $f^{(n)}$ é contínua no intervalo fechado $I$ entre $a$ e $x$, e $f^{(n+1)}$ existe no intervalo aberto correspondente. **Conclusão.** Existe um número $\xi$ estritamente entre $a$ e $x$ tal que

$$R_n(x) = \frac{f^{(n+1)}(\xi)}{(n+1)!}(x-a)^{n+1}.$$

O ponto $\xi$ não é conhecido, então o teorema é usado por meio de uma cota. Se $\lvert f^{(n+1)}(t)\rvert \le M$ para todo $t$ em $I$, então

$$\lvert R_n(x)\rvert \le \frac{M\,\lvert x-a\rvert^{n+1}}{(n+1)!}.$$

O valor $M$ precisa limitar a derivada em todo o intervalo entre $a$ e $x$, e não só em $a$. O caso $n=0$ é o Teorema do Valor Médio, $f(x)-f(a) = f'(\xi)(x-a)$ (veja `the-mean-value-theorem-and-monotonicity`), então o teorema de Taylor é a generalização dele para ordens maiores.

### Quando a série é igual à função

A série de Taylor converge para $f(x)$ exatamente quando $R_n(x) \to 0$. As duas partes podem falhar separadamente.

Para $e^x$ toda derivada é $e^x$, então $M = e^{\lvert x\rvert}$ serve para qualquer $x$ e $\lvert R_n\rvert \le e^{\lvert x\rvert}\lvert x\rvert^{n+1}/(n+1)! \to 0$, porque fatoriais crescem mais que exponenciais. O mesmo argumento com $M=1$ funciona para $\sin$ e $\cos$. Essas três séries são, portanto, iguais às suas funções em todo $\mathbb R$.

A convergência da série, sozinha, não resolve a questão. A função $f(x) = e^{-1/x^2}$ para $x\neq0$, com $f(0)=0$, tem $f^{(k)}(0) = 0$ para todo $k$ (Exemplo 4). Sua série de Maclaurin é identicamente $0$, converge em toda parte e é igual a $f$ só em $x=0$. A função é infinitamente derivável, mas não é igual à sua série de Taylor.

A série também pode parar antes do domínio da função. $\ln(1+x)$ está definida para todo $x>-1$, mas sua série de Maclaurin tem raio $1$ e diverge em $x = 2$.

### Séries de Maclaurin padrão

- $e^x$: $\sum x^n/n!$, convergindo para a função em todo $x$ real.
- $\sin x$: $\sum (-1)^n x^{2n+1}/(2n+1)!$, convergindo para a função em todo $x$ real.
- $\cos x$: $\sum (-1)^n x^{2n}/(2n)!$, convergindo para a função em todo $x$ real.
- $\frac{1}{1-x}$: $\sum x^n$, convergindo para a função quando $-1 < x < 1$.
- $\ln(1+x)$: $\sum_{n\ge1} (-1)^{n+1} x^n/n$, convergindo para a função quando $-1 < x \le 1$.
- $\arctan x$: $\sum (-1)^n x^{2n+1}/(2n+1)$, convergindo para a função quando $-1 \le x \le 1$.

As três últimas são aquelas em que os extremos importam. Para $\ln(1+x)$ o extremo $x=1$ entra e $x=-1$ fica de fora (dá $-\sum 1/n$).

### Três formas de limitar um erro

1. **Cota de Lagrange**, como acima, para qualquer função suave.
2. **Cota da série alternada**, $\lvert R_N\rvert \le b_{N+1}$, quando os termos alternam e decrescem a $0$ (veja `convergence-tests`). Não precisa de derivadas.
3. **Cota da cauda geométrica**, quando os termos são dominados por uma razão $r<1$: a soma dos termos de $t_K$ em diante é no máximo $t_K/(1-r)$ se cada termo é no máximo $r$ vezes o anterior.

### Quantos termos são necessários

Fixe a tolerância $\varepsilon$, o ponto $x$ e uma cota $M$. O menor $n$ com $M\lvert x-a\rvert^{n+1}/(n+1)! \le \varepsilon$ garante a precisão. É uma garantia, não uma previsão: o erro verdadeiro costuma ser várias vezes menor.

## Exemplos Resolvidos

### Exemplo 1: $e$ com seis casas decimais, e um $M$ errado

Aproxime $e = e^1$ com o polinômio de Maclaurin em $a=0$, $x=1$, tolerância $10^{-6}$. Em $[0,1]$ toda derivada de $e^x$ é no máximo $e<3$, então tome $M=3$. Então $\lvert R_n\rvert \le 3/(n+1)!$. Como $3/9! = 8{,}3\times10^{-6}$ e $3/10! = 8{,}27\times10^{-7}$, o primeiro $n$ que serve é $n=9$, isto é, $T_9(1) = \sum_{k=0}^9 1/k!$. Um script compara a cota com o erro real $e - T_n(1)$:

```text
n   cota 3/(n+1)!     erro real
7   7.44e-05          2.79e-05
8   8.27e-06          3.06e-06
9   8.27e-07          3.03e-07
10  7.52e-08          2.73e-08
```

A cota vale para todo $n$ (um script confirma para $n=0,\ldots,30$ com aritmética de 80 dígitos) e aqui é cerca de $2{,}7$ vezes maior que o erro. O caso $n=8$ de fato não atinge a meta: seu erro real é $3{,}06\times10^{-6}$. Se tivesse sido usado $M=1$, tomando $f^{(10)}(0)$ em vez do máximo em $[0,1]$, a cota em $n=9$ seria $1/10! = 2{,}76\times10^{-7}$, menor que o erro real $3{,}03\times10^{-7}$. Um $M$ errado não é só folgado; é falso.

### Exemplo 2: $\sin 1$ com dez casas decimais

Com $M=1$ (qualquer derivada de $\sin$ é $\pm\sin$ ou $\pm\cos$), $\lvert R_n(1)\rvert \le 1/(n+1)!$. Precisamos de $1/(n+1)! < 10^{-10}$, o que acontece primeiro em $n+1 = 14$ ($13! = 6{,}2\times10^9$ é pouco, $14! = 8{,}7\times10^{10}$ basta). Logo $n=13$, e $T_{13}(1) = 0{,}8414709848087\ldots$ contra $\sin 1 = 0{,}8414709848079\ldots$, com erro real $7{,}6\times10^{-13}$ e cota $1{,}1\times10^{-11}$. A cota é folgada por um fator $15$ porque o polinômio de Taylor de $\sin$ não tem termos pares, então $T_{13}=T_{14}$ e a cota com $n=14$ dá $1/15! = 7{,}6\times10^{-13}$, o erro real com dois dígitos. A cota só é tão justa quanto o $n$ com que é aplicado.

### Exemplo 3: o mesmo número com muito menos termos ($\ln 2$ e $\sin 3$)

A série $\ln(1+x) = \sum (-1)^{n+1}x^n/n$ em $x=1$ dá $\ln 2$, e a cota alternada é $\lvert R_N\rvert \le 1/(N+1)$. Chegar a $10^{-10}$ levaria cerca de $10^{10}$ termos. (A cota de Lagrange concorda: em $[0,1]$ o máximo de $\lvert f^{(N+1)}\rvert$ é $N!$, dando $1/(N+1)$.) Um caminho mais esperto subtrai a série de $\ln(1-x)$ e obtém

$$\ln\frac{1+y}{1-y} = 2\sum_{k\ge0}\frac{y^{2k+1}}{2k+1}, \qquad \lvert y\rvert<1.$$

Com $y=\tfrac13$ sai $\ln 2$. Cada termo é menor que o anterior por um fator de pelo menos $y^2 = \tfrac19$, então a cauda depois de $K$ termos é no máximo $2y^{2K+1}/\big((2K+1)(1-y^2)\big)$. Isso fica abaixo de $10^{-10}$ em $K=10$ (cota $1{,}0\times10^{-11}$, erro real $1{,}0\times10^{-11}$), contra $10^{10}$ termos antes. Dez termos em vez de dez bilhões: a forma da expansão importa mais que o número de termos.

Mudar o centro ajuda do mesmo jeito. Para obter $\sin 3$ com erro abaixo de $10^{-10}$ a partir da série de Maclaurin, a cota $3^{n+1}/(n+1)!$ só cai abaixo de $10^{-10}$ em $n=21$ (cota $2{,}8\times10^{-11}$, erro real $3{,}6\times10^{-12}$). Expandindo em $a=\pi$, onde $x-a = 3-\pi = -0{,}1416$ é pequeno, a cota $\lvert x-a\rvert^{n+1}/(n+1)!$ já fica abaixo de $10^{-10}$ em $n=7$ (cota $4{,}0\times10^{-12}$, erro real $6{,}3\times10^{-14}$). O polinômio é $T_7(3) = -\big[h - h^3/3! + h^5/5! - h^7/7!\big]$ com $h = 3-\pi$, porque $\sin x = -\sin(x-\pi)$. Quatro termos não nulos no lugar de onze.

### Exemplo 4: uma função diferente da sua série de Taylor

Seja $f(x) = e^{-1/x^2}$ para $x\ne0$ e $f(0)=0$. Para cada $k$, $f^{(k)}(x)$ é uma soma de termos da forma $p(1/x)\,e^{-1/x^2}$ com $p$ polinômio, e $e^{-1/x^2}$ vai a $0$ mais rápido que qualquer potência de $x$, então $f^{(k)}(0)=0$ (um script verifica isso por limites para $k=1,\ldots,5$). A série de Maclaurin é $0+0x+0x^2+\cdots$. Mas $f(0{,}5) = e^{-4} = 0{,}0183$ e $f(1) = 0{,}3679$. A série converge em todo $x$, para o valor errado. Nos termos do teorema de Taylor: $R_n(x) = f(x)$ para todo $n$, e nunca tende a $0$.

### Exemplo 5: onde a cota é inútil

Para $\ln(1+x)$ em $x=2$ (fora do raio), $\lvert f^{(n+1)}\rvert = n!/(1+t)^{n+1} \le n!$ em $[0,2]$, o que dá $\lvert R_n(2)\rvert \le 2^{n+1}/(n+1)$, que cresce sem limite, e as somas parciais confirmam: $T_3(2) = 2{,}67$, $T_5(2) = 5{,}07$, $T_{10}(2) = -64{,}8$, $T_{20}(2) = -34\,360$, enquanto $\ln 3 = 1{,}0986$. A cota não é apenas fraca; a série realmente diverge, porque os termos $2^n/n$ não tendem a $0$. Em $x=\tfrac12$, por contraste, a mesma cota $0{,}5^{n+1}/(n+1)$ vale $9{,}5\times10^{-7}$ em $n=15$, com erro real $6{,}5\times10^{-7}$.

### Exemplo 6: Taylor não é o que as bibliotecas usam ("livro vs hoje")

Um polinômio de Taylor de grau 7 para $\sin$ em $[-\pi/2,\pi/2]$ tem erro máximo $1{,}57\times10^{-4}$, nas pontas, coerente com a cota de Lagrange $(\pi/2)^9/9! = 1{,}60\times10^{-4}$ (usando $n=8$, já que $T_7=T_8$). Um polinômio que interpola $\sin$ em 9 nós de Chebyshev (grau 8, que se reduz a grau 7 para uma função ímpar) tem erro máximo $5{,}95\times10^{-7}$ no mesmo intervalo. O melhor polinômio de grau 7 possível (minimax) tem erro máximo em torno de $5{,}9\times10^{-7}$, obtido por programação linear numa grade fina, com uma curva de erro que equioscila em cinco pontos, como a teoria exige. O polinômio de Taylor é, portanto, cerca de 270 vezes pior que o melhor polinômio do mesmo grau. Polinômios de Taylor são exatos num único ponto e pioram ao se afastar dele. Bibliotecas matemáticas de produção costumam combinar redução de argumento com polinômios ajustados para minimizar o pior erro em todo o intervalo, o que refina a ideia desta lição sem revogá-la.

## Equívocos Comuns e Armadilhas

- **"A série de Taylor de $f$ sempre é igual a $f$."** O Exemplo 4 é infinitamente derivável e tem série de Taylor igual a ele só num ponto. A igualdade exige $R_n \to 0$.
- **"Se a função está definida em $x$, a série de Taylor converge ali."** $\ln(1+x)$ em $x=2$ é o contraexemplo (Exemplo 5); o raio da série é o limite.
- **"Tome $M$ da derivada no centro."** $M$ precisa limitar a derivada em todo o intervalo entre $a$ e $x$. O Exemplo 1 mostra uma cota menor que o erro verdadeiro.
- **"A cota é o erro."** É uma cota superior; o erro verdadeiro costuma ser várias vezes menor. Não o apresente como estimativa.
- **"Mais termos sempre ajudam."** Fora do intervalo de convergência pioram (Exemplo 5), e dentro dele a precisão da máquina e o arredondamento limitam o ganho.
- **"A cota cobre todo o erro."** A cota de Lagrange cobre só o truncamento. Uma avaliação em ponto flutuante tem o próprio erro de arredondamento, que esta lição não limita.

## Resumo

O polinômio de Taylor $T_n(x)=\sum_{k\le n} f^{(k)}(a)(x-a)^k/k!$ coincide com $f$ e com suas $n$ primeiras derivadas em $a$, e a série de Taylor é a série cujas somas parciais são eles. O teorema de Taylor, válido quando $f^{(n)}$ é contínua no intervalo e $f^{(n+1)}$ existe no interior, dá o resto $f^{(n+1)}(\xi)(x-a)^{n+1}/(n+1)!$ e a cota $M\lvert x-a\rvert^{n+1}/(n+1)!$, com $M$ em todo o intervalo. Resolver essa cota para $n$ responde "quantos termos", e um script pode conferir a cota contra o erro verdadeiro. A série é igual à função só onde $R_n\to0$: isso vale para $e^x$, $\sin x$ e $\cos x$ em toda parte, para $\ln(1+x)$ em $(-1,1]$, e falha para a função plana $e^{-1/x^2}$ em todo $x \ne 0$. Escolher bem a expansão ou o centro, como em $\ln 2$ com $y=\tfrac13$ e $\sin 3$ em $a=\pi$, pode importar muito mais que somar termos.

## Documentation Links

- [OpenStax Calculus Volume 2, 6.3 Taylor and Maclaurin Series](https://openstax.org/books/calculus-volume-2/pages/6-3-taylor-and-maclaurin-series): polinômios de Taylor, teorema de Taylor com resto e as séries de Maclaurin padrão.
- [OpenStax Calculus Volume 2, 6.4 Working with Taylor Series](https://openstax.org/books/calculus-volume-2/pages/6-4-working-with-taylor-series): série binomial, uso de séries de Taylor para avaliar e aproximar, e estimativas de erro.
- [MIT OpenCourseWare 18.01SC, Session 98: Taylor's Series](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-98-taylors-series/): série de Taylor a partir de aproximações sucessivas, com a fórmula dos coeficientes.
- [MIT OpenCourseWare 18.01SC, Session 99: Taylor's Series, Continued](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-99-taylors-series-continued/): convergência de uma série de Taylor alternada e mais exemplos.
