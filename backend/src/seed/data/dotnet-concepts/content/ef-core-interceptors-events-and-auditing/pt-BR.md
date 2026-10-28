---
version: 1.1
updatedAt: 2026-10-28
title: "Interceptors, eventos e auditoria no EF Core"
summary: As famílias de interceptors do EF Core 10 e a ordem dos hooks, registro e lifetimes de DI, o hook sync que não chama o async, curto-circuito com InterceptionResult, um interceptor de auditoria e soft delete na mesma transação e o que passa por fora dele, log de query lenta e tenant id para row-level security no PostgreSQL, os eventos .NET e o custo de um interceptor, com o resultado medido de cada experimento.
---
## Objective

O EF Core oferece duas formas de rodar seu próprio código em volta do trabalho dele. Interceptors (`SaveChangesInterceptor`, `DbCommandInterceptor`, `DbConnectionInterceptor`, `DbTransactionInterceptor`, `IMaterializationInterceptor`, `IQueryExpressionInterceptor`, `IIdentityResolutionInterceptor`) ficam dentro do pipeline e podem alterar ou suprimir a operação. Eventos .NET (`SavingChanges`, `SavedChanges`, `SaveChangesFailed`, `ChangeTracker.Tracked`, `ChangeTracker.StateChanged`) apenas observam. A lição de logging já conta SQL com um command interceptor, e a lição de domain events despacha a partir de `SavingChangesAsync`; esta trata do mecanismo em si e do padrão de auditoria que a maioria dos times constrói com ele. Rodei cada peça: a ordem em que os hooks disparam, registro versus lifetimes de DI, a armadilha sync e async, curto-circuito com `InterceptionResult`, um interceptor de auditoria que carimba `CreatedAt`/`UpdatedAt`/`UpdatedBy` e grava linhas de auditoria na mesma transação (com os dois bugs que minha primeira versão tinha), soft delete, o que passa por fora de tudo isso, um log de query lenta e um tenant id para row-level security no PostgreSQL, os eventos e o custo de um interceptor em 10 000 queries. Versões usadas: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14 (EF Core 10.0.14), `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (o major que corresponde ao EF Core 10) com Npgsql 10.0.3, contra um PostgreSQL 18.6 local.

## Use Cases

- Carimbar `CreatedAt`, `UpdatedAt` e `UpdatedBy` e gravar uma trilha de auditoria sem mexer em cada command handler.
- Transformar `Remove` em soft delete para entidades que nunca podem sumir fisicamente.
- Registrar em produção todo comando SQL mais lento que um limite, com o texto do comando.
- Definir um tenant id na sessão do banco quando a conexão abre, para que o row-level security do PostgreSQL garanta o isolamento.

## Deep Dive

### As famílias e a ordem em que os hooks disparam

Registrei um interceptor de rastreio por família num contexto SQLite em arquivo e rodei uma query, a mesma query de novo e um `SaveChanges` com dois inserts (pares unidos com `/` para economizar espaço):

```text
-- query
QueryExpression.QueryCompilationStarting
Connection.ConnectionOpening / ConnectionOpened
Command.CommandCreating (LinqQuery) / CommandInitialized / ReaderExecuting / ReaderExecuted
Materialization.CreatingInstance (Product) / CreatedInstance / InitializingInstance / InitializedInstance
Command.DataReaderClosing / DataReaderDisposing, Connection.ConnectionClosing / ConnectionClosed
-- same query again: identical, without the QueryExpression line
-- SaveChanges with two inserts
SaveChanges.SavingChanges, Connection.ConnectionOpening / ConnectionOpened, Transaction.TransactionStarting
Command.CommandCreating (SaveChanges) / ... / DataReaderDisposing   (same six hooks, twice)
Transaction.TransactionCommitting / TransactionCommitted, Connection.ConnectionClosing / ConnectionClosed
SaveChanges.SavedChanges (result=2)
```

O hook de expressão de query se chama `QueryCompilationStarting` e disparou só uma vez: a segunda execução caiu no cache de queries compiladas, então uma reescrita de expressão ali roda uma vez por formato de query, não por execução. Um `SaveChanges` com um único `UPDATE` não produziu nenhum hook de transação, porque o EF Core não abriu transação para um comando só. `CommandEventData.CommandSource` (`LinqQuery`, `SaveChanges`, `FromSqlQuery`, ...) é o jeito barato de filtrar. A documentação marca `IMaterializationInterceptor`, `IQueryExpressionInterceptor` e `IIdentityResolutionInterceptor` como interceptors singleton. O último decide o que acontece quando você anexa uma instância cuja chave já está rastreada. Anexar `Product { Id = 1, Price = 99 }` sobre um `Price` 1 rastreado lançou `InvalidOperationException: The instance of entity type 'Product' cannot be tracked because another instance with the same key value for {'Id'} is already being tracked` sem interceptor; com o `IgnoringIdentityResolutionInterceptor` embutido a instância rastreada manteve `Price=1.0` (`Unchanged`), e com o `UpdatingIdentityResolutionInterceptor` passou a `Price=99` (`Modified`).

### Registro e lifetimes

`AddInterceptors` recebe instâncias, em `OnConfiguring` ou dentro de `AddDbContext`; a documentação diz que interceptors "are registered per DbContext instance when the context is configured". Com `AddDbContext` a action de options rodou uma vez por escopo, então pude resolver o interceptor a partir do escopo. Registrei um interceptor que recebe um `ICurrentUser` scoped de três formas e abri dois escopos em cada uma:

```csharp
s.AddScoped<ICurrentUser, CurrentUser>();
s.AddScoped<UserStamp>();   // depois AddSingleton<UserStamp>(), depois AddDbContextPool
s.AddDbContext<Shop>((sp, o) => o.UseSqlite(cs).AddInterceptors(sp.GetRequiredService<UserStamp>()));
```

```text
scoped:                 scope 0 sees user-1 (scope has user-1), scope 1 sees user-2 (scope has user-2)
singleton, validation:  InvalidOperationException: Cannot consume scoped service 'ICurrentUser' from singleton 'UserStamp'.
singleton, no valid.:   scope 0 sees user-3 (scope has user-4), scope 1 sees user-3 (scope has user-5)
pool, validation:       InvalidOperationException: Cannot resolve scoped service 'UserStamp' from root provider.
```

Sem validação de escopo, o singleton capturou o primeiro usuário para sempre, então toda requisição seguinte seria auditada como `user-3`. Com `AddDbContextPool` as options vêm do provider raiz, então dados por requisição precisam vir de um accessor singleton (por exemplo um baseado em `AsyncLocal`, como o `IHttpContextAccessor`), não do construtor. Para as famílias singleton, a documentação avisa que uma instância nova a cada configuração "will eventually trigger a `ManyServiceProvidersCreatedWarning`". Criei 30 contextos com um interceptor `new` em cada. Um command interceptor não deu problema; um materialization interceptor lançou exceção, porque o EF Core 10 transforma esse warning em exceção por padrão: `InvalidOperationException: An error was generated for warning '...ManyServiceProvidersCreatedWarning': More than twenty 'IServiceProvider' instances have been created for internal use by Entity Framework.`

### Sync e async são hooks separados

Um interceptor sobrescreveu só `SavingChangesAsync`, outro só `SavingChanges`; chamei cada API uma vez:

```text
after SaveChanges():      asyncOnly=0 syncOnly=1
after SaveChangesAsync(): asyncOnly=1 syncOnly=1
```

Nenhum método base encaminha para o outro, então uma auditoria escrita só para o caminho async ignora em silêncio todo `SaveChanges()`, que é o que um script de seed ou um teste antigo chama. A documentação: "Overriding both sync and async methods ensures that auditing will happen regardless of whether `SaveChanges` or `SaveChangesAsync` are called"; ela também sugere lançar exceção no método sync para forçar o async.

### Curto-circuito com InterceptionResult

Todo hook "-ing" recebe um `InterceptionResult` e devolve um. Devolvê-lo sem mudança deixa o EF Core continuar, `SuppressWithResult(...)` pula a operação e entrega seu valor ao EF Core, e `HasResult` avisa um interceptor posterior que um anterior já fez isso. Fiz cache de uma query marcada com a tag `cache`, coloquei um observador depois dele, renomeei a linha entre duas execuções e rastreei o próprio motor do SQLite com `sqlite3_trace`:

```csharp
public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand c, CommandEventData e, InterceptionResult<DbDataReader> r)
    => c.CommandText.StartsWith("-- cache") && _cached is not null
        ? InterceptionResult<DbDataReader>.SuppressWithResult(_cached.CreateDataReader())   // DataTable preenchida em ReaderExecuted
        : r;
```

```text
query 1:  [observer] HasResult=False
          [sqlite engine] -- cache  SELECT "p"."Name" FROM "Products" AS "p" WHERE NOT ("p"."IsDeleted")
          [log] Executed DbCommand (3ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
          -> [kb]
          [sqlite engine] UPDATE Products SET Name = 'renamed'
query 2:  [cache] hit, suppressing the command
          [observer] HasResult=True
          [log] Executed DbCommand (0ms) [Parameters=[], CommandType='Text', CommandTimeout='30']
          -> [kb]
```

O motor nunca viu o segundo SELECT e o nome antigo voltou. O EF Core ainda registrou `Executed DbCommand (0ms)` para o comando suprimido, então o log do EF sozinho não prova que um comando chegou ao banco. Minha primeira versão fazia cache de linhas inteiras de `Product` e falhou com `InvalidCastException: Unable to cast object of type 'System.Int64' to type 'System.Int32'`: o SQLite devolve `INTEGER` como `Int64` e o shaper chama `GetInt32` no reader substituto. A documentação avisa que o EF Core "may behave in unexpected ways if it gets an abnormal result". O mesmo funciona um nível acima: `InterceptionResult<int>.SuppressWithResult(0)` em `SavingChanges` fez `SaveChanges()` devolver 0, não gravou nada e deixou a entidade como `Added`. Uma guarda em `NonQueryExecuting` que suprime `DELETE` sem `WHERE` fez `IgnoreQueryFilters().ExecuteDelete()` devolver -1 com a linha ainda lá.

### Um interceptor de auditoria na mesma transação

Em `SavingChanges`, percorra `ChangeTracker.Entries()`, carimbe as colunas e adicione entidades `AuditLog` ao mesmo contexto; o mesmo `SaveChanges` as insere, então elas sofrem commit ou rollback junto com a mudança de negócio.

```csharp
void Stamp(DbContext db)   // chamado em SavingChanges E em SavingChangesAsync
{   var now = clock.GetUtcNow().UtcDateTime; var logs = new List<AuditLog>();
    foreach (var entry in db.ChangeTracker.Entries().Where(x => x.Entity is not AuditLog))   // Entries() roda DetectChanges
    {   if (entry.Entity is IAudited && entry.State == EntityState.Added) entry.Property("CreatedAt").CurrentValue = now;
        if (entry.Entity is IAudited && entry.State == EntityState.Modified)
        { entry.Property("UpdatedAt").CurrentValue = now; entry.Property("UpdatedBy").CurrentValue = user.Name; }
        if (entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            logs.Add(ToAudit(entry, user.Name, now)); }   // tabela, ação, chave, "Prop:antigo->novo"
    db.Set<AuditLog>().AddRange(logs); }
```

```text
audit #1 Added Products key=-2147482647 (temporary) by=ana [CreatedAt=10/28/2026 12:00:00 PM, ..., Name=mouse, Price=10, ...]
audit #2 Added Products key=-2147482646 (temporary) by=ana [..., Name=pad, Price=5, ...]
row: CreatedAt=12:00 UpdatedAt=12:05 UpdatedBy=ana
audit #3 Modified Products key=1 by=ana [Price:10.0->12, UpdatedAt:->10/28/2026 12:05:00 PM, UpdatedBy:->ana]
```

A chave de uma linha inserida ainda é temporária (`-2147482647`) em `SavingChanges`, porque o banco ainda não a gerou. Use chaves geradas no cliente (`Guid.CreateVersion7()`) ou preencha a chave em `SavedChanges`, o que exige um segundo save depois do commit. Minha primeira versão também definia os carimbos pela entidade (`a.UpdatedAt = now`): eles foram salvos, porque o `SaveChanges` roda `DetectChanges` depois do interceptor, mas a auditoria #3 listava só `Price`. `entry.Property(...).CurrentValue` os marca como modificados na hora.

### Falhas, novas tentativas e o que passa por fora do interceptor

Fiz o `SaveChanges` falhar com um `Name` duplicado (índice único) enquanto ele também levava uma mudança de preço válida:

```text
DbUpdateException: SQLite Error 19: 'UNIQUE constraint failed: Products.Name'.
audit rows before=3 after=3, pad price in db=5.0, SaveChangesFailed calls=1
AuditLog entities still tracked as Added: 2
after fixing the name and saving again: audit rows=7
```

O rollback funcionou, mas as duas entidades `AuditLog` continuaram rastreadas e a nova tentativa gravou as duas mais duas novas: quatro linhas para duas mudanças, uma delas descrevendo um insert que nunca aconteceu. Desanexá-las em `SaveChangesFailed` e `SaveChangesFailedAsync` (`foreach (var a in e.Context!.ChangeTracker.Entries<AuditLog>().Where(x => x.State == EntityState.Added).ToList()) a.State = EntityState.Detached;`) resolveu: a mesma nova tentativa gravou 2 linhas. A documentação acrescenta que um conflito de concorrência chama `ThrowingConcurrencyException` e o cancelamento chama `SaveChangesCanceled`, em vez de `SaveChangesFailed`. Depois contornei o `SaveChanges` no mesmo contexto com `ExecuteUpdate` em `pad`, `ExecuteSql($"UPDATE Products SET Price = 8 ...")` e `ExecuteDelete` em `mouse-2`. A execução imprimiu `interceptor calls +0, audit rows +0, pad.Price=7.0 pad.UpdatedAt=12:05 (unchanged)` e `mouse-2 rows incl. filtered: 0`. A documentação diz que `ExecuteUpdate`/`ExecuteDelete` são "completely unaware of EF's change tracker", e a consequência é real: nenhum carimbo, nenhuma linha de auditoria e a exclusão física de uma linha que a regra de soft delete abaixo teria mantido. Um command interceptor ainda vê esses comandos; um `SaveChangesInterceptor`, não.

### Soft delete, e como ele se divide com o query filter

No mesmo laço, uma entrada `Deleted` que implementa `ISoftDelete` vira um update de duas colunas:

```csharp
if (entry.State == EntityState.Deleted && entry.Entity is ISoftDelete)
{   entry.State = EntityState.Unchanged;                 // cancela o DELETE
    entry.Property("IsDeleted").CurrentValue = true;     // só essas duas ficam Modified
    entry.Property("DeletedAt").CurrentValue = now; }
```

```text
[sql] UPDATE "Products" SET "DeletedAt" = @p0, "IsDeleted" = @p1 WHERE "Id" = @p2 RETURNING 1;
state after SaveChanges: Unchanged, IsDeleted=True
default query: [pad]  IgnoreQueryFilters: [mouse,pad]
```

Minha primeira versão fazia `entry.State = EntityState.Modified`, o que marca todas as propriedades como modificadas: o `UPDATE` reescreveu as sete colunas. O interceptor cuida da escrita; o global query filter (`HasQueryFilter(p => !p.IsDeleted)`, que tem lição própria) cuida da leitura. Nenhum dos dois cobre `ExecuteDelete` nem SQL puro.

### Um log de query lenta no PostgreSQL

O EF Core mede `CommandExecutedEventData.Duration`, então um log de query lenta é uma comparação nos hooks "-ed" (sobrescrevi `ReaderExecuted` e `ReaderExecutedAsync`, imprimindo no console; `NonQueryExecuted` e `ScalarExecuted` precisam da mesma checagem para cobrir `ExecuteUpdate` e escalares), mais `CommandFailed` para erros. Com limite de 200 ms rodei `SELECT 1`, depois `pg_sleep(0.3)` e depois uma divisão por zero:

```csharp
if (e.Duration > threshold) logger.LogWarning("{Ms} ms ({Source}): {Sql}", e.Duration.TotalMilliseconds, e.CommandSource, c.CommandText);
```

```text
fast query done (nothing logged above)
  [slow] 303 ms (FromSqlQuery): SELECT 1 AS "Value" FROM pg_sleep(0.3)
  [failed] after 2 ms: 22012: division by zero
  caller got PostgresException
```

### Contexto de tenant na conexão

Um `DbConnectionInterceptor` pode rodar SQL logo depois que a conexão abre. Defini uma configuração que uma política de row-level security lê, e conectei com um role que não é dono da tabela (a documentação do PostgreSQL diz que donos e superusers ignoram o RLS):

```csharp
public override async Task ConnectionOpenedAsync(DbConnection c, ConnectionEndEventData e, CancellationToken ct = default)
{   await using var cmd = c.CreateCommand();
    cmd.CommandText = "SELECT set_config('app.tenant_id', @t, false)";
    cmd.Parameters.Add(new NpgsqlParameter("t", tenantId.ToString()));
    await cmd.ExecuteNonQueryAsync(ct); }   // e o mesmo no ConnectionOpened sync
// política: USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::int), mesmo WITH CHECK
```

```text
no interceptor: []
tenant 1:       [t1-a,t1-b]
tenant 2:       [t2-a]
tenant 1 inserts tenant 2 row: 42501: new row violates row-level security policy for table "orders"
next pooled context without interceptor: app.tenant_id='', rows=[]
next pooled context without interceptor;No Reset On Close=true: app.tenant_id='1', rows=[t1-a,t1-b]
```

O `nullif` existe porque minha primeira política falhou com `22P02: invalid input syntax for type integer: ""`: depois que o Npgsql resetou uma conexão do pool, a configuração voltou como string vazia, não NULL. Com o reset padrão, o próximo a pegar a conexão não viu nada; com `No Reset On Close=true`, um contexto sem o interceptor leu as linhas do tenant 1. Defina o valor em toda abertura e nunca dependa do anterior. A documentação do PostgreSQL diz que `set_config(..., true)` limita o valor à transação corrente.

### Eventos .NET em vez de um interceptor

Assinei os cinco eventos ao lado de um `SaveChangesInterceptor` (`db.SavingChanges += ...`, `db.ChangeTracker.StateChanged += ...` e assim por diante), carreguei, modifiquei e salvei, e por fim fiz um save falhar:

```text
-- query + modify + save                       -- failing save
event Tracked Product FromQuery=True ...       event Tracked Product FromQuery=False state=Added
event SavingChanges acceptAll=True             event SavingChanges acceptAll=True
SaveChanges.SavingChanges   (interceptor)      SaveChanges.SavingChanges   (interceptor)
event StateChanged Unchanged->Modified         event SaveChangesFailed DbUpdateException
event StateChanged Modified->Unchanged
SaveChanges.SavedChanges (result=1)
event SavedChanges count=1
```

O evento dispara logo antes do interceptor na entrada e logo depois dele na saída, e `Unchanged->Modified` só apareceu depois do interceptor, que é o `DetectChanges` que o `SaveChanges` roda nesse ponto. Os argumentos dos eventos (`AcceptAllChangesOnSuccess`, `EntitiesSavedCount`, `Exception`) não têm resultado para substituir, então um evento não consegue suprimir nem alterar nada, e a documentação observa que eventos são só sync. Eventos bastam para carimbos ou notificações num contexto que você mesmo constrói; um interceptor é necessário para suprimir, substituir resultados, fazer I/O async, enxergar comandos e conexões ou vir do DI para todo contexto.

### Quanto custa um interceptor

Rodei 10 000 queries de uma linha em SQLite em memória (Release, 7 rodadas, mediana) sem interceptor, com um cujo `ReaderExecuting` apenas devolve `result` e com uma subclasse vazia de `DbCommandInterceptor`:

```text
none            median 106 ms (min 104, max 290) = 10.6 us/query
empty override  median 114 ms (min 112, max 327) = 11.4 us/query
no override     median 117 ms (min 113, max 317) = 11.7 us/query
```

Uma segunda execução deu 107, 114 e 114 ms. Registrar qualquer command interceptor somou cerca de 0,7 a 1 microssegundo por query, com ou sem override: aproximadamente 7% de uma query que quase não faz nada, e ruído perto de uma ida e volta pela rede. O que custa é o que você coloca dentro do hook.

### Interceptor, evento, override de SaveChanges ou trigger

| | Interceptor | Evento .NET | Override de `SaveChanges` | Trigger no banco |
|---|---|---|---|---|
| Suprime ou altera o resultado | Sim | Não | Sim | Sim, em SQL |
| I/O async | Sim, hooks async separados | Não | Sim, em `SaveChangesAsync` | Não se aplica |
| Vê comandos e conexões | Sim | Não | Não | Não se aplica |
| Aplicado a todo contexto via DI | Sim | Ligado por instância | Via classe base | Por tabela |
| Vê `ExecuteUpdate`, `ExecuteDelete`, SQL puro | Só no nível de comando | Não | Não | Sim |
| Conhece o usuário da aplicação | Sim | Sim | Sim | Só via contexto da sessão |

Conferi a coluna do trigger nos caminhos em massa: um trigger `AFTER UPDATE` no SQLite gravou uma linha tanto para `ExecuteUpdate` quanto para SQL puro (`Price 1.0->2.0`, `Price 2.0->3`), cada uma com `user=<null>`, já que o trigger não tem como saber o usuário da aplicação a menos que você o coloque na sessão, como no exemplo de tenant.

## Trade-offs

- **A auditoria só é tão completa quanto o caminho de escrita.** `ExecuteUpdate`, `ExecuteDelete`, SQL puro e outras aplicações passam por fora de um `SaveChangesInterceptor`. Se a auditoria é exigência de compliance, um trigger (sozinho ou junto) é a resposta honesta.
- **Auditoria na mesma transação acopla falhas.** Uma exceção ao montar as linhas de auditoria derruba o save de negócio. Isso costuma ser o certo para auditoria, mas mantenha chamadas de rede fora do interceptor.
- **Sobrescreva os dois hooks, sempre.** Sync e async nunca encaminham um para o outro, e uma suíte de testes que chama só um deles passa de qualquer jeito. Se você quer só async, faça o hook sync lançar exceção em vez de deixá-lo vazio.
- **Lifetimes falham em silêncio.** Um interceptor singleton com dependência scoped audita toda requisição como o primeiro usuário quando a validação de escopo está desligada. Com `AddDbContextPool`, leia dados por requisição de um accessor.
- **Supressão se esconde do log.** Um comando suprimido ainda aparece como `Executed DbCommand (0ms)`, e um reader substituto precisa devolver exatamente os tipos CLR esperados. Mantenha esses interceptors raros e documentados.
- **Estado de sessão e pooling.** Um tenant id definido na conexão precisa ser definido em toda abertura; desligar o reset do pool vazou as linhas do tenant 1 para o próximo contexto na minha execução.
- **Custo pequeno, em toda operação.** Cerca de 1 microssegundo por query só pelo despacho; um hook que aloca, loga ou faz I/O multiplica isso por cada comando.

## Documentation Links

- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [.NET events in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/events) (doc)
- [Change detection and notifications, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/change-detection) (doc)
- [SaveChangesInterceptor class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.diagnostics.savechangesinterceptor?view=efcore-10.0) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Row Security Policies, PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) (doc)
