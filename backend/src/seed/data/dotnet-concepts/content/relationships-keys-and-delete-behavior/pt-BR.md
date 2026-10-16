---
version: 1.0
updatedAt: 2026-10-15
title: "Relacionamentos, Chaves e Comportamento de Delete"
summary: Obrigatório versus opcional e o ON DELETE que cada um gera, o que o SaveChanges faz com dependentes carregados ou não (conferido no SQL do SQLite), órfãos, chaves compostas e alternativas, FKs sombra e many-to-many com navegações de salto.
---
## Objective

Um relacionamento no EF Core é uma foreign key mais, opcionalmente, navegações
de um lado ou dos dois. Se essa foreign key aceita nulo, o relacionamento é
opcional; se não aceita, é obrigatório. Essa única escolha define a cláusula
`ON DELETE` no schema, o que o `SaveChanges` faz quando o pai some e se tirar um
filho de uma coleção apaga esse filho. Aqui o modelo é montado no SQLite com EF
Core 10, o DDL é impresso e cada cenário de delete roda com o log de SQL ligado,
então cada afirmação vem com o comando que a produziu. Também entram chaves
compostas e alternativas, foreign keys sombra e many-to-many com navegações de
salto.

## Use Cases

- Decidir se `Product.SupplierId` deve ser `int` ou `int?`, sabendo o que cada
  opção faz na hora do delete.
- Explicar um `FOREIGN KEY constraint failed` que só aparece em produção, onde
  os filhos não estavam carregados.
- Mapear uma tabela legada cuja chave tem duas colunas, ou cujos filhos apontam
  para o email e não para o id.
- Colocar uma data de "marcado em" num many-to-many sem perder a navegação de
  salto.
- Manter propriedades de foreign key fora de uma classe de domínio.

## Deep Dive

### O modelo do experimento

```csharp
public class Product
{
    public int Id { get; set; }
    public int CategoryId { get; set; }            // int: obrigatório
    public Category Category { get; set; } = null!;
    public int? SupplierId { get; set; }           // int?: opcional
    public Supplier? Supplier { get; set; }
    public List<Tag> Tags { get; } = [];           // navegação de salto
}
public class Review { public int Id { get; set; } public Product Product { get; set; } = null!; } // sem propriedade de FK

[PrimaryKey(nameof(OrderId), nameof(LineNo))]
public class OrderLine { public int OrderId { get; set; } public int LineNo { get; set; } }

// OnModelCreating
b.Entity<Product>().HasMany(p => p.Tags).WithMany(t => t.Products)
    .UsingEntity<ProductTag>(j => j.Property(e => e.AddedOn).HasDefaultValueSql("CURRENT_TIMESTAMP"));
b.Entity<Order>().HasOne(o => o.Customer).WithMany(c => c.Orders)
    .HasForeignKey(o => o.CustomerEmail).HasPrincipalKey(c => c.Email);
```

`Database.GenerateCreateScript()` mostra o que o EF Core vai criar (resumido):

```sql
CREATE TABLE "Products" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Products" PRIMARY KEY AUTOINCREMENT,
    "CategoryId" INTEGER NOT NULL,
    "SupplierId" INTEGER NULL,
    CONSTRAINT "FK_Products_Categories_CategoryId" FOREIGN KEY ("CategoryId") REFERENCES "Categories" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Products_Suppliers_SupplierId" FOREIGN KEY ("SupplierId") REFERENCES "Suppliers" ("Id"));
CREATE TABLE "Reviews" ( ..., "ProductId" INTEGER NOT NULL,
    CONSTRAINT "FK_Reviews_Products_ProductId" FOREIGN KEY ("ProductId") REFERENCES "Products" ("Id") ON DELETE CASCADE);
CREATE TABLE "Customers" ( ..., "Email" TEXT NOT NULL, CONSTRAINT "AK_Customers_Email" UNIQUE ("Email"));
CREATE TABLE "OrderLine" ( "OrderId" INTEGER NOT NULL, "LineNo" INTEGER NOT NULL, ...,
    CONSTRAINT "PK_OrderLine" PRIMARY KEY ("OrderId", "LineNo"), ...);
CREATE TABLE "ProductTag" ( "ProductId" INTEGER NOT NULL, "TagId" INTEGER NOT NULL,
    "AddedOn" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    CONSTRAINT "PK_ProductTag" PRIMARY KEY ("ProductId", "TagId"), ... ON DELETE CASCADE);
CREATE INDEX "IX_Products_SupplierId" ON "Products" ("SupplierId");
```

Dá para ver quatro convenções. O relacionamento obrigatório ganhou
`ON DELETE CASCADE`; o opcional não ganhou `ON DELETE` nenhum, ou seja, vale o
padrão do banco, e a constraint continua sendo verificada. Toda foreign key
ganhou um índice. E `Review`, que só tem a navegação, ganhou uma coluna sombra
`ProductId` `NOT NULL`, porque a navegação é um tipo de referência não anulável.

### Obrigatório versus opcional, e os comportamentos de delete

O enum `DeleteBehavior` configura duas coisas de uma vez: o que o EF Core faz com
os dependentes rastreados e o `ON DELETE` que ele escreve no schema. O padrão é
`Cascade` para relacionamentos obrigatórios e `ClientSetNull` para opcionais. Só
`Cascade` e `SetNull` fazem o banco agir; `ClientSetNull`, `ClientCascade`,
`ClientNoAction` e `NoAction` deixam o padrão do banco, e `Restrict` escreve
`ON DELETE RESTRICT`. Os valores `Client*` existem para o trabalho acontecer no
EF Core, nas entidades que ele está rastreando.

Essa divisão é a origem da maioria das surpresas. Apagando o fornecedor sem
carregar os produtos:

```csharp
db.Remove(db.Suppliers.Single());
db.SaveChanges();
// DbUpdateException: SQLite Error 19: 'FOREIGN KEY constraint failed'.
```

O `ClientSetNull` só anula a foreign key dos produtos que estão no change
tracker, e não havia nenhum. O mesmo delete com `Include(s => s.Products)`
funciona, e o log mostra o EF Core fazendo o serviço:

```sql
UPDATE "Products" SET "SupplierId" = @p0 WHERE "Id" = @p1 RETURNING 1;
UPDATE "Products" SET "SupplierId" = @p0 WHERE "Id" = @p1 RETURNING 1;
DELETE FROM "Suppliers" WHERE "Id" = @p0 RETURNING 1;
```

Apagar a categoria sem carregar nada mandou um único comando,
`DELETE FROM "Categories" WHERE "Id" = @p0`, e depois as contagens deram
`products left: 0, reviews left: 0, join rows: 0`. O banco cascateou de
categorias para produtos, e daí para reviews e para a tabela de junção, sem que
o EF Core visse nada. Se a ideia é "anular mesmo sem carregar", configure
`OnDelete(DeleteBehavior.SetNull)` para o banco fazer isso.

### Órfãos

Um dependente obrigatório não existe sem um principal, então cortar o vínculo
apaga o dependente. Tirar um produto carregado de `category.Products` gerou:

```sql
DELETE FROM "Products" WHERE "Id" = @p0 RETURNING 1;
```

Ninguém chamou `Remove` no produto. Num relacionamento opcional, o mesmo código
põe a foreign key em nulo. Banco de dados não tem noção de órfão, então isso só
funciona com os dois lados carregados; a página oficial de cascade delete traz a
matriz completa, carregado versus não carregado.

### Chaves compostas e alternativas

As convenções nunca inventam chave composta para uma entidade comum; você
declara com `[PrimaryKey]` (EF Core 7 em diante) ou
`HasKey(x => new { x.OrderId, x.LineNo })`. Uma chave alternativa é um segundo
identificador único que pode ser alvo de foreign key. O
`HasPrincipalKey(c => c.Email)` criou uma por convenção, com o nome
`AK_Customers_Email`. No EF Core, chaves alternativas são somente leitura:

```csharp
customer.Email = "ana@new.example.com";
db.SaveChanges();
// InvalidOperationException: The property 'Customer.Email' is part of a key and so
// cannot be modified or marked as modified. ...
```

Se você só precisa de unicidade, use um índice único
(`HasIndex(...).IsUnique()`), que continua atualizável. Use chave alternativa
quando outra tabela realmente faz join por aquela coluna, o que é comum em
schema legado.

### Foreign keys sombra

`Review` não tem propriedade `ProductId`, mas a coluna existe e dá para
consultá-la:

```csharp
db.Reviews.Select(r => new { r.Text, ProductId = EF.Property<int>(r, "ProductId") }).Single();
// SELECT "r"."Text", "r"."ProductId" FROM "Reviews" AS "r" LIMIT 2
// { Text = great, ProductId = 1 }
```

Chave sombra deixa a classe de domínio limpa, o que combina com o conceito de
mapeamento DDD, mas o valor deixa de viajar junto com o objeto. A documentação
sugere uma propriedade de foreign key privada como meio-termo quando as entidades
são serializadas ou reanexadas.

### Many-to-many com navegações de salto

`Product.Tags` e `Tag.Products` pulam uma entidade de junção. Sem
`UsingEntity`, o EF Core cria uma entidade de junção de tipo compartilhado e uma
tabela com nome de convenção (`ProductTag`, com `ProductsId` e `TagsId`). A
documentação avisa para não depender do tipo CLR dela, hoje
`Dictionary<string, object>`. Declarar `UsingEntity<ProductTag>` mantém as
navegações de salto e dá uma classe onde um payload pode morar, aqui `AddedOn`
com default no banco. Lendo de volta:

```sql
SELECT "p"."ProductId", "p"."TagId", "p"."AddedOn" FROM "ProductTag" AS "p" LIMIT 2
-- join row 1/1 added 2026
```

A chave primária composta pelas duas foreign keys garante uma associação por
par, e as duas foreign keys cascateiam, então apagar qualquer lado remove a
associação.

## Trade-offs

- **`int?` é política de delete, não só tipo.** Tornar a foreign key anulável
  troca cascade por `ClientSetNull`, que falha se os filhos não estiverem
  carregados.
  ```csharp
  b.Entity<Product>().HasOne(p => p.Supplier).WithMany(s => s.Products)
      .OnDelete(DeleteBehavior.SetNull); // o banco anula, carregado ou não
  ```
- **Cascade não aparece no log.** Um `DELETE` removeu linhas de outras três
  tabelas. É eficiente, e também é como um desenho de soft delete acaba apagando
  de verdade; a documentação desaconselha cascade no banco com soft delete.
- **Caminhos de cascade dependem do provider.** O SQL Server rejeita schema com
  múltiplos caminhos de cascade até a mesma tabela; o SQLite aceitou este modelo.
  Troque um caminho para `ClientCascade` ou torne-o opcional, e teste no provider
  real.
- **Chave alternativa congela a coluna.** Fazer join por `Email` impede mudar o
  email pelo EF Core. Chave surrogate mais índice único é mais fácil de manter
  quando o schema é seu.
- **Chave sombra troca conveniência por pureza.** Classes limpas, mas strings
  em `EF.Property` nas consultas e nenhuma chave no objeto serializado.
- **Entidade de junção implícita é difícil de estender.** Acrescentar um payload
  depois exige classe, `UsingEntity<T>` e migration; comece com classe de junção
  explícita se a associação tende a ganhar dados.

## Documentation Links

- [Introduction to relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships) (doc)
- [Foreign and principal keys in relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/foreign-and-principal-keys) (doc)
- [Cascade delete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/cascade-delete) (doc)
- [Many-to-many relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/many-to-many) (doc)
- [Keys, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keys) (doc)
- [Shadow and indexer properties, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/shadow-properties) (doc)
- [Changing foreign keys and navigations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/relationship-changes) (doc)
