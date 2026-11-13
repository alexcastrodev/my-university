---
version: 1.0
updatedAt: 2026-11-12
title: "Context: Árvores de Cancelamento, Deadlines e Causas"
summary: A árvore de contexts e o cancelamento síncrono medido até 100.000 filhos, a goroutine por filho sob um Context próprio, DeadlineExceeded versus Canceled, WithCancelCause, WithTimeoutCause e context.Cause, AfterFunc e sua função stop destravando a leitura de um net.Conn, WithoutCancel para trabalho depois da resposta, colisão de chaves em WithValue e o custo linear da busca, as mensagens do lostcancel do go vet e o heap que um cancel esquecido segura, o que o servidor vê quando o deadline do cliente HTTP estoura e por que um context não deve ficar dentro de uma struct.
---
## Objective

Um `context.Context` é um nó numa árvore: o filho se registra no ancestral cancelável mais próximo,
um cancel fecha o `Done` de todos os descendentes e nada sobe de volta. Esta lição mede essa árvore:
a propagação do cancel, o que um `cancel` nunca chamado mantém vivo, `Err` versus `Cause`, `AfterFunc`
e `WithoutCancel` (Go 1.21) e o que o servidor vê quando o cliente desiste.

Toda saída vem do Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, linha de módulo `go 1.27`), só biblioteca
padrão, num Apple M4 Max com macOS (darwin/arm64). O número de execuções aparece em cada resultado.

## Use Cases

- Um handler que precisa parar chamadas ao banco e RPCs no instante em que o cliente desconecta.
- Um orçamento por chamada (`WithTimeout`) sob um orçamento por requisição, em que o menor vence.
- Separar "o deadline passou" de "algo falhou mais acima" nos logs, com `Cause`.
- Destravar uma API que ignora contexts (um `net.Conn`, um `sync.Cond`) com `AfterFunc`.
- Gravações de auditoria ou cache que precisam terminar depois da resposta (`WithoutCancel`).

## Deep Dive

### A árvore: o cancel desce, nunca sobe

```go
root, cancelRoot := context.WithCancel(context.Background())
a, cancelA := context.WithTimeout(root, time.Hour)
b := context.WithValue(root, reqIDKey{}, "r-42")
c, cancelC := context.WithCancel(b)
defer cancelC()
fmt.Println(c)
cancelA()
fmt.Printf("after cancelA: root=%v a=%v c=%v\n", root.Err(), a.Err(), c.Err())
cancelRoot()
fmt.Printf("after cancelRoot: root=%v c=%v\n", root.Err(), c.Err())
```

```text
context.Background.WithCancel.WithValue(main.reqIDKey, r-42).WithCancel
after cancelA: root=<nil> a=context canceled c=<nil>
after cancelRoot: root=context canceled c=context canceled
```

`WithValue` não pode ser cancelado, então `c` entra no conjunto de filhos de `root`. No código da 1.27,
`cancelCtx.cancel` fecha o próprio canal e cancela cada filho segurando o lock: a propagação é
síncrona. Um pai com N filhos diretos, `cancel()` cronometrado, filhos verificados (5 execuções):

| filhos | `cancel()` levou | fechados quando `cancel` retornou |
|---|---|---|
| 1.000 | 30 a 40 µs | 1.000 |
| 10.000 | 0,26 a 0,38 ms | 10.000 |
| 100.000 | 3,4 a 4,8 ms | 100.000 |

Linear, de 30 a 50 ns por filho, mas só com pais da biblioteca padrão. Sob um `Context` feito à mão,
com canal `Done` próprio e sem método `AfterFunc`, `propagateCancel` cria uma goroutine vigia por
filho: 1.000 filhos somaram 1.000 goroutines (0 sob `WithCancel`).

### Deadline versus cancel, e o nome do motivo

```go
// no programa real os cancels ficam em defer; aqui foram descartados para poupar linhas
d, _ := context.WithTimeout(bg, 10*time.Millisecond) // <-d.Done(), depois imprime d.Err()
parent, cancelP := context.WithCancelCause(bg)
child, _ := context.WithTimeout(parent, time.Hour)
cancelP(errUpstream) // imprime child.Err() e context.Cause(child)
p2, cancelP2 := context.WithCancelCause(bg)
k2, cancelK2 := context.WithCancelCause(p2)
cancelK2(errors.New("child gave up first"))
cancelP2(errUpstream) // imprime as duas causas
t, _ := context.WithTimeoutCause(bg, 5*time.Millisecond, errSLO) // <-t.Done()
```

```text
timeout: context deadline exceeded true true
child Err:   context canceled
child Cause: upstream closed the stream
parent cause: upstream closed the stream | child cause: child gave up first
timeout cause: context deadline exceeded | checkout SLO budget (50ms) spent
```

A linha 1 mostra `Err()`, `errors.Is(err, context.DeadlineExceeded)` e o método `Timeout()`. `Err`
só devolve um dos dois sentinelas, então as verificações existentes continuam valendo; `Cause` leva o
motivo real a todos os descendentes. O primeiro cancelamento vence: um filho cancelado antes do pai
fica com a própria causa. `Cause` é `nil` antes do cancelamento e `cancel(nil)` a torna
`context canceled`. `WithCancelCause` chegou no Go 1.20, as variantes com deadline na 1.21.

### AfterFunc e sua função stop

```go
func readCtx(ctx context.Context, conn net.Conn, buf []byte) (int, error) {
	stop := context.AfterFunc(ctx, func() { conn.SetReadDeadline(time.Now()) })
	n, err := conn.Read(buf)
	if !stop() && ctx.Err() != nil { // f já começou: devolve o erro do context
		return n, ctx.Err()
	}
	return n, err
}
```

```text
stop before cancel: true
stop after cancel:  false
read returned after 30ms: context deadline exceeded
```

`AfterFunc` roda `f` numa goroutine própria quando `ctx` termina. `stop()` antes do cancel devolveu
`true` e `f` nunca rodou; depois dele, `false`. Pela documentação, `stop` não espera `f` terminar.
O `Read` falhou com `read pipe: i/o timeout`, convertido no erro do context, em 30 ms (4 de 4
execuções). 1.000 registros de `AfterFunc` num context padrão somaram 0 goroutines; 1.000 vigias
`go func(){ <-ctx.Done() }()` somaram 1.000.

### WithoutCancel: trabalho que sobrevive à requisição

`net/http` cancela `r.Context()` quando `ServeHTTP` retorna, então uma goroutine de auditoria morre junto:

```go
ctx := context.WithValue(r.Context(), userKey{}, "ana")
go audit(ctx, "request ctx  ", done)
bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
go func() { defer cancel(); audit(bg, "WithoutCancel", done) }()
w.WriteHeader(http.StatusAccepted) // o handler retorna
```

```text
WithoutCancel: Done==nil: true deadline: false
request ctx  : aborted, context canceled
WithoutCancel: written for ana
```

O context desacoplado mantém os valores (o usuário, um trace ID), mas não tem deadline, nem `Err`, e
o `Done` é nil (2 de 2 execuções); por isso coloque sempre um `WithTimeout` novo por cima.

### WithValue: higiene de chaves e custo da busca

Dois pacotes que usam a string `"user"` como chave se sobrescrevem em silêncio:

```go
ctx := auth.WithUser(context.Background(), "u-1001") // WithValue(ctx, "user", id)
ctx = tenant.WithTenant(ctx, "acme")                 // WithValue(ctx, "user", name)
fmt.Println("auth.User sees:", auth.User(ctx))
// correção no pacote tenant: type key struct{}; WithValue(ctx, key{}, name)
```

```text
auth.User sees: acme
auth.User sees: u-1001 | tenant: acme
```

O `go vet` não imprimiu nada para a chave string. A documentação de `WithValue` pede um tipo de
chave não exportado, de preferência `struct{}` para que guardá-lo numa `interface{}` não aloque, e
acessores tipados. A busca percorre a cadeia nó a nó (benchmark com `b.Loop`, chave na raiz, 3 execuções):

| profundidade | 1 | 10 | 100 |
|---|---|---|---|
| ns/op | 2,54 a 2,58 | 19,6 a 19,9 | 183 a 186 |

### Esquecer o cancel: o que o vet diz e quanto custa

```go
func Discarded(parent context.Context) context.Context {
	ctx, _ := context.WithTimeout(parent, time.Second)
	return ctx
}
func OnePath(parent context.Context, fast bool) error {
	ctx, cancel := context.WithCancel(parent)
	if fast {
		return nil
	}
	defer cancel()
	<-ctx.Done()
	return ctx.Err()
}
```

```text
vetdemo/vetdemo.go:9:7: the cancel function returned by context.WithTimeout should be called, not discarded, to avoid a context leak
vetdemo/vetdemo.go:14:2: the cancel function is not used on all paths (possible context leak)
vetdemo/vetdemo.go:16:3: this return statement may be reached without using the cancel var defined on line 14
```

O custo aparece sob um pai de vida longa: 100.000 chamadas de `WithTimeout(appCtx, time.Hour)`:

```text
cancel called=false: +29.5 MB live heap
after the parent is canceled: +6.1 MB live heap
cancel called=true: +0.0 MB live heap
```

Heap vivo depois de dois GCs: uns 300 bytes por filho esquecido, presos no conjunto de filhos do pai
até o pai ser cancelado (29,5 MB em 2 de 2 execuções, resíduo de 1,8 e 6,1 MB depois disso). O `go test`
passou no pacote de demonstração: o `lostcancel` não está no subconjunto do vet que o `go test` roda.

### Passando ctx para uma chamada HTTP e para um select

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/slow", nil)
_, err := http.DefaultClient.Do(req)
select { // no handler do servidor
case <-time.After(2 * time.Second): // dependência lenta
case <-r.Context().Done(): // registra r.Context().Err()
}
```

```text
client after 100ms: Get "http://127.0.0.1:55541/slow": context deadline exceeded
Is DeadlineExceeded: true
server: context canceled after 100ms
```

Mesmo resultado em 3 de 3 execuções. O deadline não atravessa a rede: o servidor só vê a conexão
fechar, então o context dele reporta `Canceled`, não `DeadlineExceeded`. Todo `select` bloqueante no
handler precisa de um caso `ctx.Done()`, senão o trabalho continua rodando para ninguém.

### Por que um context não deve ficar numa struct

```go
type Client struct{ ctx context.Context }   // criado na requisição 1 e guardado em cache
func (c *Client) Fetch(id int) error { /* verifica c.ctx.Err() */ }
func FetchCtx(ctx context.Context, id int) error { /* verifica ctx.Err() */ }
```

```text
request 1: <nil>
request 2: fetch 2: context canceled | request 2 own ctx: <nil>
request 2 with FetchCtx: <nil>
```

A requisição 2 herdou o context morto da requisição 1. A documentação do pacote manda passar `ctx`
como primeiro parâmetro; o post "Contexts and structs" acrescenta que um context guardado esconde
o tempo de vida e mistura escopos. A única exceção, compatibilidade retroativa, explica o de `http.Request`.

## Trade-offs

- **Propagação síncrona**: o cancel é linear nos descendentes, sob o lock do pai (4,8 ms para
  100.000). Prefira uma árvore que espelhe o grafo de chamadas a um pai gigante e plano.
- **Cause versus Err**: `Err` continua sendo um de dois sentinelas, por compatibilidade. Registre
  `context.Cause` no log e decida com `errors.Is(err, context.DeadlineExceeded)`.
- **Valores não são parâmetros**: a busca é linear (183 ns na profundidade 100) e sem tipo. Use para
  dados da requisição que atravessam APIs (trace IDs, autenticação), nunca para argumentos opcionais.
- **WithoutCancel pede um novo limite**: ele descarta o deadline junto com o cancel. Sem um
  `WithTimeout` novo, o trabalho desacoplado pode rodar para sempre.
- **O servidor vê Canceled**: o deadline do cliente chega como conexão fechada. Envie o orçamento
  restante de forma explícita (um header, por exemplo) se o servidor precisa saber que foi timeout.

## Documentation Links

- [Package context](https://pkg.go.dev/context): doc
- [Go Concurrency Patterns: Context, The Go Blog](https://go.dev/blog/context): doc
- [Contexts and structs, The Go Blog](https://go.dev/blog/context-and-structs): doc
- [Go 1.21 Release Notes: AfterFunc, WithoutCancel, WithDeadlineCause](https://go.dev/doc/go1.21): doc
- [Go 1.20 Release Notes: WithCancelCause and Cause](https://go.dev/doc/go1.20): doc
- [lostcancel analyzer, golang.org/x/tools](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/lostcancel): doc
- [net/http: Request.Context](https://pkg.go.dev/net/http#Request.Context): doc
- [100 Go Mistakes and How to Avoid Them, Teiva Harsanyi (Manning)](https://www.manning.com/books/100-go-mistakes-and-how-to-avoid-them): book
