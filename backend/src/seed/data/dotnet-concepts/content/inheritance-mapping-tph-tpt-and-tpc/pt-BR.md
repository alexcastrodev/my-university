---
version: 1.0
updatedAt: 2026-10-16
title: "Mapeamento de Herança: TPH, TPT e TPC"
summary: As três estratégias de herança do EF Core 10 com o schema e o SQL reais no SQLite, o tipo derivado não declarado que perde dados em silêncio, discriminadores, colunas compartilhadas, chaves e foreign keys no TPC, e como escolher.
---
## Objective

Uma hierarquia C# (`Payment`, `CardPayment`, `PixPayment`) não tem forma natural
em um banco relacional. O EF Core oferece três jeitos de achatá-la: uma tabela
para a hierarquia inteira (TPH), uma tabela por tipo ligadas pela chave (TPT) ou
uma tabela autossuficiente por tipo concreto (TPC). Este conceito mostra o schema
e o SQL que cada estratégia gera de verdade no EF Core 10 com SQLite, o que dá
errado em silêncio quando um tipo derivado não é declarado, como chaves e foreign
keys se comportam e como escolher.

## Use Cases

- Um modelo de pagamentos, notificações ou documentos em que os subtipos
  compartilham quase todas as colunas e diferem em duas ou três.
- Um banco legado em que `Payments` já tem uma coluna `Kind` que precisa virar
  discriminador.
- Decidir se uma hierarquia consultada quase sempre pelos tipos folha deve ser
  TPH ou TPC.
- Revisar uma migration que adiciona um subtipo novo e entender o que ela fará
  nas tabelas de produção.

## Deep Dive

### Tipos derivados precisam ser declarados

Os exemplos usam este modelo:

```csharp
public class Payment { public int Id { get; set; } public decimal Amount { get; set; } }
public class CardPayment : Payment { public string Last4 { get; set; } = ""; }
public class PixPayment : Payment { public string Key { get; set; } = ""; }
```

O EF Core não procura subclasses sozinho. Se o modelo só contém `Payment`, uma
instância de `CardPayment` é aceita por `Add` e salva como um `Payment` comum:

```csharp
b.Entity<Payment>();                                   // CardPayment nunca declarado
db.Add(new CardPayment { Amount = 10, Last4 = "4242" });
db.SaveChanges();                                       // salvou, sem erro
// tabela "Payments": ("Id", "Amount")   <- Last4 não existe em lugar nenhum
```

Não há exceção e o `Last4` some. Declare os tipos derivados com um `DbSet` ou com
`b.Entity<CardPayment>()` e `b.Entity<PixPayment>()`. O resto do conceito assume
isso.

### TPH: uma tabela e um discriminador

TPH é o padrão. O schema para os três tipos:

```sql
CREATE TABLE "Payments" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Payments" PRIMARY KEY AUTOINCREMENT,
    "Amount" TEXT NOT NULL,
    "Discriminator" TEXT NOT NULL,
    "Last4" TEXT NULL,
    "Key" TEXT NULL
)
```

`Last4` e `Key` são `string` não anulável no C#, mas as colunas são anuláveis: uma
linha de `PixPayment` não tem `Last4`. Esse é o custo do TPH: o banco não consegue
impor com `NOT NULL` que "pagamento em cartão tem `Last4`". Uma consulta pelo tipo
base lê tudo; uma consulta por uma folha acrescenta um filtro:

```csharp
db.Payments.OfType<CardPayment>().Where(c => c.Last4 == "4242")
```
```sql
SELECT "p"."Id", "p"."Amount", "p"."Discriminator", "p"."Last4"
FROM "Payments" AS "p"
WHERE "p"."Discriminator" = 'CardPayment' AND "p"."Last4" = '4242'
```

Dá para renomear a coluna e usar valores legíveis:

```csharp
b.Entity<Payment>().HasDiscriminator<string>("Kind")
    .HasValue<Payment>("base").HasValue<CardPayment>("card").HasValue<PixPayment>("pix");
```

A coluna passa a ser `"Kind" TEXT NOT NULL`. O discriminador também pode ser
mapeado para uma propriedade de verdade. Se a tabela tem um valor que nenhum tipo
mapeia, ler o tipo base lança exceção ("No discriminators matched the
discriminator value 'Mystery'"). `HasDiscriminator().IsComplete(false)` faz o EF
Core filtrar até a consulta do tipo base, então os tipos desconhecidos são
ignorados em vez de falhar:

```sql
WHERE "p"."Discriminator" IN ('Payment', 'CardPayment', 'PixPayment')
```

### Propriedades irmãs e colunas compartilhadas

Se `CardPayment` e `PixPayment` declaram ambos `string Reference`, o TPH cria duas
colunas, `Reference` e `PixPayment_Reference`. Quando os dois são o mesmo dado,
aponte para uma coluna só:

```csharp
b.Entity<CardPayment>().Property(x => x.Reference).HasColumnName("Reference");
b.Entity<PixPayment>().Property(x => x.Reference).HasColumnName("Reference");
// uma coluna anulável "Reference" em "Payments"
```

A documentação avisa que um cast como `(p as PixPayment).Reference` sobre coluna
compartilhada não adiciona o predicado do discriminador, então a consulta também
pode devolver valores de linhas dos tipos irmãos.

### TPT: uma tabela por tipo

```csharp
b.Entity<Payment>().UseTptMappingStrategy();
```

A tabela base guarda as colunas comuns e cada tabela derivada tem as suas
colunas, mais uma chave primária que também é foreign key para a base:

```sql
CREATE TABLE "CardPayment" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_CardPayment" PRIMARY KEY,
    "Last4" TEXT NOT NULL,
    CONSTRAINT "FK_CardPayment_Payments_Id" FOREIGN KEY ("Id") REFERENCES "Payments" ("Id") ON DELETE CASCADE
)
```

Agora `Last4` é `NOT NULL`. O preço aparece nas consultas. Ler a hierarquia
inteira faz join com todas as tabelas derivadas, e o tipo é deduzido pelo join que
casou:

```sql
SELECT "p"."Id", "p"."Amount", "c"."Last4", "p0"."Key", CASE
    WHEN "p0"."Id" IS NOT NULL THEN 'PixPayment'
    WHEN "c"."Id" IS NOT NULL THEN 'CardPayment'
END AS "Discriminator"
FROM "Payments" AS "p"
LEFT JOIN "CardPayment" AS "c" ON "p"."Id" = "c"."Id"
LEFT JOIN "PixPayment" AS "p0" ON "p"."Id" = "p0"."Id"
```

Até `OfType<CardPayment>()` parte de `Payments` e faz join. O número de joins cresce
com o número de subtipos.

### TPC: uma tabela por tipo concreto

```csharp
b.Entity<Payment>().UseTpcMappingStrategy();
```

Cada tabela repete as colunas herdadas (`Amount` aparece em `CardPayment`,
`PixPayment` e `Payments`) e não existe `Discriminator`. Se a classe base é
`abstract`, ela não ganha tabela nenhuma. Consultar o tipo base vira um
`UNION ALL`, mas uma folha lê uma tabela só, sem filtro:

```sql
SELECT "c"."Id", "c"."Amount", "c"."Last4", 'CardPayment' AS "Discriminator"
FROM "CardPayment" AS "c"
```

Duas consequências importam. Primeiro, as chaves precisam ser únicas na hierarquia
inteira, e uma coluna identity não consegue isso porque não há tabela
compartilhada. O SQL Server usa uma sequence compartilhada por padrão; o SQLite
não tem sequences nem seed e incremento, então no SQLite a primeira tentativa de
salvar três entidades novas com `Id = 0` falhou com "another instance with the same
key value for {'Id'} is already being tracked". Atribua as chaves você mesmo ou
use GUIDs. Segundo, uma foreign key que aponta para o tipo base não pode ser
imposta:

```csharp
public class Refund { public int Id { get; set; } public int PaymentId { get; set; } public Payment Payment { get; set; } = null!; }
// tabela "Refund": ("Id", "PaymentId") sem nenhuma FOREIGN KEY
db.Add(new Refund { Payment = new CardPayment { Id = 7, ... } }); // nenhuma reclamação sobre linha inexistente
```

No TPT, a mesma tabela `Refund` ganha `FOREIGN KEY ("PaymentId") REFERENCES
"Payments" ("Id")`. No TPC, a integridade depende de todo escritor passar pelo EF
Core.

### Como escolher

A documentação do EF Core diz que o TPH é um bom padrão e que o TPT é inferior na
maioria dos benchmarks, porque faz joins. O benchmark de exemplo deles (35000
linhas, hierarquia de 7 tipos, no hardware deles) carregou tudo em cerca de 149 ms
no TPH, 313 ms no TPT e 158 ms no TPC, e eles insistem que você meça as suas
próprias consultas. O EF Core 10 não mudou as estratégias de herança; o TPC chegou
no EF Core 7.

## Trade-offs

- **O TPH abre mão do NOT NULL.** Uma tabela larga, sem joins, mas as colunas
  derivadas são anuláveis e regras como "pagamento em cartão exige `Last4`" vão
  para o código ou para uma `CHECK` que você escreve na migration.
  ```csharp
  b.Entity<Payment>().ToTable(t => t.HasCheckConstraint("CK_Card", "Discriminator <> 'CardPayment' OR Last4 IS NOT NULL"));
  ```
- **O TPT tem o schema mais limpo e costuma ser o mais lento.** Toda consulta pelo
  tipo base faz join com todas as tabelas derivadas. Escolha quando algo fora do
  seu controle exigir, como um banco normalizado já existente.
- **O TPC é rápido para folhas e fraco em integridade.** Consultar o tipo base une
  todas as tabelas, não há foreign key para a base e as chaves precisam de uma
  estratégia que valha entre tabelas.
- **A evolução do schema muda.** Um subtipo novo são colunas anuláveis novas no
  TPH e uma tabela nova no TPT e no TPC. Uma coluna nova na classe base é uma
  coluna no TPH e no TPT, mas uma coluna em cada tabela concreta no TPC.
- **Valores de discriminador são dados gravados.** Renomear a classe não renomeia
  as strings que já estão na coluna, então dê nomes explícitos com `HasValue`
  quando a tabela vai durar mais que o código.

## Documentation Links

- [Inheritance, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/inheritance) (doc)
- [Modeling for performance, inheritance mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/modeling-for-performance#inheritance-mapping) (doc)
- [What's new in EF Core 7, table-per-concrete-type mapping, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/whatsnew#table-per-concrete-type-tpc-inheritance-mapping) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
