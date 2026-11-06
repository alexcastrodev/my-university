---
version: 1.0
updatedAt: 2026-11-04
title: "Cinemática Direta de Manipuladores Seriais"
summary: "A cinemática direta como produto das transformações dos elos, resolvida para braços planares de dois e de três elos e conferida numericamente."
---
## Objetivos de Aprendizagem

- Definir a cinemática direta como o mapa das coordenadas de junta para a pose do efetuador final, e dizer por que ela tem um único valor numa cadeia aberta, enquanto a inversa não tem.
- Escrever a cinemática direta de uma cadeia planar de juntas rotativas como produto de uma transformação por elo, e deduzir dela a forma fechada trigonométrica.
- Calcular a pose de um braço planar 2R e 3R e conferi-la de três jeitos: pelo produto das transformações dos elos, pela forma fechada e pela fórmula do produto de exponenciais.
- Mostrar com números que vetores de junta diferentes podem pôr a ponta da ferramenta no mesmo ponto, e que o espaço de trabalho do 2R é uma coroa circular.
- Reconhecer os erros comuns de implementação (graus tratados como radianos, ângulos absolutos no lugar de relativos, fatores do elo na ordem errada) e estimar quanto um erro de junta move a ponta.

## Contexto e Motivação

`homogeneous-transformations-for-robot-poses` compôs poses ao longo de uma cadeia de referenciais. Um manipulador serial é uma cadeia desse tipo em que a transformação de cada elo depende de uma única variável de junta. A cinemática direta avalia essa cadeia: dados os ângulos de junta lidos nos encoders, onde está a ferramenta e para onde ela aponta? É o primeiro mapa de que o controlador precisa, e as lições seguintes sobre cinemática inversa, jacobianos e dinâmica derivam ou invertem esse mapa.

Braços planares deixam a geometria visível, e cada passo é o mesmo que no espaço. Os referenciais dos elos aqui são posicionados à mão. `the-denavit-hartenberg-convention` troca isso por uma regra sistemática que funciona para braços espaciais.

## Teoria Central

### O mapa da cinemática direta

Para uma cadeia aberta de $n$ juntas com vetor de junta $\theta=(\theta_1,\dots,\theta_n)$, a cinemática direta é

$$\theta\mapsto T_{0e}(\theta)\in SE(3),$$

a pose do referencial do efetuador final $\{e\}$ no referencial da base $\{0\}$. O *Modern Robotics* observa que, numa cadeia aberta, essa pose é determinada de forma única pelas posições das juntas, enquanto uma pose dada pode vir de vários vetores de junta ou de nenhum. Cada junta define um movimento relativo, e a cadeia os multiplica em ordem, então o mapa é um produto e não exige resolver nada.

### Transformações dos elos numa cadeia planar rotativa

Ponha o referencial $\{0\}$ na junta 1 e o referencial $\{i\}$ na ponta do elo $i$, com $\hat x_i$ ao longo do elo. Todos os eixos $\hat z$ apontam para fora do plano. A junta $i$ gira $\theta_i$ em torno de $\hat z$, e depois o elo $i$ leva o próximo referencial a uma distância $L_i$ ao longo do novo $\hat x$:

$$T_{i-1,i}(\theta_i)=\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)=\begin{pmatrix}\cos\theta_i&-\sin\theta_i&0&L_i\cos\theta_i\\\sin\theta_i&\cos\theta_i&0&L_i\sin\theta_i\\0&0&1&0\\0&0&0&1\end{pmatrix},$$

$$T_{0e}=T_{01}(\theta_1)\,T_{12}(\theta_2)\cdots T_{n-1,n}(\theta_n),\qquad\{e\}=\{n\}.$$

Cada $\theta_i$ é relativo: o ângulo do elo $i$ medido a partir do elo $i-1$. Multiplicando, as rotações se somam e o vetor de cada elo é girado pela soma dos ângulos anteriores. Com $\phi_i=\theta_1+\dots+\theta_i$,

$$x=\sum_{i=1}^{n}L_i\cos\phi_i,\qquad y=\sum_{i=1}^{n}L_i\sin\phi_i,\qquad\phi=\phi_n=\sum_{i=1}^{n}\theta_i.$$

Para $n=3$ essas são as equações das notas de Asada do MIT 2.12 e do Capítulo 4 do *Modern Robotics*. O *Modern Robotics* põe os referenciais dos elos nas juntas, $T_{01}=\operatorname{Rot}_z(\theta_1)$, $T_{12}=\operatorname{Trans}_x(L_1)\operatorname{Rot}_z(\theta_2)$ e assim por diante, com um $T_{3e}=\operatorname{Trans}_x(L_3)$ constante. Pela associatividade é o mesmo produto reagrupado, então a pose do efetuador final é idêntica, enquanto os referenciais intermediários ficam em outros lugares.

### Uma segunda fórmula como conferência

O *Modern Robotics* também escreve a cinemática direta como produto de exponenciais (PoE):

$$T_{0e}(\theta)=e^{[\mathcal S_1]\theta_1}e^{[\mathcal S_2]\theta_2}\cdots e^{[\mathcal S_n]\theta_n}M,$$

em que $M$ é a pose do efetuador final com todas as juntas em zero e $\mathcal S_i$ é o eixo de parafuso (screw axis) da junta $i$ no referencial da base, nessa configuração zero. Na cadeia planar, $M$ é uma translação pura de $L_1+\dots+L_n$ ao longo de $\hat x$, e a junta $i$ é uma rotação em torno de $\hat z$ passando pelo ponto $(L_1+\dots+L_{i-1},0,0)$, então $\mathcal S_i=(0,0,1,\,0,-(L_1+\dots+L_{i-1}),\,0)$. A dedução é assunto daquele livro; aqui ela serve como fórmula independente, avaliada com `scipy.linalg.expm`, que tem de concordar com o produto dos elos.

### O que o mapa não diz

O mapa é muitos-para-um na posição. Para um braço 2R, a distância da base até a ponta é

$$r^2=L_1^2+L_2^2+2L_1L_2\cos\theta_2,$$

que depende só de $\theta_2$. Então $\theta_2$ e $-\theta_2$ alcançam o mesmo raio, e girar $\theta_1$ põe os dois no mesmo ponto: cotovelo para cima e cotovelo para baixo. As posições alcançáveis da ponta formam a coroa circular $\lvert L_1-L_2\rvert\le r\le L_1+L_2$. Um braço planar 3R tem 3 juntas para uma posição bidimensional, então é redundante para posição: uma família a um parâmetro de vetores de junta, um para cada ângulo de ferramenta viável, põe a ponta no mesmo ponto.

O mapa também amplifica erros de junta. Girar a junta $i$ de um $\delta$ pequeno faz tudo o que vem depois girar em torno dela, então a ponta anda cerca de $d_i\,\delta$, em que $d_i$ é a distância da junta $i$ até a ponta. Num braço estendido, as juntas perto da base têm os maiores braços de alavanca; quando o braço se dobra para trás, isso pode mudar. Esta é a primeira visão do jacobiano, que `velocity-kinematics-and-the-jacobian` constrói direito.

## Exemplos Resolvidos

Os comprimentos dos elos são valores supostos, em metros; os ângulos estão em graus no texto e são convertidos para radianos antes de qualquer chamada trigonométrica.

### Exemplo 1: um braço 2R, de três jeitos

$L=(1{,}0;\ 0{,}8)$, $\theta=(30°,45°)$. O script imprime cada referencial da cadeia:

```text
frame 0 (base)    x = 0.0000   y = 0.0000   heading  0.0
frame 1 (elbow)   x = 0.8660   y = 0.5000   heading 30.0
frame 2 (tip)     x = 1.0731   y = 1.2727   heading 75.0
```

$$T_{0e}=\begin{pmatrix}0{,}2588&-0{,}9659&0&1{,}0731\\0{,}9659&0{,}2588&0&1{,}2727\\0&0&1&0\\0&0&0&1\end{pmatrix}.$$

Pela forma fechada, $x=\cos30°+0{,}8\cos75°=0{,}8660+0{,}2071=1{,}0731$ e $y=\sin30°+0{,}8\sin75°=0{,}5+0{,}7727=1{,}2727$, com orientação $75°$. O produto dos elos e a forma fechada diferem em $0$ em float64, o agrupamento do *Modern Robotics* em $0$, e a fórmula PoE em $2{,}2\times10^{-16}$. O alcance é $r=1{,}6647$, e $\sqrt{1+0{,}64+1{,}6\cos45°}$ dá o mesmo.

### Exemplo 2: dois vetores de junta, um ponto da ponta

A configuração espelhada tem $\theta_2'=-45°$ e $\theta_1'=\theta_1+2\operatorname{atan2}(L_2\sin\theta_2,\,L_1+L_2\cos\theta_2)=69{,}73°$. Cinemática direta de $(69{,}73°;\ -45°)$:

```text
configuration         elbow position       tip position        heading
(30.00, 45.00)        (0.8660, 0.5000)     (1.0731, 1.2727)    75.00
(69.73, -45.00)       (0.3464, 0.9381)     (1.0731, 1.2727)    24.73
```

Mesma ponta, cotovelo diferente, orientação da ferramenta diferente. Se a tarefa especifica só a posição da ponta, as duas servem; se especifica também a orientação, no máximo uma serve. Escolher entre soluções assim é o assunto de `inverse-kinematics-and-workspace`.

### Exemplo 3: um braço 3R

Acrescente um terceiro elo curto: $L=(1{,}0;\ 0{,}8;\ 0{,}3)$, $\theta=(30°,45°,-60°)$.

```text
frame 0 (base)    x = 0.0000   y = 0.0000   heading  0.0
frame 1           x = 0.8660   y = 0.5000   heading 30.0
frame 2 (wrist)   x = 1.0731   y = 1.2727   heading 75.0
frame 3 (tip)     x = 1.3629   y = 1.3504   heading 15.0
```

$$T_{0e}=\begin{pmatrix}0{,}9659&-0{,}2588&0&1{,}3629\\0{,}2588&0{,}9659&0&1{,}3504\\0&0&1&0\\0&0&0&1\end{pmatrix}.$$

Os dois primeiros referenciais são os do Exemplo 1, como precisam ser: o elo 3 não afeta o que vem antes dele. A forma fechada concorda até $0$, o agrupamento do *Modern Robotics* até $0$, e o PoE até $4{,}4\times10^{-16}$.

Agora a redundância. As configurações abaixo foram obtidas resolvendo para uma orientação de ferramenta escolhida, na mesma ponta; a cinemática direta confirma cada uma:

```text
heading asked   joint angles (deg)               tip from forward kinematics   heading
 15             ( 30.00, 45.00, -60.00)          (1.3629, 1.3504)              15.00
  0             ( 36.37, 34.84, -71.21)          (1.3629, 1.3504)               0.00
 60             ( 19.76, 50.38, -10.14)          (1.3629, 1.3504)              60.00
-45             none: the wrist point is out of reach
```

Com orientação $-45°$, o punho teria de ficar 0,3 m para trás nessa direção, a 1,9405 m da base, além de $L_1+L_2=1{,}8$, então não existe vetor de junta. A redundância dá escolhas, não escolhas ilimitadas.

### Exemplo 4: concordância em muitas configurações

Um exemplo só pode concordar por sorte. Sorteie 1000 vetores de junta para o braço 3R com `numpy.random.default_rng(42).uniform(-pi, pi, (1000, 3))`:

```text
max |link product - closed form| (position)   6.7e-16
max |link product - PoE|  (all 16 entries)    7.4e-15
max |link product - Modern Robotics grouping| 0.0
```

As diferenças são arredondamento, então as três fórmulas calculam o mesmo mapa.

### Exemplo 5: espaço de trabalho, sensibilidade e três bugs clássicos

**Espaço de trabalho.** Para o braço 2R, 20.000 pares de juntas de `numpy.random.default_rng(0).uniform(-pi, pi, (20000, 2))` deram distâncias da ponta de $0{,}2000001$ a $1{,}7999999998$, contra a coroa $[0{,}2;\ 1{,}8]$. Diretamente, $\theta_2=0°$, $90°$ e $180°$ dão $r=1{,}8000$, $1{,}2806$ e $0{,}2000$.

**Sensibilidade.** Some $0{,}1°$ a uma junta e recalcule:

```text
arm   joint perturbed   tip displacement   distance joint-to-tip x 0.1 deg
2R    joint 1           2.906 mm           1.6647 m x 0.001745 = 2.906 mm
2R    joint 2           1.396 mm           0.8 m    x 0.001745 = 1.396 mm
3R    joint 1           3.349 mm           1.9186 m x 0.001745 = 3.349 mm
3R    joint 3           0.524 mm           0.3 m    x 0.001745 = 0.524 mm
```

Nessas configurações, o mesmo erro custou 2,1 vezes mais na base do que na última junta no braço 2R, e 6,4 vezes mais no braço 3R.

**Bugs.** Os três rodam sem mensagem de erro, e os três estão errados para o braço 2R do Exemplo 1, cuja ponta correta é $(1{,}0731;\ 1{,}2727)$:

```text
bug                                                tip                 heading
degrees passed to cos/sin as radians               (0.8917, -1.2983)
theta_2 used as an absolute angle                  (1.4317,  1.0657)
per-link order Trans_x(L) Rot_z(theta) instead     (1.6928,  0.4000)   75.0
```

O terceiro mantém a orientação correta, porque as rotações continuam somando $75°$, então uma conferência só da orientação da ferramenta o deixaria passar. Conferir a posição do cotovelo contra a forma fechada pega os três.

## Equívocos Comuns e Armadilhas

- **"Cinemática direta exige resolver equações."** É um produto de matrizes conhecidas; só o problema inverso exige resolver.
- **"A posição da ponta determina os ângulos de junta."** O Exemplo 2 achou duas configurações para uma ponta do 2R, e o Exemplo 3 achou três para uma ponta do 3R.
- **"Ângulos de junta são os ângulos dos elos."** São ângulos relativos; o ângulo do elo é a soma acumulada $\phi_i$. Usar $\theta_2$ como absoluto deslocou a ponta em 0,41 m no Exemplo 5.
- **"A ordem dos dois fatores dentro de um elo não importa."** $\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)$ e $\operatorname{Trans}_x(L_i)\operatorname{Rot}_z(\theta_i)$ dão posições diferentes com a mesma orientação.
- **"Onde ficam os referenciais intermediários muda a resposta."** O Exemplo 4 mostrou duas posições de referenciais produzindo a mesma pose do efetuador até 0,0; só o produto importa.
- **"Todo erro de junta pesa igual."** Exemplo 5: os mesmos $0{,}1°$ moveram a ponta 3,35 mm na junta 1 e 0,52 mm na junta 3.

## Resumo

A cinemática direta leva coordenadas de junta à pose do efetuador final e, numa cadeia aberta, é um produto de uma transformação por elo, $T_{0e}=\prod_i\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)$ para um braço planar rotativo. Multiplicando, sai $x=\sum L_i\cos\phi_i$, $y=\sum L_i\sin\phi_i$, $\phi=\sum\theta_i$, com os $\theta_i$ relativos. Para um 2R em $(30°,45°)$ com comprimentos $(1{,}0;\ 0{,}8)$ a ponta fica em $(1{,}0731;\ 1{,}2727)$; o produto dos elos, a forma fechada e a fórmula do produto de exponenciais concordaram até o arredondamento ali e em 1000 configurações 3R aleatórias. O mapa é muitos-para-um: cotovelo para cima e para baixo compartilham uma ponta do 2R, um 3R alcança um ponto com várias orientações, e o espaço de trabalho do 2R é a coroa $\lvert L_1-L_2\rvert\le r\le L_1+L_2$. Um erro de junta move a ponta em cerca do braço de alavanca vezes o erro, então, num braço estendido, as juntas da base pesam mais.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): o livro-texto gratuito e os vídeos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): o Capítulo 4 sobre cinemática direta de cadeias abertas, o exemplo planar 3R como produto de transformações dos elos e a fórmula do produto de exponenciais.
- [MIT OCW 2.12, Chapter 4 Planar Kinematics (Asada)](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/c8828a16e71c246b78461dd0596b983f_chapter4.pdf): as equações cinemáticas de um braço planar de três graus de liberdade, com ângulos de junta relativos.
- [SciPy, scipy.linalg.expm](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html): a exponencial de matriz usada para avaliar a conferência pelo produto de exponenciais.
