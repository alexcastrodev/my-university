---
version: 1.0
updatedAt: 2026-10-05
title: "Injeção de Dependência e Ciclos de Vida de Serviços"
summary: O que o container faz, transient, scoped e singleton, por que o DbContext é scoped, captive dependencies, criar um escopo à mão e keyed services.
---
## Objective

Injeção de dependência (DI) significa que uma classe recebe os objetos de que
precisa em vez de criá-los. O ASP.NET Core tem um container embutido para isso, e
quase tudo no framework (logging, configuração, `DbContext`, seus próprios
handlers) passa por ele. O objetivo é entender o que o container faz por você,
escolher o ciclo de vida certo (transient, scoped, singleton) para cada serviço
e reconhecer os bugs de errar um ciclo de vida, em particular um objeto de vida
longa segurando um de vida curta.

## Use Cases

- Entregar um `GameStoreContext` a um endpoint sem que ele saiba como construí-lo
  ou configurá-lo.
- Trocar uma implementação real por uma falsa num teste, registrando outro tipo
  para a mesma interface.
- Compartilhar um objeto entre tudo que participa de uma única requisição HTTP
  (uma unit of work, um id de correlação por requisição).
- Rodar código na inicialização que precisa de um contexto de banco, onde não há
  requisição de onde emprestar um.

## Deep Dive

### O problema: uma classe que constrói as próprias dependências

```csharp
public class MyService
{
    private readonly MyLogger _logger = new MyLogger(new MyFileWriter("log.txt"));
}
```

`MyService` está acoplado ao `MyLogger` e também à forma como o `MyLogger` é
construído. Quando o construtor do `MyLogger` muda, o `MyService` precisa mudar.
Ele não pode ser testado sem gravar um arquivo de verdade. A correção é pedir a
dependência no construtor e deixar outra parte decidir como construí-la:

```csharp
public class MyService(MyLogger logger)
{
    public void Run() => logger.Log("started");
}
```

Essa "outra parte" é o container, um `IServiceProvider` que o framework monta a
partir dos seus registros.

### Registrar, depois resolver

O registro acontece antes do `Build()`, em `builder.Services`:

```csharp
builder.Services.AddScoped<IGameService, GameService>();
builder.Services.AddSingleton<ISystemClock, SystemClock>();
builder.Services.AddTransient<IReceiptNumberGenerator, ReceiptNumberGenerator>();
```

Quando uma requisição precisa de um tipo, o container olha o construtor,
constrói cada parâmetro (recursivamente, a partir dos próprios registros) e os
passa. Classes com construtor primário ficam limpas para isso. Um parâmetro que
ninguém registrou faz a resolução falhar, que é o erro antecipado que você quer.

Em minimal APIs, parâmetros de handler que são serviços registrados são
injetados diretamente, sem atributo no caso usual:

```csharp
app.MapGet("/games", async (GameStoreContext db) => ...);   // db é injetado
```

### Os três ciclos de vida

O ciclo de vida responde uma pergunta: quando o container é consultado de novo
pelo serviço, ele devolve a mesma instância ou uma nova?

- **Transient**: uma instância nova a cada pedido. Para helpers pequenos e sem
  estado.
- **Scoped**: uma instância por escopo. Numa aplicação web, um escopo é uma
  requisição HTTP, então tudo naquela requisição que pede o serviço recebe a
  mesma instância, e a requisição seguinte recebe uma nova.
- **Singleton**: uma instância para toda a vida da aplicação.

Dá para ver o "mesma dentro de uma requisição" diretamente:

```csharp
builder.Services.AddScoped<RequestState>();

app.MapGet("/ids", (RequestState a, IServiceProvider sp) => new
{
    a = a.Id,
    b = sp.GetRequiredService<RequestState>().Id,   // mesmo Guid de 'a' nesta requisição
});
```

### Por que o `DbContext` é scoped

`AddDbContext` e `AddSqlite<T>` registram o contexto como **scoped**, e isso é
deliberado:

- Um `DbContext` não é thread-safe, então duas requisições não podem
  compartilhar um.
- Conexões são limitadas e caras; um contexto por requisição as abre e libera
  sem demora.
- O contexto rastreia toda entidade que carrega. Um de vida longa cresceria sem
  limite e mostraria dados desatualizados.
- Uma instância por requisição dá uma única unit of work para todo o código que
  participa dela.

### Captive dependencies

O erro perigoso é um serviço de vida longa capturando um de vida curta. Um
singleton que recebe um serviço scoped no construtor guarda para sempre a
instância da primeira requisição, a compartilha entre threads e anula o motivo
de o serviço ser scoped:

```csharp
builder.Services.AddScoped<RequestState>();
builder.Services.AddSingleton<Cache>();      // Cache(RequestState state) -> captive dependency

class Cache(RequestState state) { }
```

No ambiente `Development`, o container valida isso quando o host é construído e a
app se recusa a iniciar com:
`Cannot consume scoped service 'RequestState' from singleton 'Cache'`. Em
`Production` essa validação vem desligada por padrão, então o mesmo código inicia
e se comporta mal. Rode seus testes de integração em `Development`, ou ligue a
validação explicitamente com
`builder.Host.UseDefaultServiceProvider(o => o.ValidateScopes = true)`.

### Criando um escopo à mão

Código que roda fora de uma requisição (inicialização, um `BackgroundService`, um
singleton que precisa de banco) não tem escopo ambiente. Ele precisa criar um e
descartá-lo:

```csharp
public static void MigrateDb(this WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<GameStoreContext>();
    db.Database.Migrate();
}
```

O `using` descarta o escopo e, com ele, o contexto. Não resolva serviços scoped
direto de `app.Services`: esse é o provider raiz, e o serviço viveria tanto
quanto a aplicação.

### Keyed services

Quando várias implementações compartilham uma interface, registre-as com uma
chave e peça uma pelo nome, em vez de injetar uma coleção e filtrar:

```csharp
builder.Services.AddKeyedSingleton<IPaymentGateway, StripeGateway>("stripe");
builder.Services.AddKeyedSingleton<IPaymentGateway, PaypalGateway>("paypal");

app.MapPost("/pay", ([FromKeyedServices("stripe")] IPaymentGateway gateway) => ...);
```

## Trade-offs

- **Uma interface para tudo é ruído.** O container registra uma classe concreta
  diretamente. Crie uma interface quando houver uma segunda implementação ou uma
  fronteira real para falsear em testes, não por reflexo.
  ```csharp
  builder.Services.AddScoped<GameService>();   // sem IGameService até ele merecer
  ```
- **Injetar `IServiceProvider` é o service locator.** Ele esconde o que uma
  classe precisa atrás de chamadas `GetService`, então as dependências deixam de
  aparecer no construtor e as falhas vão para o runtime. Reserve-o para criar
  escopos e para factories.
- **Singletons precisam ser thread-safe.** Uma instância atende todas as
  requisições ao mesmo tempo. Campos mutáveis sem sincronização, ou uma
  dependência scoped capturada, produzem bugs que só aparecem sob carga.
- **O container descarta o que cria.** Um `IDisposable` que ele construiu é
  descartado junto com o escopo, mas uma instância que você mesmo passa
  (`AddSingleton(new Foo())`) é sua para descartar. Misturar os dois leva a
  vazamentos ou a descarte duplo.
- **O container embutido é pequeno de propósito.** Sem injeção por propriedade,
  sem interceptação por registro, sem scanning por convenção. Bibliotecas como o
  Scrutor adicionam scanning e decoração por cima; trocar de container raramente
  compensa a migração.

## Documentation Links

- [Dependency injection in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) (doc)
- [Dependency injection in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection) (doc)
- [Dependency injection guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines) (doc)
- [Dependency injection in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#explicit-parameter-binding) (doc)
- [Scrutor, assembly scanning and decoration for the built-in container](https://github.com/khellang/Scrutor) (doc)
