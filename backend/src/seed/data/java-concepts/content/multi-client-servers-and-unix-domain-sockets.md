---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

A server socket does two jobs that are easy to conflate: it *accepts* connections, and it *converses* on them. Doing both on the same thread produces a server that works perfectly with one client and silently serializes every other one. Getting that split right — an accept loop that immediately hands each `Socket` off to somewhere else — is the whole of "handling multiple clients", and virtual threads have made the cheapest version of it (one thread per connection) the default answer again. Separately, when both ends live on the same machine, TCP loopback is not the only transport available: since JDK 16 (JEP 380) the same `SocketChannel`/`ServerSocketChannel` API can open **Unix domain sockets**, addressed by a filesystem path instead of a host and port, protected by file permissions instead of firewall rules, and faster to set up than a loopback connection. This is how local IPC actually happens in practice — the Docker daemon socket, database sockets, sidecar containers sharing a volume. The mechanics of `ServerSocket` itself are covered in `sockets-and-raw-http-anatomy`; this is about making it concurrent and about the non-TCP option beside it.

## Use Cases

- A server that must talk to more than one client at a time — the concrete difference between three 500 ms requests taking 1.5 s and taking 0.5 s.
- Restricting a service to one network interface (loopback only, or the internal NIC on a multi-homed host) instead of binding to every address the machine has.
- Talking to the Docker daemon, a local database, or a service-mesh sidecar over its Unix socket (`/var/run/docker.sock`, `/tmp/.s.PGSQL.5432`) from Java, without a native library.
- Local IPC between two processes that must *not* be reachable from the network at all — a Unix socket has no port, so nothing outside the host can reach it, by construction.
- Authenticating a local peer by OS identity rather than a password, using the socket's peer-credential option.
- Enumerating the machine's network interfaces and addresses (`NetworkInterface`) to decide what to bind to, or to report where a server is actually listening.

## Deep Dive

### The bug: an accept loop that also does the work

```java
ServerSocket serverSocket = new ServerSocket(8982);
while (true) {
    Socket client = serverSocket.accept();
    handle(client);                    // <-- blocks here; no accept() until this returns
}
```

`accept()` returns a `Socket` for one client and the loop then *converses on that socket inline*. Nothing about this fails or throws — the second and third clients connect fine (the kernel queues them in the accept backlog) and then wait their turn. Against a `handle()` that takes 500 ms, three concurrent clients measure **~1522 ms**. The fix is to hand the socket off and get straight back to `accept()`:

```java
try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
     ServerSocket serverSocket = new ServerSocket(8983)) {
    while (true) {
        Socket client = serverSocket.accept();
        pool.submit(() -> handle(client));   // returns immediately
    }
}
```

Same handler, same three clients: **~505 ms**. `Executors.newVirtualThreadPerTaskExecutor()` creates a fresh virtual thread per task, so "one thread per connection" — the model that used to cap out in the low thousands with platform threads — is viable at a far higher connection count, because a virtual thread blocked in `InputStream.read()` releases its carrier OS thread instead of parking it (see `thread-model-legacy-vs-virtual-threads`). `ExecutorService` is `AutoCloseable` since JDK 19, so try-with-resources handles the shutdown.

Note what does *not* change: each connection still gets a dedicated blocking read loop. Non-blocking `Selector`-based NIO is the alternative that avoids a thread per connection entirely, at a large cost in code complexity — with virtual threads the blocking version is usually the better trade.

### `handle()`: one conversation, closed properly

```java
static void handle(Socket socket) {
    try (socket;
         BufferedReader in = new BufferedReader(
                 new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
         PrintWriter out = new PrintWriter(
                 new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
        String line;
        while ((line = in.readLine()) != null) {
            out.print(line + "\r\n");   // CRLF: what most line-oriented protocols specify
            out.flush();                // without this, both ends can sit waiting on each other
        }
    } catch (IOException e) {
        System.err.println("client " + socket.getInetAddress() + ": " + e);
    }
}
```

`try (socket; ...)` closes the socket even on an exception mid-conversation — a leaked socket in a long-running accept loop is a file-descriptor leak. Two protocol details bite here: line terminators should be `\r\n` rather than the platform's `println()` newline if anything other than your own client might connect, and an unflushed `PrintWriter` buffer is a classic mutual deadlock — the server waits to read the client's next line while its own reply is still sitting in a local buffer.

### Choosing what to bind: backlog and interface

```java
// every interface, default backlog
new ServerSocket(9000);

// loopback only — unreachable from other machines
new ServerSocket(9000, 10, InetAddress.getLoopbackAddress());
// bound: localhost/127.0.0.1:9000

// a specific named interface address, backlog of 50
new ServerSocket(9000, 50, InetAddress.getByName("app-internal.example.com"));
```

The three-argument constructor takes the *bind address* (which interface's address to listen on — omit it and the socket listens on all of them) and the *backlog* (how many completed-but-not-yet-`accept()`ed connections the kernel queues before refusing more; `<= 0` means the system default). Binding to the loopback address is the cheapest possible access control for a service that only local processes should reach.

To discover what addresses exist in the first place, `NetworkInterface` has a stream-returning factory (JDK 9+) alongside the old `Enumeration`-based one:

```java
NetworkInterface.networkInterfaces()
        .filter(iface -> {
            try { return iface.isUp() && !iface.isLoopback(); }
            catch (SocketException e) { return false; }
        })
        .forEach(iface -> System.out.println(iface.getName() + " -> "
                + iface.getInterfaceAddresses()));
```

An "IP address" is a property of an interface, not of a machine — a laptop typically has loopback plus one active interface, a server or a container host has many, and which one you bind decides who can reach you.

### Unix domain sockets: the server side

```java
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

Path socketPath = Path.of("/tmp/jcb-demo.socket");
Files.deleteIfExists(socketPath);                   // see below — bind fails if the file exists

UnixDomainSocketAddress address = UnixDomainSocketAddress.of(socketPath);
ServerSocketChannel serverChannel = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
serverChannel.bind(address);
// serverChannel.getLocalAddress() -> /tmp/jcb-demo.socket   (a UnixDomainSocketAddress)

SocketChannel channel;
while ((channel = serverChannel.accept()) != null) {
    try (channel) {
        ByteBuffer buffer = ByteBuffer.allocate(1024);
        int bytesRead;
        while ((bytesRead = channel.read(buffer)) > 0) {
            buffer.flip();                                       // switch from writing to reading
            System.out.println("[server] " + StandardCharsets.UTF_8.decode(buffer));
            buffer.clear();
        }
    }
}
```

Three API elements carry the whole feature: `StandardProtocolFamily.UNIX` selects the family, `UnixDomainSocketAddress.of(path)` names the endpoint, and the channel classes are the *same* `ServerSocketChannel`/`SocketChannel` used for TCP — `accept()`, `read()`, `write()`, and `Selector` multiplexing all behave as they do for IP sockets. There is no port and no host. `bind()` creates an actual file at that path (`ls -l` shows it as a socket), and that file *is* the address.

The `open(ProtocolFamily)` overload itself dates to JDK 15; `StandardProtocolFamily.UNIX` and `UnixDomainSocketAddress` arrived with JEP 380 in **JDK 16**, and Windows 10 / Windows Server 2019 and later support them too, so this is not Unix-only code despite the name.

### Unix domain sockets: the client side

```java
UnixDomainSocketAddress address = UnixDomainSocketAddress.of(Path.of("/tmp/jcb-demo.socket"));

try (SocketChannel channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
    channel.connect(address);
    ByteBuffer buffer = ByteBuffer.wrap("Hello via a Unix domain socket"
            .getBytes(StandardCharsets.UTF_8));
    while (buffer.hasRemaining()) {
        channel.write(buffer);          // write() may be partial — loop until drained
    }
}
```

The channel API is buffer-oriented, not `String`-oriented, but you don't have to stay there: `java.nio.channels.Channels` adapts a channel to the familiar stream/reader classes, which is what makes it practical to speak a text protocol over a Unix socket.

```java
import java.nio.channels.Channels;

try (SocketChannel channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
    channel.connect(UnixDomainSocketAddress.of(Path.of("/var/run/docker.sock")));

    var out = new PrintWriter(new OutputStreamWriter(
            Channels.newOutputStream(channel), StandardCharsets.US_ASCII));
    out.print("GET /_ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    out.flush();

    var in = new BufferedReader(new InputStreamReader(
            Channels.newInputStream(channel), StandardCharsets.UTF_8));
    in.lines().forEach(System.out::println);
}
// HTTP/1.1 200 OK
// Content-Type: application/json
// Content-Length: 15
//
// {"status":"OK"}
```

That is exactly how tools talk to the Docker daemon: plain HTTP/1.1, hand-written onto a Unix socket, because `java.net.http.HttpClient` has no way to accept a `UnixDomainSocketAddress` — its API is built around a `URI` with a host and port.

### The socket file is a real file, with real lifecycle and real permissions

```java
var serverChannel = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
serverChannel.bind(UnixDomainSocketAddress.of(socketPath));
serverChannel.close();
System.out.println(Files.exists(socketPath));   // true — close() does NOT delete the file
```

Bind again to the same path without deleting it and you get a `BindException`, which is the Unix-socket equivalent of "port already in use" but with a stale file rather than a live process behind it:

```
java.net.BindException: Address already in use
```

So a Unix-socket server needs `Files.deleteIfExists(socketPath)` before binding, and ideally a shutdown hook to clean up after itself. Two more file-level facts matter:

```java
// default permissions come from the process umask — often world-readable/writable-adjacent
Files.getPosixFilePermissions(socketPath);            // e.g. rwxr-xr-x
Files.setPosixFilePermissions(socketPath, PosixFilePermissions.fromString("rw-------"));
```

```java
serverChannel.bind(UnixDomainSocketAddress.of("/tmp/" + "x".repeat(200) + ".sock"));
// java.net.SocketException: Unix domain path too long
```

Access control *is* filesystem permissions — the socket file created by `bind()` inherits the umask, so tighten it (or put the socket in a directory only the intended peers can traverse) rather than assuming it is private. And the path has a platform-specific maximum length, documented as "typically close to and generally not less than 100 bytes"; deep temp directories plus a long name will hit it.

### Identifying the peer: no address, but an OS identity

```java
try (SocketChannel channel = serverChannel.accept()) {
    System.out.println("remote = '" + channel.getRemoteAddress() + "'");   // remote = ''
}
```

An accepted Unix-socket channel reports an **unnamed** peer address (an empty path), because a connecting client normally never binds a path of its own — there is no `getInetAddress()` equivalent to log or authorize against. What you get instead is better: the kernel's view of who the peer process runs as, via a JDK-specific socket option in the `jdk.net` module:

```java
import jdk.net.ExtendedSocketOptions;
import jdk.net.UnixDomainPrincipal;

UnixDomainPrincipal peer = channel.getOption(ExtendedSocketOptions.SO_PEERCRED);
System.out.println(peer);
// UnixDomainPrincipal[user=alexandrocastro, group=staff]
```

`SO_PEERCRED` yields a `UnixDomainPrincipal` naming the peer's user and group as the OS sees them — an identity the client cannot forge, which is why local daemons commonly authorize by socket permissions plus peer credentials instead of by token. It is JDK-specific and platform-dependent (available on platforms whose kernel supports peer credentials, per JEP 380's explicit exception to its own non-goals), so guard for `UnsupportedOperationException`.

### One last hazard: `SocketAddress` is no longer always `InetSocketAddress`

```java
InetSocketAddress addr = (InetSocketAddress) serverChannel.getLocalAddress();
// java.lang.ClassCastException: class java.net.UnixDomainSocketAddress
//   cannot be cast to class java.net.InetSocketAddress
```

Code written before JDK 16 routinely casts the `SocketAddress` returned by `getLocalAddress()`/`getRemoteAddress()` straight to `InetSocketAddress`, because that was the only possibility. JEP 380 lists this as its main compatibility risk. The fix is a pattern match rather than a cast:

```java
String describe(SocketAddress address) {
    return switch (address) {
        case InetSocketAddress inet -> inet.getHostString() + ":" + inet.getPort();
        case UnixDomainSocketAddress unix -> "unix:" + unix.getPath();
        case null -> "unbound";
        default -> address.toString();
    };
}
```

## Trade-offs

- **Thread-per-connection is simple and now cheap, but it is still one stack per live connection.** Virtual threads move the ceiling from thousands to a much larger number, and blocking reads stop being wasteful — but each connection still holds a virtual thread's stack and its socket's file descriptor, so `ulimit -n` and memory, rather than thread count, become the limit.
```java
// 3 concurrent clients, handler sleeps 500ms:
// handle(client) inline in the accept loop          -> ~1522 ms
// pool.submit(() -> handle(client)), virtual threads -> ~505 ms
```
- **Non-blocking `Selector` NIO scales further and costs far more to write.** It removes the per-connection thread entirely, but every handler becomes a state machine over partial reads and writes, with no straight-line control flow — a real trade, not a free upgrade, and rarely worth making by hand now that blocking virtual threads exist.
- **Backlog tuning is a guess in both directions.** Too small and bursts of clients get connection refusals during a slow handler; too large and the kernel queues connections whose clients have already timed out, so the server does work nobody is waiting for. The docs frame it exactly as a compromise between resource usage and throughput, with no recommended number.
- **Unix domain sockets are faster and more secure than TCP loopback, and strictly local — which is the feature and the limit.** JEP 380 cites faster setup, higher throughput, and OS-enforced filesystem access control. The same properties mean the moment one side moves to another host or another network namespace, the transport has to change; there is no "same code, different address" migration to TCP because the address type itself differs.
- **The socket file outliving the process is a real operational footgun, unlike a TCP port.** A crashed server leaves the file behind and the restart fails with `BindException` even though nothing is listening.
```java
Files.deleteIfExists(socketPath);   // required before bind() — close() never removes it
serverChannel.bind(UnixDomainSocketAddress.of(socketPath));
```
- **Default socket-file permissions come from the umask, so "protected by the filesystem" is only true once you make it true.**
```java
Files.getPosixFilePermissions(socketPath);   // rwxr-xr-x straight after bind()
```
- **Much of the ecosystem still assumes host-and-port.** `java.net.http.HttpClient`, JDBC URLs, and most client libraries take a `URI` or host/port pair with no place to put a filesystem path, so using a Unix socket often means dropping to raw channel I/O (or a library that explicitly supports it) even for a protocol as ordinary as HTTP.
- **Peer credentials are a JDK-specific, platform-dependent option.** `ExtendedSocketOptions.SO_PEERCRED` requires the `jdk.net` module and kernel support; code that relies on it needs a fallback for platforms where `getOption` throws `UnsupportedOperationException`.

## Documentation Links

- [ServerSocket — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/ServerSocket.html) — doc
- [NetworkInterface — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/NetworkInterface.html) — doc
- [UnixDomainSocketAddress — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/UnixDomainSocketAddress.html) — doc
- [StandardProtocolFamily — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/StandardProtocolFamily.html) — doc
- [ServerSocketChannel — java.nio.channels API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/ServerSocketChannel.html) — doc
- [SocketChannel — java.nio.channels API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/SocketChannel.html) — doc
- [ExtendedSocketOptions — jdk.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.net/jdk/net/ExtendedSocketOptions.html) — doc
- [JEP 380: Unix-Domain Socket Channels](https://openjdk.org/jeps/380) — doc
