---
version: 1.0
updatedAt: 2026-10-14
title: "Kestrel, IIS e Modelos de Hospedagem"
summary: Kestrel sozinho ou atrás de reverse proxy, forwarded headers e a lista de proxies confiáveis, limites do servidor, IIS in-process versus out-of-process e a liberação de memória do ASP.NET Core 10.
---
## Objective

Uma aplicação ASP.NET Core é um programa de console que possui um servidor web.
O servidor é uma implementação de `IServer`, e o framework não se importa com
qual: ele transforma conexões brutas em objetos `HttpContext` e entrega ao seu
pipeline de middleware. Na prática esse servidor pode estar em três lugares:
Kestrel sozinho, Kestrel atrás de um reverse proxy, ou IIS (in-process ou
out-of-process). O objetivo é entender o que cada modelo muda sobre quem
termina o TLS, quem enxerga o endereço real do cliente, quais limites valem e o
que você precisa configurar para o app se comportar atrás de um proxy do mesmo
jeito que se comporta na sua máquina.

## Use Cases

- Escolher entre expor o Kestrel direto ou colocar nginx, YARP, um ingress ou um
  load balancer de nuvem na frente dele.
- Depurar um app atrás de proxy que acha que toda requisição é `http` vinda de
  `127.0.0.1`, o que quebra redirecionamentos, links absolutos e rate limiting.
- Aumentar ou diminuir o limite de corpo da requisição de um endpoint de upload.
- Migrar um app de um servidor Windows com IIS para um container Linux e saber
  quais configurações deixam de valer.

## Deep Dive

### Kestrel é o servidor padrão

`WebApplication.CreateBuilder` registra o Kestrel, a menos que outra coisa seja
configurada. Ele é multiplataforma, construído sobre sockets gerenciados e
`System.IO.Pipelines`, e fala HTTP/1.1, HTTP/2 e HTTP/3. A documentação oficial
diz que o Kestrel pode ser usado sozinho como servidor de borda (exposto à
Internet) e que um reverse proxy continua útil quando você quer compartilhar uma
porta entre vários processos, camadas extras de segurança ou balanceamento. Os
dois são válidos: a escolha é operacional, não é questão de o Kestrel ser
"inseguro".

Endpoints em texto puro falam só HTTP/1.1. O HTTP/2 é negociado por ALPN durante
o handshake TLS, então exige um endpoint HTTPS. Subir um app pequeno com um
endpoint de cada tipo e pedir cada protocolo ao curl mostra isso:

```csharp
// k.cs, rode com: dotnet run k.cs   (file-based app, SDK 10.0.100)
#:sdk Microsoft.NET.Sdk.Web
using Microsoft.AspNetCore.Server.Kestrel.Core;

var b = WebApplication.CreateBuilder(args);
b.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = 10;                 // bytes, minúsculo de propósito
    o.ListenLocalhost(5280);                          // HTTP puro
    o.ListenLocalhost(5281, l =>
    {
        l.Protocols = HttpProtocols.Http1AndHttp2;
        l.UseHttps("t.pfx", "x");                     // certificado autoassinado descartável
    });
});
var app = b.Build();
app.MapGet("/info", (HttpContext c) => $"proto={c.Request.Protocol} scheme={c.Request.Scheme}");
app.MapPost("/echo", async (HttpContext c) =>
    (await new StreamReader(c.Request.Body).ReadToEndAsync()).Length.ToString());
app.Run();
```

```text
$ curl -si http://localhost:5280/info           -> Server: Kestrel   proto=HTTP/1.1 scheme=http
$ curl -sik --http2 https://localhost:5281/info -> HTTP/2 200        proto=HTTP/2 scheme=https
$ curl -sik --http1.1 https://localhost:5281/info                    proto=HTTP/1.1 scheme=https
$ curl --http2-prior-knowledge http://localhost:5280/info            (falha: a porta em texto puro é só HTTP/1.1)
```

A documentação lista uma ressalva do HTTP/2 no macOS e diz que o macOS serve
para desenvolvimento, não para cargas de produção. Na máquina usada para esta
lição o HTTP/2 sobre TLS negociou normalmente; trate a tabela de plataformas da
documentação como o contrato para produção e o seu teste como conveniência.

### Limites são trabalho do Kestrel, então acompanham o servidor

O Kestrel aplica limites antes de o seu código rodar. O primeiro que costuma
morder é o `MaxRequestBodySize`, cujo padrão é 30.000.000 de bytes (cerca de
28,6 MB). Quando o corpo passa disso, a requisição é rejeitada sem chegar ao
handler:

```text
$ curl -si -X POST -d "aaaaaaaaaaaaaaaaaaaa" http://localhost:5280/echo   (limite = 10)
HTTP/1.1 413 Payload Too Large
Connection: close
```

Outros limites que valem ser conhecidos pelo nome são `MaxConcurrentConnections`,
`KeepAliveTimeout` e `RequestHeadersTimeout`. Também dá para mudar o limite de
corpo de um endpoint com `[RequestSizeLimit]` ou `IHttpMaxRequestBodySizeFeature`,
mas só antes de ler o corpo. Um proxy também tem limites próprios (o nginx usa
1 MB em `client_max_body_size` por padrão), e vale o menor da cadeia, por isso um
upload pode falhar com um 413 que os logs do seu app nunca mostram.

### Atrás de um reverse proxy: forwarded headers

Um proxy abre uma conexão nova até o Kestrel, então do ponto de vista do app toda
requisição vem do proxy, em HTTP puro. O proxy conta a verdade em
`X-Forwarded-For`, `X-Forwarded-Proto` e `X-Forwarded-Host`, e o middleware
`ForwardedHeaders` copia esses valores para `Request.Scheme`,
`Connection.RemoteIpAddress` e `Request.Host`:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear();
    o.KnownNetworks.Clear();
    o.KnownProxies.Add(IPAddress.Parse("10.9.9.9")); // o proxy que você de fato roda
});

var app = builder.Build();
app.UseForwardedHeaders();   // primeiro, antes de tudo que lê scheme ou IP
```

A lista de confiança é a parte importante, porque qualquer cliente pode mandar
esses cabeçalhos. O middleware ignora os cabeçalhos de quem não está na lista, e
as listas padrão contêm só endereços de loopback. Esse padrão tem uma armadilha
que o teste abaixo expôs: adicionar `10.9.9.9` em `KnownProxies` **não** impediu
que um chamador em loopback fosse tratado como confiável, porque a entrada de
loopback continua na lista. Só depois de `Clear()` nas duas listas a mesma
requisição forjada passou a se comportar direito:

```text
curl -H "X-Forwarded-For: 203.0.113.9" -H "X-Forwarded-Proto: https" http://localhost:5280/info
listas padrão + Add(10.9.9.9):  scheme=https ip=203.0.113.9   (valores forjados aceitos)
após Clear() + Add(10.9.9.9):   scheme=http  ip=::1           (valores forjados ignorados)
```

Mais dois fatos da documentação. `ForwardLimit` vale 1 por padrão, então só a
entrada mais à direita de um cabeçalho com vários valores é processada. E
definir `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` liga o middleware com
configurações pensadas para ambientes de nuvem, sem restrição de `KnownProxies`;
use só quando a rede já garante que ninguém alcança o app sem passar pelo proxy.

### IIS: in-process versus out-of-process

> Esta seção vem só da documentação oficial. O IIS e o ASP.NET Core Module não
> rodam na máquina macOS usada para escrever esta lição, então nada disto foi
> executado.

No Windows, o IIS fica na frente do app por meio do ASP.NET Core Module. Desde o
ASP.NET Core 3.0 o padrão é a hospedagem **in-process**: o app roda dentro do
processo worker do IIS (`w3wp.exe`) e usa o `IISHttpServer` no lugar do Kestrel,
então as requisições não passam por proxy pelo adaptador de loopback. Dá para
declarar explicitamente com `<AspNetCoreHostingModel>InProcess</AspNetCoreHostingModel>`
no arquivo de projeto. Consequências listadas pela documentação:

- O Kestrel não é usado, então as configurações de `ConfigureKestrel` não valem.
  O limite de corpo vem de `IISServerOptions.MaxRequestBodySize` (padrão
  30.000.000), e o IIS aplica antes o seu próprio `maxAllowedContentLength`.
- Um app pool por app, e a arquitetura (bitness) do app tem que casar com a do pool.
- Executáveis single-file não podem ser carregados pela hospedagem in-process.

O modo out-of-process mantém o Kestrel e faz do IIS um reverse proxy, que é a
mesma forma que você tem no Linux com nginx, só que com outro proxy.

### A memória volta para o sistema no ASP.NET Core 10

O Kestrel aluga buffers de um memory pool. Antes do ASP.NET Core 10 esse pool
mantinha a memória a que tinha crescido durante um pico de tráfego. As release
notes do ASP.NET Core 10 dizem que os pools usados por Kestrel, IIS e HTTP.sys
agora descartam blocos automaticamente quando o app está ocioso ou com menos
carga, sem configuração, e que há métricas novas sob o nome de meter
`Microsoft.AspNetCore.MemoryPool`. Isso não foi medido aqui; a afirmação é das
release notes. Efeito prático: um container que teve um pico uma vez não segura
essa memória só porque o pico aconteceu.

## Trade-offs

- **Kestrel sozinho é simples, um proxy é mais coisa para operar.** Expor direto
  remove um salto e um arquivo de configuração, mas você cuida da renovação do
  certificado, da filtragem de requisições e do limite de porta única (dois
  processos não compartilham uma porta sem um proxy na frente).
- **Um proxy esconde o cliente se você não configurar.** Sem
  `UseForwardedHeaders`, redirecionamentos para `https` entram em loop e os logs
  mostram o IP do proxy.
  ```csharp
  app.UseForwardedHeaders(); // tem que vir antes de UseHsts e UseHttpsRedirection
  ```
- **Confiar demais nos forwarded headers é uma brecha de segurança.** Se
  `KnownProxies` ficar no padrão numa rede em que clientes alcançam o app
  direto, qualquer um forja o próprio IP em `X-Forwarded-For`.
- **Limites vivem em várias camadas.** Kestrel, IIS, proxy e load balancer de
  nuvem limitam tamanho de corpo e timeouts; vale o menor, e a camada que falha
  pode não ser a que tem o log.
- **IIS in-process é rápido, mas prende o app ao Windows e ao IIS.** Mudar para
  container significa trocar para Kestrel e rever toda configuração que na
  verdade era do IIS ou do `web.config`.

## Documentation Links

- [Kestrel web server in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [In-process hosting with IIS and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/in-process-hosting) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
