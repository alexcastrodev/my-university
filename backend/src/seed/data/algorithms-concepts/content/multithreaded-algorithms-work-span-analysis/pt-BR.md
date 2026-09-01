---
version: 1.0
updatedAt: 2026-08-13
title: "Paralelismo Fork-Join: Work, Span e os Limites do Speedup"
description: "O framework formal de análise de custo por trás do paralelismo fork-join: modele um cálculo como um DAG de strands, meça seu work (T1) e span (T∞), e use a lei do work e a lei do span para derivar o teto comprovado TP >= max(T1/P, T∞) sobre quanto speedup adicionar processadores pode comprar."
---
## Objetivo

Aprenda o framework formal de análise de custo — work, span e paralelismo — que explica *por que* e *o quanto* um algoritmo paralelo fork-join consegue de fato acelerar em P processadores, e prova os limites matemáticos rígidos sobre esse speedup. Isso é a teoria por baixo da prática: não ensina uma API nova, ensina como raciocinar sobre o teto de performance paralela ao qual qualquer implementação fork-join, incluindo o próprio `ForkJoinPool` do Java, está presa.

## Casos de Uso

- Prever o speedup máximo possível de um algoritmo paralelo *antes* de implementá-lo, para não provisionar (ou prometer) hardware esperando uma escalabilidade quase linear que a própria estrutura de dependências do algoritmo nunca poderá entregar.
- Diagnosticar por que uma "otimização" que deixou um programa paralelo mais rápido numa máquina pequena o deixou *mais lento* numa máquina muito maior — reconhecendo quando o gargalo mudou de work (dividido entre processadores) para span (o caminho crítico inevitável).
- Justificar a escolha de um limiar sequencial em um algoritmo paralelo real de divisão e conquista — a teoria explica por que dividir o trabalho fino demais infla o overhead em relação ao paralelismo de fato ganho, mesmo que este framework em si abstraia o overhead de escalonamento.

## Aprofundamento

### O modelo fork-join: spawn, sync e parallel for

O paralelismo fork-join estende o pseudocódigo serial comum com três palavras-chave:

- **`spawn`** — inicia uma chamada de sub-rotina como uma nova strand filha, potencialmente paralela, sem esperar que ela termine. A strand pai chamadora fica livre para continuar imediatamente.
- **`sync`** — espera até que todos os filhos previamente spawnados da strand atual tenham terminado antes de prosseguir. (Todo procedimento também tem um `sync` implícito logo antes de retornar, então os filhos de um pai sempre terminam antes do próprio pai.)
- **`parallel for`** — um loop `for` cujas iterações podem todas rodar em paralelo. Por baixo dos panos um compilador implementa isso como uma estrutura recursiva de divisão e conquista com spawn/sync (divide o intervalo de iteração ao meio, spawna uma metade, recursa na outra, sync), não como um loop paralelo plano.

Crucialmente, essas palavras-chave descrevem o que *pode* rodar em paralelo, não o que *deve*. Apagar `spawn`, `sync` e `parallel` do pseudocódigo de um algoritmo fork-join produz pseudocódigo serial comum para o mesmo problema — sua **projeção serial**. Um escalonador decide em tempo de execução quais strands logicamente paralelas de fato rodam ao mesmo tempo.

O exemplo recorrente de Cormen é um cálculo recursivo paralelo de Fibonacci:

```
P-FIB(n)
1  if n <= 1
2      return n
3  else x = spawn P-FIB(n - 1)   // não espera pelo filho spawnado
4       y = P-FIB(n - 2)          // roda em paralelo com esse filho spawnado
5       sync                      // espera x terminar de calcular
6       return x + y
```

A linha 3 spawna a primeira chamada recursiva; o pai imediatamente segue para a linha 4 e calcula a segunda chamada ele mesmo, em paralelo com o filho spawnado. O `sync` da linha 5 é necessário antes da linha 6, porque `x` não é seguro de ler até que o filho spawnado tenha de fato retornado.

Essa é uma forma genuinamente ineficiente de calcular números de Fibonacci (é exponencial — os mesmos subproblemas repetidos da versão serial ingênua), mas é um cálculo pequeno e limpo para pendurar a análise. *Não* é um template para código real: o concept irmão `fork-join-framework` no módulo Java Concepts desta plataforma cobre `ForkJoinPool`, `RecursiveTask`/`RecursiveAction`, `fork()`/`join()`, e work-stealing — essa é a instância real, em Java, deste exato modelo (spawn ≈ `fork()`, sync ≈ `join()`/`invokeAll()`, e seu `seqThreshold` é exatamente o ponto onde uma divisão recursiva estilo parallel-for chega ao fundo em trabalho serial). O próprio texto de Cormen chega a citar "o Java Fork-Join Framework" ao lado de Cilk, OpenMP, e sistemas similares como implementações reais deste modelo. Este concept assume que você já conhece essa API ou pode ir ler aquele concept irmão — o objetivo aqui é a teoria de custo que explica *por que* ajustar aquele limiar e o speedup daquele framework se comportam do jeito que se comportam, não uma segunda passada pelos mesmos métodos.

### O DAG do cálculo: strands, e o que "em série" vs. "em paralelo" significa

Quando um cálculo fork-join realmente roda, ele traça um grafo acíclico direcionado (DAG) de **strands** — cadeias maximais de instruções sem nenhum spawn, sync, chamada de procedimento ou retorno. Qualquer um desses pontos de controle termina uma strand e inicia (ou retoma) outra. As arestas do DAG representam três tipos de dependência:

- **aresta de spawn** — da strand pai para a primeira strand de um filho spawnado (o pai pode continuar em paralelo).
- **aresta de chamada** — da strand pai para a primeira strand de um filho chamado normalmente (o pai *não* continua em paralelo; ele está esperando, exatamente como uma chamada normal).
- **aresta de retorno/sync** — da última strand de um filho de volta para a strand que retoma depois que esse filho termina (imediatamente, para uma chamada; depois de um `sync`, para um spawn).

Abaixo está o traço para `P-FIB(4)` (o próprio exemplo trabalhado de Cormen, Figura 26.2). Cada instância de procedimento não-folha se divide em três strands: **B** (azul — tudo até seu `spawn`), **O** (laranja — a continuação paralela, até sua própria chamada), e **W** (branco — depois do `sync`, soma e retorna). Um caso base (`n <= 1`) é uma única strand folha, **L**, já que não tem spawn/sync/chamada próprios.

```
P-FIB(4)                                    B4  O4  W4
├─ spawn ─▶ P-FIB(3)                        B3  O3  W3
│           ├─ spawn ─▶ P-FIB(2)            B2a O2a W2a
│           │           ├─ spawn ─▶ P-FIB(1)  L1a           (folha)
│           │           └─ call  ─▶ P-FIB(0)  L0a           (folha)
│           └─ call  ─▶ P-FIB(1)            L1b             (folha)
└─ call  ─▶ P-FIB(2)                        B2b O2b W2b
            ├─ spawn ─▶ P-FIB(1)            L1c             (folha)
            └─ call  ─▶ P-FIB(0)            L0b             (folha)
```

Contando strands: quatro instâncias não-folha (P-FIB(4), P-FIB(3), e os dois P-FIB(2)s) contribuem 3 cada = 12, mais 5 instâncias folha (três P-FIB(1)s... na verdade dois P-FIB(1)s e dois P-FIB(0)s mais a estrutura externa) contribuem 1 cada. Somando toda caixa acima: 3+3+3+1+1+1+3+1+1 = **17 strands no total**.

O caminho mais longo por esse DAG — o **caminho crítico** — é:

```
B4 -> B3 -> B2a -> O2a -> L0a -> W2a -> W3 -> W4     (8 strands)
```

Ele passa pelos ramos *chamados* (B → O → seu filho chamado → W), não pelos spawnados, porque em todo nível a strand única de uma folha é mais curta que "O mais seu filho chamado" — então o lado da chamada, não o lado do spawn, é onde de fato vive a cadeia mais longa de dependência forçadamente serial.

Duas strands estão **em série** se um caminho as conecta no DAG (uma dependência força uma a acontecer antes da outra) — por exemplo, `O2a` e `L0a`: a aresta de chamada de `O2a` vai direto para `L0a`, e `W2a` não pode começar até `L0a` (e `L1a`) retornarem. Duas strands estão **em paralelo** se nenhum caminho as conecta em nenhuma direção — elas *podem* rodar simultaneamente, embora não precisem. Por exemplo, `L1a` (o filho spawnado de `P-FIB(1)` do primeiro `P-FIB(2)`) e `O2a` (a continuação desse mesmo `P-FIB(2)`) estão em paralelo: é exatamente isso que o `spawn` da linha 3 cria. Da mesma forma, a subárvore inteira de `P-FIB(3)` e a subárvore inteira de `P-FIB(2)` penduradas em `P-FIB(4)` estão em paralelo uma com a outra — nada calculado em uma é lido pela outra, mesmo que a segunda seja uma simples chamada em vez de um spawn.

### Work (T1) e span (T∞): as duas medidas de custo principais

A análise de work/span reduz o teto de performance paralela de um cálculo a dois números, ambos medidos nas mesmas unidades de tempo de uma única strand:

- **Work, T1** — o tempo total para rodar o cálculo *inteiro* em apenas **um** processador: a soma dos tempos de execução de toda strand do DAG. Isso é idêntico ao tempo de execução serial comum (o tempo de execução da projeção serial).
- **Span, T∞** — o comprimento do **caminho mais longo** (o caminho crítico) pelo DAG: o mais rápido que o cálculo poderia possivelmente terminar dado um número *ilimitado* de processadores. Mesmo paralelismo infinito não consegue fazer trabalho dependente (em série) terminar mais rápido do que a cadeia de dependências força.

Para o traço de `P-FIB(4)` diagramado acima, assumindo que cada strand leva tempo unitário:

- **Work T1 = 17** — a soma do tempo de toda strand, ou seja, a contagem de strands: 3 (P-FIB(4)) + 3 (P-FIB(3)) + 3 (P-FIB(2) via spawn) + 1 (P-FIB(1)) + 1 (P-FIB(0)) + 1 (P-FIB(1)) + 3 (P-FIB(2) via call) + 1 (P-FIB(1)) + 1 (P-FIB(0)) = 17.
- **Span T∞ = 8** — a contagem de strands ao longo do caminho crítico traçado acima: `B4, B3, B2a, O2a, L0a, W2a, W3, W4`.

Os dois números conferem contra um segundo método independente — uma recorrência sobre `n`. Seja `work(n)` a contagem de strands e `span(n)` o comprimento do caminho crítico para `P-FIB(n)`:

```
work(0) = work(1) = 1
work(n) = 3 + work(n-1) + work(n-2)          para n >= 2
  work(2)=5, work(3)=9, work(4)=3+9+5=17  ✓

span(0) = span(1) = 1
span(n) = 1 + max( span(n-1), 1 + span(n-2) ) + 1     para n >= 2
  span(2)=4, span(3)=6, span(4)=1+max(6,1+4)+1=8  ✓
```

Os dois caminhos concordam com os próprios números declarados por Cormen para esse exemplo: work 17, span 8.

### Paralelismo, a lei do work, a lei do span, e o limite que restringe o speedup

A razão **T1 / T∞** é o **paralelismo** do cálculo — o speedup máximo possível alcançável não importa quantos processadores sejam jogados no problema. Para `P-FIB(4)`: `17 / 8 = 2,125`. Nenhuma quantidade de hardware consegue fazer esse cálculo específico rodar mais que ~2,1x mais rápido que em um único processador (um `n` maior cresce o paralelismo dramaticamente, já que o work cresce exponencialmente em `n` enquanto o span só cresce linearmente — mas para esse traço pequeno, 2,125 é o teto rígido).

Dois limites inferiores independentes restringem o tempo de execução real `TP` em `P` processadores:

- **A lei do work**: `TP >= T1 / P`. Em um passo de tempo, `P` processadores podem realizar no máximo `P` unidades de work, então em `TP` de tempo eles realizam no máximo `P · TP` de work — e como o work total exigido é `T1`, precisamos de `P · TP >= T1`, ou seja, `TP >= T1 / P`. Você não consegue superar dividir o work total de forma perfeitamente igual entre todo processador.
- **A lei do span**: `TP >= T∞`. Uma máquina com `P` processadores nunca consegue superar o que uma máquina com processadores *ilimitados* faria (uma máquina ilimitada sempre consegue emular uma de `P` processadores usando só `P` dos seus processadores) — então o comprimento do caminho crítico é um piso para `TP` independente de `P`.

As duas leis valem simultaneamente, dando o limite combinado que todo este framework existe para estabelecer:

```
TP >= max(T1 / P, T∞)
```

Essa é a generalização formal e comprovável da intuição informal por trás da Lei de Amdahl — de que alguma porção inerentemente sequencial de um cálculo limita o speedup alcançável não importa quantos núcleos você adicione. (Se algum concept focado em concorrência desta plataforma introduz a Lei de Amdahl de forma informal, esse limite é essa intuição tornada matematicamente precisa; o argumento aqui vale por si só de qualquer forma.)

A conclusão prática: assim que o número de processadores `P` excede o paralelismo `T1 / T∞`, o termo de span domina o limite e adicionar ainda mais processadores compra essencialmente nada — você ficou sem work independente para distribuir, e agora está esperando pelo caminho crítico não importa o quê. Para `P-FIB(4)`, esse teto é alcançado quase imediatamente (por volta de 2-3 processadores); algoritmos reais com entradas muito maiores tipicamente têm paralelismo muito maior, mas o limite `TP >= max(T1/P, T∞)` se aplica exatamente da mesma forma independente da escala — é a razão pela qual "só adicione mais núcleos" eventualmente para de funcionar para *qualquer* algoritmo fork-join.

## Trade-offs

- **O modelo é idealizado — ignora overhead de escalonamento, contenção de memória e efeitos de cache.** Work e span dão um piso matemático rígido para `TP`, não um número que você tem a garantia de alcançar. Pode-se mostrar que um escalonador comprovadamente bom ("guloso") alcança `TP <= T1/P + T∞` — dentro de um fator de 2 do ótimo — mas escalonadores reais (incluindo o work-stealing de um `ForkJoinPool` real) só aproximam essa garantia; o tempo de execução medido real sempre será um pouco pior que o limite teórico.
- **Reduzir work ao custo de aumentar span pode sair pela culatra em escala, mesmo ajudando com menos processadores.** Um caso real documentado: uma otimização de um programa paralelo de xadrez cortou o work de T1=2048s para T1'=1024s mas elevou o span de T∞=1s para T∞'=8s. Usando `TP ≈ T1/P + T∞`: em 32 processadores a versão otimizada venceu (`1024/32+8=40s` contra `2048/32+1=65s` da original), mas em 512 processadores ela perdeu (`1024/512+8=10s` contra `2048/512+1=5s`) — o termo de span, insignificante na máquina pequena, tornou-se o custo dominante na máquina grande. Extrapolar a partir dos números de work/span pegou isso antes de gastar tempo caro de supercomputador; extrapolar só da medição em 32 processadores não teria pegado.
- **O framework assume determinismo — strands rodando em paralelo precisam ser mutuamente não interferentes.** Work e span descrevem um formato de DAG fixo; se strands paralelas competem por memória compartilhada (uma *corrida de determinismo*), o cálculo real realizado pode variar de execução para execução, e os números de work/span calculados para uma execução possível deixam de descrever as outras. Este concept, como o tratamento de Cormen, só analisa cálculos fork-join livres de corrida.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 26 "Parallel Algorithms", Seção 26.1 "The basics of fork-join parallelism", pp. 748-770 — [mitpress.mit.edu/9780262046305](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
