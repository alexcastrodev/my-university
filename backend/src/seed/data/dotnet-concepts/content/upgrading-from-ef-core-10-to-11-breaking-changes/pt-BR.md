---
version: 1.1
updatedAt: 2026-11-14
title: "Do EF Core 10 para o 11: breaking changes"
summary: Roteiro de upgrade do EF Core 10 para o 11 com as quebras silenciosas reproduzidas no GA: Migrate() sem migrations, Property() sobre coleção primitiva, OwnsMany().ToJson() obsoleto e o compatibility level do SQL Server. Inclui as mudanças de pacotes (SqlClient 7, Tools, Sqlite) e as do provider Cosmos DB.
---
## Objective

Passar do EF Core 10 para o 11 é quase só trocar a versão dos pacotes, e esse é o
perigo: o projeto compila, e alguns comportamentos mudam mesmo assim. Três das
mudanças abaixo não geram nenhum erro de compilação. Uma faz uma aplicação que hoje
sobe normalmente lançar exceção na primeira requisição, uma faz uma consulta parar
de ser traduzida, e uma troca o SQL no SQL Server sem exceção alguma.

Este concept é o checklist de upgrade para essas mudanças. Cada item foi
reproduzido com o EF Core 11.0.0 no SQLite, ou com SQL do SQL Server gerado offline
por `ToQueryString()` (sem servidor), e comparado com o EF Core 10.0.14 quando a
diferença era o ponto. Itens tirados só da documentação estão marcados. Um lab
companheiro, que parte de código no estilo EF Core 10 sobre a 11.0.0 e pede para
corrigir cada quebra, está ligado a este concept. O lado das funcionalidades da
release está em `whats-new-in-ef-core-11`.

## Use Cases

- Planejar o upgrade de um serviço que está no LTS EF Core 10 e decidir o que
  testar primeiro.
- Revisar um pull request que troca os pacotes do EF e tem build verde.
- Descobrir por que uma suíte que chama `Migrate()` contra um contexto sem
  migrations passou a falhar depois da troca.
- Conferir se um provider do qual você depende já tem release para o EF Core 11.

## Deep Dive

### Uma ordem segura para o upgrade

1. Troque `Microsoft.EntityFrameworkCore.*` e o provider juntos, e o target
   framework para `net11.0`. O EF Core 11 exige o .NET 11.
2. Compile e leia os warnings, não só os erros. Mapeamentos obsoletos e o
   analisador `EF1004` aparecem aqui.
3. Rode a suíte inteira, incluindo os testes que chamam `EnsureCreated()` e
   `Migrate()`.
4. Em uma cópia de um banco real, rode as consultas que importam e compare o SQL.
   `ToQueryString()` ou `LogTo` deixam a comparação barata.
5. Só então mexa na produção, com a disciplina de migrations de
   `applying-migrations-in-production`.

### 1. Migrate() sem migrations agora lança exceção

Um projeto que nunca adicionou uma migration mas chama `Database.Migrate()` na
inicialização voltava sem erro no EF Core 10. No EF Core 11 ele lança:

```text
InvalidOperationException: An error was generated for warning
'Microsoft.EntityFrameworkCore.Migrations.MigrationsNotFound':
No migrations were found in assembly 'up'. A migration needs to be added before
the database can be updated. This exception can be suppressed or logged by passing
event ID 'RelationalEventId.MigrationsNotFound' ...
```

A verificação é "o assembly tem zero migrations": `GetMigrations().Count()` deu `0`
no teste. Há duas correções honestas. Se o projeto realmente não tem migrations,
crie o esquema a partir do modelo com `EnsureCreated()`. Se deveria ter, adicione a
primeira. Ignorar o evento também funciona, e `Migrate()` então retorna sem criar
nada:

```csharp
options.ConfigureWarnings(w => w.Ignore(RelationalEventId.MigrationsNotFound));
// Migrate() retorna, e a tabela Things não existe: o esquema continua vazio
```

No SQLite, depois do `Migrate()` com o evento ignorado, a `sqlite_master` não tinha
tabela para a entidade. Suprimir o warning esconde o erro e mantém o bug. Suítes de
teste que migram um banco por teste são a vítima mais comum; veja
`testing-ef-core-queries-concurrency-and-migrations`.

### 2. Property() não cria mais coleção primitiva

No EF Core 10, `Property(c => c.Tags)` sobre uma `List<string>` bastava, e
`c.Tags.Contains("a")` era traduzido. No EF Core 11 o mesmo mapeamento compila,
grava e carrega, mas a consulta falha em tempo de execução:

```csharp
modelBuilder.Entity<Customer>().Property(c => c.Tags);
db.Customers.Where(c => c.Tags.Contains("a")).ToList();
// InvalidOperationException: The LINQ expression 'DbSet<Customer>() ... Contains("a")'
//   could not be translated. ... Translation of method 'System.Linq.Enumerable.Contains' failed.
```

A correção é a chamada explícita:

```csharp
modelBuilder.Entity<Customer>().PrimitiveCollection(c => c.Tags);
```

```sql
-- SQLite
WHERE 'a' IN (SELECT "t"."value" FROM json_each("c"."Tags") AS "t")
-- SQL Server, offline
WHERE N'a' IN (SELECT [t0].[value] FROM OPENJSON([t].[Tags]) WITH ([value] nvarchar(max) '$') AS [t0])
```

No SQL Server a falha com `Property()` também reproduziu (offline). No
compatibility level 170 com o tipo `json`, a mesma consulta vira
`JSON_CONTAINS([t].[Tags], N'a') = 1`. Como a falha só aparece quando a consulta
executa, procure por `Property(` sobre membros `List<` e arrays e cubra cada um com
um teste. As regras de mapeamento estão em `ef-core-model-building-conventions-and-fluent-api`.

### 3. OwnsMany(...).ToJson() é obsoleto

Uma coleção owned mapeada para JSON sem chave explícita ainda funciona, mas a
validação do modelo registra `RelationalEventId.OwnedEntityMappedToJsonCollectionWarning`:

```text
The entity type 'Note' is an owned entity type mapped to JSON as a collection, which
uses a synthesized ordinal key. Mapping owned entity collections to JSON is obsolete;
map it as a complex type collection or configure a non-shadow key instead.
```

Troque por uma coleção complexa:

```csharp
// antes
customer.OwnsMany(c => c.Notes, n => n.ToJson());
// depois
customer.ComplexCollection(c => c.Notes, n => n.ToJson());
```

O formato armazenado não mudou em um teste: as linhas gravadas com
`OwnsMany(...).ToJson()` continham `[{"Text":"a"},{"Text":"b"}]`, e um contexto que
mapeia a mesma propriedade como coleção complexa as leu de volta como `a` e `b`.
Foi um tipo simples no SQLite, então compare o JSON armazenado em uma cópia antes de
publicar. Para o warning não voltar, faça-o quebrar a execução dos testes:

```csharp
options.ConfigureWarnings(w => w.Throw(RelationalEventId.OwnedEntityMappedToJsonCollectionWarning));
```

Complex types diferem de owned entities em identidade e rastreamento; veja
`json-columns-and-complex-types`.

### 4. SQL Server: o compatibility level padrão subiu

Sem `UseCompatibilityLevel`, o EF Core 11 assume o nível 160 (SQL Server 2022).
Consultas que antes rodavam no cliente passam para o servidor:

```csharp
db.Scores.Select(s => Math.Max(s.Rating, s.Views)).ToQueryString();
// EF Core 10:  SELECT [s].[Rating], [s].[Views]
// EF Core 11:  SELECT GREATEST([s].[Rating], [s].[Views])
```

Um banco SQL Server 2019 não tem `GREATEST`, então a consulta falha no servidor, em
tempo de execução. Diga ao provider o nível real:

```csharp
options.UseSqlServer(cs, sql => sql.UseCompatibilityLevel(150));  // SQL Server 2019
```

Com 150, o SQL offline voltou à forma no cliente. O tipo de coluna `json` exige o
nível 170, como no EF Core 10, então nada muda aí. Um teste de integração que chama
`ToQueryString()` e confere `DoesNotContain("GREATEST")` é barato e não precisa de
servidor.

### 5. Ferramentas de build e analisadores

- **`EF1004`**: chamar `ToAsyncEnumerable()` sobre um `IQueryable` itera de forma
  síncrona, e o build da 11.0.0 avisa. A correção é `AsAsyncEnumerable()`. Se o
  build trata warnings como erro, espere falhas novas aqui.
- **`EFOptimizeContext`** (só documentação): a página de breaking changes lista a
  propriedade MSBuild como removida, substituída por `EFScaffoldModelStage` e
  `EFPrecompileQueriesStage`. Modelos compilados e precompiled queries continuam
  experimentais, então não leia a troca de nome como estabilidade.
  `native-aot-and-its-limits` cobre onde isso importa.
- **SQL gerado em snapshots**: testes que comparam o texto de `ToQueryString()` com
  uma string guardada vão falhar onde o SQL ficou mais enxuto. Revise cada diferença
  em vez de aceitar todas.

### 6. Providers e ferramentas que você não controla

Se o upgrade é possível depende do provider. As listagens do NuGet em 12 de
novembro de 2026 mostravam os providers da Microsoft (SQL Server, SQLite, Cosmos DB)
na 11.0.0; o provider do MongoDB na 10.0.5; o Pomelo MySQL ainda na 9.0.0, sem
release para o 10 nem para o 11; e o `MySql.EntityFrameworkCore` estável na 10.0.12
com a 11.0.0 em preview. Trate isso como retrato do registro, não como algo que foi
executado. Para um provider sem build para o EF Core 11, a resposta é ficar no 10
até existir um. `ef-core-ado-net-dapper-and-nosql` discute a escolha de providers.

Mais uma nota de ferramenta: mantenha o `dotnet ef` na mesma versão maior dos
pacotes e fixe-o em um tool manifest, para a CLI não ficar mais antiga que o projeto.

### 7. Mudanças de pacote que passam despercebidas

Estas vêm dos arquivos `.nuspec` no NuGet (10.0.14 contra 11.0.0) e da página de
breaking changes. Nenhum servidor nem tenant foi usado, então o que elas fazem em
tempo de execução fica para você confirmar.

- **Autenticação no SQL Server.** O `Microsoft.EntityFrameworkCore.SqlServer` 11.0.0
  depende do `Microsoft.Data.SqlClient` 7.1.1 (o 10.0.14 dependia do 6.1.7). O
  SqlClient 6.1.7 listava `Azure.Core` e `Azure.Identity` como dependências, e o
  7.1.1 não lista. A documentação diz que, se você usa um modo Entra ID como
  `ActiveDirectoryDefault`, `ActiveDirectoryManagedIdentity` ou
  `ActiveDirectoryServicePrincipal`, agora precisa adicionar você mesmo o
  `Microsoft.Data.SqlClient.Extensions.Azure`. Esse pacote existe e traz
  `Azure.Identity` e `Microsoft.Identity.Client`. `ActiveDirectoryPassword` ficou
  obsoleto. O build não avisa: a falha é uma conexão que não consegue autenticar.
- **`dotnet ef` e Package Manager Console.** O `Microsoft.EntityFrameworkCore.Tools`
  10.0.14 dependia do `Microsoft.EntityFrameworkCore.Design` em cada target
  framework. O 11.0.0 não tem dependência nenhuma. Se um projeto só referenciava o
  `Tools` e recebia o `Design` de graça, adicione-o explicitamente com
  `PrivateAssets="all"`.
- **Microsoft.Data.Sqlite.** O `Microsoft.Data.Sqlite.Core` 10.0.14 tinha como alvo
  `netstandard2.0` e `net8.0`, e o 11.0.0 tem só `net10.0`, então não dá mais para
  usá-lo no .NET Framework. O provider SQLite do EF Core passou o `SQLitePCLRaw` de
  2.1.13 para 3.0.5. A documentação acrescenta que os bundles `bundle_green`,
  `bundle_e_sqlcipher`, `bundle_sqlite3`, `bundle_winsqlite3` e `bundle_e_sqlite3mc`
  não são compatíveis com o `SQLitePCLRaw.Core` 3, o que importa se você referencia
  um deles diretamente para criptografia.

### 8. Provider do Azure Cosmos DB

O provider do Cosmos tem o maior número de breaking changes desta release. Para
comparar, montei o mesmo modelo Cosmos (uma chave de partição e um endereço owned ou
complexo) no 10.0.14 e no 11.0.0 e inspecionei o modelo, sem conectar a banco nenhum.
O que isso mostrou está marcado "conferido". O resto é a documentação.

| Mudança | Situação |
|---|---|
| I/O síncrono acabou de vez. `CosmosEventId.SyncNotSupported` existe no 10.0.14 e não existe no 11.0.0, então um opt-in via `ConfigureWarnings` deixa de compilar. Um `ToList()` síncrono lança `InvalidOperationException: Azure Cosmos DB does not support synchronous I/O`. | conferido |
| `__jObject` foi removido. O modelo do 10.0.14 tinha as shadow properties `$type` e `__jObject`. O do 11.0.0 tem só `Discriminator`. | conferido |
| O discriminator se chama `Discriminator` no modelo, e o nome no JSON continua `$type` (`GetJsonPropertyName()` nas duas versões), então os documentos armazenados são iguais. Código que usava `EF.Property<string>(e, "$type")` precisa usar `"Discriminator"`. | conferido, o conselho de código vem da doc |
| Propriedades JSON sem mapeamento não são mais preservadas. Elas passavam pelo `__jObject` na ida e na volta, e agora um documento lido e salvo perde qualquer propriedade que o modelo não mapeia. É o único item de impacto High da página. | só documentação |
| Caracteres ilegais de `id` (`/`, `\`, `?`, `#`) não são mais escapados em ids compostos. Documentos existentes com ids no estilo `^2F` deixam de ser encontrados. `AppContext.SetSwitch("Microsoft.EntityFrameworkCore.EscapeIllegalCosmosIdCharacters", true)` restaura o comportamento antigo, e essa string está no assembly 11.0.0. | nome do switch conferido, comportamento da doc |
| Uma projeção que resulta em `undefined` agora lança `InvalidOperationException`, tanto para uma propriedade quanto para várias. Use `EF.Functions.IsDefined` para filtrar, ou `CoalesceUndefined` para dar um padrão. | só documentação |
| Coleções owned vazias são materializadas vazias, não `null`. | só documentação |
| Um valor de ponto flutuante materializado em `int`, `long` ou `decimal` é truncado em vez de arredondado, então `0.75` vira `0`. | só documentação |

Duas dessas podem perder ou esconder dados sem erro: as propriedades sem mapeamento e
o escape de id. Antes do upgrade, liste as propriedades que existem nos seus
documentos e não no modelo (outro serviço ou um script pode gravá-las) e confira se
algum valor de chave composta contém um dos quatro caracteres.

A documentação também diz que o provider não depende mais do `Newtonsoft.Json`. O
`.nuspec` da 11.0.0 ainda lista o `Newtonsoft.Json` 13.0.4 como dependência,
provavelmente por causa do SDK do Cosmos, e não investiguei. Não remova a sua própria
referência ao `Newtonsoft.Json` só por isso.

### O que não quebrou

Coisas conferidas que funcionaram na 11.0.0: complex types mapeados para JSON, e
`EnsureCreated()` criando uma hierarquia table-per-type com uma propriedade complexa
em JSON. As mudanças de SQL gerado em `whats-new-in-ef-core-11` são melhorias, não
regressões, mas são mudanças mesmo assim, e o snapshot de uma migration nova ganha a
linha `LastMigrationId` descrita lá.

## Trade-offs

- **Atualizar agora ou ficar no LTS.** O EF Core 10 tem suporte até 10 de novembro de
  2028. As quebras acima são pequenas e cada uma tem uma correção curta, então o
  custo real é a verificação. Um time com testes fracos pode preferir ficar no 10 até
  melhorar a rede de segurança, e um time que quer o SQL novo pode ir agora.
- **Corrigir a chamada ou suprimir o warning.** `Ignore(MigrationsNotFound)` faz o
  sintoma sumir e deixa o esquema vazio. Corrija a causa: crie o esquema ou adicione
  a migration.
- **Um teste que lança em warnings deixa o upgrade barulhento.** Promover
  `OwnedEntityMappedToJsonCollectionWarning` a erro é útil no CI, e também quebra o
  build de todo modelo que ainda tem o mapeamento antigo, o que pode ser mais do que
  o branch de upgrade aguenta.
  ```csharp
  w.Throw(RelationalEventId.OwnedEntityMappedToJsonCollectionWarning)
  ```
- **Fixe o compatibility level, mesmo quando o padrão está certo.** Defini-lo
  explicitamente transforma um padrão silencioso em uma decisão visível, que
  sobrevive à próxima mudança de padrão.
- **SQL offline é evidência, não prova.** `ToQueryString()` mostra o que o EF gera
  para o SQL Server, e um servidor de nível mais antigo ainda pode rejeitar. Mantenha
  um teste contra uma instância real da versão mais antiga que você suporta.

## Documentation Links

- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Microsoft.EntityFrameworkCore, NuGet](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore) (doc)
- [SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/) (doc)
- [Applying migrations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying) (doc)
- [Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/) (doc)
- [Microsoft.Data.SqlClient.Extensions.Azure, NuGet](https://www.nuget.org/packages/Microsoft.Data.SqlClient.Extensions.Azure) (doc)
