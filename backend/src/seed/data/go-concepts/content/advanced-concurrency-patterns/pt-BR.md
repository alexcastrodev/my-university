---
version: 1.0
updatedAt: 2026-11-12
title: "Padrões Avançados de Concorrência em Go"
summary: Pipelines com cancelamento por context (adaptados do artigo de pipelines do blog do Go), fan-out e fan-in e a ordem perdida, paralelismo limitado com errgroup.SetLimit contra semaphore e channel com buffer medindo pico de tarefas e de goroutines, semáforo com peso e fila FIFO, cancelamento no primeiro erro com errgroup.WithContext e context.Cause, singleflight com 100 chamadores e uma execução, o context do primeiro chamador vazando para todos e context.WithoutCancel, e sync.WaitGroup.Go (Go 1.25) com o analisador waitgroup do vet e o go fix.
---
## Objective

Goroutines são baratas; o difícil é a forma em volta delas: um pipeline que para
quando o consumidor para, um fan-out que não afoga o banco, um grupo que falha
rápido, um cache miss que bate no backend uma vez em vez de cem. Esta lição monta
cada padrão a partir do artigo de pipelines do blog do Go (trocando o channel `done`
por `context`), `errgroup`, `semaphore` e `singleflight` de `golang.org/x/sync`, e
`sync.WaitGroup.Go` (Go 1.25), medindo número de goroutines, pico de concorrência,
ordens e execuções. Medido com Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha `go 1.27` no
módulo) e `golang.org/x/sync v0.25.0` num Apple M4 Max (14 núcleos, arm64), macOS
27.0.1, 3 execuções por programa; todas as demos passam limpas no `-race`.

## Use Cases

- Chamar N shards ou URLs com limite de concorrência e falhar rápido no primeiro erro.
- Cadeias de estágios (ler, decodificar, transformar, gravar) que não podem vazar quando o consumidor desiste cedo.
- Avalanche de cache miss: 100 requisições pela mesma chave devem custar uma consulta ao banco.
- Orçamentos com peso: decodificação de imagens que reserva megabytes em vez de vagas.
- Migrar código com `wg.Add(1)` / `defer wg.Done()` para `wg.Go` com `go fix`.

## Deep Dive

### Pipelines que param: context no lugar do channel done

As regras do blog: estágios fecham seus channels de saída quando todos os sends
terminaram, e continuam recebendo até os channels de entrada fecharem ou os
remetentes serem desbloqueados. Para desbloquear os remetentes, o artigo fecha um
channel `done` como broadcast em que todo send faz select; `ctx.Done()` é o mesmo mecanismo, com deadlines e causas:

```go
func sq(ctx context.Context, in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			select {
			case out <- n * n:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out
}
// gen e merge enviam do mesmo jeito (um pequeno helper genérico send); merge roda um wg.Go por entrada.

in := gen(ctx, 1, 2, 3, 4, 5, 6, 7, 8)
out := merge(ctx, sq(ctx, in), sq(ctx, in)) // fan-out para dois sq, fan-in pelo merge
fmt.Println("first value:", <-out)          // o consumidor quer um valor só
```

A execução que vaza passa `context.Background()`; a corrigida chama `cancel()` depois de ler:

```text
goroutines at start: 1
first value: 1
goroutines after early return, no cancel: 7
first value: 4
goroutines after cancel (leaky ones still there): 7
```

Sem cancelamento, seis goroutines (gen, dois `sq`, dois workers do merge, o que fecha
o channel) ficam presas num send para sempre; o pipeline cancelado não deixou
nenhuma (as 7 são todas do primeiro). O primeiro valor mudou entre execuções: fan-in não tem ordem.

### Fan-out, fan-in e ordem

Quatro workers elevando 1 a 8 ao quadrado a partir de um channel compartilhado, 10.000 vezes no mesmo processo:

```text
fan-in: 243 distinct orders in 10000 runs, 20 runs in input order
fan-in: 232 distinct orders in 10000 runs, 19 runs in input order
```

Quando a ordem importa, envie `job{i, n}` e faça os workers gravarem `res[j.i] = j.n * j.n`
numa slice pré-alocada: cada worker grava um elemento diferente, então não há race,
e a saída foi `[1 4 9 16 25 36 49 64]` em todas as execuções.

### Paralelismo limitado: SetLimit, semaphore, channel com buffer

Vinte tarefas de 20 ms, limite 3; uma sonda registra o pico de tarefas em andamento e o pico de `runtime.NumGoroutine()`:

```go
var g errgroup.Group
g.SetLimit(3)
for range 20 {
	g.Go(func() error { p.work(); return nil }) // bloqueia aqui enquanto 3 rodam
}

sem := semaphore.NewWeighted(3)
for range 20 {
	wg.Go(func() { // Acquire dentro: existem 20 goroutines, 3 trabalham
		sem.Acquire(ctx, 1)
		defer sem.Release(1)
		p.work()
	})
}
```

```text
errgroup.SetLimit(3)         max active 3, peak goroutines  4, took 150ms
semaphore, Acquire inside    max active 3, peak goroutines 20, took 150ms
semaphore, Acquire before go max active 3, peak goroutines  4, took 150ms
chan struct{}, cap 3         max active 3, peak goroutines  4, took 150ms
```

"Acquire before go" move o `sem.Acquire` para dentro do loop; a variante com channel
envia uma ficha num `make(chan struct{}, 3)` antes de cada `wg.Go` e a recebe numa
func com defer (k-ésimo receive antes do send k+3). Todas limitam o trabalho a 3 e
levam 150 ms (7 ondas de 20 ms mais overhead). O que muda é onde a espera acontece:
`SetLimit` bloqueia quem chama `g.Go` (na v0.25.0 é um channel com buffer de fichas),
então as goroutines nunca se acumulam; fazer o Acquire dentro da goroutine limita o
trabalho, não as goroutines, o que pesa com 100.000 tarefas. `TryGo` devolveu `false`
com o limite cheio, e mudar o limite com tarefas rodando dá panic: `errgroup: modify limit while 2 goroutines in the group are still active`.

### Semáforo com peso: FIFO, para pedidos grandes não passarem fome

```go
sem := semaphore.NewWeighted(10) // ex.: 10 MB de buffer de decodificação
sem.Acquire(ctx, 8)              // um job em andamento segura 8
fmt.Println("TryAcquire(1), queue empty:", sem.TryAcquire(1)); sem.Release(1)
go func() { sem.Acquire(ctx, 10); fmt.Println("big(10) acquired after", since()); sem.Release(10) }()
time.Sleep(10 * time.Millisecond) // big já está na fila, 2 fichas livres
fmt.Println("TryAcquire(1), big queued, 2 free:", sem.TryAcquire(1))
go func() { sem.Acquire(ctx, 1); fmt.Println("small(1) acquired after", since()); sem.Release(1) }()
time.Sleep(100 * time.Millisecond)
sem.Release(8) // o job termina; depois, Acquire(11) com timeout de 20 ms
```

```text
TryAcquire(1), queue empty: true
TryAcquire(1), big queued, 2 free: false
big(10) acquired after 112ms
small(1) acquired after 112ms
Acquire(11) on size 10: context deadline exceeded
```

O pedido pequeno na fila atrás do grande também esperou as 8 fichas do job; o código
fonte explica que deixar os pequenos passarem na frente faria passar fome um escritor
que precisa de todas as fichas. Um pedido maior que o semáforo só retorna quando o context termina.

### O primeiro erro vence: errgroup.WithContext

```go
g, ctx := errgroup.WithContext(context.Background())
for id := range 6 {
	g.Go(func() error { return fetch(ctx, id) })
}
// shard 2 falha em 10 ms, shard 4 em 15 ms, os outros esperam 1 s ou ctx.Done()
err := g.Wait()
```

```text
ignoring=false Wait after 16ms: shard 2: connection refused | canceled tasks: 4 | cause: shard 2: connection refused
ignoring=true Wait after 301ms: shard 2: connection refused | canceled tasks: 4 | cause: shard 2: connection refused
```

Os quatro shards saudáveis viram `context.Canceled` na hora e `Wait` devolveu só o
primeiro erro (o `timeout` do shard 4 se perdeu). `Wait` ainda espera todas as funções:
16 ms é o próprio sleep do shard 4, e uma tarefa extra que ignora `ctx` (um
`time.Sleep` de 300 ms) segurou o `Wait` por 300 ms. `WithContext` usa `context.WithCancelCause`,
então `context.Cause(ctx)` diz qual foi a falha. Um panic dentro de `g.Go` não vira
erro: o processo caiu com `panic: bad input` antes de `Wait` retornar (o código fonte
cita a issue 53757 para manter assim).

### singleflight: N chamadores, uma execução

100 goroutines liberadas juntas pelo fechamento de um channel chamam
`g.Do("user:42", func() (any, error) { return loadUser(fail) })`; `loadUser` dorme
50 ms e conta suas execuções:

```text
100 callers, fail=false: executions=1 shared=100 errors=0
100 callers, fail=false: executions=1 shared=100 errors=0
100 callers, fail=true: executions=1 shared=100 errors=100
caller gave up: context deadline exceeded
late joiner: val=user-42 shared=true executions=1
```

A segunda rajada executou a função de novo: `singleflight` junta chamadas em voo, não
é cache. Uma falha chegou aos 100 chamadores. Com `DoChan`, um chamador desistiu no
seu deadline de 10 ms enquanto a chamada seguia, e um chamador posterior entrou nessa execução.

### O context do primeiro chamador é de todos

```go
_, err, _ := g.Do("k", func() (any, error) {
	if detach {
		ctx = context.WithoutCancel(ctx) // a chamada compartilhada sobrevive a qualquer chamador
	}
	return query(ctx) // 50 ms, ou ctx.Err()
})
```

O chamador 0 tem deadline de 10 ms e chega primeiro; nove chamadores sem deadline entram junto:

```text
detach=false: 10 of 10 callers failed, first error: context deadline exceeded
detach=true: 0 of 10 callers failed, first error: <nil>
```

`Do` ignora o context de quem chama, então, com o context desligado, o chamador 0 esperou
os 50 ms inteiros além do seu deadline; limite a espera de cada um com `DoChan` e `select`.

### sync.WaitGroup.Go (Go 1.25)

`wg.Go(f)` chama `Add(1)` antes de iniciar a goroutine, o que elimina o bug clássico
de chamar `Add` dentro dela. Esse bug imprimiu 0 de 3 linhas em 3 de 3 execuções (`Wait`
retornou antes); o analisador `waitgroup` do vet (Go 1.25) o aponta e o `go fix` reescreve a forma antiga:

```text
wgvet/main.go:12:10: WaitGroup.Add called from inside new goroutine
$ go fix -diff ./wgfix
-		wg.Add(1)
-		go func() {
-			defer wg.Done()
+		wg.Go(func() {
 			fmt.Println(i)
-		}()
+		})
```

A doc diz que `f` "must not panic". O código fonte do Go 1.27 mostra o motivo: num panic ele
repete o panic sem chamar `Done`, assim `Wait` não desbloqueia e a `main` não sai antes do relatório do crash.

## Trade-offs

- **errgroup contra WaitGroup.Go**: errgroup acrescenta o primeiro erro, cancelamento e
  limite; `WaitGroup.Go` serve para trabalho sem erro. Nenhum dos dois recupera panics.
- **SetLimit contra semaphore contra channel**: `SetLimit` conta goroutines e bloqueia
  quem cria. `semaphore.Weighted` acrescenta peso e um `Acquire` que respeita context; a
  fila FIFO protege pedidos grandes ao custo de bloqueio na cabeça da fila. Um channel
  com buffer não precisa de dependência e basta para um número fixo de vagas.
- **Cancelamento é cooperativo**: `errgroup` cancela um context, mas não para código
  que o ignora (os 300 ms acima). Toda chamada bloqueante numa tarefa precisa receber `ctx`.
- **singleflight não é cache**: só junta chamadas concorrentes, compartilha erros com
  todos que esperam e roda sob o context de um chamador. Ponha um cache atrás, desligue
  o context e chame `Forget` quando um resultado com falha não deve ser compartilhado.
- **Livro contra hoje**: *Concurrency in Go* (2017) é anterior a `context.Cause` (Go 1.20),
  `context.WithoutCancel` (1.21) e `WaitGroup.Go` (1.25); os padrões continuam valendo, e
  essas APIs substituem partes que antes eram escritas à mão.

## Documentation Links

- [Go Concurrency Patterns: Pipelines and cancellation, The Go Blog](https://go.dev/blog/pipelines): doc
- [Package context (WithCancelCause, Cause, WithoutCancel), pkg.go.dev](https://pkg.go.dev/context): doc
- [Package errgroup, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/errgroup): doc
- [Package semaphore, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/semaphore): doc
- [Package singleflight, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/singleflight): doc
- [sync.WaitGroup.Go, pkg.go.dev](https://pkg.go.dev/sync#WaitGroup.Go): doc
- [Go 1.25 Release Notes: WaitGroup.Go and the waitgroup vet analyzer, go.dev](https://go.dev/doc/go1.25): doc
- [Katherine Cox-Buday, Concurrency in Go, O'Reilly 2017](https://www.oreilly.com/library/view/concurrency-in-go/9781491941294/): book
