---
version: 1.1
updatedAt: 2026-11-13
title: "O Escalonador de Goroutines: G, M e P"
summary: O escalonador do Go a partir do cabeçalho de runtime/proc.go e do design doc do Vyukov, conferido com programas no Go 1.27; G, M e P; o slot runnext que roda primeiro a goroutine mais nova (e o -race embaralhando isso); filas locais e global e roubo de trabalho no GODEBUG=schedtrace; preempção assíncrona por SIGURG contra asyncpreemptoff=1 (um sleep de 1 ms virando 302 ms, uma parada do GC esperando o laço); o P repassado 32 a 54 µs depois de um read(2) bloqueante; 100 reads bloqueantes custando 100 threads enquanto o netpoller não custa nenhuma; e as métricas /sched/*, incluindo o nome das notas da 1.26 que não existe.
---
## Objective

Uma goroutine não é uma thread e `GOMAXPROCS` não é um número de threads. Esta lição
pega o escalonador do jeito que o próprio runtime o descreve (o cabeçalho de
`runtime/proc.go` e o design doc de 2012 do Dmitry Vyukov) e confere cada mecanismo com
um programa: G, M e P; o slot `runnext`; filas locais e global e roubo de trabalho
vistos pelo `GODEBUG=schedtrace`; preempção assíncrona (Go 1.14) contra
`GODEBUG=asyncpreemptoff=1`; o repasse do P quando uma thread bloqueia numa chamada de
sistema; o netpoller; e as métricas `/sched/*` (ampliadas no Go 1.26). Medido com Go
1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha `go 1.27` no módulo) num Apple M4 Max (14
núcleos, 10 de desempenho e 4 de eficiência, arm64), macOS 27.0.1, 3 execuções por
programa. Constantes como a fatia de tempo de 10 ms foram lidas no código-fonte da 1.27
e são atribuídas a ele.

## Use Cases

- Ler uma linha de `schedtrace` num incidente: Ps ociosos com a fila global crescendo, ou todo P ocupado?
- Explicar por que 100 goroutines num `read(2)` cru custam 100 threads do SO e 100 sockets ociosos não custam nenhuma.
- Diagnosticar latência causada por laços apertados, e saber o que `asyncpreemptoff=1` desliga de verdade.
- Exportar `/sched/latencies:seconds` e `/sched/goroutines/*` em vez de adivinhar a partir de `NumGoroutine`.
- Não depender da ordem de início das goroutines em testes (e entender por que o `-race` a embaralha).

## Deep Dive

### G, M e P

O cabeçalho de `proc.go` na 1.27 é o vocabulário inteiro:

```text
// G - goroutine.
// M - worker thread, or machine.
// P - processor, a resource that is required to execute Go code.
//     M must have an associated P to execute Go code, however it can be
//     blocked or in a syscall w/o an associated P.
```

Existem exatamente `GOMAXPROCS` Ps. Um P é dono do que o código Go precisa para rodar:
uma fila local de execução (um anel de 256 posições, `runq [256]guintptr` em
`runtime2.go`), um slot `runnext` e o cache de alocação. Ms são threads, e pode haver
muito mais Ms que Ps, porque um M bloqueado no kernel não precisa de P. O design doc do
Vyukov introduziu o P para resolver quatro problemas do escalonador do Go 1.0: um mutex
global único, repasse de goroutines entre threads, um cache de memória por M (o doc
cita até 100 Ms para cada M rodando código Go, cada cache com até 2 MB) e bloqueio
agressivo de threads em volta de syscalls. Design doc versus hoje: o doc não menciona
preempção nem netpoller, e a ideia dele de "try out LIFO scheduling" hoje é o slot `runnext`.

### runnext: a goroutine mais nova roda primeiro

```go
runtime.GOMAXPROCS(1)
for i := 1; i <= 10; i++ {
	wg.Go(func() {
		mu.Lock()
		order = append(order, i)
		mu.Unlock()
	})
}
wg.Wait() // main estaciona; o único P pega a próxima G
```

```text
run order: [10 1 2 3 4 5 6 7 8 9]
run order: [10 1 2 3 4 5 6 7 8 9]
run order: [10 1 2 3 4 5 6 7 8 9]
```

O `go` coloca a G nova no `runnext` e empurra a ocupante anterior para o fim da fila
local (`runqput` com `next=true`), então a última goroutine criada roda primeiro e o
resto roda em FIFO. O código-fonte explica o preço: uma goroutine que sai do `runnext`
compartilha a fatia de tempo atual, então duas goroutines que se acordam mutuamente
poderiam deixar o resto sem CPU, e o runtime depende do sysmon para preemptar esse par.
Com `-race` ele liga `randomizeScheduler` e pula o `runnext` metade das vezes:

```text
run order: [9 1 3 2 4 5 7 8 6 10]
run order: [10 2 1 3 4 5 6 7 9 8]
run order: [9 1 2 4 3 5 7 8 6 10]
```

### Filas locais e global, roubo de trabalho

1000 goroutines de cerca de 0,6 ms de CPU cada, criadas por uma goroutine só, com
`GOMAXPROCS=4 GODEBUG=schedtrace=10` (terceira execução, linhas cortadas):

```text
SCHED 14ms: gomaxprocs=4 idleprocs=4 threads=5 spinningthreads=0 needspinning=0 idlethreads=3 runqueue=0 [ 0 0 0 0 ] schedticks=[ 1 0 2 3 ]
SCHED 26ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=390 [ 113 112 112 201 ] schedticks=[ 19 18 20 20 ]
SCHED 100ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=160 [ 50 90 66 82 ] schedticks=[ 138 138 140 141 ]
SCHED 175ms: gomaxprocs=4 idleprocs=4 threads=5 spinningthreads=0 needspinning=0 idlethreads=3 runqueue=0 [ 0 0 0 0 ] schedticks=[ 250 250 252 253 ]
```

`runqueue` é a fila global e os colchetes são as filas locais (uma execução anterior
pegou o P criador sozinho: `runqueue=517 [ 254 0 0 0 ]`). Quando o anel de 256 posições
enche, `runqputslow` move metade dele mais a G nova para a fila global de uma vez. Ps
ociosos pegam de lá e roubam uns dos outros: `runqgrab` leva metade da fila da vítima,
`stealWork` faz 4 passadas por todos os Ps (a última também pode levar o `runnext` e
timers), e `findRunnable` olha a fila global a cada 61º schedtick para que duas
goroutines que se recriam não a deixem sem atendimento. Os schedticks finais somaram
1005, 1004 e 1005 nas três execuções, de 248 a 253 por P: a carga se espalhou por
igual, embora só um P tenha criado trabalho. Para limitar CPU desperdiçada, um M só
começa a girar procurando trabalho se os Ms girando forem menos que metade dos Ps
ocupados (`2*sched.nmspinning < gomaxprocs-sched.npidle`).

### Preempção: de chamadas de função a sinais

Antes do Go 1.14 uma goroutine só podia ser trocada numa chamada de função (proposta
24543: "and even then, not if the function is small or gets inlined"). Um laço sem chamadas:

```go
// spin não tem chamadas de função nem alocação: nenhum ponto de preempção cooperativa.
func spin(n int) {
	s := 0
	for i := 0; i < n; i++ {
		s += i ^ (i >> 3)
	}
	sink = s
}

runtime.GOMAXPROCS(1)
// Fase 1, um P: uma goroutine dormindo consegue a CPU de volta de um laço apertado?
done := make(chan struct{})
go func() { spin(1_000_000_000); close(done) }()
t1 := time.Now()
time.Sleep(time.Millisecond)
<-done

// Fase 2, dois Ps: o GC precisa parar um laço apertado rodando no outro P.
runtime.GOMAXPROCS(2)
done = make(chan struct{})
go func() { spin(1_000_000_000); close(done) }()
time.Sleep(20 * time.Millisecond) // deixa o spinner engrenar no outro P
t2 := time.Now()
runtime.GC()
```

```text
$ ./preempt
spin alone: 301ms
GOMAXPROCS=1: main asked for 1ms, woke after 12ms
GOMAXPROCS=2: runtime.GC() took 300µs; worst GC stopping latency <= 10.24µs (before: <= 6.144µs)
$ GODEBUG=asyncpreemptoff=1 ./preempt
spin alone: 312ms
GOMAXPROCS=1: main asked for 1ms, woke after 302ms
GOMAXPROCS=2: runtime.GC() took 294.6ms; worst GC stopping latency <= 335.54432ms (before: <= 6.144µs)
```

Com a preempção ligada, main acordou depois de 12, 3 e 23 ms e `runtime.GC()` levou de
200 a 300 µs; desligada, main acordou depois de 302 a 306 ms e o GC levou de 289 a 296
ms: os dois esperaram o laço inteiro. A latência de parada é o limite de um bucket de
`/sched/pauses/stopping/gc:seconds`, não um valor exato. O mecanismo, pelo código da
1.27: o `sysmon` roda no próprio M sem P, dormindo 20 µs e recuando até 10 ms quando
ocioso; `retake` chama `preemptone` quando um P está no mesmo schedtick há
`forcePreemptNS = 10 * 1000 * 1000 // 10ms`. `preemptone` coloca `stackPreempt` em
`stackguard0` (a checagem cooperativa na próxima chamada) e chama `preemptM`, que manda
`SIGURG`; o handler injeta uma chamada num ponto seguro. A dispersão bate: o spinner
saiu do `runnext` e herdou a fatia de main (3 ms), e um sysmon ocioso checa com menos
frequência (23 ms). A proposta rejeitou a preempção cooperativa em laços: a variante
mais barata (baseada em falta de página) ainda custava 7,8% de média geométrica numa
grande suíte de benchmarks. As notas do Go 1.14 listam o custo dos sinais: mais `EINTR`
em syscalls lentas feitas via `syscall` ou `x/sys/unix`. Segundo a doc do runtime,
`asyncpreemptoff=1` também desliga a varredura conservadora das pilhas preemptadas de
forma assíncrona, e por isso é uma chave de depuração do GC.

### Chamadas de sistema: o P é repassado

```go
syscall.Pipe(p[:]) // descritores bloqueantes: read(2) estaciona a thread
go func() {
	entered <- time.Now()
	buf := make([]byte, 1)
	syscall.Read(p[0], buf) // o M bloqueia no kernel segurando o P
}()
t := <-entered
go func() { ran <- time.Now() }() // precisa do P para rodar
```

Com `GOMAXPROCS=1` a goroutine executável rodou 46, 32 e 54 µs depois que o read
bloqueou. Na 1.27 um P não tem mais estado de syscall (`_Psyscall_unused`: "A P is
identified as 'in a system call' by looking at the goroutine's state"). `retake` toma o
P de uma goroutine que ficou na mesma syscall por "more than 1 sysmon tick (at least
20us)" e chama `handoffp`, que inicia outro M. Se a fila do P estiver vazia e houver Ps
ociosos ou girando, ele espera até 10 ms antes.

### O netpoller: goroutines bloqueadas sem threads

Mesmo programa, 100 goroutines bloqueadas lendo de `os.Pipe`, depois 100 em
`syscall.Read` cru sobre pipes bloqueantes, amostrando `runtime/metrics`:

```text
start                          threads=5    not-in-go=0    waiting=5    NumGoroutine=1
100 in os.File.Read (netpoll)  threads=5    not-in-go=0    waiting=105  NumGoroutine=101
100 in blocking read(2)        threads=102  not-in-go=100  waiting=5    NumGoroutine=101
after the reads returned       threads=103  not-in-go=0    waiting=5    NumGoroutine=1
```

Idêntico nas três execuções. `os.Pipe` devolve descritores não bloqueantes registrados
no kqueue: o leitor estaciona como uma G em espera e o netpoller (consultado por Ms
ociosos e pelo sysmon) a acorda, então nenhuma thread é gasta. Cada `read(2)` cru
segurou uma thread, e as threads ficaram depois que os reads voltaram: Ms ociosos são
guardados para reuso, até `debug.SetMaxThreads` (10000 por padrão em `proc.go`). O
`waiting=5` do início são goroutines do runtime que `NumGoroutine` não conta.

### Lendo o escalonador: schedtrace, scheddetail, /sched/*

`GODEBUG=schedtrace=40,scheddetail=1` acrescenta uma linha por P, M e G (cortado):

```text
SCHED 103ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=287 gcwaiting=false nmidlelocked=0 stopwait=0 sysmonwait=false
  P0: status=1 schedtick=122 syscalltick=0 m=0 runqsize=94 gfreecnt=56 timerslen=0
  P3: status=1 schedtick=146 syscalltick=0 m=2 runqsize=89 gfreecnt=43 timerslen=0
  M2: p=3 curg=428 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=nil
  M1: p=nil curg=nil mallocing=0 throwing=0 preemptoff= locks=32 dying=0 spinning=false blocked=false lockedg=nil
  G1: status=4(sync.WaitGroup.Wait) m=nil lockedm=nil
  G17: status=4(GOMAXPROCS updater (idle)) m=nil lockedm=nil
  G152: status=1() m=nil lockedm=nil
```

Para produção, `runtime/metrics` na 1.27 lista 13 métricas `/sched/*`, entre elas
`/sched/goroutines/{running,runnable,waiting,not-in-go}:goroutines`,
`/sched/goroutines-created:goroutines`, `/sched/threads/total:threads` (as novidades da
1.26), `/sched/latencies:seconds` (tempo executável antes de rodar) e os histogramas
`/sched/pauses/{stopping,total}/{gc,other}:seconds`. As notas do Go 1.26 chamam a
métrica de threads de `/sched/threads:threads`; ler esse nome devolveu `KindBad`
(kind 0) em todas as execuções, o nome real é `/sched/threads/total:threads`.

## Trade-offs

- **Preempção assíncrona não é de graça**: ela limita um laço apertado a cerca de 10 ms
  (3 a 23 ms acima), mas cada preempção chega como um `SIGURG`, e syscalls cruas precisam
  repetir em `EINTR`. `asyncpreemptoff=1` é chave de depuração: acima ela transformou um
  sleep de 1 ms em 302 ms.
- **Syscall bloqueante custa uma thread cada**: 100 chamadas `read(2)` bloqueadas criaram
  102 threads, mantidas depois do retorno; chamadas cgo seguem o mesmo caminho de
  `entersyscall` (`cgocall.go`). Sockets, pipes e timers passam pelo netpoller; segundo o
  código de `os`, arquivos regulares e diretórios nunca são registrados no kqueue, então
  as leituras deles também seguram uma thread.
- **runnext troca ordem por localidade**: a goroutine mais nova roda primeiro e divide a
  fatia de tempo. Testes que assumem ordem FIFO de início quebram, e o `-race` deixa isso visível.
- **Girar troca CPU por latência de despertar**: o design doc escolheu "burn CPU cycles"
  procurando trabalho em vez de estacionar threads na hora; o código limita os Ms girando
  a metade dos Ps ocupados, então parte da CPU vai para a busca e não para o seu código.
- **Design doc versus hoje**: o doc de 2012 descreve P e roubo como ainda funcionam, mas
  não `runnext`, preempção assíncrona, o laço do netpoller nem o caminho de syscall da
  1.27; leia o cabeçalho e o código de `proc.go` para o comportamento atual.

## Documentation Links

- [runtime/proc.go at go1.27.0 (scheduler header comment and code), go.googlesource.com](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/proc.go): doc
- [Dmitry Vyukov, Scalable Go Scheduler Design Doc (2012), golang.org/s/go11sched](https://golang.org/s/go11sched): doc
- [Proposal 24543: Non-cooperative goroutine preemption, Austin Clements](https://go.googlesource.com/proposal/+/refs/heads/master/design/24543-non-cooperative-preemption.md): doc
- [Go 1.14 Release Notes: asynchronous preemption, go.dev](https://go.dev/doc/go1.14): doc
- [Go 1.26 Release Notes: new /sched metrics, go.dev](https://go.dev/doc/go1.26): doc
- [Package runtime/metrics, pkg.go.dev](https://pkg.go.dev/runtime/metrics): doc
- [Package runtime: GODEBUG schedtrace, scheddetail, asyncpreemptoff, pkg.go.dev](https://pkg.go.dev/runtime): doc
