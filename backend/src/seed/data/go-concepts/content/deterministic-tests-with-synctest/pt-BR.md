---
version: 1.0
updatedAt: 2026-11-13
title: "Testes Determinísticos com testing/synctest"
summary: Bolhas do testing/synctest (GA no Go 1.25) com relógio falso que só avança quando toda goroutine está durably blocked, o que conta como bloqueio durável e por que mutex e I/O congelam o relógio, synctest.Wait como ponto de sincronização para o race detector, retry, deadline e expiração de cache de 23 minutos falsos medidos em microssegundos, o flake de timers no mesmo instante corrigido por synctest.Sleep (Go 1.27), httptest.NewTestServer (Go 1.27) com rede em memória, e os panics e fatal errors medidos ao quebrar cada regra.
---
## Objective

Código que espera (retry com backoff, timeouts, caches com TTL, tickers) é o que os times menos
testam: um teste real dorme por minutos ou faz polling com timeout curto e vira flaky. O
`testing/synctest`, disponível para todos desde o Go 1.25, roda o teste dentro de uma "bolha" cujo
relógio falso só anda quando toda goroutine da bolha está bloqueada de forma durável, então esperar
não custa tempo de parede e a ordem dos eventos é determinística.

Esta lição testa um retry, um deadline e o faxineiro de um cache que somam 23 minutos falsos e mede
o tempo de parede, mostra o que o `synctest.Wait` garante (inclusive ao race detector), mede o flake
que o `synctest.Sleep` (Go 1.27) corrige, roda HTTP numa bolha com `httptest.NewTestServer` (Go
1.27) e quebra cada regra para registrar o erro real. Medido com `go1.27.0 darwin/arm64` num Apple
M4 Max (14 núcleos, macOS); o número de execuções aparece ao lado de cada número.

## Use Cases

- Testar backoff exponencial, deadlines e períodos de espera sem sleeps reais.
- Garantir que uma entrada de cache existe aos 9 minutos e some aos 10, de forma determinística.
- Testar timeouts de cliente HTTP contra handlers lentos, sem portas e sem flakes.
- Trocar polls do tipo "dorme 10 ms e torce" e pegar goroutines que o teste esqueceu de parar.

## Deep Dive

### A bolha e o relógio falso

O sistema testado usa `time` e `context` puros, sem interface de relógio:

```go
func Retry(ctx context.Context, attempts int, base time.Duration, op func() error) error {
	var err error
	for i := range attempts {
		if err = op(); err == nil {
			return nil
		}
		if i == attempts-1 {
			break
		}
		t := time.NewTimer(base << i) // base, 2*base, 4*base...
		select {
		case <-t.C:
		case <-ctx.Done():
			t.Stop()
			return context.Cause(ctx)
		}
	}
	return err
}

func TestRetryBackoff(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		start, calls := time.Now(), 0
		err := Retry(t.Context(), 10, time.Second, func() error {
			if calls++; calls < 8 {
				return errors.New("unavailable")
			}
			return nil
		})
		t.Logf("start=%s calls=%d err=%v fake elapsed=%v",
			start.Format(time.RFC3339), calls, err, time.Since(start))
	})
}
```

Um segundo teste embrulha o `t.Context()` em `context.WithTimeout(..., 5*time.Minute)` e repete
uma operação que sempre falha, com base de 1 minuto:

```text
    sut_test.go:20: start=2000-01-01T00:00:00Z calls=8 err=<nil> fake elapsed=2m7s
--- PASS: TestRetryBackoff (0.00s)
    sut_test.go:31: err=context deadline exceeded fake elapsed=5m0s
--- PASS: TestRetryDeadline (0.00s)
```

Toda bolha começa à meia-noite UTC de 2000-01-01. Sete esperas de 1, 2, 4 ... 64 s somam
exatamente 127 s, o deadline dispara em exatamente 5m0s, e timers, `time.After` e `t.Context()`
seguem o relógio da bolha.

Para o tempo de parede, um teste roda um retry de 10 tentativas (511 s de backoff), o deadline de 5
minutos e 10 minutos de expiração de cache numa bolha, lendo `time.Now()` fora dela (relógio real).
Ele registrou `fake=23m31s wall=140.875µs`; em 10 execuções o tempo de parede ficou entre 97 e 152 µs.

### O que significa "durably blocked"

O tempo só avança quando toda goroutine da bolha está bloqueada de um jeito que só outra goroutine
da mesma bolha pode encerrar. A documentação lista as operações duráveis: envio ou recebimento num
channel da bolha, um `select` só com channels da bolha, `sync.Cond.Wait`, `sync.WaitGroup.Wait`
(quando o `Add` rodou na bolha) e `time.Sleep`. Travar um `sync.Mutex` ou `RWMutex`, I/O e syscalls
não são duráveis, porque algo de fora poderia encerrá-los. Por isso uma espera de mutex congela o
relógio:

```go
synctest.Test(t, func(t *testing.T) {
	var mu sync.Mutex
	mu.Lock()
	go func() { time.Sleep(time.Second); mu.Unlock() }() // quem dorme está bloqueado de forma durável
	mu.Lock()                                            // bloqueado, mas não de forma durável
})
```

```text
panic: test timed out after 3s
goroutine 7 [sync.Mutex.Lock, synctest bubble 1]:
goroutine 8 [sleep (durable), synctest bubble 1]:
```

O trace (filtrado para essas duas goroutines) marca as esperas duráveis. Quem dorme acordaria em 1s
falso, mas o relógio espera a goroutine do mutex, que espera quem dorme, até estourar o timeout.

### synctest.Wait: deixar tudo assentar

O `synctest.Wait()` retorna quando toda outra goroutine da bolha está bloqueada de forma durável ou
terminou. Ele também é um ponto de sincronização para o race detector, coisa que `time.Sleep` não é:

```go
func TestFlagWithWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		done := false
		go func() { done = true }()
		synctest.Wait()
		t.Log("done =", done)
	})
}
// TestFlagWithoutWait: igual, com time.Sleep(time.Nanosecond) no lugar de synctest.Wait()
```

```text
$ go test -race -run 'TestFlagWith' -v .
    wait_test.go:14: done = true
--- PASS: TestFlagWithWait (0.00s)
WARNING: DATA RACE
    wait_test.go:23: done = true
    testing.go:1865: race detected during execution of test
--- FAIL: TestFlagWithoutWait (0.00s)
```

Os dois imprimem `true` (o sleep de 1 ns não termina antes de a outra goroutine acabar) e, sem
`-race`, os dois passam em 3 de 3 execuções. Só o `Wait` cria uma aresta happens-before, então só
essa versão está livre de race.

### Despertares no mesmo instante e synctest.Sleep (Go 1.27)

O cache testado remove chaves expiradas a partir de uma goroutine faxineira com `time.Ticker`:

```go
func TestCacheExpiryPlainSleep(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := NewCache(10*time.Minute, time.Minute) // ttl, intervalo da varredura
		defer c.Close()
		c.Put("k")
		time.Sleep(10 * time.Minute) // o 10º tick do faxineiro dispara no mesmo instante
		if c.Len() != 0 {
			t.Fatalf("after 10m: Len=%d, want 0", c.Len())
		}
	})
}
```

```text
$ go test -count=1000 -run 'TestCacheExpiryPlainSleep$' . | grep -c -- '--- FAIL'
515
$ go test -count=1000 -run 'TestCacheExpiryPlainSleep$' . | grep -m1 -A1 -- '--- FAIL'
--- FAIL: TestCacheExpiryPlainSleep (0.00s)
    sut_test.go:60: after 10m: Len=1, want 0
```

Em 6 execuções de 1000 iterações, de 493 a 515 falharam. Teste e faxineiro acordam no mesmo
instante falso e qualquer um pode rodar primeiro (o post "testing time" diz que o Go 1.25
embaralhou timers do mesmo instante), então uma suposição escondida de ordem vira cara ou coroa.
O Go 1.27 adiciona `func Sleep(d time.Duration)`, "exactly equivalent to" `time.Sleep(d)` seguido
de `synctest.Wait()`. O teste corrigido faz `synctest.Sleep(9 * time.Minute)`, confere
`Len() == 1`, `synctest.Sleep(time.Minute)`, confere `Len() == 0`; ele e o par escrito por extenso
passaram em 1000 de 1000 iterações, 3 execuções cada.

### HTTP numa bolha: httptest.NewTestServer (Go 1.27)

Um servidor em loopback deixa goroutines paradas em I/O de rede, que não é durável. O Go 1.27
adiciona `func NewTestServer(t testing.TB, handler http.Handler) *Server`: rede em memória,
cleanup próprio e falha do teste se o handler entrar em panic.

```go
var slow = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	select {
	case <-time.After(10 * time.Second):
		io.WriteString(w, "late")
	case <-r.Context().Done():
	}
})

synctest.Test(t, func(t *testing.T) { // tempo de parede medido fora, como antes
	srv := httptest.NewTestServer(t, slow)
	c := srv.Client()
	c.Timeout = 5 * time.Second
	start := time.Now()
	_, err := c.Get("http://api.internal/orders")
	t.Logf("URL=%s err=%v fake elapsed=%v", srv.URL, err, time.Since(start))
})
```

```text
    http_test.go:28: URL=http://example.com err=Get "http://api.internal/orders": context deadline exceeded fake elapsed=5s
    http_test.go:30: wall=1.888709ms
```

O cliente chega ao servidor qualquer que seja o host da URL (`srv.URL` é `http://example.com`), o
timeout dispara em exatamente 5 s falsos e o tempo de parede foi de 1,2 a 2,1 ms em 5 execuções. O
mesmo teste com `httptest.NewServer(slow)` nunca terminou: o trace mostrou goroutines em `[IO wait,
synctest bubble 1]` sem `(durable)`, o relógio nunca chegou a 5 s e o `-timeout 5s` deu panic.

### Quebrando as regras: o que você recebe de fato

Cada linha vem de um teste de propósito único rodado com go1.27.0:

```text
receive on a bubble channel nobody sends to   panic: deadlock: all goroutines in bubble are blocked
root returns, a goroutine still blocked        panic: deadlock: main bubble goroutine has exited but blocked goroutines remain
(same message for a goroutine left in a time.Tick loop)
send on a bubble channel from outside          fatal error: send on synctest channel from outside bubble
synctest.Wait outside any bubble               panic: goroutine is not in a bubble
t.Run inside the bubble                        panic: testing: t.Run called inside synctest bubble
synctest.Test inside a bubble                  panic: synctest.Run called from within a synctest bubble
```

Duas descobertas. Os panics de goroutine esquecida transformam vazamento de goroutine em falha de
teste, a mesma classe de bug que o `goleak` caça. E usar um channel da bolha de fora é um `fatal
error`, não o panic recuperável que a documentação do pacote descreve: um `recover()` em defer
nunca rodou e o binário de teste inteiro morreu, levando junto todos os outros testes do pacote.

## Trade-offs

- **Sem injeção de relógio, mas só dentro da bolha**: `time.Now`, timers e deadlines de `context`
  puros são falsificados, o que é melhor que passar uma interface de relógio por todo construtor.
  O que foi iniciado fora da bolha (um cliente compartilhado, um worker global) roda no tempo real.
- **Mutex e I/O travam o relógio**: um `sync.Mutex` segurado durante um sleep, sockets reais,
  arquivos ou subprocessos nunca deixam o tempo andar. Use `net.Pipe`, um fake em memória ou o
  `NewTestServer`. Segundo a documentação (não medido), um `var wg sync.WaitGroup` no nível do
  pacote também não entra na bolha.
- **Tudo precisa terminar**: a bolha dá panic se goroutines sobrevivem à função de teste, então
  loops de background precisam de um caminho de parada (`Close`, um `t.Context()` cancelado),
  quase sempre uma correção de design de que o serviço já precisava.
- **Antes versus hoje**: o Go 1.24 trazia o pacote atrás de `GOEXPERIMENT=synctest` como
  `synctest.Run(func())`; o Go 1.25 trocou por `synctest.Test(t, f)`, parou o tempo quando a
  goroutine raiz retorna e embaralhou timers do mesmo instante; o Go 1.27 adicionou
  `synctest.Sleep` e `httptest.NewTestServer`.

## Documentation Links

- [testing/synctest package documentation](https://pkg.go.dev/testing/synctest): doc
- [Testing concurrent code with testing/synctest, The Go Blog](https://go.dev/blog/synctest): doc
- [Testing Time (and other asynchronicities), The Go Blog](https://go.dev/blog/testing-time): doc
- [Go 1.27 Release Notes: synctest.Sleep and httptest.NewTestServer](https://go.dev/doc/go1.27): doc
- [net/http/httptest package documentation](https://pkg.go.dev/net/http/httptest): doc
- [Data Race Detector, Go documentation](https://go.dev/doc/articles/race_detector): doc
