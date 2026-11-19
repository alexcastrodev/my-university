---
version: 1.0
updatedAt: 2026-11-19
title: "Hospedando Servidores MCP Remotos: Functions, Container Apps e Aspire"
summary: Um servidor MCP HTTP em produção medido atrás de nginx em Docker com o SDK C# 2.4.0. Stateless com round robin contra sessões que exigem afinidade (hash do Mcp-Session-Id falha, cookie funciona), buffering e timeout de leitura num stream SSE, imagem chiseled não root, probes de liveness e readiness, desligamento gracioso, AllowedHosts, limite de corpo e rate limiting atrás de proxy, o que um reinício destrói e o AppHost do Aspire. Azure Functions e Container Apps só na documentação, com a tabela de alvos de hospedagem.
---
## Objective

Um servidor MCP remoto é uma aplicação ASP.NET Core comum, então tudo o que machuca um app web em produção machuca este também, com duas diferenças: uma chamada pode transmitir por minutos e (para clientes antigos) uma sessão vive na memória de um único processo. Coloquei um servidor atrás de nginx em Docker, com duas e três réplicas, e medi o que quebra: round robin contra sessões, buffering de resposta e timeout de leitura num stream SSE, desligamento gracioso, `AllowedHosts` atrás de proxy, limite de corpo, um rate limiter por réplica e o que um reinício destrói. Depois rodei o mesmo servidor como duas réplicas num AppHost do Aspire. Azure Functions e Azure Container Apps exigem conta Azure, então foram lidos na documentação e marcados "docs only" (só documentação), terminando numa tabela de alvos de hospedagem. Versões: `ModelContextProtocol.AspNetCore` e `ModelContextProtocol` 2.4.0, `Aspire.AppHost.Sdk` 13.6.4 com `Aspire.Hosting.Orchestration.osx-arm64` 13.6.4, TFM `net10.0`, SDK .NET 10.0.100, runtime do contêiner 10.0.15 (`aspnet:10.0-noble-chiseled`), nginx 1.29.8, Docker em arm64, spec 2026-07-28. `Microsoft.Azure.Functions.Worker.Extensions.Mcp` 1.6.0 foi lido no NuGet, não executado.

## Use Cases

- Pôr um servidor MCP atrás de um balanceador sem quebrar as sessões de clientes antigos.
- Manter viva uma chamada longa de tool através de um proxy que faz buffering ou estoura timeout.
- Entregar o servidor como uma imagem pequena e não root, com probes que Kubernetes ou Container Apps conseguem usar.
- Escolher entre Container Apps, Functions, Kubernetes e uma execução local com Aspire para uma carga MCP.

## Deep Dive

### O laboratório

Um projeto ASP.NET Core (`AddMcpServer().WithHttpTransport(o => o.SessionMode = ...)`) com três tools (`whoami` devolve o nome da réplica, `ticker` envia N notificações de progresso, `silent` dorme), `/health/live`, `/health/ready`, um header de resposta `X-Replica` e configurações lidas de variáveis de ambiente (`SESSION_MODE`, `RATE_LIMIT`, `MAX_BODY`). Ele roda como os contêineres `mcphost-a` e `mcphost-b` (mais `mcphost-c` para as configurações de borda) numa rede Docker privada, atrás do `mcphost-lb` (nginx nas portas 6280 a 6294, um bloco `server` por experimento). Um console de sondagem usa o cliente do SDK (padrão 2026-07-28, ou fixado em `2025-11-25`) e chamadas cruas com `HttpClient`/`curl`. Sessões foram medidas como "20 sessões, cada uma faz `initialize` e 3 chamadas de tool; ok significa que tudo funcionou".

### Stateless escala com round robin

O cliente padrão 2026-07-28 não faz handshake e não envia id de sessão, então qualquer réplica responde qualquer requisição:

```text
negotiated=2026-07-28 session=(none)
call 1: b pid=1      call 2: a pid=1      call 3: b pid=1
call 4: a pid=1      call 5: b pid=1      call 6: a pid=1
```

### Stateful exige afinidade, e o hash do header não entrega

Com `SessionMode.Stateful`, um cliente fixado em `2025-11-25` recebe o `Mcp-Session-Id` da réplica que atendeu o `initialize`. Num round robin simples, uma requisição sim, outra não, cai na réplica que nunca viu a sessão (o `X-Replica` mostra para onde foi):

```text
initialize:   200  X-Replica: a  session=ZmjjwwKmzGJ1m3-lG_XgEw
tools/list 1: 404  X-Replica: b  {"error":{"code":-32001,"message":"Session not found"},"id":2,...}
tools/list 2: 200  X-Replica: a
tools/list 3: 404  X-Replica: b
```

O cliente do SDK normalmente morre dentro de `McpClient.CreateAsync`, porque até o `notifications/initialized` pode errar a réplica (sob o proxy do Aspire: `ClientTransportClosedException: The server returned HTTP 404 for a request with an Mcp-Session-Id, indicating the session has expired.`). A correção óbvia, `hash $http_mcp_session_id consistent;` no `upstream` do nginx, é uma armadilha: o id não existe quando o `initialize` é roteado, e a réplica que o gera não é a réplica que o hash escolhe depois. Resultados com 20 sessões cada:

| roteamento | sessões ok |
| --- | --- |
| round robin | 0 de 20 |
| `hash $http_mcp_session_id consistent` | 10 de 20 e 9 de 20 (cara ou coroa) |
| afinidade por cookie, cliente guarda cookies | 20 de 20 |
| afinidade por cookie, `UseCookies = false` | 0 de 20 |
| `StatefulForInitializeClients`, clientes padrão (2026-07-28), round robin | funciona, alterna a e b |
| `StatefulForInitializeClients`, clientes `initialize`, round robin | 0 de 20 |

O que funciona é afinidade por cookie: o servidor define um cookie com o próprio nome e o nginx o mapeia para um pool.

```csharp
ctx.Response.Headers.Append("Set-Cookie", $"mcp_replica={replica}; Path=/; HttpOnly");   // em toda resposta
```

```nginx
map $cookie_mcp_replica $pool { a pool_a; b pool_b; default rr; }   # cliente desconhecido: round robin
server { listen 6284; location / { proxy_pass http://$pool; } }
```

O nome do cookie importa: minha primeira tentativa usou `mcp-replica` e o nginx continuou roteando por round robin; com `mcp_replica` (underline, que vira `$cookie_mcp_replica` sem ambiguidade) funcionou. Afinidade por cookie também é o que Container Apps e YARP fazem (docs only abaixo), e falha para qualquer cliente que descarta cookies, então a solução de verdade é ficar stateless e usar `StatefulForInitializeClients` só para clientes legados.

### SSE atrás de um proxy: o que atrasa o primeiro evento

`ticker` (5 eventos de progresso, 500 ms entre eles) responde como `text/event-stream`. A resposta do servidor diz o que espera de um proxy:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache,no-store
Content-Encoding: identity
X-Accel-Buffering: no
```

O cliente registra quando cada evento chega (primeiro evento, depois o total):

```text
direto na réplica                                              primeiro 531 ms   último 2534 ms
nginx padrão, upstream HTTP/1.1 (proxy_buffering on)           primeiro 518 ms   último 2515 ms
nginx com proxy_buffering off                                  primeiro 517 ms
nginx upstream 1.0 (o padrão real), header respeitado          primeiro 526 ms
nginx upstream 1.0 + proxy_ignore_headers X-Accel-Buffering    primeiro 2540 ms (uma rajada no fim)
nginx gzip on para text/event-stream, header ignorado          primeiro 2523 ms (uma rajada no fim)
nginx gzip on, header respeitado                               primeiro 520 ms
```

`X-Accel-Buffering: no` e `Content-Encoding: identity` fazem o nginx transmitir sozinho, então a configuração de fábrica funciona. Um proxy que os ignora (outro fornecedor, uma CDN, `proxy_ignore_headers`) faz buffering: o usuário não vê progresso durante a chamada inteira. Mantenha `proxy_buffering off` na location do MCP de qualquer forma e nunca comprima `text/event-stream`. Uma chamada silenciosa é outro problema: `silent 8` com `proxy_read_timeout 3s` terminou em `504 (Gateway Time-out) after 3023 ms`, mas `ticker` com 8 eventos de um segundo pelo mesmo proxy terminou (`done on a after 8021 ms`), porque cada evento reinicia o relógio de leitura. Notificações de progresso funcionam como keepalive.

### Contêiner, probes e desligamento

`dotnet publish -t:PublishContainer` com `<ContainerFamily>noble-chiseled</ContainerFamily>` gerou uma imagem de 188 MB (53,3 MB comprimida) rodando como usuário `1654`, escutando na 8080; a família Ubuntu padrão deu 406 MB, mesmo usuário, com shell e sem `curl` nem `wget`. A imagem chiseled também não tem shell (`docker exec ... /bin/sh` falha), então um `HEALTHCHECK` do Docker que chame um shell não roda; as probes ficam com o orquestrador, por HTTP. Liveness e readiness são endpoints separados, e nenhum deles é o `/mcp`:

```text
ready=200 live=200
POST /admin/downstream/false  ->  ready=503 (Unhealthy)  live=200 (Healthy)  /mcp continua respondendo 200
```

A readiness falha enquanto uma dependência está fora (o orquestrador para de rotear); a liveness responde `200` enquanto o processo roda, então ele não é reiniciado. O nginx de código aberto não tem health check ativo, só passivo (`max_fails`): readiness serve a Kubernetes, Container Apps ou a um proxy que a suporte.

Deploys graduais mandam SIGTERM. Uma chamada de 5 s iniciada 1,5 s antes do `docker stop` terminou normalmente (`docker stop returned after 5163 ms`). Uma chamada de 40 s foi cortada quando os 10 s de graça acabaram (`The response ended prematurely` aos 11,7 s); com `docker stop -t 60` foi cortada do mesmo jeito, aos 31,7 s, porque o host .NET espera só `HostOptions.ShutdownTimeout`, 30 s por padrão. Suba o período de graça da plataforma e o timeout do host juntos, e faça os clientes tentarem de novo (veja a lição de retry). O Container Apps manda SIGTERM e mata após 30 s (docs only).

### Configurações de borda atrás de um proxy

- **Header Host.** A réplica `c` roda com `AllowedHosts=localhost`. O nginx encaminha `Host: c` por padrão (`$proxy_host`) e a requisição falha; com `proxy_set_header Host $host;` passa. `AllowedHosts` também exige que o proxy encaminhe o nome público, e `UseForwardedHeaders` se o app monta URLs absolutas.

```text
proxy_set_header Host $proxy_host  ->  400 Bad Request
proxy_set_header Host $host        ->  200 OK
```

- **Limite de corpo.** Uma requisição MCP com corpo de 1953 KB: direto no Kestrel `200` (o limite padrão é 30 MB); pelo nginx `413 Request Entity Too Large` (`client_max_body_size` padrão é 1 MB); um corpo de 68 KB na réplica `c` (`Limits.MaxRequestBodySize = 65536`) recebeu `413 Payload Too Large` do Kestrel. Dimensione o limite pelos maiores argumentos legítimos de tool, no proxy e no app.
- **Rate limiting.** `AddRateLimiter` com janela fixa de 5 por 10 s, particionado por `X-Api-Key`, rejeitando com 429 e um header `Retry-After` definido no `OnRejected`:

```text
req 5 key=alice -> 200 replica=a Retry-After=-
req 6 key=alice -> 429 replica=a Retry-After=10
req 1 key=bob   -> 200 replica=a          (partição própria)
pelo round robin, key alice, 12 requisições: 200 de 1 a 10 (a, b, a, b ...), 429 em 11 e 12
```

O limiter vive em cada processo, então duas réplicas aceitaram 10 requisições para um limite de 5: limite na borda (`limit_req` do nginx, um API gateway) ou com um armazenamento compartilhado quando o número precisa ser exato. O `Retry-After` trouxe o tamanho da janela (10), não o tempo que faltava nela.

- **TLS** termina no nginx, no ingress ou no balanceador; o servidor MCP e o laboratório falaram HTTP puro (docs only). A lição de segurança cobre `Origin`, tokens e DNS rebinding.

### Reinício e escala a zero

Um cliente com sessão `initialize` na réplica `a`, depois `docker restart mcphost-a`, depois `tools/list` pela afinidade por cookie: `404` com `{"code":-32001,"message":"Session not found"}`. A tabela de sessões vivia na memória do processo, e o mesmo vale para qualquer outra coisa que você guarde ali (estado de tasks da extensão de tasks, assinaturas, caches). Um cliente stateless 2026-07-28 pelo round robin continuou funcionando durante o reinício (`a pid=1`, depois `b pid=1`). Escalar a zero é um reinício com atraso, então guarde estado durável fora do processo e, para hosts interativos, mantenha no mínimo uma réplica.

### AppHost do Aspire para orquestração local

Um AppHost sobe as réplicas como processos comuns, sem Docker, e entrega o endereço ao cliente (a lição de AppHost cobre service discovery e o dashboard):

```csharp
var mcp = builder.AddProject<Projects.McpHost_Server>("mcp")
    .WithHttpEndpoint(port: 6295, name: "http")     // proxy do AppHost; as réplicas ganham portas dinâmicas
    .WithReplicas(2)
    .WithHttpHealthCheck("/health/ready")           // readiness, não /mcp
    .WithEnvironment("SESSION_MODE", mode);
builder.AddProject<Projects.McpHost_Probe>("client").WithReference(mcp).WaitFor(mcp);
```

O cliente leu `services__mcp__http__0` (`http://localhost:6295`), e o proxy do DCP escutou na 6295 com réplicas em duas portas escolhidas pelo Aspire (27673, 27674). Seis chamadas de um único `HttpClient` voltaram todas com o mesmo pid: o proxy provavelmente balanceia por conexão, então um cliente keep-alive único gruda numa réplica (stateful por acidente). Com `SessionMode=Stateful`, o cliente `initialize` falhou com o 404 acima. Não confie numa execução local para revelar bugs de afinidade: teste por um balanceador por requisição, como o laboratório com nginx. Existe um inspector pronto para ligar ao AppHost no Community Toolkit (`CommunityToolkit.Aspire.Hosting.McpInspector`, prerelease, não executado).

### Azure Functions (docs only)

Dois caminhos: a extensão MCP (`Microsoft.Azure.Functions.Worker.Extensions.Mcp`, 1.6.0 no NuGet, só worker isolado) ou um servidor próprio construído com o SDK (self-hosted). A extensão liga um trigger a uma tool, com endpoint `/runtime/webhooks/mcp`, e no Azure exige a system key `mcp_extension` em `x-functions-key` (ou `webhookAuthorizationLevel: Anonymous` mais autorização embutida):

```csharp
[Function(nameof(SayHello))]
public string SayHello([McpToolTrigger("hello", "Says hello")] ToolInvocationContext context) => "Hello I am MCP Tool!";
```

O transporte SSE dela (`/runtime/webhooks/mcp/sse`) usa Queue storage e as versões novas do protocolo o consideram depreciado. O modo self-hosted (preview público) roda o seu servidor como custom handler (`"configurationProfile": "mcp-custom-handler"`), só com Streamable HTTP stateless, só no Flex Consumption e sem depuração por F5 (use `func start`). Funções com trigger HTTP são cortadas em 230 s independentemente do timeout da função (idle timeout do Azure Load Balancer), então chamadas longas precisam de notificações de progresso ou da extensão de tasks.

### Azure Container Apps (docs only)

O Container Apps não conhece MCP: oferece ingress HTTPS com TLS 1.2 ou 1.3, autoscaling inclusive a zero, CORS e autenticação opcional com Entra ID a um contêiner que escuta numa porta alvo (transporte `auto` ou `http`). Limites da documentação: timeout de requisição do ingress de 240 s; afinidade de sessão por cookie, só no modo de revisão única com ingress HTTP; a escala a zero espera 300 s de cool down por padrão; SIGTERM e depois SIGKILL após 30 s; a Microsoft recomenda no mínimo 1 réplica para uso interativo de MCP por causa do cold start. Dynamic sessions são um servidor MCP separado, gerenciado pela plataforma, para execução de código em sandbox (spec 2025-03-26, header de chave de API `x-ms-apikey`, preview).

### Alvos de hospedagem

| alvo | stateless | stateful (`Mcp-Session-Id`) | chamadas longas e streaming | formato do custo | limites para projetar em volta |
| --- | --- | --- | --- | --- | --- |
| Container Apps (docs only) | sim, escala livre | sticky sessions por cookie, revisão única | timeout de 240 s, SSE ok | vCPU e GiB por segundo, zero quando escalado a zero | cold start, SIGTERM de 30 s |
| Extensão MCP do Functions (docs only) | sim, por invocação | a doc indica a extensão para servidores stateful; SSE exige Queue storage | limite HTTP de 230 s | por execução (Flex: mais always ready) | function key ou autenticação embutida |
| Functions self-hosted (docs only) | sim, único modo | não | limite HTTP de 230 s | só Flex Consumption | preview, sem F5 |
| Kubernetes ou VM (laboratório nginx) | sim, round robin | afinidade por cookie, 20 de 20 | o que o proxy permitir | nós que você mantém | buffering, `proxy_read_timeout`, SIGTERM e `ShutdownTimeout` |
| Aspire local | por conexão | stickiness acidental | nenhuma | grátis, só desenvolvimento | não testa o balanceamento de produção |

## Trade-offs

- **Stateless vs sessões.** Stateless dispensa afinidade e sobrevive a reinícios, mas desliga sampling, elicitation e mensagens não solicitadas do servidor nesse modo; `StatefulForInitializeClients` mantém clientes antigos funcionando enquanto os clientes 2026-07-28 ficam stateless.
- **Afinidade por cookie vs correção.** Ela leva a sessão para casa, mas a perde em reinício, scale-in e clientes sem cookies; aceite isso e faça os clientes reiniciarem a sessão num `404`.
- **Chiseled vs depurável.** 188 MB sem shell contra 406 MB com um; depure com um contêiner de depuração efêmero, não adicionando um shell à imagem.
- **Rate limit por processo vs exatidão.** Em memória é uma linha e aproximado (10 para um limite de 5 em duas réplicas); limites exatos pedem um armazenamento compartilhado ou um limitador na borda.
- **Functions vs Container Apps.** Functions cobra por chamada e serve a tools curtas e stateless; um contêiner mantém o SDK inteiro, chamadas longas e seu próprio middleware.

## Documentation Links

- [Host MCP servers on Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/mcp-overview) (doc)
- [Choosing an Azure service for your MCP server, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/mcp-choosing-azure-service) (doc)
- [Deploy an MCP server to Container Apps (.NET), Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-mcp-server-dotnet) (doc)
- [Ingress in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview) (doc)
- [Session affinity in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions) (doc)
- [Set scaling rules in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) (doc)
- [Application lifecycle management in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management) (doc)
- [MCP bindings for Azure Functions overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp) (doc)
- [Self-hosted remote MCP server on Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/self-hosted-mcp-servers) (doc)
- [Azure Functions scale and hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale) (doc)
- [Azure Functions MCP extension, GitHub](https://github.com/Azure/azure-functions-mcp-extension) (doc)
- [remote-mcp-functions-dotnet sample, GitHub](https://github.com/Azure-Samples/remote-mcp-functions-dotnet) (doc)
- [Streamable HTTP transport 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (doc)
- [Transports guide of the C# SDK 2.4.0, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/transports/transports.md) (doc)
- [ngx_http_proxy_module (proxy_buffering, X-Accel-Buffering), nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) (doc)
- [ngx_http_upstream_module (hash), nginx](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) (doc)
- [Session affinity, YARP](https://microsoft.github.io/reverse-proxy/articles/session-affinity.html) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [Rate limiting middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit) (doc)
- [Kestrel server options, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options) (doc)
- [.NET Generic Host (ShutdownTimeout), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host) (doc)
- [Aspire documentation, aspire.dev](https://aspire.dev/) (doc)
