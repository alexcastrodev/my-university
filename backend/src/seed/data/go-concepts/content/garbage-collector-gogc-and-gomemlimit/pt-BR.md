---
version: 1.0
updatedAt: 2026-11-13
title: "O Garbage Collector do Go: GOGC e GOMEMLIMIT"
summary: O coletor mark-sweep tricolor, concorrente e sem movimentação do Go, a partir da proposta do write barrier híbrido e do keynote do ISMM 2018; uma linha de GODEBUG=gctrace=1 lida campo a campo; uma carga fixa medida no Go 1.27 com GOGC 50, 100, 200 e off, em que cada dobra corta pela metade os ciclos e a CPU de GC e dobra a folga de memória; GOMEMLIMIT como teto suave com GOGC=off (11 ciclos em vez de 62 a 64) e os sufixos que ele rejeita; o death spiral com o heap vivo perto e acima do limite (30 vezes a CPU de GC, memória passando do limite, uma lentidão de 6x que o limitador de 50% de CPU não evita); e os controles em runtime/metrics e runtime/debug.
---
## Objective

O coletor do Go é um mark-sweep tricolor concorrente, sem movimentação e sem gerações,
com dois controles: `GOGC`, uma razão entre CPU de GC e memória de heap, e
`GOMEMLIMIT`, um teto suave para a memória que o runtime usa. Esta lição explica o
coletor a partir da proposta do write barrier híbrido e do keynote do ISMM 2018, lê
uma linha de `GODEBUG=gctrace=1` campo a campo e mede uma carga fixa (4 GiB alocados
em nós de 64 bytes com ponteiros, sobre um conjunto vivo fixo) com `GOGC` 50, 100,
200 e off, com `GOMEMLIMIT` e `GOGC=off`, e dentro do death spiral com o heap vivo
perto e acima do limite, lendo ciclos, pico de memória, CPU de GC e o limitador de
CPU em `runtime/metrics`. Medido com Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha
`go 1.27` no módulo) num Apple M4 Max (14 núcleos, arm64), macOS 27.0.1, `GOMAXPROCS`
padrão (14) salvo indicação, 3 execuções por configuração. Outros benchmarks dividiam
a máquina, então tempos de relógio e de CPU aparecem como faixas; contagens de ciclos
e picos são os números estáveis.

## Use Cases

- Escolher `GOGC` para um serviço sabendo o que cada dobra custa em RAM e economiza em CPU.
- Configurar `GOMEMLIMIT` abaixo do limite de memória do contêiner, deixando folga.
- Reconhecer um death spiral nas métricas antes do OOM kill ou do alerta de latência.
- Ler uma saída de `gctrace` colada num incidente ou numa issue.
- Trocar um lastro de heap (o truque de antes da 1.19) por um limite de memória.

## Deep Dive

### Marcação tricolor concorrente e o write barrier híbrido

Objetos são brancos (não alcançados), cinza (alcançados, não varridos) ou pretos
(varridos). A marcação parte das raízes (stacks, globais) e roda junto com o
programa; o sweep é preguiçoso. Como o programa continua escrevendo ponteiros durante
a marcação, um write barrier, ligado só enquanto se marca, impede o coletor de perder
um objeto alcançável. A proposta 17503 (Go 1.8) trocou a barreira de inserção de
Dijkstra por uma híbrida:

```text
writePointer(slot, ptr):
    shade(*slot)
    if current stack is grey:
        shade(ptr)
    *slot = ptr
```

Sombrear o ponteiro sobrescrito (estilo Yuasa) e, enquanto a stack não foi varrida, o
novo (estilo Dijkstra) satisfaz a invariante tricolor fraca, então uma stack já
varrida continua preta e a nova varredura de stacks com o mundo parado desaparece.
Isso exige alocar objetos novos como pretos, o que o Go já fazia. A proposta mirava
um pior caso de STW abaixo de 50 µs. Com 384 MB vivos (10 a 11 ciclos por execução),
a fase de STW mais longa no `gctrace` foi de 0,07, 0,17 e 0,5 ms em 3 execuções,
enquanto a marcação concorrente levou até 27 a 68 ms. Por que não geracional nem com
movimentação? O keynote: o write barrier sempre ligado de um protótipo geracional
"was fast but it simply wasn't fast enough", e a escape analysis mantém os objetos
jovens na stack: "the young objects live and die young on the stack".

### Lendo uma linha de gctrace

```text
gc 30 @0.595s 5%: 0.023+5.3+0.012 ms clock, 0.33+0.013/19/37+0.17 ms cpu, 139->143->75 MB, 152 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

- `gc 30 @0.595s 5%`: ciclo 30, 0,595 s depois do início, 5% da CPU disponível gasta
  em GC até aqui, pela conta do próprio runtime.
- `0.023+5.3+0.012 ms clock`: fim do sweep com o mundo parado, marcação concorrente,
  fim da marcação com o mundo parado. As únicas pausas são o primeiro e o último número.
- `0.33+0.013/19/37+0.17 ms cpu`: as fases de STW vezes 14 Ps, e a marcação dividida
  em assists (0,013, a goroutine que aloca pagando), workers dedicados (19) e workers
  ociosos (37, Ps sem mais nada para fazer).
- `139->143->75 MB`: heap quando o ciclo começou, quando terminou (o programa
  continuou alocando durante a marcação) e vivo depois da marcação.
- `152 MB goal`: o alvo do guia, vivo + (vivo + raízes) × GOGC/100, ou seja, 75 + 75
  mais arredondamento. O ciclo começou em 139 MB, antes do alvo: o pacer dispara cedo
  para a marcação terminar antes de o heap chegar lá.
- `0 MB stacks, 0 MB globals, 14 P`: as raízes a varrer e o `GOMAXPROCS`.

### A carga

```go
type node struct {
	next    *node
	payload [7]int64 // 64 bytes no total
}

// metade do conjunto vivo nunca muda; a outra metade é substituída ao
// acaso e aponta para a metade fixa, então os nós substituídos viram lixo
n := *liveMB << 20 / size / 2
...
for i := range total / *workers {
	x := &node{}
	x.payload[0] = int64(i)
	x.next = fixed[rand.IntN(n)]
	part[rand.IntN(len(part))] = x
}
```

O programa lê `runtime/metrics` antes e depois do laço, e uma goroutine amostra
`/memory/classes/total:bytes` menos `/memory/classes/heap/released:bytes` a cada
milissegundo: a grandeza que o `GOMEMLIMIT` governa, segundo o guia.

### GOGC: um botão entre CPU e memória

`-live 64` (cerca de 75 MB vivos com os dois slices de ponteiros), 1 goroutine alocando:

```text
GOGC  cycles   peak memory     GC CPU without idle workers, median (range)   wall, median
50    135-147  120-127 MB      3.62 s (2.76-8.99)                            2.88 s
100   62-64    158-165 MB      1.65 s (1.20-1.74)                            2.11 s
200   30       238-243 MB      0.79 s (0.59-0.79)                            1.67 s
off   0        4,421-4,424 MB  0                                             1.43 s
```

Cada dobra do `GOGC` cortou pela metade os ciclos e a CPU de GC e mais ou menos
dobrou a folga acima do heap vivo (cerca de 50, 85 e 165 MB), que é a regra do guia.
`GOGC=off` manteve os 4 GiB mapeados. Os workers ociosos somaram de 1 a 5 s de CPU em
Ps que estavam parados de qualquer jeito; `gctrace` e `/cpu/classes/gc/total` incluem esse tempo.

### GOMEMLIMIT: um teto suave, não um cgroup

`GOGC=off GOMEMLIMIT=512MiB` deixa o heap crescer até a memória total do runtime
chegar perto do limite. Com 64 MB vivos: 11 ciclos em vez de 62 a 64, pico de 488 a 490 MB:

```text
gc 1 @0.163s 0%: 0.070+9.2+0.013 ms clock, 0.98+0.13/23/37+0.18 ms cpu, 462->467->76 MB, 463 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

O alvo (459 a 464 MB em 3 execuções) é o limite menos a memória que o runtime usa
fora do heap. Com 192 MB vivos a mesma configuração rodou 28 a 32 ciclos em 490 a
491 MB, contra 21 ciclos em 454 a 463 MB com `GOGC=100` puro. A variável só aceita os
sufixos `B`, `KiB`, `MiB`, `GiB` e `TiB`; `GOMEMLIMIT=1GB` e `GOMEMLIMIT=1gb` mataram
o processo na partida:

```text
fatal error: malformed GOMEMLIMIT; see `go doc runtime/debug.SetMemoryLimit`
```

### O death spiral e o limitador de 50%

Um limite abaixo do que o programa precisa faz o GC rodar um ciclo atrás do outro,
cada um liberando pouco: o guia chama isso de thrashing. A mesma carga, 1 goroutine
alocando, `GOGC=off GOMEMLIMIT=512MiB`, conjunto vivo crescente (o heap vivo real
fica cerca de 12% acima de `-live`), 3 execuções cada:

```text
-live  cycles   peak memory  GC CPU (of which assists)  wall         limiter enabled
256    60-66    491-492 MB   3.1-3.5 s (0.00 s)         3.6 s        never
384    392-427  492-493 MB   28-31 s (1.0-1.5 s)        10.7-11.7 s  never
416    837-859  522-524 MB   63 s (0.03-0.04 s)         22.5-22.6 s  2 of 3 runs
512    687-696  637-639 MB   65 s (0.02-0.03 s)         22.9-23.1 s  3 of 3 runs
640    585-609  791-792 MB   69-71 s (0.02-0.05 s)      24.2-25.0 s  3 of 3 runs
```

Com `GOGC=100` e sem limite, as mesmas cinco linhas levaram de 7 a 16 ciclos, 0,9 a
1,0 s de CPU de GC e 2,7 a 4,2 s. Em 384 o limite foi respeitado, por cerca de 30
vezes a CPU de GC e 3 vezes o tempo de relógio. De 416 para cima a memória passou do
limite, que é o que suave quer dizer, `/gc/limiter/last-enabled:gc-cycle` deixou de
ser zero na maioria das execuções, os assists caíram a quase nada e a execução ficou
cerca de 6 vezes mais lenta. O alvo desaba sobre o heap vivo, com um ciclo novo a
cada 33 ms, 22 deles marcando:

```text
gc 301 @9.588s 19%: 0.029+22+0.012 ms clock, 0.41+0.021/90/199+0.17 ms cpu, 581->594->582 MB, 581 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

O guia diz que o limitador está "currently set at roughly 50%, with a 2 * GOMAXPROCS
CPU-second window", de modo que, com um limite baixo demais, "the program will slow
down at most by 2x". Esse teto não valeu aqui. No código, `gcCPULimiter.limiting()`
só é consultado em dois lugares: mark assists (`mgcmark.go`) e scavenging na alocação
(`mheap.go`). Os workers de fundo continuam rodando. Com 14 goroutines alocando
(`-workers 14 -live 512`) a execução com limite levou 7,2 s contra 0,84 a 0,87 s,
gastou 12 s em assists, teve pico de 735 a 823 MB e nunca ligou o limitador.

### runtime/metrics e runtime/debug

As métricas que importam para esses controles, todas presentes na 1.27.0:

- `/gc/cycles/total:gc-cycles`, `/gc/heap/goal:bytes`, `/gc/heap/live:bytes`.
- `/gc/gogc:percent`, `/gc/gomemlimit:bytes`: as configurações atuais.
- `/cpu/classes/gc/total:cpu-seconds` e as partes `mark/assist`, `mark/dedicated`,
  `mark/idle`, `pause`. A descrição diz que é uma superestimativa, comparável só com
  outras métricas `/cpu/classes`.
- `/gc/limiter/last-enabled:gc-cycle`: a proposta previa `/gc/throttles:events`;
  foi esta que saiu.

Os setters devolvem o valor anterior, e um limite negativo lê sem alterar:

```go
fmt.Println("SetGCPercent(50) was   ", debug.SetGCPercent(50))
fmt.Println("SetMemoryLimit(-1) is  ", debug.SetMemoryLimit(-1)) // negativo: só leitura
fmt.Println("SetMemoryLimit(256MiB) was", debug.SetMemoryLimit(256<<20))
fmt.Println("after:                 ", gauges())
debug.SetGCPercent(-1) // GOGC=off
debug.SetMemoryLimit(math.MaxInt64)
fmt.Println("off, no limit:         ", gauges())
```

```text
$ GOGC=200 GOMEMLIMIT=1GiB ./bin/knobs
start:                  /gc/gogc:percent=200 /gc/gomemlimit:bytes=1073741824
SetGCPercent(50) was    200
SetMemoryLimit(-1) is   1073741824
SetMemoryLimit(256MiB) was 1073741824
after:                  /gc/gogc:percent=50 /gc/gomemlimit:bytes=268435456
off, no limit:          /gc/gogc:percent=18446744073709551615 /gc/gomemlimit:bytes=9223372036854775807
```

`GOGC=off` aparece como o `uint64` de -1, e "sem limite" é `math.MaxInt64`.

## Trade-offs

- **GOGC troca RAM por CPU de forma linear**: dobre o valor e a CPU de GC cai pela
  metade enquanto a folga dobra (0,79 s e cerca de 165 MB em 200 contra 1,65 s e 85 MB
  em 100, acima).
- **GOGC=off com limite usa a memória que você paga**: 11 ciclos em vez de 64, mas só
  enquanto o heap vivo fica bem abaixo do limite. O guia sugere de 5 a 10% de folga
  para memória que o runtime não enxerga, como alocações de cgo.
- **Suave quer dizer que pode ser ultrapassado**: o runtime desiste do limite antes de
  entregar toda a CPU. O OOM killer do contêiner não desiste; mantenha o limite do
  cgroup acima do `GOMEMLIMIT`.
- **O limitador limita a fatia do GC, não a sua lentidão**: ele só interrompe assists
  e o scavenging na alocação; workers dedicados, write barriers e sweep continuam.
- **Contra a JVM**: sem gerações e sem compactação, por projeto (o keynote aposta na
  escape analysis mantendo valores de vida curta na stack), e dois controles em vez de
  escolha de coletor mais flags de dimensionamento.

## Documentation Links

- [A Guide to the Go Garbage Collector, go.dev](https://go.dev/doc/gc-guide): doc
- [Proposal: Eliminate STW stack re-scanning (hybrid write barrier), Clements and Hudson, 2016](https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md): doc
- [Proposal: Soft memory limit, Knyszek, 2021](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md): doc
- [Getting to Go: The Journey of Go's Garbage Collector (ISMM 2018 keynote), The Go Blog](https://go.dev/blog/ismmkeynote): doc
- [Package runtime/metrics, pkg.go.dev](https://pkg.go.dev/runtime/metrics): doc
- [Package runtime/debug (SetGCPercent, SetMemoryLimit), pkg.go.dev](https://pkg.go.dev/runtime/debug): doc
- [Package runtime (GODEBUG gctrace format), pkg.go.dev](https://pkg.go.dev/runtime): doc
- [runtime/mgclimit.go at go1.27.0 (GC CPU limiter), Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/mgclimit.go): doc
- [Dijkstra, Lamport, Martin, Scholten and Steffens, On-the-fly garbage collection, CACM 1978](https://doi.org/10.1145/359642.359655): paper
