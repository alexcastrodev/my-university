---
version: 1.0
updatedAt: 2026-11-12
title: "Feature flags com Microsoft.FeatureManagement"
summary: Feature flags no .NET 10 medidas de verdade, com flags em configuração, filtros de percentual, janela de tempo e targeting, FeatureGate em controllers e em Minimal APIs, variantes, recarga e snapshots, testes por flag com WebApplicationFactory, dívida de flags velhas e o que um serviço externo acrescenta.
---
## Objective

Uma feature flag separa o deploy do código da liberação dele: o checkout novo está em produção, desligado, e uma mudança de configuração o liga para 5% dos usuários, depois para todos, e o desliga de novo se a taxa de erros subir. No .NET a biblioteca padrão para isso é a `Microsoft.FeatureManagement` (e a `Microsoft.FeatureManagement.AspNetCore` para apps web). Ela lê as definições das flags do `IConfiguration`, então elas podem morar no `appsettings.json`, em variáveis de ambiente ou num repositório remoto, e acrescenta as partes que você escreveria mal: filtros (percentual, janela de tempo, targeting), `[FeatureGate]` para controllers, `WithFeatureGate` para Minimal APIs e variantes para experimentos que precisam de mais que ligado ou desligado. Este concept roda tudo isso no .NET 10 e mede onde o comportamento não é o que os nomes sugerem: um percentual que não é estável, um erro de digitação que desliga a flag em silêncio, um snapshot que ignora uma recarga. Versões usadas: SDK 10.0.100, runtime 10.0.0, `Microsoft.FeatureManagement.AspNetCore` 4.8.0. O lab usa `WebApplicationFactory` e uma configuração JSON em memória por teste, sem nenhum serviço externo.

## Use Cases

- Integrar trabalho inacabado na branch principal atrás de uma flag desligada, em vez de manter uma branch longa.
- Um rollout gradual: 1%, 10%, 50%, 100% dos usuários, com um desligamento rápido.
- Uma funcionalidade com prazo (uma promoção, um lançamento em horário fixo) que abre e fecha sozinha.
- Deixar usuários internos, um grupo beta ou um cliente específico ver uma funcionalidade primeiro.
- Um experimento com duas ou três versões de um banner ou de uma página de preços.

## Deep Dive

### Definindo flags na configuração

As flags são lidas da seção `feature_management` (o schema de feature management da Microsoft) por padrão. `AddFeatureManagement()` é todo o registro de que uma flag simples precisa:

```json
{
  "feature_management": {
    "feature_flags": [
      { "id": "NewPricing", "enabled": true },
      { "id": "Reports", "enabled": false }
    ]
  }
}
```

```csharp
builder.Services.AddFeatureManagement();
app.MapGet("/pricing", async (IFeatureManager features) =>
    await features.IsEnabledAsync("NewPricing") ? "price v2" : "price v1");
```

A seção antiga `FeatureManagement` (`"NewPricing": true`, ou um array `EnabledFor` de filtros) continua funcionando: carreguei `{"A": true, "B": false, "C": {"EnabledFor": [percentage 100]}}` e obtive `A=True B=False C=True`. Mas, segundo a documentação, variantes e telemetria só são suportadas no schema novo a partir da versão 4.0.0, então código novo deve usar `feature_management`. Como as flags são configuração comum, qualquer fonte de `IConfiguration` serve: arquivos, variáveis de ambiente, user secrets, Azure App Configuration.

Guarde os nomes das flags em constantes (`Flags.NewPricing`). O nome de uma flag é uma string, e uma string errada não é um erro:

```text
IsEnabledAsync("NewPriceing")   -> False     (erro de digitação, a flag simplesmente "está desligada")
IgnoreMissingFeatures = false   -> FeatureManagementException: The feature definition for the feature 'NewPriceing' was not found.
```

Pôr `IgnoreMissingFeatures` em `false` transforma o erro de digitação em exceção, que é o que você quer nos testes e provavelmente não quer no dia em que uma flag é apagada da configuração de produção antes do código. Outra coisa: `"enabled": false` vence os filtros. Uma flag com `enabled: false` e um filtro de percentual de 100 devolveu `False`, então um kill switch não precisa que os filtros sejam removidos.

### Filtros: percentual, janela de tempo, targeting

Uma flag com `enabled: true` e uma lista de `client_filters` está ligada quando os filtros dizem que sim. Por padrão basta um filtro ligar; `"requirement_type": "All"` exige todos. Pus um filtro de 100% e outro de 0% numa flag: `Any` deu `True`, `All` deu `False`.

```json
{ "id": "NewPricing", "enabled": true, "conditions": { "client_filters": [
    { "name": "Microsoft.Percentage", "parameters": { "Value": 50 } } ] } }
```

O **percentual** é aleatório a cada avaliação. O mesmo chamador perguntando 12 vezes seguidas recebeu `010001101100`, e 10000 chamadas deram 4995 ligadas. É uma moeda justa por chamada, o que serve para load shedding ou "5% das requisições usam o cache novo" e é errado para qualquer coisa que o usuário vê duas vezes: o preço muda entre carregamentos da página.

A **janela de tempo** aceita `Start` e/ou `End`:

```json
{ "name": "Microsoft.TimeWindow", "parameters": { "Start": "Mon, 16 Nov 2026 09:00:00 GMT", "End": "Mon, 23 Nov 2026 09:00:00 GMT" } }
```

O lab mostra que uma janela em volta de agora está ligada, uma janela futura está desligada e uma janela expirada está desligada. A flag fecha sozinha, mas o código e a entrada ficam: alguém ainda precisa apagá-los (veja a seção de limpeza).

O **targeting** decide por usuário e precisa saber quem é o usuário. O pacote pergunta a um `ITargetingContextAccessor`; o lab implementa um que lê os headers `X-User` e `X-Groups`, e um app real lê as claims do usuário autenticado (`WithTargeting<T>()` registra o seu; o pacote ASP.NET Core também traz o `DefaultHttpTargetingContextAccessor`, que a documentação descreve como leitor do usuário a partir da requisição, e eu não o rodei):

```json
{ "name": "Microsoft.Targeting", "parameters": { "Audience": {
    "Users": [ "alice", "mallory" ],
    "Groups": [ { "Name": "beta", "RolloutPercentage": 100 } ],
    "DefaultRolloutPercentage": 0,
    "Exclusion": { "Users": [ "mallory" ], "Groups": [ "blocked" ] } } } }
```

```text
alice: True   mallory: False (excluída)   bob em [beta]: True   bob em [beta,blocked]: False   carol: False
```

Ao contrário do filtro de percentual, um rollout por targeting é estável para um mesmo usuário: com `DefaultRolloutPercentage` 10 e 50 sobre 1000 usuários, 104 e 534 ficaram ligados e nenhum usuário mudou entre duas chamadas. Os grupos também são independentes entre flags: 97 usuários tinham a flag F1 (10%), e 9 deles tinham também a F2 (10%), perto do que a independência prevê, então os mesmos 10% de usuários não recebem todos os experimentos. Subir o percentual mantém o grupo anterior: dos 104 usuários ligados em 10%, nenhum estava desligado em 50%.

Um filtro que não está registrado é um erro, não um "não": uma flag que usava um filtro chamado `My.Custom` lançou `FeatureManagementException: The feature filter 'My.Custom' specified for feature 'Unknown' was not found.` Você escreve o seu próprio filtro com `IFeatureFilter` e `[FilterAlias]` e o registra com `AddFeatureFilter<T>()`; não rodei um neste concept, o lab o deixa como bônus.

### `[FeatureGate]` e flags em Minimal APIs

Em controllers MVC, `[FeatureGate("Reports")]` num controller ou action faz com que ele responda 404 enquanto a flag está desligada (o `NotFoundDisabledFeaturesHandler` padrão; `UseDisabledFeaturesHandler` muda isso):

```csharp
[ApiController, Route("reports"), FeatureGate("Reports")]
public class ReportsController : ControllerBase { ... }
```

Minimal APIs não usam filtros do MVC. O pacote ASP.NET Core tem, em vez disso, uma extensão de endpoint filter:

```csharp
app.MapGet("/checkout/express", () => "express checkout").WithFeatureGate("ExpressCheckout");
```

Os dois deram 404 com a flag desligada e 200 com ela ligada nos testes do lab. `WithFeatureGate` aceita vários nomes e um `RequirementType` (qualquer um ou todos). Um endpoint protegido que responde 404 fica invisível, o que normalmente é o certo para uma funcionalidade ainda não lançada e errado quando um cliente precisa distinguir "não lançado" de "não existe".

### Variantes

Uma flag ligada ou desligada não basta para um experimento com três banners. Uma flag com variantes tem variantes nomeadas, cada uma com um valor, e uma alocação que decide quem recebe qual:

```json
{ "id": "Banner", "enabled": true,
  "variants": [ { "name": "Plain", "configuration_value": "Welcome" },
                { "name": "Bold", "configuration_value": "WELCOME BACK" },
                { "name": "Holiday", "configuration_value": "Happy holidays" } ],
  "allocation": {
    "user":  [ { "variant": "Bold", "users": [ "alice" ] } ],
    "group": [ { "variant": "Holiday", "groups": [ "staff" ] } ],
    "default_when_enabled": "Plain", "default_when_disabled": "Plain" } }
```

```csharp
var variant = await features.GetVariantAsync("Banner", ct);   // IVariantFeatureManager
return $"{variant?.Name}|{variant?.Configuration?.Value}";
```

```text
alice -> Bold|WELCOME BACK     bob em [staff] -> Holiday|Happy holidays     carol -> Plain|Welcome
```

Uma alocação por `percentile` (`{ "variant": "A", "from": 0, "to": 50 }`, e `B` de 50 a 100) dividiu 1000 usuários em 496 e 504, e nenhum usuário mudou de variante entre duas chamadas, então ela é estável como o targeting. Para uma flag desligada, `GetVariantAsync` devolveu a variante `default_when_disabled` (`Safe`), e para uma flag que não está definida devolveu `null`: verifique isso, como o código acima faz com `?.`.

### Recarga e snapshots

O `IFeatureManager` avalia contra a configuração atual a cada chamada. Editei o arquivo JSON de um app em execução (com `reloadOnChange`) de `enabled: false` para `true`:

```text
antes: manager=False snapshot=False
depois da edição (306 ms): manager=True snapshot(mesmo escopo)=False
snapshot de um escopo novo=True
```

A edição ficou visível em cerca de 0,3 s sem reiniciar. O `IFeatureManagerSnapshot` guarda o resultado por escopo (por requisição, num app web), então dentro de uma requisição uma flag não pode virar no meio do caminho. É a escolha segura para um handler que consulta a mesma flag duas vezes (uma para renderizar, outra para autorizar), e é por isso que o tag helper `<feature>` do Razor recebe o snapshot e não o manager singleton.

### Testando por flag

Os testes do lab nunca tocam o `appsettings.json`. Cada teste monta uma `WebApplicationFactory` e troca a configuração por um JSON próprio, em memória:

```csharp
new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
    host.ConfigureAppConfiguration((_, config) =>
    {
        config.Sources.Clear();
        config.AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(json)));
    }));
```

Isso dá a cada teste exatamente as flags que ele nomeia, sem arquivo compartilhado e sem ordem entre testes. Um teste também carrega o `appsettings.json` de verdade e afirma que toda flag sai desligada, uma proteção barata contra o merge de uma flag ligada por acidente. Teste os dois ramos de uma flag enquanto ela existir; quando a flag for removida, apague o ramo perdedor e os testes dele junto.

### Flags velhas são dívida

Uma flag que está 100% ligada há meses é peso morto: dois caminhos de código onde um está morto, uma entrada de configuração que ninguém ousa tocar e um crescimento combinatório de estados para testar. Hábitos que mantêm isso sob controle:

- Dê a cada flag um dono e uma data de remoção quando ela for criada; o filtro de janela de tempo é um jeito de codificar "isto termina em".
- Separe flags de release de vida curta (remover depois do rollout) das de vida longa (kill switches, flags de permissão) e dê nomes diferentes a elas.
- Mantenha os nomes numa classe de constantes e liste o que está definido: o endpoint `/flags` do lab enumera `GetFeatureNamesAsync()` com cada estado, e um teste (ou um passo de CI) pode comparar essa lista com as constantes para pegar flags definidas e nunca lidas e flags lidas e nunca definidas.
- Depois que um rollout chega a 100%, remova a checagem primeiro e a entrada de configuração depois, nessa ordem: ao contrário, o código roda com uma flag ausente, que por padrão é `false` em silêncio.

### O que um serviço externo acrescenta

Esta parte vem da documentação, não das minhas execuções. A biblioteca lê do `IConfiguration`, então um repositório remoto entra como mais uma fonte de configuração. O Azure App Configuration é a opção da Microsoft: as flags ficam fora do seu deploy, podem ser mudadas num portal por quem não faz deploy, atualizam em apps em execução sem reinício e podem ser separadas por ambiente com labels. Serviços de terceiros (LaunchDarkly, Unleash, Flagsmith e outros) tipicamente acrescentam um plano de controle parecido, com SDKs em muitas linguagens, regras de segmento definidas numa UI e análise de experimentos. O OpenFeature é uma API neutra de fornecedor para avaliar flags, com providers para muitos deles. O que você abre mão é de uma dependência de um serviço no caminho de cada inicialização (uma queda do repositório de flags precisa cair num padrão seguro) e de um custo por usuário ou por avaliação. Para poucas flags de release num app, configuração basta; no momento em que quem não é desenvolvedor precisa virar flags, ou você precisa de auditoria, controle por ambiente e análise de experimentos em vários serviços, um serviço se paga. A biblioteca também pode emitir telemetria das avaliações por meio de `System.Diagnostics.Activity`, que vem desligada e é ligada por flag.

## Trade-offs

- **Nomes de flag são strings que falham para "desligado".** Um erro de digitação é uma funcionalidade desligada em silêncio; mantenha constantes e ligue `IgnoreMissingFeatures = false` nos testes.
  ```csharp
  builder.Services.Configure<FeatureManagementOptions>(o => o.IgnoreMissingFeatures = false);
  ```
- **O filtro de percentual não é estável.** O mesmo chamador muda de uma chamada para outra. Use targeting com `DefaultRolloutPercentage` para qualquer coisa que o usuário vê mais de uma vez.
- **Cada flag dobra os estados que você precisa testar.** Teste os dois ramos enquanto ela viver e agende a remoção dela quando criá-la.
- **Um gate desligado parece um endpoint inexistente.** `[FeatureGate]` e `WithFeatureGate` respondem 404; se os clientes precisam de uma mensagem clara, use `UseDisabledFeaturesHandler` ou cheque a flag no código.
- **Filtros precisam das dependências deles.** O targeting precisa de um accessor que conheça o usuário, e um filtro não registrado lança exceção em vez de devolver falso.
- **Variantes e telemetria precisam do schema novo.** Segundo a documentação, a seção `FeatureManagement` anterior à 4.0 não os suporta; comece por `feature_management`.
- **Flags são configuração em runtime, então podem quebrar a produção.** Uma edição errada entra em vigor em cerca de 0,3 s numa fonte com recarga. Revise mudanças de flag como código e dê um kill switch às flags arriscadas.
- **Um serviço de flags move o modo de falha.** Decida o que o app faz quando o repositório está inalcançável na inicialização: o último estado conhecido em cache ou um padrão seguro, nunca uma exceção.

## Documentation Links

- [Feature management overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-overview) (doc)
- [.NET feature management reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-dotnet-reference) (doc)
- [Quickstart: add feature flags to an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-feature-flags-dotnet-core) (doc)
- [Use variant feature flags in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-variant-feature-flags-aspnet-core) (doc)
- [Microsoft.FeatureManagement.AspNetCore, NuGet](https://www.nuget.org/packages/Microsoft.FeatureManagement.AspNetCore) (doc)
- [Feature Toggles, Martin Fowler](https://martinfowler.com/articles/feature-toggles.html) (doc)
- [OpenFeature](https://openfeature.dev/) (doc)
