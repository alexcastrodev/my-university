---
version: 1.0
updatedAt: 2026-11-20
title: "Resolução de DNS e a API DnsResolver"
summary: Dns.GetHostEntryAsync e o que ele não faz (getaddrinfo do SO, sem SRV, TXT, TTL ou escolha de servidor), a resolução tipada do .NET 11 com DnsResolver, SRV com prioridade e peso, NXDOMAIN, timeout e ausência de cache, medidos contra um CoreDNS local.
---
## Objective

Toda chamada de `HttpClient` e todo `Socket.ConnectAsync` para um nome de host
começa com uma consulta, e por quinze anos o .NET ofereceu uma resposta só: o
`Dns.GetHostEntryAsync`, que pergunta ao sistema operacional quais são os
endereços e mais nada. Ele não consegue pedir um registro SRV (o jeito padrão de
publicar "este serviço mora nestes hosts e portas, com esta prioridade e este
peso"), nem TXT nem MX, não informa o TTL e não pode ser apontado para um
servidor DNS específico. O .NET 11 acrescenta o `DnsResolver` e métodos
`Dns.Resolve*` tipados em `System.Net` que falam DNS por conta própria. Este
concept mede os dois caminhos contra um container CoreDNS que subi só para o
teste, com uma zona contendo registros A, AAAA, CNAME, SRV, TXT e MX: o que cada
API enxerga, como uma resposta SRV vira um destino, como aparecem NXDOMAIN,
"sem dados" e um servidor morto, e onde a API nova termina.

Versões: .NET SDK 11.0.100, runtime 11.0.0, TFM `net11.0`, nenhum pacote NuGet
(`System.Net.NameResolution` faz parte do shared framework), CoreDNS 1.15.0 em
Docker, macOS arm64 (Apple M4 Max). O `DnsResolver` não existe no SDK 10.0.100
(CS0246).

## Use Cases

- Service discovery no cliente: resolver `_http._tcp.orders.internal` em hosts,
  portas, prioridades e pesos, e então escolher um destino.
- Ler registros TXT (verificação de domínio, configuração) e MX (roteamento de
  e-mail) sem biblioteca de DNS de terceiros.
- Testes e ferramentas que precisam consultar um servidor DNS específico (um
  CoreDNS local, um resolvedor interno) em vez do que a máquina tem configurado.

## Deep Dive

### O que o Dns.GetHostEntryAsync faz e não faz

```csharp
var e = await Dns.GetHostEntryAsync("localhost");      // ::1, 127.0.0.1
await Dns.GetHostEntryAsync("api.exemplo.test");       // SocketException
```

A documentação diz que ele é implementado com as APIs de resolução de nomes do
sistema operacional (`getaddrinfo` no Windows, equivalentes nas outras
plataformas) e que entradas do arquivo hosts são devolvidas sem consultar o
DNS. Por isso ele respeita o `/etc/hosts`, os domínios de busca e o mDNS, e por
isso também se limita ao que o `getaddrinfo` devolve: endereços. Medido no
macOS, com a zona de teste servida só pelo meu container:

```text
localhost: ::1,127.0.0.1 [7 ms]
api.exemplo.test: SocketException: nodename nor servname provided, or not known [32 ms]
_http._tcp.exemplo.test: SocketException: nodename nor servname provided, or not known [31 ms]
```

O resolvedor do sistema não conhece a minha zona, então `api.exemplo.test`
falha, e um nome que começa com `_http._tcp` é só mais um nome de host sem
endereço. Não há sobrecarga para escolher o servidor, ler um TTL ou pedir um
tipo de registro. A chamada também devolve A e AAAA juntos, na ordem que o SO
escolheu.

### DnsResolver: a API tipada do .NET 11

`DnsResolver` e `DnsResolverOptions` ficam em `System.Net` (assembly
`System.Net.NameResolution`, sem atributo `[Experimental]`,
`[UnsupportedOSPlatform("wasi")]`). `Servers` é um `IList<IPEndPoint>`, então
uma porta fora do padrão funciona. Todo método devolve um `DnsResult<T>` com
`ResponseCode`, `Records` e `NegativeCacheTtl`:

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

Os tipos de registro são structs readonly: `AddressRecord` (`Address`, `Ttl`),
`SrvRecord`, `MxRecord` (`Exchange`, `Preference`), `TxtRecord` (`Values`, uma
lista de strings, uma por trecho entre aspas na zona), `CNameRecord`,
`PtrRecord` e `NsRecord`. O `ResolveAddresses` aceita um `AddressFamily`
opcional (a linha "AAAA only" acima) e segue o CNAME sozinho. Os métodos
estáticos `Dns.ResolveSrv`, `ResolveTxt`, `ResolveMx` e companhia (mais as
variantes `Async`) devolvem os mesmos tipos, mas usam a configuração de
resolvedor da plataforma. Confirmei: o `Dns.ResolveSrvAsync("_http._tcp.exemplo.test")`
estático voltou `NxDomain` com 0 registros, porque perguntou ao servidor DNS da
própria máquina e não ao meu. Use a API de instância quando precisar escolher o
servidor. As notas de versão dizem que as duas agora funcionam também no Linux,
além de Windows e macOS (só docs, não rodei aqui).

### SRV: de registros a um destino

```text
SRV: code=NoError
  prio=10 weight=60 a.exemplo.test:8080 ttl=00:05:00 addrs=[10.0.1.1]
  prio=10 weight=40 b.exemplo.test:8081 ttl=00:05:00 addrs=[10.0.1.2]
  prio=20 weight=100 backup.exemplo.test:9090 ttl=00:05:00 addrs=[10.0.1.3]
```

O `SrvRecord` traz `Target`, `Port`, `Priority`, `Weight`, `Ttl` e `Addresses`.
Os endereços vieram na mesma resposta (o log do CoreDNS mostrou uma única
consulta SRV, sem consulta de seguimento para `a.exemplo.test`), então uma ida e
volta deu host, porta e IP. A regra da RFC 2782: use só o menor número de
prioridade que esteja alcançável; entre prioridades iguais, escolha ao acaso na
proporção do peso; passe para a próxima prioridade só quando o grupo inteiro
falhar. O resolvedor devolve os registros e deixa a escolha com você:

```csharp
var best = srv.Records.Min(x => x.Priority);
var group = srv.Records.Where(x => x.Priority == best).ToList();
var pick = Random.Shared.Next(group.Sum(x => x.Weight));
foreach (var c in group) { if (pick < c.Weight) return c; pick -= c.Weight; }
```

Dez mil escolhas com semente fixa deram `a=5984, b=4016` (pesos 60 e 40) e
nunca `backup`, que tem prioridade 20 e é o destino de failover. Essa é a peça
que o `Dns.GetHostEntryAsync` não dá: ele não tem noção de porta nem de peso.
No ASP.NET Core e no Aspire, quem normalmente faz isso para o `HttpClient` é o
pacote `Microsoft.Extensions.ServiceDiscovery` (veja [Aspire AppHost e ServiceDefaults](/dotnet-concepts/aspire-apphost-servicedefaults-and-deployment)
e [HttpClient e IHttpClientFactory](/dotnet-concepts/httpclient-and-ihttpclientfactory), que
mediram o provedor baseado em configuração).
Um provedor de SRV via DNS vive no pacote separado
`Microsoft.Extensions.ServiceDiscovery.Dns` (`AddDnsSrvServiceEndpointProvider`,
lido na documentação XML dele, não executado aqui).

### NXDOMAIN, "sem dados" e um servidor que nunca responde

A resposta faz parte do resultado, não é exceção, então confira o
`ResponseCode`:

```text
nope A: code=NxDomain records=0 negTtl=00:01:00
api TXT: code=NoError records=0 negTtl=00:01:00
_ftp SRV: code=NxDomain records=0
outside the zone: code=Refused records=0
```

`NxDomain` significa que o nome não existe. `NoError` com zero registros
significa que o nome existe mas não tem registro daquele tipo ("NODATA", aqui o
`api` não tem TXT), e tratar os dois igual esconde bugs. `NegativeCacheTtl` é o
mínimo do SOA da zona (60 s na minha zona), o tempo que quem chamou pode
lembrar "não encontrado". `Refused` é o CoreDNS recusando uma zona que ele não
serve. Falhas de transporte são exceções:

```text
silent server: TimeoutException: The operation has timed out. [9007 ms]
closed port 6989: SocketException: Connection refused [0 ms]
silent, then good server: NoError 3 records [9007 ms]
silent, token 500ms: OperationCanceledException: The operation was canceled. [502 ms]
```

Um servidor que recebe e nunca responde custou 9 s até o `TimeoutException`, e
com o servidor morto primeiro e um bom em segundo a chamada ainda levou 9 s
antes de dar certo: ela esgotou as tentativas no primeiro servidor antes de
passar adiante. O `DnsResolverOptions` só tem `Servers`, então não existe
configuração de timeout para baixar isso. Passe um `CancellationToken` com o seu
próprio prazo (500 ms acima, cancelado em 502 ms), a mesma regra que o
[concept de sockets](/csharp-concepts/sockets-tcp-udp-named-pipes-and-quic-in-dotnet) aplica a toda chamada de rede.

### Sem cache e sem política de retry própria

Cinco chamadas seguidas para o mesmo nome levaram 4,19, 1,49, 1,77, 1,54 e 1,11
ms, e o log do CoreDNS mostrou todas chegando (A e AAAA consultados em separado,
então 5 chamadas viraram 5 consultas A e 5 AAAA). O resultado expõe TTLs, mas
não vi cache no `DnsResolver`: se você resolve num caminho quente, faça cache
pelo `Ttl` por conta própria, ou vai mandar duas consultas por chamada.

### Book vs today

Textos antigos de .NET mostram o `Dns.GetHostEntry` como "a API de DNS" e, para
SRV ou TXT, apontam o `DnsClient.NET` ou o `Heijden.DNS`. Essas bibliotecas
continuam existindo e não comparei recursos com elas, mas desde o .NET 11 a
biblioteca base cobre os tipos de registro comuns com resultado tipado e sem
dependência. `Dns.GetHostByName` e `Dns.Resolve` ainda estão expostos e marcados
`[Obsolete]` ("Use GetHostEntry instead"), então código novo usa o
`GetHostEntryAsync`. O caminho do `getaddrinfo` continua certo para "conectar
neste nome do jeito que a máquina conectaria", porque só ele respeita o arquivo
hosts e a configuração do SO.

## Trade-offs

- **`Dns.GetHostEntryAsync` contra `DnsResolver`.** O primeiro segue o SO
  (arquivo hosts, domínios de busca, DNS dividido de VPN) e devolve só
  endereços; o segundo devolve os tipos de registro comuns com TTLs e consulta
  só os servidores que você listar, então nada da configuração do SO vale (só
  docs para o arquivo hosts). Conectar a um nome: caminho do SO. Ler SRV ou TXT:
  `DnsResolver`.
- **A seleção é sua.** O resolvedor devolve os registros SRV; a lógica de
  prioridade e peso (umas 5 linhas acima) e os health checks são seus. Use o
  pacote de service discovery quando puder.
- **Falha é código, não exceção.** NXDOMAIN e `Refused` voltam como resultado,
  então uma chamada que "funcionou" pode ter zero registros. Timeouts e portas
  recusadas são exceções.
- **Nove segundos é muito.** Passe sempre um token com prazo e não ponha um
  servidor morto primeiro em `Servers`.
- **Sem cache.** Toda chamada é uma ida e volta de rede (cerca de 1 a 4 ms até
  um container em loopback, mais até um servidor real), então faça cache pelo
  TTL nos caminhos quentes.
- **DNS local tem limite.** O loopback não mediu latência real, truncamento de
  UDP nem DNS sobre TCP, e não testei Linux nem Windows.

## Documentation Links

- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [DnsResolver Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresolver) (doc)
- [DnsResolverOptions Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresolveroptions) (doc)
- [DnsResult Struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dnsresult-1) (doc)
- [SrvRecord Struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.srvrecord) (doc)
- [Dns.GetHostEntryAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.dns.gethostentryasync) (doc)
- [Service discovery in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/service-discovery) (doc)
- [RFC 2782, A DNS RR for specifying the location of services (DNS SRV), IETF](https://www.rfc-editor.org/rfc/rfc2782) (doc)
