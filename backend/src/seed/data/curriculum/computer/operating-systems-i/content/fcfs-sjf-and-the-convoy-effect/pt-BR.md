---
version: 1.0
updatedAt: 2026-09-06
title: FCFS, SJF e o Efeito Comboio
summary: "O primeiro-a-chegar-primeiro-a-ser-atendido é trivialmente justo, mas deixa uma única tarefa longa bloquear todas as tarefas curtas atrás dela (o efeito comboio), enquanto o menor-tarefa-primeiro corrige de forma comprovada o tempo de retorno médio, ao custo de precisar conhecer o futuro."
---
## Objetivos de Aprendizagem

- Descrever o escalonamento primeiro a chegar, primeiro a ser atendido (FCFS) e calcular os tempos de retorno de um conjunto concreto de tarefas rodando sob ele.
- Descrever o efeito comboio: como uma tarefa longa rodando antes de várias curtas infla o tempo de retorno médio sob FCFS.
- Descrever o escalonamento menor tarefa primeiro (SJF) e explicar por que ele minimiza de forma comprovada o tempo de retorno médio quando todas as tarefas chegam juntas.
- Explicar a limitação prática do SJF (precisar conhecer os tempos de execução de antemão), que motiva as políticas posteriores deste bloco.

## Contexto e Motivação

Com as métricas de escalonamento do conceito anterior fixadas, a política mais simples possível também é a que soa mais justa: rodar as tarefas na ordem em que chegam, exatamente como uma fila numa loja. Esse é o **primeiro a chegar, primeiro a ser atendido (FCFS)**, e ele tem virtudes reais: é simples de implementar e nunca deixa uma tarefa "furar a fila". Mas o próprio exemplo resolvido do OSTEP mostra um cenário concreto em que essa justiça pela ordem de chegada produz ativamente um tempo de retorno médio péssimo, um modo de falha com nome próprio: o **efeito comboio**. A correção, o **menor tarefa primeiro (SJF)**, troca a "justiça pela ordem de chegada" pela "justiça pela quantidade de trabalho" e vence de forma comprovada no tempo de retorno médio, sob as suposições ainda simplificadas deste conceito, a um custo que vira o tema recorrente do resto deste bloco.

## Teoria Central

### Primeiro a chegar, primeiro a ser atendido: simples, mas vulnerável a um caso ruim

Com o FCFS, as tarefas rodam estritamente na ordem de chegada, cada uma até terminar, antes de a próxima começar. Quando as tarefas por acaso têm tamanhos parecidos, o FCFS se sai razoavelmente: como o Exemplo 2 do conceito anterior mostrou, tarefas de mesmo tamanho dão o mesmo tempo de retorno médio, seja qual for a ordem. O problema está inteiramente no que acontece quando os tamanhos das tarefas diferem.

### O efeito comboio

Suponha que uma tarefa muito longa chegue logo antes de várias curtas. Com o escalonamento estritamente pela ordem de chegada, cada uma dessas tarefas curtas precisa esperar a tarefa longa inteira terminar primeiro, mesmo que, individualmente, cada tarefa curta precise de só uma fração minúscula desse tempo para terminar sozinha. O OSTEP chama isso de **efeito comboio**, fazendo a analogia com um veículo lento numa estrada que obriga uma longa fila de tráfego mais rápido a se arrastar atrás dele, sem conseguir ultrapassar. As tarefas curtas não são lentas: estão presas atrás de algo lento, só por causa do momento em que esse algo por acaso chegou.

### Menor tarefa primeiro: corrigindo o efeito comboio reordenando

A regra do SJF é simples: entre as tarefas disponíveis para rodar no momento, sempre rodar em seguida a que tiver o menor tempo de execução restante. Sob a suposição simplificada de que todas as tarefas chegam de uma vez e rodam até terminar, essa política minimiza de forma comprovada o tempo de retorno médio, um fato que decorre de um argumento geral de troca (o mesmo estilo de raciocínio já usado para provar a correção de algoritmos gulosos na disciplina `algorithms-software/algorithms` desta plataforma): trocar quaisquer duas tarefas adjacentes de modo que a mais curta rode primeiro só pode diminuir, nunca aumentar, a soma dos tempos de retorno, porque isso diminui o tempo de espera de cada tarefa atrás dela na fila e acrescenta igualmente pouco na frente. Repetir essa troca até que nenhuma tarefa mais curta rode depois de uma mais longa produz a ordem da mais curta primeiro, que, portanto, precisa ser ótima para a soma (e, por consequência, para a média).

### A limitação real do SJF: ele precisa conhecer o futuro

A prova de otimalidade do SJF supõe que o escalonador já conhece de antemão o tempo de execução exato de cada tarefa. Na prática, o SO normalmente não sabe quanto tempo um processo vai rodar antes de ele de fato terminar ou bloquear: um processo pode estar prestes a fazer mais um milissegundo de trabalho, ou uma hora, e nada no próprio processo declara isso de antemão. Essa única limitação (e não alguma falha no raciocínio acima) é o que motiva toda política de escalonamento vista a seguir nesta disciplina: o round-robin contorna por completo a necessidade de conhecer os tempos de execução, e as filas multinível com realimentação, mais adiante, *estimam* o tamanho provável de uma tarefa a partir do comportamento recente observado de um processo, em vez de exigi-lo de antemão.

## Exemplos Resolvidos

### Exemplo 1: o efeito comboio, com números reais

Três tarefas chegam juntas no instante 0: A leva 100 unidades, B e C levam 10 unidades cada. Rodando sob FCFS na ordem de chegada A, B, C:

```text
Tarefa   Execução   Começa   Termina   Retorno
A        100        0        100       100
B        10         100      110       110
C        10         110      120       120

Retorno médio = (100 + 110 + 120) / 3 = 110
```

B e C, apesar de precisarem de só 10 unidades de trabalho cada, acabam com tempos de retorno de 110 e 120, gastos quase inteiramente esperando atrás de A, que não tinha nada a ver com a carga de trabalho real de nenhuma das duas. Esse é o efeito comboio tornado concreto.

### Exemplo 2: as mesmas três tarefas sob SJF

As mesmas três tarefas, o mesmo instante de chegada, reordenadas pelo SJF para rodar da mais curta para a mais longa: B, C, A.

```text
Tarefa   Execução   Começa   Termina   Retorno
B        10         0        10        10
C        10         10       20        20
A        100        20       120       120

Retorno médio = (10 + 20 + 120) / 3 = 50
```

O retorno médio cai de 110 (FCFS) para 50 (SJF), mais da metade, usando exatamente as mesmas três tarefas e exatamente a mesma quantidade total de trabalho, só reordenando para rodar as tarefas curtas primeiro. O próprio tempo de retorno de A não muda (ela sempre levaria 100 unidades depois de começar, e continua terminando em 120 de qualquer jeito); a melhora inteira vem de B e C não ficarem mais presas atrás dela.

### Exemplo 3: por que o argumento de troca funciona, acompanhado concretamente

Pegue qualquer escalonamento com uma tarefa mais longa imediatamente seguida de uma mais curta e troque as duas. Antes da troca, com tamanhos 100 e depois 10, começando no instante 0:

```text
Antes da troca:  100 primeiro, depois 10
  Tarefa1 (100): retorno 100
  Tarefa2 (10):  retorno 110
  Soma = 210

Depois da troca: 10 primeiro, depois 100
  Tarefa2 (10):  retorno 10
  Tarefa1 (100): retorno 100
  Soma = 110
```

A troca diminuiu estritamente a soma dos tempos de retorno (210 → 110): o retorno da própria tarefa mais curta caiu bruscamente (110 → 10), enquanto o retorno da tarefa mais longa ficou exatamente igual (100 → 100, já que ela ainda precisa rodar suas 100 unidades completas, seja o que for que rodou antes). Repetir esse argumento para cada inversão adjacente em qualquer escalonamento mostra que o mais-curto-primeiro nunca pode ser superado por um escalonamento que contenha um único par adjacente "mais longa antes da mais curta"; é exatamente a técnica de prova por argumento de troca.

## Equívocos Comuns e Armadilhas

- **"O FCFS é injusto porque não roda as tarefas numa boa ordem."** O FCFS é justo num sentido específico e legítimo (nunca deixa uma tarefa passar na frente de outra que chegou antes); seu problema não é a injustiça, mas que essa regra de justiça específica pode produzir um tempo de retorno *médio* muito ruim quando os tamanhos das tarefas diferem bastante, como o efeito comboio mostra.
- **"O efeito comboio é sobre a própria tarefa longa rodar devagar."** O tempo de retorno da própria tarefa longa não é afetado pelo que roda antes ou depois dela (ela sempre precisa do seu tempo de execução completo). O efeito comboio é especificamente sobre tarefas *curtas* serem forçadas a esperar atrás de uma longa com a qual não têm nada a ver.
- **"O SJF é comprovadamente ótimo, então os sistemas operacionais reais deveriam simplesmente usá-lo."** A prova de otimalidade do SJF depende de conhecer de antemão o tempo de execução exato de cada tarefa, informação que um SO real geralmente não tem para um processo que ainda não terminou (nem começou) a rodar. Essa lacuna prática, e não uma falha na matemática, é o motivo de escalonadores reais usarem outras políticas.
- **"O menor tarefa primeiro é a mesma coisa que o round-robin com fatias de tempo muito curtas."** São políticas diferentes, com suposições diferentes: o SJF roda uma tarefa escolhida até terminar depois de selecioná-la e exige conhecer os tempos de execução de antemão; o round-robin (o próximo conceito) roda cada tarefa por uma fatia limitada e reveza entre elas, sem precisar de conhecimento prévio do tempo de execução.

## Resumo

O escalonamento primeiro a chegar, primeiro a ser atendido é simples e preserva a justiça pela ordem de chegada, mas é vulnerável ao **efeito comboio**: uma única tarefa longa chegando antes de várias curtas força cada tarefa curta a esperar o tempo de execução inteiro da longa, inflando dramaticamente o tempo de retorno médio, embora as tarefas curtas precisem individualmente de muito pouco trabalho. O menor tarefa primeiro corrige isso rodando sempre a tarefa disponível com menos trabalho restante e, sob a suposição de que todas as tarefas chegam juntas, minimiza de forma comprovada o tempo de retorno médio por meio de um argumento de troca: trocar qualquer par adjacente mais longa antes da mais curta só pode reduzir o total. A limitação real do SJF é precisar conhecer de antemão o tempo de execução de cada tarefa, informação que um escalonador real raramente tem, uma lacuna que os dois próximos conceitos tratam diretamente, primeiro descartando por completo a necessidade de conhecer o futuro (round-robin), depois inferindo o comportamento provável das tarefas a partir do que foi de fato observado (filas multinível com realimentação).

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf): o tratamento canônico do FCFS, do efeito comboio e do SJF a partir do qual este conceito é construído.
- [UC Berkeley CS162: Operating Systems and Systems Programming](https://cs162.org/): curso que cobre as mesmas comparações de políticas de escalonamento como parte dos seus fundamentos de sistemas.
