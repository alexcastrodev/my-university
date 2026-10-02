---
version: 1.0
updatedAt: 2026-09-06
title: Round-Robin e Fatias de Tempo
summary: "Dar a toda tarefa uma fatia de tempo pequena e fixa e revezar entre elas: excelente para o tempo de resposta, pior para o tempo de retorno que o SJF, e a primeira política desta disciplina que não precisa prever o futuro."
---
## Objetivos de Aprendizagem

- Descrever o escalonamento round-robin: fatias de tempo fixas, revezando entre as tarefas prontas, sem precisar conhecer de antemão os tempos de execução.
- Calcular o tempo de resposta e o tempo de retorno de um conjunto concreto de tarefas sob round-robin, e comparar com o SJF nas mesmas tarefas.
- Explicar o trade-off que o round-robin faz: tempo de resposta excelente, ao custo de um tempo de retorno pior que o do SJF para cargas equivalentes.
- Explicar como a própria escolha do tamanho da fatia de tempo troca tempo de resposta por sobrecarga de troca de contexto.

## Contexto e Motivação

A fraqueza central do SJF (precisar conhecer o tempo de execução de cada tarefa antes mesmo de ela começar) o descarta como resposta completa para um escalonador real de propósito geral. O round-robin (RR) contorna o problema por completo fazendo uma pergunta diferente: em vez de "qual tarefa é a mais curta?", ele pergunta "como garantir que toda tarefa pronta receba *algum* tempo de CPU em breve?". A resposta é uma fatia de tempo fixa (um quantum de escalonamento) e um rodízio por todas as tarefas prontas, dando a cada uma essa fatia antes de passar para a próxima. Nenhuma tarefa precisa declarar seu tamanho de antemão; o escalonador simplesmente continua revezando.

Esta é a primeira política desta disciplina otimizada explicitamente para o **tempo de resposta**, e não para o tempo de retorno, e os próprios números do OSTEP tornam o trade-off vívido: o round-robin pode transformar o tempo de resposta de algo péssimo sob o SJF em algo quase instantâneo, enquanto deixa o tempo de retorno médio mensuravelmente pior para o mesmíssimo conjunto de tarefas. Nenhuma das políticas é simplesmente melhor: elas otimizam coisas diferentes, exatamente como o conceito de objetivos e métricas previu.

## Teoria Central

### A regra do round-robin

O round-robin roda cada tarefa pronta por uma **fatia de tempo** fixa (também chamada de quantum de escalonamento, comumente de alguns a dezenas de milissegundos em sistemas reais) e então, tenha a tarefa terminado ou não, move-a para o fim da fila de prontos e dá a CPU à próxima tarefa da fila. Esse ciclo se repete até que toda tarefa acabe terminando. Ao contrário do SJF, o round-robin não precisa de nenhuma informação sobre quanto tempo cada tarefa vai levar: ele trata toda tarefa pronta de forma idêntica, uma fatia de cada vez, seja qual for o tamanho.

### Por que o round-robin vence no tempo de resposta

Como toda tarefa pronta tem sua vez dentro de, no pior caso, uma passada completa pela fila de prontos inteira, nenhuma tarefa espera um tempo arbitrariamente longo antes da sua *primeira* fatia de tempo de CPU, que é exatamente o que o tempo de resposta mede. Compare isso com o SJF (ou o FCFS), em que uma tarefa poderia, em princípio, ficar na fila pela duração inteira de todas as tarefas escalonadas na sua frente antes de receber qualquer tempo de CPU, se essas tarefas rodarem até terminar primeiro.

### Por que o round-robin perde no tempo de retorno

Rodar toda tarefa em fatias pequenas, revezando em vez de completar uma tarefa antes de começar a próxima, significa que a maioria das tarefas *termina* mais tarde do que terminaria sob uma política que rodasse as tarefas curtas até o fim primeiro (o SJF). Revezar as tarefas também acrescenta sobrecarga real: cada troca entre tarefas custa uma troca de contexto (exatamente o mecanismo de salvar e restaurar já visto), e essa sobrecarga é perda pura: tempo gasto trocando é tempo que não é gasto calculando o trabalho real de nenhuma tarefa. Quanto mais curta a fatia de tempo, mais trocas acontecem no total para o mesmo trabalho total, e mais dessa sobrecarga se acumula.

### O trade-off do tamanho da fatia de tempo

Escolher a própria fatia de tempo é um trade-off, independentemente de quais tarefas estão rodando:

- Uma fatia **curta demais** deixa o tempo de resposta excelente (toda tarefa recebe sua vez quase de imediato), mas a fração do tempo total gasta com sobrecarga de troca de contexto fica grande em relação ao trabalho real feito; a amortização sofre, no mesmo espírito do raciocínio de custo amortizado já visto para estruturas de dados em disciplinas anteriores desta plataforma, só que funcionando na direção *errada* aqui: trocas demais significam trabalho real de menos feito por troca.
- Uma fatia **longa demais** reduz a sobrecarga (menos trocas para o mesmo trabalho total), mas começa a parecer o FCFS: uma tarefa com uma fatia muito longa pode fazer toda outra tarefa pronta esperar quase a fatia inteira antes da sua própria vez, degradando o tempo de resposta de volta ao pior caso do FCFS.

Sistemas reais escolhem um tamanho de fatia (comumente na casa das poucas dezenas de milissegundos) como meio-termo prático entre esses dois modos de falha, guiados por quanto uma troca de contexto típica de fato custa em relação a quão responsivo o sistema precisa parecer para um humano.

## Exemplos Resolvidos

### Exemplo 1: tempo de resposta, round-robin vs. SJF, três tarefas mais ou menos iguais

Três tarefas A, B, C, cada uma precisando de 5 unidades de tempo de CPU, chegam todas no instante 0. Sob SJF (tamanhos iguais, então a ordem é arbitrária; digamos que A, B, C rodem até terminar nessa ordem):

```text
Estilo SJF (roda até terminar, na ordem A, B, C):
  A: começa 0,  termina 5,  resposta 0
  B: começa 5,  termina 10, resposta 5
  C: começa 10, termina 15, resposta 10
  Tempo de resposta médio = (0 + 5 + 10) / 3 = 5
```

Sob round-robin com fatia de tempo de 1 unidade, revezando A, B, C, A, B, C, ...:

```text
Round-robin (fatia = 1):
  A: começa 0, resposta 0
  B: começa 1, resposta 1
  C: começa 2, resposta 2
  Tempo de resposta médio = (0 + 1 + 2) / 3 = 1
```

O round-robin derruba o tempo de resposta médio de 5 para 1 nessa carga: toda tarefa recebe sua primeiríssima fatia de tempo de CPU dentro das três primeiras unidades de tempo, em vez de esperar que tarefas inteiras na sua frente terminem por completo.

### Exemplo 2: tempo de retorno, o custo dessa melhora (ignorando a sobrecarga de troca)

Continuando com as mesmas três tarefas de 5 unidades, round-robin com fatia = 1, ignorando a sobrecarga de troca de contexto para ficar mais claro (cada tarefa precisa de 5 fatias no total, intercaladas A, B, C, A, B, C, ... A, B, C):

```text
Round-robin (fatia = 1, sem sobrecarga):
  A termina na sua 5ª fatia, no instante 13 (suas fatias caem em t=0,3,6,9,12, terminando em 13)
  B termina na sua 5ª fatia, no instante 14
  C termina na sua 5ª fatia, no instante 15
  Retorno médio = (13 + 14 + 15) / 3 = 14
```

Compare com o retorno médio no estilo SJF para as mesmas três tarefas rodadas até terminar, em ordem:

```text
Estilo SJF: A termina em 5, B termina em 10, C termina em 15
  Retorno médio = (5 + 10 + 15) / 3 = 10
```

O tempo de retorno médio é pior sob round-robin (14 contra 10) para exatamente a mesma carga total: precisamente o trade-off descrito nos Objetivos de Aprendizagem deste conceito: um tempo de resposta muito melhor e um tempo de retorno pior, com tarefas idênticas.

### Exemplo 3: tamanho da fatia de tempo e sobrecarga de troca de contexto

Suponha que cada troca de contexto custe ela mesma 1 unidade fixa de sobrecarga pura (nenhum trabalho de tarefa é feito durante uma troca), e que uma tarefa precise de 10 unidades de trabalho total de CPU. Compare dois tamanhos de fatia:

```text
Fatia = 1:  10 trocas necessárias -> 10 unidades de sobrecarga para 10 unidades de trabalho
            (50% do tempo decorrido é sobrecarga pura)

Fatia = 10: 1 troca necessária    -> 1 unidade de sobrecarga para 10 unidades de trabalho
            (cerca de 9% do tempo decorrido é sobrecarga)
```

Uma fatia mais curta multiplica o número de trocas (e, portanto, a sobrecarga total) para a mesma quantidade de trabalho real: a mesma lógica de amortização que apareceu quando as disciplinas de Estruturas de Dados desta plataforma mostraram por que dobrar a capacidade, em vez de crescer de um elemento por vez, mantém barato, em média, o redimensionamento de arrays dinâmicos: pagar um custo fixo com frequência demais, em relação ao trabalho útil feito entre pagamentos, sai caro, seja qual for o mecanismo específico.

## Equívocos Comuns e Armadilhas

- **"O round-robin é simplesmente pior que o SJF, já que seu tempo de retorno médio é maior."** O round-robin é pior *no tempo de retorno* em cargas como as acima, mas dramaticamente melhor no tempo de resposta; qual métrica importa depende inteiramente da carga de trabalho (interativa contra em lote), e não de alguma classificação absoluta de políticas.
- **"Uma fatia de tempo mais curta é sempre melhor porque melhora o tempo de resposta."** Uma fatia mais curta de fato melhora o tempo de resposta, mas multiplica o número de trocas de contexto para o mesmo trabalho total, aumentando a fração do tempo gasta com sobrecarga pura em vez de cálculo útil; encolher a fatia tem um custo real, e não só um benefício.
- **"O round-robin precisa saber quanto tempo cada tarefa vai rodar, assim como o SJF."** Ele não precisa de informação nenhuma desse tipo: toda tarefa pronta é tratada de forma idêntica, uma fatia fixa por vez, seja qual for o tempo que ela acabe levando para terminar. Essa é precisamente a vantagem prática do round-robin sobre o SJF.
- **"Se uma tarefa termina em menos que uma fatia de tempo inteira, o resto da fatia é desperdiçado."** Uma tarefa que termina (ou bloqueia) antes de sua fatia acabar simplesmente cede a CPU de imediato; o escalonador passa na hora para a próxima tarefa pronta, em vez de ficar ocioso pelo restante da fatia.

## Resumo

O escalonamento round-robin dá a toda tarefa pronta uma fatia de tempo fixa, em rodízio, sem exigir nenhum conhecimento prévio do tamanho das tarefas, resolvendo diretamente a limitação prática central do SJF. Isso deixa o tempo de resposta excelente, já que toda tarefa recebe sua primeira fatia de tempo de CPU em mais ou menos uma passada pela fila de prontos, mas piora o tempo de retorno médio em comparação com rodar as tarefas até o fim numa ordem bem escolhida, já que o revezamento atrasa o término real de cada tarefa individual e acrescenta sobrecarga real de troca de contexto. Escolher o tamanho da fatia de tempo é ele mesmo um trade-off: curta demais, e a sobrecarga das trocas frequentes domina; longa demais, e o round-robin começa a parecer o FCFS, com um tempo de resposta correspondentemente pior. Nem o SJF nem o round-robin, sozinhos, são uma resposta completa para um SO de propósito geral; os dois próximos conceitos tratam, respectivamente, de como deixar trabalho urgente passar na frente com segurança (escalonamento por prioridade) e de como aproximar os benefícios do SJF sem a necessidade de presciência que o SJF tem (filas multinível com realimentação).

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf): o tratamento canônico do escalonamento round-robin e do seu trade-off entre tempo de resposta e tempo de retorno a partir do qual este conceito é construído.
- [ACM/IEEE CS2013: Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/): diretrizes curriculares que cobrem fatias de tempo e a comparação de políticas de escalonamento preemptivo.
