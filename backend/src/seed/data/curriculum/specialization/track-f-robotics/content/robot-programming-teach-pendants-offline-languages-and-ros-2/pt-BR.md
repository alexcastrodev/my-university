---
version: 1.0
updatedAt: 2026-11-04
title: "Programação de Robôs: Teach Pendants, Linguagens Offline e ROS 2"
summary: "Teach pendants e linguagens offline como as fontes abertas os descrevem, e depois o modelo do ROS 2 de nós, tópicos, serviços e ações como é praticado hoje."
---
## Objetivos de Aprendizagem

- Descrever a programação por teach pendant, por condução manual (walk-through) e offline, e os compromissos entre elas.
- Ler uma instrução de movimento de fabricante (ABB RAPID, Universal Robots URScript) e ligar seus argumentos às trajetórias de `trajectory-planning-in-joint-space`.
- Citar as distribuições do ROS 2 com suporte, com datas de lançamento e de fim de vida, como docs.ros.org as lista.
- Explicar nós, tópicos, serviços e ações do ROS 2, escolher entre eles e ler o código dos tutoriais oficiais de cada um.
- Seguir uma trajetória de juntas desde um goal de ação do ROS 2 até o controlador que a interpola.

## Contexto e Motivação

`trajectory-planning-in-joint-space` gerou trajetórias a partir de configurações e instantes dados. Falta dizer quais configurações, em que ordem, com que velocidades, e o que fazer quando uma garra fecha ou um sensor dispara. Isso é programar o robô, e acontece em dois mundos. Controladores industriais como os da ABB e da Universal Robots vêm com pendant e linguagem própria, e o programa roda no controlador do fabricante. O ROS 2 é um framework aberto em que o software do robô é um grafo de processos que se comunicam.

A prática muda, então, onde importa, a fonte e a data dela aparecem junto.

## Teoria Central

### Programação por teach pendant

Um survey apresentado por Villani e coautores no IFAC INCOM 2018 resume o método tradicional. O operador leva o robô de ponto em ponto com os botões do pendant e salva cada posição. Os slides continuam: "When the whole program has been learned, the robot can play back the points at full speed". Os custos, segundo o survey: trabalho tedioso, exigência de conhecimento de programação e reprogramação a cada tarefa nova, o que pesa em lotes pequenos. O pendant continua necessário para verificar e ajustar no local programas gerados offline, e para tarefas que só um operador perto do robô consegue programar.

**Na condução manual** (walk-through), a mão substitui os botões: o operador guia o robô, o controlador grava as poses significativas, interpola e reproduz a trajetória. O survey observa que a segurança é crítica e que levar o robô a coordenadas precisas é mais difícil que nos outros métodos. O manual de URScript do PolyScope 5.23 lista `teach_mode()` e `freedrive_mode()` entre as funções de movimento.

### Programação offline

Na programação offline, o programa é feito num computador longe do robô, num software que simula a célula em 3D, detecta colisões e gera o programa, depois carregado no controlador. No mesmo survey, o ganho é o tempo parado: o robô só para enquanto o programa novo é baixado e testado. Os custos: o tempo de montar e testar a simulação e a diferença entre modelo e célula ("Virtual models do not represent the real world with 100% accuracy"), por isso é preciso uma etapa de calibração para compensar o desencontro entre os sistemas de coordenadas real e virtual.

### Linguagens de fabricante: o que uma instrução carrega

**ABB RAPID** (Technical reference manual, RAPID overview, RobotWare 6.16.04, revisão Y, 2026). Os movimentos são programados de pose em pose, e o controlador calcula o caminho entre elas. A instrução de posicionamento escolhe a interpolação, e os argumentos trazem a posição final, a velocidade, a zona (precisão da posição), a ferramenta e o objeto de trabalho. Um exemplo do manual:

```text
MoveL p1,v500,z10,tool1;
MoveC p2,p3,v500,z10,tool1;
MoveL p4,v500,z10,tool1;
```

`MoveJ` é interpolação de juntas. O manual descreve como a velocidade é definida: o controlador acha o eixo limitante, "the axis that travels fastest relative to its maximum velocity", e calcula as velocidades dos outros eixos "so that all axes reach the destination point at the same time". É a sincronização do Exemplo 3 de `trajectory-planning-in-joint-space`. `MoveL` mantém o ponto central da ferramenta numa reta; quando um eixo precisaria de mais torque do que o motor dá, como perto de singularidades de punho e de braço, o manual diz que a velocidade de todos os eixos é reduzida automaticamente. A zona decide se o ponto é de parada ou de passagem (fly-by), e "a fly-by point generates a corner path (parabola path) past the programmed position", a transição do Exemplo 4 da mesma lição, que não atinge o ponto.

**URScript** (manual de script do PolyScope 5.23, Universal Robots). `movej(q, a=1.4, v=1.05, t=0, r=0)` move "linear in joint-space", com `a` e `v` a aceleração e a velocidade do eixo líder, em rad/s² e rad/s. O manual afirma: "The speed and acceleration parameters control the trapezoid speed profile of the move." Um tempo `t` tem prioridade sobre `a` e `v`, e um raio de transição `r` modifica a trajetória "to avoid the robot stopping at the point". `movel` é linear no espaço da ferramenta. Segundo o mesmo manual, o runtime que executa esses programas se comunica com o robô a 500 Hz.

O manual de RAPID atende aos dois modos: diz ser "particularly useful when programming offline" e também menciona posições "created on-line by digitizing (teach programming)".

### Livro vs hoje

| Prática | Fonte, data | Situação nas fontes lidas |
|---|---|---|
| Ensinar pontos no pendant e reproduzir | Villani et al., IFAC INCOM 2018 | o manual de RAPID de 2026 ainda cita teach programming e o FlexPendant |
| Programação offline numa simulação 3D | Villani et al., 2018 | o manual de RAPID de 2026 é escrito em parte para uso offline |
| Uma linguagem por fabricante | RAPID (RobotWare 6.16, 2026), URScript (PolyScope 5.23) | ambas atuais |
| Planejamento de movimento pelo ROS | *Modern Robotics* (2017, preprint 2019) cita o MoveIt! para ROS | MoveIt 2 para ROS 2, lançado em 2019 segundo sua documentação |
| Distribuição do ROS 2 | Ardent Apalone, 8 de dezembro de 2017, a primeira após alfas e betas | Lyrical Luth, 22 de maio de 2026, a mais recente |

### Distribuições do ROS 2

docs.ros.org (página Releases, lida em novembro de 2026) lista estas como suportadas:

| Distribuição | Lançamento | Fim de vida |
|---|---|---|
| Lyrical Luth | 22 de maio de 2026 | maio de 2031 |
| Kilted Kaiju | 23 de maio de 2025 | dezembro de 2026 |
| Jazzy Jalisco | 23 de maio de 2024 | maio de 2029 |
| Humble Hawksbill | 23 de maio de 2022 | maio de 2027 |

A página de lançamento chama a Lyrical de "a Long Term Support (LTS) release". A Iron Irwini acabou em 4 de dezembro de 2024 e a Foxy Fitzroy em 20 de junho de 2023. A página também avisa: "Nodes are not guaranteed to be able to communicate across distributions." Misturar máquinas Humble e Lyrical, portanto, não tem suporte.

### Nós, tópicos, serviços, ações

Pela documentação do ROS 2 (Lyrical):

- Um **nó** é "a participant in the ROS 2 graph, which uses a client library to communicate with other nodes", e "each node should do one logical thing". Os nós se acham por descoberta distribuída.
- Um **tópico** é um canal publish/subscribe anônimo e fortemente tipado para fluxos contínuos de dados, como dados de sensor ou estado do robô. Pode ter zero ou mais publishers e subscribers, e o subscriber em geral não sabe qual publisher enviou a mensagem.
- Um **serviço** é uma chamada de procedimento remoto: requisição e resposta. Serviços "are expected to return quickly", pois o cliente em geral espera. Deve haver um só servidor por nome; com vários, não se define qual responde. `remote-procedure-calls-and-the-illusion-of-a-local-call` separa requisição perdida, servidor caído e resposta perdida, e as mesmas perguntas valem aqui.
- Uma **ação** é "a long-running remote procedure call with feedback and the ability to cancel or preempt the goal". A definição tem três partes: goal, resultado e feedback.

O guia da documentação resume: tópicos para dados contínuos, serviços para chamadas rápidas "such as IK", e ações "for any discrete behavior that moves a robot or that runs for a longer time but provides feedback during execution".

## Exemplos Resolvidos

### Exemplo 1: quanto um `movej` vai levar

Gire a base de um braço UR em $90^\circ=1{,}5708$ rad com os padrões $a=1{,}4\ \text{rad/s}^2$ e $v=1{,}05\ \text{rad/s}$, com a base como eixo líder. Se o perfil for o trapézio simples de `trajectory-planning-in-joint-space` (inferência a partir de "trapezoid speed profile"; o manual diz também que a Motion Version influencia a trajetória), então $v^2/a=0{,}7875\le1{,}5708$, e o eixo entra em cruzeiro, com

$$t_b=\frac va=0{,}75\ \text{s},\qquad T=\frac Dv+\frac va=1{,}496+0{,}75=2{,}246\ \text{s}.$$

Num movimento de 0,5 rad, $v^2/a>D$, o perfil é um triângulo, $T=2\sqrt{0{,}5/1{,}4}=1{,}195$ s, e a junta nunca chega a 1,05 rad/s; o pico é $0{,}837$ rad/s.

### Exemplo 2: um tópico, do tutorial oficial

O tutorial "Writing a simple publisher and subscriber (Python)" da Lyrical monta um talker e um listener. O núcleo do talker, do texto do tutorial:

```python
class MinimalPublisher(Node):

    def __init__(self):
        super().__init__('minimal_publisher')
        self.publisher_ = self.create_publisher(String, 'topic', 10)
        timer_period = 0.5  # seconds
        self.timer = self.create_timer(timer_period, self.timer_callback)
        self.i = 0

    def timer_callback(self):
        msg = String()
        msg.data = 'Hello World: %d' % self.i
        self.publisher_.publish(msg)
        self.get_logger().info('Publishing: "%s"' % msg.data)
        self.i += 1
```

O listener chama `create_subscription(String, 'topic', self.listener_callback, 10)`. O 10 é a profundidade da fila, que o tutorial chama de configuração obrigatória de Quality of Service. As saídas abaixo vêm de rodar os dois arquivos do tutorial, sem alteração, como scripts Python comuns na Lyrical, na imagem Docker oficial `ros:lyrical` (Ubuntu 26.04.1), com o listener iniciado 2,2 s depois do talker; timestamps cortados.

```text
[minimal_publisher]: Publishing: "Hello World: 0"
[minimal_publisher]: Publishing: "Hello World: 1"
[minimal_publisher]: Publishing: "Hello World: 2"
[minimal_publisher]: Publishing: "Hello World: 3"
[minimal_subscriber]: I heard: "Hello World: 3"
[minimal_subscriber]: I heard: "Hello World: 4"
```

As mensagens 0 a 2 saíram antes de a assinatura do listener estar conectada e nunca chegaram a ele, como prevê o tutorial: o listener começa "at whatever message count the publisher is on at that time". `ros2 topic info /topic -v` informou confiabilidade `RELIABLE`, histórico `KEEP_LAST (10)` e durabilidade `VOLATILE` para o talker, e `ros2 topic hz /topic` mediu uma taxa média de 2,003 Hz, o timer de 0,5 s.

### Exemplo 3: um serviço

O tutorial de serviço usa `example_interfaces/srv/AddTwoInts`, cuja definição é uma requisição e uma resposta separadas por `---`:

```text
int64 a
int64 b
---
int64 sum
```

O servidor registra `create_service(AddTwoInts, 'add_two_ints', self.add_two_ints_callback)`, e o callback faz `response.sum = request.a + request.b`. O cliente espera o serviço com `wait_for_service`, envia com `call_async` e gira até o future terminar. A execução, do mesmo jeito:

```text
[minimal_client_async]: Result of add_two_ints: for 41 + 1 = 42
```

e `ros2 service call /add_two_ints example_interfaces/srv/AddTwoInts "{a: 2, b: 3}"` devolveu `sum=5`.

### Exemplo 4: uma ação

Os tutoriais de ação definem `custom_action_interfaces/action/Fibonacci`:

```text
int32 order
---
int32[] sequence
---
int32[] sequence
```

O `execute_callback` do servidor acrescenta um termo por volta, chama `goal_handle.publish_feedback(feedback_msg)` e dorme 1 s "for dramatic effect"; no fim chama `goal_handle.succeed()` e devolve o resultado. O cliente envia `order = 10` com um callback de feedback. Depois de compilar o pacote de interface com `colcon`, a execução deu:

```text
[fibonacci_action_client]: Goal accepted :)
[fibonacci_action_client]: Received feedback: array('i', [0, 1, 1])
[fibonacci_action_client]: Received feedback: array('i', [0, 1, 1, 2])
...
[fibonacci_action_client]: Result: array('i', [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55])
```

Chegaram nove feedbacks, a cerca de 1 s um do outro, e o resultado tem 11 números: o laço roda para `i` de 1 a 9 sobre o `[0, 1]` inicial. O mesmo goal com `order: 5`, enviado por `ros2 action send_goal --feedback`, produziu quatro mensagens de feedback e um resultado de 6 números. Diferente do cliente do serviço, este recebeu progresso enquanto esperava.

### Exemplo 5: uma trajetória de juntas como goal de ação

Segundo a documentação do MoveIt 2, ele em geral envia os movimentos do braço a um joint trajectory controller. O do `ros2_control` (documentação da Lyrical) oferece o servidor de ação `<controller_name>/follow_joint_trajectory`, do tipo `control_msgs/action/FollowJointTrajectory`, a forma principal de enviar trajetórias quando se quer monitorar a execução. O goal leva uma `trajectory_msgs/JointTrajectory` mais tolerâncias de caminho e de chegada; cada ponto tem

```text
float64[] positions
float64[] velocities
float64[] accelerations
float64[] effort
builtin_interfaces/Duration time_from_start
```

Se as tolerâncias forem violadas, o goal é abortado e a posição atual é mantida, segundo a mesma documentação.

Tome a spline B do Exemplo 4 de `trajectory-planning-in-joint-space`, convertida para radianos: posições $0;\ 0{,}5236;\ 1{,}2217;\ 1{,}0472$ em `time_from_start` 0, 1, 2 e 3 s, velocidades $0;\ 0{,}8727;\ 0{,}1745;\ 0$ rad/s. Com posições e velocidades, o interpolador do controlador usa cúbicos, contínuos em velocidade; com acelerações também, quínticos, contínuos em aceleração; só com posições, interpolação linear, que a documentação desaconselha. O cúbico fixado pelas posições e velocidades nas pontas de cada segmento é exatamente a spline B, então o goal a reproduziria se o cúbico do controlador for esse. O goal está mostrado, não executado: ilustra a mensagem, não um movimento medido.

## Equívocos Comuns e Armadilhas

- **"Teach pendants estão obsoletos."** O survey de 2018 lista situações em que continuam necessários, e o manual de RAPID de 2026 ainda documenta teach programming.
- **"Use um serviço para mover o braço."** Serviços devem responder rápido; a documentação manda o movimento do robô para ações, que dão feedback e podem ser canceladas.
- **"Um subscriber recebe tudo o que foi publicado no tópico."** Um subscriber que chega tarde, com durabilidade volátil, não recebe as mensagens anteriores: o listener do Exemplo 2 perdeu de 0 a 2.

## Resumo

Robôs são programados ensinando pontos no pendant, guiando o braço com a mão ou offline, numa simulação que depois precisa ser calibrada à célula. As instruções dos fabricantes trazem as escolhas da lição anterior: o `MoveJ` do RAPID sincroniza os eixos pelo limitante e faz cantos parabólicos nos pontos fly-by, e o `movej` do URScript usa um trapézio do eixo líder, com raio de transição. No ROS 2, nós trocam fluxos em tópicos, chamadas rápidas em serviços e trabalho longo, cancelável e com feedback em ações. Em novembro de 2026, a Lyrical Luth (22 de maio de 2026, LTS até maio de 2031) é a distribuição mais recente. Uma trajetória de juntas chega ao controlador do `ros2_control` como goal de `FollowJointTrajectory`, e os campos de cada ponto decidem se a interpolação é linear, cúbica ou quíntica.

## Documentation Links

- [ROS 2 Documentation: Distributions](https://docs.ros.org/en/rolling/Releases.html): lançamento e fim de vida de cada distribuição.
- [ROS 2 Documentation: Lyrical Luth](https://docs.ros.org/en/lyrical/Releases/Release-Lyrical-Luth.html): status LTS e suporte da distribuição mais recente.
- [ROS 2 Documentation: Nodes](https://docs.ros.org/en/lyrical/ROS-Framework/About-Nodes.html): o que é um nó e como se comunica.
- [ROS 2 Documentation: Topics vs Services vs Actions](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/Topics-Services-Actions.html): quando usar cada tipo de interface.
- [ROS 2 Documentation: Actions](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/About-Actions.html): goals, feedback, resultados e cancelamento.
- [ROS 2 tutorial: Writing a simple publisher and subscriber (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/client-libraries/Working-with-Client-Libraries/Writing-A-Simple-Py-Publisher-And-Subscriber.html): o talker e o listener do Exemplo 2.
- [ROS 2 tutorial: Writing a simple service and client (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/client-libraries/Working-with-Client-Libraries/Writing-A-Simple-Py-Service-And-Client.html): o servidor e o cliente AddTwoInts do Exemplo 3.
- [ROS 2 tutorial: Writing an action server and client (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/actions/Working-with-actions/Writing-an-Action-Server-Client/Py.html): a ação Fibonacci do Exemplo 4.
- [ros2_control: joint trajectory controller](https://control.ros.org/lyrical/doc/ros2_controllers/joint_trajectory_controller/doc/userdoc.html): a ação FollowJointTrajectory, tolerâncias e preempção.
- [MoveIt 2: low-level controllers](https://moveit.picknik.ai/main/doc/examples/controller_configuration/controller_configuration_tutorial.html): como o MoveIt envia trajetórias ao controlador.
- [ABB: Technical reference manual, RAPID overview](https://library.e.abb.com/public/4b22867e301345528bfa6c0b50633795/3HAC050947%20TRM%20RAPID%20Overview%20RW%206-en.pdf): instruções de posicionamento, interpolações e caminhos de canto.
- [Universal Robots: URScript motion module](https://www.universal-robots.com/manuals/EN/HTML/SW5_23/Content/prod-scriptmanual/all_scripts/Module_otion.htm): as funções de movimento e a taxa do runtime.
- [Universal Robots: movej](https://www.universal-robots.com/manuals/EN/HTML/SW5_23/Content/prod-scriptmanual/all_scripts/movej_qa14v105t0r.htm): o trapézio do eixo líder e o raio de transição.
- [Villani et al., Survey on human-robot interaction for robot programming in industrial applications (IFAC INCOM 2018 slides)](https://tc.ifac-control.org/5/3/activities/past/presentations-incom-2018/MoAT2%20-%20INCOM2018_Robot_programming.pdf): pendant, offline e condução manual comparados.
