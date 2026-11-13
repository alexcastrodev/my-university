---
version: 1.0
updatedAt: 2026-11-13
title: "Detecção de Vazamento de Goroutines: o Perfil goroutineleak e o goleak"
summary: O perfil goroutineleak, GA no Go 1.27 em runtime/pprof e em /debug/pprof/goroutineleak, como o GC prova por alcançabilidade que uma goroutine bloqueada nunca acorda (Golf, ASPLOS 2025), os pontos cegos medidos com primitivas alcançáveis por globais, por goroutines que dormem e por variável capturada na closure, a comparação com o perfil goroutine e com go.uber.org/goleak em testes, e o custo medido de um ciclo de detecção, inclusive o pior caso em cadeia.
---
## Objective

Um vazamento de goroutine é uma goroutine bloqueada para sempre num channel ou numa primitiva de
`sync` que nada pode desbloquear; ela prende a pilha e tudo que a pilha referencia, e o serviço
cresce até ser reiniciado. O Go 1.27 torna o perfil `goroutineleak` disponível para todos: sob
demanda, o GC prova quais goroutines bloqueadas nunca vão acordar, e o `runtime/pprof` as reporta.

Esta lição vaza goroutines de propósito, lê o perfil, explica o algoritmo de alcançabilidade
(Saioc et al., ASPLOS 2025), mostra os pontos cegos e um falso negativo que a documentação não
cita, compara com o perfil de goroutines e com o `go.uber.org/goleak` e mede o custo. Medido com
`go1.27.0 darwin/arm64` num Apple M4 Max (14 núcleos, macOS) e `goleak v1.3.0`; toda saída vem
de 3 ou mais execuções e só se afirma o que foi estável.

## Use Cases

- Provar que a contagem de goroutines subindo é vazamento, não pico de tráfego, com a linha exata.
- Exportar um perfil de vazamento periódico ao lado dos perfis de CPU e heap que o serviço já tem.
- Pegar vazamentos no CI com `goleak` e saber quais só o goleak enxerga.
- Auditar código de fan-out: retorno antecipado em erro, `select` com timeout, `Stop` esquecido.

## Deep Dive

### Um vazamento que o GC consegue provar

O formato clássico: resultados num channel sem buffer, e o coletor retorna no primeiro erro.

```go
func processAll(items []int) ([]int, error) {
	ch := make(chan result) // sem buffer; result é struct{ n int; err error }
	for _, it := range items {
		go func() {
			n, err := work(it) // work(3) falha na hora, as outras dormem 1 ms
			ch <- result{n, err}
		}()
	}
	var out []int
	for range items {
		r := <-ch
		if r.err != nil {
			return nil, r.err // os outros remetentes ficam bloqueados para sempre
		}
		out = append(out, r.n)
	}
	return out, nil
}
```

O `main` inicia 4 workers de pool lendo um channel `jobs` que ele ainda segura, chama `processAll`
10 vezes com 10 itens e depois `pprof.Lookup("goroutineleak").WriteTo(f, 0)` (um GC de detecção):

```text
NumGoroutine: 95
goroutine profile count: 95
goroutineleak profile count: 90
NumGoroutine after detection: 95
```

90 são 10 chamadas vezes 9 remetentes presos. Os 4 workers do pool também estão bloqueados, mas
num channel que uma goroutine em execução ainda alcança. `NumGoroutine` continua 95: o runtime
reporta e não libera nada (o paper do Golf também descreve recuperação; o perfil só reporta).

```text
$ curl -s 'localhost:6060/debug/pprof/goroutineleak?debug=1'
goroutineleak profile: total 144
144 @ 0x104ec0688 0x104e518a4 0x104e514b8 0x10506bc68 0x104ec76a4
#	0x10506bc67	main.processAll.func1+0x97	./main.go:30
```

Essa é uma variante servidor que chama `processAll` em loop com `import _ "net/http/pprof"` (sem
flag no 1.27); `go tool pprof -list processAll.func1` põe todas na linha 30. `debug=2` despeja
todas as goroutines no formato de panic, e as vazadas ganham um status novo: `goroutine 39 [chan
send (leaked)]:`. Medido: só escrever o perfil dispara a detecção, e `Profile.Count()` devolve o
resultado do último ciclo (0 antes do primeiro), então o índice `/debug/pprof/` pode estar velho.

### Como a detecção funciona

Pelo design doc da proposta (74609) e pelo `runtime/mgc.go` do go1.27.0:

1. A marcação parte das globais e só das goroutines que ainda podem rodar, não de toda pilha.
2. Os ponteiros do `sudog` de uma goroutine bloqueada para o seu channel ou objeto de `sync` ficam
   não rastreáveis no ciclo, para a goroutine não manter vivo o próprio channel.
3. Quando a marcação termina, cada goroutine bloqueada cuja primitiva foi marcada vira raiz e a
   marcação recomeça, até nada novo ser promovido.
4. As restantes passam para `_Gleaked` e são reportadas; depois as pilhas delas são marcadas, e o
   ciclo não libera nada que elas referenciam.

A checagem por goroutine (`isMaybeRunnable`) trata `select {}` e operações em channel nil como
nunca executáveis, confere esperas em channel, `select`, `Cond`, `WaitGroup`, `Mutex` e `RWMutex`
contra os bits de marcação, e devolve "talvez executável" para todo o resto (sleep, espera de
I/O). O design doc afirma que a abordagem é correta ("there are no false positives"): uma
primitiva que nenhum código executável alcança nunca mais pode ser operada.

### Ponto cego: uma global ou uma goroutine viva ainda alcança a primitiva

As release notes avisam que vazamentos em primitivas alcançáveis "through global variables or the
local variables of runnable goroutines" podem passar. Os mesmos 10 remetentes presos, de três jeitos:

```go
ch := make(chan int)
for i := range 10 {
	go func(c chan int, v int) { c <- v }(ch, i) // ch por valor: o ch = nil abaixo não interfere
}
switch mode {
case "global":
	lastCh = ch // uma var chan int no nível do pacote
case "runnable": // um monitor que dorme em loop, segurando ch numa variável local
	go func(c chan int) {
		for {
			time.Sleep(time.Second)
			_ = len(c)
		}
	}(ch)
}
ch = nil
```

```text
local    NumGoroutine=11 goroutineleak=10
global   NumGoroutine=11 goroutineleak=0
runnable NumGoroutine=12 goroutineleak=0
```

Os remetentes estão igualmente presos nos três casos; só a alcançabilidade mudou. Goroutine que
dorme conta como executável, então qualquer goroutine longeva com uma referência esconde o
vazamento. Capturar `ch` (`go func(v int) { ch <- v }(i)`) estraga a medida: quem não rodou antes de
`ch = nil` envia num channel nil, vazado por definição, e global e runnable deram 6 a 10.

### Um falso negativo que a documentação não cita

Montando estes exemplos, vazamentos escritos como `go func() { ch <- i }()` nunca apareciam.
Quatro jeitos de enviar a partir de 10 goroutines que vazam todas:

```go
go func() { ch <- i }()       // captured:  newly leaked 0
go func() { ch <- i + 1 }()   // computed:  newly leaked 10
go func(v int) { ch <- v }(i) // param:     newly leaked 10
go func() { ch <- 42 }()      // constant:  newly leaked 10
```

O assembly arm64 da closure `captured` (`go build -gcflags=-S`) explica:

```text
main.captured.func1:
	ADD	$16, R26, R1      // elem = &closure.i (R26 é o contexto da closure)
	MOVD	8(R26), R0        // ch, lido do mesmo objeto closure
	CALL	runtime.chansend1(SB)
```

Um envio passa o valor por endereço; aqui ele aponta para dentro da closure no heap, que também
guarda `ch`. Em esperas de channel o detector esconde `sudog.c`, mas deixa `sudog.elem`
rastreável, então o GC percorre goroutine, `sudog`, closure, channel e marca o channel. As outras
variantes enviam de um temporário na pilha. Medido no go1.27.0 darwin/arm64, ausente do blog, das
release notes e do design doc: perfil vazio é "nenhum vazamento provado", nunca "nenhum vazamento".

### Perfil de goroutines versus perfil de vazamento

O perfil `goroutine` comum do primeiro programa:

```text
goroutine profile: total 95
90 @ 0x104c13f48 0x104bae224 0x104bade38 0x104c68788 0x104c1a054
#	0x104c68787	main.processAll.func1+0x97	./main.go:30
4 @ 0x104c13f48 0x104baf0e0 0x104baec54 0x104c687d4 0x104c1a054
#	0x104c687d3	main.startPool.func1+0x33	./main.go:47
```

Os dois grupos estão parados em operações de channel e nada diz qual é o bug: o blog chama o perfil
de goroutines de "a rudimentary way", que não separa vazamento de bloqueio proposital. O LeakProf
da Uber (CGO 2024) minerou esses perfis com heurísticas e ainda achou 24 vazamentos em produção
(21 corrigidos, até 34% de ganho de velocidade e 9,2x menos memória em alguns serviços).

### goleak nos testes

O `goleak` lista todas as goroutines no fim do teste e falha se sobrar alguma inesperada:

```go
func TestLeaky(t *testing.T) {
	defer goleak.VerifyNone(t)
	ProcessAll(items, false) // TestFixed passa true: make(chan result, len(items))
}

var events = make(chan string) // nível do pacote

func StartAudit() { go func() { for range events {} }() }

func TestAudit(t *testing.T) {
	defer goleak.VerifyNone(t)
	StartAudit()
}
```

```text
--- FAIL: TestLeaky (0.44s)
    work_test.go:18: found unexpected goroutines:
        [Goroutine 8 in state chan send, with example.com/goleaktest.ProcessAll.func1 on top of the stack:
         Goroutine 9 in state chan send, with example.com/goleaktest.ProcessAll.func1 on top of the stack:
--- PASS: TestFixed (0.00s)
$ go test -run '^TestAudit$' .
--- FAIL: TestAudit (0.45s)
    work_test.go:32: found unexpected goroutines:
        [Goroutine 6 in state chan receive, with example.com/goleaktest.StartAudit.func1 on top of the stack:
```

As pilhas foram cortadas: o goleak v1.3.0 lista cada um dos 9 remetentes com a própria pilha.
O `TestFixed` também passa `goleak.IgnoreCurrent()`; sem isso ele falhava, porque o `VerifyNone`
enxerga o processo inteiro, inclusive as 9 goroutines que o `TestLeaky` deixou. Os 0,44 s são o
goleak tentando de novo (20 tentativas, espera de até 100 ms). Depois de `ProcessAll` mais
`StartAudit`, o perfil do runtime reportou `goroutineleak count = 9`: o consumidor de auditoria
espera num channel global, então só o goleak o aponta. Segundo o paper do CGO 2024, o goleak achou
857 vazamentos antigos num monorepo de 75 milhões de linhas e evitou cerca de 260 novos em um ano.

### Quanto custa um ciclo de detecção

Vazamentos comuns (n goroutines vazadas em channels separados, 5 execuções) e o pior caso
"daisy chain" do blog (a goroutine i espera no channel i e segura o channel i+1, cabeça numa
global, nada vazado, então cada rodada do passo 3 promove uma goroutine; 3 execuções):

```text
n=10000   runtime.GC 2.5 to 3.5 ms   goroutineleak 7.8 to 8.3 ms   goroutine 4.8 to 5.0 ms
n=100000  runtime.GC 25 to 26 ms     goroutineleak 80 to 82 ms     goroutine 51 to 52 ms
chain n=1000    runtime.GC ~0.4 ms     goroutineleak 30 to 34 ms
chain n=4000    runtime.GC ~2 ms       goroutineleak 155 to 169 ms
chain n=16000   runtime.GC 4 to 6 ms   goroutineleak 1.31 to 1.36 s
```

O `runtime/metrics` contou 16003 pausas stop-the-world no ciclo de 16000 (uma por rodada), nenhuma
num bucket acima de 0,92 ms; o `GODEBUG=gctrace=1` marca o ciclo com `(checking for goroutine leaks)`.

## Trade-offs

- **Correto, não completo**: sem falsos positivos por construção, mas vazamento em algo ainda
  alcançável (globais, locais de goroutine que dorme, o caso da variável capturada) fica invisível,
  e o perfil aponta a linha bloqueada, não o `return` ou o `close` que faltou. Combine com `goleak`.
- **Só channels e `sync`**: segundo o blog, goroutines bloqueadas em I/O de arquivo ou rede,
  syscalls diretas ou primitivas próprias nunca são reportadas (só documentação, não medido aqui).
- **Sob demanda, com um caso patológico**: vazamentos comuns custam de 2x a 3x um GC, mas cadeias
  longas de goroutines dependentes custam segundos de marcação e milhares de pausas curtas. O blog
  sugere coletar periodicamente (por exemplo a cada 4 horas), já que o vazamento continua visível.
- **O goleak enxerga o processo, não o teste**: reporta toda goroutine que sobrou, inclusive as
  legítimas de background (filtre com `IgnoreTopFunction` ou `IgnoreCurrent`), e a documentação diz
  que `VerifyNone` é incompatível com `t.Parallel`; nesse caso use `VerifyTestMain`.
- **Antes versus hoje**: o Go 1.26 trazia o perfil atrás de `GOEXPERIMENT=goroutineleakprofile`;
  o Go 1.27 removeu essa configuração e ligou o perfil.

## Documentation Links

- [Goroutine Leak Profiles, The Go Blog](https://go.dev/blog/goroutine-leak-profiles): doc
- [Go 1.27 Release Notes: Goroutine leak profile](https://go.dev/doc/go1.27): doc
- [Proposal 74609: Goroutine leak detection via garbage collection](https://go.googlesource.com/proposal/+/HEAD/design/74609-goroutine-leak-detection-gc.md): doc
- [runtime/pprof package documentation](https://pkg.go.dev/runtime/pprof): doc
- [net/http/pprof package documentation](https://pkg.go.dev/net/http/pprof): doc
- [go.uber.org/goleak package documentation](https://pkg.go.dev/go.uber.org/goleak): doc
- [Dynamic Partial Deadlock Detection and Recovery via Garbage Collection, ASPLOS 2025](https://doi.org/10.1145/3676641.3715990): paper
- [Unveiling and Vanquishing Goroutine Leaks in Enterprise Microservices, CGO 2024](https://arxiv.org/abs/2312.12002): paper
