---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A `context.Context` is a node in a tree: a child registers with its nearest cancelable ancestor,
a cancel closes `Done` on every descendant, and nothing flows back up. This lesson measures that
tree: cancel fan-out, what an uncalled `cancel` keeps alive, `Err` versus `Cause`, `AfterFunc`
and `WithoutCancel` (Go 1.21), and what the server sees when a client gives up.

All output comes from Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, module line `go 1.27`), standard
library only, on an Apple M4 Max with macOS (darwin/arm64). Run counts are given per result.

## Use Cases

- A request handler that must stop database calls and RPCs the moment the client disconnects.
- A per-call budget (`WithTimeout`) under a per-request budget, where the shorter one wins.
- Telling "the deadline passed" apart from "something upstream failed" in logs, via `Cause`.
- Unblocking an API that ignores contexts (a `net.Conn`, a `sync.Cond`) with `AfterFunc`.
- Audit writes or cache fills that must finish after the response is sent (`WithoutCancel`).

## Deep Dive

### The tree: cancel flows down, never up

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

`WithValue` cannot be canceled, so `c` joins `root`'s children set. In the 1.27 source,
`cancelCtx.cancel` closes its channel, then cancels each child under its lock: the fan-out is
synchronous. A parent with N direct children, `cancel()` timed, children checked (5 runs):

| children | `cancel()` took | closed when `cancel` returned |
|---|---|---|
| 1,000 | 30 to 40 µs | 1,000 |
| 10,000 | 0.26 to 0.38 ms | 10,000 |
| 100,000 | 3.4 to 4.8 ms | 100,000 |

Linear, 30 to 50 ns per child, but only with standard library parents. Under a hand-rolled
`Context` with its own `Done` channel and no `AfterFunc` method, `propagateCancel` starts a
watcher goroutine per child: 1,000 children added 1,000 goroutines (0 under `WithCancel`).

### Deadline versus cancel, and naming the reason

```go
// cancel funcs are deferred in the real program; discarded here to save lines
d, _ := context.WithTimeout(bg, 10*time.Millisecond) // <-d.Done(), then print d.Err()
parent, cancelP := context.WithCancelCause(bg)
child, _ := context.WithTimeout(parent, time.Hour)
cancelP(errUpstream) // print child.Err() and context.Cause(child)
p2, cancelP2 := context.WithCancelCause(bg)
k2, cancelK2 := context.WithCancelCause(p2)
cancelK2(errors.New("child gave up first"))
cancelP2(errUpstream) // print both causes
t, _ := context.WithTimeoutCause(bg, 5*time.Millisecond, errSLO) // <-t.Done()
```

```text
timeout: context deadline exceeded true true
child Err:   context canceled
child Cause: upstream closed the stream
parent cause: upstream closed the stream | child cause: child gave up first
timeout cause: context deadline exceeded | checkout SLO budget (50ms) spent
```

Line 1 is `Err()`, `errors.Is(err, context.DeadlineExceeded)` and its `Timeout()` method. `Err`
only returns one of the two sentinels, so existing checks keep working; `Cause` carries the real
reason to every descendant. The first cancellation wins: a child canceled before its parent
keeps its own cause. `Cause` is `nil` before cancellation and `cancel(nil)` makes it
`context canceled`. `WithCancelCause` arrived in Go 1.20, the deadline variants in 1.21.

### AfterFunc and its stop function

```go
func readCtx(ctx context.Context, conn net.Conn, buf []byte) (int, error) {
	stop := context.AfterFunc(ctx, func() { conn.SetReadDeadline(time.Now()) })
	n, err := conn.Read(buf)
	if !stop() && ctx.Err() != nil { // f already started: report the context error
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

`AfterFunc` runs `f` in its own goroutine once `ctx` is done. `stop()` before the cancel returned
`true` and `f` never ran; after it, `false`. Per the docs, `stop` does not wait for `f` to finish.
`Read` itself failed with `read pipe: i/o timeout`, mapped to the context error, at 30 ms (4 of 4
runs). 1,000 `AfterFunc` registrations on a standard context added 0 goroutines; 1,000
`go func(){ <-ctx.Done() }()` watchers added 1,000.

### WithoutCancel: work that outlives the request

`net/http` cancels `r.Context()` when `ServeHTTP` returns, so an audit goroutine dies with it:

```go
ctx := context.WithValue(r.Context(), userKey{}, "ana")
go audit(ctx, "request ctx  ", done)
bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
go func() { defer cancel(); audit(bg, "WithoutCancel", done) }()
w.WriteHeader(http.StatusAccepted) // handler returns
```

```text
WithoutCancel: Done==nil: true deadline: false
request ctx  : aborted, context canceled
WithoutCancel: written for ana
```

The detached context keeps the values (the user, a trace ID) but has no deadline, no `Err` and
a nil `Done` (2 of 2 runs), so always put a fresh `WithTimeout` on top of it.

### WithValue: key hygiene and lookup cost

Two packages that both use the string `"user"` as a key silently overwrite each other:

```go
ctx := auth.WithUser(context.Background(), "u-1001") // WithValue(ctx, "user", id)
ctx = tenant.WithTenant(ctx, "acme")                 // WithValue(ctx, "user", name)
fmt.Println("auth.User sees:", auth.User(ctx))
// fix inside package tenant: type key struct{}; WithValue(ctx, key{}, name)
```

```text
auth.User sees: acme
auth.User sees: u-1001 | tenant: acme
```

`go vet` printed nothing for the string key. The `WithValue` docs ask for an unexported key
type, ideally `struct{}` so storing it in an `interface{}` does not allocate, plus typed
accessors. Lookup walks the chain node by node (`b.Loop` benchmark, key at the root, 3 runs):

| chain depth | 1 | 10 | 100 |
|---|---|---|---|
| ns/op | 2.54 to 2.58 | 19.6 to 19.9 | 183 to 186 |

### Forgetting cancel: what vet says and what it costs

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

The cost shows under a long-lived parent: 100,000 calls of `WithTimeout(appCtx, time.Hour)`:

```text
cancel called=false: +29.5 MB live heap
after the parent is canceled: +6.1 MB live heap
cancel called=true: +0.0 MB live heap
```

Live heap after two GCs: about 300 bytes per forgotten child, held by the parent's children set
until the parent is canceled (29.5 MB in 2 of 2 runs, residue 1.8 and 6.1 MB after it). `go test`
passed on the vet demo package: `lostcancel` is not in the vet subset `go test` runs.

### Passing ctx to an HTTP call and to a select

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/slow", nil)
_, err := http.DefaultClient.Do(req)
select { // in the server handler
case <-time.After(2 * time.Second): // slow dependency
case <-r.Context().Done(): // record r.Context().Err()
}
```

```text
client after 100ms: Get "http://127.0.0.1:55541/slow": context deadline exceeded
Is DeadlineExceeded: true
server: context canceled after 100ms
```

Same result in 3 of 3 runs. The deadline does not cross the wire: the server only sees the
connection close, so its context reports `Canceled`, not `DeadlineExceeded`. Any blocking
`select` in the handler needs a `ctx.Done()` case, or the work keeps running for nobody.

### Why a context does not belong in a struct

```go
type Client struct{ ctx context.Context }   // built during request 1, then cached
func (c *Client) Fetch(id int) error { /* checks c.ctx.Err() */ }
func FetchCtx(ctx context.Context, id int) error { /* checks ctx.Err() */ }
```

```text
request 1: <nil>
request 2: fetch 2: context canceled | request 2 own ctx: <nil>
request 2 with FetchCtx: <nil>
```

Request 2 inherited request 1's dead context. The package docs say to pass `ctx` as the first
parameter; the blog post "Contexts and structs" adds that a stored context hides its lifetime
and mixes scopes. Its one exception, backward compatibility, is why `http.Request` has one.

## Trade-offs

- **Synchronous fan-out**: cancel is linear in descendants, under the parent's lock (4.8 ms for
  100,000). Prefer a tree that mirrors the call graph over one huge flat parent.
- **Cause versus Err**: `Err` stays one of two sentinels for compatibility. Log `context.Cause`,
  branch on `errors.Is(err, context.DeadlineExceeded)`.
- **Values are not parameters**: lookups are linear (183 ns at depth 100) and untyped. Use them
  for request-scoped data that crosses APIs (trace IDs, auth), never for optional arguments.
- **WithoutCancel needs a new bound**: it drops the deadline as well as the cancel. Without a
  fresh `WithTimeout` the detached work can run forever.
- **Server sees Canceled**: a client deadline arrives as a closed connection. Send the remaining
  budget explicitly (a request header, for example) if the server must know it was a timeout.

## Documentation Links

- [Package context](https://pkg.go.dev/context): doc
- [Go Concurrency Patterns: Context, The Go Blog](https://go.dev/blog/context): doc
- [Contexts and structs, The Go Blog](https://go.dev/blog/context-and-structs): doc
- [Go 1.21 Release Notes: AfterFunc, WithoutCancel, WithDeadlineCause](https://go.dev/doc/go1.21): doc
- [Go 1.20 Release Notes: WithCancelCause and Cause](https://go.dev/doc/go1.20): doc
- [lostcancel analyzer, golang.org/x/tools](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/lostcancel): doc
- [net/http: Request.Context](https://pkg.go.dev/net/http#Request.Context): doc
- [100 Go Mistakes and How to Avoid Them, Teiva Harsanyi (Manning)](https://www.manning.com/books/100-go-mistakes-and-how-to-avoid-them): book
