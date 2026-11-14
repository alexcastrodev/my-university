---
version: 1.3
updatedAt: 2026-11-14
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
futuros. Implemente sempre também o `UseSeeding`: as ferramentas do EF e os
migration bundles chamam o delegate síncrono mesmo quando a sua aplicação usa o
assíncrono.

### Branches e o snapshot

Duas branches que adicionam uma migration cada uma editam o model snapshot, e
uma migration também carrega o modelo como ele era naquele ponto. Se as duas
forem mescladas, o snapshot da migration posterior não inclui as mudanças da
outra branch, o que pode corromper migrations futuras. O EF Core 10 e anteriores
não registram a última migration no snapshot, então o controle de versão pode
mesclá-lo sem nenhum conflito, mesmo com as árvores de migrations divergentes. O EF Core 11 fecha essa brecha: o
snapshot gerado pelo `dotnet ef migrations add` 11.0.0 agora começa com um comentário gerado sobre conflitos de merge e a linha
`public override string LastMigrationId => "20261112000107_Initial";`, então duas
branches que adicionam migration mudam a mesma linha e o merge para com um conflito
de texto. Esse conflito é o aviso que você quer, não algo para resolver escolhendo um
lado. A correção documentada é recriar a sua migration por cima da do colega:

```bash
# Antes de mesclar, enquanto a sua branch ainda está coerente:
dotnet ef migrations remove            # remove só a SUA migration, mantém a mudança de modelo
git merge main                         # traz a migration e o snapshot da outra branch
dotnet ef migrations add AddOrderPriority   # readiciona por cima do snapshot mesclado
```

Se o merge já aconteceu, não rode `migrations remove`: ele restaura o modelo a
partir dos metadados da migration anterior, que podem não ter as mudanças da
outra branch. Volte a um estado coerente anterior ao merge pelo controle de
versão e siga os passos acima.

### Deixe o CI checar o modelo

`dotnet ef migrations has-pending-model-changes` (EF Core 8 em diante) verifica
se o modelo tem mudanças que nenhuma migration captura ainda, então um passo de
CI consegue pegar uma migration esquecida. `context.Database.HasPendingModelChanges()`
faz a mesma checagem por código, por exemplo num teste unitário. Desde o EF
Core 9, `Migrate()` também lança exceção se houver mudanças de modelo pendentes,
o que pega o mesmo erro na inicialização num ambiente de teste.

### Padrões e saída no EF Core 11

O EF Core 11 adiciona o arquivo `.config/dotnet-ef.json` para você parar de
repetir `--project`, `--startup-project` e `--context` em todo comando. O
`dotnet ef` sobe a partir do diretório atual e usa o primeiro que encontrar, e
caminhos relativos são resolvidos a partir do pai de `.config`. Coloquei o
arquivo na raiz do repositório:

```json
{ "project": "src/App", "context": "Ctx" }
```

Rodar `dotnet ef dbcontext info` da raiz e de dentro de `src/` encontrou o
projeto e o contexto sem nenhuma opção. Opções explícitas na linha de comando
continuam valendo mais, segundo a [referência das ferramentas do EF Core](https://learn.microsoft.com/en-us/ef/core/cli/dotnet#configuration-file),
que também lista `startupProject`, `framework`, `configuration`, `runtime`,
`verbose`, `noColor` e `prefixOutput`.

Dois detalhes que importam em scripts. `migrations add` e `migrations remove`
não escrevem nada no stdout: `Build started...`, `Done.` e as mensagens de
remoção vão para o stderr, então capture o stderr se quiser registrá-las.
`dbcontext info` e `dbcontext script` escrevem o resultado no stdout e deixam as
mensagens de build no stderr. E `dotnet ef migrations remove --offline` (novo no
EF Core 11, não combina com `--force`) removeu a última migration sem conectar ao
banco. Ele apaga os arquivos e reescreve o snapshot, então só faz sentido quando
a migration nunca foi aplicada.

Para ver o que mais a ferramenta 11.0.0 acrescenta, instalei o `dotnet-ef` 10.0.12 e
o 11.0.0 lado a lado e comparei as opções do `--help` de cada comando. Só no 11.0.0:

- `database update <nome> --add` (com `--output-dir`, `--namespace` e `--json`) cria
  uma migration e a aplica em um passo só. O help diz "Create a new migration with
  the given name and apply it immediately", e a documentação diz que ela compila a
  migration com o Roslyn em tempo de execução, para lugares como containers onde o
  projeto não pode ser recompilado, e ainda grava os arquivos para o controle de
  versão. Li as opções e não executei.
- `--connection` em `migrations remove` e em `database drop`, que assim não precisam
  de uma connection string no contexto.
- `--file` e `--startup-file` em todos os comandos, como equivalentes para apps
  file-based de `--project` e `--startup-project`.

Uma coisa que a documentação lista como novidade do 11 já existia: `-c "*"`, que roda
`migrations list`, `migrations script`, `database update` ou `database drop` para
todos os contextos, está no `--help` do 10.0.12, então você não precisa atualizar a
ferramenta por causa dele. A chave `-NoBuild` do Package Manager Console para
`Add-Migration` e `Update-Database` é só documentação, porque aqui não há PMC. A CLI
`dotnet ef` já tinha `--no-build` nas duas versões.

Uma opção de modelo relacionada: `HasOne(...).HasForeignKey(...).IsConstrained(false)`
mantém o relacionamento no modelo mas deixa a constraint de chave estrangeira
fora do esquema. No SQLite, o script gerado para um relacionamento `Item.ParentId`
tinha a coluna e o `CREATE INDEX "IX_Items_ParentId"`, mas nenhum `FOREIGN KEY`.
`ExcludeForeignKeyFromMigrations()` gera o mesmo script, e as duas não são
equivalentes para consultas, o que `join-pruning-and-foreign-keys-without-constraints`
mostra com linhas reais.

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
- [Design-time DbContext Creation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dbcontext-creation) (doc)
- [EF Core tools reference (.NET CLI), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
