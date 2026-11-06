---
version: 1.0
updatedAt: 2026-11-04
title: "Controle Independente por Junta e PID"
summary: "Controle independente de cada junta acionada por um motor com redução, os termos P, I e D com ganhos por alocação de polos, PID discreto com período de amostragem e anti-windup nomeados, feed-forward de gravidade e, em simulação, o que a abordagem desacoplada ignora."
---
## Objetivos de Aprendizagem

- Modelar uma junta acionada por um motor DC com redução, com inércia e amortecimento refletidos, e tratar o resto do braço como perturbação sobre essa junta.
- Implementar um PID discreto com período de amostragem, regra de integração, regra de derivada e esquema de anti-windup nomeados, e escolher os ganhos por alocação de polos.
- Mostrar em simulação por que só PD deixa um erro de gravidade, como o integrador e o feed-forward de gravidade o removem e o que o windup do integrador faz com um atuador saturado.
- Mostrar em simulação o que o controle independente por junta ignora: a mudança de inércia com a configuração e o acoplamento entre juntas.

## Contexto e Motivação

`the-manipulator-equation-inertia-coriolis-gravity` escreveu o braço como uma única equação acoplada, $M(q)\ddot q+C\dot q+g=\tau$. O controlador mais simples ignora quase tudo isso. Cada junta ganha uma malha própria, que lê o próprio encoder e comanda o próprio motor, como se estivesse sozinha. *Modern Robotics* chama isso de controle descentralizado e diz que ele é adequado quando a dinâmica é desacoplada, ao menos aproximadamente, como em robôs com grande redução e sem gravidade. Esta lição monta essa malha para o braço de dois elos das lições anteriores, roda e mede o que ela acerta e o que ela perde.

## Teoria Central

### Uma junta com redução

Um motor DC produz torque $\tau_m=k_ti$ a partir da corrente $i$. No arranjo usual o amplificador trabalha em modo de corrente, ajustando a tensão para obter a corrente comandada, então o controlador comanda torque e a dinâmica elétrica fica de fora aqui. Uma redução de razão $G$ gira o motor $G$ vezes mais rápido que a junta e, com eficiência $\eta$, multiplica o torque: $\tau=\eta G\tau_m$. Um rotor de inércia $J_m$ girando a $G\dot q$ armazena $\tfrac12G^2J_m\dot q^2$, então a junta vê uma **inércia refletida** $G^2J_m$; o atrito viscoso $b_m$ do lado do motor aparece da mesma forma como $G^2b_m$. Para a junta $i$ do braço,

$$\underbrace{\big(G^2J_m+\bar M_{ii}\big)}_{J_i}\ddot q_i+G^2b_m\,\dot q_i=\eta Gk_t\,i_i-d_i,\qquad d_i=\big(M_{ii}(q)-\bar M_{ii}\big)\ddot q_i+\sum_{j\ne i}M_{ij}\ddot q_j+\big(C\dot q\big)_i+g_i(q),$$

em que $\bar M_{ii}$ é um valor nominal fixo. O controle independente por junta projeta cada malha para o lado esquerdo e trata $d_i$ como perturbação desconhecida. Quanto maior $G^2J_m$ em relação à inércia do elo, menor fica $d_i$ diante da dinâmica da própria junta, e é por isso que *Modern Robotics* diz que a matriz de massa de um robô com grande redução é quase diagonal.

Os valores do motor são suposições, com $\eta=1$: $G=100$, $J_m=3{,}0\times10^{-5}\ \text{kg m}^2$, $b_m=1{,}0\times10^{-4}$ N m s/rad, $k_t=0{,}05$ N m/A, limite de corrente de 8 A. Na junta isso dá inércia refletida de $0{,}3\ \text{kg m}^2$, amortecimento $B=1{,}0$ N m s/rad e limite de torque de $\pm40$ N m. O rotor do motor 2 também gira com o elo 1, a $\dot q_1+G\dot q_2$, o que soma $J_m$ a $M_{11}$ e $GJ_m=0{,}003\ \text{kg m}^2$ a $M_{12}$. Com os valores dos elos de `lagrangian-dynamics-of-an-open-chain-robot`, a inércia total na junta 1 é $1{,}557$ com o braço esticado ($q_2=0$), $1{,}157$ em $q_2=90^\circ$ e $0{,}757\ \text{kg m}^2$ dobrado ($q_2=180^\circ$). Na junta 2 é $0{,}407\ \text{kg m}^2$ em qualquer pose.

### PID, com ganhos por alocação de polos

A lei PID contínua é $\tau=K_pe+K_i\int e\,dt+K_d\dot e$ com $e=q_d-q$. Para uma junta $J\ddot q+B\dot q=\tau$, a dinâmica do erro com PID tem polinômio característico $Js^3+(B+K_d)s^2+K_ps+K_i$. Igualá-lo a $J(s+\alpha)(s+\omega_n)^2$ dá

$$K_p=J(\omega_n^2+2\omega_n\alpha),\qquad K_d=J(2\omega_n+\alpha)-B,\qquad K_i=J\alpha\omega_n^2.$$

Com $\omega_n=15$ rad/s e $\alpha=5$ rad/s, e inércias nominais tomadas em $q_2=90^\circ$:

| Junta | $J$ ($\text{kg m}^2$) | $K_p$ (N m/rad) | $K_i$ (N m/(rad s)) | $K_d$ (N m s/rad) |
|---|---|---|---|---|
| 1 | 1,157 | 433,8 | 1301,3 | 39,48 |
| 2 | 0,407 | 152,5 | 457,5 | 13,23 |

*Modern Robotics* dá as condições de estabilidade dessa malha de terceira ordem: $K_d>-B$, $K_p>0$ e $(B+K_d)K_p/J>K_i>0$. Os limites superiores de $K_i$ aqui são 15182 e 5338, muito acima dos ganhos usados. Essas condições valem para o modelo linear com $J$ constante e perturbação constante, e o braço não é isso, então o teste de verdade são as simulações abaixo.

### A implementação discreta

O controlador roda a cada $T=1$ ms. *Modern Robotics* dá cerca de 1 kHz como taxa típica do torque comandado. Na amostra $k$:

```text
e      = q_des - q_k
v_hat  = (q_k - q_{k-1}) / T                    # diferenca para tras da medida
v      = Kp*e + I + Kd*(qdot_des - v_hat) + tau_ff
u      = clip(v, -tau_max, +tau_max)            # limite do atuador
I      = I + Ki*T*e  [+ (T/Tt)*(u - v)]         # Euler para a frente; colchete = back-calculation
```

A derivada age sobre a posição medida, não sobre o erro, então um degrau no setpoint não gera pico de derivada; o pseudocódigo de *Feedback Systems*, de Åström e Murray, usa a mesma estrutura, com uma derivada filtrada que fica de fora aqui porque o sensor simulado é ideal, sem ruído nem quantização. O torque $u$ fica constante entre amostras. O braço, que é o modelo acoplado completo mais os termos dos motores, é integrado pelo método de Runge-Kutta clássico de quarta ordem com passo fixo de 0,1 ms, dez passos por período de controle.

A amostragem move os polos. Para a junta 1 com a inércia nominal, a malha fechada em $T=1$ ms, calculada pela discretização exata de $J\ddot q+B\dot q=u$, tem polos $z=0{,}99496;\ 0{,}98769;\ 0{,}98155$, equivalentes a $s=-5{,}05;\ -12{,}39;\ -18{,}62$, mais um polo rápido em $z=0{,}018$ vindo da diferença para trás: o polo duplo em $-15$ se separou. Com os mesmos ganhos, a malha fica instável em $T\approx40$ ms com a inércia nominal, em $T\approx29$ ms com o braço dobrado e em $T\approx49$ ms esticado. A configuração mais leve é a mais sensível, porque os mesmos ganhos agem sobre menos inércia.

### Anti-windup

Quando o atuador satura, a malha fica na prática aberta: o torque permanece no limite, faça o erro o que fizer, e o integrador continua acumulando erro. Quando o erro enfim troca de sinal, a integral grande mantém o atuador saturado, e o resultado é um sobressinal grande. *Feedback Systems* chama isso de windup do integrador. Dois remédios são usados abaixo. **Back-calculation**, o esquema de *Feedback Systems*, realimenta no integrador a diferença $u-v$ entre a saída saturada e a não saturada, com uma constante de tempo de rastreamento $T_t$; o livro observa que o ganho de rastreamento não pode ser grande demais, porque o ruído de medida passaria a reiniciar o integrador. **Clamping** (integração condicional) pula a atualização do integrador em toda amostra em que a saída está saturada e o erro tem o mesmo sinal de $v$, ou seja, quando integrar empurraria ainda mais para a saturação.

## Exemplos Resolvidos

### Exemplo 1: gravidade, integrador e feed-forward

O braço se move num plano vertical ($g_0=9{,}81\ \text{m/s}^2$) a partir do repouso em $(-60^\circ,30^\circ)$ até $(30^\circ,90^\circ)$ ao longo de $q_d(t)=q_a+(q_b-q_a)\tfrac12(1-\cos\pi t)$ para $0\le t\le1$ s, e depois mantém a posição. Todas as variantes usam os $K_p$ e $K_d$ da tabela; "PD" faz $K_i=0$, e o feed-forward de gravidade soma $\tau_{ff}=\hat g(q_d)$. Erros em graus, junta 1 e junta 2:

```text
controlador                     max |e| no movimento   e em t = 1.5 s     e em t = 3 s      pico |u| (N m)
PD                              3.42, 3.22             1.747, -0.713      1.746, -0.714     30.0, 9.7
PID                             2.88, 2.73             0.200, -0.003      0.000, 0.000      31.4, 10.3
PD + ff de gravidade exato      1.61, 1.79             0.001, 0.002       0.000, 0.000      28.4, 9.2
PD + ff de gravidade, m2 -20%   1.85, 2.08             0.177, -0.145      0.176, -0.147     28.7, 9.3
PID + ff de gravidade, m2 -20%  1.62, 1.77             0.251, 0.099       0.000, 0.000      29.5, 9.7
```

Nenhuma execução saturou. O PD segura o braço com erro permanente porque, em repouso, seu torque $K_pe$ só é não nulo se $e$ for: *Modern Robotics* escreve isso para uma junta como $K_p\theta_e=mgr\cos\theta$. Para duas juntas, o erro permanente resolve $K_pe=g(q_b-e)$, e resolver isso com `scipy.optimize.fsolve` dá $(1{,}7465^\circ;\ -0{,}7140^\circ)$, o valor simulado. O integrador remove o erro, mas devagar, já que $e(1{,}5\ \text{s})$ ainda é $0{,}2^\circ$ na junta 1. O feed-forward exato de gravidade remove o erro sem integrador e reduz à metade o erro durante o movimento. Com um modelo de gravidade cujo $m_2$ está 20% abaixo, o feed-forward sozinho deixa $0{,}18^\circ$; somar o integrador remove esse resto. Nestas execuções, o feed-forward fez o grosso do trabalho e o integrador corrigiu o erro do modelo.

### Exemplo 2: os mesmos ganhos, três inércias

Sem gravidade (plano horizontal), junta 2 mantida em $q_2$ pela própria malha, junta 1 com um degrau de $2^\circ$. Os mesmos ganhos da junta 1, projetados para $q_2=90^\circ$, encontram três plantas diferentes:

```text
q2         J na junta 1   polos continuos (rad/s)      sobressinal   acomodacao 2%   junta 2 perturbada em
0 grau     1.557          -10.67 +- 8.07j, -4.67       25.4%         0.833 s         0.23 grau
90 graus   1.157          -15, -15, -5                 20.7%         0.864 s         0.09 grau
180 graus  0.757          -40.35, -7.36, -5.79         17.6%         0.892 s         0.08 grau
```

Os polos listados são os de $Js^3+(B+K_d)s^2+K_ps+K_i$ com o $J$ real. Esticado, o braço é mais pesado que o projeto supôs e os polos ficam complexos; dobrado, é mais leve, um polo vai bem para a esquerda e, como a seção anterior mostrou, a malha amostrada perde estabilidade com um período de amostragem menor. Só a inércia dos elos varia por um fator 2,75 entre as poses esticada e dobrada; a inércia refletida do rotor, igual em todas as poses, reduz isso a 2,06, o que mantém moderada a mudança no transitório. Mesmo o PID com a inércia de projeto tem 20,7% de sobressinal, embora seus polos sejam reais, porque o PID acrescenta zeros: os termos proporcional e integral agem sobre o erro e respondem ao próprio degrau.

### Exemplo 3: acoplamento

Sem gravidade; a junta 1 vai de $0^\circ$ a $90^\circ$ em 0,75 s pelo perfil em cosseno, enquanto a junta 2 recebe o comando de ficar em $90^\circ$. Ao longo do movimento desejado, o torque que o movimento da junta 1 impõe à junta 2, $M_{21}\ddot q_1+(C\dot q)_2$, chega a 2,41 N m. Erros de pico em graus:

```text
controlador                                                      max |e1|   max |e2|
so PID                                                           2.007      0.941
PID + feed-forward por junta J_i qdd_d + B qd_d                  0.030      0.866
PID + feed-forward do modelo (M + M_rot) qdd_d + C qd_d + B qd_d 0.033      0.003
```

A junta 2 recebeu a ordem de ficar parada e se moveu quase $1^\circ$, só porque a junta 1 se moveu. Um feed-forward por junta, ainda independente, conserta a junta 1 e não mexe na junta 2, já que o que perturba a junta 2 vem da outra junta. Só o feed-forward calculado pelo modelo acoplado, que precisa da trajetória de todas as juntas, remove o erro. Isso já não é controle independente por junta; *Modern Robotics* chama a versão centralizada de computed torque control. Encurtar o movimento para 0,5 s dobrou o erro da junta 2, para $1{,}89^\circ$, e levou a junta 1 ao limite de 40 N m.

### Exemplo 4: windup

Com gravidade, junta 2 em $0^\circ$, a junta 1 dá um degrau de pendurada ($-90^\circ$) para horizontal ($0^\circ$). Só o termo proporcional pede $433{,}8\cdot\pi/2=681$ N m, então o motor satura em 40 N m. Com $T_i=K_p/K_i=0{,}333$ s:

```text
esquema                       pico q1    menor q1 apos pico   dentro de 0.5 grau apos   tempo saturado   integral max (N m)
sem anti-windup               67.5 grau  -47.9 grau           2.79 s                    1.81 s           513
back-calculation, Tt = Ti     15.6 grau  0.0 grau             1.30 s                    0.37 s           142
back-calculation, Tt = Ti/10  0.0 grau   0.0 grau             1.26 s                    0.15 s           21.1
clamping                      4.3 grau   0.0 grau             0.95 s                    0.30 s           48.9
```

Sem anti-windup, a integral sobe a 513 N m enquanto o braço ainda está subindo, e o braço passa $67{,}5^\circ$ do alvo e depois desce a $47{,}9^\circ$ abaixo dele. Em todos os esquemas a integral termina em 21,09 N m, que é $g_1(0,0)$: o integrador aprendeu o torque de gravidade que o feed-forward teria fornecido. O tempo de rastreamento mais curto eliminou o sobressinal nesta simulação; com um sensor ruidoso, essa escolha teria de ser pesada contra o aviso sobre ruído citado acima, que um sensor ideal não mostra. A junta 2, que nunca recebeu comando de movimento, desviou até $4{,}6^\circ$ sem anti-windup e de $2{,}2^\circ$ a $3{,}6^\circ$ com ele.

## Equívocos Comuns e Armadilhas

- **"Cada junta é um sistema separado."** O Exemplo 3 moveu uma junta que tinha ordem de ficar parada. A independência é uma escolha de projeto, não uma propriedade do braço.
- **"Ganhos ajustados numa pose servem em todas."** A inércia na junta 1 mudou por um fator 2 entre as poses, o que moveu os polos e o período de amostragem em que a malha fica instável.
- **"O integrador é a cura da gravidade."** Funciona, devagar. O feed-forward de um modelo de gravidade faz a maior parte do trabalho, e o integrador limpa o erro do modelo. *Modern Robotics* observa que, na prática, muitos controladores de robô usam $K_i=0$ "since stability is paramount".
- **"Saturação é problema do atuador."** Ela abre a malha, e o integrador transforma uma saturação num sobressinal de 67,5° sem anti-windup.
- **"Ganhos contínuos valem sem mudança."** Amostrar a 1 ms já separou o polo duplo, e os mesmos ganhos desestabilizam o braço dobrado em cerca de 29 ms.

## Resumo

O controle independente por junta trata cada junta como um motor com redução que aciona a inércia $G^2J_m+\bar M_{ii}$ e põe todo o resto, gravidade, acoplamento e a variação de $M_{ii}$, numa perturbação. Um PID discreto em $T=1$ ms, com integração de Euler para a frente, derivada da medida por diferença para trás e ganhos com polos em $-5$, $-15$ e $-15$ rad/s, seguiu um movimento de 1 s com erro até $2{,}9^\circ$ e removeu o erro permanente que o PD deixava ($1{,}75^\circ$ na junta 1); o feed-forward de gravidade o removeu sem integrador e reduziu à metade o erro de seguimento. A saturação sem anti-windup produziu sobressinal de $67{,}5^\circ$, e back-calculation ou clamping o reduziram para $0^\circ$ a $15{,}6^\circ$. O que o método ignora apareceu diretamente: os mesmos ganhos deram polos diferentes em poses diferentes, e uma junta mandada ficar parada se moveu quase $1^\circ$ quando a vizinha se moveu, um erro que só o feed-forward pelo modelo de todas as juntas removeu.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 8.9 modela motores DC com redução e a inércia refletida $G^2I_{rotor}$; a Seção 11.4 cobre PID de uma junta com suas condições de estabilidade e pseudocódigo, feed-forward, controle descentralizado e computed torque.
- [Feedback Systems, Åström and Murray (2008), complete PDF](http://www.cds.caltech.edu/~murray/books/AM08/pdf/am08-complete_22Feb09.pdf): o Capítulo 10, sobre controle PID, inclui windup do integrador, anti-windup por back-calculation, filtragem da derivada, ponderação do setpoint e uma implementação em computador.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 2: Actuators and Drive Systems](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter2/): motores DC, redução por engrenagens e a inércia e o amortecimento efetivos refletidos ao eixo de uma junta.
- [SciPy, scipy.linalg.expm](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html): a exponencial de matriz usada na discretização exata por trás dos polos amostrados.
