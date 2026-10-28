---
version: 1.0
updatedAt: 2026-10-28
title: "Transações explícitas, savepoints e TransactionScope"
summary: Controle explícito de transações no EF Core 10 medido em SQLite e PostgreSQL: BeginTransaction com vários SaveChanges, AutoTransactionBehavior no log, o savepoint que o EF cria sozinho, transação compartilhada com ADO.NET, execution strategy com retry, níveis de isolamento com duas conexões, TransactionScope e async, prepared transactions e espera por lock.
---
## Objective

A transação implícita em volta de um `SaveChanges` resolve a maioria das escritas. No resto do tempo você precisa controlar a transação: vários `SaveChanges` que devem ser confirmados juntos, SQL cru de ADO.NET ou no estilo Dapper que precisa sofrer rollback junto com as mudanças do EF, um nível de isolamento mais forte que o padrão, ou um retry quando o banco rejeita uma transação. O EF Core 10 oferece `Database.BeginTransactionAsync`, `AutoTransactionBehavior`, savepoints, `UseTransaction` e `GetDbTransaction`, e também funciona com `System.Transactions.TransactionScope`. Várias dessas ferramentas se comportam de um jeito diferente do que o nome sugere: o EF adiciona um savepoint em silêncio dentro da sua transação, uma execution strategy com retry rejeita a sua transação, o `TransactionScope` usa Serializable por padrão e perde a transação ambiente sem avisar depois de um `await`, e duas conexões num mesmo scope viram uma prepared transaction do PostgreSQL. Esta lição estende a lição de transações e concorrência otimista: rodei cada caso em SQLite e num PostgreSQL 18.6 local com duas conexões reais, registrei os eventos de transação do EF e o log de statements do servidor, e cito as exceções exatamente como saíram. Versões usadas: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14 (`Microsoft.Data.Sqlite.Core` 10.0.14), `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (a linha 10.x é a feita para o EF Core 10, com `Npgsql` 10.0.3), PostgreSQL 18.6.

## Use Cases

- Salvar um pedido e depois chamar `SaveChanges` de novo para a reserva de estoque, mantendo os dois ou descartando os dois.
- Rodar uma consulta no estilo Dapper ou um `NpgsqlCommand` cru dentro da mesma transação das mudanças do EF.
- Garantir uma regra que envolve várias linhas (pelo menos um médico de plantão, um saldo que não pode ficar negativo) com isolamento Serializable e um loop de retry.
- Evitar que um passo opcional (uma linha de auditoria, uma linha de importação best-effort) aborte a unidade de trabalho inteira, usando um savepoint.

## Deep Dive

### Uma transação para vários SaveChanges

Meu modelo é uma tabela `accounts` com índice único em `name`, com `alice` e `bob` como dados iniciais. Sem transação explícita cada `SaveChanges` é confirmado sozinho; com uma, nada fica até o `CommitAsync`:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
db.Accounts.Add(new() { Name = "carol" });
await db.SaveChangesAsync();
db.Accounts.Add(new() { Name = "dave" });
await db.SaveChangesAsync();
throw new InvalidOperationException("payment gateway said no"); // CommitAsync nunca roda
```

```text
no explicit transaction, second SaveChanges fails (duplicate name): DbUpdateException, rows: alice,bob,carol
explicit transaction, exception before commit:                     payment gateway said no, rows: alice,bob
```

Mesmo resultado em SQLite e PostgreSQL. Não há bloco catch aqui: o dispose da transação não confirmada fez o rollback, então declare sempre com `await using`.

### AutoTransactionBehavior, visto no log

`db.Database.AutoTransactionBehavior` decide se o `SaveChanges` abre a própria transação quando não existe nenhuma. Registrei `TransactionStarted`, `CommandExecuted` e `TransactionCommitted` com `LogTo(filter, Action<EventData>)`:

```text
sqlite WhenNeeded, 1 insert:  INSERT ... RETURNING "id";                        (no transaction events)
sqlite WhenNeeded, 2 inserts: [TransactionStarted] isolation level 'Serializable', INSERT, INSERT, [TransactionCommitted]
sqlite Never, 2 inserts:      INSERT, INSERT                                     (no transaction events)
sqlite Always, 1 insert:      [TransactionStarted], INSERT, [TransactionCommitted]
pg WhenNeeded, 2 inserts:     [TransactionStarted] isolation level 'ReadCommitted', one command with both INSERTs, [TransactionCommitted]
pg Never, 2 inserts:          one command with both INSERTs                      (no transaction events)
```

`WhenNeeded` (o padrão) dispensa a transação para um único statement, que já é atômico. O arriscado é o `Never`. Com uma duplicata no segundo insert, o SQLite manteve a primeira linha (`rows: alice,bob,carol`). O PostgreSQL não manteve nada (`rows: alice,bob`), porque o Npgsql enviou os dois statements num único batch e o batch falhou como unidade; com `MaxBatchSize(1)` ele se comportou como o SQLite e manteve `carol`. O resultado do `Never` depende de como o provider agrupa os comandos, e a documentação avisa que comandos anteriores podem já ter sido confirmados.

### O savepoint que o EF cria para você

Quando o `SaveChanges` roda dentro da sua transação, o EF o envolve num savepoint. O log do EF só diz `Created transaction savepoint.`, então liguei `log_statement = 'all'` no PostgreSQL. O segundo `SaveChanges` adiciona `dave` e um `alice` duplicado:

```text
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED / SAVEPOINT "__EFSavePoint" / INSERT ... (carol) / RELEASE SAVEPOINT "__EFSavePoint"
SAVEPOINT "__EFSavePoint" / INSERT ... ; INSERT ... (dave, alice)
ERROR:  duplicate key value violates unique constraint "IX_accounts_name"
ROLLBACK TO "__EFSavePoint" / RELEASE SAVEPOINT "__EFSavePoint" / COMMIT

DbUpdateException: An error occurred while saving the entity changes. See the inner exception for details.
  inner PostgresException: 23505: duplicate key value violates unique constraint "IX_accounts_name"
tracked after failure: dave:Added,alice:Added
in tx: alice,bob,carol      after commit: alice,bob,carol
```

O `SaveChanges` que falhou foi desfeito (`dave` também sumiu), o `carol` anterior sobreviveu e a transação continuou utilizável, então o `CommitAsync` funcionou. O SQLite registrou a mesma sequência de eventos (`CreatedTransactionSavepoint`, `RolledBackToTransactionSavepoint`, `ReleasedTransactionSavepoint`) com o mesmo resultado. Dois detalhes: o change tracker continua com as duas entidades como `Added`, então chamar `SaveChanges` de novo repete a falha até você corrigir ou desanexar essas entidades; e no PostgreSQL é esse savepoint que mantém a transação viva. Um statement cru que falhou fora do savepoint do EF (o mesmo 23505) abortou a transação inteira, e o `SaveChanges` seguinte recebeu `PostgresException: 25P02: current transaction is aborted, commands ignored until end of transaction block`. A documentação diz que o EF não cria savepoints no SQL Server quando o MARS está habilitado, e que a transação pode então ficar num estado desconhecido depois de uma falha.

### Seus próprios savepoints

Dentro da mesma transação chamei `tx.CreateSavepointAsync("BeforeOptional")`, salvei `dave`, depois `RollbackToSavepointAsync("BeforeOptional")`, `ReleaseSavepointAsync("BeforeOptional")` e `CommitAsync()`:

```text
SAVEPOINT "BeforeOptional" / SAVEPOINT "__EFSavePoint" / INSERT / RELEASE SAVEPOINT "__EFSavePoint"
ROLLBACK TO "BeforeOptional" / RELEASE SAVEPOINT "BeforeOptional" / COMMIT
after RollbackToSavepoint: carol:Unchanged:id=3,dave:Unchanged:id=4
after commit: alice,bob,carol      (SupportsSavepoints=True on both providers)
```

Voltar a um savepoint desfaz linhas, não o change tracker: ele ainda mostrava `dave` como `Unchanged` com id 4, uma linha que não existe mais. Limpe ou recarregue depois disso.

### Compartilhando a transação com código ADO.NET

Do EF para o SQL cru, pegue a conexão e a `DbTransaction` do contexto:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
// ... SaveChanges adiciona carol
var conn = (NpgsqlConnection)db.Database.GetDbConnection();
await using var cmd = new NpgsqlCommand("INSERT ... 'raw-with-tx' ...", conn, (NpgsqlTransaction)tx.GetDbTransaction());
await cmd.ExecuteNonQueryAsync();   // um segundo comando, 'raw-no-tx', omite o argumento da transação
await tx.RollbackAsync();
```

```text
raw with Transaction: 1 row   raw without Transaction: 1 row   inside tx count: 5   after rollback: alice,bob
```

As três linhas sumiram com o rollback, inclusive a do comando criado sem `Transaction`: a documentação do Npgsql diz que todo comando numa conexão com transação aberta participa dela, e recomenda definir a transação mesmo assim por portabilidade. O Microsoft.Data.Sqlite é mais rígido. `conn.CreateCommand()` copiou a transação pendente para o comando, mas `new SqliteCommand(sql, conn)` falhou com `InvalidOperationException: Execute requires the command to have a transaction object when the connection assigned to the command is in a pending local transaction.  The Transaction property of the command has not been initialized.`

Do SQL cru para o EF, abra você mesmo a conexão e a transação, construa o contexto sobre essa conexão e chame `UseTransactionAsync`:

```csharp
await using var dbtx = await conn.BeginTransactionAsync();   // conn: uma NpgsqlConnection aberta
// cru: UPDATE accounts SET balance = balance - 30 WHERE name = 'alice'
await using var db = new Shop(new DbContextOptionsBuilder<Shop>().UseNpgsql(conn).Options);
await db.Database.UseTransactionAsync(dbtx);
db.Accounts.Add(new() { Name = "erin", Balance = 30 });
await db.SaveChangesAsync();
await dbtx.CommitAsync();
```

```text
EF CurrentTransaction is ours: True    after commit: alice,bob,erin    alice balance: 70
```

### Execution strategy e a sua própria transação

Com `EnableRetryOnFailure`, o próprio `BeginTransactionAsync` retornou normalmente. A primeira operação do EF dentro dele falhou, tanto no `SaveChanges` quanto numa consulta, com `InvalidOperationException: The configured execution strategy 'NpgsqlRetryingExecutionStrategy' does not support user-initiated transactions. Use the execution strategy returned by 'DbContext.Database.CreateExecutionStrategy()' to execute all the operations in the transaction as a retriable unit.`

`ExecuteSqlRawAsync("SELECT 1")` na mesma transação não lançou exceção, então SQL cru passa por fora dessa verificação. A forma que funciona entrega a unidade inteira à strategy, e rodou com `attempts=1, rows: alice,bob,carol,dave`:

```csharp
await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
{
    db.ChangeTracker.Clear();   // um retry precisa começar com o tracker limpo
    await using var tx = await db.Database.BeginTransactionAsync();
    // ... dois SaveChanges
    await tx.CommitAsync();
});
```

### Níveis de isolamento no PostgreSQL, medidos com duas conexões

A transação A lê alice (saldo 100) pelo EF; a conexão B muda para 50 e confirma; A lê de novo, depois subtrai 10 da entidade rastreada e salva. A teoria está na lição de system design Transactions, ACID, and Isolation Levels; isto é o que o EF e o PostgreSQL fizeram:

```text
ReadCommitted:  A read 1: 100, A read 2: 50 (non-repeatable read), A update + commit ok, final alice: 90
RepeatableRead: A read 1: 100, A read 2: 100 (snapshot)
  InvalidOperationException: An exception has been raised that is likely due to a transient failure.
    inner DbUpdateException: An error occurred while saving the entity changes. See the inner exception for details.
    inner PostgresException: 40001: could not serialize access due to concurrent update
  final alice: 50
```

O Read Committed perdeu a atualização de B: o EF gravou `balance = 90`, calculado a partir de uma leitura velha. O Repeatable Read recusou a escrita. Repare na exceção de fora: mesmo sem `EnableRetryOnFailure`, a execution strategy padrão (sem retry) do Npgsql embrulha um erro transitório (`IsTransient=True` para 40001) nessa `InvalidOperationException`, então `catch (DbUpdateException)` não a captura.

O Serializable também pega o write skew, em que duas transações leem as mesmas linhas e atualizam linhas diferentes. Regra: pelo menos uma conta precisa ficar de plantão. A e B contam 2, e cada uma desliga uma conta diferente:

```text
RepeatableRead: A commit ok, B commit ok, on call now: 0          (rule broken)
Serializable:   A commit ok, B SaveChanges:
  inner PostgresException: 40001: could not serialize access due to read/write dependencies among transactions
  DETAIL: Reason code: Canceled on identification as a pivot, during write.
  on call now: 1
```

A linha DETAIL só apareceu depois que adicionei `Include Error Detail=true` à connection string; por padrão o Npgsql a oculta. Para o SQL Server, a documentação diz que o padrão é `READ COMMITTED` com locks (com versionamento de linhas quando `READ_COMMITTED_SNAPSHOT` está `ON`, o padrão no Azure SQL Database), e que o isolamento `SNAPSHOT` precisa ser habilitado por banco e reporta conflitos de atualização como erro 3960. Não rodei SQL Server.

O Serializable só é correto com retry da transação inteira, lendo de novo a cada tentativa. A strategy de retry do Npgsql tratou 40001 como transitório, então com `UseNpgsql(cs, n => n.EnableRetryOnFailure(3, TimeSpan.FromMilliseconds(200), null))` ela pode ser o loop:

```csharp
await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
{
    db.ChangeTracker.Clear();
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    if (await db.Accounts.CountAsync(x => x.OnCall) < 2) return;   // a regra quebraria: desiste
    (await db.Accounts.SingleAsync(x => x.Name == "alice")).OnCall = false;
    await db.SaveChangesAsync();
    await tx.CommitAsync();
});
```

```text
attempt 1: sees 2 on call at 124 ms   (a rival transaction turns bob off meanwhile, SaveChanges fails with 40001)
attempt 2: sees 1 on call at 149 ms   -> rule would break, giving up
```

O retry releu os dados e tomou a decisão certa. Um loop escrito à mão que captura `PostgresException { SqlState: "40001" }` em qualquer ponto das inner exceptions faz o mesmo.

### SQLite: IsolationLevel é um mínimo

Chamei `SqliteConnection.BeginTransaction` com cada valor de `IsolationLevel`:

```text
Chaos, Snapshot                     -> ArgumentException: The IsolationLevel 'Chaos' is not supported. (same for 'Snapshot')
ReadUncommitted, ReadCommitted, RepeatableRead, Serializable, Unspecified -> tx.IsolationLevel=Serializable (PRAGMA read_uncommitted = 0)
with Cache=Shared: ReadUncommitted  -> tx.IsolationLevel=ReadUncommitted (PRAGMA read_uncommitted = 1)
```

A documentação diz que o nível é um mínimo, promovido para read uncommitted ou serializable, e que read uncommitted exige cache compartilhado. `BeginTransactionAsync(IsolationLevel.Snapshot)` pelo EF lançou a mesma `ArgumentException`, então código escrito para o snapshot isolation do SQL Server quebra em testes com SQLite.

### TransactionScope e async

O `TransactionScope` define um `Transaction.Current` ambiente, no qual o provider se alista quando uma conexão abre. Com o padrão `TransactionScopeAsyncFlowOption.Suppress`, ele fica guardado por thread. Forcei a continuação de um `await` para outra thread (uma task `LongRunning`), como acontece num thread pool ocupado. O scope foi criado na thread 6; depois do `await` eu estava na thread 11 com `Transaction.Current` nulo; o `SaveChanges` então rodou sem transação ambiente e fez autocommit (`rows: alice,bob,carol`), embora `Complete()` nunca tenha sido chamado.

Quando o `Dispose` rodou numa thread diferente da do construtor, ele lançou `InvalidOperationException: A TransactionScope must be disposed on the same thread that it was created.`; numa execução em que o trabalho tinha sido alistado e `Complete()` chamado, a linha não foi salva, e a chamada seguinte do EF falhou com `The current TransactionScope is already complete.`. Em qual thread você cai mudou de uma execução para outra, então isso falha de forma intermitente.

Com `new TransactionScope(TransactionScopeAsyncFlowOption.Enabled)` tudo funcionou, e omitir `Complete()` fez rollback (`no Complete: alice,bob`). O log do servidor mostrou mais uma surpresa, `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE`: um scope usa Serializable por padrão, a menos que você passe `TransactionOptions`.

Scopes aninhados: um scope interno `Required` sem `Complete()`, dentro de um externo que o chamou, terminou em `TransactionAbortedException: The transaction has aborted.` com `rows: alice,bob`; um `RequiresNew` interno que completou, dentro de um externo que não completou, deixou `rows: alice,bob,audit-log`. O `Required` entra na transação externa, então um único voto interno para abortar condena tudo. O `RequiresNew` (aqui com contexto e conexão próprios) confirma sozinho e sobrevive ao rollback externo, que é o padrão para uma linha de auditoria.

### Duas conexões num scope: prepared transactions, não MSDTC

Dois contextos salvando um depois do outro dentro de um scope usaram o mesmo backend (`pids: 14289 14289`) e um `COMMIT` simples; a documentação do Npgsql diz que ele reaproveita a conexão quando as duas nunca ficam abertas ao mesmo tempo. Depois abri as duas conexões antes de salvar. Com o padrão `max_prepared_transactions = 0`, o scope falhou no `Dispose` com `TransactionAbortedException: The transaction has aborted.`, inner `PostgresException: 55000: prepared transactions are disabled`, e nada foi salvo. Depois de reiniciar o PostgreSQL com `max_prepared_transactions = 10` ele confirmou, e o log do servidor mostrou um two-phase commit coordenado dentro do processo, sem promoção (`DistributedIdentifier` continuou todo zerado):

```text
[17373] PREPARE TRANSACTION '00000000-0000-0000-0000-000000000000/17373'   (then 17374 the same)
[17373] COMMIT PREPARED '00000000-0000-0000-0000-000000000000/17373'       (then 17374 the same)
```

A documentação do Npgsql diz que ele não implementa a parte de recuperação e desaconselha depender disso: um crash entre PREPARE e COMMIT PREPARED deixa uma prepared transaction segurando locks até alguém resolvê-la à mão. Uma promoção de verdade não está disponível aqui: forçar uma com dois alistamentos duráveis no macOS deu `PlatformNotSupportedException: This platform does not support distributed transactions.`, e a documentação do EF diz que transações distribuídas só funcionam no Windows, desde o .NET 7. A lição de system design sobre transações distribuídas e two-phase commit explica por que isso é frágil.

### Não segure uma transação durante o tempo de reflexão do usuário ou chamadas HTTP

A conexão A atualiza alice e deixa a transação aberta, como faz um código enquanto espera um usuário ou uma API remota. A conexão B roda `BEGIN; SET LOCAL lock_timeout = '2s';` e atualiza a mesma linha:

```text
B after 2.00 s: 55P03: canceling statement due to lock timeout
B (no timeout) in pg_stat_activity: state=active wait=Lock/transactionid blocked_by={18517} (A pid 18517)
B unblocked after 3.01 s, when A committed
A with idle_in_transaction_session_timeout = '1s', idle 2 s, then COMMIT:
  PostgresException: 25P03: terminating connection due to idle-in-transaction timeout   (bob balance: 100, work lost)
```

Sem timeout, B espera enquanto A ficar aberta. `SET LOCAL` limita a configuração à transação atual (a tentativa seguinte não tinha timeout), e `idle_in_transaction_session_timeout` é a proteção do lado do servidor que mata uma transação esquecida.

### Escolhendo a ferramenta

| Necessidade | Use | Cuidado com |
|---|---|---|
| Uma unidade de mudanças | `SaveChanges` implícito | Nada; `WhenNeeded` já o torna atômico |
| Vários `SaveChanges`, SQL cru, outro nível de isolamento | `BeginTransactionAsync` | Envolver em `CreateExecutionStrategy().ExecuteAsync` quando há retry |
| Desfazer parte de uma transação | Savepoint (o EF cria um por `SaveChanges`) | O change tracker não volta junto |
| Código que não consegue receber uma `DbTransaction` (várias bibliotecas) | `TransactionScope` com `AsyncFlowOption.Enabled` | Serializable por padrão, prepared transactions com duas conexões abertas |

## Trade-offs

- **Uma transação explícita segura locks enquanto o seu código roda.** Leia, decida e chame APIs remotas antes do `BeginTransactionAsync`, ou use concorrência otimista entre requisições em vez de uma transação longa.
- **Isolamento mais forte transforma anomalias em exceções.** Repeatable Read e Serializable no PostgreSQL só são corretos com retry da unidade inteira, que precisa reler os dados e não ter efeitos colaterais externos.
- **O `TransactionScope` esconde muita coisa.** Serializable por padrão, nenhuma transação ambiente depois de `await` sem `AsyncFlowOption.Enabled`, um commit síncrono dentro do `Dispose` (segundo a documentação) e two-phase commit sem recuperação no Npgsql. Prefira `BeginTransactionAsync`, a menos que você realmente precise do padrão ambiente, e nesse caso passe `new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted }`.
- **Savepoints são um seguro barato, não um undo completo.** Eles mantêm a transação do PostgreSQL utilizável depois de um `SaveChanges` que falhou, mas você ainda precisa corrigir ou limpar as entidades rastreadas. Do mesmo jeito, `AutoTransactionBehavior.Never` economiza uma ida ao banco só onde sucesso parcial é aceitável.
- **O mesmo código se comporta diferente em cada provider.** O SQLite é sempre Serializable e rejeita `Snapshot`; os padrões do SQL Server diferem dos do PostgreSQL. Teste código sensível a isolamento no banco real.

## Documentation Links

- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Connection resiliency, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency) (doc)
- [TransactionScope class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.transactions.transactionscope?view=net-10.0) (doc)
- [Transactions in Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions) (doc)
- [Transaction locking and row versioning guide, SQL Server, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17) (doc)
- [Transaction Isolation, PostgreSQL documentation](https://www.postgresql.org/docs/current/transaction-iso.html) (doc)
