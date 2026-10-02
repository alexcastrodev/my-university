---
version: 1.0
updatedAt: 2026-09-06
title: "Escalonamento de CPU: Objetivos e Métricas"
summary: "Antes de comparar políticas de escalonamento, é preciso fixar o que 'bom' significa: tempo de retorno, tempo de resposta e vazão muitas vezes competem entre si, então nenhuma política vence em todas as métricas ao mesmo tempo."
---
## Objetivos de Aprendizagem

- Definir tempo de retorno (turnaround), tempo de resposta e vazão como três métricas distintas que um escalonador de CPU pode otimizar.
- Explicar por que essas métricas muitas vezes competem entre si, de modo que nenhuma política é incondicionalmente a melhor.
- Distinguir as suposições de carga de trabalho (as tarefas chegam todas juntas, rodam até terminar, só usam a CPU) do escalonamento do mundo real, e explicar por que suposições simplificadas ainda são úteis para comparar políticas.
- Calcular o tempo de retorno e o tempo de retorno médio para um conjunto pequeno e concreto de tarefas.

## Contexto e Motivação

Agora que um processo pode ser criado (`fork`/`exec`) e pausado e retomado (troca de contexto), resta uma pergunta genuinamente em aberto: quando há mais processos prontos do que CPUs, em que ordem o SO deve de fato rodá-los? Esse é o problema do **escalonamento de CPU** e, antes de comparar qualquer política específica, é preciso fixar o que um "bom" escalonamento significa, porque, como este conceito e os quatro seguintes vão mostrar concretamente, objetivos diferentes e de aparência razoável podem apontar para políticas diferentes, às vezes opostas.

O OSTEP introduz isso com um conjunto deliberadamente simplificado de suposições de carga de trabalho (toda tarefa roda por um tempo conhecido, chega no mesmo momento, roda até terminar sem bloquear e só usa a CPU), não porque cargas reais sejam assim, mas porque uma métrica limpa e comparável exige primeiro um cenário limpo e comparável. Cada uma dessas suposições simplificadoras é relaxada, uma de cada vez, ao longo dos próximos conceitos, e as métricas definidas aqui continuam sendo a régua usada o tempo todo: este é o sistema de pontuação com o qual toda política de escalonamento seguinte desta disciplina é avaliada.

## Teoria Central

### Três métricas, três perguntas diferentes

- O **tempo de retorno** (turnaround) responde "quanto tempo esta tarefa levou, do início ao fim?"; formalmente, `instante de término − instante de chegada`. É a métrica com que uma tarefa em lote (um relatório noturno, um pipeline de dados) normalmente mais se importa: o tempo total decorrido até o trabalho ficar pronto.
- O **tempo de resposta** responde "quanto tempo até a tarefa receber algum tempo de CPU pela primeira vez?"; formalmente, `primeiro instante escalonada − instante de chegada`. É a métrica com que um programa interativo (um shell, um editor de texto) mais se importa: um usuário digitando um comando quer ver *alguma coisa* acontecer rápido, mesmo que o cálculo completo ainda não tenha terminado.
- A **vazão** (throughput) responde "quanto trabalho é feito por unidade de tempo, no sistema inteiro?"; mais ou menos, tarefas completadas por segundo. É a métrica com que um servidor ocupado atendendo muitas requisições curtas mais se importa.

Essas não são três formas de medir a mesma coisa: elas podem discordar, e muitas vezes discordam, sobre qual política é "a melhor". Uma política que minimiza o tempo de retorno médio pode produzir um tempo de resposta péssimo para algumas tarefas (fazendo-as esperar muito antes de sequer começar, mesmo que os tempos de término acabem dando uma boa média), e vice-versa.

### Por que as suposições simplificadas vêm primeiro

As suposições iniciais do OSTEP (tarefas que se sabe de antemão que rodam por um tempo fixo, todas chegando ao mesmo tempo, rodando até terminar sem E/S, usando só a CPU) são irreais de propósito. Elas permitem que as primeiríssimas políticas de escalonamento sejam comparadas por um único número limpo (o tempo de retorno), sem a complexidade extra de instantes de chegada imprevisíveis ou de tarefas que pausam para esperar E/S. Cada conceito seguinte relaxa exatamente uma dessas suposições: primeiro os instantes de chegada passam a ser escalonados, depois o tempo de resposta vira a preocupação que motiva o round-robin, depois a imprevisibilidade motiva abordagens baseadas em realimentação (filas multinível com realimentação). O mundo simplificado deste conceito é andaime, não o quadro final.

### Por que as métricas competem entre si

Minimizar o tempo de retorno médio, com todo o resto igual, favorece rodar tarefas curtas antes das longas: tirar as curtas da frente rápido, para que não fiquem esperando atrás de algo muito maior. Mas essa mesma política pode deixar o tempo de resposta péssimo para a tarefa que por acaso for longa, já que ela pode nem começar até que toda tarefa mais curta que chegou já tenha terminado. Ao contrário, uma política construída puramente para um tempo de resposta rápido (dar rapidamente *algum* tempo de CPU a toda tarefa antes de terminar qualquer uma delas) tende a aumentar o tempo de retorno médio em comparação com rodar as tarefas até o fim numa ordem bem escolhida, já que a troca constante acrescenta sobrecarga e atrasa o término real de cada tarefa individual.

```mermaid
flowchart LR
    Goal1["Minimizar o tempo de retorno"] -->|favorece| Policy1["Rodar as tarefas curtas primeiro,\naté terminar"]
    Goal2["Minimizar o tempo de resposta"] -->|favorece| Policy2["Dar rapidamente uma fatia a\ntoda tarefa, depois revezar"]
    Policy1 -.->|prejudica| Goal2
    Policy2 -.->|prejudica| Goal1
```

## Exemplos Resolvidos

### Exemplo 1: calculando o tempo de retorno de três tarefas rodadas na ordem de chegada

Três tarefas, A, B, C, chegam todas no instante 0 (pela suposição simplificada) com estes tempos de execução, e são executadas estritamente nessa ordem (primeiro a chegar, primeiro a ser atendido, o assunto do próximo conceito):

```text
Tarefa   Execução   Começa   Termina   Retorno (término - chegada)
A        10         0        10        10 - 0 = 10
B        10         10       20        20 - 0 = 20
C        10         20       30        30 - 0 = 30

Tempo de retorno médio = (10 + 20 + 30) / 3 = 20
```

### Exemplo 2: as mesmas três tarefas, reordenadas: mesmo trabalho total, média diferente

Não mude nada nas próprias tarefas, só a ordem em que rodam: as mesmas três tarefas, o mesmo tempo total de execução, rodadas da mais curta para a mais longa:

```text
Tarefa   Execução   Começa   Termina   Retorno
A        10         0        10        10
B        10         10       20        20
C        10         20       30        30

(As três tarefas por acaso têm o mesmo tempo de execução aqui, então
 reordenar não muda nada, e isso é intencional: mostra que, quando as
 tarefas têm o mesmo tamanho, a ordem de chegada não importa para o
 tempo de retorno médio. O próximo conceito apresenta tarefas de tamanhos
 diferentes, em que a ordem de repente importa enormemente.)
```

### Exemplo 3: tempo de resposta e tempo de retorno podem discordar

Duas tarefas chegam no instante 0: a tarefa X leva 1 unidade de tempo de CPU, a tarefa Y leva 19 unidades. Compare rodar X primeiro com rodar Y primeiro:

```text
Rodar X e depois Y:
  X: começa 0,  termina 1,  retorno 1,  resposta 0
  Y: começa 1,  termina 20, retorno 20, resposta 1
  Retorno médio  = (1 + 20) / 2 = 10.5
  Resposta média = (0 + 1) / 2 = 0.5

Rodar Y e depois X:
  Y: começa 0,  termina 19, retorno 19, resposta 0
  X: começa 19, termina 20, retorno 20, resposta 19
  Retorno médio  = (19 + 20) / 2 = 19.5
  Resposta média = (0 + 19) / 2 = 9.5
```

Rodar a tarefa curta primeiro dá um tempo de retorno médio dramaticamente melhor (10.5 contra 19.5) *e* um tempo de resposta médio melhor (0.5 contra 9.5) neste caso específico; mas o próximo conceito mostra um cenário (o efeito comboio) em que uma tarefa longa que chega primeiro de fato bloqueia as tarefas curtas atrás dela, motivando o menor-tarefa-primeiro como política explícita, e não como algo que por acaso dá certo.

## Equívocos Comuns e Armadilhas

- **"Um bom escalonador só minimiza o tempo total; há um único número para otimizar."** Há pelo menos três métricas distintas e às vezes conflitantes (retorno, resposta, vazão); uma política ajustada para uma pode se sair mal em outra, e é exatamente por isso que existem várias políticas de escalonamento diferentes, e não uma obviamente correta.
- **"Tempo de resposta e tempo de retorno medem a mesma coisa, só com nomes diferentes."** O tempo de retorno trata do tempo total decorrido até *terminar*; o tempo de resposta trata do tempo decorrido até *começar pela primeira vez*. Uma tarefa pode ter um tempo de resposta excelente (começou na hora) e um tempo de retorno medíocre (depois foi interrompida repetidas vezes e demorou para de fato terminar), ou o contrário.
- **"As suposições de carga simplificadas (tarefas conhecidas de antemão, chegando juntas, sem E/S) significam que este material não se aplica a escalonadores reais."** As suposições são andaimes deliberadamente temporários, relaxados um de cada vez nos conceitos seguintes; as métricas definidas aqui (retorno, resposta, vazão) continuam sendo a régua usada o tempo todo, mesmo quando as suposições ficam realistas.
- **"Vazão e tempo de retorno sempre andam juntos."** Um escalonador poderia terminar tarefas uma de cada vez de forma muito eficiente (boa vazão) enquanto ainda faz algumas tarefas individuais esperar muito tempo em relação ao seu próprio tempo de execução (justiça ruim de retorno para essas tarefas específicas); as duas métricas olham para coisas diferentes (término agregado por tempo, contra tempo decorrido por tarefa).

## Resumo

As políticas de escalonamento de CPU são avaliadas por pelo menos três métricas distintas: tempo de retorno (tempo decorrido até terminar, a partir da chegada), tempo de resposta (tempo decorrido até receber a CPU pela primeira vez, a partir da chegada) e vazão (tarefas completadas por unidade de tempo); e essas métricas podem conflitar, então nenhuma política de escalonamento é incondicionalmente a melhor em todas elas. A carga de trabalho simplificada inicial do OSTEP (tarefas de tamanho conhecido, chegando juntas, rodando até terminar sem E/S) existe puramente para permitir que as primeiras políticas sejam comparadas de forma limpa pelo tempo de retorno, com cada suposição irreal relaxada uma de cada vez pelos conceitos seguintes. O vocabulário deste conceito e suas três métricas são a régua constante que o resto deste bloco usa: FCFS, SJF, round-robin, escalonamento por prioridade e filas multinível com realimentação são todas, no fim, respostas diferentes sobre qual desses objetivos priorizar e como.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf): o tratamento canônico das métricas de escalonamento e das suposições de carga simplificadas a partir do qual este conceito é construído.
- [ACM/IEEE CS2013: Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/): diretrizes curriculares que estabelecem as métricas de escalonamento e a comparação de políticas como conteúdo central de Sistemas Operacionais.
