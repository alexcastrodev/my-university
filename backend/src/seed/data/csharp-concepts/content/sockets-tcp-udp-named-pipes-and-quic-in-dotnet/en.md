---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

`HttpClient` and Kestrel sit on top of sockets. When you write your own
protocol (a binary RPC, a replicated log, a distributed systems lab) you work
at the level below, and this concept measures what it gives you. TCP is a byte
stream with no message boundaries, so every protocol needs framing. Closing,
resetting, timing out and being refused each surface as a specific exception or
a zero-byte read. UDP keeps datagram boundaries and promises nothing else.
Named pipes and Unix domain sockets are the local alternatives, and
`System.Net.Quic` has a platform requirement that decides whether you can use
it. Everything ran on loopback, on macOS.

Versions: .NET SDK 10.0.100, TFM `net10.0`, no NuGet packages (shared
framework only), macOS arm64.

## Use Cases

- A custom binary protocol between two services you own, without HTTP overhead.
- A distributed systems lab: a key-value server, a Raft peer or a gossip node
  over TCP and UDP.
- A local sidecar talking to the main process over a named pipe or Unix domain
  socket instead of a TCP port.

## Deep Dive

### Three levels: Socket, TcpListener/TcpClient, NetworkStream

`TcpListener` and `TcpClient` wrap `Socket` and hand you a `NetworkStream`, an
ordinary `Stream` (see the stream hierarchy concept), so `ReadExactlyAsync` and
`PipeReader.Create(stream)` apply. Stay there while you only connect, accept,
read and write. Drop to `Socket` (`tcpClient.Client`, or built directly) for
what the wrappers hide: `Shutdown`, `Listen(backlog)`, `SetSocketOption`, UDP,
Unix domain sockets and `SendAsync`/`ReceiveAsync` on `Memory<byte>`.

### TCP is a byte stream, not a message stream

A client wrote `HEL`, `LO-`, `WORLD` with 50 ms pauses, then `A`, `B`, `C` in
three quick writes. The server read with a 1024-byte buffer:

```text
read 1: 3 bytes "HEL"
read 2: 3 bytes "LO-"
read 3: 5 bytes "WORLD"
read 4: 2 bytes "AB"
read 5: 1 bytes "C"
```

Pieces arrived split and `A`, `B` merged. With the server sleeping 400 ms
before its first read, all six writes arrived as one: `read 1: 14 bytes
"HELLO-WORLDABC"`. A read returns whatever the kernel has, so "one `Write` equals one `Read`" is a
bug that only shows under load or on a slow link.

### Length-prefix framing

The fix is a protocol: a 4-byte length, then the body, read with
`ReadExactlyAsync` (loops internally, throws `EndOfStreamException` if the peer
closes first):

```csharp
var hdr = new byte[4];
await s.ReadExactlyAsync(hdr);
var len = BinaryPrimitives.ReadInt32BigEndian(hdr);
var body = new byte[len];
await s.ReadExactlyAsync(body);
```

Three frames sent in 5-byte pieces, so cuts fell inside headers and bodies:

```text
frame (3 bytes): one
frame (14 bytes): second message
frame (1 bytes): 3
ReadExactlyAsync: EndOfStreamException at frame boundary
```

The last line is a clean end (closed between frames); the same exception
mid-frame means a truncated message. The same parse with `PipeReader.Create(stream)` slices the
`ReadOnlySequence<byte>` without copying, breaks out when `buffer.Length` is
below `4 + len`, and calls `AdvanceTo(buffer.Start, buffer.End)`; it printed the same three frames. Always validate `len` against a maximum
before allocating: a peer that sends `0x7FFFFFFF` should not make you allocate
2 GB.

### NoDelay (Nagle) and small messages

Nagle's algorithm holds a small segment while an earlier one is unacknowledged.
The classic trap is write-write-read. 30 round trips of two 1-byte writes and a
1-byte reply:

```text
NoDelay=False: median 0.09 ms, max 0.17 ms
NoDelay=True: median 0.09 ms, max 0.14 ms
```

No visible difference on macOS loopback. The delay comes from the receiver's
delayed ACK, which depends on the stack and is commonly described as tens of
milliseconds on real links (not measured here). The rule stays: for small
request/response messages set `NoDelay = true` and write each message in one
buffer.

### Backlog: when accept does not keep up

`Listen(1)` and no `Accept` at all, six clients connecting with a 1.5 s
timeout:

```text
client 0: connected after 0 ms
client 1: ConnectionReset
connected 1, failed 5 with Listen(1) and no Accept
```

Clients 2 to 5 also got `ConnectionReset`. Three more runs connected 5, 2 and 1
clients (the backlog is a hint). The stable part is the failure mode on macOS: an immediate
`ConnectionReset`, not a hang. Linux is usually described as dropping the SYN
so the client hangs until its timeout (not measured here). Either way: accept
in a tight loop, hand each connection to its own task, and size the backlog
(`TcpListener.Start(backlog)`) for bursts.

### Closing: Shutdown, Close, and the zero-byte read

```text
server read after client Shutdown(Send): 0
client can still read after its own Shutdown(Send): 2 bytes
client read after server Close: 0
```

`Shutdown(SocketShutdown.Send)` sends a FIN: the peer's read returns 0 but you
can still receive ("no more requests, send me the rest"). `Close`/`Dispose`
closes both directions and releases the descriptor. A read returning 0 is the
normal end of stream, not an error. After the half-close `TcpClient.Connected`
was false and `GetStream()` threw, so take the stream first.

### Reset and the real exceptions

An abortive close (`LingerState = new LingerOption(true, 0)`) sends a RST and
the peer's read throws `IOException` with inner `ConnectionReset`. A port nobody listens on gives
`ConnectionRefused`. Writing to a peer that closed while holding unread data
gave inner `SocketError.Shutdown` (OS message "Broken pipe"; its read had
returned 0 first). On `NetworkStream` the `SocketException` is wrapped in an
`IOException`, so look at `InnerException`; a raw `Socket` throws it bare. Log
`SocketErrorCode`, not the message text.

### Timeouts and cancellation

A 300 ms token cancelled the read after 301 ms; a 200 ms `ReceiveTimeout` on a
sync read threw after 201 ms.

Pass a `CancellationToken` (`new CancellationTokenSource(300)` for a deadline)
to `ReadAsync`, `ConnectAsync` or `ReceiveAsync`: it throws
`OperationCanceledException`. `ReceiveTimeout`/`SendTimeout` apply to
synchronous calls and surface as `SocketError.TimedOut`. A read cancelled
mid-frame leaves the stream at an unknown position: close the connection.

### UDP: boundaries kept, delivery not guaranteed

Datagrams of 1, 2 and 3 bytes came out as three receives of exactly 1, 2 and 3
bytes: boundaries are preserved. Two limits showed up:

```text
100-byte datagram into 10-byte buffer: Receive returned 10, rest discarded; Available now 0
70000 bytes: MessageSize
```

A small buffer truncates silently here (no exception), and 70000 bytes exceeds
the UDP payload limit. To provoke loss, the receiver used
`ReceiveBufferSize = 8192` and did not read while the sender fired 2000
datagrams of 1000 bytes:

```text
ReceiveBufferSize requested 8192, effective 8192
sent 2000, received 7, dropped 1993; first 0, last 6, in order: True
```

All 2000 `Send` calls succeeded and 1993 vanished with no error on either
side. Order was kept because loopback has one path; reordering needs a real
network and was not measured (limitation). A UDP protocol needs its own
sequence numbers, acknowledgements and retries.

### Named pipes and Unix domain sockets on macOS

Both work on .NET 10 on macOS. A `NamedPipeServerStream`/`NamedPipeClientStream`
echo took 1 ms including connect. On Unix, .NET builds named pipes on Unix
domain sockets: a file `CoreFxPipe_<name>` appeared in the temp directory (the
docs describe real kernel pipes on Windows). A `Socket` with
`UnixDomainSocketEndPoint` also worked:

```text
bind again on same path: AddressAlreadyInUse
file exists after Dispose: False
```

The file is the address: it exists while bound and was removed on dispose (after
a crash it can stay, so delete a stale file before binding). One-byte round trips, 20000 iterations after warmup,
TCP with `NoDelay`:

```text
TCP loopback ping-pong: 35.1 us/round trip
Unix socket ping-pong: 10.3 us/round trip
Named pipe ping-pong: 9.9 us/round trip
```

Local transports were more than 3 times faster and open no port (use file
permissions instead), but they only reach the same machine. Per the how-to,
Windows named pipes can also cross the network (docs only).

### QUIC

```text
QuicConnection.IsSupported = False; QuicListener.IsSupported = False
```

Not usable on this macOS. The docs say `System.Net.Quic` wraps MsQuic: bundled
with .NET on Windows 11 and Windows Server 2022 or later, `libmsquic` (2.2+)
installed by you on Linux, and a manual MsQuic build elsewhere, outside the
tested matrix. The API is stable since .NET 9. The rest is docs only, not run:
check `IsSupported` first, QUIC needs TLS 1.3 and an ALPN protocol,
`QuicListener.ListenAsync` accepts connections, and each `QuicConnection` opens
many independent `QuicStream`s (HTTP/3 is built on it).

### Bridges: operating systems and distributed systems

A socket is a file descriptor, and bytes sit in kernel buffers between your
`Write` and the peer's `Read`: the dropped UDP datagrams were that buffer
overflowing, and TCP backpressure is it filling until `Write` waits. For
distributed systems, a hand-written RPC needs framing, a timeout on every call,
and idempotent operations, because after a timeout the caller cannot know
whether the server ran the request, so a retry must be safe.

## Trade-offs

- **Control versus HTTP.** A raw protocol has no framing, auth, TLS or tooling
  for free. Use it when you own both ends, otherwise `HttpClient` or gRPC.
- **TCP versus UDP.** TCP gives order and delivery; UDP gives boundaries and
  low latency, and you rebuild reliability (1993 of 2000 lost silently above).
- **NoDelay trades bandwidth for latency.** Right for request/response, wasteful
  for bulk data. Measured effect here: none on macOS loopback.
- **Local transports versus TCP.** More than 3 times faster per round trip and
  no port, but single-machine, and the socket file needs cleanup.
- **QUIC is not available everywhere.** Linux needs `libmsquic`; guard with
  `QuicConnection.IsSupported` and keep a TCP fallback.
- **Failures differ by OS.** A full backlog was `ConnectionReset` on macOS and
  is described as a hang on Linux: test failure paths on the target OS.

## Documentation Links

- [Use Sockets to send and receive data over TCP, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/socket-services) (doc)
- [TCP/UDP classes overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/tcp-classes) (doc)
- [Sockets overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/sockets-overview) (doc)
- [QUIC support in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/quic/quic-overview) (doc)
- [How to use named pipes for network interprocess communication, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-use-named-pipes-for-network-interprocess-communication) (doc)
- [Socket.Shutdown, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.sockets.socket.shutdown) (doc)
- [UnixDomainSocketEndPoint, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.sockets.unixdomainsocketendpoint) (doc)
- [QuicConnection.IsSupported, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.quic.quicconnection.issupported) (doc)
