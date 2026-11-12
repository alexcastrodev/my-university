---
version: 1.0
updatedAt: 2026-11-12
title: "Tabelas temporais e consultas ao histórico no EF Core"
summary: IsTemporal, TemporalAsOf, TemporalAll, TemporalBetween e os demais operadores, o DDL e o SQL que o EF Core 11 gera (offline, sem servidor), converter uma tabela existente, restaurar uma linha apagada e as colunas de período como propriedades CLR, novidade do EF Core 11. Recurso de SQL Server, não executado contra um servidor.
---
## Objective

Uma tabela temporal do SQL Server (também chamada de system-versioned) guarda todas as versões de
todas as linhas. Cada update ou delete na tabela principal copia a linha antiga para uma tabela de
histórico paralela, carimbada com o período em que aquela versão era a corrente. O EF Core cria essas
tabelas, transforma uma tabela existente em temporal, consulta o histórico e restaura dados de um
momento do passado. Para sistemas que precisam responder "como esse registro estava em 3 de março?"
(financeiro, saúde, qualquer coisa auditada), é o banco fazendo o trabalho que um interceptor de
auditoria faria no código da aplicação.

**O que foi e o que não foi executado.** Tabelas temporais são um recurso do SQL Server e do Azure SQL.
Eu não tinha SQL Server, então nada desta lição rodou contra um servidor. O que rodei, no SDK 11.0.100
e `Microsoft.EntityFrameworkCore.SqlServer` 11.0.0, foi a geração de SQL offline: o script de migration
de `dotnet ef migrations script` e o texto das queries de `ToQueryString()`. O SQL abaixo é o que o
EF Core 11.0.0 gera; se uma dada versão do SQL Server o aceita, e o que a tabela de histórico contém
depois de um delete, vem da documentação do EF Core e do comportamento de T-SQL que ela descreve, não
da minha execução. Por isso esta lição não tem lab.

## Use Cases

- Responder "qual era o valor naquela época" sem escrever tabelas de auditoria, triggers ou interceptor.
- Se recuperar de um update ou delete acidental lendo a linha antiga e inserindo de novo.
- Listar toda mudança de um registro em ordem, com o intervalo de tempo de cada versão.
- Transformar uma tabela existente em system-versioned com uma migration.

## Deep Dive

### Configurando a tabela

O mapeamento é uma chamada no table builder:

```csharp
modelBuilder.Entity<Employee>().ToTable("Employees", t => t.IsTemporal());
```

O SQL Server acrescenta duas colunas de período `datetime2` e a tabela de histórico. Por padrão o EF
Core mapeia as colunas de período para shadow properties, chamadas `PeriodStart` e `PeriodEnd`, e a
tabela de histórico é `EmployeesHistory` (o nome da tabela mais `History`). Os horários são sempre
UTC, gerados pelo servidor. Dá para renomear tudo:

```csharp
t.IsTemporal(h =>
{
    h.HasPeriodStart("ValidFrom");
    h.HasPeriodEnd("ValidTo");
    h.UseHistoryTable("EmployeesHistory", "audit");   // tabela, schema
});
```

### O DDL que o EF Core gera (offline, não executado)

Para um modelo com uma tabela temporal `Departments` (histórico no schema `audit`) e uma tabela comum
`Employees`, `dotnet ef migrations script 0 Initial` produziu, resumido:

```sql
IF SCHEMA_ID(N'audit') IS NULL EXEC(N'CREATE SCHEMA [audit];');

CREATE TABLE [Departments] (
    [Id] int NOT NULL IDENTITY,
    [Name] nvarchar(max) NOT NULL,
    [ValidFrom] datetime2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    [ValidTo] datetime2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    CONSTRAINT [PK_Departments] PRIMARY KEY ([Id]),
    PERIOD FOR SYSTEM_TIME([ValidFrom], [ValidTo])
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [audit].[DepartmentsHistory]));
```

As colunas de período são `HIDDEN`, então `SELECT *` não as devolve (comportamento de T-SQL, não
executado aqui); o EF Core as nomeia explicitamente quando precisa.

Tornar uma tabela existente temporal é a segunda migration, a mais interessante. Gerei acrescentando
`IsTemporal()` a `Employees` depois da primeira migration e rodando
`dotnet ef migrations script Initial MakeEmployeesTemporal`:

```sql
ALTER TABLE [Employees] ADD [PeriodEnd] datetime2 NOT NULL DEFAULT '9999-12-31T23:59:59.9999999';

ALTER TABLE [Employees] ADD [PeriodStart] datetime2 NOT NULL DEFAULT '0001-01-01T00:00:00.0000000';

ALTER TABLE [Employees] ADD PERIOD FOR SYSTEM_TIME ([PeriodStart], [PeriodEnd])

ALTER TABLE [Employees] ALTER COLUMN [PeriodStart] ADD HIDDEN

ALTER TABLE [Employees] ALTER COLUMN [PeriodEnd] ADD HIDDEN

DECLARE @historyTableSchema nvarchar(max) = QUOTENAME(SCHEMA_NAME())
EXEC(N'ALTER TABLE [Employees] SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = ' + @historyTableSchema + '.[EmployeesHistory]))')
```

As linhas existentes ficam com `PeriodStart` no ano 0001 e `PeriodEnd` na data máxima, então do ponto
de vista do banco elas existiram desde sempre. É correto de ler, mas significa que você não recupera
como elas eram antes da migration. A documentação lista a conversão de tabelas existentes como suportada
por migrations; não executei esse script contra uma tabela com dados.

### Leituras e escritas comuns

O código da aplicação não muda. Inserts, updates e deletes passam pelo `SaveChanges` como sempre, e o
SQL Server mantém o histórico. Uma query comum devolve só as linhas correntes; as colunas de período
entram na lista do `SELECT` (shadow properties são selecionadas como qualquer outra), e depois de uma
query com tracking você as lê com `context.Entry(e).Property<DateTime>("PeriodStart").CurrentValue`.
Para linhas correntes o fim do período é o valor máximo de `datetime2`.

### Os operadores de query e o SQL deles

Os operadores são métodos de extensão no `DbSet`. Estes são os textos que `ToQueryString()` devolveu
(resumidos ao `FROM`; a lista do select são as colunas da entidade):

```csharp
db.Employees.TemporalAsOf(t0).Where(e => e.Id == 1)
```
```sql
FROM [Employees] FOR SYSTEM_TIME AS OF '2026-01-01T00:00:00.0000000Z' AS [e]
WHERE [e].[Id] = 1
```

`TemporalAsOf` devolve a versão que era a corrente em um instante: no máximo uma linha por chave.

```csharp
db.Employees.TemporalAll().Where(e => e.Id == 1)
    .OrderBy(e => EF.Property<DateTime>(e, "PeriodStart"))
    .Select(e => new { e.Name, e.Salary,
                       From = EF.Property<DateTime>(e, "PeriodStart"),
                       To = EF.Property<DateTime>(e, "PeriodEnd") })
```
```sql
SELECT [e].[Name], [e].[Salary], [e].[PeriodStart] AS [From], [e].[PeriodEnd] AS [To]
FROM [Employees] FOR SYSTEM_TIME ALL AS [e]
WHERE [e].[Id] = 1
ORDER BY [e].[PeriodStart]
```

`TemporalAll` devolve todas as versões, corrente e históricas: é a trilha de auditoria de um registro.
Os outros operadores de intervalo se traduzem em:

```sql
FROM [Employees] FOR SYSTEM_TIME FROM '2026-01-01T00:00:00.0000000Z' TO '2026-06-01T00:00:00.0000000Z' AS [e]      -- TemporalFromTo
FROM [Employees] FOR SYSTEM_TIME BETWEEN '2026-01-01T00:00:00.0000000Z' AND '2026-06-01T00:00:00.0000000Z' AS [e]  -- TemporalBetween
FROM [Employees] FOR SYSTEM_TIME CONTAINED IN ('2026-01-01T00:00:00.0000000Z', '2026-06-01T00:00:00.0000000Z') AS [e] -- TemporalContainedIn
```

A documentação os descreve assim: `TemporalFromTo` devolve versões ativas em algum momento entre os dois
horários; `TemporalBetween` é igual, mas inclui também linhas que se tornaram ativas exatamente no
limite superior; `TemporalContainedIn` devolve só versões que começaram e terminaram dentro do
intervalo. Os limites exatos são definidos pela cláusula `FOR SYSTEM_TIME` do SQL Server, que não
executei, então consulte a documentação dela se linhas de fronteira importam para você.

Uma fonte temporal pode ficar dentro de um join, que compara o presente com o passado:

```csharp
db.Employees.Where(e => e.Id == 1)
    .Join(db.Employees.TemporalAsOf(t0), c => c.Id, h => h.Id, (c, h) => new { c.Salary, Before = h.Salary })
```
```sql
FROM [Employees] AS [e]
INNER JOIN [Employees] FOR SYSTEM_TIME AS OF '2026-01-01T00:00:00.0000000Z' AS [e0] ON [e].[Id] = [e0].[Id]
```

Segundo a documentação, queries que usam um operador temporal são no-tracking por padrão. Ao passar
valores `DateTime`: todos os horários são UTC, então construa-os com `DateTimeKind.Utc` ou
`DateTimeOffset.UtcDateTime`.

### O que o EF Core 11 acrescenta: colunas de período como propriedades CLR

Antes do EF Core 11 as colunas de período precisavam ser shadow properties. Dar à entidade uma
propriedade `DateTime` para o período e apontar a configuração para ela pelo nome falhava na validação
do modelo. Rodei esse caso com `Microsoft.EntityFrameworkCore.SqlServer` 10.0.14 e obtive
`InvalidOperationException: Period property 'Department.ValidFrom' must be a shadow property.`
No EF Core 11 existem as sobrecargas com lambda e a propriedade é um membro normal:

```csharp
t.IsTemporal(h =>
{
    h.HasPeriodStart(d => d.ValidFrom);   // não compila no EF Core 10
    h.HasPeriodEnd(d => d.ValidTo);
});

db.Departments.TemporalAll().OrderBy(d => d.ValidFrom).Select(d => new { d.Name, d.ValidFrom, d.ValidTo })
```
```sql
SELECT [d].[Name], [d].[ValidFrom], [d].[ValidTo]
FROM [Departments] FOR SYSTEM_TIME ALL AS [d]
ORDER BY [d].[ValidFrom]
```

Chega de strings em `EF.Property<DateTime>(e, "ValidFrom")`. Segundo a documentação as propriedades de
período são geradas pelo servidor (`ValueGenerated.OnAddOrUpdate`), então não as preencha ao inserir ou
atualizar. A documentação marca esse recurso como novo no EF Core 11. As queries e o DDL do mapeamento
padrão com shadow properties foram idênticos nas duas versões na minha comparação offline.

### Restaurando uma linha apagada

A tabela de histórico guarda a última versão de uma linha apagada, com `PeriodEnd` no momento do
delete. Para achá-la, ordene o histórico pelo fim do período:

```csharp
db.Employees.TemporalAll().Where(e => e.Id == 1)
    .OrderByDescending(e => EF.Property<DateTime>(e, "PeriodEnd")).Take(1)
```
```sql
SELECT TOP(@p) [e].[Id], [e].[DepartmentId], [e].[Name], [e].[PeriodEnd], [e].[PeriodStart], [e].[Salary]
FROM [Employees] FOR SYSTEM_TIME ALL AS [e]
WHERE [e].[Id] = 1
ORDER BY [e].[PeriodEnd] DESC
```

O jeito da documentação para restaurar é ler a linha com `TemporalAsOf` em um horário anterior ao delete
e marcá-la como adicionada:

```csharp
var employee = await context.Employees.TemporalAsOf(timeStamp).SingleAsync(e => e.Name == "Rainbow Dash");
context.Add(employee);
await context.SaveChangesAsync();
```

A entidade não é rastreada (queries temporais são no-tracking), então `Add` a transforma em um insert
novo. Isso cria uma nova linha corrente, e o histórico passa a mostrar uma nova versão corrente depois
da apagada; não reescreve o passado. Note que o exemplo da documentação usa uma chave `Guid`. Com chave
`IDENTITY`, inserir o valor antigo explicitamente é rejeitado pelo SQL Server a menos que
`IDENTITY_INSERT` esteja ligado (comportamento de T-SQL, que não executei); aceite uma chave nova ou
use chave gerada no cliente nas tabelas em que isso for necessário. Não rodei a restauração, então o
SQL do insert não é mostrado.

### A alternativa: um interceptor

A lição de auditoria com interceptor grava linhas de auditoria no código da aplicação, na mesma
transação. Uma tabela temporal faz isso no banco: registra também mudanças feitas por scripts, por
outras aplicações e por `ExecuteUpdate`/`ExecuteDelete`, que passam por fora dos interceptors do
`SaveChanges`. O interceptor pode registrar quem fez a mudança (o usuário da aplicação), o que uma
tabela temporal não faz: as colunas de período dizem quando, não quem. Muitos sistemas usam os dois.
O PostgreSQL 18 ganhou temporal constraints (as notas de versão do Npgsql 11 as mencionam), um recurso
diferente que não verifiquei.

## Trade-offs

- **Só SQL Server.** O mapeamento, os operadores e o DDL são recursos do provider. Código que chama
  `TemporalAsOf` não roda em SQLite nem em PostgreSQL, então testes com esses providers não o cobrem.
- **O histórico cresce sem limite por padrão.** Cada update guarda a linha antiga. Planeje retenção e
  indexe a tabela de histórico, ou o armazenamento e as queries com `TemporalAll` vão piorar com o
  tempo (as configurações de retenção do SQL Server são T-SQL e não são tratadas aqui).
- **Quando, não quem.** As colunas de período trazem o horário da mudança. Se a auditoria precisa do
  usuário, você também precisa de um registro na aplicação.
- **Sem histórico anterior à conversão.** Tornar uma tabela existente temporal começa o histórico
  naquele momento, com as linhas existentes tratadas como sempre válidas.
- **Restaurar reescreve o presente, não o passado.** Uma restauração insere uma nova linha corrente.
  Com chaves identity você não reaproveita a chave antiga sem passos extras.
- **Não executado contra um servidor aqui.** O SQL desta lição foi gerado offline. Teste migrations e
  queries em um SQL Server real antes de depender delas.

## Documentation Links

- [Temporal tables, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/temporal-tables) (doc)
- [Temporal tables, SQL Server, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
