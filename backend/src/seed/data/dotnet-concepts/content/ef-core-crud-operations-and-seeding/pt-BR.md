---
version: 1.0
updatedAt: 2026-10-05
title: "Operações CRUD no EF Core e Seeding"
summary: Modelo, DbContext e registro com SQLite, Add versus SaveChanges, FindAsync e projeção, update e delete em massa, e seeding de dados de referência com UseSeeding e HasData.
---
## Objective

O EF Core troca SQL escrito à mão por objetos C#: você descreve suas tabelas como
classes, e um `DbContext` transforma o que você faz com esses objetos em
`INSERT`, `SELECT`, `UPDATE` e `DELETE`. O objetivo é ligar um contexto a um
banco (SQLite aqui, com o mesmo formato para PostgreSQL), escrever as quatro
operações de CRUD do jeito que o EF Core espera, saber quais chamadas tocam o
banco e quais só registram intenção, e semear os dados de referência que uma
foreign key exige antes de a primeira linha poder ser inserida.

## Use Cases

- Trocar uma `List<T>` em memória por trás de uma API de protótipo por um banco
  de verdade, sem mudar o contrato dos endpoints.
- Criar um jogo que referencia um gênero por foreign key, o que só funciona se
  os gêneros já existirem.
- Devolver uma tela de lista sem carregar entidades que a tela não mostra.
- Excluir ou atualizar uma linha por id com um único comando, sem carregá-la
  antes.

## Deep Dive

### Modelo, contexto, registro

O modelo são classes simples. Cada tabela é uma classe; uma foreign key é uma
propriedade de id mais uma propriedade de navegação opcional:

```csharp
public class Genre
{
    public int Id { get; set; }
    public required string Name { get; set; }
}

public class Game
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int GenreId { get; set; }       // a coluna da foreign key
    public Genre? Genre { get; set; }      // navegação, null a menos que carregada
    public decimal Price { get; set; }
    public DateOnly ReleaseDate { get; set; }
}
```

`required` faz o compilador exigir um valor na construção, o que combina com um
nome que nunca pode ser vazio. `GenreId` não é anulável, então todo jogo precisa
de um gênero: o relacionamento é obrigatório. Manter `GenreId` e `Genre` juntos
é um bom hábito: você consegue definir o id sem carregar a linha relacionada.

O contexto lista as tabelas como propriedades `DbSet<T>` e recebe sua
configuração por `DbContextOptions`:

```csharp
public class GameStoreContext(DbContextOptions<GameStoreContext> options) : DbContext(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<Genre> Genres => Set<Genre>();
}
```

Registre-o no SQLite com uma chamada. Ela registra o contexto como scoped (veja
o conceito de DI):

```csharp
var connString = builder.Configuration.GetConnectionString("GameStore");
builder.Services.AddSqlite<GameStoreContext>(connString);
```

Pacotes: `Microsoft.EntityFrameworkCore.Sqlite` para o provider e
`Microsoft.EntityFrameworkCore.Design` para as ferramentas do `dotnet ef`. Para
mirar o PostgreSQL depois, o modelo continua e só mudam o pacote do provider e a
chamada `UseNpgsql`.

### Create: `Add` registra intenção, `SaveChangesAsync` grava

```csharp
var game = new Game { Name = dto.Name, GenreId = dto.GenreId, Price = dto.Price, ReleaseDate = dto.ReleaseDate };
db.Games.Add(game);          // rastreado como Added; nada enviado ao banco ainda
await db.SaveChangesAsync(); // INSERT; game.Id agora é o valor gerado
```

`Add` só registra a entidade no change tracker. O banco é tocado no
`SaveChangesAsync`, que traduz todas as mudanças pendentes em SQL, numa única
transação. Esquecê-lo é um bug clássico: o endpoint responde `201` e nada foi
gravado. Depois da chamada, a entidade guarda o id que o banco gerou, que é o
que você coloca no header `Location`.

### Read: `FindAsync`, queries e projeção

`FindAsync(id)` busca pela chave primária, olhando primeiro o change tracker e
depois o banco, e devolve `null` quando não há linha:

```csharp
var game = await db.Games.FindAsync(id);
```

Para listas, escreva uma query LINQ e projete no formato que você vai devolver.
O EF Core traduz o join e seleciona só as colunas usadas, então `Include` não é
necessário, e `AsNoTracking` pula o change tracking porque nada será modificado:

```csharp
var games = await db.Games
    .Select(g => new GameSummaryDto(g.Id, g.Name, g.Genre!.Name, g.Price, g.ReleaseDate))
    .AsNoTracking()
    .ToListAsync();
```

O `!` depois de `Genre` diz ao compilador que a navegação não é nula dentro
desta query; o EF Core resolve isso no SQL. A query só roda no `ToListAsync`; até
lá é uma descrição. Se você carrega entidades em vez de projetar e depois lê
`game.Genre.Name`, precisa de `.Include(g => g.Genre)` ou `Genre` será `null`.

### Update: carregar, alterar, salvar

O change tracker lembra os valores originais do que carregou, então uma
atualização é só atribuir propriedades e salvar:

```csharp
var game = await db.Games.FindAsync(id);
if (game is null) return Results.NotFound();

game.Name = dto.Name;
game.Price = dto.Price;
await db.SaveChangesAsync();     // UPDATE só das colunas que mudaram
```

Para uma mudança de uma linha que não precisa de leitura antes, uma atualização
em massa roda um único comando e pula o tracker:

```csharp
await db.Games.Where(g => g.Id == id)
    .ExecuteUpdateAsync(s => s.SetProperty(g => g.Price, newPrice));
```

### Delete: `Remove` ou exclusão em massa

```csharp
db.Games.Remove(game);
await db.SaveChangesAsync();                       // carrega, depois exclui

await db.Games.Where(g => g.Id == id).ExecuteDeleteAsync();  // um comando, sem carregar
```

`ExecuteDeleteAsync` executa na hora e não precisa de `SaveChanges`. É eficiente
e idempotente (zero linhas afetadas quando o id já sumiu), o que combina com um
endpoint de `DELETE`.

### Seeding de dados de referência

Um jogo tem `GenreId` obrigatório, então inserir um jogo com a tabela `Genres`
vazia falha na foreign key. Os dados de referência precisam existir antes. O EF
Core tem dois mecanismos:

- **`HasData`** no `OnModelCreating` declara as linhas como parte do modelo,
  então elas entram nas migrations. Bom para valores fixos com ids explícitos.
- **`UseSeeding` e `UseAsyncSeeding`** (EF Core 9 em diante) rodam código depois
  que o banco é criado ou migrado. Bom para lógica e para dados que não valem
  ser codificados numa migration.

```csharp
builder.Services.AddSqlite<GameStoreContext>(connString, optionsAction: options => options
    .UseSeeding((context, _) =>
    {
        if (!context.Set<Genre>().Any())
        {
            context.Set<Genre>().AddRange(
                new Genre { Name = "Fighting" }, new Genre { Name = "Roleplaying" });
            context.SaveChanges();
        }
    })
    .UseAsyncSeeding(async (context, _, ct) =>
    {
        if (!await context.Set<Genre>().AnyAsync(ct))
        {
            context.Set<Genre>().AddRange(
                new Genre { Name = "Fighting" }, new Genre { Name = "Roleplaying" });
            await context.SaveChangesAsync(ct);
        }
    }));
```

Os dois são configurados porque `Migrate()` roda o síncrono e `MigrateAsync()` o
assíncrono. A guarda `Any()` torna o seed idempotente: ele roda a cada migrate,
não só na primeira vez. Num teste com um arquivo SQLite novo, chamar
`Database.Migrate()` na inicialização criou o schema e inseriu os gêneros de uma
vez.

## Trade-offs

- **`SaveChanges` é fácil de esquecer e fácil de usar demais.** `Add` nunca
  grava, e chamar `SaveChanges` depois de cada mudança transforma uma unit of
  work em vários round trips. Faça as mudanças e salve uma vez.
  ```csharp
  db.Games.Add(game);          // esqueceu o SaveChangesAsync: 201 devolvido, linha nunca gravada
  ```
- **Tracking custa memória e tempo.** O change tracker vale para
  carregar-alterar-salvar e é desperdício em endpoints só de leitura. Use
  `AsNoTracking` ou uma projeção para leituras.
- **`ExecuteUpdate` e `ExecuteDelete` em massa ignoram o tracker.** Entidades já
  carregadas no mesmo contexto ficam desatualizadas, e qualquer lógica C#
  pendurada no `SaveChanges` (interceptors, campos de auditoria) não roda.
- **A lógica de seed roda a cada migrate.** Um seed sem checagem de existência
  insere duplicatas na segunda inicialização. Prefira `HasData` para lookups
  pequenos e fixos com ids estáveis, e `UseSeeding` onde precisa de lógica
  condicional.
- **Propriedades de navegação convidam a suposições preguiçosas.** `game.Genre`
  é `null` a menos que a query o tenha carregado, e `Genre!` silencia o aviso,
  não a `NullReferenceException`. Projete em DTOs para que o formato da query e
  o formato do resultado sejam a mesma coisa.

## Lab

Neste lab você recebe um serviço de jogos e um helper de seed cujos métodos ainda lançam `NotImplementedException`. O seu trabalho é implementar o CRUD com EF Core sobre SQLite, projetar direto para DTOs e semear as linhas de referência de que uma chave estrangeira depende. A ideia central é sentir a diferença entre o que o change tracker sabe e o que realmente chegou ao banco, e quando vale carregar uma entidade ou emitir uma única instrução SQL.

**O cenário**

`Game` tem um `GenreId` obrigatório, então nenhum jogo pode ser guardado até a tabela `Genres` ter linhas. Os testes rodam contra um SQLite em memória e usam **um contexto novo para cada verificação**, de modo que um teste que passa prova que o dado chegou ao banco, e não apenas ao change tracker.

- `Models.cs`: as entidades `Game` e `Genre` e os DTOs `CreateGameDto`, `GameDetailsDto` e `GameSummaryDto`.
- `GameStoreContext.cs`: o `DbContext` com `Games` e `Genres`.
- `GameStoreDb.cs`: o seed dos cinco gêneros (`Fighting`, `Roleplaying`, `Sports`, `Racing`, `Kids and Family`) e o `ConfigureSeeding`.
- `GameService.cs`: o serviço com `CreateAsync`, `GetByIdAsync`, `ListAsync`, `UpdatePriceAsync`, `DeleteAsync` e um `SetPriceAsync` opcional.

**O que você vai fazer, passo a passo**

1. **Semear os gêneros de forma idempotente (TODO-00 e TODO-01).** Em `SeedGenres`, não faça nada se a tabela `Genres` já tem linhas (o seed roda a cada migrate); senão adicione um `Genre` por entrada de `GenreNames` e salve. Em `SeedGenresAsync`, faça o mesmo com os métodos assíncronos do EF Core.
2. **Plugar o seed nas opções (TODO-02).** Em `ConfigureSeeding`, ligue os dois métodos com `UseSeeding` (para `Migrate`/`EnsureCreated`) e `UseAsyncSeeding` (para as versões assíncronas).
3. **Criar (TODO-03).** Em `CreateAsync`, monte um `Game` a partir do DTO, adicione ao contexto, salve e devolva o id gerado pelo banco. Um jogo com gênero inexistente deve falhar com `DbUpdateException`.
4. **Ler um registro (TODO-04).** Em `GetByIdAsync`, busque pela chave primária; devolva `null` se não existir, senão um `GameDetailsDto` (nunca a própria entidade).
5. **Listar com projeção (TODO-05).** Em `ListAsync`, projete todos os jogos, ordenados por `Id`, direto em `GameSummaryDto` com o NOME do gênero, sem carregar entidades que você não vai modificar. O teste confere que o change tracker ficou vazio.
6. **Atualizar e apagar (TODO-06 e TODO-07).** Em `UpdatePriceAsync`, carregue o jogo, mude só o preço e salve, devolvendo `false` se ele não existir. Em `DeleteAsync`, apague com uma única instrução e sem carregar o jogo, sem falhar se o id não existir.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que o seed precisa ser idempotente, por que `ListAsync` não deixa nada rastreado e por que `DeleteAsync` não precisa de um `SELECT` antes do `DELETE`.

**Desafios opcionais**

- **TODO-08:** implemente `SetPriceAsync` com `ExecuteUpdateAsync`: um único `UPDATE`, sem tracking.
- **TODO-09:** ligue `LogTo(Console.WriteLine)` nas opções do teste e leia o SQL que `ListAsync` e `DeleteAsync` geram. Há um join? Há um `SELECT` antes do `DELETE`?

**Pré-requisitos:** C# e LINQ, `async`/`await`, conceitos básicos de EF Core (`DbContext`, `DbSet`) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. No estado inicial os métodos lançam `NotImplementedException` e os testes falham, com cada TODO marcado em comentário em `GameStoreDb.cs` e `GameService.cs`.

## Documentation Links

- [Getting started with EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/get-started/overview/first-app) (doc)
- [Saving data in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/) (doc)
- [ExecuteUpdate and ExecuteDelete, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
- [Tracking vs no-tracking queries, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tracking) (doc)
