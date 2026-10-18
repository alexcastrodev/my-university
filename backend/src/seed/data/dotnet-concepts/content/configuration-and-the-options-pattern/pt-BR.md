---
version: 1.0
updatedAt: 2026-10-05
title: "Configuração e o Options Pattern"
summary: Fontes de configuração e sua precedência, override por ambiente sem tocar no código, settings tipados com ValidateOnStart e como manter segredos fora do repositório.
---
## Objective

Uma connection string digitada num arquivo C# funciona na sua máquina e falha em
todo o resto. O ASP.NET Core separa *o que o código precisa* de *de onde o valor
vem*: a configuração é uma visão única de chave-valor montada a partir de várias
fontes, e o código lê dessa visão sem saber qual fonte forneceu cada valor. O
objetivo é conhecer as fontes e a precedência entre elas, sobrescrever um valor
por ambiente sem tocar no código, ligar uma seção a uma classe tipada com o
options pattern e manter segredos fora do repositório.

## Use Cases

- Tirar a connection string do código para que o mesmo build rode contra SQLite
  localmente e contra PostgreSQL em produção.
- Sobrescrever uma configuração num container com uma variável de ambiente, sem
  rebuild e sem editar arquivo.
- Falhar na inicialização quando uma configuração obrigatória está ausente, em
  vez de na primeira requisição que precisa dela.
- Manter uma chave de API fora do controle de versão durante o desenvolvimento
  local.

## Deep Dive

### Uma visão, vários providers

`WebApplication.CreateBuilder` monta um `IConfiguration` a partir destas fontes,
nesta ordem. Uma fonte posterior sobrescreve uma anterior para a mesma chave:

1. `appsettings.json`
2. `appsettings.{Environment}.json` (por exemplo `appsettings.Development.json`)
3. User secrets (só no ambiente `Development`)
4. Variáveis de ambiente
5. Argumentos de linha de comando

O nome do ambiente vem de `ASPNETCORE_ENVIRONMENT` (padrão `Production`). O
perfil do `launchSettings.json` o define como `Development` para o `dotnet run`
e a IDE, mas esse arquivo serve só ao desenvolvimento local e não é usado quando
a app é publicada.

### Lendo um valor

As chaves são hierárquicas. Este JSON:

```json
{
  "ConnectionStrings": { "GameStore": "Data Source=GameStore.db" }
}
```

é lido com um helper feito para a seção `ConnectionStrings`:

```csharp
var connString = builder.Configuration.GetConnectionString("GameStore");
builder.Services.AddSqlite<GameStoreContext>(connString);
```

O mesmo valor é endereçável como `ConnectionStrings:GameStore`, com dois-pontos
como separador. Esse separador é o motivo de variáveis de ambiente usarem outro.

### Sobrescrevendo por ambiente

Variáveis de ambiente não podem conter dois-pontos em todo shell, então o
separador nelas é um sublinhado duplo:

```bash
export ConnectionStrings__GameStore="Data Source=GameStoreProd.db"
dotnet run
```

Com essa variável definida, a app abre `GameStoreProd.db` e o código C# é
idêntico. Esse é o ponto: o código de configuração não sabe, e não deveria
saber, de onde veio um valor. Num container ou num host de nuvem você define a
mesma variável no deploy, sem arquivo para editar. A variável vive só na sessão
atual do shell, então fechar o terminal restaura o valor do JSON.

### Settings tipados: o options pattern

Ler strings por chave espalha nomes mágicos pelo código. Ligue uma seção a uma
classe e peça-a pelo tipo:

```csharp
public sealed class StoreOptions
{
    [Required] public string? Name { get; set; }
    [Range(1, 100)] public int PageSize { get; set; } = 20;
}

builder.Services.AddOptions<StoreOptions>()
    .BindConfiguration("Store")
    .ValidateDataAnnotations()
    .ValidateOnStart();

app.MapGet("/info", (IOptions<StoreOptions> options) => options.Value);
```

Dois detalhes tornam isso melhor que `Configuration["Store:PageSize"]`. O valor
é um `int` tipado com padrão. E o `ValidateOnStart` roda as data annotations
quando a app inicia: com `Name` ausente, o host se recusa a subir com
`OptionsValidationException: DataAnnotation validation failed for 'StoreOptions'
members: 'Name' with the error: 'The Name field is required.'`, em vez de falhar
na primeira requisição que o lê.

### Três interfaces, três ciclos de vida

- `IOptions<T>` é singleton: lido uma vez, nunca atualizado. A escolha padrão.
- `IOptionsSnapshot<T>` é scoped: recalculado por requisição, então um arquivo
  alterado é visto na requisição seguinte. Não pode ser injetado num singleton.
- `IOptionsMonitor<T>` é singleton, sempre devolve o valor atual e pode
  notificar mudanças. Use em singletons e background services que precisam
  reagir a reloads.

### Segredos

Tudo que é credencial não pertence ao `appsettings.json`, porque esse arquivo é
commitado. No desenvolvimento local, use o Secret Manager:

```bash
dotnet user-secrets init
dotnet user-secrets set "Payments:ApiKey" "sk_test_..."
```

O valor fica no seu perfil de usuário, fora do repositório, e é carregado
automaticamente em `Development`. Em produção, use variáveis de ambiente ou um
cofre de segredos (Azure Key Vault, AWS Secrets Manager, Kubernetes Secrets).
Uma connection string do SQLite pode ficar no `appsettings.json` só porque não
carrega credenciais; uma de PostgreSQL com senha não pode.

## Trade-offs

- **Surpresas de precedência.** Uma variável de ambiente esquecida na sua
  máquina pode vencer o arquivo JSON em silêncio, e a app parece ignorar a sua
  edição. Quando uma configuração "não pega", imprima
  `builder.Configuration.GetDebugView()` para ver cada chave com o provider que
  a forneceu.
- **Tudo é string até ser ligado.** `Configuration["Store:PageSize"]` devolve
  uma string e `null` para uma chave ausente, sem erro. Ligar a uma classe de
  options dá tipos e `ValidateOnStart`.
  ```csharp
  var size = builder.Configuration.GetValue<int>("Store:PageSize"); // 0 se ausente, sem aviso
  ```
- **`IOptions<T>` nunca recarrega.** Se você edita o `appsettings.json` com a
  app rodando, o `IOptions<T>` mantém o valor antigo. Escolha
  `IOptionsMonitor<T>` quando o reload importar, e aceite que uma mudança
  aplicada pela metade passa a ser possível.
- **Arquivos por ambiente se multiplicam.** `appsettings.Staging.json`,
  `appsettings.Production.json` e variantes por cliente viram uma matriz. Deixe
  os arquivos JSON só com padrões e mova o que difere por deploy para variáveis
  de ambiente definidas pela plataforma.
- **Variáveis de ambiente são visíveis à árvore de processos.** São melhores que
  um arquivo commitado, mas mais fracas que um arquivo de segredo montado ou um
  cofre para credenciais de alto valor, já que aparecem em listagens de
  processos e em crash dumps em algumas plataformas.

## Lab

Neste lab você recebe uma biblioteca com três pontos vazios de configuração: montar o `IConfiguration` a partir de várias fontes, ler uma connection string obrigatória com segurança e ligar uma seção a uma classe de opções tipada validada na inicialização. O seu trabalho é implementar os três. A ideia central é sentir que a configuração é uma pilha de fontes em que a última vence, e que uma configuração faltando ou fora da faixa deve derrubar a aplicação no startup, e não na primeira vez que alguém usar o valor.

**O cenário**

`AppConfiguration.Build` deve se comportar como `WebApplication.CreateBuilder`: um arquivo base, um arquivo opcional de ambiente, variáveis de ambiente e a linha de comando, cada um sobrescrevendo o anterior. Os testes montam a configuração a partir de streams JSON em memória e sobem um host de verdade, então a falha acontece onde aconteceria em produção.

- `AppConfiguration.cs`: `Build(baseJson, environmentJson, args)`, a constante de prefixo `GSLAB_` das variáveis de ambiente e a extensão `GetRequiredConnectionString`.
- `StoreOptions.cs`: a classe de opções da seção `Store`, com `Name` obrigatório e `PageSize` de 1 a 100 (padrão 20).
- `StoreOptionsRegistration.cs`: o método `AddStoreOptions`, ainda vazio.

**O que você vai fazer, passo a passo**

1. **Montar as fontes na ordem certa (TODO-00).** Em `Build`, adicione, em precedência crescente: o JSON base, o JSON de ambiente (quando não for nulo), as variáveis de ambiente com o prefixo `GSLAB_` e os argumentos de linha de comando. Uma fonte posterior sobrescreve uma anterior para a mesma chave.
2. **Falhar com uma mensagem útil (TODO-01).** Em `GetRequiredConnectionString`, devolva a connection string pelo nome e, se faltar, lance `InvalidOperationException` com uma mensagem que contenha o nome, em vez de devolver `null`.
3. **Registrar as opções com validação no startup (TODO-02).** Em `AddStoreOptions`, registre `StoreOptions` ligado à seção `Store`, valide as data annotations e faça a checagem rodar quando o host inicia (não no primeiro uso). Assim um `Name` ausente ou um `PageSize` de 500 impede o host de subir, com `OptionsValidationException`.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar a ordem de precedência das quatro fontes, por que o `PageSize` volta ao padrão 20 quando a chave não existe e por que validar no startup é melhor do que descobrir o erro em tempo de requisição.

**Desafios opcionais**

- **TODO-03:** imprima `((IConfigurationRoot)configuration).GetDebugView()` num teste e descubra qual provider forneceu cada chave.
- **TODO-04:** troque `IOptions<StoreOptions>` por `IOptionsMonitor<StoreOptions>` num teste e mude a fonte em memória. O que cada interface devolve depois?

**Pré-requisitos:** noções de `IConfiguration` e JSON, injeção de dependência (`IServiceCollection`) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. No estado inicial os métodos lançam `NotImplementedException` e os testes falham, com os TODOs marcados em comentário em cada arquivo.

## Documentation Links

- [Configuration in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/) (doc)
- [Options pattern in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options) (doc)
- [Use multiple environments in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments) (doc)
- [Safe storage of app secrets in development, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [Options pattern in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/options) (doc)
