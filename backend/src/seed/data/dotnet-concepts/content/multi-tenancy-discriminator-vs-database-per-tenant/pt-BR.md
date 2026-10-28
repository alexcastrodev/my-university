---
version: 1.1
updatedAt: 2026-10-28
title: "Multi-tenancy: coluna discriminadora vs banco por tenant"
summary: Multi-tenancy com EF Core 10 medido na prática: filtro global que lê o tenant pela instância do contexto, filtros que congelam o primeiro tenant, escritas que o filtro não protege, índices únicos com TenantId, row-level security no PostgreSQL e quem a ignora, banco por tenant com factory e pooling, schema por tenant com IModelCacheKeyFactory e o que as migrations fazem com cada modelo.
---
## Objective

Uma aplicação multi-tenant atende muitos clientes a partir de um único deploy, e o único bug que ela nunca pode ter é mostrar as linhas do tenant A para o tenant B. O EF Core entrega peças, não um recurso pronto: a documentação lista três modelos de isolamento (uma coluna discriminadora `TenantId` em tabelas compartilhadas, um banco por tenant, um schema por tenant) e diz que o EF suporta o primeiro com filtros globais de query, o segundo com configuração e o terceiro de jeito nenhum ("not directly supported by EF Core and is not a recommended solution"). Este conceito monta os três no EF Core 10 e mede onde cada um vaza: um filtro que congela o primeiro tenant que viu, escritas que o filtro nunca verifica, um índice único que atravessa tenants, a row-level security do PostgreSQL como rede de segurança (e os papéis que a ignoram), um contexto em pool que guarda a connection string do tenant anterior, um modelo em cache que manda o tenant 2 para o schema do tenant 1, e o que as migrations fazem com bancos e schemas por tenant. Versões usadas: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (ele exige EF Core `[10.0.4, 11.0.0)`, então o EF Core resolveu para 10.0.14, com `Npgsql` 10.0.3), `Microsoft.EntityFrameworkCore.Design` 10.0.14 com a ferramenta `dotnet-ef` 10.0.12, PostgreSQL 18.6 num cluster local descartável.

## Use Cases

- Uma API SaaS em que toda tabela tem `TenantId` e toda requisição deve ver só as linhas do próprio tenant, mesmo quando alguém esquece um `Where`.
- Adicionar uma garantia no banco (row-level security) para SQL cru, ferramentas de relatório e caminhos de código que contornam os filtros do EF.
- Dar a clientes grandes ou regulados um banco próprio, resolvido por requisição, e fazer o onboarding de um novo com `Database.MigrateAsync()`.
- Escolher um modelo antes de o produto crescer: isolamento, vizinho barulhento, backup por tenant, custo de migration e número de conexões.

## Deep Dive

### Coluna discriminadora: o filtro precisa ler a instância do contexto

A lição de filtros mostrou como um filtro vira SQL e como funcionam os filtros nomeados; aqui o foco é tudo em volta dele. Os testes de tabela compartilhada usaram PostgreSQL com `A-100, A-200` para o tenant 1 e `B-100, B-200` para o tenant 2. O tenant vem de um serviço scoped que um middleware preenche a partir do usuário autenticado. O filtro o lê por um membro do contexto, então o EF o transforma em parâmetro:

```csharp
public class SharedDb(DbContextOptions options, ITenantProvider tenant) : DbContext(options)
{
    public int TenantId => tenant.TenantId;   // ITenantProvider registrado como Scoped
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Order>().HasQueryFilter("Tenant", o => o.TenantId == TenantId);
        b.Entity<OrderLine>().HasQueryFilter("Tenant", l => l.TenantId == TenantId);
    }
}
```

Criei dois escopos de DI no mesmo processo (tenant 1 e tenant 2), consultei os dois contextos e imprimi o `ToQueryString()` do primeiro (só o cabeçalho e a linha do `WHERE`):

```text
scope1 tenant1: A-100,A-200
scope2 tenant2: B-100,B-200
same model instance: True
-- @ef_filter__TenantId='1'
WHERE o."TenantId" = @ef_filter__TenantId
```

Um modelo, um texto de SQL, um valor de parâmetro diferente por instância de contexto. Esse é o truque inteiro, e é fácil de quebrar.

### Dois jeitos de congelar o tenant

Erro 1: copiar o tenant para uma variável local dentro de `OnModelCreating` (`var current = TenantId;`). O modelo é construído uma vez por tipo de contexto, então o lambda guarda o primeiro tenant. Erro 2: ler um valor ambiente (um campo static, ou um `AsyncLocal<int>`) no filtro. Rodei o tenant 1 e depois o tenant 2, cada um com seu contexto:

```text
tenant1 ctx: A-100,A-200
tenant2 ctx: A-100,A-200
WHERE o."TenantId" = 1
static Ambient.TenantId=1: A-100,A-200 | SELECT o."Sku" FROM "Orders" AS o WHERE o."TenantId" = 1
static Ambient.TenantId=2: A-100,A-200 | SELECT o."Sku" FROM "Orders" AS o WHERE o."TenantId" = 1
AsyncLocal Value=1: A-100,A-200
AsyncLocal Value=2: A-100,A-200
```

A terceira linha é o SQL do tenant 2 no erro 1. Os casos static e `AsyncLocal` me surpreenderam: eu esperava uma corrida entre requisições concorrentes, mas o EF 10.0.14 embutiu o valor como constante ao compilar a query e reutilizou a query compilada, então o tenant 2 recebeu as linhas do tenant 1 sem concorrência nenhuma. Só membros alcançados pelo contexto viraram parâmetros. Se o `ToQueryString()` não mostra `@ef_filter__...`, o filtro está errado.

### O que o filtro não cobre

Num contexto do tenant 1 sobre 4 pedidos, e depois num contexto que filtra `Order` mas não `OrderLine` (6 linhas, 2 do tenant 1):

```text
Orders.Count: 2
IgnoreQueryFilters().Count: 4
FromSql(SELECT * FROM Orders).Count: 2
ExecuteUpdate rows: 2
SqlQuery<int>(count(*)): 4
ExecuteSql UPDATE rows: 4
OrderLines.Count: 6
OrderLines.Include(Order).Count: 2
```

Caminhos LINQ (incluindo a composição sobre `FromSql` e o `ExecuteUpdate`) levam o filtro; `Database.SqlQuery` e `ExecuteSql` enxergam todos os tenants. Toda entidade de tenant precisa do próprio filtro, e o `Include` escondeu o que faltava: como a lição de filtros mostrou, uma navegação obrigatória para uma entidade filtrada vira um `INNER JOIN` com as linhas filtradas. Um teste que sempre inclui o pai não pega um filtro ausente no filho.

### Escritas: carimbar o TenantId e recusar outros tenants

Filtros só tocam queries. Sobrescrevi `SaveChanges` e `SaveChangesAsync` para preencher o `TenantId` no insert e recusar linhas de outro tenant:

```csharp
foreach (var e in ChangeTracker.Entries<ITenantOwned>())
{
    if (e.State == EntityState.Added && e.Entity.TenantId == 0) e.Entity.TenantId = TenantId;
    if (e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
        && (e.Entity.TenantId != TenantId || (e.State != EntityState.Added && e.Property(x => x.TenantId).OriginalValue != TenantId)))
        throw new InvalidOperationException($"{e.Metadata.ClrType.Name} belongs to tenant {e.Entity.TenantId}, current tenant is {TenantId}.");
}
```

Depois tentei o que um cliente pode mandar para qualquer endpoint de "update por id": o pedido `Id = 3` do tenant 2, enviado pelo tenant 1 com `TenantId = 1` e anexado com `Update`:

```text
added without TenantId -> TenantId=1
InvalidOperationException: Order belongs to tenant 2, current tenant is 1.
Update(Id=3, TenantId=1) rows: 1
tenant 2 now sees: B-200
tenant 1 now sees: A-100,A-200,A-300,stolen
```

A guarda passou porque a entidade dizia ser do tenant certo, e o `UPDATE ... WHERE "Id" = @p` moveu a linha do tenant 2 para o tenant 1. Carregue a entidade pelo `DbSet` filtrado antes de alterá-la, ou deixe o banco recusar (a seguir).

### Índices únicos precisam incluir o TenantId

Com `HasIndex(o => o.Sku).IsUnique()`, o tenant 2 não conseguiu criar um SKU que o tenant 1 já tinha: `DbUpdateException` com `PostgresException: 23505: duplicate key value violates unique constraint "IX_Orders_Sku"` como inner exception. Além do falso conflito, o erro conta ao tenant 2 que o valor existe em algum lugar (o Npgsql ocultou a chave no `DETAIL` por padrão). Com `HasIndex(o => new { o.TenantId, o.Sku }).IsUnique()`, o `A-100` do tenant 2 foi salvo e só um segundo `A-100` no mesmo tenant falhou, em `IX_Orders_TenantId_Sku`.

### Row-level security como rede de segurança

O PostgreSQL pode impor a mesma regra abaixo do EF. Criei a tabela como `postgres`, dei a um papel de login separado apenas permissões de DML e adicionei uma policy sobre uma configuração de sessão:

```sql
CREATE ROLE app_user LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Orders", "OrderLines" TO app_user;
ALTER TABLE "Orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Orders"
    USING ("TenantId" = NULLIF(current_setting('app.tenant', true), '')::int)
    WITH CHECK ("TenantId" = NULLIF(current_setting('app.tenant', true), '')::int);
```

Um `DbConnectionInterceptor` sobrescreve `ConnectionOpened` e `ConnectionOpenedAsync` e roda `SELECT set_config('app.tenant', '<id>', false)` na conexão recém-aberta (o id é um int vindo do provedor de tenant, nunca texto do usuário). Conectado como `app_user` para o tenant 1, repeti os contornos, o update da linha roubada e um `INSERT` cru com `TenantId = 2`:

```text
IgnoreQueryFilters().Count: 2
SqlQuery count(*): 2
ExecuteSql UPDATE all rows: 2
DbUpdateConcurrencyException: The database operation was expected to affect 1 row(s), but actually affected 0 row(s); data may have been modified or deleted since entities were loaded. ...
PostgresException: 42501: new row violates row-level security policy for table "Orders"
```

### Armadilhas de RLS em que caí

Minha primeira policy não tinha `NULLIF`. Rodando sem o interceptor:

```text
no interceptor, reused pooled connection: PostgresException: 22P02: invalid input syntax for type integer: ""
no interceptor, brand-new connection (Pooling=false): IgnoreQueryFilters().Count = 0
NULLIF policy, no interceptor, reused pooled connection: IgnoreQueryFilters().Count = 0
pid 23145 set to 1
pid 23145 next open: app.tenant = ''
[No Reset On Close] pid 23232 set to 1
[No Reset On Close] pid 23232 next open: app.tenant = '1'
```

O Npgsql reseta o estado da sessão quando a conexão volta ao pool, mas uma configuração customizada que já foi definida uma vez volta como string vazia, não NULL, e o cast falhou. Com `No Reset On Close=true`, o valor do tenant anterior sobreviveu na conexão reutilizada, exatamente o vazamento que a RLS deveria impedir. Definir o valor a cada abertura evita depender de qualquer um dos dois. Depois, os papéis (cada um define `app.tenant` como 1 e conta):

```text
postgres (superuser, owner): 4
app_owner (owner, not superuser): 4
app_user: 2
after FORCE ROW LEVEL SECURITY: app_owner 2, postgres 4
```

A documentação do PostgreSQL diz que superusuários e papéis com `BYPASSRLS` sempre ignoram a row security e que donos de tabela normalmente também; `FORCE ROW LEVEL SECURITY` vale para o dono, não para o superusuário, como eu vi. Rode as migrations como dono e a aplicação com outro papel.

### Banco por tenant: a connection string por contexto

O exemplo da documentação resolve a connection string em `OnConfiguring` a partir do serviço scoped de tenant. Fiz o mesmo com um arquivo SQLite por tenant, `if (!b.IsConfigured) b.UseSqlite(catalog.For(tenant.TenantId));`, depois fiz o onboarding de dois tenants, troquei de tenant dentro de um escopo e testei os dois tempos de vida da factory:

```text
tenant 1: file exists before=False, pending=20261028164656_Init
tenant 1: applied=20261028164656_Init, conn=tenant1.db
tenant 2: applied=20261028164656_Init, conn=tenant2.db
tenant 2: same model as tenant 1: True
Scoped: before switch customer-of-1; after switch customer-of-1 (same instance: True)
Transient: before switch customer-of-1; after switch customer-of-2 (same instance: False)
Singleton factory: InvalidOperationException: Cannot resolve scoped service 'ITenantProvider' from root provider.
Scoped factory: customer-of-2
```

Só a connection string muda, então todos os tenants compartilham um modelo em cache, o que está certo. `MigrateAsync()` num arquivo inexistente o criou e aplicou a migration: isso é o onboarding. Um contexto scoped mantém o tenant durante o escopo inteiro, então trocar de tenant no meio do escopo exige `Transient`, como diz a tabela da documentação. `AddDbContextFactory` registra a factory como singleton por padrão, e ela não consegue usar o serviço scoped de tenant (com `ValidateScopes` ligado); `ServiceLifetime.Scoped` resolveu.

### Um contexto em pool guarda a última connection string

A documentação diz que o `OnConfiguring` de um contexto em pool roda uma vez por instância, então usei `AddPooledDbContextFactory` com `UseSqlite()` sem connection string e chamei `db.Database.SetConnectionString(...)` depois de `CreateDbContextAsync()`. O segundo aluguel pulou essa chamada (caminho encurtado):

```text
rent 1: customer-of-1
rent 2 without SetConnectionString: conn='Data Source=.../tenants/tenant1.db'
rent 2 query: customer-of-1
```

O pool não resetou a connection string, então um aluguel que esquece de defini-la lê o banco do tenant anterior. Encapsule a factory para que definir o tenant não seja opcional.

### Schema por tenant: o modelo velho

`HasDefaultSchema($"tenant_{id}")` em `OnModelCreating` compila, mas o modelo fica em cache por tipo de contexto:

```text
--- HasDefaultSchema per tenant, custom IModelCacheKeyFactory: False
tenant 1: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
tenant 2: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
--- HasDefaultSchema per tenant, custom IModelCacheKeyFactory: True
tenant 1: customer-of-1 | SELECT c."Id", c."Name" FROM tenant_1."Customers" AS c
tenant 2: customer-of-2 | SELECT c."Id", c."Name" FROM tenant_2."Customers" AS c
```

Nenhum erro, só o tenant 2 lendo o tenant 1. A correção é uma chave com tudo o que muda o modelo: `Create(DbContext context, bool designTime)` devolve `(context.GetType(), s.Schema, designTime)` para o `SchemaDb`, registrado com `ReplaceService<IModelCacheKeyFactory, SchemaCacheKeyFactory>()`. Vale o mesmo para qualquer diferença de modelo por tenant (uma coluna extra, outro nome de tabela); uma connection string diferente sozinha nunca precisa disso.

### Schema por tenant e migrations

O `dotnet ef migrations add` (factory de design-time com o tenant 1) escreveu `EnsureSchema(name: "tenant_1")` e `schema: "tenant_1"` na migration e `HasDefaultSchema("tenant_1")` no snapshot. Aplicando por tenant, com a chave de cache corrigida, e depois listando as tabelas:

```text
tenant 1: migrated
tenant 2: InvalidOperationException: An error was generated for warning 'Microsoft.EntityFrameworkCore.Migrations.PendingModelChangesWarning': The model for context 'SchemaDb' has pending changes. Add a new migration before updating the database. ...
tenant 2, warning ignored: pending before = []
tenant 2, warning ignored: MigrateAsync returned
public.__EFMigrationsHistory, tenant_1.Customers
```

A tabela de histórico fica em `public` e é compartilhada, então depois do tenant 1 a migration contou como aplicada para todos; ignorar o aviso não criou nada para o tenant 2. Schema por tenant exige um executor próprio (uma tabela de histórico por schema via `MigrationsHistoryTable`, migrations neutras quanto ao schema): esse é o "not supported" da documentação.

### Onboarding e o problema de "migrar 500 tenants"

Migrei 20 arquivos SQLite novos num loop e rodei de novo sem nada pendente:

```text
run 1 (fresh files): 20 databases in 57 ms
run 2 (already migrated): 20 databases in 25 ms
```

Cerca de 3 ms por banco local minúsculo. O resto é raciocínio, não medição: num servidor real cada tenant custa uma conexão, uma leitura do histórico e o DDL, uma migration longa se multiplica pelo número de tenants, e uma falha no tenant 237 deixa a frota em duas versões de schema. Rode isso como um job de deploy com paralelismo limitado e log de resultado por tenant, e publique código que funcione com as duas versões durante o rollout.

### Blazor Server e a comparação

Não rodei aqui: a documentação de Blazor com EF Core diz que serviços scoped vivem enquanto durar o circuito do usuário, então um `DbContext` scoped é compartilhado por todos os componentes daquele usuário, e `DbContext` não é thread-safe; ela recomenda uma factory e um contexto por operação, e a documentação de multi-tenancy acrescenta que a factory deve ser `Scoped` quando a connection string depende do usuário.

| | Discriminador + filtro (+ RLS) | Schema por tenant | Banco por tenant |
|:--|:--|:--|:--|
| Isolamento | Lógico; um filtro esquecido ou query crua vaza (RLS fecha quase tudo) | Namespace | Físico |
| Vizinho barulhento | Compartilha tudo | Compartilha o servidor | Banco próprio, servidor pode ser compartilhado |
| Backup/restore por tenant | Difícil (linhas em tabelas compartilhadas) | Dump por schema | Nativo |
| Custo de migration | Uma vez | Por schema, ferramenta própria | Por banco, N execuções |
| Pools de conexão | Um | Um | Um por connection string |
| Suporte do EF Core (docs) | Filtro global de query | Não suportado, não recomendado | Configuração |

Para a linha de pools, abri e fechei 5 conexões em cada um de 3 bancos de tenant: `t1=5, t2=5, t3=5` conexões ociosas ficaram abertas no servidor, 15 onde um banco compartilhado manteria 5. A documentação chama seus exemplos de "working practices", não de boas práticas, e não ordena a primeira e a última opção.

## Trade-offs

- **O filtro é tão seguro quanto o jeito de ler o tenant.** Por um membro do contexto, é parâmetro; um valor local ou static congelou no primeiro uso. Um teste pode verificar que o `ToQueryString()` contém `@ef_filter__TenantId`.
- **Filtros não protegem escritas.** Uma entidade anexada é atualizada pela chave, seja qual for o tenant. Carregue antes de alterar, proteja o `SaveChanges` ou deixe a RLS recusar.
- **RLS acrescenta uma garantia e um custo de configuração.** Precisa de um papel que não seja dono nem superusuário, de definir a configuração a cada abertura de conexão e de uma policy que tolere a configuração vazia.
- **Banco por tenant multiplica a operação.** Pools, migrations, monitoramento e backups são por tenant (a lição de pooling do ADO.NET explica por que cada connection string tem seu pool), e com pooling de contexto o `SetConnectionString` sobreviveu à volta ao pool, então defina o tenant numa factory encapsulada toda vez.
- **Schema por tenant é o caminho menos suportado.** Chave de cache do modelo, migrations e tabela de histórico ficam todas por sua conta.

## Documentation Links

- [Multi-tenancy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy) (doc)
- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
- [Alternating between multiple models with the same DbContext type, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/dynamic-model) (doc)
- [ASP.NET Core Blazor with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core?view=aspnetcore-10.0) (doc)
- [Row Security Policies, PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) (doc)
