---
version: 1.0
updatedAt: 2026-11-04
title: "Planejamento de Trajetórias no Espaço de Juntas"
summary: "Trajetórias no espaço de juntas com polinômios cúbicos e quínticos, perfis trapezoidais de velocidade e pontos de passagem."
---
## Objetivos de Aprendizagem

- Separar uma trajetória em caminho e escalonamento no tempo, e dizer o que uma reta no espaço de juntas dá e não dá no espaço de tarefa.
- Resolver os polinômios cúbico e quíntico para as condições de contorno e calcular os picos de velocidade, aceleração e jerk.
- Montar um perfil trapezoidal de velocidade, enunciar sua condição de viabilidade e achar o tempo mínimo sob limites de velocidade e aceleração.
- Sincronizar várias juntas para que a mais lenta defina a duração.
- Comparar métodos de pontos de passagem pela continuidade que dão, e reconhecer um ponto não atingido ou um overshoot.

## Contexto e Motivação

A cinemática inversa entrega configurações, não movimento. *Modern Robotics* (Lynch e Park, capítulo 9) abre com isso: durante o movimento, o controlador recebe um fluxo contínuo de posições e velocidades desejadas para seguir. A trajetória é esse fluxo, e a rapidez dela define os torques. `the-manipulator-equation-inertia-coriolis-gravity` mostrou que reduzir pela metade a duração de um movimento multiplicou por 4 os torques de inércia e de velocidade, sem mudar a gravidade.

Aqui se trabalha no espaço de juntas: cada junta recebe uma função do tempo, que um controlador como o de `independent-joint-control-and-pid` segue. *Modern Robotics* contrapõe isso às retas no espaço de tarefa. No espaço de juntas, limites da forma $\theta_{i,\min}\le\theta_i\le\theta_{i,\max}$ formam um conjunto convexo, então a reta entre duas configurações permitidas continua permitida. Uma reta no espaço de tarefa pode passar perto de uma singularidade cinemática, onde as velocidades das juntas ficam muito grandes, ou sair do espaço de trabalho entre dois extremos alcançáveis. O preço do espaço de juntas é que a ferramenta não anda em linha reta, o que o Exemplo 5 mede.

Os números abaixo são de uma junta e de limites supostos, em graus e segundos.

## Teoria Central

### Caminho e escalonamento no tempo

*Modern Robotics* escreve uma trajetória como um caminho $\theta(s)$ com $s\in[0,1]$ e um escalonamento no tempo $s(t)$ com $t\in[0,T]$. Para a reta no espaço de juntas,

$$q(t)=q_0+s(t)\,D,\qquad \dot q=\dot s\,D,\qquad \ddot q=\ddot s\,D,\qquad D=q_f-q_0.$$

Se todas as juntas usam o mesmo $s(t)$, elas começam e param juntas e a configuração fica sobre o segmento de reta entre $q_0$ e $q_f$.

### Polinômios cúbicos

Um cúbico $q(t)=c_0+c_1t+c_2t^2+c_3t^3$ tem quatro coeficientes, o bastante para posição e velocidade nas duas pontas: $q(0)=q_0$, $\dot q(0)=v_0$, $q(T)=q_f$, $\dot q(T)=v_f$. Resolvendo as quatro equações lineares (com SymPy):

$$c_0=q_0,\quad c_1=v_0,\quad c_2=\frac{3D-(2v_0+v_f)T}{T^2},\quad c_3=\frac{-2D+(v_0+v_f)T}{T^3}.$$

Isso bate com as equações (9.26) a (9.29) de *Modern Robotics*. Do repouso ao repouso ($v_0=v_f=0$), fica $s(\tau)=3\tau^2-2\tau^3$ com $\tau=t/T$, e

$$\dot q_{\max}=\frac{3D}{2T}\ \text{em}\ t=\tfrac T2,\qquad \ddot q(0)=\frac{6D}{T^2},\qquad \ddot q(T)=-\frac{6D}{T^2},\qquad \dddot q=-\frac{12D}{T^3}.$$

A aceleração é máxima nas pontas, onde a junta estava parada um instante antes: ela salta de $0$ para $6D/T^2$, o jerk é infinito ali e, segundo *Modern Robotics*, isso pode causar vibração.

### Polinômios quínticos

Seis coeficientes permitem fixar também as acelerações nas pontas, $\ddot q(0)=a_0$ e $\ddot q(T)=a_f$. A solução mantém $c_0=q_0$, $c_1=v_0$, $c_2=a_0/2$ e

$$\begin{aligned}
c_3&=\frac{20D-(8v_f+12v_0)T-(3a_0-a_f)T^2}{2T^3},\\
c_4&=\frac{-30D+(14v_f+16v_0)T+(3a_0-2a_f)T^2}{2T^4},\\
c_5&=\frac{12D-6(v_f+v_0)T-(a_0-a_f)T^2}{2T^5}.
\end{aligned}$$

Do repouso ao repouso com acelerações nulas nas pontas, $s(\tau)=10\tau^3-15\tau^4+6\tau^5$, e

$$\dot q_{\max}=\frac{15D}{8T},\qquad \lvert\ddot q\rvert_{\max}=\frac{10D}{\sqrt3\,T^2}\ \text{em}\ \tau=\tfrac{3\mp\sqrt3}{6},\qquad \dddot q(0)=\frac{60D}{T^3}.$$

Agora a aceleração começa em zero, então é contínua nas pontas. O jerk ainda salta ali, de $0$ para $60D/T^3$, mas é finito. O custo é um pico de velocidade $25\%$ maior que o do cúbico. As duas fórmulas fechadas batem com as funções `CubicTimeScaling` e `QuinticTimeScaling` da biblioteca de código de *Modern Robotics* ($s=0{,}216$ e $0{,}16308$ em $t=0{,}6$, $T=2$).

### Perfis trapezoidais de velocidade

O trapézio acelera com $a$ constante durante um tempo de transição $t_b$, segue em cruzeiro com $v=a\,t_b$ e desacelera com $-a$ no último $t_b$. A posição é parábola, reta e parábola, daí o nome antigo "linear segment with parabolic blends" (LSPB). A distância percorrida é $v\,(T-t_b)$, então, para $D>0$, $T$ e $a$ dados,

$$t_b=\frac T2-\frac{\sqrt{a^2T^2-4aD}}{2a},\qquad v=a\,t_b.$$

**Viabilidade.** A raiz é real só se

$$a\ge\frac{4D}{T^2}.$$

Na igualdade, $t_b=T/2$, o trecho de cruzeiro some e o perfil é um triângulo com pico de velocidade $2D/T$. Com menos aceleração, nenhum perfil dessa família cobre $D$ no tempo $T$. A velocidade de cruzeiro fica sempre na janela $D/T<v\le2D/T$. Na forma normalizada de *Modern Robotics*, com $D=1$, isso vira $aT^2\ge4$ e $1<vT\le2$.

**Tempo mínimo.** Dados limites $v$ e $a$, o trapézio só atinge $v$ se $v^2/a\le D$, e então

$$T=\frac Dv+\frac va.$$

Caso contrário, o perfil é um triângulo que nunca chega a $v$, com $T=2\sqrt{D/a}$. *Modern Robotics* observa que, com limites constantes de velocidade e aceleração, o trapézio que usa os maiores $v$ e $a$ permitidos é o movimento retilíneo mais rápido. A aceleração dele salta quatro vezes, em $0$, $t_b$, $T-t_b$ e $T$. O perfil em S acrescenta fases de jerk constante para eliminar esses saltos.

### Várias juntas

Numa reta no espaço de juntas, a junta $i$ percorre $D_i$ com $\dot q_i=\dot s\,D_i$ e $\ddot q_i=\ddot s\,D_i$. Os limites de $s$ são então

$$\dot s_{\max}=\min_i\frac{v_i}{\lvert D_i\rvert},\qquad \ddot s_{\max}=\min_i\frac{a_i}{\lvert D_i\rvert},$$

e a duração é a de um trapézio unitário com esses limites. A junta mais lenta em relação à própria distância define $T$, e as outras são desaceleradas para chegar junto.

### Pontos de passagem

Muitas tarefas fixam configurações intermediárias em instantes dados. Os métodos comuns diferem no que é contínuo onde os segmentos se encontram:

| Método | Passa pelos pontos | Contínuo nos pontos | Na partida e na chegada em repouso |
|---|---|---|---|
| Segmentos cúbicos com velocidades escolhidas | sim | velocidade | aceleração salta |
| Spline cúbica (velocidades resolvidas) | sim | aceleração | aceleração salta |
| Segmentos quínticos com velocidades e acelerações escolhidas | sim | aceleração | aceleração pode ser 0 |
| Parar em cada ponto | sim | velocidade, que é 0 | aceleração salta |
| Segmentos retos com transições parabólicas | não, passa perto | velocidade | aceleração salta |

*Modern Robotics* apresenta a primeira linha e a generalização para quínticos, e observa que uma velocidade não especificada pode ser escolhida por uma heurística a partir dos pontos vizinhos. A linha da spline é a spline com derivadas fixas de `splines`: com velocidades nulas nas pontas, a curva inteira sai de um sistema tridiagonal, e as acelerações nas pontas ficam as que ele der. Na linha das transições, a parábola substitui o canto, então a junta nunca chega ao ponto; o Robotics Toolbox documenta isso na função `mstraj` ("the via point is not actually reached").

**Livro vs hoje.** O Robotics Toolbox for Python agora chama o trapézio de `trapezoidal` e marca o antigo `lspb` como obsoleto. No ROS 2, o joint trajectory controller do `ros2_control` (documentação da distribuição Lyrical, 2026) escolhe a interpolação pelo que cada waypoint traz: linear se só há posições (posição contínua, desaconselhado), cúbica se há velocidades (velocidade contínua), quíntica se há também acelerações (aceleração contínua).

## Exemplos Resolvidos

### Exemplo 1: uma junta, três perfis

Uma junta vai de $0^\circ$ a $90^\circ$ em $T=2$ s. O cúbico é $q=67{,}5t^2-22{,}5t^3$, o quíntico $q=112{,}5t^3-84{,}375t^4+16{,}875t^5$, e o trapézio usa $a=180\ ^\circ/\text{s}^2$, o que dá $t_b=0{,}2929$ s e $v=52{,}72\ ^\circ/\text{s}$. Amostras do script, em graus e segundos:

```text
  t   | cubic: q    qd     qdd   | quintic: q   qd     qdd   | trapezoid: q  qd     qdd
0.00  |   0.00   0.00  135.00    |   0.00   0.00     0.00    |   0.00   0.00  180.00
0.25  |   3.87  29.53  101.25    |   1.44  16.15   110.74    |   5.62  45.00  180.00
0.50  |  14.06  50.62   67.50    |   9.32  47.46   126.56    |  18.64  52.72    0.00
0.75  |  28.48  63.28   33.75    |  24.77  74.16    79.10    |  31.82  52.72    0.00
1.00  |  45.00  67.50    0.00    |  45.00  84.38     0.00    |  45.00  52.72    0.00
1.25  |  61.52  63.28  -33.75    |  65.23  74.16   -79.10    |  58.18  52.72    0.00
1.50  |  75.94  50.62  -67.50    |  80.68  47.46  -126.56    |  71.36  52.72    0.00
1.75  |  86.13  29.53 -101.25    |  88.56  16.15  -110.74    |  84.38  45.00 -180.00
2.00  |  90.00   0.00 -135.00    |  90.00   0.00     0.00    |  90.00   0.00 -180.00
```

Numa grade de 200001 pontos, o cúbico tem picos de $67{,}5\ ^\circ/\text{s}$ e $135\ ^\circ/\text{s}^2$, o quíntico de $84{,}375\ ^\circ/\text{s}$ e $129{,}90\ ^\circ/\text{s}^2$ (em $t=0{,}423$ e $1{,}577$ s, entre as linhas da tabela), e o trapézio de $52{,}72\ ^\circ/\text{s}$ e $180\ ^\circ/\text{s}^2$. O trapézio tem a menor velocidade e a maior aceleração; o quíntico, o contrário. O jerk do quíntico vai de $-337{,}5$ a $675\ ^\circ/\text{s}^3$; o do cúbico é $-135$ no meio, mais os saltos de aceleração nas pontas.

### Exemplo 2: viabilidade e tempo mínimo

Mesma junta e mesma distância, com limites supostos $\lvert\dot q\rvert\le90\ ^\circ/\text{s}$ e $\lvert\ddot q\rvert\le180\ ^\circ/\text{s}^2$.

Para $T=2$ s, o trapézio precisa de $a\ge4\cdot90/2^2=90\ ^\circ/\text{s}^2$:

```text
a (deg/s^2)   t_b (s)   v (deg/s)   note
 60           -         -           infeasible: 60 < 90
 90           1.0000    90.00       triangle, v = 2D/T
101.25        0.6667    67.50       v = 1.5 D/T
180           0.2929    52.72
360           0.1340    48.23       v tends to D/T = 45
```

A linha $v=1{,}5\,D/T$ é o padrão do `trapezoidal_func` do Robotics Toolbox; o exemplo documentado (de 1 a 2 em 5 s, $t_b=1{,}667$ s, aceleração $0{,}18$) bate com a fórmula.

A duração mínima de cada perfil, com o limite que a determina:

```text
profile     T_min (s)   binding limit   peak qd   peak |qdd|
cubic       1.7321      acceleration    77.94     180.00
quintic     1.8750      velocity        90.00     147.80
trapezoid   1.5000      both            90.00     180.00
```

O trapézio tem $v^2/a=45\le90$, então entra em cruzeiro, com $t_b=0{,}5$ s. Sem o limite de velocidade, o triângulo levaria $2\sqrt{90/180}=1{,}414$ s, mas chegaria a $127{,}3\ ^\circ/\text{s}$. O cúbico em $T=1{,}5$ s precisaria de $240\ ^\circ/\text{s}^2$, acima do limite.

### Exemplo 3: três juntas, uma duração

As juntas percorrem $D=(90,-45,30)^\circ$ com limites supostos $v=(90,60,120)\ ^\circ/\text{s}$ e $a=(180,90,240)\ ^\circ/\text{s}^2$. Sozinhas, terminariam em $1{,}5$, $1{,}417$ e $0{,}707$ s (a junta 3 como triângulo). Juntas, $\dot s_{\max}=\min(1;\,1{,}333;\,4)=1\ \text{s}^{-1}$ e $\ddot s_{\max}=\min(2;\,2;\,8)=2\ \text{s}^{-2}$, então $T=1+0{,}5=1{,}5$ s. Os picos são $(90,-45,30)\ ^\circ/\text{s}$ e $(180,-90,60)\ ^\circ/\text{s}^2$: a junta 1 está nos dois limites, a junta 2 no limite de aceleração, a junta 3 bem abaixo dos dois.

### Exemplo 4: quatro pontos de passagem, seis métodos

Uma junta passa por $0,30,70,60^\circ$ em $t=0,1,2,3$ s, partindo e chegando em repouso. As inclinações dos segmentos são $30$, $40$ e $-10\ ^\circ/\text{s}$. A regra de velocidade usada aqui (uma heurística simples, não a única) toma a média das duas inclinações vizinhas quando têm o mesmo sinal e zero quando a junta inverte, o que dá $35$ em $t=1$ e $0$ em $t=2$.

Com essas velocidades, o primeiro segmento cúbico é $q=55t^2-25t^3$: em $t=1$ ele dá $30^\circ$, $35\ ^\circ/\text{s}$ e aceleração $110-150=-40\ ^\circ/\text{s}^2$, enquanto o segmento seguinte começa em $+100$. A spline com derivadas fixas tem os trechos $40t^2-10t^3$, $30+50t+10t^2-20t^3$ e $70+10t-50t^2+30t^3$, com tempo local em cada um, e o `CubicSpline` do SciPy com `bc_type=((1, 0.0), (1, 0.0))` concorda com eles até $3\times10^{-14}$. C e D são segmentos quínticos; D usa as velocidades e acelerações da spline nos pontos e zera as acelerações das pontas. O método F usa segmentos retos com transições parabólicas de meia-largura $t_b=0{,}2$ s centradas em cada ponto, então começa em $t=-0{,}2$ e termina em $t=3{,}2$.

```text
method                              q at t=1,2     qd at t=1,2   qdd jump at t=1   qdd jump at t=2   qdd at start   peak |qd|   peak |qdd|
A cubic, rule velocities            30, 70         35, 0         -40 -> 100        -170 -> -60       110            53.5        170.0
B clamped cubic spline              30, 70         50, 10        none (20)         none (-100)       80             51.7        100.0
C quintic, rule velocities, qdd 0   30, 70         35, 0         none (0)          none (0)          0              61.7        166.4
D quintic, spline values            30, 70         50, 10        none (20)         none (-100)       0              51.7        101.0
E cubic, stop at every via          30, 70         0, 0          -180 -> 240       -240 -> -60       180            60.0        240.0
F lines with parabolic blends       30.5, 67.5     35, 15        blend: 25         blend: -125       75             40.0        125.0
```

A spline (B) é suave por dentro, mas passa dos dados: a velocidade dela em $t=2$ é $+10\ ^\circ/\text{s}$, então a junta continua subindo até $70{,}535^\circ$ em $t=2{,}111$ antes de voltar, enquanto A, com velocidade zero na inversão, nunca passa de $70^\circ$. C compra aceleração contínua forçando-a a zero em cada ponto, e paga com um pico de jerk dentro dos segmentos de $1560\ ^\circ/\text{s}^3$, contra $660$ de D. Só C e D partem e chegam sem degrau de aceleração. Parar em cada ponto (E) é o mais simples e exige a maior aceleração. F erra cada ponto interno por $\Delta v\,t_b/4$, em que $\Delta v$ é a mudança de inclinação: $(40-30)(0{,}2)/4=0{,}5^\circ$ em $t=1$ e $(-10-40)(0{,}2)/4=-2{,}5^\circ$ em $t=2$. Os picos menores dele não são vitória justa: ele leva $3{,}4$ s em vez de $3$.

### Exemplo 5: reta no espaço de juntas não é reta no espaço de tarefa

Um braço planar 2R com comprimentos supostos $L_1=L_2=1$ m e ângulos relativos, como em `forward-kinematics-of-serial-manipulators`, tem a ponta em $(\cos\theta_1+\cos(\theta_1+\theta_2),\ \sin\theta_1+\sin(\theta_1+\theta_2))$. Andar pela reta de juntas de $(0^\circ,90^\circ)$ a $(90^\circ,0^\circ)$ leva a ponta de $(1,1)$ a $(0,2)$:

```text
 s      theta (deg)      tip (m)            distance from the straight tip segment (m)
0.00    (0.0, 90.0)      (1.0000, 1.0000)   0.0000
0.25    (22.5, 67.5)     (0.9239, 1.3827)   0.2168
0.50    (45.0, 45.0)     (0.7071, 1.7071)   0.2929
0.75    (67.5, 22.5)     (0.3827, 1.9239)   0.2168
1.00    (90.0, 0.0)      (0.0000, 2.0000)   0.0000
```

A ponta se afasta $0{,}293$ m da reta, o maior desvio numa grade fina. Outro escalonamento no tempo mudaria quando a ponta está em cada ponto, não onde os pontos estão.

## Equívocos Comuns e Armadilhas

- **"Qualquer $T$ serve para um trapézio se a aceleração for alta o bastante."** A condição é $a\ge4D/T^2$; o Exemplo 2 mostra $a=60$ falhando para $T=2$.
- **"O quíntico é mais suave em tudo."** O pico de velocidade dele é $25\%$ maior que o do cúbico (Exemplo 1), então uma junta limitada em velocidade leva mais tempo com ele (Exemplo 2).
- **"A spline cúbica é a escolha mais suave, logo a melhor."** Ela passou dos dados por $0{,}535^\circ$ no Exemplo 4 e, com velocidades nulas nas pontas, ainda parte com um degrau de aceleração.
- **"Aceleração contínua significa jerk baixo."** O método C tem aceleração contínua e teve o maior jerk dentro dos segmentos, $1560\ ^\circ/\text{s}^3$.
- **"Um ponto com transição é atingido exatamente."** A junta passa perto dele, aqui a $\Delta v\,t_b/4$.

## Resumo

Uma trajetória no espaço de juntas é um caminho reto no espaço de configurações mais um escalonamento no tempo. O cúbico ajusta posição e velocidade nas duas pontas, tem picos de $1{,}5D/T$ e $6D/T^2$ e parte com um degrau de aceleração. O quíntico fixa também as acelerações nas pontas, o que tira esse degrau ao preço de um pico de velocidade de $15D/(8T)$. O trapézio só existe quando $a\ge4D/T^2$, segue em cruzeiro a $t_b\,a$ com $t_b=T/2-\sqrt{a^2T^2-4aD}/(2a)$ e, com os maiores $v$ e $a$ permitidos, é, como observa *Modern Robotics*, o movimento retilíneo mais rápido. Com várias juntas, a mais restrita define a duração. Nos pontos de passagem, segmentos cúbicos dão velocidade contínua, splines e segmentos quínticos dão aceleração contínua, e transições parabólicas dão velocidade contínua mas não atingem o ponto.

## Documentation Links

- [Modern Robotics, Lynch and Park (preprint PDF)](https://hades.mech.northwestern.edu/images/2/25/MR-v2.pdf): capítulo 9, caminho e escalonamento no tempo, escalonamentos polinomiais e trapezoidais, curvas em S e cúbicos com pontos de passagem.
- [Modern Robotics book resources, 9.3 Polynomial via point trajectories](https://modernrobotics.northwestern.edu/nu-gm-book-resource/9-3-polynomial-via-point-trajectories/): vídeo e transcrição sobre interpolação cúbica por pontos de passagem, incluindo deixar as velocidades livres e casar velocidade e aceleração.
- [Modern Robotics code library](https://github.com/NxRLab/ModernRobotics): `CubicTimeScaling`, `QuinticTimeScaling` e `JointTrajectory`.
- [Robotics Toolbox for Python: Trajectories](https://petercorke.github.io/robotics-toolbox-python/arm_trajectory.html): `quintic`, `trapezoidal` e `mstraj`, com a nota de que pontos com transição não são atingidos.
- [ros2_control: joint trajectory controller, trajectory representation](https://control.ros.org/lyrical/doc/ros2_controllers/joint_trajectory_controller/doc/trajectory.html): interpolação linear, cúbica e quíntica escolhida pelos campos do waypoint.
- [SciPy: CubicSpline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.CubicSpline.html): condições de contorno, incluindo inclinações fixas nas pontas.
