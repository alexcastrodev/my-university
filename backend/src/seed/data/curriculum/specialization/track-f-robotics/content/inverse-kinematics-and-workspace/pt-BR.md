---
version: 1.0
updatedAt: 2026-11-04
title: "Cinemática Inversa e Espaço de Trabalho"
summary: "Cinemática inversa geométrica e numérica, soluções múltiplas e espaço de trabalho alcançável versus destro."
---
## Objetivos de Aprendizagem

- Enunciar o problema da cinemática inversa e seus três desfechos possíveis: nenhuma solução, um número finito delas, infinitas.
- Resolver em forma fechada um braço planar de dois elos com `atan2`, obter as duas soluções de cotovelo e enunciar a condição de alcance.
- Rodar o método de Newton no mesmo braço, reconhecer a convergência quadrática e prever como ele falha quando o ponto inicial ou a solução está numa configuração singular.
- Distinguir o espaço de trabalho alcançável do espaço de trabalho destro, deduzir os dois para um braço planar de três elos e estimá-los por amostragem com gerador, semente e tamanho nomeados.

## Contexto e Motivação

`the-denavit-hartenberg-convention` transformou um braço numa tabela, e a tabela numa função: entram ângulos de junta, sai uma pose. A tarefa chega pelo caminho inverso. Uma câmera informa onde está a peça, e o controlador precisa de ângulos de junta que levem a garra até lá. Isso é cinemática inversa: dada uma posição ou pose desejada $\mathbf x_d$ do efetuador final, encontrar $\mathbf q$ com $f(\mathbf q)=\mathbf x_d$.

A cinemática direta sempre tem exatamente uma resposta. A inversa pode não ter nenhuma (o alvo está fora de alcance), ter várias (o cotovelo pode dobrar para um lado ou para o outro) ou infinitas (o braço tem mais juntas do que a tarefa exige). Alguns braços admitem fórmula. Para os demais há iteração, e a iteração é o método de Newton de `newtons-method`, agora em várias variáveis, com todos os seus modos de falha em versão robótica.

## Teoria Central

### O braço planar de dois elos

Tome elos de comprimentos $L_1$ e $L_2$ e ângulos medidos no sentido anti-horário, $\theta_1$ a partir do eixo $x$ e $\theta_2$ relativo ao elo 1. A ponta fica em

$$x=L_1c_1+L_2c_{12},\qquad y=L_1s_1+L_2s_{12},$$

com $c_{12}=\cos(\theta_1+\theta_2)$. Elevar ao quadrado e somar elimina $\theta_1$, pois $x^2+y^2=L_1^2+L_2^2+2L_1L_2c_2$. Assim

$$c_2=\frac{x^2+y^2-L_1^2-L_2^2}{2L_1L_2},\qquad \theta_2=\operatorname{atan2}\!\big(\pm\sqrt{1-c_2^2},\,c_2\big),$$

$$\theta_1=\operatorname{atan2}(y,x)-\operatorname{atan2}\!\big(L_2s_2,\;L_1+L_2c_2\big).$$

Existe solução exatamente quando $\lvert c_2\rvert\le1$, isto é, $\lvert L_1-L_2\rvert\le\sqrt{x^2+y^2}\le L_1+L_2$. No interior estrito desse anel há duas soluções, uma para cada sinal de $\theta_2$. Em cada círculo da borda há uma, com o braço esticado ($\theta_2=0$) ou dobrado ($\theta_2=\pi$). A exceção é $L_1=L_2$, em que o círculo interno se reduz à base e o braço dobrado a alcança com qualquer $\theta_1$. O `atan2` importa aqui: ele devolve o ângulo no quadrante certo em $(-\pi,\pi]$, o que $\arctan(y/x)$ não consegue.

Os nomes dos dois ramos variam. O Modern Robotics os chama de "lefty" e "righty" ou "elbow-up" e "elbow-down", e qual é qual depende de como se olha o braço. O sinal de $\theta_2$ não é ambíguo, então esta lição usa ele.

### Braços maiores

O mesmo padrão, desacoplar e usar geometria plana, dá forma fechada para muitas montagens industriais. Para um braço planar de três elos com orientação desejada $\phi$, subtraia o último elo para obter o ponto de punho $\mathbf w=\mathbf p-L_3(\cos\phi,\sin\phi)$ e resolva o problema de dois elos para $\mathbf w$. Braços de seis juntas cujos três últimos eixos se encontram num ponto se separam do mesmo jeito em um problema de posição e um de orientação. Para geometrias sem essa separação, o caminho usual é um método numérico.

### Método de Newton para cinemática inversa

Seja $\mathbf e(\mathbf q)=\mathbf x_d-f(\mathbf q)$ e seja $J(\mathbf q)=\partial f/\partial\mathbf q$ a matriz de derivadas parciais (montada em geral em `velocity-kinematics-and-the-jacobian`). Para o braço de dois elos,

$$J=\begin{pmatrix}-L_1s_1-L_2s_{12}&-L_2s_{12}\\ L_1c_1+L_2c_{12}&L_2c_{12}\end{pmatrix},\qquad \det J=L_1L_2\,s_2.$$

Linearizar $f$ em $\mathbf q_k$ e impor erro zero dá

$$J(\mathbf q_k)\,\Delta\mathbf q=\mathbf e(\mathbf q_k),\qquad \mathbf q_{k+1}=\mathbf q_k+\Delta\mathbf q.$$

É a iteração escalar de `newtons-method` com a divisão trocada por um sistema linear, como aquela lição antecipa. A teoria escalar se transfere: perto de uma solução em que $J$ é invertível, o erro é aproximadamente elevado ao quadrado a cada passo. Duas hipóteses podem falhar de um jeito próprio da robótica. O determinante se anula quando $s_2=0$, então partir com o braço esticado ou dobrado torna o passo indefinido. E se a própria solução tem $s_2=0$, o que acontece para todo alvo na borda do alcance, a raiz é degenerada, como a raiz dupla de `newtons-method`.

O Modern Robotics troca $J^{-1}$ pela pseudoinversa $J^\dagger$ quando $J$ não é quadrada ou não é invertível, e observa que a iteração tende a convergir para a solução mais próxima do chute inicial, cada solução com sua própria bacia de atração.

### Espaço de trabalho alcançável e destro

Murray, Li e Sastry definem o **espaço de trabalho alcançável** como o conjunto de posições que o efetuador atinge "at some orientation", e o **espaço de trabalho destro** ("dextrous workspace", na grafia deles) como o conjunto de posições atingidas "with arbitrary orientation". O segundo está contido no primeiro. Num braço planar, "orientação arbitrária" quer dizer qualquer direção $\phi$ no plano.

Para um braço planar de três elos com $L_1>L_2>L_3$ e $L_1>L_2+L_3$, o Exemplo 3.4 deles conclui que o espaço alcançável é o anel $L_1-L_2-L_3\le r\le L_1+L_2+L_3$ e que o destro é menor por $2L_3$ em cada borda. O motivo sai direto da redução ao ponto de punho: uma posição $\mathbf p$ serve para a direção $\phi$ exatamente quando $\mathbf p-L_3(\cos\phi,\sin\phi)$ cai no anel de dois elos $L_1-L_2\le r\le L_1+L_2$. Alcançável quer dizer que uma direção serve. Destro quer dizer que o círculo inteiro de raio $L_3$ em torno de $\mathbf p$ cabe nesse anel, o que dá $L_1-L_2+L_3\le r\le L_1+L_2-L_3$.

## Exemplos Resolvidos

Todos os comprimentos abaixo são supostos para ilustração: $L_1=1{,}0$ m, $L_2=0{,}6$ m e, no Exemplo 4, um terceiro elo $L_3=0{,}3$ m. Ângulos em graus, salvo indicação.

### Exemplo 1: as duas soluções de cotovelo em forma fechada

Alvo $(1{,}2;\ 0{,}5)$ m, a $1{,}3$ m da base, dentro do anel $[0{,}4;\ 1{,}6]$. Então $c_2=(1{,}44+0{,}25-1-0{,}36)/1{,}2=0{,}275$, e

```text
ramo       theta1      theta2      posição do cotovelo   erro na ponta
theta2>0   -3.7231     74.0380     (0.998, -0.065)       0
theta2<0   48.9628    -74.0380     (0.657,  0.754)       2.2e-16
```

As duas satisfazem a cinemática direta até o arredondamento. São imagens espelhadas em relação à reta que liga a base ao alvo: um cotovelo fica abaixo dessa reta, o outro acima. Qual delas o robô deve usar é decisão da tarefa (obstáculos, limites de junta, postura atual), não da cinemática.

### Exemplo 2: método de Newton, e qual solução ele encontra

Partindo de $\mathbf q_0=(0,30)$, as normas do erro $\lVert\mathbf e_k\rVert$ em metros são

$$3{,}8\times10^{-1},\ 3{,}7\times10^{-1},\ 3{,}9\times10^{-2},\ 1{,}1\times10^{-3},\ 7{,}5\times10^{-7},\ 4{,}6\times10^{-13},\ 1{,}1\times10^{-16},$$

e a execução chega à solução com $\theta_2>0$. O primeiro passo quase não ajuda, depois o expoente praticamente dobra, o padrão da convergência quadrática. Partindo de $\mathbf q_0=(40,-60)$ são quatro passos, $1{,}4\times10^{-1}$, $1{,}6\times10^{-2}$, $2{,}1\times10^{-4}$, $2{,}6\times10^{-8}$, $7{,}0\times10^{-16}$, até a solução com $\theta_2<0$. O ponto inicial escolheu o ramo.

### Exemplo 3: método de Newton perto de configurações singulares

**Partida sobre uma singularidade.** Partir da postura zero $(0,0)$, o braço esticado, dá $\det J=0$, e `numpy.linalg.solve` levanta `LinAlgError: Singular matrix` no primeiro passo. A postura zero é um chute inicial natural, o que torna essa falha comum.

**Partida ao lado de uma.** De $(0,\ 10^{-6}\text{ rad})$ o número de condição de $J$ é $4{,}9\times10^6$ e o primeiro passo é $\Delta\mathbf q=(-399999{,}5;\ 1066666{,}2)$ radianos. Depois a execução converge em mais cinco passos para ângulos de cerca de $-2{,}29\times10^7$ e $6{,}11\times10^7$ graus, que módulo $360$ são exatamente a solução com $\theta_2>0$. Mas o resíduo empaca em $6{,}0\times10^{-11}$ m em vez de $10^{-16}$: perto de $1{,}07\times10^6$ rad, doubles consecutivos estão a $2{,}3\times10^{-10}$ rad um do outro, então o próprio ângulo não pode ser guardado com mais precisão. Um controlador real também rejeitaria um comando de milhares de voltas.

**Solução sobre uma singularidade.** O alvo $1{,}6(\cos20^\circ,\sin20^\circ)$ está na borda externa, com solução única $(20,0)$, onde $\det J=0$. Partindo de $(10,30)$:

```text
k    theta1      theta2        |e| (m)     cond(J)    theta2_k/theta2_(k-1)
0    10.00000    30.0000000    6.0e-02     9.1e+00
1    14.29521    14.9948396    1.3e-02     1.9e+01    0.4998
2    17.18841     7.4858672    3.2e-03     3.7e+01    0.4992
5    19.64928     0.9352169    5.0e-05     3.0e+02    0.5000
10   19.98904     0.0292253    4.9e-08     9.5e+03    0.5000
23   20.00000     0.0000030    7.4e-16     9.2e+07    0.4399
```

O erro da junta cai pela metade a cada passo: convergência linear com razão $\tfrac12$, a mesma razão que `newtons-method` encontrou para uma raiz dupla em uma variável. O erro da tarefa cai por quatro a cada passo porque, com o braço esticado, a distância até a borda cresce com o quadrado de $\theta_2$. Isso também torna o resíduo enganoso: em $k=23$ a ponta está a $7{,}4\times10^{-16}$ m do alvo, enquanto $\theta_2$ ainda está a $5\times10^{-8}$ rad do valor verdadeiro.

**Alvo fora de alcance.** Para $1{,}7(\cos20^\circ,\sin20^\circ)$ não existe solução, e o menor erro possível é $0{,}1$ m. Em 30 iterações partindo de $(10,30)$, $\lVert\mathbf e\rVert$ pulou entre $0{,}100$ e $3{,}03$ m, e $\theta_2$ chegou a $7783$ graus em $k=13$. Nada na iteração avisa que o alvo é inviável. Conferir antes a condição de alcance, quando ela existe, sai mais barato.

Um remédio comum para as duas primeiras falhas troca o passo pelo de mínimos quadrados amortecidos, $J^T(JJ^T+\lambda^2I)^{-1}\mathbf e$, que fica finito mesmo com $J$ singular. Com $\lambda=0{,}1$ m ele chegou à solução com $\theta_2>0$ partindo exatamente de $(0,0)$ em 11 iterações, até $3{,}2\times10^{-13}$ m. `singularities-and-manipulability` volta a esse compromisso.

### Exemplo 4: espaço alcançável e destro por amostragem

Acrescente $L_3=0{,}3$ m. As hipóteses de Murray, Li e Sastry valem ($1{,}0>0{,}6>0{,}3$ e $1{,}0>0{,}9$), então as respostas exatas são os anéis $0{,}1\le r\le1{,}9$ (alcançável, área $3{,}6\pi=11{,}310$ m²) e $0{,}7\le r\le1{,}3$ (destro, área $1{,}2\pi=3{,}770$ m²).

**Amostrando as juntas.** Com `rng = numpy.random.default_rng(2026)` e `Q = rng.uniform(-pi, pi, (100_000, 3))`, os raios da ponta foram de $0{,}100011$ a $1{,}899999$ m, então os extremos aparecem. A densidade é outra história. Comparando a fatia de amostras de cada faixa radial com a fatia de área:

```text
faixa (m)        0.1-0.4   0.4-0.7   0.7-1.3   1.3-1.6   1.6-1.9
amostras/área    1.61      1.57      1.21      0.91      0.57
```

Ângulos de junta uniformes não dão posições uniformes. A faixa externa, onde o braço precisa estar quase reto, recebe 57 por cento da sua parte justa, então amostrar juntas é um jeito ruim de estimar áreas.

**Amostrando o plano.** Com um `numpy.random.default_rng(2026)` novo, sorteie 200.000 pontos uniformes no quadrado $[-2,2]^2$ (área 16 m²). Para cada ponto, teste 360 direções igualmente espaçadas: a direção serve se o ponto de punho cai no anel de dois elos $[0{,}4;\ 1{,}6]$. Um ponto é alcançável se alguma direção serve, e destro se as 360 servem.

```text
                pontos    área estimada (m^2)   exata    erro padrão   raios amostrados (m)
alcançável      141,102   11.288                11.310   0.016         0.10002 a 1.89996
destro           47,053    3.764                 3.770   0.015         0.70000 a 1.29999
```

As duas estimativas estão a menos de 1,5 erro padrão das áreas exatas. A grade de 360 direções só pode superestimar o conjunto destro, já que um ponto poderia falhar numa direção entre as linhas da grade, mas aqui os raios amostrados ficam dentro de $[0{,}7;\ 1{,}3]$. Ao longo do eixo $x$, a fração de direções que servem é $0{,}42$ em $r=0{,}2$, $0{,}70$ em $0{,}5$, $1{,}00$ em $1{,}0$, $0{,}58$ em $1{,}5$ e $0{,}25$ em $1{,}8$. Uma garra que precisa chegar por qualquer lado só tem a faixa do meio, um terço da área alcançável.

## Equívocos Comuns e Armadilhas

- **"A cinemática inversa tem uma resposta."** O Exemplo 1 tem duas, e as duas são exatas. Limites de junta e obstáculos escolhem entre elas.
- **"O método de Newton acha a solução mais próxima."** Muitas vezes acha, mas o Exemplo 3 partiu a $10^{-6}$ rad de uma postura e terminou a milhões de graus.
- **"A postura zero é um chute inicial seguro."** Neste braço ela é singular, e o solver para no primeiro passo.
- **"Resíduo minúsculo quer dizer juntas certas."** Na borda, o resíduo foi $7{,}4\times10^{-16}$ m com erro de junta de $5\times10^{-8}$ rad, e a convergência foi linear, não quadrática.
- **"Não convergir quer dizer chute ruim."** Pode querer dizer alvo inalcançável. Confira o alcance antes de iterar.
- **"O espaço alcançável é onde o robô consegue trabalhar."** Para uma tarefa que exige toda direção de aproximação, só o espaço destro conta, aqui um terço da área alcançável.
- **"Amostrar juntas uniformemente amostra o espaço de trabalho uniformemente."** A faixa externa recebeu 0,57 da sua parte.

## Resumo

A cinemática inversa pede valores de junta que produzam uma pose dada, e pode ter nenhuma, várias ou infinitas respostas. Para um braço de dois elos, a lei dos cossenos e o `atan2` dão as duas soluções de cotovelo sempre que $\lvert L_1-L_2\rvert\le r\le L_1+L_2$, e o desacoplamento pelo ponto de punho estende isso a muitos braços maiores. O método de Newton resolve $J\Delta\mathbf q=\mathbf e$ a cada passo, converge quadraticamente a partir de um bom ponto inicial e escolhe a solução pela bacia. Ele quebra em configurações singulares: partir esticado dá matriz singular, quase esticado dá um passo de $10^6$ rad, alvo na borda dá convergência linear com razão $\tfrac12$, e alvo inalcançável não converge. O espaço alcançável conta as posições atingidas com alguma orientação, o destro as atingidas com todas. Para comprimentos $1{,}0$, $0{,}6$ e $0{,}3$ m eles são os anéis $[0{,}1;\ 1{,}9]$ e $[0{,}7;\ 1{,}3]$, que a amostragem do plano com semente fixa reproduziu a menos de 0,2 por cento da área.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 2.5 define espaço da tarefa e espaço de trabalho, e o Capítulo 6 cobre a forma fechada de dois elos, a iteração de Newton-Raphson com pseudoinversa e as bacias de atração.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): o Capítulo 3, Seção 2.4, define os espaços alcançável e destro e resolve o Exemplo 3.4 para um braço planar de três elos.
- [MIT OpenCourseWare 2.12, Asada, Chapter 4: Planar Kinematics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter4/): cinemática inversa de braços planares, com as soluções de cotovelo para cima e para baixo.
- [NumPy, numpy.arctan2](https://numpy.org/doc/stable/reference/generated/numpy.arctan2.html): o arco tangente de quatro quadrantes e seu intervalo de saída.
- [NumPy, numpy.linalg.solve](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html): o sistema linear resolvido a cada passo de Newton, e o erro que ele levanta com matriz singular.
- [NumPy, random Generator](https://numpy.org/doc/stable/reference/random/generator.html): o `default_rng` e o amostrador `uniform` usados nas estimativas do espaço de trabalho.
