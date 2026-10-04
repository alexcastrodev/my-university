---
version: 1.0
updatedAt: 2026-10-04
title: "Workflow de Migrations do EF Core"
summary: Model snapshot, revisão do SQL gerado (rename que vira drop + add), migrationBuilder.Sql, conflito de snapshot entre branches e checagem do modelo no CI.
---
## Objective

Uma migration é um arquivo C# que leva o schema do banco de uma versão para a
seguinte, gerado comparando o seu modelo com um snapshot do anterior. A
ferramenta é fácil de rodar e fácil de confiar demais. O EF Core gera o que
consegue inferir da diferença entre os modelos, e o que ele infere às vezes é
destrutivo: um rename parece um drop seguido de um add. Um workflow confiável
trata a migration gerada como código a revisar, mantém o snapshot consistente
entre branches e deixa o CI provar que o modelo e as migrations concordam.

## Use Cases

- Adicionar uma coluna e obter uma migration cujo `Up` e `Down` dá para ler num
  pull request.
- Renomear uma propriedade sem perder os dados da coluna.
- Preencher uma nova coluna `NOT NULL` para as linhas existentes na mesma
  mudança.
- Duas pessoas adicionando migrations em duas branches e fazendo o merge sem um
  snapshot quebrado.
- Quebrar o build quando alguém altera uma entidade e esquece de adicionar uma
  migration.

## Deep Dive

### O que `migrations add` produz

```bash
dotnet ef migrations add AddOrderPriority --project Orders.Core --startup-project Host
```

Três arquivos aparecem. A classe da migration tem `Up` e `Down`. Um arquivo
`Designer` guarda metadados. `OrdersDbContextModelSnapshot.cs` é uma descrição
completa do modelo no ponto desta migration. O próximo `migrations add` compara
o seu modelo atual com esse snapshot, e não com o banco real, e é por isso que o
snapshot precisa ser commitado e sempre corresponder à última migration.

```csharp
public partial class AddOrderPriority : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<int>(
            name: "priority", schema: "orders", table: "orders",
            type: "integer", nullable: false, defaultValue: 0);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "priority", schema: "orders", table: "orders");
}
```

A ferramenta precisa de um jeito de construir o seu contexto sem executar a
aplicação. Se o host da aplicação não bastar, entregue a ela uma
`IDesignTimeDbContextFactory<T>`.

### Revise o SQL gerado

Leia a migration, e leia o SQL que ela vai executar, antes do merge:

```bash
dotnet ef migrations script PreviousMigration AddOrderPriority --idempotent
```

A coisa mais importante a procurar é um rename. O EF Core compara o modelo
antigo e o novo e não tem como saber que `Total` virou `GrandTotal`, então emite
um drop e um add, e os dados da coluna se perdem:

```csharp
// Gerado: perde os dados.
migrationBuilder.DropColumn(name: "total", schema: "orders", table: "orders");
migrationBuilder.AddColumn<decimal>(name: "grand_total", schema: "orders", table: "orders", ...);

// O que você queria: edite a migration à mão.
migrationBuilder.RenameColumn(name: "total", schema: "orders", table: "orders", newName: "grand_total");
```

### Mudanças de dados pertencem à migration

Quando uma mudança de schema exige que as linhas existentes também mudem,
coloque o SQL na mesma migration para que schema e dados andem juntos. Para uma
nova coluna obrigatória, adicione-a como anulável, preencha e só então torne-a
obrigatória:

```csharp
migrationBuilder.AddColumn<string>("status_text", "orders", "orders", nullable: true);
migrationBuilder.Sql("UPDATE orders.orders SET status_text = CASE status WHEN 0 THEN 'Placed' ELSE 'Closed' END");
migrationBuilder.AlterColumn<string>("status_text", "orders", "orders", nullable: false, oldNullable: true);
```

Prefira `UseSeeding` e `UseAsyncSeeding` (EF Core 9 em diante) para dados de seed
em vez de `HasData`, porque o `HasData` embute as linhas em todos os snapshots
futuros.

### Branches e o snapshot

Duas branches que adicionam uma migration cada uma editam o model snapshot, então
o Git mostra um conflito num arquivo gerado, e resolver à mão dá um snapshot que
não corresponde mais a nenhuma das migrations. A correção confiável é tratar o
snapshot como saída derivada:

```bash
git merge main                         # conflito no snapshot e na ordem das migrations
dotnet ef migrations remove            # descarta a SUA migration, restaurando o snapshot ao da main
git checkout main -- <snapshot file>   # ou resolva para a versão da main
dotnet ef migrations add AddOrderPriority   # regenera por cima do que há de mais recente na main
```

### Deixe o CI checar o modelo

`dotnet ef migrations has-pending-model-changes` sai com erro quando o modelo
difere do snapshot, então uma migration esquecida quebra o pipeline. Desde o EF
Core 9, `Migrate()` também lança exceção se houver mudanças de modelo pendentes,
o que pega o mesmo erro na inicialização num ambiente de teste.

## Trade-offs

- **Gerado automaticamente não significa correto.** Renames, mudanças de tipo de
  coluna que precisam de conversão e a divisão de uma tabela exigem uma migration
  editada à mão. Revisar só o C# não basta numa mudança de tipo, então leia o
  SQL.
- **O `Down` raramente é exercitado.** Um `Down` que apaga uma coluna não traz os
  dados de volta, então em produção uma migration corretiva para frente costuma
  ser mais segura do que reverter.
- **Editar uma migration já aplicada quebra os outros ambientes.** Depois que uma
  migration rodou em qualquer lugar compartilhado, alterá-la no lugar deixa
  bancos em estados diferentes com o mesmo id de migration. Adicione uma nova
  migration em vez disso.
- **O snapshot é um ponto único de conflito.** Muita gente adicionando
  migrations numa janela curta significa regenerar com frequência. Merges
  pequenos e frequentes reduzem isso.
- **`HasData` é conveniente e pesado.** Ele guarda toda linha de seed no
  snapshot, então mudar uma linha gera um diff, e seeds grandes deixam a
  ferramenta lenta. Use-o só para dados de referência pequenos que realmente
  nunca mudam.

## Documentation Links

- [Migrations overview, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) (doc)
- [Customizing migration code, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing) (doc)
- [Working with multiple providers and design-time context creation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dbcontext-creation) (doc)
- [EF Core tools reference (.NET CLI), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
