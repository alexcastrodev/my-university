---
version: 1.0
updatedAt: 2026-11-05
title: "Capstone: Rastreando um Pick-and-Place por Cinemática, Dinâmica e Controle"
summary: "Uma tarefa de pick-and-place seguida por toda a disciplina: poses, cinemática inversa, uma trajetória no espaço das juntas, os torques que ela exige e a malha de controle que a acompanha."
---
## Objetivos de Aprendizagem

- Seguir uma tarefa por poses, cinemática inversa, trajetória no espaço das juntas, torques nas juntas e malha de controle, com cada etapa alimentando a seguinte.
- Conferir uma etapa contra a anterior: cinemática direta contra a inversa, torques contra a trajetória, rastreamento contra os torques.
- Dimensionar um motor pelo torque de pico de um movimento planejado, com uma carga.
- Ordenar projetos de controlador pelo erro de rastreamento que deixam, e dizer o que cada um supõe sobre o modelo.
- Achar um erro de simulação por raciocínio físico, em vez de confiar num número plausível.

## Contexto e Motivação

Cada lição desta disciplina responde a uma pergunta. Um pick-and-place faz todas, em ordem. Onde está o objeto? Que ângulos de junta levam a ferramenta até lá? Como as juntas devem se mover no meio do caminho? Que torques esse movimento exige? O controlador consegue entregá-los? Um erro numa etapa inicial é carregado por todas as seguintes, e o erro final de rastreamento não diz de qual etapa veio.

Este capstone roda uma tarefa num braço. O braço é o planar de dois elos de `static-forces-and-joint-torques`, `lagrangian-dynamics-of-an-open-chain-robot`, `the-manipulator-equation-inertia-coriolis-gravity` e `independent-joint-control-and-pid`. Todo comprimento, massa, valor de motor e ganho é uma suposição dessas lições, então os números descrevem um modelo e nenhum robô real. O braço se move num plano vertical com $g_0=9{,}81\ \text{m/s}^2$, e tudo rodou em NumPy 2.5.4.

## Teoria Central

### A cadeia de etapas

| Etapa | Lição | Entrada | Saída |
|---|---|---|---|
| Tarefa | (dada) | Posições do objeto e do alvo | Poses da ferramenta |
| Pose | `homogeneous-transformations-for-robot-poses` | Referenciais | Posição da ferramenta no referencial da base |
| Cinemática inversa | `inverse-kinematics-and-workspace` | Posição da ferramenta | Ângulos das juntas, um por ramo |
| Trajetória | `trajectory-planning-in-joint-space` | Ângulos inicial e final, duração | $q(t)$, $\dot q(t)$, $\ddot q(t)$ |
| Dinâmica | `the-manipulator-equation-inertia-coriolis-gravity` | $q$, $\dot q$, $\ddot q$, carga | Torques $\tau(t)$ |
| Controle | `independent-joint-control-and-pid` | $\tau$, erros | Torques comandados |

As etapas se conferem rodando-as ao contrário. A cinemática direta aplicada à resposta da inversa tem de devolver a posição de pegar. A dinâmica inversa aplicada à trajetória dá o torque que, entregue à planta, tem de reproduzir a trajetória. A etapa de controle testa tudo de uma vez, porque um erro em qualquer etapa anterior aparece como erro de rastreamento.

### Onde o erro pode se esconder

Um plano no espaço das juntas é reto nos ângulos e, em geral, curvo no caminho da ferramenta. Um torque calculado com o modelo errado está errado em toda amostra, e uma malha de realimentação só o combate depois que um erro se acumulou. Ganhos ajustados para uma pose valem para a inércia dessa pose. São três fontes de erro separadas, então um relatório deve isolar cada uma, como as execuções abaixo fazem.

## Exemplos Resolvidos

### Passo 1: poses e cinemática inversa

A tarefa é mover uma peça de 1 kg de uma posição de pegar $(0{,}60,\ 0{,}10)$ m até uma posição de largar $(0{,}20,\ 0{,}50)$ m. O braço tem $L_1=0{,}5$ m e $L_2=0{,}4$ m, então os dois alvos estão dentro do alcance de 0,9 m, a 0,608 m e 0,539 m da base. A cinemática inversa dá duas soluções em cada alvo:

```text
target   branch   q1 (deg)   q2 (deg)   fk error   det J     cond J
pick     q2 < 0     50.33     -95.74     2.8e-17   -0.1990    2.21
pick     q2 > 0    -31.40      95.74     8.3e-17    0.1990    2.21
place    q2 < 0    113.32    -107.46     5.6e-17   -0.1908    1.80
place    q2 > 0     23.08     107.46     5.6e-17    0.1908    1.80
```

A cinemática direta devolve cada alvo até o arredondamento. Os dois ramos estão longe de singulares, porque $\lvert\det J\rvert$ vale cerca de 0,2 e o número de condição é no máximo 2,21. O plano usa o ramo com $q_2<0$ nas duas pontas. Trocar de ramo no meio da tarefa exigiria passar por $q_2=0$, que é uma singularidade, então a escolha é feita uma vez. Aqui $\det J=L_1L_2\sin q_2$, e é por isso que o sinal de $q_2$ dá o sinal do determinante.

### Passo 2: uma trajetória no espaço das juntas

Um polinômio de quinto grau, de repouso a repouso em $T=1{,}5$ s, move as juntas por $\Delta q=(62{,}99^\circ,\ -11{,}72^\circ)$:

```text
peak joint velocity (deg/s)       78.7   14.6
peak joint acceleration (deg/s2) 161.6   30.1
minimum |det J| on the path       0.1908
largest tool deviation from the straight line: 0.076 m
```

O caminho fica longe das singularidades: seu menor $\lvert\det J\rvert$ é o valor na configuração de largar. A ferramenta não se move em linha reta, porque o plano é reto no espaço das juntas, e ela se afasta da corda entre os alvos em até 7,6 cm. Se a peça precisa seguir uma reta, por exemplo ao longo de uma esteira, o plano tem de ser feito no espaço cartesiano.

### Passo 3: os torques que o movimento exige

A dinâmica inversa, $\tau=M\ddot q+C\dot q+g$, é calculada ao longo da trajetória com o modelo de `the-manipulator-equation-inertia-coriolis-gravity`, com e sem uma massa pontual de 1 kg na ponta da ferramenta:

```text
                   joint 1 (N m)   joint 2 (N m)
peak |tau|, no payload     15.47            3.90
peak |tau|, 1 kg payload   22.20            7.81
gravity alone at start (1 kg payload)      19.60   5.51
gravity alone at start (no payload)       13.71   2.75
```

O motor de `independent-joint-control-and-pid` tem $G=100$, $k_t=0{,}05$ N m/A e limite de corrente de 8 A, então entrega $G\,k_t\,I_{\max}=40$ N m na junta. O pico de 22,2 N m com a carga de 1 kg cabe, com margem de 1,8. Nessa velocidade a carga é sobretudo gravidade: no início, segurar o braço parado com a carga exige 19,6 N m, e o pico inteiro é 22,2.

Encurtar o movimento mostra onde está o limite, entre 0,6 s e 0,5 s:

```text
T (s)    peak |tau| (N m)   verdict against 40 N m
1.5          22.2           feasible
1.0          26.0           feasible
0.8          30.0           feasible
0.6          38.5           feasible
0.5          47.2           saturates
```

O torque de pico cresce devagar enquanto o tempo encolhe, porque a gravidade não depende da velocidade. Quem espera que o torque escale com $1/T^2$ está olhando só a parte inercial, que aqui é a menor. Abaixo de cerca de 0,57 s o limite de 40 N m é ultrapassado e o plano precisa ser mais lento.

### Passo 4: a malha de controle

A malha é a de `independent-joint-control-and-pid`: $T_s=1$ ms, integrador de Euler progressivo, retentor de ordem zero e a planta integrada por RK4 a 0,1 ms. Os ganhos vêm da alocação de polos com $\omega_n=15$ rad/s e $\alpha=5$ rad/s, sobre a inércia em $q_2=90^\circ$: $K_p=(433{,}8;\ 152{,}5)$, $K_i=(1301{,}3;\ 457{,}5)$, $K_d=(39{,}48;\ 13{,}23)$. A planta tem a carga real de 1 kg, inércia refletida do rotor $G^2J_m=0{,}3$ kg m$^2$ e amortecimento $G^2b_m=1{,}0$ N m s/rad. O erro da ponta é a distância entre a ferramenta e a posição da ferramenta na referência, e a tabela lista seu máximo durante o movimento:

```text
design                                                  max tip error   max joint error
PID, no feed-forward                                        35.74 mm        2.544 deg
PID + gravity feed-forward, model without payload           15.46 mm        1.013 deg
PID + gravity feed-forward, model with payload               4.85 mm        0.456 deg
full inverse dynamics, link terms only                       1.22 mm        0.139 deg
full inverse dynamics, links + rotor, model with payload     0.06 mm        0.007 deg
full inverse dynamics, links + rotor, model without payload 12.87 mm        0.957 deg
```

Cada linha acrescenta conhecimento da planta, e o erro cai de 35,7 mm para 0,06 mm. Duas leituras importam mais que a ordenação.

Primeiro, um erro de modelo custa mais do que o controlador consegue reparar. Esquecer a carga custa 12,9 mm mesmo com o modelo completo, porque o feed-forward pede então o torque de um braço mais leve. Segundo, os termos do rotor não são pequenos: omitir $G^2J_m=0{,}3$ e o amortecimento leva o erro de 0,06 para 1,22 mm, cerca de 20 vezes, porque a inércia do rotor é 26% da inércia nominal da junta 1 e 74% da junta 2 (0,3 contra 1,157 e 0,407 kg m$^2$). A melhor linha deixa 0,06 mm, e não zero. A malha amostra a 1 ms e mantém o torque entre amostras, e esse resíduo não foi isolado mais a fundo.

### Passo 5: um termo derivativo certo para um setpoint e errado numa trajetória

O termo derivativo de `independent-joint-control-and-pid` é escrito sobre o erro, $K_d(\dot q_d-\dot q)$, e existe uma variante que deriva só a medição, $-K_d\dot q$. A variante evita um pico quando o setpoint salta e é correta quando $\dot q_d=0$. Numa trajetória ela se opõe ao movimento com um torque $K_d\dot q$, que na velocidade de pico da junta 1 vale $39{,}48\times1{,}37\approx54$ N m. A mesma malha com feed-forward exato, rodada dos dois modos:

```text
derivative term                       max tip error   max joint error
on the error, Kd (qd_dot - q_dot)          0.063 mm        0.007 deg
on the measurement, -Kd q_dot             36.81 mm         3.803 deg
```

Uma execução em malha aberta do mesmo feed-forward exato, sem realimentação, chegou ao fim da trajetória com erro de $0{,}03^\circ$, então o modelo e o feed-forward são consistentes e quem muda o resultado é a malha. A variante errada dá um erro plausível de 37 mm. Só um caso de resposta conhecida, aqui a execução em malha aberta, mostra que ela está errada.

## Equívocos Comuns e Armadilhas

- **"Se os pontos finais estão certos, a tarefa está certa."** A ferramenta saiu 7,6 cm da reta. Os alvos nada dizem sobre o caminho entre eles.
- **"Um ganho maior resolve o rastreamento."** Ganhos não removem um erro de modelo: a tabela mostra 12,9 mm restantes com os ganhos certos e a carga errada. Ganhos maiores acabam esbarrando no limite de amostragem de `independent-joint-control-and-pid`.
- **"Compensar a gravidade é um refinamento."** Foi o maior passo isolado, de 35,7 para 15,5 mm, e com a carga certa levou o erro a 4,9 mm.
- **"O torque de pico escala com $1/T^2$."** Só a parte inercial escala. Aqui a gravidade domina, então ir de 1,5 s para 0,8 s moveu o pico de 22,2 para 30,0 N m.
- **"Uma simulação que roda é uma simulação certa."** A malha errada do Passo 5 rodou e deu um erro plausível. Confira o controlador contra um caso de resposta conhecida, como o feed-forward em malha aberta.
- **"Os ganhos de uma configuração servem ao braço todo."** Os ganhos usaram a inércia em $q_2=90^\circ$. Ao longo deste caminho $q_2$ fica entre $-96^\circ$ e $-107^\circ$, então a diferença é pequena. Uma tarefa que dobrasse o cotovelo veria a inércia variar por um fator de 2 ou mais, como em `independent-joint-control-and-pid`.

## Resumo

Um pick-and-place passa por seis etapas, e cada uma é conferida contra a vizinha. A cinemática inversa devolveu os alvos até o arredondamento e deixou os dois ramos longe de singulares. O plano quíntico no espaço das juntas levou 1,5 s e saiu da reta em 7,6 cm. A dinâmica inversa pediu no máximo 22,2 N m contra um limite de 40 N m. Na malha de controle o erro caiu de 35,74 mm para 0,06 mm conforme o controlador aprendia a planta, da gravidade sozinha até elos, rotor e carga, e uma carga esquecida custou 12,9 mm. Um termo derivativo correto para um setpoint e errado para uma trajetória só apareceu contra um caso de resposta conhecida. Os valores dependem de comprimentos, massas e ganhos supostos, então ilustram o método e não descrevem um robô.

## Documentation Links

- [Lynch and Park, Modern Robotics: 9.3 Polynomial via-point trajectories](https://modernrobotics.northwestern.edu/nu-gm-book-resource/9-3-polynomial-via-point-trajectories/): as escalas de tempo polinomiais usadas no Passo 2.
- [Asada (2005), MIT OCW 2.12, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): a equação do manipulador por trás do Passo 3.
- [Asada (2005), MIT OCW 2.12, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): o Jacobiano e as singularidades conferidos no Passo 1.
- [Tedrake, Underactuated Robotics: Multi-Body Dynamics](https://underactuated.mit.edu/multibody.html): a equação do manipulador e a escolha da matriz $C$.
