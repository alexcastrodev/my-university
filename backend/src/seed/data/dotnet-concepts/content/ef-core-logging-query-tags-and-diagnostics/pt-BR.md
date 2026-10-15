---
version: 1.0
updatedAt: 2026-10-15
title: "Logging, Query Tags e Diagnóstico no EF Core"
summary: ToQueryString, LogTo e ILogger por categoria, dados sensíveis e erros detalhados, TagWith e interceptors para contar comandos.
---
## Objective

O EF Core escreve o SQL por você, então a primeira pergunta de debug é sempre a
mesma: o que ele realmente mandou, quantas vezes e de qual linha do meu código?
Este conceito cobre as ferramentas que respondem isso: `ToQueryString` para uma
query, `LogTo` e `ILogger` para o tráfego ao vivo, query tags para ligar um SQL
de volta à query LINQ e interceptors quando você quer contar ou alterar comandos
em código. Também explica as duas chaves que mudam o que o log contém,
`EnableSensitiveDataLogging` e `EnableDetailedErrors`, porque elas fazem a
diferença entre um log útil e um vazamento. O hábito de ler o SQL começa no
conceito de dados relacionados (N+1 e `ToQueryString`); este é o kit completo.

## Use Cases

- Conferir o `WHERE` e o `JOIN` de uma query antes de ela rodar.
- Descobrir qual, entre várias queries parecidas, é a lenta num log de produção.
- Fazer um teste falhar quando um endpoint passa a emitir mais comandos do que antes.
- Transformar uma exceção vaga de "o dado é NULL" numa que nomeia a propriedade.
- Adicionar tempo ou um comentário de auditoria a todo comando sem mexer em cada query.

## Deep Dive

Todos os trechos abaixo rodaram no EF Core 10.0.13 com o provider SQLite
(`Microsoft.EntityFrameworkCore.Sqlite`). O formato dos logs é o mesmo em outros
providers relacionais, mas o texto do SQL e os tipos dos parâmetros não são.

### ToQueryString: uma query, sem executar

`ToQueryString()` é uma extension de `IQueryable`, então funciona numa query que
você compôs mas não enumerou. Ela nunca toca o banco, o que a torna a
ferramenta mais barata desta lista. Imprime os parâmetros num cabeçalho
`.param set` (esse é o formato do SQLite; quem decide é o provider) seguido do
SQL:

```csharp
var min = 20.0;
var q = db.Products.Where(p => p.Price > min).OrderBy(p => p.Name);
Console.WriteLine(q.ToQueryString());
// .param set @min 20.0
//
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > @min
// ORDER BY "p"."Name"
```

Ela só existe numa query que ainda é `IQueryable`. `First`, `Count`, `ToList` e
companhia executam na hora e devolvem um valor, então não sobra nada para
imprimir. Repare que a saída inclui o valor do parâmetro, então trate-a como
dado sensível (veja os trade-offs).

### Simple logging com LogTo

`LogTo` recebe qualquer `Action<string>` e não precisa de pacote extra, por isso
é o padrão certo durante o desenvolvimento. Dá para filtrar por nível mínimo,
por event ids, por categoria ou com um predicado `(EventId, LogLevel)`.
Filtrar aí é mais barato do que filtrar no seu delegate, porque uma mensagem
filtrada nem chega a ser montada.

```csharp
options.LogTo(Console.WriteLine,
    [RelationalEventId.CommandExecuted],   // id 20101
    LogLevel.Information,
    DbContextLoggerOptions.None);
// Executed DbCommand (0ms) [Parameters=[@min='?' (DbType = Double)], CommandType='Text', CommandTimeout='30']
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > @min
```

Os ids ficam em `CoreEventId`, `RelationalEventId` e, por provider, em classes
como `SqlServerEventId`. `RelationalEventId.CommandExecuting` é 20100,
`CommandExecuted` é 20101 e `CommandError` é 20102 (impresso com `.Id`).
`CommandExecuted` traz o tempo gasto, `CommandExecuting` não, e o evento de erro
é como um comando que falha aparece:

```csharp
db.Products.FromSql($"SELECT * FROM NoSuchTable").ToList();
// Failed executing DbCommand (0ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
// SELECT * FROM NoSuchTable
// SqliteException: SQLite Error 1: 'no such table: NoSuchTable'.
```

### Dados sensíveis e erros detalhados

Olhe de novo o `@min='?'` no log acima. Por padrão o EF Core esconde o valor
dos parâmetros, porque são dados do usuário. `EnableSensitiveDataLogging()` os
mostra:

```csharp
options.LogTo(...).EnableSensitiveDataLogging();
// Executed DbCommand (0ms) [Parameters=[@min='20'], ...]
// e no SaveChanges: [Parameters=[@p0='Secret-name' (Nullable = false) (Size = 11), @p1='5'], ...]
```

É exatamente por isso que deve continuar sendo uma chave de desenvolvimento: o
insert acima gravou no log uma string fornecida pelo cliente. Ela também põe
valores nas mensagens de exceção, como valores de chave num erro de concorrência.

`EnableDetailedErrors()` resolve outro problema. Por desempenho, o EF Core não
envolve cada leitura de valor num try-catch, então um NULL onde o modelo diz
não-nulo falha com uma mensagem genérica do provider. Com a chave ligada, o EF
adiciona o catch e nomeia a propriedade. Mesma query, mesmos dados, duas
mensagens:

```csharp
// default : The data is NULL at ordinal 1. This method can't be called on NULL values. Check using IsDBNull before calling.
// detailed: An error occurred while reading a database value for property 'Product.Name'.
//           The expected type was 'System.String' but the actual value was 'null'.
```

### Categorias, níveis e ILogger

Numa aplicação ASP.NET Core o caminho normal é o `Microsoft.Extensions.Logging`,
que o EF Core usa quando o contexto é criado pelo service provider. Toda
mensagem tem uma categoria hierárquica, e a que carrega o SQL é
`Microsoft.EntityFrameworkCore.Database.Command`
(`DbLoggerCategory.Database.Command.Name` em código). Como as categorias formam
uma árvore, um filtro em `...Database` cobre `.Connection`, `.Command` e
`.Transaction`. No `appsettings.json`:

```json
{ "Logging": { "LogLevel": {
    "Microsoft.EntityFrameworkCore": "Warning",
    "Microsoft.EntityFrameworkCore.Database.Command": "Information" } } }
```

O mesmo em código, com um `LoggerFactory` simples, imprimiu uma linha de SQL:

```csharp
var lf = LoggerFactory.Create(b => b
    .AddSimpleConsole(o => o.SingleLine = true)
    .SetMinimumLevel(LogLevel.Warning)
    .AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information));
// info: Microsoft.EntityFrameworkCore.Database.Command[20101] Executed DbCommand (0ms) [...] SELECT COUNT(*) FROM "Products" AS "p"
```

Isso mantém o log de comandos ligado e o resto quieto, que é o setup que você
quer ao caçar queries lentas. `ConfigureWarnings` é o companheiro: ele pode
baixar, subir, ignorar ou lançar exceção num evento específico, por exemplo
transformando o aviso de vários includes de coleção numa exceção.

### Query tags

Um log cheio de `SELECT ... FROM "Products"` não diz qual controller o emitiu.
`TagWith("texto")` adiciona um comentário SQL acima do comando, as tags se
acumulam quando você chama várias vezes, e `TagWithCallSite()` acrescenta o
arquivo e a linha do código-fonte:

```csharp
db.Products.TagWith("Catalog: expensive products")
           .TagWith("Called from the price list screen")
           .TagWithCallSite()
           .Where(p => p.Price > 20);
// -- Catalog: expensive products
// -- Called from the price list screen
// -- File: .../log1.cs:48
//
// SELECT "p"."Id", "p"."Name", "p"."Price"
// FROM "Products" AS "p"
// WHERE "p"."Price" > 20.0
```

Como a tag faz parte do texto do SQL, ela também aparece nas ferramentas do
próprio banco (um slow query log, `pg_stat_statements`, um profiler), não só no
log da aplicação. Esse é o valor real dela.

### Interceptors: contar e alterar comandos

Logging observa. Um interceptor também pode modificar ou suprimir a operação.
`DbCommandInterceptor` é a classe base para comandos, e você a registra com
`AddInterceptors`, no `OnConfiguring` ou dentro do `AddDbContext`. Um pequeno
que conta comandos já basta para proteger contra N+1 num teste:

```csharp
public sealed class CommandCounter : DbCommandInterceptor
{
    public int Count; public List<string> Sql = [];
    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData e, InterceptionResult<DbDataReader> result)
    { Count++; Sql.Add(command.CommandText); return result; }
}

var ids = db.Products.Select(p => p.Id).ToList();               // 1 comando
foreach (var id in ids) _ = db.Products.Single(p => p.Id == id); // N comandos
// commands: 4   (1 + 3 linhas)
```

Cada hook tem versão sync e async, e são métodos separados. Na execução acima o
contador ficou em 0 depois de um `ToListAsync()` e foi para 1 só num `ToList()`
síncrono, porque ele sobrescreve apenas `ReaderExecuting`. Sobrescreva também
`ReaderExecutingAsync`, ou um endpoint async passa no seu teste sem ser contado.
Existem interceptors para conexões, transações, `SaveChanges` e materialização.

## Trade-offs

- **`EnableSensitiveDataLogging` e `ToQueryString` vazam dados.** Os dois
  imprimem valores de parâmetros, então um `INSERT` logado contém o que o
  usuário digitou.
  ```csharp
  if (env.IsDevelopment()) options.EnableSensitiveDataLogging();
  ```
- **`EnableDetailedErrors` tem custo em runtime.** O try-catch por leitura é o
  que torna a mensagem boa, e também é o motivo de vir desligado. Ligue enquanto
  diagnostica, não como configuração permanente de produção sem medir.
- **`LogTo` é para desenvolvimento, `ILogger` é para produção.** `LogTo` não tem
  sinks, scopes nem saída estruturada. Num app real, mande o EF Core pelo mesmo
  pipeline de logging do resto e filtre por categoria.
- **Logs de comando fazem barulho em escala.** Logar todo comando em
  `Information` inunda um serviço movimentado. Filtre em `Warning` e ligue a
  categoria de comandos só ao investigar, ou logue só os comandos lentos num
  interceptor.
- **Tags são literais de string, nunca parâmetros.** Uma tag não pode carregar
  id de usuário ou de requisição, porque vira texto do SQL, então uma tag por
  requisição produz um texto de comando diferente a cada requisição.
  ```csharp
  db.Orders.TagWith($"user {userId}"); // texto de SQL novo por usuário: evite
  ```
- **Interceptor mutável e compartilhado é bug de concorrência.** Interceptors de
  comando não são singletons por padrão, mas se você registra uma instância para
  vários contextos, `Count++` não é thread-safe. Use uma instância por contexto
  nos testes, e `Interlocked` ou lock se compartilhar.
- **Interceptors mudam comportamento, então mantenha-os simples.** Um
  interceptor que reescreve SQL é difícil de achar depois. Prefira `LogTo` ou
  `ILogger` quando só precisa observar.

## Documentation Links

- [Simple logging, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/simple-logging) (doc)
- [Using Microsoft.Extensions.Logging in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/extensions-logging) (doc)
- [Query tags, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tags) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [EntityFrameworkQueryableExtensions.ToQueryString, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.entityframeworkqueryableextensions.toquerystring) (doc)
