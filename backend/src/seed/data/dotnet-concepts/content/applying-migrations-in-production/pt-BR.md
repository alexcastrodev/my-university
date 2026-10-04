---
version: 1.0
updatedAt: 2026-10-04
title: "Aplicando Migrations em Produção"
summary: Riscos do Migrate() no startup com várias réplicas, scripts idempotentes, migration bundles, expand/contract e índices concorrentes no PostgreSQL.
---
## Objective

Gerar uma migration é a metade fácil. Aplicá-la num banco de produção que atende
tráfego, a partir de mais de uma instância da aplicação, com código antigo e
novo vivos ao mesmo tempo durante um rollout, é onde mudanças de schema causam
indisponibilidade. O hábito de chamar `Migrate()` quando a aplicação inicia
funciona no notebook e vira risco assim que há várias réplicas, um deploy
gradual ou uma mudança que segura um lock por muito tempo. Este conceito cobre
as formas mais seguras de aplicar migrations (scripts idempotentes e bundles), o
padrão expand/contract que mantém cada deploy compatível com o anterior e o
detalhe do PostgreSQL que torna a criação de índices não bloqueante.

## Use Cases

- Fazer deploy de uma nova versão em várias réplicas sem que cada uma tente
  rodar a mesma migration na inicialização.
- Deixar um DBA ou um pipeline revisar e aplicar o SQL, enquanto o próprio
  usuário de banco da aplicação não tem permissão para alterar o schema.
- Renomear ou dividir uma coluna enquanto a versão anterior da aplicação ainda
  atende requisições.
- Adicionar um índice numa tabela grande e movimentada sem bloquear escritas.
- Aplicar uma migration em bancos que estão em versões diferentes, como vários
  tenants, sem saber qual está atrasado.

## Deep Dive

### Por que `Migrate()` no startup é arriscado

```csharp
// Conveniente em desenvolvimento, arriscado em produção.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
    await db.Database.MigrateAsync();
}
```

Com uma instância, tudo bem. Com várias, todas iniciam ao mesmo tempo e tentam
aplicar a mesma migration pendente. Desde o EF Core 9, o
`Migrate` toma um lock em todo o banco (o funcionamento depende do provider),
então as instâncias entram numa fila em vez de se corromperem, mas três
problemas continuam:

- Um deploy gradual roda o código antigo contra o schema novo enquanto a primeira
  instância migra, então uma mudança destrutiva quebra as instâncias que ainda
  não foram substituídas.
- O usuário de banco da aplicação precisa de permissão de DDL (`CREATE`,
  `ALTER`, `DROP`) durante toda a sua vida, só para rodar algo que acontece uma
  vez por release.
- Uma migration que leva minutos segura a inicialização de todas as instâncias,
  então os health checks estouram o tempo e o orquestrador as reinicia no meio
  do processo.

Desde o EF Core 9, o `Migrate()` também lança exceção quando o modelo tem
mudanças pendentes sem migration, então um `migrations add` esquecido falha na
inicialização em vez de deixar o schema desatualizado. Envolver o `Migrate` numa
transação ou execution strategy sua também lança exceção, porque uma transação
externa impede que o lock seja adquirido.

### Scripts idempotentes

Gere o SQL e deixe um pipeline ou uma pessoa aplicá-lo com uma conta de deploy.
`--idempotent` faz o script consultar a tabela de histórico de migrations, então
ele pode rodar contra um banco em qualquer versão e aplica só o que falta (o
suporte depende do provider, e o SQLite não gera scripts idempotentes):

```bash
dotnet ef migrations script --idempotent --output migrate.sql \
  --project Orders.Core --startup-project Host
```

O script gerado é SQL puro, então pode ser revisado e comparado num pull
request, que também é o lugar mais fácil para pegar um comando destrutivo.

### Migration bundles

Um bundle é um executável autocontido que carrega as migrations e as aplica,
sem SDK do .NET nem arquivos de projeto na máquina que o executa:

```bash
dotnet ef migrations bundle --self-contained -r linux-x64 --output efbundle

./efbundle --connection "Host=db;Database=orders;Username=deployer;Password=..."
```

Construa-o uma vez no pipeline, rode-o como um passo antes de liberar a nova
versão da aplicação e mantenha as credenciais de deploy fora da própria
aplicação.

### Expand and contract

Como código antigo e novo se sobrepõem durante um rollout, divida uma mudança
incompatível em passos em que cada versão implantada funciona com o schema dos
dois lados de cada passo. Para trocar uma coluna `FullName` por `FirstName` e
`LastName`:

```csharp
// Release 1, expand: adicione as novas colunas como nullable. O código antigo as ignora.
migrationBuilder.AddColumn<string>("first_name", "customers", "customers", nullable: true);
migrationBuilder.AddColumn<string>("last_name",  "customers", "customers", nullable: true);

// Release 2: a aplicação grava as colunas antigas e as novas.
// Preencha as linhas existentes em lotes, fora da migration de schema se a tabela for grande.
migrationBuilder.Sql("UPDATE customers.customers SET first_name = split_part(full_name, ' ', 1) WHERE first_name IS NULL");

// Release 3: a aplicação lê só as novas colunas. Torne-as obrigatórias.
migrationBuilder.AlterColumn<string>("first_name", "customers", "customers", nullable: false, oldNullable: true);

// Release 4, contract: nada mais lê full_name, então remova-a.
migrationBuilder.DropColumn("full_name", "customers", "customers");
```

Cada passo é sua própria migration entregue em sua própria release, e toda
release pode voltar para a versão anterior da aplicação sem mudança de schema.

### Índices não bloqueantes no PostgreSQL

Um `CREATE INDEX` comum bloqueia escritas na tabela até terminar. O
`CREATE INDEX CONCURRENTLY` não bloqueia, mas o PostgreSQL se recusa a rodá-lo
dentro de uma transação, e o EF Core envolve cada migration em uma (o EF Core 9
usava uma única transação para todas as migrations pendentes, e o EF Core 10
voltou a uma por migration). Diga ao EF Core para rodar esse comando fora de uma
transação:

```csharp
protected override void Up(MigrationBuilder migrationBuilder) =>
    migrationBuilder.Sql(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_orders_customer_id ON orders.orders (customer_id)",
        suppressTransaction: true);
```

Mantenha essa migration só com o índice. Sem transação, uma falha no meio não
consegue desfazer mais nada da mesma migration, e uma construção concorrente que
falha deixa um índice inválido que você precisa remover antes de tentar de novo.
O provider Npgsql também faz isso pelo modelo: `HasIndex(...).IsCreatedConcurrently()`
o faz criar o índice de forma concorrente, e a documentação dele manda ler antes
as implicações no PostgreSQL.

## Trade-offs

- **Migration no startup é a opção mais simples e a menos controlada.** Para uma
  instância, um ambiente de staging ou uma ferramenta interna pequena, ela remove
  um passo de deploy. O custo cresce com o número de réplicas e o tamanho dos
  dados.
- **Scripts idempotentes e bundles acrescentam um passo ao pipeline.** Eles
  exigem credenciais com permissão de schema e uma garantia de ordem de que a
  migration termina antes de a nova versão da aplicação começar a receber
  tráfego.
- **Expand and contract multiplica releases.** Uma mudança que era uma migration
  vira quatro deploys ao longo de dias, com código que escreve em dois lugares no
  meio. Esse é o preço de zero downtime, e para uma tabela pequena com janela de
  manutenção uma única migration pode ser a melhor troca.
  ```csharp
  // Durante a sobreposição, toda escrita mantém as duas representações consistentes.
  customer.FullName = $"{first} {last}";
  customer.FirstName = first;
  customer.LastName = last;
  ```
- **Backfills dentro de uma migration seguram uma transação.** Um `UPDATE` sobre
  milhões de linhas dentro da migration mantém locks e incha a tabela. Rode
  backfills grandes como um job separado em lotes, e deixe a migration mudar só a
  estrutura.
- **Construções concorrentes de índice são mais lentas e podem falhar.** Elas
  varrem a tabela duas vezes e esperam as transações em andamento, e uma falha
  deixa um índice inválido.
  ```sql
  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid; -- ache os restos, depois DROP INDEX
  ```

## Documentation Links

- [Applying migrations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying) (doc)
- [Migrations overview, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) (doc)
- [EF Core tools reference (.NET CLI), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Breaking changes in EF Core 9, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes) (doc)
- [Indexes, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/indexes.html) (doc)
