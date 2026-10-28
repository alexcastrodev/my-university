---
version: 1.0
updatedAt: 2026-10-28
title: "Diferenças entre providers do EF Core: PostgreSQL, SQL Server e SQLite"
summary: O mesmo modelo do EF Core 10 medido no PostgreSQL 18 e no SQLite, com o SQL Server pela documentação: case sensitivity e collations, DateTime e DateTimeOffset, decimal, chaves e GUIDs, migrations, arrays, JSON e enums, tokens de concorrência e a armadilha de testar no SQLite.
---
## Objective

O EF Core dá a todo provider relacional a mesma LINQ e a mesma API de modelo, então é fácil acreditar que um `DbContext` se comporta igual no PostgreSQL, no SQL Server e no SQLite. Não se comporta. O provider decide os tipos de coluna, o SQL em que cada operador vira, quais valores ele se recusa a gravar, como as chaves são geradas, o que uma migration consegue fazer e se um token de concorrência é de verdade. Esta lição mantém um único modelo e um único conjunto de consultas LINQ e roda tudo no PostgreSQL 18.6 (um cluster local descartável) e no SQLite, e depois mostra o que mudou: comparação de strings e collations, `DateTime` e `DateTimeOffset`, `decimal`, chaves e GUIDs, migrations, arrays, JSON e enums, tokens de concorrência, e por que uma suíte de testes no SQLite prova pouco sobre a produção no PostgreSQL. O SQL Server não estava disponível, então para ele eu só gerei DDL e SQL com `UseSqlServer` configurado e nunca aberto, e tudo sobre o comportamento dele em runtime é atribuído à documentação. Versões usadas: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Microsoft.EntityFrameworkCore.SqlServer` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (com `Npgsql` 10.0.3), PostgreSQL 18.6.

## Use Cases

- Escolher o banco de produção e querer saber quais partes do modelo vão precisar de configuração específica do provider.
- Migrar uma aplicação do SQL Server para o PostgreSQL, onde buscas case-insensitive e valores `DateTime` locais de repente quebram.
- Decidir se os testes de integração podem rodar no SQLite in-memory ou precisam rodar no motor real.
- Revisar um pull request que adiciona um `decimal`, um `DateTimeOffset`, um array ou um token de concorrência, e prever como cada provider vai guardá-lo.

## Deep Dive

### Um modelo, três providers

O modelo tem quatro entidades: `Person` (strings), `Event` (`DateTime`, `DateTimeOffset`, `DateOnly`, `TimeOnly`), `Item` (`decimal`, `string[]`, um enum, um complex type em JSON, um token de concorrência) e `Doc` (uma chave `Guid`). O provider é escolhido em `OnConfiguring`, e algumas linhas de `OnModelCreating` são específicas de provider de propósito, para as diferenças ficarem visíveis:

```csharp
_ = prov switch
{
    "pg"     => o.UseNpgsql("Host=127.0.0.1;Port=5831;...", n => n.MapEnum<Mood>("mood")),
    "sqlite" => o.UseSqlite("Data Source=prov.db"),
    _        => o.UseSqlServer("Server=nowhere;..."),   // nunca aberto
};
```

Sobre a versão: o NuGet lista `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 como a última estável (a 11.0.0 está no rc.3), e o nuspec dela depende de `Microsoft.EntityFrameworkCore` `[10.0.0, 11.0.0)`. A versão major do Npgsql acompanha a do EF Core, então EF Core 10 precisa do Npgsql 10.x. `GenerateCreateScript()` não precisa de conexão, então ele gerou o DDL dos três providers. Cito partes dele abaixo.

### Strings: a mesma LINQ, linhas diferentes

Inseri `alice`, `Alice`, `élan` e `Élan` numa coluna de string comum e rodei as mesmas cinco consultas nos dois motores:

```text
LINQ                     PostgreSQL (text)        SQLite (TEXT)
== "ALICE"               []                       []
Contains("LIC")          []                       []
StartsWith("AL")         []                       [alice, Alice]
Like(Name, "al%")        [alice]                  [alice, Alice]
Like(Name, "él%")        [élan]                   [élan]
```

O SQL explica a diferença. Os dois providers transformaram `StartsWith("AL")` em `LIKE 'AL%'`, mas o `LIKE` do SQLite ignora maiúsculas e minúsculas em ASCII e o do PostgreSQL não. `Contains("LIC")` virou `LIKE '%LIC%'` no Npgsql e `instr("p"."Name", 'LIC') > 0` no SQLite, e `instr` é case-sensitive. No SQLite o `É` não ASCII nunca foi normalizado: `Like("él%")` não encontrou `Élan`. Para o SQL Server eu só gerei o SQL (`WHERE [p].[Name] = N'ALICE'`, `LIKE N'%LIC%'`); a documentação do EF diz que a collation padrão do servidor numa instalação em inglês (Estados Unidos) é `SQL_Latin1_General_CP1_CI_AS`, case-insensitive e accent-sensitive, então num servidor assim a primeira consulta acharia as duas grafias. Eu não rodei isso. A lição de funções cobre `EF.Functions.Like`, `ILike` e `Collate` em si; aqui o ponto é que a resposta padrão é uma propriedade do banco.

### Collations por coluna, por banco, e citext

Uma collation pode ser definida por coluna com `UseCollation`. Dei a uma segunda coluna (`NameCi`, mesmos dados) uma collation case-insensitive em cada motor. No PostgreSQL isso significa uma collation ICU não determinística, que o Npgsql cria para você:

```csharp
mb.HasCollation("ci", locale: "en-u-ks-level2", provider: "icu", deterministic: false);
mb.Entity<Person>().Property(p => p.NameCi).UseCollation("ci");    // PostgreSQL
mb.Entity<Person>().Property(p => p.NameCi).UseCollation("NOCASE"); // SQLite
```
```text
CREATE COLLATION ci (LOCALE = 'en-u-ks-level2', PROVIDER = icu, DETERMINISTIC = False);
"NameCi" text COLLATE ci NOT NULL           -- PostgreSQL
"NameCi" TEXT COLLATE NOCASE NOT NULL       -- SQLite
```
```text
LINQ on NameCi           PostgreSQL ICU "ci"      SQLite NOCASE
== "ALICE"               [alice, Alice]           [alice, Alice]
== "ÉLAN"                [élan, Élan]             [Élan]
Contains("LIC")          [alice, Alice]           []
Like(NameCi, "ÉL%")      [élan, Élan]             [Élan]
```

`NOCASE` só normaliza ASCII, e `instr` ignora a collation da coluna, então `Contains` continuou sem achar nada no SQLite. Uma limitação muito citada diz que `LIKE` não funciona com collations não determinísticas. No PostgreSQL 18.6 funcionou, e a documentação do Npgsql concorda: o PostgreSQL 18 suporta bem collations case-insensitive, enquanto versões anteriores não conseguiam fazer pattern matching com `LIKE` numa coluna assim. Segundo essa documentação, a mesma consulta falharia no PostgreSQL 17 ou anterior; eu só rodei o 18.6.

A collation padrão do banco é outra história. `modelBuilder.UseCollation("ci")` fez o `EnsureCreated` enviar `CREATE DATABASE prov LC_COLLATE ci`, que falhou com `42809: invalid LC_COLLATE locale name: "ci"`: o padrão do banco precisa ser um locale, e a collation ICU só existe dentro do banco depois que ele é criado. A documentação do Npgsql diz que a collation do banco não aceita collations não determinísticas e sugere `configurationBuilder.Properties<string>().UseCollation("ci")` em `ConfigureConventions`, que coloca a collation em toda coluna de string. A alternativa mais antiga é o tipo `citext` (`HasPostgresExtension("citext")` mais `HasColumnType("citext")`): numa terceira coluna ele encontrou `ALICE`, `ÉLAN`, `Contains("LIC")` e `Like("AL%")` sem diferenciar maiúsculas, `É` incluído, num cluster cujo locale padrão era `C.UTF-8`.

### DateTime, DateTimeOffset, DateOnly e TimeOnly

O Npgsql mapeia `DateTime` para `timestamp with time zone` e só aceita valores UTC. Salvei o mesmo instante com cada `Kind`:

```text
Kind=Utc          => saved
Kind=Local        => ArgumentException: Cannot write DateTime with Kind=Local to PostgreSQL type 'timestamp with time zone', only UTC is supported. Note that it's not possible to mix DateTimes with different Kinds in an array, range, or multirange. (Parameter 'value')
Kind=Unspecified  => ArgumentException: Cannot write DateTime with Kind=Unspecified to PostgreSQL type 'timestamp with time zone', ...
DateTimeOffset +01:00 => ArgumentException: Cannot write DateTimeOffset with Offset=01:00:00 to PostgreSQL type 'timestamp with time zone', only offset 0 (UTC) is supported.
```

As exceções chegam embrulhadas num `DbUpdateException` vindo do `SaveChanges`. A página de data e hora do Npgsql documenta isso como o comportamento da 6.0 e o switch `Npgsql.EnableLegacyTimestampBehavior`, que restaura o antigo. O SQLite aceitou os três kinds e gravou o mesmo texto, `2026-10-28 12:00:00`, então o `Kind` se perde: todo valor voltou como `Unspecified`, inclusive o que foi salvo como UTC. O DDL gerado para o SQL Server usa `datetime2` para `DateTime` e `datetimeoffset` para `DateTimeOffset`, que guarda o offset.

`DateTimeOffset` no SQLite é guardado como texto com o offset. Salvei `12:00+01:00` (11:00 UTC) e `11:30+00:00` e consultei:

```text
raw At values    => [2026-10-28 12:00:00+01:00, 2026-10-28 11:30:00+00:00]
OrderBy(At)      => NotSupportedException: SQLite does not support expressions of type 'DateTimeOffset' in ORDER BY clauses. Convert the values to a supported type, or use LINQ to Objects to order the results on the client side.
Where(At > ...)  => InvalidOperationException: The LINQ expression '...' could not be translated. ...
Max(At)          => NotSupportedException: SQLite cannot apply aggregate operator 'Max' on expressions of type 'DateTimeOffset'. ...
At == ...        => WHERE "e"."At" = '2026-10-28 11:30:00+00:00'
```

O EF Core 10 recusa em vez de ordenar um texto que colocaria 11:30 UTC antes de 11:00 UTC. A igualdade é traduzida, mas compara texto, então o mesmo instante escrito com outro offset é outra string. A página de limitações do SQLite lista `DateTimeOffset`, `TimeSpan` e `ulong` como tipos em que só a igualdade é traduzida e recomenda `DateTime` em UTC no lugar. `DateOnly` e `TimeOnly` funcionaram em todo lugar: `date`/`time without time zone` no PostgreSQL, `TEXT` ISO no SQLite (onde `Day > 2026-01-01` funcionou porque texto ISO ordena corretamente), `date`/`time` no SQL Server.

### Decimais

```text
                 PostgreSQL                         SQLite
column type      numeric; numeric(18,2) for Exact   TEXT for both
round trip       12345678901234567890.123456789     12345678901234567890.123456789
Exact = 1.005    1.01 (rounded by numeric(18,2))    1.005 (HasPrecision ignored)
Where(> 9.9m)    [10, 79228162514264337593543950335]  same rows
Sum(Precise)     12345678901234567890.423456789     12345678901234567890.423456789
Average(Exact)   6.8366666666666667                 6.835
```

Eu esperava perda de precisão no SQLite e não encontrei nenhuma: os valores foram gravados como `text` (conferi com `typeof`) e voltaram exatos, inclusive `decimal.MaxValue`. Comparação, ordenação e agregações também funcionaram, por meio de funções que o EF registra na conexão: `WHERE ef_compare("i"."Price", '9.9') > 0`, `ORDER BY "i"."Price" COLLATE EF_DECIMAL`, `SELECT COALESCE(ef_sum("i"."Price"), '0.0')`. A página atual de limitações do SQLite diz o mesmo, então se você lembra de ordenação e agregação de decimal como não suportadas no SQLite, isso não vale mais no EF Core 10. A diferença real é o `HasPrecision`: o PostgreSQL arredondou 1.005 para 1.01, o SQLite manteve 1.005, então a média muda. Sem `HasPrecision`, o Npgsql cria um `numeric` sem restrição. O SQL Server cria `decimal(18,2)` e a validação do modelo registrou, sem precisar de conexão:

```text
warn: SqlServerEventId.DecimalTypeDefaultWarning[30000] No store type was specified for the decimal property 'Price' on entity type 'Item'. This will cause values to be silently truncated if they do not fit in the default precision and scale. ...
```

### Chaves, GUIDs e inserts em lote

```text
PostgreSQL  "Id" integer GENERATED BY DEFAULT AS IDENTITY
SQLite      "Id" INTEGER NOT NULL CONSTRAINT "PK_Events" PRIMARY KEY AUTOINCREMENT
SQL Server  [Id] int NOT NULL IDENTITY
```

Para chaves `Guid` os três geraram o valor no cliente, mas não o mesmo tipo de valor. Imprimi três ids e o `Guid.Version` por provider; no SQL Server o contexto só executou `Add`, que nunca toca o servidor:

```text
PostgreSQL  01a18365-8748-7cdb-ab9f-42f4f6de8ad8 v7   (time-ordered UUIDv7)
SQLite      dcae0beb-55fa-4c57-86ee-dca67e795492 v4   (random)
SQL Server  12235ace-48b6-4360-04ad-08df3512bb46 v4
            6411bdea-7ad5-4989-04ae-08df3512bb46      (fourth group counts up, last group fixed)
```

A documentação de geração de valores do SQL Server diz que o provider gera "optimal sequential values, similar to SQL Server's NEWSEQUENTIALID". Então ordenar pela chave significa coisas diferentes em cada provider: nada no SQLite, e no PostgreSQL só o tempo até o milissegundo (meus `b` e `c` caíram no mesmo milissegundo e os ids deles ordenaram ao contrário). Salvar três linhas de `Doc` e três de `Person` mostrou a diferença de batching: o Npgsql enviou um único `DbCommand` com seis `INSERT`, e os de identity terminavam em `RETURNING "Id"`. O SQLite enviou seis comandos separados, também com `RETURNING "Id"` nas linhas com identity.

### Migrations: ALTER COLUMN versus reconstruir a tabela

Comparei duas versões do modelo (`Score` mudou de `int` para `HasColumnType("bigint")`) com `IMigrationsModelDiffer` e passei as operações para o `IMigrationsSqlGenerator` de cada provider, que é o que `migrations script` faz:

```sql
-- PostgreSQL
ALTER TABLE "Items" ALTER COLUMN "Score" TYPE bigint;
-- SQL Server (apenas gerado): remove antes qualquer default constraint, depois
ALTER TABLE [Items] ALTER COLUMN [Score] bigint NOT NULL;
-- SQLite
CREATE TABLE "ef_temp_Items" ( ... "Score" bigint NOT NULL, ... );
INSERT INTO "ef_temp_Items" ("Id", "Address", ...) SELECT "Id", "Address", ... FROM "Items";
PRAGMA foreign_keys = 0;
DROP TABLE "Items";
ALTER TABLE "ef_temp_Items" RENAME TO "Items";
PRAGMA foreign_keys = 1;
```

O SQLite não tem `ALTER COLUMN`, então o EF reconstruiu a tabela: copiar, apagar, renomear. A página de limitações marca `AlterColumn`, `DropColumn` e mudanças de foreign key, primary key, unique e check constraint como "rebuild", e diz que um `NotSupportedException` ainda é lançado para objetos que não fazem parte do modelo do EF, e que scripts idempotentes não são possíveis no SQLite. Uma reconstrução copia todas as linhas, então numa tabela SQLite grande uma mudança de uma palavra vira uma cópia completa.

### Arrays, JSON e enums

```text
                   PostgreSQL                          SQLite
string[] Tags      text[]   {a,b}                       TEXT     ["a","b"]
Tags.Contains("a") WHERE 'a' = ANY (i."Tags")           WHERE 'a' IN (SELECT "t"."value" FROM json_each("i"."Tags") AS "t")
Address ToJson()   jsonb {"Zip": "1000", "City": "Lisbon"}  TEXT {"City":"Lisbon","Zip":"1000"}
Address.City       WHERE (i."Address" ->> 'City') = 'Lisbon'   WHERE "i"."Address" ->> 'City' = 'Lisbon'
Mood (MapEnum)     CREATE TYPE mood AS ENUM ('happy','sad'); = 'sad'::mood   INTEGER, = 1
```

Eu esperava um erro de "arrays não suportados" no SQLite. O EF Core 10 não lançou nenhum: ele mapeia uma coleção primitiva como `string[]` para uma coluna de texto JSON no SQLite (e no SQL Server, onde o SQL gerado usou `OPENJSON`), e `Contains` e `Count()` foram traduzidos. O PostgreSQL ganha um tipo array de verdade, e o `jsonb` reordenou as chaves. Enums precisam de `MapEnum<Mood>("mood")` nas opções do Npgsql para virar um tipo enum do PostgreSQL (os rótulos ficaram em minúsculas); nos outros são inteiros. O DDL do SQL Server usou `nvarchar(max)` para as colunas JSON por padrão e o tipo nativo `json` depois de `UseCompatibilityLevel(170)`.

### Tokens de concorrência: reais no PostgreSQL, silenciosos no SQLite

No PostgreSQL uma propriedade `uint` com `IsRowVersion()` (ou `[Timestamp]`) é mapeada para a coluna de sistema oculta `xmin`, então nenhum DDL aparece. O antigo `UseXminAsConcurrencyToken()` não existe mais: deu `CS1061: 'EntityTypeBuilder<Doc>' does not contain a definition for 'UseXminAsConcurrencyToken'` com o Npgsql 10.0.3. Carreguei a mesma linha em dois contextos e salvei os dois:

```text
Version after insert: 771
UPDATE "Items" SET "Price" = @p0 WHERE "Id" = @p1 AND xmin = @p2 RETURNING xmin;
Version after A: 772
B saves => DbUpdateConcurrencyException: The database operation was expected to affect 1 row(s), but actually affected 0 row(s); data may have been modified or deleted since entities were loaded. ...
final price 2
```

O mesmo modelo no SQLite, com `IsRowVersion()` num `byte[] Stamp`, criou uma coluna `BLOB NULL` que nada preenche:

```text
UPDATE "Items" SET "Price" = @p0 WHERE "Id" = @p1 AND "Stamp" IS NULL RETURNING "Stamp";
B saves => 1
final price 3.0
```

Nenhuma exceção, e o segundo a gravar sobrescreveu o primeiro em silêncio: um lost update. A página de limitações lista tokens de concorrência gerados pelo banco como não suportados no SQLite. Um token que você mesmo define funciona: com `IsConcurrencyToken()` e um `Guid` novo gravado no `SaveChanges`, o update virou `WHERE "Id" = @p2 AND "Stamp" = @p3` e o segundo save lançou o mesmo `DbUpdateConcurrencyException`. No SQL Server o DDL gerado foi `[Stamp] rowversion NULL`, que a documentação diz que o servidor atualiza a cada escrita.

### A armadilha dos testes

Cada linha acima é uma forma de um teste no SQLite passar enquanto o PostgreSQL se comporta diferente: `StartsWith("AL")` achou duas linhas no SQLite e nenhuma no PostgreSQL, um `DateTime.Now` foi salvo sem problema no SQLite e lançou exceção no PostgreSQL, `HasPrecision` mudou uma média só no PostgreSQL, e o teste de lost update passou no PostgreSQL mas o bug passou despercebido no SQLite. O SQLite in-memory (`Data Source=:memory:`) é o mesmo motor com as mesmas regras, então herda tudo isso. Use o SQLite para testes rápidos de lógica que não depende desses comportamentos, e rode as consultas, as migrations e os caminhos de concorrência contra o motor de produção, por exemplo num container iniciado pela própria suíte de testes.

### Visão geral

| Comportamento | PostgreSQL (medido) | SQLite (medido) | SQL Server (docs) |
|---|---|---|---|
| Maiúsculas em `==` e `LIKE` | diferencia | `=` diferencia, `LIKE` ignora só em ASCII | ignora pela collation padrão (docs) |
| Coluna case-insensitive | ICU não determinística ou `citext` | `NOCASE`, só ASCII | collation `_CI_` (docs) |
| `DateTime` | `timestamptz`, só UTC | TEXT, perde o Kind | `datetime2` (docs) |
| `DateTimeOffset` | só offset 0 | TEXT, sem ordenação nem comparação | `datetimeoffset`, guarda o offset (docs) |
| `decimal` | `numeric`, precisão aplicada | TEXT, exato, `ef_compare` | `decimal(18,2)` padrão mais aviso (docs) |
| Chave `Guid` | UUIDv7 | v4 aleatório | sequencial (docs) |
| Mudar tipo de coluna | `ALTER COLUMN` | reconstrói a tabela | `ALTER COLUMN` (docs) |
| `string[]` | `text[]` | texto JSON | texto JSON ou `json` (docs) |
| Token de concorrência | `xmin` | só manual | `rowversion` (docs) |

## Trade-offs

- **Portabilidade custa recursos.** Escrever no subconjunto comum (`DateTime` em UTC, `HasPrecision` explícito, sem arrays, um token manual) mantém o modelo portável, mas abre mão de `text[]`, `jsonb`, enums do PostgreSQL e `xmin`.
- **Regras de maiúsculas pertencem ao schema, não às consultas.** Uma collation ou `citext` na coluna mantém os índices utilizáveis; `ToLower()` em toda consulta não, e uma collation escolhida por provider é configuração que você precisa manter sincronizada.
  ```csharp
  configurationBuilder.Properties<string>().UseCollation("ci");   // docs do Npgsql: no lugar de uma collation do banco
  ```
- **UTC em todo lugar é a correção barata.** O Npgsql obriga, o SQLite descarta o `Kind` em silêncio, então converta na fronteira e grave UTC em todo provider.
- **Migrations no SQLite reconstroem tabelas.** Tudo bem num arquivo local, lento numa tabela grande, e objetos criados fora do modelo não podem ser reconstruídos.
- **Um teste em outro motor testa esse outro motor.** O SQLite é rápido e de graça, mas collations, datas, precisão e concorrência divergiram nesta lição; mantenha pelo menos os testes de acesso a dados no banco de produção.
- **Não executado aqui.** O SQL Server nunca foi contatado. O DDL, o SQL e os avisos dele acima foram gerados sem conexão, e o comportamento em runtime vem da documentação.

## Documentation Links

- [Collations and case sensitivity, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/collations-and-case-sensitivity) (doc)
- [SQLite database provider limitations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [Microsoft SQL Server database provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/) (doc)
- [Collations and case sensitivity, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/misc/collations-and-case-sensitivity.html) (doc)
- [Date and time handling, Npgsql documentation](https://www.npgsql.org/doc/types/datetime.html) (doc)
- [Collation support, PostgreSQL documentation](https://www.postgresql.org/docs/current/collation.html) (doc)
