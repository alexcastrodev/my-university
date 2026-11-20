---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Every `HttpClient` call and every `Socket.ConnectAsync` to a host name starts
with a lookup, and for fifteen years .NET offered one answer: `Dns.GetHostEntryAsync`,
which asks the operating system for addresses and nothing else. It cannot ask
for an SRV record (the standard way to publish "this service lives on these
hosts and ports, with this priority and weight"), a TXT or an MX, it does not
tell you the TTL, and it cannot be pointed at a specific DNS server. .NET 11
adds `DnsResolver` and typed `Dns.Resolve*` methods in `System.Net` that speak
DNS themselves. This concept measures both paths against a CoreDNS container
started only for the test, with a zone holding A, AAAA, CNAME, SRV, TXT and MX
records: what each API sees, how an SRV answer turns into a destination, what
NXDOMAIN, "no data" and a dead server look like, and where the new API stops.

Versions: .NET SDK 11.0.100, runtime 11.0.0, TFM `net11.0`, no NuGet packages
(`System.Net.NameResolution` is part of the shared framework), CoreDNS 1.15.0
in Docker, macOS arm64 (Apple M4 Max). `DnsResolver` does not exist in the
10.0.100 SDK (CS0246).

## Use Cases

- Client-side service discovery: resolve `_http._tcp.orders.internal` to
  hosts, ports, priorities and weights, then pick a destination.
- Reading TXT records for domain verification or configuration, and MX for
  mail routing, without a third-party DNS library.
- Tests and tools that must query a specific DNS server (a local CoreDNS, an
  internal resolver) instead of whatever the machine is configured with.

## Deep Dive

### What Dns.GetHostEntryAsync does and does not do

```csharp
var e = await Dns.GetHostEntryAsync("localhost");      // ::1, 127.0.0.1
await Dns.GetHostEntryAsync("api.exemplo.test");       // SocketException
```

The documentation says it is implemented with the operating system's name
resolution APIs (`getaddrinfo` on Windows, equivalents elsewhere), and that
entries in the hosts file are returned without querying DNS. That is why it
honors `/etc/hosts`, the search domains and mDNS, and also why it is limited
to what `getaddrinfo` returns: addresses. Measured on macOS, with the test
zone served only by my container:

```text
localhost: ::1,127.0.0.1 [7 ms]
api.exemplo.test: SocketException: nodename nor servname provided, or not known [32 ms]
_http._tcp.exemplo.test: SocketException: nodename nor servname provided, or not known [31 ms]
```

The system resolver does not know my zone, so `api.exemplo.test` fails, and a
name starting with `_http._tcp` is just another host name that has no address.
There is no overload to choose the server, to read a TTL or to ask for a
record type. The call also returns A and AAAA together, in the order the OS
chose.

### DnsResolver: the typed API of .NET 11

`DnsResolver` and `DnsResolverOptions` are in `System.Net` (assembly
`System.Net.NameResolution`, no `[Experimental]` attribute, `[UnsupportedOSPlatform("wasi")]`).
`Servers` is an `IList<IPEndPoint>`, so a non-standard port is fine. Every
method returns a `DnsResult<T>` with `ResponseCode`, `Records` and
`NegativeCacheTtl`:

```csharp
using var r = new DnsResolver(new DnsResolverOptions
    { Servers = { new IPEndPoint(IPAddress.Loopback, 6980) } });

var a = await r.ResolveAddressesAsync("api.exemplo.test", CancellationToken.None);
var srv = await r.ResolveSrvAsync("_http._tcp.exemplo.test", CancellationToken.None);
var txt = await r.ResolveTxtAsync("info.exemplo.test", CancellationToken.None);
```

```text
A+AAAA: code=NoError negTtl=00:00:00
  10.0.0.10 ttl=00:05:00
  10.0.0.11 ttl=00:05:00
  fd00::10 ttl=00:05:00
AAAA only: fd00::10
TXT: [v=1 | region=eu-central] ttl=00:05:00
MX: pref=10 mx1.exemplo.test
CNAME: api.exemplo.test
A via CNAME web: 10.0.0.10,10.0.0.11,fd00::10
```

The record types are readonly structs: `AddressRecord` (`Address`, `Ttl`),
`SrvRecord`, `MxRecord` (`Exchange`, `Preference`), `TxtRecord` (`Values`, a
list of strings, one per quoted chunk in the zone), `CNameRecord`, `PtrRecord`
and `NsRecord`. `ResolveAddresses` takes an optional `AddressFamily` (the AAAA
only line above) and follows the CNAME on its own. The static `Dns.ResolveSrv`,
`ResolveTxt`, `ResolveMx` and friends (plus `Async` variants) return the same
types but use the platform resolver configuration. I confirmed that: the static
`Dns.ResolveSrvAsync("_http._tcp.exemplo.test")` came back `NxDomain` with 0
records, because it asked the machine's own DNS server, not mine. Use the
instance API when you need to choose the server. The release notes say both
now work on Linux as well as Windows and macOS (docs only, not run here).

### SRV: from records to a destination

```text
SRV: code=NoError
  prio=10 weight=60 a.exemplo.test:8080 ttl=00:05:00 addrs=[10.0.1.1]
  prio=10 weight=40 b.exemplo.test:8081 ttl=00:05:00 addrs=[10.0.1.2]
  prio=20 weight=100 backup.exemplo.test:9090 ttl=00:05:00 addrs=[10.0.1.3]
```

`SrvRecord` carries `Target`, `Port`, `Priority`, `Weight`, `Ttl` and
`Addresses`. The addresses came in the same response (CoreDNS logged a single
SRV query, no follow-up for `a.exemplo.test`), so one round trip gave host,
port and IP. The rule from RFC 2782: use only the lowest priority number that
is reachable; among equal priorities pick randomly in proportion to weight;
move to the next priority only when the whole group fails. The resolver
returns the records and leaves the choice to you:

```csharp
var best = srv.Records.Min(x => x.Priority);
var group = srv.Records.Where(x => x.Priority == best).ToList();
var pick = Random.Shared.Next(group.Sum(x => x.Weight));
foreach (var c in group) { if (pick < c.Weight) return c; pick -= c.Weight; }
```

Ten thousand picks with a fixed seed gave `a=5984, b=4016` (weights 60 and 40)
and never `backup`, which is priority 20 and is the failover target. This is
the piece `Dns.GetHostEntryAsync` cannot give you: it has no notion of a port
or a weight. In ASP.NET Core and Aspire, the `Microsoft.Extensions.ServiceDiscovery`
package normally does this for `HttpClient` (see [Aspire AppHost and ServiceDefaults](/dotnet-concepts/aspire-apphost-servicedefaults-and-deployment)
and [HttpClient and IHttpClientFactory](/dotnet-concepts/httpclient-and-ihttpclientfactory), which
measured the configuration-based provider). A DNS
SRV provider lives in the separate `Microsoft.Extensions.ServiceDiscovery.Dns`
package (`AddDnsSrvServiceEndpointProvider`, read from its XML docs, not run
here).

### NXDOMAIN, "no data" and a server that never answers

The answer is part of the result, not an exception, so check `ResponseCode`:

```text
nope A: code=NxDomain records=0 negTtl=00:01:00
api TXT: code=NoError records=0 negTtl=00:01:00
_ftp SRV: code=NxDomain records=0
outside the zone: code=Refused records=0
```

`NxDomain` means the name does not exist. `NoError` with zero records means
the name exists but has no record of that type ("NODATA", here `api` has no
TXT), and treating the two the same hides bugs. `NegativeCacheTtl` is the
zone's SOA minimum (60 s in my zone), the time a caller may remember "not
found". `Refused` is CoreDNS declining a zone it does not serve. Failures of
the transport are exceptions:

```text
silent server: TimeoutException: The operation has timed out. [9007 ms]
closed port 6989: SocketException: Connection refused [0 ms]
silent, then good server: NoError 3 records [9007 ms]
silent, token 500ms: OperationCanceledException: The operation was canceled. [502 ms]
```

A server that receives and never answers cost 9 s before the
`TimeoutException`, and with the dead server listed first and a good one second
the call still took 9 s before succeeding: it exhausted its attempts on the
first server before moving on. `DnsResolverOptions` has only `Servers`, so no
timeout setting exists to lower that. Pass a `CancellationToken` with your own
deadline (500 ms above, cancelled after 502 ms), the same rule the
[sockets concept](/csharp-concepts/sockets-tcp-udp-named-pipes-and-quic-in-dotnet) applies to every network call.

### No cache, no retry policy of its own

Five calls in a row for the same name took 4.19, 1.49, 1.77, 1.54 and 1.11 ms,
and the CoreDNS log showed every call arriving (A and AAAA queried separately,
so 5 calls meant 5 A and 5 AAAA queries). The result exposes TTLs but I saw no
caching in `DnsResolver`: if you resolve in a hot path, cache by `Ttl`
yourself, or you send two queries per call.

### Book vs today

Older .NET texts show `Dns.GetHostEntry` as "the DNS API", and for SRV or TXT
point to `DnsClient.NET` or `Heijden.DNS`. Those libraries are still
there and I did not compare features with them, but since .NET 11 the base
library covers the common record types with a typed result and no dependency.
`Dns.GetHostByName` and `Dns.Resolve` are still exposed and marked `[Obsolete]`
("Use GetHostEntry instead"), so new code uses `GetHostEntryAsync`. The `getaddrinfo` path stays correct for "connect to this
name the way the machine would", because only it honors the hosts file and the
OS configuration.

## Trade-offs

- **`Dns.GetHostEntryAsync` versus `DnsResolver`.** The first follows the OS
  (hosts file, search domains, VPN split DNS) and returns only addresses; the
  second returns every common record type with TTLs but ignores the hosts file
  and, with an instance, the OS server list. Connecting to a name: OS path.
  Reading SRV or TXT: `DnsResolver`.
- **You build the selection.** The resolver returns SRV records; priority and
  weight logic (about 5 lines above) is yours, plus health checks. Use the
  service discovery package when you can.
- **Failure is a code, not an exception.** NXDOMAIN and `Refused` come back as
  results, so a call that "worked" can hold zero records. Timeouts and refused
  ports are exceptions.
- **Nine seconds is a long default.** Always pass a token with a deadline, and
  do not put a dead server first in `Servers`.
- **No cache.** Every call is a network round trip (about 1 to 4 ms to a
  loopback container, more to a real server), so cache by TTL on hot paths.
- **Local DNS has limits.** Loopback measured nothing about real latency, UDP
  truncation or DNS over TCP, and I did not test Linux or Windows.

## Documentation Links

- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [DnsResolver Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresolver) (doc)
- [DnsResolverOptions Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresolveroptions) (doc)
- [DnsResult Struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresult-1) (doc)
- [SrvRecord Struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.srvrecord) (doc)
- [Dns.GetHostEntryAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dns.gethostentryasync) (doc)
- [Service discovery in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/service-discovery) (doc)
- [RFC 2782, A DNS RR for specifying the location of services (DNS SRV), IETF](https://www.rfc-editor.org/rfc/rfc2782) (doc)
