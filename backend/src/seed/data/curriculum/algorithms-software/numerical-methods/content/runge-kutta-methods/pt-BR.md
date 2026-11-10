---
version: 1.0
updatedAt: 2026-11-04
title: "Métodos de Runge-Kutta"
summary: "Os métodos de Runge-Kutta de segunda ordem e o clássico de quarta ordem, como ganham ordem sem derivadas do lado direito e o passo adaptativo."
---
## Objetivos de Aprendizagem

- Deduzir a família de métodos explícitos de Runge-Kutta de segunda ordem casando uma expansão de Taylor, sem usar derivadas de $f$.
- Ler uma tabela de Butcher, escrever o RK4 clássico e conferir suas condições de ordem.
- Ligar os métodos do ponto médio, do tipo trapézio e RK4 a regras de quadratura em $y'=f(t)$.
- Medir ordens por avaliação e mostrá-las caindo quando falta suavidade ao lado direito.
- Calcular uma função de estabilidade e explicar por que ordem maior não cura stiffness.
- Explicar como um par embutido controla o tamanho do passo e comparar um resolvedor próprio com `solve_ivp`, contando avaliações.

## Contexto e Motivação

A lição `eulers-method-and-local-vs-global-error` terminou com dez milhões de passos para um erro perto de $10^{-8}$. Subir a ordem é a correção óbvia, e o caminho direto é um método de Taylor: $y_{n+1}=y_n+hy'+\frac{h^2}{2}y''+\dots$. Só que $y''=f_t+ff_y$ exige derivadas parciais de $f$, e os termos seguintes são piores (a expansão é a de `taylor-and-maclaurin-series-with-error-bounds`). Muitas vezes $f$ é uma caixa-preta.

Os métodos de Runge-Kutta obtêm a mesma ordem com avaliações extras só de $f$, amostrando-a em pontos bem escolhidos dentro do passo e combinando as inclinações. O código que roda por padrão em `scipy.integrate.solve_ivp` é um deles.

## Teoria Central

### Casando Taylor com duas inclinações

Tente dois estágios, $k_1=f(t,y)$ e $k_2=f(t+\alpha h,\,y+\beta hk_1)$, com a atualização $y+h(b_1k_1+b_2k_2)$. Para $f\in C^2$, a expansão dá $k_2=f+\alpha hf_t+\beta hff_y+O(h^2)$, e a atualização vira

$$y+h(b_1+b_2)f+h^2b_2(\alpha f_t+\beta ff_y)+O(h^3).$$

A solução exata tem $y+hf+\frac{h^2}{2}(f_t+ff_y)+O(h^3)$. As duas concordam até $h^2$ quando

$$b_1+b_2=1,\qquad b_2\alpha=\tfrac12,\qquad b_2\beta=\tfrac12.$$

Nenhuma derivada parcial de $f$ é calculada: a diferença $k_2-k_1$ faz esse papel implicitamente. Sobra um parâmetro livre. Com $b_2=1$ este é o método do **ponto médio explícito**, $y+hf(t+\frac h2,\,y+\frac h2k_1)$. Com $b_2=\frac12$ é o método do **trapézio explícito**, $y+\frac h2(k_1+f(t+h,\,y+hk_1))$. Os nomes variam de livro para livro: "Heun" e "Euler melhorado" aparecem ligados a membros diferentes dessa família, então confira a fórmula.

### RK4 clássico e tabelas de Butcher

Um método explícito de $s$ estágios é fixado por uma tabela: $k_i=f\big(t+c_ih,\,y+h\sum_{j<i}a_{ij}k_j\big)$ e $y_{n+1}=y_n+h\sum_ib_ik_i$. O RK4 clássico tem

$$\begin{array}{c|cccc} 0 & & & & \\ \frac12 & \frac12 & & & \\ \frac12 & 0 & \frac12 & & \\ 1 & 0 & 0 & 1 & \\ \hline & \frac16 & \frac13 & \frac13 & \frac16 \end{array}$$

```python
def rk4_step(f, t, y, h):
    k1 = f(t, y)
    k2 = f(t + h / 2, y + h / 2 * k1)
    k3 = f(t + h / 2, y + h / 2 * k2)
    k4 = f(t + h, y + h * k3)
    return y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
```

Ordem 4 exige oito condições algébricas sobre a tabela. Em frações exatas, o RK4 dá $\sum b_i=1$, $\sum b_ic_i=\frac12$, $\sum b_ic_i^2=\frac13$, $\sum b_ia_{ij}c_j=\frac16$, $\sum b_ic_i^3=\frac14$, $\sum b_ic_ia_{ij}c_j=\frac18$, $\sum b_ia_{ij}c_j^2=\frac1{12}$ e $\sum b_ia_{ij}a_{jk}c_k=\frac1{24}$, tudo como exigido. Até a ordem 4, $s$ estágios podem chegar à ordem $s$. Para aí: a ordem 5 tem 17 condições e precisa de seis estágios. É por isso que a ordem 4 é um ponto de parada tão comum.

### Num problema de pura quadratura

Se $f$ depende só de $t$, então $k_2=k_3$ no RK4, e um passo vira $\frac h6\big(f(t)+4f(t+\frac h2)+f(t+h)\big)$, um painel de Simpson de `trapezoid-and-simpson-rules`. Do mesmo modo, o ponto médio explícito vira a regra do ponto médio, e o trapézio explícito vira a regra do trapézio. Em $f(t)=e^t$ com 8 passos, RK4 e Simpson composta concordam até $4{,}4\times10^{-16}$. Portanto, o que limita Simpson também limita o RK4.

### Ordem exige lado direito suave

O teorema padrão de ordem assume derivadas suficientes de $f$ (para o RK4, $f\in C^4$ é o enunciado usual), e a cota de Lipschitz da lição anterior leva então a ordem local à ordem global. Ordens ajustadas sobre $n=100\cdot2^k$, $k=0,\dots,7$, deixando de fora erros abaixo de $10^{-12}$:

```text
problema                               Euler   trap. expl.      RK4
y' = y cos t, t=1.5 (suave)             1.00        2.00        4.00
y' = 1 + |y-1|, y(0)=0, t=1.5 (quina)   0.99        ~2.0        ~2.0
y' = y, depois -y após 1/sqrt(2), t=1.5 1.00        1.03        0.75
y' = sqrt(1-y^2), y(0)=0, t=1           1.00        2.00        4.01
y' = sqrt(1-y^2), y(0)=0, t=pi/2        2.00        2.00        2.00
```

Na quina, o RK4 não é melhor que um método de dois estágios. Essas inclinações ajustadas são $2{,}00$ e $2{,}01$, mas leia-as só como cerca de 2: a ordem entre $n$ consecutivos oscila de $0{,}4$ a $4{,}9$ no RK4, e mais no método de dois estágios. No salto, o erro depende de onde o salto cai dentro do passo, então os erros também oscilam e o $0{,}75$ é aproximado, em torno de ordem 1. O remédio ali é parar no salto e recomeçar: com $n$ passos de RK4 de cada lado do salto, dobrar $n$ de 160 para 320 volta a medir $4{,}01$.

As duas últimas linhas são a mesma equação. Sua solução é $\sin t$, infinitamente suave, mas em $t=\pi/2$ a solução chega a $y=1$, onde $f$ tem derivada em $y$ infinita (o código limita $1-y^2$ a 0 por baixo). O RK4 cai para ordem 2, com cada duplicação de $n$ dividindo o erro por 4. A suavidade da solução não basta; o método amostra $f$ fora da solução. O $2{,}00$ de Euler não é um ganho: o termo de primeira ordem do erro dele se anula por acaso naquele único instante.

### Funções de estabilidade

Em $y'=\lambda y$ com $z=h\lambda$, todo método explícito com $s=p\le4$ dá $y_{n+1}=R(z)y_n$, em que $R$ é o polinômio de Taylor de $e^z$ de grau $p$.

```text
método   R(z)                     intervalo real   intervalo imaginário
Euler    1 + z                    [-2, 0]          {0}
ordem 2  1 + z + z^2/2            [-2, 0]          {0}
RK4      1 + z + ... + z^4/24     [-2.785, 0]      [-2.828, 2.828]
```

O RK4 alcança um trecho do eixo imaginário, então, ao contrário de Euler, consegue rodar uma oscilação sem amortecimento com passo finito. Só que um método explícito tem $R$ polinomial, e um polinômio não constante é ilimitado, logo sua região de estabilidade é limitada. Métodos explícitos não podem ser estáveis para todo $h$ num problema stiff.

### Passo adaptativo: pares embutidos

Duas fórmulas de Runge-Kutta de ordens diferentes podem compartilhar estágios. O par de Bogacki-Shampine, usado pelo `RK23` do SciPy, tem

$$k_2=f(t+\tfrac h2,y+\tfrac h2k_1),\quad k_3=f(t+\tfrac{3h}4,y+\tfrac{3h}4k_2),\quad y_{n+1}=y+h\big(\tfrac29k_1+\tfrac13k_2+\tfrac49k_3\big),$$

e $k_4=f(t+h,y_{n+1})$. O resultado de terceira ordem $y_{n+1}$ e um de segunda ordem montado com $k_4$ diferem por $E=h\big(-\frac5{72}k_1+\frac1{12}k_2+\frac19k_3-\frac18k_4\big)$. Essa diferença estima o erro local da fórmula de segunda ordem, sem avaliação extra. Como $k_4$ é o $k_1$ do passo seguinte (propriedade FSAL, first same as last), cada passo tentado custa três avaliações, não quatro.

O controlador escala $E$ por $\text{sc}=\text{atol}+\text{rtol}\,\max(\lvert y\rvert,\lvert y_{n+1}\rvert)$, toma uma norma quadrática média $\epsilon$ de $E/\text{sc}$, aceita se $\epsilon<1$ e define

$$h_{\text{novo}}=h\cdot\min\big(10,\ \max(0{,}2,\ 0{,}9\,\epsilon^{-1/3})\big).$$

O expoente é $-1/(q+1)$ com $q=2$, a ordem menor. O SciPy mantém o resultado de ordem maior embora o erro se refira à menor, o que se chama extrapolação local. O `RK45` faz o mesmo com o par 5(4) de Dormand-Prince. A documentação é precisa sobre o que é limitado: "The solver keeps the local error estimates less than atol + rtol * abs(y)." Isso é uma estimativa por passo, não o erro da resposta final.

## Exemplos Resolvidos

### Exemplo 1: um passo de RK4 à mão

Volte a $y'=t-y$, $y(0)=1$, solução exata $y=t-1+2e^{-t}$, com $h=0{,}5$.

$$\begin{aligned} k_1&=f(0;\,1)=-1,\\ k_2&=f(0{,}25;\,1+0{,}25k_1)=f(0{,}25;\,0{,}75)=-0{,}5,\\ k_3&=f(0{,}25;\,1+0{,}25k_2)=f(0{,}25;\,0{,}875)=-0{,}625,\\ k_4&=f(0{,}5;\,1+0{,}5k_3)=f(0{,}5;\,0{,}6875)=-0{,}1875. \end{aligned}$$

Logo $y_1=1+\frac{0{,}5}{6}(-1-1-1{,}25-0{,}1875)=0{,}713542$, contra o exato $0{,}713061$, um erro de $4{,}8\times10^{-4}$. Euler com o mesmo passo deu $0{,}5$, um erro de $0{,}21$.

### Exemplo 2: medindo as ordens e o piso

Para $y'=y\cos t$, $y(0)=1$, erros em $t=2$ com $n$ passos, com a ordem medida entre parênteses:

```text
  n     Euler             ponto médio       trap. explícito   RK4
 10   1.482e-01         2.018e-03         1.970e-02         1.726e-05
 20   7.467e-02 (0.99)  6.303e-04 (1.68)  4.778e-03 (2.04)  1.057e-06 (4.03)
 40   3.746e-02 (1.00)  1.756e-04 (1.84)  1.174e-03 (2.03)  6.510e-08 (4.02)
 80   1.876e-02 (1.00)  4.630e-05 (1.92)  2.908e-04 (2.01)  4.034e-09 (4.01)
160   9.386e-03 (1.00)  1.189e-05 (1.96)  7.234e-05 (2.01)  2.510e-10 (4.01)
320   4.695e-03 (1.00)  3.011e-06 (1.98)  1.804e-05 (2.00)  1.565e-11 (4.00)
```

O ponto médio sobe devagar até 2, um lembrete de que ordem é um limite. Em float64, o RK4 chega a $4{,}4\times10^{-15}$ em $n=2560$ e depois oscila entre $5\times10^{-15}$ e $4\times10^{-14}$ até $n=81920$: o arredondamento assumiu. Em float32 o mesmo laço para de melhorar perto de $n=20$, em cerca de $10^{-6}$ fora quedas por sorte, e está em $9{,}8\times10^{-6}$ em $n=20480$.

### Exemplo 3: a comparação justa é por avaliação

O RK4 paga quatro avaliações por passo, então compare com orçamentos iguais. Em $y'=t-y$ com $t=2$:

```text
avaliações     Euler      ponto médio    RK4
      8       7.04e-02     3.45e-02    1.06e-02
     16       3.45e-02     6.89e-03    4.29e-04
     80       6.79e-03     2.34e-04    4.90e-07
    800       6.77e-04     2.26e-06    4.55e-11
```

Com 8 avaliações ($h=1$ no RK4) a vantagem é pequena. Com 800 são sete ordens de grandeza sobre Euler. Ordem maior compensa quando $h$ já está na faixa assintótica.

### Exemplo 4: uma órbita excêntrica contra `solve_ivp`

Uma órbita de excentricidade $0{,}9$ anda rápido perto do corpo central e devagar longe dele. Em unidades com $\mu=1$, $a=1$, comece na maior aproximação, $(x,y)=(0{,}1;\,0)$, $(v_x,v_y)=(0,\sqrt{19})$. Depois de $t=2\pi$ o estado deve voltar exatamente ao início, então o erro é a norma euclidiana da diferença. As avaliações são contadas por um wrapper em torno de $f$.

```text
método                         chamadas f   erro depois de uma órbita
RK4 fixo, n=2000                   8000       1.99e-02
RK4 fixo, n=10000                 40000       2.50e-05
RK4 fixo, n=100000               400000       2.38e-09
RK45 rtol=1e-3,  atol=1e-6          152       2.59e+00
RK45 rtol=1e-6,  atol=1e-9          524       1.89e-02
RK45 rtol=1e-8,  atol=1e-10         974       1.22e-04
RK45 rtol=1e-10, atol=1e-12        2204       7.01e-07
RK45 rtol=1e-12, atol=1e-14        5516       4.53e-09
RK23 rtol=1e-6,  atol=1e-9         1757       4.53e-03
RK23 rtol=1e-8,  atol=1e-10        7547       4.85e-05
```

Uma implementação do par de Bogacki-Shampine com o controlador do SciPy (incluindo o $\max$ na escala, a regra de passo inicial e a regra de não aumentar $h$ logo depois de uma rejeição) reproduz exatamente as duas linhas do `RK23`: 567 passos aceitos e 1757 avaliações na primeira tolerância, e estados finais a menos de $8\times10^{-11}$. A contagem fecha à mão: $3\cdot(567+18)$ tentativas mais 2 do início.

Para igualar a última linha do `RK45`, o RK4 fixo precisa de cerca de $n=85000$, ou 340000 avaliações (erro $4{,}4\times10^{-9}$), cerca de 60 vezes mais. Esse ganho junta ordem maior e adaptatividade. Com `rtol=1e-10`, 198 dos 365 passos caem nos $9{,}5\%$ do tempo mais próximos do corpo central, com mediana $h\approx1{,}8\times10^{-3}$ ali, cerca de $8\times10^{-4}$ bem na maior aproximação (os 41 passos com $r<0{,}11$) e mediana perto de $0{,}06$ em volta do lado oposto. Num problema sem esse contraste o ganho é modesto: para $y'=y\cos t$ até $t=20$, o `RK45` usa 1130 avaliações e o RK4 fixo usa 1704 para um erro perto de $6\times10^{-8}$.

A tabela traz dois alertas. As tolerâncias padrão dão erro final de $2{,}59$ num estado de tamanho cerca de 4, com status 0 e sem aviso. E `rtol` não é o erro final: `rtol=1e-8` termina com $1{,}2\times10^{-4}$, porque os erros locais se acumulam ao longo da órbita.

### Exemplo 5: stiffness com o trabalho contado

De volta a $y'=-1000(y-\cos t)-\sin t$, $y(0)=1$, cuja solução é $\cos t$. O RK4 fixo precisa de $h\le2{,}785/1000$:

```text
 n     z=h*lambda   chamadas f   erro em t=1
350      -2.857        1400       4.26e+11
355      -2.817        1420       8.13e+02
360      -2.778        1440       1.05e-04
1000     -1.000        4000       9.02e-09
```

O limite de Euler era $n=500$, ou 500 avaliações, com erro $4{,}6\times10^{-7}$. O método de ordem maior gasta 1440 avaliações só para ficar estável, e seu erro ali é maior, então a ordem maior não ajudou. Os resolvedores adaptativos mostram o mesmo. Com `rtol=1e-6, atol=1e-8` até $t=10$:

```text
método    chamadas f (contadas)   campo nfev   passos   fatorações LU   erro
RK23           17912               17912        3981         0         2.39e-07
RK45           21362               21362        3556         0         1.92e-07
Radau            280                 278          33        34         1.64e-08
BDF              258                 242         106        28         1.76e-08
```

O `RK23` se acomoda num passo médio de $0{,}00251$, que é o seu limite de estabilidade: seu $R(z)$ tem intervalo real $[-2{,}513;\,0]$. Quem encontra esse limite é o teste de erro, por rejeição: em $t\in[0,1]$ ele rejeita 199 passos contra 401 aceitos. Os resolvedores explícitos gastam avaliações em estabilidade, não em precisão. `Radau` e `BDF` são implícitos. O `Radau` usa 1/76 das avaliações do `RK45` e é cerca de dez vezes mais preciso aqui, mas os dois métodos implícitos pagam fatorações LU, que pesam em sistemas grandes. O campo `nfev` também deixa de fora as chamadas a $f$ do jacobiano por diferenças finitas, e é por isso que um wrapper de contagem discorda dele nesses dois.

## Equívocos Comuns e Armadilhas

- **"O RK4 é de quarta ordem para qualquer $f$."** Só com suavidade. Numa quina sua ordem ajustada foi cerca de 2, igual à de um método de dois estágios.
- **"Solução suave garante a ordem."** Em $y'=\sqrt{1-y^2}$ até $t=\pi/2$ a solução é $\sin t$, e o RK4 tem ordem 2.
- **"Runge-Kutta precisa de derivadas de $f$."** Precisa só de valores de $f$. O resultado de ordem é que exige $f$ suave.
- **"Cada estágio a mais soma uma ordem."** Vale até 4. A ordem 5 precisa de seis estágios.
- **"Compare métodos por passo."** O RK4 custa quatro vezes o que Euler custa por passo. Compare por avaliação.
- **"`rtol` é o erro da resposta."** Ele limita uma estimativa local. Na órbita, `rtol=1e-8` deu $1{,}2\times10^{-4}$.
- **"Os padrões bastam."** `rtol=1e-3` é um padrão, não um juízo sobre o problema: a órbita terminou com erro de $2{,}59$.
- **"Ordem maior cura stiffness."** O RK4 fixo precisou de 1440 avaliações onde Euler precisou de 500. Use um método implícito.
- **"`nfev` conta tudo."** Ele deixou de fora as avaliações do jacobiano em `Radau` e `BDF`.

## Resumo

Os métodos de Runge-Kutta amostram $f$ dentro do passo e combinam as inclinações para que a expansão de Taylor da atualização coincida com a da solução, sem derivadas de $f$. Dois estágios dão uma família de um parâmetro com ordem 2, e o RK4 satisfaz as oito condições da ordem 4 com quatro estágios. Depois da ordem 4, o número de estágios cresce mais rápido que a ordem. Em $y'=f(t)$ esses métodos se reduzem a regras de quadratura, o RK4 a Simpson. As ordens medidas de 1, 2 e 4 valem quando $f$ é suave, e caem para cerca de 2 numa quina e cerca de 1 num salto. Elas podem cair mesmo com solução suave, como em $y'=\sqrt{1-y^2}$ em $t=\pi/2$, onde $f_y$ é infinita. Métodos explícitos têm regiões de estabilidade limitadas, então a stiffness os limita qualquer que seja a ordem. Um par embutido estima o erro local a partir de estágios compartilhados e comanda o tamanho do passo, o que numa órbita excêntrica poupou um fator de cerca de 60 sobre o RK4 fixo. A tolerância limita uma estimativa local, então o erro final precisa ser conferido, e o trabalho se compara honestamente contando chamadas a $f$.

## Documentation Links

- [Fundamentals of Numerical Computation, 6.4 Runge-Kutta methods](https://fncbook.com/rk): dedução de métodos de dois estágios, tabelas, RK4 e eficiência por avaliação.
- [Fundamentals of Numerical Computation, 6.5 Adaptive Runge-Kutta](https://fncbook.com/adaptive-rk): previsão do tamanho do passo, fórmulas embutidas, Bogacki-Shampine e a propriedade first same as last.
- [MIT OCW 18.330, Chapter 5: Methods for ordinary differential equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/a9d2bd9be098f0ada172af40379a17cc_MIT18_330S12_Chapter5.pdf): métodos de Runge-Kutta, ordem e estabilidade linear.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): a interface do resolvedor, tolerâncias, métodos e o campo `nfev`.
- [SciPy, scipy.integrate.RK45](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html): o par 5(4) de Dormand-Prince e a extrapolação local.
- [SciPy, scipy.integrate.RK23](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK23.html): o par 3(2) de Bogacki-Shampine.
- [SciPy, scipy.integrate.Radau](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.Radau.html): o método implícito Radau IIA para problemas stiff.
