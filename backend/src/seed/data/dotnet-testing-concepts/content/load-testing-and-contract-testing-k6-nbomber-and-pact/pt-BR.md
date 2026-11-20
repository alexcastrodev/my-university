---
version: 1.0
updatedAt: 2026-11-20
title: "Teste de carga e teste de contrato com k6, NBomber e Pact"
summary: Escreva testes de carga com NBomber e k6 (modelo aberto contra fechado, coordinated omission, aquecimento do JIT, percentis, thresholds) e testes de contrato com Pact (arquivo pact, PactVerifier, provider states, quebra real, Pact Broker e can-i-deploy), com os números medidos em net10.0.
---
## Objective

O [WebApplicationFactory](/dotnet-testing-concepts/integration-testing-with-webapplicationfactory) prova que uma API se comporta; não prova que ela aguenta carga, nem que o cliente do outro lado ainda entende as respostas. Dois tipos de teste cobrem essas lacunas. O teste de carga (NBomber em C#, k6 em um arquivo JavaScript) manda tráfego por um socket real e reporta percentis de latência, vazão e erros. O teste de contrato (Pact) grava num arquivo o que o consumidor precisa do provider e o reproduz contra o provider de verdade. Os dois são fáceis de errar de um jeito que parece certo: um teste de carga que esconde as piores latências e um teste de contrato que nunca falha quando a API muda. O objetivo: escrever cada um, quebrar o sistema de propósito e ver o número ou a mensagem que diz a verdade. Todo resultado abaixo foi medido em um Apple M4 Max (14 núcleos, 36 GB, macOS 27.2.1, Docker Desktop 29.9.2).

Versões: SDK 10.0.100, `net10.0`, `NBomber` 6.7.1, `PactNet` 5.0.1 (biblioteca nativa `libpact_ffi` dentro do pacote), `MSTest.Sdk` 4.5.3 sobre Microsoft.Testing.Platform, `Microsoft.AspNetCore.Mvc.Testing` 10.0.14, `Microsoft.AspNetCore.OpenApi` 10.0.14, imagens `grafana/k6:2.4.0`, `pactfoundation/pact-broker` e `pactfoundation/pact-cli` (latest em 2026-11-20). O .NET 11 não estava instalado: nada aqui rodou nele.

## Use Cases

- Descobrir quantas requisições por segundo um endpoint aguenta e qual percentil estoura um limite, antes de um release.
- Reprovar um pipeline quando o p95 ou a taxa de erro passa de um limite.
- Deixar o time do provider renomear um campo e descobrir no próprio build que um consumidor o lê, e deixar o consumidor publicar o que usa.
- Escolher qual teste escrever para cada pergunta: a tabela perto do fim.

## Deep Dive

### O sistema sob teste

Uma Minimal API com três rotas: `GET /products/{id}` (sem I/O), `GET /quote` (pega um `SemaphoreSlim(1)` e gasta 5 ms de trabalho dentro dele) e `POST /stall?ms=3000`, que faz uma tarefa em segundo plano segurar o mesmo lock, como um job de manutenção ou um failover. Rodou como build Release publicado no Kestrel, `http://127.0.0.1:6940`. Só os experimentos citam outro host.

### NBomber: cenário e simulação de carga

Um cenário é uma função que o NBomber chama a cada iteração; `Step.Run` mede uma unidade de trabalho e dá nome a ela no relatório. A simulação de carga decide quem chama a função e com que frequência:

```csharp
var closed = Scenario.Create("closed", async ctx =>
        await Step.Run("get-product", ctx, async () =>
        {
            var r = await http.GetAsync("/products/1");
            return r.IsSuccessStatusCode ? Response.Ok(statusCode: "200") : Response.Fail(statusCode: ((int)r.StatusCode).ToString());
        }))
    .WithLoadSimulations(Simulation.KeepConstant(copies: 8, during: TimeSpan.FromSeconds(10)));

// modelo aberto: mesmo corpo, .WithLoadSimulations(Simulation.Inject(rate: 80, interval: TimeSpan.FromSeconds(1), during: TimeSpan.FromSeconds(20)))
NBomberRunner.RegisterScenarios(closed).Run();
```

`KeepConstant` é o modelo fechado: 8 cópias, cada uma começa a próxima iteração quando a anterior volta. `Inject` é o modelo aberto: 80 iterações novas por segundo, tenham as anteriores terminado ou não. `RampingInject` e `RampingConstant` levam a taxa ou as cópias do valor atual até um alvo ao longo de uma duração. Uma execução com `RampingInject(100/s, 5 s)`, `Inject(100/s, 5 s)`, `RampingInject(0/s, 3 s)` fez 900 requisições em 13 s (69/s em média). `WithoutWarmUp()` está em todas as execuções daqui; por padrão o NBomber aquece por 30 segundos e deixa isso fora do relatório (veja a seção de aquecimento).

### Teste de carga em memória mede a coisa errada

O mesmo cenário fechado, 8 cópias por 10 s, `GET /products/1`, três execuções de cada:

| Alvo | Requisições por segundo | p50 | p99 |
| --- | --- | --- | --- |
| Kestrel em 127.0.0.1 (processo separado) | 55.069, 55.115, 55.195 | 0,13 ms | 0,20 ms |
| `WebApplicationFactory` (`TestServer`, mesmo processo) | 226.385 a 242.293 | 0,01 ms | 0,79 a 0,81 ms |

O cliente em memória foi cerca de 4 vezes mais rápido e 13 vezes menor no p50, porque não há socket, nem parsing de HTTP, nem pilha TCP, e o gerador de carga e o servidor dividem um processo e o mesmo thread pool. Esses números descrevem o código de um handler, não uma API. Use o `WebApplicationFactory` para correção; use um Kestrel real (build publicado, ou `factory.UseKestrel(porta)` desde o .NET 10) para carga, e de preferência em outra máquina.

### Relatórios

`WithReportFormats(ReportFormat.Txt, Csv, Html, Md)` grava um arquivo por formato em `reports/<pasta>`: o `.csv` tem uma linha por cenário e por step (`ok_latency_50`, `_75`, `_95`, `_99`, contagens), e o `.html` é uma página autocontida de 470 KB com gráficos. `WithReportingInterval` tem mínimo de 5 segundos ("ReportingInterval should be bigger than min value: '5'"), então não há janelas por segundo. O `.md` da execução aberta:

```text
|requests|total = `1600`, ok = `1600`, fail = `0`|
|latency (ms)|min = `5.13`, mean = `461.21`, max = `2862.39`, StdDev = `831.83`|
|latency percentile (ms)|p50 = `14.04`, p75 = `335.62`, p95 = `2367.49`, p99 = `2834.43`|
```

### Thresholds: o build não falha sozinho

`WithThresholds` anexa regras de aprovação ao cenário (as duas do trecho abaixo). Com `Percent95 < 5` em `/quote` (aberto, 80/s, 10 s, sem stall), o NBomber rodou até o fim e `Run()` voltou normalmente. O código de saída do processo foi 0. A regra que falhou está em `NodeStats.Thresholds` (`IsFailed`), então o pipeline precisa conferir:

```csharp
// scenario.WithThresholds(Threshold.Create(s => s.Fail.Request.Percent < 1), Threshold.Create(s => s.Ok.Latency.Percent95 < 150))
var stats = NBomberRunner.RegisterScenarios(scenario).Run();
Environment.ExitCode = stats.Thresholds.Any(t => t.IsFailed) ? 1 : 0;
```

A documentação do NBomber mostra asserts com xUnit ou NUnit sobre as estatísticas retornadas, o que cabe num teste MSTest com `Assert.IsLessThan`. Um threshold que nunca chega ao código de saída é um pipeline verde com um relatório vermelho.

### k6 em um container descartável

O k6 é um binário em Go que roda JavaScript. Não estava instalado aqui: o script roda em `grafana/k6:2.4.0` (`k6 v2.4.0`), removido ao terminar, alcançando a API do host por `host.docker.internal`:

```javascript
// docker run --rm --name my-k6 -e BASE_URL=http://host.docker.internal:6940 -v "$PWD/k6:/scripts:ro" grafana/k6:2.4.0 run -q /scripts/stages.js
export const options = {
  stages: [{ duration: '5s', target: 20 }, { duration: '10s', target: 20 }, { duration: '3s', target: 0 }],
  thresholds: { http_req_duration: ['p(95)<50'], http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] },
};
export default function () {
  const res = http.get(`${__ENV.BASE_URL}/products/1`);
  check(res, { 'status is 200': (r) => r.status === 200, 'has the name': (r) => r.json('name') === 'Keyboard' });
  sleep(0.1);
}
```

`stages` é um modelo fechado (usuários virtuais sobem de 0 a 20, seguram e descem). O resumo:

```text
  █ THRESHOLDS
    checks ✓ 'rate>0.99' rate=100.00%   http_req_failed ✓ 'rate<0.01' rate=0.00%
    http_req_duration ✓ 'p(95)<50' p(95)=2.46ms
    http_req_duration: avg=1.25ms min=241.62µs med=1.17ms max=4ms p(90)=2.17ms p(95)=2.46ms
```

Trocando o threshold para `p(95)<1`, saiu `✗ 'p(95)<1' p(95)=2.34ms`, `level=error msg="thresholds on metrics 'http_req_duration' have been crossed"` e código de saída 99: o k6, ao contrário do NBomber, derruba o processo. A mediana de 1,17 ms para o mesmo `/products/1` que o NBomber viu em 0,13 ms não é um servidor mais rápido ou mais lento: o k6 chegou a ele de uma VM do Docker pelo gateway do host, o NBomber por loopback. Um número pertence ao seu ponto de observação.

### Coordinated omission: o lock que esconde a pior latência

`/quote` serializa atrás de um lock. Em t = 8 s o teste chama `/stall?ms=3000`, então todo `/quote` espera até 3 s. Dois geradores de carga, ambos com cerca de 80 requisições por segundo nominais, 20 s. No k6 o fechado é `{ executor: 'constant-vus', vus: 8 }` com `sleep(0.1)`, e o aberto é `{ executor: 'constant-arrival-rate', rate: 80, timeUnit: '1s', preAllocatedVUs: 300, maxVUs: 500 }`; no NBomber, `KeepConstant(8, ...)` com 100 ms de delay contra `Inject(80, 1 s, ...)`:

| Ferramenta e modelo | Requisições | p50 | p95 | p99 | máx | média |
| --- | --- | --- | --- | --- | --- | --- |
| NBomber `KeepConstant` 8 + 100 ms de delay | 1.237 | 6,42 ms | 8,82 ms | 9,49 ms | 3.005 ms | 26 ms |
| NBomber `Inject` 80/s | 1.600 | 14,04 ms | 2.367 ms | 2.834 ms | 2.862 ms | 461 ms |
| k6 `constant-vus` 8 + `sleep(0.1)` | 1.256 | 7,18 ms | 12,23 ms | 20,93 ms | 2,98 s | 26,74 ms |
| k6 `constant-arrival-rate` 80/s | 1.601 | 7,0 ms | 2,49 s | 2,9 s | 3 s | 448,7 ms |

Mesmo servidor, mesmo stall, p99 de 9,5 ms contra 2.834 ms. No modelo fechado só os 8 workers ficaram presos: 8 amostras lentas entre 1.237, então o p99 continuou saudável e só o máximo (3.005 ms) denuncia. O teste também mandou menos requisições (61,9/s, contra cerca de 75/s sem stall), porque um gerador parado deixa de gerar. No modelo aberto, 80 requisições por segundo continuaram chegando por 3 s, cerca de 240 esperaram, e a fila demorou a esvaziar: o p75 já era 336 ms. Uma população real de usuários se comporta como o segundo: as pessoas não param de clicar porque o servidor está ocupado. Um gerador de laço fechado esconde a fila; isso é coordinated omission, nome dado por Gil Tene.

A regra: para um endpoint público, ou clientes independentes, use o modelo aberto (`Inject`, `constant-arrival-rate`). Use o fechado para uma sessão com concorrência fixa (um pool de conexões, uma frota de workers) e leia o máximo. No modelo aberto do k6, dê VUs suficientes: com `preAllocatedVUs: 50`, a execução com stall reportou `dropped_iterations: 96` (6 por cento das chegadas nunca começaram) e um p95 mais gentil de 2,19 s. Um teste que descarta a própria carga volta a ser fechado sem avisar.

### Aquecimento, a máquina e o que um percentil diz

- **JIT.** Medindo 2.000 requisições sequenciais a uma API recém-iniciada: a primeira levou 57,2 ms (56,6, 57,3 e 57,2 em três execuções), a segunda 1,1 ms, depois cerca de 0,2 ms, e a mediana do restante foi 0,08 ms. Uma execução de 10 s do NBomber em servidor frio teve máximo de 54,3 e 55,8 ms; com `WithWarmUpDuration(TimeSpan.FromSeconds(5))` o máximo foi 2,7 e 3,6 ms, e a média (0,14 ms) e o p99 (0,2 ms) não se mexeram. Aqueça para que as primeiras requisições não virem o máximo; o relatório as exclui.
- **Mesma máquina.** Durante a execução fechada, o `ps` mostrou a API em cerca de 534 por cento de CPU e o gerador de carga em cerca de 512 por cento, em 14 núcleos. Eles disputam núcleos, caches e a pilha de loopback, então a vazão é o teto do par, não da API. O NBomber também avisa `Server GC mode is not enabled` (`<ServerGarbageCollection>`); aqui, ligar isso levou de 55,1 a 55,3 mil para 56,0 a 56,3 mil requisições por segundo, cerca de 2 por cento. Ponha o gerador em outra máquina e observe a CPU dele.
- **Percentis.** Na execução aberta a média foi 461 ms, a mediana 14 ms e o p99 2.834 ms: nenhum número sozinho a descreve. O p50 é o que a requisição típica vê; o p99 é o que 1 requisição em 100 vê, e uma página que faz 40 chamadas encontra essa cauda com frequência. Nunca tire a média de percentis entre execuções ou instâncias. Declare o percentil, a janela e o modelo (veja [Describing Performance](/system-design/system-design-concepts/describing-performance-latency-and-percentiles) e o paper [The Tail at Scale](/papers/the-tail-at-scale)).

### Pact: o consumidor escreve o contrato

Um teste de consumidor declara a interação de que precisa, e o mock server a responde. O consumidor é um cliente tipado para `/products/{id}` que lê `id`, `name` e `price`:

```csharp
var pact = Pact.V4("Web", "Shop.Api", new PactConfig { PactDir = "pacts" }).WithHttpInteractions(6942);

pact.UponReceiving("a request for an existing product").Given("product 1 exists")
    .WithRequest(HttpMethod.Get, "/products/1").WillRespond().WithStatus(HttpStatusCode.OK)
    .WithHeader("Content-Type", Match.Regex("application/json; charset=utf-8", @"^application/json(;.*)?$"))
    .WithJsonBody(new { id = Match.Integer(1), name = Match.Type("Keyboard"), price = Match.Decimal(49.90m) });

await pact.VerifyAsync(async ctx =>
{
    var product = await new ProductsClient(new HttpClient { BaseAddress = ctx.MockServerUri }).GetAsync(1);
    Assert.AreEqual("Keyboard", product!.Name);
});
```

Os dois testes passaram em 0,9 s e geraram `pacts/Web-Shop.Api.json` (trecho):

```json
"providerStates": [ { "name": "product 1 exists" } ],
"request": { "method": "GET", "path": "/products/1" },
"response": { "status": 200, "body": { "content": { "id": 1, "name": "Keyboard", "price": 49.9 } },
  "matchingRules": { "body": { "$.id": {"matchers": [{"match": "integer"}]}, "$.name": {"matchers": [{"match": "type"}]},
                               "$.price": {"matchers": [{"match": "decimal"}]} },
                     "header": { "Content-Type": {"matchers": [{"match": "regex", "regex": "^application/json(;.*)?$"}]} } } }
```

Matchers dizem como comparar, não o que enviar. `Match.Type("Keyboard")` aceita qualquer string, `Match.Integer`/`Match.Decimal` qualquer número daquele tipo, `Match.Regex` uma string que case com o padrão. Sem matcher o provider precisa devolver exatamente `"Keyboard"`, o que faz o teste de contrato depender de dados. O arquivo cita só `id`, `name` e `price`: o consumidor declara o que usa, nada além. Um consumidor que pede o caminho errado (`/product/1`) falha no próprio teste: o mock server registra `Received request GET /product/1`, responde 500, e o `EnsureSuccessStatusCode` lança.

### Pact: o provider reproduz o contrato contra a API real

O `PactVerifier` lê o arquivo, chama o provider por HTTP e compara cada resposta. `ProviderState` é como ele prepara os dados: antes de cada interação, faz POST do texto do `Given` para uma URL, e o provider se coloca naquele estado. Aqui um startup filter trata `POST /provider-states` e altera o store em memória (cria o produto 1; remove o produto 999). O teste do provider sobe a API com `factory.UseKestrel(6941)`:

```csharp
using var factory = new ShopApiFactory();      // WebApplicationFactory<Program> + o endpoint de estados
factory.UseKestrel(6941); factory.StartServer();
new PactVerifier("Shop.Api", config)
    .WithHttpEndpoint(new Uri("http://127.0.0.1:6941"))
    .WithFileSource(new FileInfo(pactFile))
    .WithProviderStateUrl(new Uri("http://127.0.0.1:6941/provider-states"))
    .Verify();
```

```text
  a request for an existing product (0s loading, 162ms verification)
     Given product 1 exists
    returns a response which: has status code 200 (OK), includes headers (OK), has a matching body (OK)
```

O README do PactNet diz que não dá para hospedar o provider com `WebApplicationFactory`, porque o `TestServer` não tem socket e o verificador em Rust é outro cliente HTTP. Isso era verdade antes do .NET 10; o `UseKestrel(porta)` dá à factory um listener real e funcionou aqui. A biblioteca nativa veio no NuGet (`runtimes/osx-arm64/native/libpact_ffi.dylib`, 12 MB); no macOS arm64 nada mais foi preciso. O README lista Linux (libc) e Windows x64 como suportados e Linux musl (Alpine) como não suportado (docs only). Defina `PACT_DO_NOT_TRACK=true` no CI: o Pact avisa que envia eventos anônimos de uso.

### Quebrando o provider de propósito

Cada mudança foi feita na API, os testes rodaram de novo e o código foi revertido:

| Mudança no provider | Resultado |
| --- | --- |
| Renomear `Name` para `Title` | `$ -> Actual map is missing the following keys: name`, com um diff dos dois corpos |
| `Price` serializado como string | `$.price -> Expected '49.90' (String) to be a decimal number` |
| `NotFound()` trocado por `NoContent()` | `has status code 404`: `expected 404 but was 204` |
| Adicionar o campo `Sku` | passa: campos extras são permitidos |

A última linha é o ponto do desenho: o provider pode acrescentar o que ninguém lê, e só é barrado pelo que um consumidor declarou. E o teste `WebApplicationFactory` do próprio provider, escrito contra `Product`, continua verde depois do rename (ele confere `product.Title`, depois que alguém corrige o erro de compilação), enquanto o pact falha: 2 testes, 1 falhou. Um teste do provider só sabe o que o provider acredita.

### Pact Broker e `can-i-deploy`

O broker guarda pacts e resultados de verificação por versão. Rodou como `pactfoundation/pact-broker` com SQLite na porta 6944 (sem Postgres), e a imagem `pact-cli` o operou:

```bash
pact-broker publish /pacts --consumer-app-version 1.0.0 --branch main --broker-base-url $B
pact-broker can-i-deploy --pacticipant Web --version 1.0.0 --to-environment production   # não: ainda sem verificação
# provider: WithPactBrokerSource(...PublishResults("1.0.0", r => r.ProviderBranch("main")))
pact-broker record-deployment --pacticipant Shop.Api --version 1.0.0 --environment production
pact-broker can-i-deploy --pacticipant Web --version 1.0.0 --to-environment production   # sim, saída 0
```

Com o Shop.Api 1.1.0 (o rename) e o `Web` 1.0.0 registrado em produção, `can-i-deploy --pacticipant Shop.Api --version 1.1.0` imprimiu `The verification for the pact between the version of Web currently in production (1.0.0) and version 1.1.0 of Shop.Api failed` e saiu com 1. Antes de registrar o `Web` como implantado, a mesma pergunta respondeu sim: ele só protege consumidores que sabe estarem em produção. O container do broker foi removido depois; o PactFlow (hospedado) é docs only.

### Contrato, OpenAPI e WebApplicationFactory

O `Microsoft.AspNetCore.OpenApi` gerou o documento a partir do código. Com `Results.Ok(p)` a resposta `200` ficou sem schema algum: ao adicionar `.Produces<Product>(200).Produces(404)` o schema apareceu (`required: ["id","name","price"]`). Depois do rename o schema regenerado dizia `["id","title","price"]`: uma especificação gerada do código acompanha o código, então não consegue rejeitar a quebra. Detectar isso exige um diff da especificação entre versões (uma ferramenta como oasdiff, docs only) ou o pact.

| | Pact | OpenAPI mais testes de schema | `WebApplicationFactory` |
| --- | --- | --- | --- |
| Ponto de vista | o que cada consumidor usa | tudo o que o provider oferece | o que o time do provider afirma |
| Pega um campo renomeado | sim, no build do provider | só comparando versões | não, se o teste for atualizado |
| Precisa do código dos consumidores | sim (os testes deles escrevem) | não | não |

### Qual teste responde a qual pergunta

| Pergunta | Teste |
| --- | --- |
| Esta regra calcula o valor certo? | unidade |
| Roteamento, binding, DI e banco funcionam juntos? | integração (`WebApplicationFactory`, Testcontainers) |
| O provider ainda entrega aos consumidores o que eles leem? | contrato (Pact) |
| Quantas requisições por segundo, e qual p99, sob qual carga? | carga (NBomber, k6) |
| A página funciona num navegador de verdade? | E2E ([Playwright](/dotnet-testing-concepts/end-to-end-testing-with-playwright-for-dotnet)) |

### Book vs today

- O conselho clássico é reportar o tempo médio de resposta de um laço fechado. Na execução medida a média foi 461 ms, a mediana 14 ms e o p99 2.834 ms. Hoje o mínimo é o modelo aberto, p50/p95/p99 e o máximo.
- O NBomber 6.7.1 imprime `THIS VERSION IS FREE ONLY FOR PERSONAL USE` e traz um contrato de licença (versão 3.2, em vigor desde 2026-09-01): grátis para uso pessoal e acadêmico, assinatura paga para organizações. O k6 é AGPL-3.0 (o repositório dele), então confira as duas licenças antes de adotar.
- O PactNet 3.x e anteriores usava um mock service standalone em Ruby e uma porta por teste; o 4.0 passou ao núcleo em Rust, e o 5.x acrescentou a especificação Pact 4 (`Pact.V4`, `WithHttpInteractions`). Textos escritos para o 3.x e anteriores usam uma API que não existe mais (veja o guia de upgrade).
- "Não dá para hospedar um provider com `WebApplicationFactory`" (README do PactNet) está desatualizado para o .NET 10: `UseKestrel(porta)`.

## Trade-offs

- **Teste de carga num notebook dá números relativos.** O gerador e o servidor dividiram 14 núcleos; compare dois builds na mesma máquina, não contra um SLA de produção.
- **Sobrecarga pode parecer sucesso.** Se a API está atrás de [rate limiting](/dotnet-concepts/rate-limiting-and-request-timeouts) ou de um [pipeline de resiliência](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers), os 429 e as chamadas repetidas mudam os números: conte-os como falha no check e teste o que o limite deve fazer.
- **O modelo aberto é honesto e faminto.** Precisa de VUs ou threads para a pior fila (o k6 descartou 96 iterações com poucos) e pode enterrar um servidor em apuros sob requisições. Limite com `maxVUs` e leia as falhas.
- **Um threshold vale o que vale o seu código de saída.** O k6 devolve 99; o NBomber devolve 0 e você confere `Thresholds`.
- **Um pact é só o que o consumidor escreveu.** Um consumidor que omite um campo de que precisa não está protegido. Mantenha os testes de consumidor no que o cliente realmente lê, com matchers em vez de valores.
- **Teste de contrato precisa de dois times e de um broker para compensar.** Sozinho em um repositório, um cliente tipado mais diff de OpenAPI ou `WebApplicationFactory` custa menos. O broker e o `can-i-deploy` só protegem consumidores registrados como implantados. Deixe o endpoint de provider states no host de teste, nunca no código de produção.

## Documentation Links

- [Load Simulation, NBomber](https://nbomber.com/docs/nbomber/load-simulation/) (doc)
- [Asserts and Thresholds, NBomber](https://nbomber.com/docs/nbomber/asserts_and_thresholds/) (doc)
- [License, NBomber](https://nbomber.com/docs/getting-started/license/) (doc)
- [Open and closed models, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/) (doc)
- [Constant arrival rate executor, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/) (doc)
- [Thresholds, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/thresholds/) (doc)
- [How NOT to Measure Latency, Gil Tene](https://www.youtube.com/watch?v=lJ8ydIuPFeU) (doc)
- [PactNet on GitHub](https://github.com/pact-foundation/pact-net) (doc)
- [Upgrading to PactNet 4.x (Ruby to Rust core)](https://github.com/pact-foundation/pact-net/blob/master/docs/upgrading-to-4.md) (doc)
- [How Pact works, docs.pact.io](https://docs.pact.io/getting_started/how_pact_works) (doc)
- [Matching, docs.pact.io](https://docs.pact.io/getting_started/matching) (doc)
- [Provider states, docs.pact.io](https://docs.pact.io/getting_started/provider_states) (doc)
- [Can I Deploy, docs.pact.io](https://docs.pact.io/pact_broker/can_i_deploy) (doc)
- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [OpenAPI overview in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview) (doc)
