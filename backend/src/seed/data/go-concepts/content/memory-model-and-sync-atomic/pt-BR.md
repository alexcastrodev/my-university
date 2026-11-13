---
version: 1.0
updatedAt: 2026-11-12
title: "Modelo de Memória do Go e sync/atomic"
summary: O modelo de memória do Go revisado em 2022 com happens-before e as arestas synchronized-before de channels, mutexes, sync.Once, WaitGroup e atomics, DRF-SC, testes litmus de store buffering e message passing mostrando reordenação real no arm64, o compilador apagando escritas de um loop com race, o que um programa com race ainda garante (valores de uma palavra sem out-of-thin-air) e o que não garante (interface rasgada até o SIGSEGV), atomics sequencialmente consistentes e tipados (atomic.Int64, atomic.Pointer[T]), os avisos do vet e o double-checked init quebrado contra sync.OnceValue e atomic.Pointer, com relatórios reais do -race.
---
## Objective

O modelo de memória do Go (versão de 6 de junho de 2022, publicada com o Go 1.19)
diz quando uma leitura numa goroutine tem garantia de ver a escrita de outra. A
promessa central é DRF-SC: um programa sem data race se comporta como se todas as
goroutines fossem intercaladas num único processador. Esta lição cobre as arestas
que criam essa ordem (channels, mutexes, `sync.Once`, `WaitGroup`, atomics) e depois
quebra a promessa de propósito para ver o que o Go ainda garante num programa com
race e onde isso acaba: valores de uma palavra ficam inteiros, interfaces rasgam e
derrubam o processo. Medido com Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha `go 1.27`
no módulo) num Apple M4 Max (14 núcleos, arm64), macOS 27.0.1. Toda contagem vem de
pelo menos 3 execuções e o texto só afirma o que se repetiu em todas.

## Use Cases

- Revisar um caminho rápido "lock-free" (feature flag, config recarregada a quente): `atomic.Pointer`, `OnceValue` ou mutex?
- Ler um relatório do `-race` e derrubar o argumento "é uma race benigna" com evidência.
- Contadores atualizados por muitas goroutines (`atomic.Int64` no lugar de `int64` com `AddInt64`).
- Portar código Java ou C++: o Go só tem atomics sequencialmente consistentes, sem acquire/release nem relaxed.

## Deep Dive

### Happens-before numa tabela

*Happens-before* é a ordem do programa dentro de uma goroutine mais as arestas
*synchronized-before* entre goroutines. Um *data race* é uma escrita concorrente com
outra leitura ou escrita do mesmo local, a menos que todos os acessos sejam atômicos. As arestas, de `go.dev/ref/mem` e da doc do `sync`:

| Aresta | Synchronized before |
|--------|---------------------|
| `go f()` | o início de `f` (o fim de uma goroutine não sincroniza com nada) |
| send num channel | a conclusão do receive correspondente |
| `close(ch)` | um receive que devolve o valor zero porque `ch` foi fechado |
| receive num channel sem buffer | a conclusão do send correspondente |
| k-ésimo receive num channel de capacidade C | a conclusão do send k+C (um semáforo contador) |
| chamada n de `mu.Unlock()` | o retorno da chamada m de `mu.Lock()`, para n < m |
| retorno de `f` em `once.Do(f)` | o retorno de todo `once.Do(f)` |
| `wg.Done()`, ou retorno de `f` em `wg.Go(f)` | o retorno do `Wait` que ele desbloqueia |
| operação atômica A cujo efeito B observa | B; todos os atomics formam uma única ordem sequencialmente consistente |

### Um contador com race e o race detector

```go
var plain int64
var typed atomic.Int64
var wg sync.WaitGroup
for range 8 {
	wg.Go(func() {
		for range 100_000 {
			plain++      // read-modify-write, não atômico
			typed.Add(1) // atomic sequencialmente consistente
		}
	})
}
wg.Wait()
fmt.Println("plain:", plain, "atomic:", typed.Load())
```

```text
$ go run ./counter              (duas execuções)
plain: 112185 atomic: 800000
plain: 113722 atomic: 800000
$ go run -race ./counter        (caminhos encurtados)
WARNING: DATA RACE
Read at 0x00c00019e030 by goroutine 11:
  main.main.func1()   counter/main.go:16
Previous write at 0x00c00019e030 by goroutine 8: ...
Found 2 data race(s)
exit status 66
```

Seis de cada sete incrementos se perderam; 66 é o `exitcode` padrão do detector.

### Memória fraca no hardware real: dois testes litmus

Store buffering: cada goroutine grava uma variável e depois lê a outra. Com
consistência sequencial, pelo menos uma precisa ler 1. A cada rodada, a main zera
as variáveis, libera as duas goroutines por uma barreira atômica e confere o
resultado depois que as duas respondem (1.000.000 de rodadas):

```go
case first:  x = 1; r1 = y          // int32 comum
default:     y = 1; r2 = x
// versão atômica: ax.Store(1); r1 = ay.Load()  e  ay.Store(1); r2 = ax.Load()
```

```text
plain  int32: r1==0 && r2==0 in 498237 of 1000000 rounds
atomic.Int32: r1==0 && r2==0 in 0 of 1000000 rounds
(flag,data): map[[0 0]:4987472 [0 1]:2906 [1 0]:44 [1 1]:9578]
```

Em 8 execuções o resultado comum variou de 130.614 a 528.280; o atômico foi sempre
0. A última linha é message passing (`data = 1; flag = 1` contra
`r1 = flag; r2 = data`, 5.000.000 de rodadas): o proibido `flag=1, data=0` apareceu
em 10 de 11 execuções, de 6 a 53 vezes por execução.

`go build -gcflags=-S` mostra que o compilador manteve a ordem do programa (`MOVD R1, main.data`
e depois `MOVD R1, main.flag`; o leitor carrega `flag` e depois `data`), então a
reordenação veio do núcleo arm64, não do compilador.

### O que o compilador pode fazer com uma race

```go
var ticks int
go func() { for { ticks++ } }() // sem sincronização, nunca termina
time.Sleep(100 * time.Millisecond)
fmt.Println("ticks after 100ms:", ticks) // ticks after 100ms: 0   (3 de 3 execuções)
```

A goroutine virou um `HINT $0` e um salto de volta: o incremento foi apagado, já
que nada sincroniza com aquele loop. O caso oposto também existe: um busy wait
`for !ready {}` num `bool` comum terminou em 3 de 3 execuções porque o Go 1.27
recarrega `main.ready` a cada iteração (`MOVBU main.ready(SB), R1; TBZ`). A doc diz
que esse loop "is not guaranteed to finish" e o `-race` o denuncia. Funcionar hoje
por um detalhe do otimizador não é o mesmo que estar correto.

### O que um programa com race ainda garante, e onde isso acaba

A leitura de um local de uma palavra ou menor precisa observar um valor que foi de
fato escrito nele, e valores out-of-thin-air são proibidos (esse ponto vem só da
doc: não dá para observar uma ausência). Um escritor alternando um `int64` entre `0`
e `-1` (todos os bits ligados) por um segundo deu `map[-1:42363463 0:81054537]`: em 3 execuções, nada além disso.

Valores maiores que uma palavra não têm essa promessa. Uma interface tem duas
palavras (itab e dados), e o escritor grava uma de cada vez:

```go
type Getter interface{ Get() int }
type A struct{ v int }
type B struct{ v int }
func (a *A) Get() int { return a.v }      // &A{1} -> 1
func (b *B) Get() int { return b.v * 10 } // &B{2} -> 20

// escritor: shared = a / shared = b, alternando até uma flag atômica de parada
// leitor: counts[shared.Get()]++ durante um segundo
```

```text
map[1:16673637 2:15410192 10:11677999 20:12073172]
map[1:21992373 2:17146744 10:10330789 20:12848094]
```

`2` é `A.Get` sobre os dados de `B`, `10` é `B.Get` sobre os dados de `A`: em três
execuções, de 44 a 52% das leituras viram um valor que nenhuma escrita produziu. O
assembly do escritor é `MOVD R3, main.shared(SB)`, um teste de write barrier e depois `MOVD R0, main.shared+8(SB)`.
Dê a `B` um campo ponteiro (`Get` devolve `*b.p`) e o rasgo derruba o processo, 3 de 3 execuções:

```text
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0x1 pc=0x102adb544]
```

`addr=0x1` é o inteiro de `A{1}` usado como ponteiro de `B`. Slices (3 palavras) e
strings (2 palavras) ficam expostos do mesmo jeito: é a "arbitrary memory corruption" de que o modelo avisa.

### sync/atomic: sequencialmente consistente e tipado

O Go 1.19 trouxe `atomic.Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr` e
`Pointer[T]` (`And`/`Or` chegaram na 1.23); as release notes dizem que o Go "only
provides sequentially consistent atomics". Trocar a interface por um único ponteiro acaba com o rasgo:

```go
var shared atomic.Pointer[Getter]
// escritor: shared.Store(&a) / shared.Store(&b); leitor: (*shared.Load()).Get()
// saída: map[1:85045272 20:32697728]   (3 execuções; -race: nenhum relatório)
```

`atomic.Value` não faz essa troca, porque todo `Store` precisa usar o mesmo tipo concreto:
`sync/atomic: store of inconsistently typed value into Value`. Os atomics tipados
também impedem acesso comum misturado, e o vet pega os erros clássicos:

```text
$ go build ./compileerr      (var hits atomic.Int64; hits++)
compileerr/main.go:7:2: invalid operation: hits++ (non-numeric type atomic.Int64)
$ go vet ./vetdemo
vetdemo/main.go:14:2: direct assignment to atomic value
vetdemo/main.go:10:17: snapshot passes lock by value: example.com/mm/vetdemo.Stats contains sync/atomic.Int64 contains sync/atomic.noCopy
```

Segundo a doc, `Int64`/`Uint64` ficam alinhados em 64 bits mesmo em plataformas de 32
bits, onde `AddInt64` e companhia exigem alinhamento manual (não testável no arm64).

### Inicialização double-checked: quebrada e corrigida

```go
func getBroken() *Config {
	if !loaded { // bool comum lido fora do lock
		mu.Lock()
		if !loaded {
			cfg = &Config{Port: 8080}
			loaded = true
		}
		mu.Unlock()
	}
	return cfg
}
```

Quatro goroutines com `-race`: `Found 3 data race(s)`. Como teste litmus (2.000.000
de rodadas, 3 execuções) ela nunca devolveu `nil` aqui, o que não prova nada: o teste
de message passing mostra este núcleo reordenando esse formato, e o modelo permite
`loaded == true` com `cfg == nil`. Duas versões corretas:

```go
var getConfig = sync.OnceValue(func() *Config { return &Config{Port: 8080} })

var ptr atomic.Pointer[Config] // a flag É o ponteiro
func getAtomicDCL() *Config {
	if c := ptr.Load(); c != nil {
		return c
	}
	ptrMu.Lock()
	defer ptrMu.Unlock()
	if ptr.Load() == nil {
		ptr.Store(load())
	}
	return ptr.Load()
}
```

`b.RunParallel` com 14 goroutines (tempo de parede por chamada, 5 execuções cada): `OnceValue`
0,20 a 0,21 ns/op, DCL atômico 0,17 a 0,18 ns/op, um mutex em volta do teste 107 a 110 ns/op.

## Trade-offs

- **OnceValue contra Once quando falha**: chamado duas vezes com um loader que entra em panic,
  `Once.Do` imprimiu `panic: config file missing` e depois `returned, cfg = <nil>`:
  um panic conta como retorno e o valor fica zero em silêncio. `OnceValue` entrou em
  panic nas duas vezes, e `OnceValues` devolveu o erro em cache nas duas. Nenhum tenta
  de novo; para "tentar até dar certo", use `atomic.Pointer` com um mutex.
- **Atomics contra mutex**: um atomic ordena uma variável. Dois campos que precisam
  mudar juntos pedem um mutex, ou um `atomic.Pointer` para uma struct imutável.
- **atomic.Pointer[T] contra atomic.Value**: `Pointer[T]` é verificado em tempo de compilação;
  `Value` entra em panic com outro tipo concreto ou com `nil`.
- **O race detector**: segundo a doc, ele só acha races que executam, ao custo de 5 a 10x de
  memória e 2 a 20x de tempo. Rode os testes com `-race` no CI, e um canário quando a cobertura for fraca.
- **Races "benignas"**: as escritas apagadas e a interface rasgada são resultados
  legais. O conselho do próprio modelo: "If you must read the rest of this document to
  understand the behavior of your program, you are being too clever. Don't be clever."
- **Sem atomics relaxed**: mais simples de raciocinar, mas contenção ainda custa. Um
  `atomic.Int64` martelado por 14 goroutines: 48 ns/op; shards por goroutine com padding
  até a linha de 128 bytes (`hw.cachelinesize`): 0,15 ns/op (5 execuções cada). Particione contadores quentes.

## Documentation Links

- [The Go Memory Model, go.dev](https://go.dev/ref/mem): doc
- [Package sync/atomic, pkg.go.dev](https://pkg.go.dev/sync/atomic): doc
- [Package sync (Once, OnceValue, WaitGroup, Mutex), pkg.go.dev](https://pkg.go.dev/sync): doc
- [Go 1.19 Release Notes: memory model revision and atomic types, go.dev](https://go.dev/doc/go1.19): doc
- [Data Race Detector, go.dev](https://go.dev/doc/articles/race_detector): doc
- [Adve and Boehm, Memory Models: A Case for Rethinking Parallel Languages and Hardware, CACM 2010](https://doi.org/10.1145/1787234.1787255): paper
- [Russ Cox, Updating the Go Memory Model, research.swtch.com (complement to the Go Memory Model)](https://research.swtch.com/gomm): doc
