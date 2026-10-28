---
version: 1.0
updatedAt: 2026-10-28
title: "ADO.NET: conexões, comandos, readers e pooling"
summary: ADO.NET no .NET 10 medido no Npgsql e no SQLite: modelo de objetos, parâmetros contra SQL injection, métodos de execução e CommandBehavior, leitura por ordinal ou nome, vazamento e esgotamento do pool, o que Close() faz no servidor, Pooling=false, poda de conexões ociosas, backends mortos, DbDataSource em DI, DbBatch e COPY, streaming contra ToList e o EF Core usando o mesmo pool.
---
## Objective

ADO.NET é a camada que todo driver relacional do .NET implementa e sobre a qual todo ORM roda: `DbConnection`, `DbCommand`, `DbParameter`, `DbDataReader`, `DbTransaction`, mais `DbBatch` (.NET 6) e `DbDataSource` (.NET 7). Escrever na mão é fácil; escrever sem vazar conexões, sem injetar SQL e sem pagar um round trip por linha exige saber o que o pool e o reader realmente fazem. Este conceito aprofunda o ADO.NET em si (a escolha entre EF Core, Dapper e ADO.NET fica no pré-requisito) e mede tudo em dois providers que implementam as mesmas abstrações de `System.Data.Common`: Npgsql contra um cluster PostgreSQL 18.6 descartável e Microsoft.Data.Sqlite. O SQL Server não estava disponível, então todo fato sobre Microsoft.Data.SqlClient abaixo é atribuído à documentação dele. Eu rodei: uma SQL injection e o comando que o servidor realmente registrou, os métodos de execução e as flags de `CommandBehavior`, leituras de 1 milhão de linhas com três acessores, um vazamento que esgota o pool, o que `Close()` deixa no servidor, `Pooling=false`, a poda de conexões ociosas, um backend morto e um restart do servidor, `DbDataSource` em DI, `DbBatch` e `COPY` binário, memória de streaming contra `ToList` e o EF Core usando o mesmo pool. Versões usadas: SDK 10.0.100, `Npgsql` 10.0.3, `Npgsql.DependencyInjection` 10.0.3, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (com EF Core 10.0.4), `Microsoft.Data.Sqlite` 10.0.14, PostgreSQL 18.6, macOS 27.0.1 num Apple M4 Max, cliente e servidor em 127.0.0.1.

## Use Cases

- Um caminho de leitura quente ou uma consulta de relatório em que você quer o SQL e o mapeamento das linhas nas suas mãos, sem ORM no meio.
- Um serviço que cai sob carga com "The connection pool has been exhausted" e você precisa achar o vazamento.
- Carga em massa de milhares de linhas, em que 1 round trip por `INSERT` é o gargalo.
- Uma ferramenta Native AOT ou uma biblioteca que precisa funcionar com qualquer provider, escrita só contra `System.Data.Common`.

## Deep Dive

### Um modelo de objetos, dois providers

Escrevi um método usando só tipos de `System.Data.Common` e rodei contra SQLite e PostgreSQL pelo `DbProviderFactory` de cada um:

```csharp
static async Task<object?> CountUsers(DbProviderFactory f, string cs)
{
    await using var conn = f.CreateConnection()!;
    conn.ConnectionString = cs;
    await conn.OpenAsync();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT count(*) FROM users WHERE id > @min";
    var p = cmd.CreateParameter(); p.ParameterName = "min"; p.Value = 1;
    cmd.Parameters.Add(p);
    return await cmd.ExecuteScalarAsync();
}
```

```text
SqliteConnection / SqliteCommand / SqliteParameter / CanCreateBatch=False  -> 2 (Int64)
NpgsqlConnection / NpgsqlCommand / NpgsqlParameter / CanCreateBatch=True   -> 2 (Int64)
```

A abstração se sustenta no básico, e `CanCreateBatch` é como você pergunta a um provider se ele suporta `DbBatch` (o SQLite não suporta, veja abaixo). O texto SQL continua específico do provider: `@min` funciona nos dois só porque o Npgsql reescreve placeholders nomeados; a documentação do Npgsql recomenda o posicional nativo `$1` em código novo.

### Parâmetros, não concatenação: o que o servidor recebeu

Subi o cluster com `log_statement=all` e mandei a entrada `' OR 1=1 --` duas vezes:

```csharp
var input = "' OR 1=1 --";
new NpgsqlCommand($"SELECT name, secret FROM users WHERE name = '{input}'", conn);   // concatenado
var good = new NpgsqlCommand("SELECT name, secret FROM users WHERE name = @name", conn);
good.Parameters.AddWithValue("name", input);                                       // parametrizado
```

A consulta concatenada devolveu as 3 linhas (alice, bob e carol, com os segredos); a parametrizada devolveu 0. O log do PostgreSQL mostra o porquê. O primeiro comando é outra consulta; o segundo tem um placeholder e o valor viaja separado do SQL:

```text
LOG:  execute <unnamed>: SELECT name, secret FROM users WHERE name = '' OR 1=1 --'
LOG:  execute <unnamed>: SELECT name, secret FROM users WHERE name = $1
DETAIL:  Parameters: $1 = ''' OR 1=1 --'
```

O Npgsql transformou `@name` em `$1` antes de enviar. Parâmetros cobrem só valores: um nome de tabela ou de coluna não pode ser parâmetro, então valide identificadores contra uma lista fixa no código.

### Métodos de execução e CommandBehavior

```text
ExecuteScalar -> 3 (Int64)                  first column of the first row; count(*) is bigint
ExecuteScalar no row -> True                null when there is no row
ExecuteNonQuery UPDATE -> 2                 rows affected
ExecuteNonQuery SELECT -> -1                not meaningful for a query
SingleRow rows read -> 1                    3 rows matched, the reader stopped after one
Sequential col2 -> a-secret
Sequential back to col0 -> InvalidOperationException: Invalid attempt to read from column ordinal '0'. With CommandBehavior.SequentialAccess, you may only read from column ordinal '2' or greater.
CloseConnection: before reader dispose Open
CloseConnection: after reader dispose Closed
```

`SequentialAccess` faz streaming de uma linha em vez de guardá-la inteira no buffer, o que a página de performance do Npgsql recomenda para linhas maiores que o buffer de leitura de 8 KB; o preço é ler as colunas estritamente em ordem, uma vez. `CloseConnection` serve para um método que devolve um reader a quem nunca vê a conexão: descartar o reader fecha a conexão.

### Ordinais, nomes e `GetFieldValue<T>`

Somei a coluna `id` de uma tabela de 1.000.000 de linhas com `r.GetInt32(0)`, `(int)r["id"]`, `r.GetFieldValue<int>(0)` e `r.GetInt32(ordId)` (com `ordId = r.GetOrdinal("id")` uma vez, antes do loop), três rodadas depois de um aquecimento, medindo tempo e `GC.GetTotalAllocatedBytes`. O mesmo loop rodou também em SQLite em memória, sem rede:

```text
rounds 2 and 3          PostgreSQL   allocated    in-memory SQLite
GetInt32(0)             96-100 ms    0.6-0.8 MB   about 78 ms
reader["id"]            99-100 ms    23.2 MB      about 108 ms
GetFieldValue<int>(0)   98-99 ms     0.6-0.7 MB   about 85 ms
GetOrdinal once         97-101 ms    0.6 MB       (not run)
```

Por um socket, a rede domina e os quatro empatam dentro do ruído. O que não some são 23 MB de lixo: o indexador devolve `object`, então cada `int` sofre boxing (1 milhão de boxes de 24 bytes). No SQLite, sem rede, a busca por nome foi cerca de 35 a 40% mais lenta. O melhor dos dois mundos é chamar `GetOrdinal` uma vez antes do loop e usar os getters tipados: resiste a colunas reordenadas e não aloca.

### Dispose ou vazamento: esgotando o pool

`await using` devolve a conexão ao pool mesmo quando uma exceção é lançada. Tirei de propósito: com `Maximum Pool Size=5;Timeout=2`, abri 5 objetos `NpgsqlConnection` sem descartá-los e depois abri um sexto:

```text
backends after 5 leaked opens: 5
6th OpenAsync after 2.00 s -> Npgsql.NpgsqlException: The connection pool has been exhausted, either raise 'Max Pool Size' (currently 5) or 'Timeout' (currently 2 seconds) in your connection string.
  inner: TimeoutException: The operation has timed out.
after disposing one leaked connection, open took 0.2 ms
```

O sexto chamador esperou o `Timeout` inteiro antes de falhar, então em produção um vazamento aparece primeiro como latência e só depois como erro. Com os padrões que a documentação do Npgsql informa (100 conexões, 15 s), o sintoma é uma trava de 15 segundos. A documentação do SqlClient dá os mesmos padrões: `Max Pool Size` 100, `Connect Timeout` 15. Um reader que você esquece de descartar vaza de outro jeito: a conexão continua ocupada, e o comando seguinte nela falhou com `NpgsqlOperationInProgressException: A command is already in progress: SELECT id, name, secret FROM users ORDER BY id`. O SQL Server só roda vários readers numa conexão com `MultipleActiveResultSets=True`, que a documentação diz vir desligado por padrão; o Npgsql 10.0.3 rejeitou o segundo comando com a exceção citada aqui.

### O que Close() faz, e como um pool é identificado

Contei as linhas de `pg_stat_activity` para o application name, a partir de uma conexão administrativa separada e sem pool:

```text
before open: 0
after Open: 1 state=Open pid=12074
after Close: 1 state=Closed server: 12074:idle
reopen same object: pid=12074
new object, same string: pid=12074
string with one extra space: pid=12074 backends=1
after ClearPool(one string): 0
```

`Close()` numa conexão com pool não encerra a sessão: a sessão no servidor continua viva e `idle`, e a próxima abertura com a mesma string recebe o mesmo backend (mesmo PID). A documentação do Npgsql diz que o estado da sessão é resetado com `DISCARD ALL`, enviado de forma preguiçosa junto com o próximo comando. `NpgsqlConnection.ClearPool(conn)` fechou a conexão física ociosa daquela string, e `ClearAllPools()` existe para todos os pools. A documentação do SqlClient descreve os mesmos dois métodos e acrescenta que conexões em uso no momento da limpeza são descartadas quando fechadas. Uma diferença: a documentação do SqlClient diz que pools são casados pela connection string exata, então palavras-chave em outra ordem criam um pool novo. O Npgsql 10.0.3 colocou minha string com um espaço a mais no mesmo pool.

### Pooling=false, Minimum Pool Size e poda de ociosas

200 iterações de abrir, `SELECT 1`, fechar, três rodadas:

```text
round 1: pooling on     18 ms (0.09 ms each)  pooling off    289 ms (1.44 ms each)
round 2: pooling on     19 ms (0.09 ms each)  pooling off    282 ms (1.41 ms each)
round 3: pooling on     18 ms (0.09 ms each)  pooling off    278 ms (1.39 ms each)
```

Cerca de 15 vezes mais lento sem o pool, em loopback com autenticação trust; com TLS e senha numa rede real, uma conexão física nova custa bem mais. Depois a poda, com `Minimum Pool Size=3;Connection Idle Lifetime=2;Connection Pruning Interval=1`:

```text
one open, Minimum Pool Size=3: backends=1
8 open: backends=8
t=1s after closing all 8: backends=8
t=2s after closing all 8: backends=3
t=7s after closing all 8: backends=3
```

O mínimo do Npgsql é um piso para a poda, não um pré-aquecimento: uma abertura criou um backend. A documentação do SqlClient diz o contrário para o SqlClient: quando um pool é criado, conexões são abertas para satisfazer o `Min Pool Size`. Os padrões do Npgsql, segundo a documentação dele, são `Connection Idle Lifetime` 300 s e `Connection Pruning Interval` 10 s, e `Connection Lifetime` (idade máxima de uma conexão física) é 3600 s desde o Npgsql 9.0; a documentação do SqlClient dá a `Connection Lifetime` o padrão 0 (sem limite) e diz que conexões ociosas são removidas depois de cerca de 4 a 8 minutos.

### Conexões mortas: um backend encerrado e um restart do servidor

O pool não testa uma conexão antes de entregá-la. Encerrei um backend ocioso do pool com `pg_terminate_backend(pid)` (devolveu `true`) e abri de novo; depois deixei 5 conexões ociosas num pool de `NpgsqlDataSource` e reiniciei o servidor com `pg_ctl restart -m fast`:

```text
pooled idle connection pid=12083, server: 12083:idle
OpenAsync succeeded, pid=12083, state=Open
first use after 5 ms -> Npgsql.PostgresException: 57P01: terminating connection due to administrator command
next call: SELECT 1 -> 1 on pid=12087

5 idle pooled connections: 16634:idle 16635:idle 16636:idle 16637:idle 16638:idle
call 1: PostgresException: 57P01: terminating connection due to administrator command
call 2: ok, pid=16654
call 3: ok, pid=16654
call 4: ok, pid=16654
```

`OpenAsync` devolveu a conexão morta e o primeiro comando falhou. Depois do restart, só a primeira chamada falhou: as chamadas 2 a 4 receberam um backend novo, e não uma das quatro conexões velhas restantes. De qualquer forma uma requisição vê uma exceção, então uma política de retry para erros transitórios deve envolver as chamadas ao banco. A documentação do SqlClient descreve o mesmo: uma conexão cortada só é detectada no primeiro uso.

### DbDataSource: um por banco, vindo da DI

`DbDataSource` (.NET 7+) representa o banco: guarda a configuração e o pool, entrega conexões ou executa comandos diretamente. A documentação do Npgsql o chama de ponto de partida recomendado e diz que instanciar `new NpgsqlConnection(cs)` direto é desaconselhado. Registrei com `Npgsql.DependencyInjection`:

```csharp
services.AddNpgsqlDataSource(cs, b => b.EnableParameterLogging(false)); // o lambda configura o NpgsqlDataSourceBuilder
var dbds = sp.GetRequiredService<DbDataSource>();
await using (var cmd = dbds.CreateCommand("SELECT count(*) FROM users")) await cmd.ExecuteScalarAsync();
await using (var conn = await dbds.OpenConnectionAsync()) { /* several commands, a transaction */ }
```

```text
NpgsqlDataSource same instance as DbDataSource: True  type=PoolingDataSource
DbDataSource.CreateCommand (no connection object): 3
  cmd.Connection -> NotSupportedException: Connection and transaction access is not supported on commands created from DbDataSource.
OpenConnectionAsync: NpgsqlConnection Open
SqliteFactory.CreateDataSource -> System.Data.Common.DefaultDataSource: 42
```

Um registro atende tanto `NpgsqlDataSource` quanto o abstrato `DbDataSource`, então uma classe independente de provider pode receber `DbDataSource` no construtor. Um comando criado pelo data source pega uma conexão só durante a execução; para uma transação ou vários comandos dependentes, abra uma conexão. Providers sem data source próprio ainda ganham um: `DbProviderFactory.CreateDataSource` devolveu um `DefaultDataSource` genérico para o SQLite. Em comparação com passar uma connection string de um lado para o outro, a documentação do Npgsql mostra o builder como o lugar único onde logging, mapeamentos de tipos e rotação de senha são configurados.

### DbBatch e COPY binário: menos round trips

100 inserts numa conexão aberta, três rodadas depois de um aquecimento:

```csharp
await using var batch = new NpgsqlBatch(conn);
for (var i = 0; i < 100; i++)
    batch.BatchCommands.Add(new("INSERT INTO items(name, qty) VALUES ($1, $2)") { Parameters = { new() { Value = "item" + i }, new() { Value = i } } });
await batch.ExecuteNonQueryAsync();                         // devolveu 100

await using var w = await conn.BeginBinaryImportAsync("COPY items(name, qty) FROM STDIN (FORMAT BINARY)");
for (var i = 0; i < 100; i++) { await w.StartRowAsync(); await w.WriteAsync("item" + i); await w.WriteAsync(i); }
await w.CompleteAsync();                                    // devolveu 100
```

```text
round 1: 100 commands    9.7 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
round 2: 100 commands    9.4 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
round 3: 100 commands    9.5 ms | 1 NpgsqlBatch   1.4 ms | binary COPY   0.3 ms
binary COPY of 100,000 rows: 111 ms
```

Cerca de 7 vezes mais rápido como batch e cerca de 30 vezes como `COPY`, em loopback, onde um round trip custa cerca de 0,1 ms; com 1 ms de latência de rede real, só os 100 round trips da primeira coluna somariam cerca de 100 ms. Pela abstração, `DbConnection.CreateBatch()` devolveu dois result sets, lidos com `NextResultAsync`. No SQLite, `CanCreateBatch` é `False` e `CreateBatch()` lançou `NotSupportedException: Specified method is not supported.`

### Streaming contra ToList, transações, o EF Core por baixo

Li 1.000.000 de linhas (`int`, `text`, `numeric`) num record, cada modo no seu próprio processo, amostrando `Environment.WorkingSet` a cada 5 ms, duas execuções de cada. A partir de uma base de 69 MB, o pico foi 231 e 239 MB com uma `List`, e 108 e 108 MB em streaming com `while (await r.ReadAsync())`: a lista custou cerca de 125 a 130 MB a mais. Transações nesse nível são `await using var tx = await conn.BeginTransactionAsync()` mais `cmd.Transaction = tx`; meu `DELETE` de 102.400 linhas foi desfeito pelo `RollbackAsync` (savepoints, isolamento e `TransactionScope` ficam no conceito irmão). O EF Core roda sobre os mesmos objetos: com `UseNpgsql(dataSource)` e `Maximum Pool Size=1`:

```text
GetDbConnection: NpgsqlConnection, state before any query: Closed
EF CountAsync=3, state after: Closed, backends=1
raw ADO.NET on the same data source: 3 pid=12167, backends=1
raw open while EF holds the only pooled connection, after 3.0 s -> NpgsqlException: The connection pool has been exhausted, either raise 'Max Pool Size' (currently 1) or 'Timeout' (currently 3 seconds) in your connection string.
command on GetDbConnection() itself: 3
```

O EF abre e fecha a cada consulta, e os dois usaram um único backend. Enquanto o EF segurava a conexão aberta (`Database.OpenConnectionAsync()`), o código cru teve de rodar o comando em `GetDbConnection()` em vez de abrir outra.

`DataSet`, `DataTable` e `DataAdapter` são o modelo desconectado dos livros de .NET Framework. Ainda funcionam: `new NpgsqlDataAdapter(sql, conn).Fill(table)` devolveu 3 linhas com colunas tipadas (`id:Int32, name:String`) e deixou a conexão `Closed`. Hoje, um reader para records seus, ou o EF Core, os substitui em código novo.

### Faça isto, não aquilo

| Faça isto | Não aquilo |
|---|---|
| Um `NpgsqlDataSource` por banco, vindo da DI | `new NpgsqlConnection(cs)` espalhado pelo código |
| `await using` em conexão, comando e reader | Contar com o GC para devolver uma conexão |
| Parâmetros (`$1` ou `@name`) | Interpolação de valores na string |
| `GetOrdinal` uma vez, depois `GetInt32`/`GetFieldValue<T>` | `reader["col"]` num loop de um milhão de linhas |
| `DbBatch` ou `BeginBinaryImport` para muitas linhas | Um `ExecuteNonQuery` por linha |
| `while (await r.ReadAsync())` para resultados grandes | `ToList` de um milhão de linhas |
| Retry em erros transitórios (57P01 depois de um restart) | Supor que uma conexão do pool está viva |

## Trade-offs

- **O pool esconde custo e vazamentos na mesma medida.** Abrir, `SELECT 1` e fechar levou cerca de 0,09 ms com o pool, então abra tarde e feche cedo; mas um dispose esquecido só aparece sob carga, como uma trava de `Timeout` segundos e depois uma exceção.
- **O tamanho do pool é um contrato com o servidor.** Cada pool de 100 por processo, vezes as réplicas, precisa caber no `max_connections` do servidor (100 no meu cluster). Um pooler do lado do servidor encaixa melhor quando muitos processos dividem um banco.
- **Código independente de provider para no SQL.** `System.Data.Common` deixou um método rodar em SQLite e PostgreSQL, mas placeholders, `COPY`, suporte a batch e códigos de erro diferem, como mostrou `CanCreateBatch=False`.
- **`COPY` é o mais rápido e o menos flexível.** É só do PostgreSQL, recebe valores tipados na ordem das colunas e não é um `INSERT` (sem `ON CONFLICT`, sem `RETURNING`); `DbBatch` mantém a semântica normal do SQL com um round trip.
- **ADO.NET cru significa que o mapeamento é seu.** Cada getter tipado precisa bater com o tipo de coluna que o provider devolve (`count(*)` é `Int64`, não `Int32`).

## Documentation Links

- [SQL Server connection pooling (ADO.NET), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/sql-server-connection-pooling) (doc)
- [DbDataSource class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbdatasource?view=net-10.0) (doc)
- [DbBatch class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbbatch?view=net-10.0) (doc)
- [Npgsql basic usage, Npgsql documentation](https://www.npgsql.org/doc/basic-usage.html) (doc)
- [Npgsql connection string parameters, Npgsql documentation](https://www.npgsql.org/doc/connection-string-parameters.html) (doc)
- [Npgsql performance, Npgsql documentation](https://www.npgsql.org/doc/performance.html) (doc)
