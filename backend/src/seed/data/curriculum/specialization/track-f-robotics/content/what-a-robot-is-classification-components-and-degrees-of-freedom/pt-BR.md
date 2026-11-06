---
version: 1.0
updatedAt: 2026-11-04
title: "O Que É um Robô: Classificação, Componentes e Graus de Liberdade"
summary: "O que conta como robô; elos, juntas, atuadores, sensores e efetuadores finais; a classificação de manipuladores pelas juntas; e a contagem de graus de liberdade."
---
## Objetivos de Aprendizagem

- Enunciar a definição de robô industrial da ISO 8373 tal como a International Federation of Robotics (IFR) a apresenta, e distinguir um robô de um dispositivo robótico, como um braço teleoperado.
- Nomear as partes de um manipulador: elos, juntas, atuadores, transmissões, sensores e efetuador final.
- Classificar manipuladores pelo tipo e pela disposição das juntas: cartesiano, cilíndrico, polar, SCARA, articulado e paralelo.
- Contar graus de liberdade com a fórmula de Grübler e dizer de que hipóteses a contagem depende.
- Reconhecer os casos em que a contagem erra e conferir uma contagem com o posto do jacobiano de restrições.

## Contexto e Motivação

Toda lição seguinte desta trilha calcula alguma coisa a partir das variáveis de junta: uma pose, uma velocidade, um torque. Antes disso, duas perguntas precisam de resposta. Que tipo de máquina está sendo modelada, e quantos números independentes descrevem a sua configuração? Esse número, os graus de liberdade (dof, de degrees of freedom), é quantos valores de junta um controlador precisa definir, e um robô com menos de 6 não consegue colocar uma ferramenta numa posição e orientação arbitrárias no espaço.

A contagem parece contabilidade, e para um braço serial é mesmo: some as liberdades das juntas. Para mecanismos com laços fechados, a fórmula padrão pode devolver 0 para um mecanismo que visivelmente se move, ou um número negativo para um que se move com um grau de liberdade. Os dois casos aparecem resolvidos abaixo, com os números produzidos por um script.

## Teoria Central

### O que conta como robô

O padrão de vocabulário é a ISO 8373:2021. O texto é vendido; a IFR publica um resumo gratuito, que dá a definição de robô industrial como um "automatically controlled, reprogrammable multipurpose manipulator, programmable in three or more axes, which can be either fixed in place or fixed to a mobile platform for use in automation applications in an industrial environment". Reprogramável quer dizer que os movimentos podem mudar sem alterar o mecanismo. Um robô de serviço, no mesmo resumo, é um "robot in personal use or professional use that performs useful tasks for humans or equipment", e a ISO 8373:2021 acrescenta os robôs médicos como terceira categoria.

A IFR também relata que a ISO 8373 exige "a degree of autonomy", e chama de dispositivo robótico (robotic device) um mecanismo feito com tecnologia de robôs ao qual falta alguma das características de um robô. Os exemplos dela são um manipulador remoto teleoperado, um dispositivo háptico, um efetuador final sozinho e um exoesqueleto sem acionamento. Isso bate com a história contada nas notas de Asada do MIT 2.12: os robôs industriais nasceram do controle numérico e dos manipuladores remotos mestre-escravo, e a diferença em relação a estes é que o operador humano sai da malha de controle.

O *Modern Robotics*, de Lynch e Park, adota a visão mecânica usada nesta trilha: um robô é feito de elos rígidos ligados por juntas, as juntas são movidas por atuadores, e "an essential feature of any robot is that it moves in the physical world".

### Componentes

- **Elos**: os corpos, modelados como rígidos. Elos reais flexionam um pouco, e juntas reais têm elasticidade, folga e atrito; os modelos aqui ignoram esses efeitos.
- **Juntas**: cada uma liga exatamente dois elos. Os tipos comuns, com as liberdades $f$ e as restrições $c=m-f$ que impõem ($m=3$ no plano, $m=6$ no espaço), da Tabela 2.1 do *Modern Robotics*:

| Junta | $f$ | $c$ no plano | $c$ no espaço |
|---|---|---|---|
| Rotativa (R) | 1 | 2 | 5 |
| Prismática (P) | 1 | 2 | 5 |
| Helicoidal (H) | 1 | n/a | 5 |
| Cilíndrica (C) | 2 | n/a | 4 |
| Universal (U) | 2 | n/a | 4 |
| Esférica (S) | 3 | n/a | 3 |

- **Atuadores**: em geral motores elétricos, às vezes cilindros pneumáticos ou hidráulicos. Motores giram rápido e com pouco torque, então uma **transmissão** (engrenagens, cabos, correias, correntes) reduz a velocidade e multiplica o torque, ao preço da folga (backlash), o movimento disponível na saída sem movimento na entrada.
- **Sensores**: encoders, potenciômetros ou resolvers para a posição da junta; tacômetros para velocidade; sensores de força e torque; câmeras, câmeras de profundidade e lasers de distância para o entorno.
- **Efetuador final**: a garra ou ferramenta na ponta da cadeia, cuja posição e orientação é o que a maioria das tarefas especifica.

### Classificando manipuladores pelas juntas

Um braço serial é nomeado pela sequência de juntas a partir da base, como no *Modern Robotics*, em que um SCARA é uma cadeia RRRP. O resumo da ISO 8373 feito pela IFR classifica os robôs industriais pela estrutura mecânica:

| Classe | Definição (resumo da ISO 8373 pela IFR) | Sequência típica |
|---|---|---|
| Cartesiano (pórtico) | três juntas prismáticas cujos eixos formam um sistema cartesiano | PPP |
| Cilíndrico | pelo menos uma junta rotativa e uma prismática, formando um sistema cilíndrico | RPP |
| Polar (esférico) | duas juntas rotativas e uma prismática, formando um sistema polar | RRP |
| SCARA | duas juntas rotativas paralelas, complacente num plano escolhido | RRP (Asada), RRRP (*Modern Robotics*) |
| Articulado | três ou mais juntas rotativas | 6R |
| Paralelo (Delta) | braços com elos que formam um laço fechado | cadeia fechada |

As definições são propriedades, não sequências: a coluna da direita é um caso comum, não faz parte da norma. As três primeiras classes espelham sistemas de coordenadas, que é como as notas de Asada as apresentam. Uma **cadeia aberta** (serial) não tem laço e, no projeto usual, toda junta é atuada; uma **cadeia fechada** tem pelo menos um laço, e muitas vezes só parte das juntas é atuada.

### A fórmula de Grübler

Um corpo rígido tem 3 graus de liberdade no plano e 6 no espaço. Os graus de liberdade de um mecanismo são a soma das liberdades dos corpos menos o número de restrições independentes. Com $N$ elos contando o chão, $J$ juntas e a junta $i$ dando $f_i$ liberdades, a fórmula de Grübler (Proposição 2.2 do *Modern Robotics*) é

$$\text{dof}=m(N-1)-\sum_{i=1}^{J}c_i=m(N-1-J)+\sum_{i=1}^{J}f_i.$$

Numa cadeia aberta $J=N-1$, então os graus de liberdade são só $\sum f_i$. A contagem depende de hipóteses fáceis de violar sem perceber:

1. Cada junta liga exatamente dois elos. Três elos presos num mesmo pino são duas juntas.
2. Os elos são rígidos.
3. As restrições das juntas são independentes. Se não forem, a fórmula dá só um limite inferior.
4. $m$ corresponde ao movimento: $m=3$ só vale quando todo elo fica num mesmo plano.
5. O resultado é a dimensão do espaço de configurações, que não é o número de atuadores nem as liberdades do efetuador final.

Uma pose no espaço exige 6 números, então um braço precisa de pelo menos 6 graus de liberdade para alcançar posições e orientações arbitrárias. O *Modern Robotics* chama um braço de cinematicamente redundante quando ele tem mais juntas que a dimensão do espaço de tarefa, como um braço 7R para poses espaciais e um braço planar 3R quando só a posição da ponta importa. Os graus de liberdade são uma dimensão e não dizem nada sobre alcance: limites de junta e comprimentos de elo decidem quais poses são alcançáveis.

### Conferindo uma contagem com o posto do jacobiano de restrições

A fórmula aplica, contando, a regra graus de liberdade = variáveis menos equações independentes (Equação 2.2 do *Modern Robotics*). A mesma regra pode ser calculada. Dê a cada corpo planar móvel três coordenadas $(x,y,\phi)$, escreva cada junta rotativa como duas equações (o pino visto pelos dois corpos tem de ser o mesmo ponto) e avalie o jacobiano $A$ das restrições numa configuração montada. Então

$$\text{dof local}=(\text{número de variáveis})-\operatorname{posto}A.$$

O posto conta só as restrições independentes, que é o que a hipótese 3 pede. Duas ressalvas: o posto descreve o movimento de primeira ordem naquela configuração, e numa configuração singular ele pode mostrar mais movimento do que o mecanismo realmente tem. Por isso um movimento alegado se confirma movendo o mecanismo e verificando que as restrições continuam satisfeitas.

## Exemplos Resolvidos

### Exemplo 1: contagens que funcionam

Do script, aplicando a fórmula:

```text
mechanism                     m   N   J   sum f   dof
planar 2R open chain          3   3   2    2       2
planar 3R open chain          3   4   3    3       3
SCARA RRRP                    6   5   4    4       4
spatial 6R open chain         6   7   6    6       6
spatial 7R open chain         6   8   7    7       7
planar four-bar               3   4   4    4       1
planar slider-crank           3   4   4    4       1
planar five-bar               3   5   5    5       2
Stewart-Gough, UPS legs       6  14  18   36       6
Stewart-Gough, SPS legs       6  14  18   42      12
Delta                         6  17  21   45      15
```

As cadeias abertas dão $\sum f_i$, como esperado. O quatro-barras precisa de um atuador e o cinco-barras de dois, com as outras três juntas passivas, como no robô de cinco barras das notas de Asada.

As duas últimas linhas mostram a hipótese 5 em ação. Com juntas esféricas nas duas pontas de cada perna da plataforma de Stewart-Gough, a contagem é 12, porque cada perna pode girar em torno do próprio eixo sem mover a plataforma; a plataforma continua com 6. No robô Delta, o *Modern Robotics* atribui 12 dos 15 à torção dos elos dos paralelogramos em torno dos eixos longos, então a plataforma móvel tem 3: ela fica paralela à base e o Delta funciona como um posicionador $x$-$y$-$z$. Um quatro-barras planar com o jacobiano de restrições calculado com a manivela a 60° (chão 2, manivela 1, acoplador 2, balancim 1,5, em qualquer unidade) tem 9 variáveis, posto 8 e 1 grau de liberdade local, de acordo com a fórmula.

### Exemplo 2: um mecanismo que se move quando a fórmula diz que não pode

Considere um paralelogramo com três manivelas: pinos no chão em $(0,0)$, $(1,0)$ e $(2,0)$, três manivelas de comprimento 1 e um acoplador preso às três pontas. Então $N=5$ e $J=6$, e

$$\text{dof}=3(5-1-6)+6=0,$$

uma estrutura rígida. Com as manivelas a 60°, o jacobiano de restrições é $12\times12$:

```text
                      variables  equations  rank  local dof  smallest singular value
parallelogram             12         12      11       1           4.9e-17
third pin at (2,-0.5)     12         12      12       0           2.5e-02
```

O posto é 11, então uma restrição é dependente e o grau de liberdade local é 1. O vetor do núcleo tem taxas iguais para os três ângulos de manivela e velocidade do acoplador $(-0{,}866;\,0{,}5)$ por radiano, sem rotação: as manivelas giram juntas e o acoplador translada. O movimento é finito, não só de primeira ordem: com as manivelas a 20°, 100° e 150° e o acoplador transladado de acordo, o maior resíduo das restrições é 0,0 em float64. Mover o terceiro pino do chão para $(2,-0{,}5)$ (essa manivela passa a ter 1,4547 a 69,90°, ainda montada) torna as restrições independentes, o posto vira 12 e o mecanismo fica rígido, como Grübler prevê para o caso genérico. O 0 da fórmula era um limite inferior, exatamente o que a hipótese 3 avisa.

### Exemplo 3: o mesmo quatro-barras, contado no espaço

Monte o quatro-barras do Exemplo 1 em três dimensões, com os quatro eixos rotativos paralelos a $z$. Com $m=6$:

$$\text{dof}=6(4-1-4)+4=-2.$$

Uma contagem negativa sugere uma estrutura que não se move, e no entanto é o mesmo quatro-barras físico. O jacobiano espacial de restrições tem 18 variáveis (6 por elo móvel) e 20 equações (3 do ponto coincidente e 2 de eixos paralelos em cada junta):

```text
variables 18   equations 20   rank 17   local dof 1
```

Três das 20 equações decorrem das outras, porque eixos paralelos já mantêm todos os elos no plano. O quatro-barras se move com 1 grau de liberdade, e $-2$ era de novo só um limite inferior. Restringir ao plano remove 9 variáveis e 12 equações, e as 3 equações a mais são justamente as dependentes, por isso a contagem planar acertou.

## Equívocos Comuns e Armadilhas

- **"Número de juntas é igual aos graus de liberdade."** Em cadeias fechadas algumas juntas são passivas: o cinco-barras do Exemplo 1 tem 5 juntas e 2 graus de liberdade, e os 15 do Delta incluem 12 torções internas.
- **"A fórmula de Grübler dá os graus de liberdade."** Dá só quando as restrições são independentes; caso contrário, é um limite inferior. O Exemplo 2 deu 0 para um mecanismo com 1.
- **"Contagem negativa quer dizer que o mecanismo não se move."** O Exemplo 3 deu $-2$ para um quatro-barras que se move.
- **"Seis graus de liberdade alcançam qualquer pose."** Graus de liberdade contam dimensões. Alcance e limites de junta decidem quais poses são alcançáveis, e as configurações singulares estudadas adiante restringem como o braço se move perto de algumas delas.
- **"Um mecanismo com cara de planar sempre pode ser contado com $m=3$."** Só se todo elo ficar no plano. Contado com $m=6$, o Exemplo 3 mostra como as duas contagens se relacionam.
- **"Um braço teleoperado é um robô."** No vocabulário que a IFR relata da ISO 8373, um manipulador remoto teleoperado aparece como dispositivo robótico, não como robô.

## Resumo

A ISO 8373, no resumo da IFR, define robô industrial como um manipulador controlado automaticamente, reprogramável e programável em três ou mais eixos, e chama de dispositivos robóticos os mecanismos aos quais falta alguma característica de robô, como manipuladores teleoperados. Um manipulador é feito de elos rígidos e juntas, movido por atuadores através de transmissões, medido por sensores e terminado num efetuador final. As classes seguem as juntas: cartesiano, cilíndrico, polar, SCARA, articulado e paralelo. A fórmula de Grübler $m(N-1-J)+\sum f_i$ conta a dimensão do espaço de configurações quando cada junta liga dois elos, os elos são rígidos, $m$ corresponde ao movimento e as restrições são independentes. Quando não são, ela é só um limite inferior: um paralelogramo contou 0 e se moveu com 1, e um quatro-barras contado no espaço deu $-2$ e também se moveu com 1. O posto do jacobiano de restrições, confirmado movendo de fato o mecanismo, pega os dois casos.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): o livro-texto gratuito, os vídeos e o software usados ao longo desta trilha.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): o Capítulo 1 sobre os componentes de um robô e o Capítulo 2 sobre graus de liberdade, tipos de junta, a fórmula de Grübler e os casos em que ela falha.
- [IFR, Industrial Robots](https://ifr.org/industrial-robots): a definição de robô industrial da ISO 8373:2021 e a classificação por estrutura mecânica.
- [IFR, Service Robots](https://ifr.org/service-robots): as definições da ISO 8373 de robô de serviço, grau de autonomia e dispositivo robótico.
- [MIT OCW 2.12 Introduction to Robotics, lecture notes (Asada)](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/pages/lecture-notes/): as origens dos robôs industriais, as juntas primitivas, os tipos de robô análogos a sistemas de coordenadas e os mecanismos paralelos.
