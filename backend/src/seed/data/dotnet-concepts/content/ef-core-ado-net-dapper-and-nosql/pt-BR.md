---
version: 1.0
updatedAt: 2026-10-15
title: "EF Core, ADO.NET, Dapper e a Escolha da Abordagem de Acesso a Dados"
summary: Três camadas sobre a mesma conexão, a mesma consulta nas três formas com tempos medidos, como misturá-las numa transação, providers do EF Core e o efeito do Native AOT.
---
## Objective

O .NET oferece três formas comuns de falar com um banco, e elas não são
alternativas no mesmo nível: são camadas. ADO.NET é a API base que todo driver
relacional implementa. Dapper é um pequeno conjunto de extension methods que
mapeia linhas para objetos em cima dela. EF Core é um ORM completo (LINQ, change
tracking, migrations, um modelo) que, por baixo, também passa por um provider
ADO.NET. Este conceito roda a mesma consulta nas três, mostra o que cada uma
custa e o que entrega, e dá um critério de escolha, inclusive para quando usar
duas delas na mesma unit of work. Cobre também como os providers do EF Core são
empacotados e versionados, porque isso decide a quais bancos você chega,
relacionais ou não.

## Use Cases

- Começar uma API de negócio nova e decidir se o EF Core basta ou se um caminho
  de leitura quente deve descer para SQL.
- Adicionar um relatório que junta cinco tabelas, em que o SQL escrito à mão é
  mais claro que o LINQ que o geraria.
- Portar um app legado que ainda usa Entity Framework 6.
- Escrever uma ferramenta pequena ou um serviço Native AOT em que tempo de
  startup e reflection pesam mais que um modelo rico.

## Deep Dive

### Três camadas, uma conexão

O ADO.NET define os tipos abstratos `DbConnection`, `DbCommand` e
`DbDataReader`, e cada driver fornece os concretos (`SqliteConnection`,
`NpgsqlConnection`, `SqlConnection`). Você escreve o SQL, define parâmetros, lê
colunas por posição e cuida do mapeamento. O Dapper acrescenta métodos como
`QueryAsync<T>` e `ExecuteAsync` em `IDbConnection`: o SQL continua visível, mas
o mapeamento para objetos é automático. Os providers relacionais do EF Core ficam
sobre os mesmos tipos do ADO.NET: quando você chama `ToListAsync`, o EF Core
monta um `DbCommand` e lê um `DbDataReader`, exatamente como na primeira opção.
Por isso o EF Core sempre paga o trabalho do ADO.NET mais o dele. A pergunta
real é o tamanho desse custo extra e o que você recebe em troca.

### A mesma consulta de três formas

Uma tabela com 20.000 produtos num arquivo SQLite, uma consulta: produtos de uma
categoria acima de um preço, ordenados por preço (800 linhas). As três devolvem
resultados idênticos (`same=True` na execução).

```csharp
// ADO.NET: você escreve o SQL, os parâmetros e o mapeamento.
await using var conn = new SqliteConnection(cs);
await conn.OpenAsync();
await using var cmd = conn.CreateCommand();
cmd.CommandText = "SELECT Id, Name, Price FROM Products WHERE CategoryId = @c AND Price >= @min ORDER BY Price";
cmd.Parameters.AddWithValue("@c", categoryId);
cmd.Parameters.AddWithValue("@min", minPrice);
var list = new List<ProductRow>();
await using var r = await cmd.ExecuteReaderAsync();
while (await r.ReadAsync())
    list.Add(new ProductRow(r.GetInt32(0), r.GetString(1), r.GetDouble(2)));

// Dapper: você escreve o SQL, o mapeamento é pelo nome da coluna.
await using var conn = new SqliteConnection(cs);
var rows = await conn.QueryAsync<ProductRow>(
    "SELECT Id, Name, Price FROM Products WHERE CategoryId = @categoryId AND Price >= @minPrice ORDER BY Price",
    new { categoryId, minPrice });

// EF Core: você escreve LINQ, o EF Core escreve o SQL.
var rows = await db.Products.AsNoTracking()
    .Where(p => p.CategoryId == categoryId && p.Price >= minPrice)
    .OrderBy(p => p.Price)
    .Select(p => new ProductRow(p.Id, p.Name, p.Price))
    .ToListAsync();
```

`ToQueryString()` na consulta do EF Core imprime o SQL que será enviado. Ele tem
a mesma forma do escrito à mão (o `CAST` aparece porque o tipo da linha pede
`long` e a entidade tem `int`):

```
SELECT CAST("p"."Id" AS INTEGER), "p"."Name", "p"."Price"
FROM "Products" AS "p"
WHERE "p"."CategoryId" = 3 AND "p"."Price" >= 100.0
ORDER BY "p"."Price"
```

Aqui os dois valores saíram inline porque eram locais `const`. Uma variável vira
parâmetro de verdade (`@variableId`), o que conferi imprimindo os dois casos.
Dapper e EF Core parametrizam por você; no ADO.NET só se você usar `Parameters`,
nunca concatenação de string.

### Quanto custa, medido

Um loop de tempo simples (aquecimento, depois a mediana de 15 rodadas de 200
chamadas, conexão ou contexto novo a cada chamada, sem BenchmarkDotNet) em
.NET 10.0.0, macOS 27.0.1, Arm64, 14 núcleos, arquivo SQLite no mesmo processo,
800 linhas por consulta. Duas execuções completas deram o mesmo desenho:

```
ADO.NET                    0.38 ms/consulta
Dapper                     0.45 ms/consulta
EF Core tracked entities   0.73 ms/consulta
EF Core NoTracking+Select  0.79 a 0.81 ms/consulta
```

Leia pelo formato, não pelos dígitos. O Dapper soma uma constante pequena sobre
o ADO.NET puro, o EF Core soma cerca de 0,35 ms a mais aqui, e como o banco roda
no mesmo processo não há rede: este é quase o pior caso para o overhead relativo
do EF Core. Num resultado pequeno como este, `AsNoTracking` com projeção não foi
mais rápido que o tracking; o ganho só aparece com mais linhas ou muitas
entidades repetidas, então meça a sua consulta antes de tratar isso como regra.

### Streaming e mistura

Carregar 800 linhas numa lista é aceitável; um milhão não é. As três formas
conseguem ler uma linha por vez (saída da execução, cinco linhas):

```csharp
while (await reader.ReadAsync()) { ... }                  // ADO.NET: P1 P2 P3 P4 P5
await foreach (var p in conn.QueryUnbufferedAsync<NameRow>(sql)) { ... } // Dapper
await foreach (var p in db.Products.AsNoTracking().AsAsyncEnumerable()) { ... } // EF Core
```

Raramente você precisa escolher só uma. Um desenho comum é EF Core para
escritas e leituras simples, e algumas consultas à mão onde o LINQ atrapalha. Elas
podem compartilhar a conexão e a transação, e a unit of work continua atômica:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
var conn = db.Database.GetDbConnection();
var affected = await conn.ExecuteAsync(
    "UPDATE Products SET Price = Price * 2 WHERE CategoryId = @c",
    new { c = 1 }, tx.GetDbTransaction());      // Dapper dentro da transação do EF Core
await tx.RollbackAsync();                        // affected foi 5, os preços voltaram ao original
```

`GetDbTransaction` é uma extension em `Microsoft.EntityFrameworkCore.Storage`.
Se tudo que você precisa é uma consulta SQL para um tipo que não é entidade, o
EF Core já tem: `db.Database.SqlQuery<NameRow>($"SELECT Name FROM Products WHERE Price > {25}")`
(veja "Raw SQL, safely" no conceito de tradução de consultas).

### Providers, versões e o EF legado

Um provider do EF Core é um pacote NuGet para um motor de banco:
`Microsoft.EntityFrameworkCore.SqlServer`, `.Sqlite`, `.InMemory` e `.Cosmos`
vêm do time do EF Core, enquanto PostgreSQL, MySQL e Oracle vêm de outros
fornecedores. Bancos não relacionais também têm providers: Cosmos DB do time do
EF Core e MongoDB da própria MongoDB, ambos listados para EF Core 8, 9 e 10. A
lista oficial avisa que providers em geral não funcionam entre versões maiores
do EF Core, então um provider de terceiros pode atrasar uma versão. O EF Core 10
saiu em novembro de 2025 como release LTS com suporte até 10 de novembro de 2028,
e exige o SDK do .NET 10 para compilar e o runtime do .NET 10 para rodar: não
roda em versões anteriores do .NET nem no .NET Framework. O Entity Framework 6 é
estável, mas não recebe mais desenvolvimento ativo; a orientação é mantê-lo
quando o código de dados é estável e portar para o EF Core quando ele evolui.

### O Native AOT muda a escolha

Um file-based app (`dotnet run app.cs`) habilita publicação Native AOT por padrão
no SDK do .NET 10. Minha primeira execução do código com Dapper falhou na hora
com `PlatformNotSupportedException: Dynamic code generation is not supported on
this platform`, porque o Dapper gera os mapeadores de linha em tempo de execução;
a correção foi `#:property PublishAot=false`. O Dapper tem um gerador separado,
em tempo de build, o Dapper.AOT, para esse caso. O suporte do EF Core a Native
AOT e a consultas pré-compiladas continua documentado como experimental e não
recomendado para produção, então num serviço Native AOT o ADO.NET puro é a opção
sem ressalvas.

## Trade-offs

- **O EF Core esconde o SQL, então você precisa olhá-lo.** Um LINQ que lê bem
  pode gerar um comando ruim. `ToQueryString()` e o logging deixam isso visível;
  pular essa etapa é como N+1 e leituras sem limite chegam à produção.
  ```csharp
  Console.WriteLine(query.ToQueryString());
  ```
- **O Dapper mapeia por nome e pelos tipos do provider.** A primeira versão do
  meu `ProductRow` usava `int Id` e o Dapper lançou `A parameterless default
  constructor or one matching signature (System.Int64 Id, System.String Name,
  System.Double Price) is required`, porque o SQLite devolve inteiros de 64 bits.
  O mesmo código funciona num banco que devolve `int`, o que faz disso uma
  armadilha de portabilidade.
  ```csharp
  record ProductRow(long Id, string Name, double Price); // casa com o que o SQLite devolve
  ```
- **O ADO.NET não tem rede de proteção.** Posições de coluna quebram em silêncio
  quando o SELECT muda, e SQL concatenado é injeção. A velocidade vem de você
  fazer o trabalho.
  ```csharp
  r.GetInt32(0) // falha em runtime se alguém reordenar as colunas
  ```
- **Duas ferramentas numa requisição precisam de uma conexão.** Uma chamada
  Dapper com conexão própria não enxerga as mudanças não commitadas do EF Core
  nem a transação dele. Reuse `db.Database.GetDbConnection()` e passe a
  transação, como mostrado acima.
- **SQL bruto amarra você a um banco.** A consulta escrita à mão funciona no
  SQLite e pode precisar de reescrita para PostgreSQL, enquanto a versão LINQ é
  portável entre providers relacionais (salvo funções específicas de provider).
- **A diferença medida é real e pequena.** Uma fração de milissegundo por
  consulta importa num caminho chamado milhares de vezes por segundo e raramente
  fora dele. Otimize a consulta e os índices primeiro.

## Lab

Neste lab você passa o mesmo pequeno domínio por três camadas de acesso a dados (ADO.NET puro, Dapper e EF Core) sobre um único banco SQLite em memória, e termina com um repositório de documentos minúsculo. Você recebe o esquema e os dados de teste prontos, e as classes de acesso são stubs que lançam `NotImplementedException`. A ideia central é sentir o que cada ferramenta custa e o que entrega (SQL e mapeamento manual, SQL manual com mapeamento automático, LINQ com change tracking), misturar duas delas numa mesma transação e ver o que se ganha e se perde quando o formato dos dados é flexível. Tudo roda dentro do processo de teste: sem servidor, sem Docker, sem rede.

**O cenário**

O domínio tem categorias e produtos. A coluna de preço se chama `unit_price`, mas a propriedade se chama `UnitPrice`, de propósito.

- `Schema.cs` (pronto): cria `Categories`, `Products` (com `CHECK (unit_price >= 0)`) e `Documents`, e semeia as categorias Books, Games e Empty.
- `AdoNetProducts.cs`, `DapperProducts.cs`, `EfProducts.cs`: os stubs a implementar, um por ferramenta.
- `DocumentStore.cs`: o repositório de chave e documento JSON (opcional).
- `AppDbContext.cs` e `Models.cs` (prontos): o contexto do EF Core e as entidades `Product` e `Category`.

Cada teste abre uma conexão em memória e a mantém aberta, então o banco vive o tempo do teste.

**O que você vai fazer, passo a passo**

1. **ADO.NET na mão (TODO-00).** Em `FindByCategory` e `Add`, use `SqliteCommand` com parâmetros (nunca concatenação) e mapeie o `SqliteDataReader` linha a linha. `Add` usa `INSERT ... RETURNING Id` e respeita `cmd.Transaction`. Uma entrada hostil como `x'); DROP TABLE Products; --` deve ser gravada literalmente.
2. **Transação (TODO-01).** Em `AddAll`, insira tudo numa transação: se uma linha violar o `CHECK`, nada pode ficar gravado.
3. **Dapper (TODO-02).** Em `FindByCategory`, use `Query<T>` com um objeto anônimo de parâmetros e faça `unit_price` mapear para `UnitPrice` (`DefaultTypeMap.MatchNamesWithUnderscores` ou um alias no `SELECT`). O resultado deve ser igual ao do ADO.NET.
4. **Sem N+1 (TODO-03).** Em `CategoriesWithProducts`, traga todas as categorias (inclusive a vazia) com seus produtos numa só query: `LEFT JOIN`, `Query<Category, Product?, Category>` com `splitOn` e um dicionário para reaproveitar a `Category`.
5. **EF Core somente leitura (TODO-04).** Em `ListReadOnly`, escreva a mesma consulta em LINQ sem change tracking. O teste confere que `ChangeTracker.Entries()` fica vazio, enquanto uma consulta normal rastreia.
6. **Misturar na mesma transação (TODO-05).** Em `RaisePrices`, abra uma transação do EF, compartilhe `db.Database.GetDbConnection()` e passe `tx.GetDbTransaction()` ao Dapper para multiplicar os preços. Com `commit` falso tudo deve ser desfeito.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar quando escolheria cada ferramenta e por que o Dapper atualizou 3 linhas mesmo no cenário de rollback sem deixar rastro.

**Desafios opcionais**

- **TODO-06:** `DocumentStore` faz `Put`, `Get` e `FindKeys` por caminho JSON (`json_extract`). Repare que nada impede um documento de apontar para uma categoria inexistente.
- **TODO-07:** `DapperProducts.AddAll` insere uma lista inteira com uma única chamada a `Execute`.

**Pré-requisitos:** C# e LINQ básicos, SQL básico (SELECT, JOIN, INSERT, transações), noções de EF Core e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método começa lançando `NotImplementedException` com um comentário `TODO-NN` dizendo o que fazer, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Entity Framework Core overview, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/) (doc)
- [Database providers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/) (doc)
- [Compare EF6 and EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/efcore-and-ef6/) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Microsoft.Data.Sqlite overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/) (doc)
- [NativeAOT support and precompiled queries (experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [File-based apps, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [Dapper, GitHub](https://github.com/DapperLib/Dapper) (doc)
