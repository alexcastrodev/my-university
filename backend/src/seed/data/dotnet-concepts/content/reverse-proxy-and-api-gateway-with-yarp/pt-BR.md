---
version: 1.0
updatedAt: 2026-11-12
title: "Reverse proxy e API gateway com YARP"
summary: Um gateway YARP na frente de dois Kestrel reais, medido de ponta a ponta, com rotas e clusters, transforms, seis políticas de balanceamento, health checks passivo e ativo, rate limit e autenticação na borda, timeouts, hot reload, a diferença para um BFF e YARP contra gateway gerenciado, Ocelot e Envoy.
---
## Objective

Um reverse proxy recebe requisições de clientes e as encaminha para servidores que eles nunca veem. Um API gateway é um reverse proxy que também cuida das regras transversais da borda: qual caminho vai para qual serviço, quem pode chamar, com que frequência e o que acontece quando um backend cai. O YARP (Yet Another Reverse Proxy) é a biblioteca da Microsoft para construir um desses sobre o ASP.NET Core. Não é um servidor que você instala: é um pacote NuGet, algumas linhas no `Program.cs` e um modelo de configuração de rotas e clusters, então todo o resto do seu pipeline (autenticação, rate limiting, logs, `appsettings.json`) funciona como já funciona. Este concept monta um gateway pequeno e mede o que ele faz com dois backends Kestrel reais em portas locais livres: reescrita de caminho e transforms, seis políticas de balanceamento, health checks passivo e ativo, rate limit e autenticação na borda, timeouts e hot reload da configuração. Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 e `Yarp.ReverseProxy` 2.3.0 (o target framework mais novo dele é net8.0, e rodou sem mudanças no .NET 10).

## Use Cases

- Colocar um único endereço público na frente de vários serviços, com `/orders/*` indo para um cluster e `/billing/*` para outro.
- Manter as regras transversais da borda (autenticação, rate limit, CORS) num lugar só, em vez de repeti-las em cada serviço.
- Distribuir carga entre instâncias e tirar de circulação as que falham, sem um produto de load balancer à parte.
- Migrar um monolito para serviços uma rota por vez: o gateway manda um prefixo para o serviço novo e todo o resto para o app antigo.
- Dar a um front end Blazor ou SPA uma única origem para as chamadas de API.

## Deep Dive

### Rotas e clusters

O modelo tem duas partes. Uma rota diz quais requisições casam (caminho, host, métodos, headers) e qual cluster as recebe. Um cluster é um conjunto de destinos (endereços) mais as políticas para escolher entre eles e checar a saúde deles. O mesmo modelo é lido do `appsettings.json` (`LoadFromConfig`) ou montado em código (`LoadFromMemory`, que o lab usa para os testes injetarem portas dinâmicas):

```csharp
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
app.MapReverseProxy();
```

```json
{
  "ReverseProxy": {
    "Routes": {
      "api": {
        "ClusterId": "backends",
        "Match": { "Path": "/api/{**catch-all}" },
        "Transforms": [ { "PathRemovePrefix": "/api" } ]
      }
    },
    "Clusters": {
      "backends": {
        "Destinations": { "a": { "Address": "http://orders-1:8080/" }, "b": { "Address": "http://orders-2:8080/" } }
      }
    }
  }
}
```

`MapReverseProxy` adiciona endpoints comuns, então roteamento, `UseAuthentication`, `UseAuthorization`, `UseRateLimiter` e `UseCors` valem para requisições proxiadas do mesmo jeito que valem para qualquer endpoint. Uma requisição que não casa com nenhuma rota recebe um 404 simples do próprio gateway.

### O que o backend enxerga: transforms

Coloquei um gateway na frente de um backend que devolve o que recebe e chamei `/api/hello?x=1`:

```text
A path=/hello?x=1 host=127.0.0.1:51685 xff=127.0.0.1 xfproto=http xfhost=127.0.0.1:51686 by=gateway
```

O gateway escutava na porta 51686 e o backend na 51685. Aconteceram quatro coisas. O `PathRemovePrefix` transformou `/api/hello` em `/hello`. A query string passou. O header `Host` virou o host do destino, não o do gateway: esse é o padrão. E o YARP acrescentou sozinho `X-Forwarded-For`, `X-Forwarded-Proto` e `X-Forwarded-Host`. O meu transform `RequestHeader` (`"RequestHeader": "X-Forwarded-By", "Set": "gateway"`) acrescentou o último.

Outros transforms que rodei no mesmo gateway:

```text
/v1/orders/42?a=b com PathPattern "/internal/orders/{id}/detail" e QueryValueParameter source=gw
A path=/internal/orders/42/detail?a=b&source=gw ...
/host/hi com RequestHeaderOriginalHost = true
A path=/hi host=127.0.0.1:51686 ...                (o host do próprio gateway, não o do backend)
/nofwd/hi com "X-Forwarded": "Off"
A path=/hi host=127.0.0.1:51685 xff= xfproto= xfhost=
```

Mantenha o `Host` padrão, a menos que o backend precise do nome público (por exemplo, para montar links absolutos): um backend que roteia por `Host` e recebe o errado é um bug clássico de proxy. Se o backend é um app ASP.NET Core e precisa ver o IP e o esquema reais do cliente, ele tem de confiar nos headers `X-Forwarded-*` de forma explícita (`UseForwardedHeaders` com proxies conhecidos), que é o mesmo trade-off descrito no concept de rate limiting.

### Balanceamento de carga

Um cluster com vários destinos escolhe um por requisição conforme `LoadBalancingPolicy`. Fiz o backend A responder na hora e o B levar 150 ms, e mandei 60 requisições, 12 por vez, por cada política:

```text
PowerOfTwoChoices  A=52 B=8     (o padrão)
RoundRobin         A=30 B=30
Random             A=31 B=29
LeastRequests      A=53 B=7
FirstAlphabetical  A=60 B=0
```

`RoundRobin` e `Random` ignoram quão carregado está o backend, então o lento recebeu metade do tráfego. `PowerOfTwoChoices` (o padrão) e `LeastRequests` olham o número de requisições em andamento e empurraram a maior parte do trabalho para o backend rápido. `FirstAlphabetical` sempre escolhe o primeiro destino: é uma ordem de failover, não um balanceador. Também existe afinidade de sessão (um cookie ou header que fixa um cliente em um destino); não testei, então confira a documentação antes de depender dela.

### Health checks passivos

O check passivo observa o tráfego real. Com `HealthCheck.Passive` ligado e a política `TransportFailureRate`, o YARP marca um destino como não saudável quando requisições demais para ele falham no nível de transporte. Parei o backend B e mandei 30 requisições seguidas por um cluster round-robin:

```text
502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 200 200 200 200 200 200 200 200 200 200
```

Dez requisições foram para o B e falharam com 502, depois o B saiu de circulação. O ponto é o preço: um check passivo aprende com falhas, então alguns clientes reais recebem erro antes de ele reagir, e o YARP não repete sozinho a requisição que falhou em outro destino. A política só começa a julgar um destino depois de `MinimalTotalCountThreshold` requisições (10 por padrão, segundo a documentação) e usa um limite de 30% de falhas, o que combina com as 10 falhas que vi. A documentação diz que um destino volta a `Unknown` e recebe tráfego de novo depois de `ReactivationPeriod`. Configurei 5 s, esperei 8 s e mandei mais 24 requisições: nenhuma foi para o B e nenhuma falhou. Não descobri o motivo, então não planeje em cima do instante exato da recuperação.

### Health checks ativos

O check ativo sonda cada destino num timer, independente do tráfego dos clientes. Liguei com intervalo e timeout de 1 s, `ConsecutiveFailures` e o caminho `/health`, e fiz o `/health` do B devolver 503 enquanto o B continuava respondendo requisições normais com 200:

```text
B fora de circulação depois de 1.0 s
B de volta depois de 1.0 s   (depois que /health voltou a devolver 200)
```

É o check para um destino que está de pé, mas não está apto a atender (aquecendo, perdeu o banco). Custa uma sonda por destino por intervalo e exige um endpoint `/health` no backend (veja o concept de health checks para liveness versus readiness). Use os dois juntos: a sonda ativa pega a instância antes dos clientes, a passiva reage dentro do intervalo da sonda.

Um comportamento para conhecer. Tirei todos os destinos de um cluster pelo check ativo (o `/health` do A devolvia 503) e chamei a rota:

```text
status 200, body length 101
```

A requisição foi proxiada mesmo assim. Na minha execução, quando nenhum destino está saudável o YARP continua mandando tráfego para o cluster em vez de falhar a requisição, então "todos não saudáveis" não vira um 503 no gateway. Se você quer falha rápida, precisa acrescentá-la você mesmo.

### Timeouts e erros

Chamei um endpoint do backend que leva 3 s:

```text
Cluster HttpRequest.ActivityTimeout 1 s: 504 após 1038 ms
Route Timeout 1 s sem UseRequestTimeouts(): 500, InvalidOperationException
Route Timeout 1 s com UseRequestTimeouts():   400 após 1002 ms
destino recusa a conexão:                     502
```

`HttpRequest.ActivityTimeout` no cluster (quanto tempo uma requisição pode ficar ociosa) foi o que deu o 504 Gateway Timeout limpo. O `Timeout` no nível da rota exige `AddRequestTimeouts` e `UseRequestTimeouts` no pipeline: sem eles a requisição falhou com uma exceção que nomeia a chamada que falta, e com eles o cliente recebeu 400 nesta versão, que não é o que você quer expor. Um destino que não está escutando dá 502 Bad Gateway. Trate 502 e 504 como o vocabulário do próprio gateway e teste o que seus clientes veem.

### Rate limiting e autenticação na borda

Os dois são os recursos do ASP.NET Core que você já conhece, ligados por nome em cada rota. No lab, a rota `limited` tem `RateLimiterPolicy = "per-client"` (janela fixa de 2 requisições por 30 s, particionada pelo header `X-Client-Id`) e a rota `admin` tem `AuthorizationPolicy = "apikey"` com um handler pequeno de API key. Os testes enviam:

```text
c1: 200, 200, 429     c2: 200                       (rate limit por cliente)
/admin sem chave: 401   chave errada: 401   chave certa: 200
```

O rate limiter e o middleware de autorização rodam antes de o proxy encaminhar qualquer coisa, então uma requisição rejeitada nunca chega a um backend. Três cuidados. O limiter é por instância do gateway, como explica o concept de rate limiting, então dois gateways dão o dobro da cota. A chave de partição aqui é um header enviado pelo cliente e um atacante pode inventar chaves ilimitadas; use uma identidade autenticada ou o IP do cliente atrás de um proxy confiável. E a autenticação na borda só protege os backends se eles não forem acessíveis diretamente: a rede, ou TLS mútuo entre gateway e serviços, é que precisa garantir isso. Por padrão o header `Authorization` é encaminhado ao backend, então um serviço pode validar o token de novo (defesa em profundidade) ao custo de validá-lo duas vezes.

### Recarga da configuração

As rotas são ligadas ao `IConfiguration`, então um arquivo com `reloadOnChange` atualiza o gateway enquanto ele roda. Acrescentei uma rota ao JSON de um gateway em execução:

```text
/more antes: 404
/more depois da edição: 200 em 333 ms, sem reiniciar
```

Rotas e destinos também podem vir de um provider próprio (por exemplo, um service registry ou um banco) implementando `IProxyConfigProvider`; não rodei esse caminho.

### Gateway não é BFF

Um gateway roteia muitos clientes para muitos serviços. Um BFF (backend for frontend) pertence a um front end só: guarda o cookie de sessão e os tokens do usuário no servidor e chama as APIs em nome dele, como no concept de OIDC e BFF. Eles se sobrepõem num ponto, o encaminhamento, e o YARP oferece o `IHttpForwarder` para código que decide por requisição para onde mandar:

```csharp
app.Map("/bff/{**rest}", (HttpContext ctx, IHttpForwarder forwarder) =>
    forwarder.SendAsync(ctx, "http://orders:8080/", invoker, new ForwarderRequestConfig(), transformer).AsTask());
```

Rodei um forwarder assim e o backend recebeu a requisição. Note que o forwarder só faz o que você configura: com um transformer vazio nenhum dos headers `X-Forwarded-*` foi acrescentado, ao contrário das rotas configuradas acima.

### YARP contra gateway gerenciado, Ocelot e Envoy

Esta parte vem da documentação e de conhecimento geral, não das minhas execuções. Um gateway gerenciado (Azure API Management, Azure Front Door ou Application Gateway, AWS API Gateway, um ingress de Kubernetes) dá um plano de controle hospedado, terminação de TLS, portal de desenvolvedores, API keys e cotas, com a operação feita por outra pessoa; você paga por chamada ou por unidade e aceita o modelo de configuração dele. O YARP dá uma biblioteca na sua própria linguagem: qualquer lógica são algumas linhas de C# (balanceamento próprio, um transform que lê uma claim), roda onde os seus outros serviços .NET rodam e é testado com `WebApplicationFactory` como no lab. O custo é que você cuida de deploy, escala, certificados e observabilidade. O Ocelot é outra biblioteca de gateway para .NET, configurada num espírito parecido; não comparei quão ativamente cada um é mantido. O Envoy (e as service meshes construídas sobre ele) é um proxy separado, não .NET, normalmente escolhido para plataformas poliglotas e throughput muito alto. Uma divisão comum é um ponto de entrada gerenciado ou baseado em Envoy para a internet e o YARP para o roteamento que conhece a aplicação dentro de um produto.

## Trade-offs

- **Um gateway é mais um salto e mais uma coisa que pode falhar.** Ele soma latência e é um ponto único de falha; rode pelo menos duas instâncias e mantenha a lógica dele pequena.
- **Checks passivos custam requisições reais.** Medido: 10 das primeiras requisições falharam com 502 antes de o destino sair de circulação, e nada as repetiu. Acrescente o check ativo para que a maioria das falhas seja achada por uma sonda.
  ```json
  "HealthCheck": { "Passive": { "Enabled": true, "Policy": "TransportFailureRate" },
                   "Active": { "Enabled": true, "Interval": "00:00:05", "Timeout": "00:00:02", "Path": "/health" } }
  ```
- **"Todos os destinos não saudáveis" não é um erro.** Na minha execução o tráfego continuou chegando ao cluster; decida se você quer um 503 rápido e implemente.
- **Escolha a política de balanceamento de propósito.** Com um backend lento, `RoundRobin` mandou metade do tráfego para ele e `LeastRequests` mandou 7 de 60.
- **A configuração certa de timeout importa.** `ActivityTimeout` produziu um 504; o `Timeout` da rota sem o middleware lançou exceção e, com ele, devolveu 400.
- **Autenticação na borda não protege um backend acessível diretamente.** Isole a rede ou use TLS mútuo.
- **Limites na borda são por instância e dependem da chave que você escolhe.** Uma chave enviada pelo cliente não é um limite.
- **Mantenha regra de negócio fora do gateway.** Roteamento, autenticação e limites pertencem a ele; agregar dados de vários serviços o transforma num monolito escondido, e para isso um BFF ou uma API dedicada é o lugar melhor.
- **Deriva de configuração é real.** O hot reload é conveniente e também significa que uma edição errada entra no ar em cerca de um terço de segundo; valide o arquivo no CI e revise as mudanças como código.

## Documentation Links

- [YARP documentation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/yarp-overview?view=aspnetcore-10.0) (doc)
- [YARP configuration files](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/config-files?view=aspnetcore-10.0) (doc)
- [YARP request and response transforms](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/transforms?view=aspnetcore-10.0) (doc)
- [YARP load balancing](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/load-balancing?view=aspnetcore-10.0) (doc)
- [YARP destination health checks](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/dests-health-checks?view=aspnetcore-10.0) (doc)
- [YARP rate limiting](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/rate-limiting?view=aspnetcore-10.0) (doc)
- [YARP authentication and authorization](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/authn-authz?view=aspnetcore-10.0) (doc)
- [YARP direct forwarding](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/direct-forwarding?view=aspnetcore-10.0) (doc)
- [dotnet/yarp, GitHub](https://github.com/dotnet/yarp) (doc)
