---
version: 1.0
updatedAt: 2026-11-12
title: "Bugs de Concorrência: Races e Deadlocks em Código Go Real"
summary: A taxonomia bloqueante versus não bloqueante e memória compartilhada versus troca de mensagens de 171 bugs reais (ASPLOS 2019) e as causas de 1.011 races corrigidas na Uber (PLDI 2022), reproduzidas com relatórios reais do -race, fatal errors do runtime e mensagens do go vet: captura da variável de loop com go 1.21 versus go 1.22, escrita concorrente em map, append em slice sem lock, WaitGroup.Add dentro da goroutine e WaitGroup.Go, um envio que ninguém recebe e o vazamento que o runtime nunca reporta, um mutex copiado por valor, o custo medido do race detector e GCatch e GFix como detecção estática.
---
## Objective

Tu et al. (ASPLOS 2019) classificaram 171 bugs corrigidos em Docker, Kubernetes, etcd, gRPC, CockroachDB
e BoltDB por comportamento (bloqueante ou não) e causa (memória compartilhada ou troca de mensagens).
Chabbi e Ramanathan (PLDI 2022) rotularam 1.011 races corrigidas no monorepo Go da Uber. Esta lição
reproduz os padrões recorrentes com o relatório do `-race`, o fatal error ou o `go vet`, e a correção.

Toda saída vem do Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha de módulo `go 1.27`, salvo quando a seção
diz outra coisa) num Apple M4 Max com macOS (darwin/arm64). Nos relatórios de race, os caminhos foram
encurtados para `...` e as pilhas de criação das goroutines foram cortadas.

## Use Cases

- Decidir o que o `go test -race` no CI pega e o que não pega, e onde o `go vet` cobre a lacuna.
- Revisar código com goroutines contra os padrões que produziram a maioria dos bugs reais.
- Ler um relatório `WARNING: DATA RACE` ou um dump de `fatal error` durante um incidente.
- Discutir channels versus mutexes com dados em vez de slogans.

## Deep Dive

### O que projetos reais erram

Tabelas 5, 6 e 9 de Tu et al., os 171 bugs nos dois eixos:

| causa | bloqueante | não bloqueante | total |
|---|---|---|---|
| memória compartilhada | 36 (Mutex 28, RWMutex 5, Wait 3) | 69 | 105 |
| troca de mensagens | 49 (Chan 29, Chan com outras operações 16, Lib 4) | 17 | 66 |
| total | 85 | 86 | 171 |

"Bloqueante" é mais amplo que deadlock: inclui goroutines esperando uma mensagem que ninguém envia.
Cerca de 58% dos bugs bloqueantes vieram de troca de mensagens, contra a crença de que channels são
mais seguros, enquanto cerca de 80% dos não bloqueantes vieram de memória compartilhada. Nos bugs que
reproduziram, o detector de deadlock do runtime pegou 2 de 21 bloqueantes e o race detector 10 de 20.

O estudo da Uber traz escala: cerca de 46 milhões de linhas, 2.100 serviços, mediana de 2.048
goroutines por processo Go contra 256 threads por processo Java, cerca de 2.000 races em seis meses.
As Tabelas 2 e 3 contam as 1.011 races corrigidas por causa (os rótulos se sobrepõem): lock ausente ou
parcial 470, acesso concorrente a slice 391, APIs thread-safe usadas fora do contrato 369, testes
table-driven em paralelo 139, captura por referência 121 (48 variáveis de loop, 50 variáveis `err`),
maps 38, confusão entre valor e ponteiro 38, sincronização de grupo 24.

### Captura da variável de loop: go 1.21 versus go 1.22

```go
for i := 0; i < 4; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		mu.Lock()
		seen[i]++ // qual i?
		mu.Unlock()
	}()
}
```

```text
$ go run .        # go.mod diz go 1.21; 20 de 20 execuções
map[4:4]
$ go run -race .
WARNING: DATA RACE
Read at 0x00c000012150 by goroutine 6:
  main.main.func1()
      .../loop121/main.go:17 +0x80

Previous write at 0x00c000012150 by main goroutine:
  main.main()
      .../loop121/main.go:12 +0xa8
...
Found 1 data race(s)
exit status 66
$ go vet .
main.go:17:9: loop variable i captured by func literal
$ go run -race .  # mesmo arquivo, go.mod diz go 1.22
map[0:1 1:1 2:1 3:1]
```

Mesmo toolchain 1.27, resultado diferente: a linha `go` do módulo escolhe a semântica. Desde a 1.22
cada iteração ganha uma variável nova e o vet fica em silêncio. A race é o `i++` (linha 12) contra a
leitura na goroutine. Variáveis `err` capturadas (50 races da Uber) não são de loop: continuam compartilhadas.

### Escrita concorrente em map: fatal error, não panic

```go
hits := map[string]int{}
for w := range 8 {
	wg.Go(func() {
		for i := range 100_000 {
			hits[string(rune('a'+(w+i)%26))]++
		}
	})
}
```

```text
fatal error: concurrent map writes

goroutine 20 [running]:
```

Exit status 2 em 5 de 5 execuções; um `defer func() { recover() }()` em cada goroutine não mudou nada,
porque um fatal error derruba o processo. A checagem é de melhor esforço: duas goroutines com 10
incrementos cada imprimiram `map[k:20]` em 200 de 200 execuções, enquanto o `-race` reportou a race
dentro de `runtime.mapaccess1_faststr`. Use `sync.Mutex` em volta do map, ou `sync.Map` se a leitura domina.

### Append em slice compartilhado sem lock

```go
var results []int
for i := range 1000 {
	wg.Go(func() { results = append(results, i) }) // sem lock
}
wg.Wait()
fmt.Println("len:", len(results))
```

```text
$ for i in $(seq 10); do ./sa; done | tr '\n' ' '
len: 953 len: 850 len: 931 len: 999 len: 953 len: 866 len: 849 len: 874 len: 881 len: 963
$ go run -race . 2>&1 | tail -3
len: 670
Found 4 data race(s)
exit status 66
```

Nada de crash, só elementos perdidos: de 1 a 151 de 1.000 por execução. Duas goroutines leem o mesmo
header do slice, as duas fazem append, uma escrita vence; o `-race` apontou a linha 13 para a escrita
e para a leitura anterior. Um mutex em volta do `append`, ou um `make([]int, 1000)` pré-alocado em que
a goroutine `i` escreve só `results[i]`, imprimiram 1.000 com o `-race` limpo.

### WaitGroup.Add dentro da goroutine

```go
for i := range results { // 100 posições
	go func() {
		wg.Add(1) // tarde demais: Wait pode já ter visto zero
		defer wg.Done()
		results[i] = true
	}()
}
wg.Wait()
```

```text
$ go vet .
wgadd/main.go:13:10: WaitGroup.Add called from inside new goroutine
$ go run .
done when Wait returned: 93
```

Em 10 execuções o `Wait` retornou com 83 a 98 das 100 goroutines terminadas, e o `-race` reportou a
escrita da linha 15 contra a leitura do `main` na linha 20. Tu et al. acharam 6 bugs dessa regra ("Add
has to be invoked before Wait"), um no etcd. O analisador `waitgroup` é novo no Go 1.25, como o
`WaitGroup.Go`, que chama `Add` antes de iniciar a goroutine: os loops com `wg.Go` daqui não têm o bug.

### Enviar num channel que ninguém recebe

```go
ch := make(chan int)
ch <- 1 // ninguém nunca vai receber
```

```text
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan send]:
main.main()
	.../deadlock/main.go:7 +0x38
exit status 2
```

O runtime só diz isso quando todas as goroutines estão bloqueadas. A Figura 1 de Tu et al., um bug do
Kubernetes, é o formato realista: a filha envia o resultado num channel sem buffer enquanto o pai faz
`select` nele e em `time.After`. Quando o timeout vence, a filha bloqueia para sempre:

```go
ch := make(chan int)      // correção: make(chan int, 1)
go func() { time.Sleep(2 * time.Millisecond); ch <- 42 }()
select {
case r := <-ch: return r, true
case <-time.After(timeout): return 0, false // timeout de 1 ms, 1.000 chamadas
}
```

```text
buffered=false goroutines still alive: 1001
buffered=true goroutines still alive: 1
```

1.000 goroutines vazadas, exit status 0, nenhuma palavra do runtime (5 de 5 execuções). Deadlocks
parciais assim são o motivo de existirem o perfil de vazamento de goroutines e o `goleak`.

### Um mutex copiado por valor

```go
type Counter struct{ mu sync.Mutex; n map[string]int }
func (c Counter) Inc(k string) { // receiver por valor: trava uma cópia de mu
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n[k]++ // o map em si é compartilhado
}
```

```text
$ go vet .
mutexcopy/main.go:13:9: Inc passes lock by value: bugs/mutexcopy.Counter contains sync.Mutex
$ go run .   # 4 goroutines, 1.000 Inc cada
fatal error: concurrent map writes
```

Cinco de cinco execuções quebraram: cada chamada travou a própria cópia, então nada foi excluído. Com
receiver ponteiro (`func (c *Counter) Inc`) o vet fica quieto e o `-race` imprime `4000` com exit status 0.

### O que o detector custa e o que ele deixa passar

Os mesmos 4 x 1.000.000 incrementos com lock, compilados normalmente e com `-race` (3 execuções cada):

| build | tempo real | RSS máximo | binário |
|---|---|---|---|
| normal | 0,55 a 0,75 s | 4,8 a 5,0 MB | 2,4 MB |
| `-race` | 2,57 a 2,82 s | 28,8 a 34,8 MB | 3,1 MB |

Cerca de 4,5x em tempo e 6x em memória, dentro dos 2 a 20x e 5 a 10x documentados. A documentação diz
que ele só acha races em caminhos que executam, e o `exitcode` do `GORACE` tem padrão 66, o status de
toda execução com race acima. A Uber o rodou diariamente, depois do merge, sobre mais de 100.000 testes
unitários em vez de bloquear pull requests: o percentil 95 do tempo de teste foi de 25 para uns 100 minutos.

A análise estática ataca o lado bloqueante. O GCatch (Liu et al., ASPLOS 2021) transforma operações de
channel em restrições para um solver; em 21 aplicações achou 149 bugs bloqueantes inéditos e o GFix gerou
patches para 124. Os desenvolvedores corrigiram 125 dos bugs reportados, 87 com o patch do GFix.

## Trade-offs

- **Rode o vet explicitamente**: o `go test` passou num pacote com um mutex copiado e um `Add` dentro
  da goroutine; o `go vet` apontou os dois. O subconjunto do vet dentro do `go test` não os inclui.
- **Bloqueio no CI versus execução agendada**: bloquear cada pull request impede races novas, mas
  custa os 4,5x medidos acima; a Uber escolheu uma execução diária que abre bugs.
- **Channels não são automaticamente mais seguros**: 58% dos bugs bloqueantes em Tu et al. eram de
  troca de mensagens. Para cada envio, pergunte quem recebe, quem fecha e o que acontece no timeout.
- **A mensagem de deadlock é a exceção**: uma goroutine viva (um ticker, um servidor HTTP) esconde
  todas as travadas. Conte goroutines nos testes e perfile vazamentos em produção.
- **Suba a linha `go` com intenção**: levar um módulo para 1.22 ou mais muda a semântica de loop em
  todos os arquivos, o que corrige capturas mas pode mudar código que dependia do compartilhamento.

## Documentation Links

- [Data Race Detector, Go documentation](https://go.dev/doc/articles/race_detector): doc
- [Understanding Real-World Concurrency Bugs in Go, Tu et al., ASPLOS 2019](https://songlh.github.io/paper/go-study.pdf): paper
- [A Study of Real-World Data Races in Golang, Chabbi and Ramanathan, PLDI 2022](https://arxiv.org/abs/2204.00764): paper
- [Automatically Detecting and Fixing Concurrency Bugs in Go Software Systems (GCatch and GFix), ASPLOS 2021](https://doi.org/10.1145/3445814.3446756): paper
- [Fixing For Loops in Go 1.22, The Go Blog](https://go.dev/blog/loopvar-preview): doc
- [Go 1.25 Release Notes: waitgroup analyzer and WaitGroup.Go](https://go.dev/doc/go1.25): doc
- [copylock analyzer, golang.org/x/tools](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/copylock): doc
- [The Go Memory Model](https://go.dev/ref/mem): doc
