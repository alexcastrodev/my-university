---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

Code that waits (retries with backoff, timeouts, TTL caches, tickers) is the code teams test
least: a real test either sleeps for minutes or polls with a short timeout and turns flaky.
`testing/synctest`, generally available since Go 1.25, runs a test inside a "bubble" whose fake
clock only moves when every goroutine in the bubble is durably blocked, so waiting costs no wall
time and the order of events is deterministic.

This lesson tests a retry, a deadline and a cache janitor worth 23 fake minutes and measures the
wall time, shows what `synctest.Wait` guarantees (also to the race detector), measures the flake
that `synctest.Sleep` (Go 1.27) fixes, runs HTTP in a bubble with `httptest.NewTestServer` (Go
1.27), and breaks each rule to record the real error. Measured with `go1.27.0 darwin/arm64` on an
Apple M4 Max (14 cores, macOS); run counts sit next to each number.

## Use Cases

- Testing exponential backoff, deadlines and cool-down periods without real sleeps.
- Asserting that a cache entry is present at 9 minutes and gone at 10, deterministically.
- Testing HTTP client timeouts against slow handlers, with no ports and no flakes.
- Replacing "sleep 10 ms and hope" polls, and catching goroutines a test forgot to stop.

## Deep Dive

### A bubble and its fake clock

The system under test uses plain `time` and `context`, no clock interface:

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

A second test wraps `t.Context()` in `context.WithTimeout(..., 5*time.Minute)` and retries an
operation that always fails, with a 1-minute base:

```text
    sut_test.go:20: start=2000-01-01T00:00:00Z calls=8 err=<nil> fake elapsed=2m7s
--- PASS: TestRetryBackoff (0.00s)
    sut_test.go:31: err=context deadline exceeded fake elapsed=5m0s
--- PASS: TestRetryDeadline (0.00s)
```

Every bubble starts at midnight UTC on 2000-01-01. Seven sleeps of 1, 2, 4 ... 64 s add up to
exactly 127 s, the deadline fires at exactly 5m0s, and timers, `time.After` and `t.Context()` all
follow the bubble's clock.

For wall time, one test runs a 10-attempt retry (511 s of backoff), the 5-minute deadline and 10
minutes of cache expiry in one bubble, reading `time.Now()` outside it (the real clock). It logged
`fake=23m31s wall=140.875µs`; across 10 runs the wall time stayed between 97 and 152 µs.

### What "durably blocked" means

Time advances only when every bubble goroutine is blocked so that only another goroutine of the
same bubble can end it. The docs list the durable operations: send or receive on a bubble channel,
a `select` over bubble channels only, `sync.Cond.Wait`, `sync.WaitGroup.Wait` (when `Add` ran in
the bubble) and `time.Sleep`. Locking a `sync.Mutex` or `RWMutex`, I/O and syscalls are not
durable, since something outside could end them. So a mutex wait can freeze the clock:

```go
synctest.Test(t, func(t *testing.T) {
	var mu sync.Mutex
	mu.Lock()
	go func() { time.Sleep(time.Second); mu.Unlock() }() // the sleeper is durably blocked
	mu.Lock()                                            // blocked, but not durably
})
```

```text
panic: test timed out after 3s
goroutine 7 [sync.Mutex.Lock, synctest bubble 1]:
goroutine 8 [sleep (durable), synctest bubble 1]:
```

The trace (filtered to these two goroutines) tags durable waits. The sleeper would wake at fake
1s, but the clock waits for the mutex waiter, which waits for the sleeper, until the timeout.

### synctest.Wait: let everything settle

`synctest.Wait()` returns once every other goroutine in the bubble is durably blocked or gone. It
is also a synchronization point for the race detector, which `time.Sleep` is not:

```go
func TestFlagWithWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		done := false
		go func() { done = true }()
		synctest.Wait()
		t.Log("done =", done)
	})
}
// TestFlagWithoutWait: identical, with time.Sleep(time.Nanosecond) instead of synctest.Wait()
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

Both print `true` (the 1 ns sleep cannot end before the other goroutine finishes), and without
`-race` both pass in 3 of 3 runs. Only `Wait` creates a happens-before edge, so only that version
is race-free.

### Same-instant wakeups and synctest.Sleep (Go 1.27)

The cache under test sweeps expired keys from a janitor goroutine on a `time.Ticker`:

```go
func TestCacheExpiryPlainSleep(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := NewCache(10*time.Minute, time.Minute) // ttl, sweep interval
		defer c.Close()
		c.Put("k")
		time.Sleep(10 * time.Minute) // the janitor's 10th tick fires at the same instant
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

Over 6 runs of 1000 iterations, 493 to 515 failed. Test and janitor wake at the same fake instant
and either may run first (the "testing time" post says Go 1.25 randomized same-instant timers), so
a hidden ordering assumption becomes a coin flip. Go 1.27 adds `func Sleep(d time.Duration)`,
"exactly equivalent to" `time.Sleep(d)` then `synctest.Wait()`. The fixed test does
`synctest.Sleep(9 * time.Minute)`, asserts `Len() == 1`, `synctest.Sleep(time.Minute)`, asserts
`Len() == 0`; it and the spelled-out pair passed 1000 of 1000 iterations in 3 runs each.

### HTTP in a bubble: httptest.NewTestServer (Go 1.27)

A loopback server parks goroutines in network I/O, which is not durable. Go 1.27 adds
`func NewTestServer(t testing.TB, handler http.Handler) *Server`: an in-memory network, its own
cleanup, and a test failure if the handler panics.

```go
var slow = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	select {
	case <-time.After(10 * time.Second):
		io.WriteString(w, "late")
	case <-r.Context().Done():
	}
})

synctest.Test(t, func(t *testing.T) { // wall time measured outside, as before
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

The client reaches the server whatever host the URL names (`srv.URL` is `http://example.com`), the
timeout fires at exactly 5 s of fake time, and wall time was 1.2 to 2.1 ms over 5 runs. The same
test with `httptest.NewServer(slow)` never finished: the trace showed `[IO wait, synctest bubble
1]` goroutines without `(durable)`, the clock never reached 5 s, and `-timeout 5s` panicked.

### Breaking the rules: what you actually get

Each line comes from a one-purpose test run with go1.27.0:

```text
receive on a bubble channel nobody sends to   panic: deadlock: all goroutines in bubble are blocked
root returns, a goroutine still blocked        panic: deadlock: main bubble goroutine has exited but blocked goroutines remain
(same message for a goroutine left in a time.Tick loop)
send on a bubble channel from outside          fatal error: send on synctest channel from outside bubble
synctest.Wait outside any bubble               panic: goroutine is not in a bubble
t.Run inside the bubble                        panic: testing: t.Run called inside synctest bubble
synctest.Test inside a bubble                  panic: synctest.Run called from within a synctest bubble
```

Two findings. The forgotten-goroutine panics turn a goroutine leak into a test failure, the class
of bug `goleak` hunts. And using a bubble channel from outside is a `fatal error`, not the
recoverable panic the package docs describe: a deferred `recover()` never ran and the whole test
binary died, taking every other test in the package with it.

## Trade-offs

- **No clock injection, but only inside the bubble**: plain `time.Now`, timers and `context`
  deadlines are faked, which beats threading a clock interface through constructors. Anything
  started outside the bubble (a shared client, a global worker) runs on real time.
- **Mutexes and I/O stall the clock**: a `sync.Mutex` held across a sleep, real sockets, files or a
  subprocess never let time advance. Use `net.Pipe`, an in-memory fake or `NewTestServer`. Per the
  docs (not measured), a package-level `var wg sync.WaitGroup` cannot join a bubble either.
- **Everything must exit**: the bubble panics if goroutines outlive the test function, so
  background loops need a stop path (`Close`, a cancelled `t.Context()`), usually a design fix the
  service needed anyway.
- **Earlier versus today**: Go 1.24 had it behind `GOEXPERIMENT=synctest` as `synctest.Run(func())`;
  Go 1.25 replaced it with `synctest.Test(t, f)`, stopped time when the root goroutine returns and
  randomized same-instant timers; Go 1.27 added `synctest.Sleep` and `httptest.NewTestServer`.

## Documentation Links

- [testing/synctest package documentation](https://pkg.go.dev/testing/synctest): doc
- [Testing concurrent code with testing/synctest, The Go Blog](https://go.dev/blog/synctest): doc
- [Testing Time (and other asynchronicities), The Go Blog](https://go.dev/blog/testing-time): doc
- [Go 1.27 Release Notes: synctest.Sleep and httptest.NewTestServer](https://go.dev/doc/go1.27): doc
- [net/http/httptest package documentation](https://pkg.go.dev/net/http/httptest): doc
- [Data Race Detector, Go documentation](https://go.dev/doc/articles/race_detector): doc
