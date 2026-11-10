---
version: 1.0
updatedAt: 2026-11-04
title: "Método de Euler e Erro Local vs Global"
summary: "O método de Euler para problemas de valor inicial, erro de truncamento local versus erro global, o efeito do tamanho do passo e um primeiro olhar sobre estabilidade."
---
## Objetivos de Aprendizagem

- Definir o erro de truncamento local do método de Euler e reconhecer as duas convenções em uso.
- Enunciar o teorema do erro global com suas hipóteses e explicar por que ordem 2 por passo vira ordem 1 no total.
- Medir as duas ordens numa tabela e mostrar a ordem global caindo quando $y''$ é ilimitada.
- Ler o resultado de Euler como a solução exata de uma equação próxima, que é o seu erro reverso.
- Deduzir a condição de estabilidade $\lvert 1+h\lambda\rvert\le1$, incluindo $\lambda$ complexo, e mostrar um passo real em que Euler explode.
- Reconhecer stiffness e ver o que um passo implícito muda.
- Separar truncamento de arredondamento quando o passo fica muito pequeno.

## Contexto e Motivação

A lição `differential-equations-and-initial-value-problems` apresentou a atualização $y_{n+1} = y_n + h f(t_n, y_n)$, viu o erro num tempo fixo cair pela metade com $h$ e viu a iteração de gradiente descendente $x_{k+1}=(1-10h)x_k$ falhar para $h>0{,}2$. Eram observações. Esta lição traz os motivos, em três perguntas.

Por que o método é de primeira ordem se um passo parece de segunda? Quando a cota de erro clássica é útil, e quando é absurdamente pessimista? E por que uma solução perfeitamente suave e lenta pode exigir um passo minúsculo? As mesmas três perguntas voltam em todo resolvedor, inclusive nos de `runge-kutta-methods`.

## Teoria Central

### Erro de truncamento local

O **erro de truncamento local** mede um passo que parte da solução exata:

$$\ell_{n+1} = y(t_{n+1}) - y(t_n) - h f\big(t_n, y(t_n)\big).$$

Se $y\in C^2$, o teorema de Taylor com $y'=f$ dá $\ell_{n+1} = \frac{h^2}{2}y''(\xi_n)$ para algum $\xi_n$ dentro do passo. Como $y''=f_t+f f_y$ ao longo da solução, $f\in C^1$ basta para isso.

As convenções variam. Alguns livros, entre eles Fundamentals of Numerical Computation, definem o erro de truncamento como o resíduo por unidade de passo, $\tau = \ell/h$, que é $O(h)$ em Euler. Outros usam o próprio $\ell$, que é $O(h^2)$. Os dois descrevem o mesmo método, então confira qual deles a fonte usa. Esta lição usa $\ell$.

### Do local ao global

O **erro global** é $e_n = y(t_n) - y_n$. Subtraia o método da definição de $\ell$:

$$e_{n+1} = e_n + h\big[f(t_n,y(t_n)) - f(t_n,y_n)\big] + \ell_{n+1}.$$

**Teorema.** Suponha que $f$ seja contínua e lipschitziana em $y$ com constante $L>0$ em $[t_0,T]\times\mathbb R$, que a solução seja $C^2$ com $\lvert y''\rvert\le M$ em $[t_0,T]$ e que $y_0=y(t_0)$. Então, para $t_n\le T$,

$$\lvert e_n\rvert \le \frac{hM}{2L}\Big(e^{L(t_n-t_0)}-1\Big).$$

A prova toma valores absolutos, $\lvert e_{n+1}\rvert\le(1+hL)\lvert e_n\rvert+\frac{h^2M}{2}$, desenrola a recorrência numa soma geométrica e usa $1+hL\le e^{hL}$.

Acontecem duas coisas separadas. Cerca de $(T-t_0)/h$ passos injetam $O(h^2)$ cada um, o que perde uma potência de $h$. E o fator $1+hL$ deixa os erros antigos crescerem enquanto viajam, e daí vem a exponencial. Logo o erro global não é simplesmente a soma dos erros locais, como mostra o Exemplo 2.

Um erro inicial acrescenta $e^{L(t_n-t_0)}\lvert e_0\rvert$. Se cada passo também comete um arredondamento de no máximo $\delta$, o termo $hM/2$ vira $hM/2+\delta/h$: a parte de truncamento encolhe com $h$, e a de arredondamento cresce.

### Erro direto e erro reverso

Nos termos de `conditioning-and-numerical-stability`, $e_n$ é um erro direto. Para $y'=\lambda y$ há também uma afirmação reversa limpa. Com $1+h\lambda>0$, o $y_n=(1+h\lambda)^n y_0$ de Euler é a solução exata em $t_n$ de

$$y'=\mu y, \qquad \mu=\frac{\ln(1+h\lambda)}{h}=\lambda-\frac{h\lambda^2}{2}+O(h^2).$$

O método resolve exatamente uma equação próxima, e essa proximidade é $O(h)$. Com $\lambda=-1$ e $h=0{,}01$, $\mu=-1{,}00503$. Num tempo $T$, o erro direto relativo é $\lvert e^{(\mu-\lambda)T}-1\rvert\approx Th\lambda^2/2$. Quando $1+h\lambda<0$ não existe $\mu$ real, o que é o primeiro sinal do próximo tópico.

### Estabilidade

Aplique Euler a $y'=\lambda y$ com $\lambda\in\mathbb C$: $y_{n+1}=(1+z)y_n$ com $z=h\lambda$. As iteradas ficam limitadas exatamente quando $\lvert 1+z\rvert\le1$, um disco de raio 1 centrado em $-1$. Essa é a **região de estabilidade**. Ela é uma propriedade do método aplicado a uma equação-teste, e para $f$ não linear ou para um sistema vale pelos autovalores do jacobiano, como guia local.

- **$\lambda<0$ real:** a condição é $h\le2/\lvert\lambda\rvert$. O limite $h<0{,}2$ do gradiente descendente para $\lambda=-10$ é este caso, com $h=0{,}2$ exatamente na fronteira: limitado, mas sem convergir.
- **$\lambda=i\omega$ imaginário:** $\lvert 1+i\omega h\rvert^2=1+\omega^2h^2>1$ para todo $h>0$. O disco só toca o eixo imaginário na origem, então nenhum passo é estável para uma oscilação sem amortecimento.

### Stiffness

Um problema é **stiff** (rígido) quando a estabilidade, e não a precisão, dita o passo. É questão de grau, não uma propriedade de sim ou não. A forma típica é uma solução lenta com um modo rápido que já decaiu. O modo rápido não importa mais para a resposta, mas continua fixando $\lvert\lambda\rvert$ e, portanto, $h$.

O **Euler implícito** (backward Euler), $y_{n+1}=y_n+hf(t_{n+1},y_{n+1})$, tem $y_{n+1}=\frac{1}{1-z}y_n$, logo é estável para todo $h>0$ quando $\operatorname{Re}\lambda\le0$. Continua sendo de ordem 1. O preço é resolver uma equação a cada passo, um sistema linear num problema linear.

## Exemplos Resolvidos

### Exemplo 1: um passo à mão

Tome $y'=y\cos t$, $y(0)=1$, cuja solução é $y=e^{\sin t}$. Com $h=0{,}1$, Euler dá $y_1=1+0{,}1\cdot1=1{,}1$, enquanto $y(0{,}1)=1{,}104987$. Assim $\ell_1=0{,}004987$. A previsão é $\frac{h^2}{2}y''(0)=0{,}005$, pois $y''=y(\cos^2t-\sin t)$ vale 1 em $t=0$.

### Exemplo 2: ordens local e global, medidas

No mesmo problema até $t=2$, a tabela mostra o maior erro local entre todos os passos, a soma dos erros locais absolutos e o erro global em $t=2$.

```text
  n      h       max|l|   ordem   soma|l|    |e_n|    ordem
 10  0.20000   5.314e-02         2.895e-01  1.482e-01
 20  0.10000   1.354e-02  1.97   1.468e-01  7.467e-02  0.99
 40  0.05000   3.397e-03  1.99   7.354e-02  3.746e-02  1.00
 80  0.02500   8.491e-04  2.00   3.683e-02  1.876e-02  1.00
160  0.01250   2.124e-04  2.00   1.843e-02  9.386e-03  1.00
320  0.00625   5.309e-05  2.00   9.217e-03  4.695e-03  1.00
640  0.00313   1.327e-05  2.00   4.609e-03  2.348e-03  1.00
```

Ordem local 2, ordem global 1, como diz o teorema. O erro global é cerca de metade da soma dos erros locais: $y''$ troca de sinal perto de $t=0{,}67$, então os erros locais se cancelam em parte, e cada um deles é depois carregado pelo fluxo. Com $L=1$ e $M=e$ (o máximo de $\lvert y''\rvert$ em $[0,2]$, em $t=\pi/2$), a cota em $n=160$ é $0{,}109$, cerca de 12 vezes o erro verdadeiro.

### Exemplo 3: quando a cota é útil

Tome $h=0{,}01$ e $y'=\pm y$, $y(0)=1$. O teorema tem $L=1$ nos dois casos, mas os fluxos são opostos.

```text
            y' = y (crescente)              y' = -y (decrescente)
 T    |e_n|     erro rel.    cota       |e_n|     erro rel.    cota
 1   1.35e-02    0.0050     2.3e-02    1.85e-03    0.0050     8.6e-03
 5   3.64e+00    0.025      1.1e+02    1.67e-04    0.025      7.4e-01
10   1.07e+03    0.048      2.4e+06    2.23e-06    0.049      1.1e+02
20   4.59e+07    0.095      1.2e+15    1.97e-10    0.096      2.4e+06
```

No caso crescente a exponencial é real: o erro absoluto cresce junto com a solução, embora a cota já esteja grande demais em $T=20$. No caso decrescente, a cota diz $2{,}4\times10^6$ quando o erro é $2\times10^{-10}$. Ela não enxerga o fluxo contraindo, porque uma constante de Lipschitz não tem sinal. Os erros relativos batem com a estimativa do erro reverso $Th/2$, que é $0{,}1$ em $T=20$. Para $\lambda=-1$, $\lvert e^{(\mu-\lambda)T}-1\rvert=0{,}0958$, de acordo com a tabela.

### Exemplo 4: um problema stiff e uma explosão real

Considere $y'=-1000(y-\cos t)-\sin t$, $y(0)=1$. A solução exata é $y=\cos t$, como a substituição confirma, e as soluções próximas são $\cos t+Ce^{-1000t}$. A solução varia numa escala da ordem de 1, mas $\lambda=-1000$, então Euler precisa de $h\le0{,}002$, ou seja, $n\ge500$ passos para chegar a $t=1$. Erros em $t=1$:

```text
   n       h     1-1000h   Euler explícito   Euler implícito
  10   0.10000   -99.000      4.52e+15         2.84e-05
 100   0.01000    -9.000      1.33e+90         2.72e-06
 400   0.00250    -1.500      3.42e+64         6.77e-07
 476   0.00210    -1.101      7.62e+13         5.69e-07
 490   0.00204    -1.041      3.33e+02         5.53e-07
 500   0.00200    -1.000      4.59e-07         5.42e-07
1000   0.00100    +0.000      2.70e-07         2.71e-07
2000   0.00050    +0.500      1.35e-07         1.35e-07
```

A condição inicial é exata e $y$ é suave, e mesmo assim $h=0{,}0021$ dá $7{,}6\times10^{13}$: o erro de truncamento local de cada passo alimenta um modo amplificado por $1{,}1$ a cada passo. O limiar é abrupto. Depois de estáveis, Euler explícito e implícito têm mais ou menos a mesma precisão aqui (compare $n=1000$), então o limite de passo não tem a ver com precisão. Euler implícito já consegue $2{,}8\times10^{-5}$ com $n=10$, onde o explícito não tem salvação.

### Exemplo 5: energia numa mola simulada

Simulações físicas integram osciladores, e $x''=-x$ é o mais simples: $x'=v$, $v'=-x$, com autovalores $\pm i$. Euler multiplica a energia $x^2+v^2$ por exatamente $1+h^2$ a cada passo, então a energia cresce para todo $h$:

```text
  h     T    energia depois de T (início 1)    (1+h^2)^(T/h)
0.1    10           2.7048                       2.7048
0.01   10           1.1052                       1.1052
0.1   100       20959.2                      20959.2
0.01  100           2.7181                       2.7181
```

Uma mola nessa simulação ganha energia do nada. Uma mudança pequena corrige a deriva: atualize $v_{n+1}=v_n-hx_n$ primeiro e depois $x_{n+1}=x_n+hv_{n+1}$. Esse Euler semi-implícito (simplético) mantém a energia entre $0{,}952$ e $1{,}053$ até $T=100$ com $h=0{,}1$, e continua sendo de primeira ordem.

### Exemplo 6: quando a ordem cai

O teorema pede $y''$ limitada. Tome $y'=1/\sqrt{1-t}$, $y(0)=0$, com solução $y=2-2\sqrt{1-t}$, logo $y(1)=2$. Aqui $y''$ e $f$ são ilimitadas em $t=1$, embora o método nunca avalie $f$ ali. Cada linha quadruplica $n$:

```text
    n     |e_n|     ordem
  100   1.410e-01
  400   7.177e-02   0.49
 1600   3.620e-02   0.49
 6400   1.818e-02   0.50
```

A ordem é $1/2$. Uma falha mais branda não prejudica Euler. Tome $y'=y$ até $t=1/\sqrt2$ e $y'=-y$ depois, integrando até $t=1{,}5$. Um passo por execução atravessa o salto, com erro local $O(h)$ em vez de $O(h^2)$. É um único passo ruim, então os erros oscilam, mas a ordem ajustada sobre $n=100\cdot2^k$, $k=0,\dots,9$, ainda é $0{,}99$. O ajuste varia com essas escolhas: outros tempos finais, ou a ordem de sinais inversa, dão valores de $0{,}91$ a $1{,}20$.

A unicidade também importa. Para $y'=3y^{2/3}$ com $y(0)=0$, o caso de `differential-equations-and-initial-value-problems`, Euler fica em $0$ para todo $h$, porque $f(0)=0$. Essa é uma solução válida, e $y=t^3$ é outra, que nenhum tamanho de passo encontra. Partindo de $y_0=10^{-6}$, 1000 passos chegam a $1{,}016$ em $t=1$, contra o exato $1{,}0303$ para esse início. O teorema não se aplica: $f$ não é lipschitziana em $0$.

### Exemplo 7: o arredondamento assume

Para $y'=-y$, $y(0)=1$, até $t=1$, compare o mesmo laço em float32 e float64. A estimativa de truncamento é $e^{-1}h/2$.

```text
        n     erro float32    erro float64    truncamento
     1000       1.840e-04       1.840e-04      1.839e-04
    10000       1.889e-05       1.839e-05      1.839e-05
    30000       6.041e-06       6.131e-06      6.131e-06
   100000       4.264e-07       1.839e-06      1.839e-06
   300000       3.506e-05       6.131e-07      6.131e-07
  1000000       2.565e-05       1.839e-07      1.839e-07
```

Até $n=30000$ o float32 acompanha o truncamento. Depois quem decide é o arredondamento, não $h$. O valor em $n=100000$ é cancelamento por sorte, não um ganho real, e mais passos pioram o resultado. Em float64 a linha do truncamento continua pelo menos até $n=10^7$ ($1{,}839\times10^{-8}$). Com a taxa de primeira ordem de Euler, chegar a essa precisão custa dez milhões de passos, que é o motivo prático de `runge-kutta-methods`.

## Equívocos Comuns e Armadilhas

- **"Erro local $O(h^2)$ significa resposta com precisão de segunda ordem."** Os passos se somam: a ordem global é 1.
- **"O erro global é a soma dos erros locais."** Os erros são carregados e escalados pelo fluxo. No Exemplo 2 a soma é o dobro do erro, e no Exemplo 3 os problemas decrescentes esquecem erros antigos.
- **"A cota $e^{LT}$ prevê o erro."** Ela é um pior caso. Em soluções decrescentes pode errar por 16 ordens de grandeza.
- **"Solução suave permite passo grande."** A precisão permitiria, a estabilidade não. O Exemplo 4 é $\cos t$.
- **"Passo estável é passo preciso."** Em $x''=-x$ não existe $h$ estável, e em $y'=-y$ com $h=1{,}9$ as iteradas ficam limitadas, mas trocam de sinal.
- **"Métodos implícitos são mais precisos."** Euler implícito tem a mesma ordem e, no Exemplo 4, o mesmo erro em $n=1000$. O que ele ganha é estabilidade.
- **"$h$ menor é sempre melhor."** Exemplo 7.

## Resumo

O método de Euler comete um erro local de $h^2y''/2$ por passo. Se $f$ é lipschitziana e $y''$ é limitada, o erro global é $O(h)$, com um fator $e^{LT}$ que descreve o crescimento no pior caso e pode ser grande demais quando o fluxo contrai. As duas ordens foram medidas ($2{,}00$ e $1{,}00$), e a ordem global caiu para $1/2$ com $y''$ ilimitada. Para $y'=\lambda y$ o método resolve exatamente uma equação próxima, com erro reverso $O(h)$. A estabilidade exige $\lvert1+h\lambda\rvert\le1$, o que elimina todo $h$ numa oscilação pura e força $h\le0{,}002$ num problema cuja solução é $\cos t$: em $h=0{,}0021$ o resultado foi $7{,}6\times10^{13}$. Problemas stiff assim pedem passos implícitos. O arredondamento impõe um piso, e em float32 ele chega por volta de $n=10^5$.

## Documentation Links

- [Fundamentals of Numerical Computation, 6.2 Euler's method](https://fncbook.com/euler): erro de truncamento local, erro global e o teorema de convergência.
- [Fundamentals of Numerical Computation, 11.3 Absolute stability](https://fncbook.com/absstab-diffusion): a equação-teste e as regiões de estabilidade.
- [Fundamentals of Numerical Computation, 11.4 Stiffness](https://fncbook.com/stiffness): linearização e problemas cujo passo é fixado pela estabilidade.
- [MIT OCW 18.330, Chapter 5: Methods for ordinary differential equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/a9d2bd9be098f0ada172af40379a17cc_MIT18_330S12_Chapter5.pdf): métodos de Euler e de Runge-Kutta, convergência e estabilidade linear.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): os resolvedores de produção, explícitos e implícitos, com notas sobre problemas stiff.
