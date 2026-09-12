---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a minimal RPC layer that lets one goroutine call a method on another as if it were local, while the call actually crosses a simulated network boundary.
- Implement an injectable transport layer capable of delaying a message, dropping it silently, reordering it relative to other messages, and cutting off communication between a specific pair of nodes entirely.
- Design a small experiment harness that can declare a network scenario (which pairs are partitioned, what the drop rate is) and run a workload against it repeatably.
- Explain why every later lab in this discipline depends on this simulator rather than a real network, and what that dependency buys in exchange for giving up real network conditions.

## Context & Motivation

`distributed-systems-i`'s own **Remote Procedure Calls and the Illusion of a Local Call** already made the theoretical case: an RPC mechanism's whole job is making a call to another machine look, from the caller's code, like an ordinary local function call, while a very different, much less reliable reality, messages that can be delayed, lost, duplicated, or arrive out of order, sits underneath that illusion. This lab does not re-derive that argument; it builds the thing that argument is about, so every later lab that needs to break a Raft cluster or a replicated store on purpose has a real, controllable way to do it.

MIT 6.5840, the course this whole laboratory discipline's arc is modeled on, provides exactly this kind of simulator, its own `labrpc` package, ready-made to its students specifically so they can spend their effort on Raft and replication logic rather than on network simulation. This lab makes a deliberate, different pedagogical choice: building a simplified version of that same kind of simulator by hand first, so its actual mechanics, not just its API, are understood before relying on it as a black box for eight more labs.

## Core Theory

This lab builds directly on `remote-procedure-calls-and-the-illusion-of-a-local-call`'s own two-part model of an RPC call: a client stub that packages arguments and blocks waiting for a reply, and a server-side dispatcher that unpacks a request, invokes the real method, and sends the result back. Nothing about *why* RPC needs this structure is re-derived here; it is used as already-understood theory. What is new here is the transport underneath it, deliberately made unreliable on command rather than assumed reliable, which is also the foundation `at-least-once-at-most-once-and-exactly-once-semantics` needs, covered next in `single-node-kv-server-with-at-most-once-semantics`.

**Language note**: this discipline's labs, starting here, use Go, not the Python used in `algorithm-laboratory`. This is a deliberate choice: MIT 6.5840, the real course this discipline's lab sequence is modeled on, uses Go throughout, and Go's goroutines and channels are a natural, low-ceremony fit for the concurrent RPC handling, background timers, and message-passing this whole discipline is built around.

## Worked Examples

### API specification

```text
Network interface (what every later lab depends on):

  network.MakePair(from, to string) — declares an addressable pair
  network.Connect(from, to string) — allows messages between the pair
  network.Disconnect(from, to string) — simulates a partition: no
    message in either direction is delivered until reconnected
  network.SetUnreliable(rate float64) — a fraction of messages, chosen
    independently per message, are silently dropped instead of delivered
  network.SetDelay(min, max time.Duration) — every delivered message
    is held for a random duration in this range before arriving

Client.Call(server, method string, args, reply interface{}) bool —
  returns false if the network drops the request or the reply
  (indistinguishable to the caller, matching a real unreliable network)
```

### Step 1 — a server that dispatches by method name

```go
type Server struct {
    mu      sync.Mutex
    methods map[string]reflect.Value // registered handlers, by name
}

func (s *Server) Register(name string, handler interface{}) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.methods[name] = reflect.ValueOf(handler)
}

func (s *Server) dispatch(method string, args interface{}) interface{} {
    s.mu.Lock()
    fn, ok := s.methods[method]
    s.mu.Unlock()
    if !ok {
        panic("unregistered RPC method: " + method)
    }
    // Call the registered handler with the decoded arguments,
    // exactly as a real RPC framework's dispatcher would.
    result := fn.Call([]reflect.Value{reflect.ValueOf(args)})
    return result[0].Interface()
}
```

### Step 2 — a network that can be told to misbehave

```go
type Network struct {
    mu           sync.Mutex
    connected    map[string]bool     // "from->to" pair key -> connected
    unreliable   float64             // fraction of messages dropped
    minDelay     time.Duration
    maxDelay     time.Duration
    servers      map[string]*Server
}

func (n *Network) deliver(from, to, method string, args interface{}) (interface{}, bool) {
    n.mu.Lock()
    connected := n.connected[from+"->"+to]
    drop := rand.Float64() < n.unreliable
    delay := n.minDelay + time.Duration(rand.Int63n(int64(n.maxDelay-n.minDelay+1)))
    server := n.servers[to]
    n.mu.Unlock()

    if !connected || drop {
        return nil, false // simulated partition or packet loss
    }
    time.Sleep(delay) // simulated network latency, deliberately variable
    return server.dispatch(method, args), true
}
```

The two lines checking `connected` and `drop` are the entire mechanism every later lab's failure injection rests on: `Disconnect` flips one boolean, `SetUnreliable` biases one coin flip, and every RPC in the system, in every later lab, routes through this same `deliver` function without any lab-specific code needing to know how the failure is actually being simulated.

### Step 3 — a client stub that blocks and can time out

```go
func (c *Client) Call(server, method string, args, reply interface{}) bool {
    resultCh := make(chan struct{ value interface{}; ok bool }, 1)
    go func() {
        v, ok := c.network.deliver(c.name, server, method, args)
        resultCh <- struct{ value interface{}; ok bool }{v, ok}
    }()
    select {
    case res := <-resultCh:
        if res.ok {
            reflect.ValueOf(reply).Elem().Set(reflect.ValueOf(res.value))
        }
        return res.ok
    case <-time.After(c.timeout):
        return false // caller cannot distinguish "dropped" from "just slow"
    }
}
```

This last point is worth making explicit because every later lab's duplicate-detection and retry logic depends on it: `Call` returning `false` covers two genuinely different real situations, the request or reply was actually dropped, or it is simply still in flight and slow, and the client-side code has no way to tell which. This is not a limitation of this specific simulator; it is the actual, irreducible property of real unreliable networks this simulator exists to make concrete.

### Step 4 — a repeatable failure scenario

```go
func TestPartitionScenario(t *testing.T) {
    net := MakeNetwork()
    // ... register servers a, b, c ...
    net.SetUnreliable(0.1)
    net.Disconnect("a", "c")
    net.Disconnect("c", "a")
    // Run a workload here; c can now only reach b, not a.
    // A later lab's leader-election logic is exercised against
    // exactly this kind of declared, repeatable partition.
}
```

## Common Misconceptions & Pitfalls

- **"A dropped RPC and a slow RPC look different to the caller."** By design, they do not; `Call` returning `false` after a timeout is genuinely ambiguous between "the network ate it" and "it's still in flight," which is the real, uncomfortable property of unreliable networks this simulator is built specifically to preserve, not an implementation shortcut.
- **"Simulating a partition just means dropping every packet with some probability."** A partition is a specific, structural failure, communication between one particular pair of nodes is cut while the rest of the network functions normally, distinct from a general, uniform packet-loss rate; `Disconnect` and `SetUnreliable` model two genuinely different real failure modes, and later labs need both, separately controllable.
- **"This simulator is just test scaffolding, not something worth understanding deeply."** Every later lab's correctness claims, a majority partition makes progress, a minority partition correctly stalls, a crashed node recovers correctly, are only as trustworthy as this simulator's own correctness; a bug here would silently invalidate every test built on top of it.

## Summary

This lab builds the foundation every later lab in this discipline depends on: an RPC layer implementing the client-stub-and-server-dispatcher model `remote-procedure-calls-and-the-illusion-of-a-local-call` already covered theoretically, running over a transport that can be told, on command, to delay, drop, reorder, or partition specific pairs of nodes, in Go rather than the Python used elsewhere in this platform's labs, matching the real course, MIT 6.5840, this discipline's lab sequence is modeled on. Every later correctness claim this discipline makes, about Raft's safety under crashes, about a replicated store's linearizability under partition, is only as trustworthy as this simulator's own correctness, which is exactly why it is built and understood first, by hand, rather than treated as an opaque black box.

## Documentation Links

- [MIT 6.5840 (Distributed Systems) — Course Overview](https://pdos.csail.mit.edu/6.824/index.html): the real course this discipline's lab sequence is modeled on, including its own `labrpc` simulator this lab builds a simplified version of by hand.
- [Birrell & Nelson — Implementing Remote Procedure Calls (1984)](http://www.bitsavers.org/pdf/xerox/parc/techReports/CSL-83-7_Implementing_Remote_Procedure_Calls.pdf): the original paper establishing the RPC model this lab's client-stub-and-dispatcher implementation follows.
