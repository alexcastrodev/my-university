---
version: 1.0
updatedAt: 2026-11-14
title: "Poda de joins e chaves estrangeiras sem constraint no EF Core 11"
summary: O EF Core 11 remove joins cujas colunas nunca são usadas, e confia no modelo para isso. ExcludeForeignKeyFromMigrations contra IsConstrained(false), e a execução no SQLite com um pedido órfão em que a mesma tabela responde 2 ou 1 linha conforme a consulta. EF 10 contra 11 com SQL offline.
---
## Objective

Dois recursos do EF Core 11 parecem não ter relação e têm. O primeiro é a **poda de
joins**: quando uma consulta faz join com uma tabela e depois nunca usa uma coluna
dela, o EF Core 11 remove o join do SQL. O segundo é um par de formas de modelar uma
chave estrangeira **sem constraint no banco**, para dados que você importa,
sincroniza ou herda sem garantias de integridade: `ExcludeForeignKeyFromMigrations()`
e `IsConstrained(false)`.

Eles interagem porque podar um `INNER JOIN` só é correto se toda linha do lado
esquerdo tem correspondente no direito, e o EF Core tira essa garantia do seu
*modelo*, não do banco. Declare a chave sem constraint do jeito errado e a mesma
tabela responde a uma consulta com 2 linhas ou com 1, conforme como a consulta foi
escrita. Este concept mostra os dois recursos e essa armadilha com saída real.

Como foi conferido, para você saber o que cada resultado prova. A comparação do EF
Core 10.0.14 com o 11.0.0 usou SQL do SQL Server gerado offline com `ToQueryString()`
e `GenerateCreateScript()` (sem servidor). A demonstração com a linha órfã foi
**executada** no SQLite com o EF Core 11.0.0 e linhas reais. O básico de
relacionamentos está em `relationships-keys-and-delete-behavior`, e como ler SQL
gerado está em `query-translation-and-performance`.

## Use Cases

- Um banco legado ou um schema de fornecedor em que as chaves estrangeiras nunca foram
  criadas.
- Dados que chegam fora de ordem de uma importação ou de um job de sincronização:
  pedidos antes dos clientes, filhos antes dos pais.
- Ler o SQL de uma consulta depois do upgrade e se perguntar para onde foi um `JOIN`.
- Decidir como declarar um relacionamento que o banco não impõe.

## Deep Dive

### O que a poda de joins remove

O modelo é uma loja: um `Order` tem um `Customer` obrigatório e um `Coupon` opcional.

```csharp
public class Order
{
    public int Id { get; set; }
    public decimal Total { get; set; }
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public int? CouponId { get; set; }
    public Coupon? Coupon { get; set; }
}

modelBuilder.Entity<Order>().HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId);
modelBuilder.Entity<Order>().HasOne(o => o.Coupon).WithMany().HasForeignKey(o => o.CouponId);
```

Uma consulta de relatório faz join explícito das três tabelas, e quem a chama usa
partes diferentes dela:

```csharp
var all = from o in db.Orders
          join c in db.Customers on o.CustomerId equals c.Id
          join cp in db.Coupons on o.CouponId equals cp.Id into cps
          from cp in cps.DefaultIfEmpty()
          select new { o, c, cp };

all.Select(x => new { x.o.Id, x.c.Name, Coupon = x.cp.Code });  // Q1: usa as três
all.Select(x => x.o);                                          // Q2: só o pedido
all.Select(x => new { x.o.Id, x.c.Name });                     // Q3: pedido e cliente
```

A Q1 é igual nas duas versões. A Q2 e a Q3 são onde elas diferem (SQL Server, gerado
offline, mesmo código):

```sql
-- Q2, EF Core 10.0.14: os dois joins ficam, embora nenhuma coluna deles seja selecionada
SELECT [o].[Id], [o].[CouponId], [o].[CustomerId], [o].[Total]
FROM [Orders] AS [o]
INNER JOIN [Customers] AS [c] ON [o].[CustomerId] = [c].[Id]
LEFT JOIN [Coupons] AS [c0] ON [o].[CouponId] = [c0].[Id]

-- Q2, EF Core 11.0.0
SELECT [o].[Id], [o].[CouponId], [o].[CustomerId], [o].[Total]
FROM [Orders] AS [o]

-- Q3, EF Core 11.0.0: o join do cupom não usado sumiu, o do cliente fica
SELECT [o].[Id], [c].[Name]
FROM [Orders] AS [o]
INNER JOIN [Customers] AS [c] ON [o].[CustomerId] = [c].[Id]
```

Se o otimizador tiver sorte, ele mesmo removeria os joins não usados. Podá-los no EF
significa que o banco nem precisa descobrir, o que importa quando a consulta é
complicada o bastante para o otimizador desistir. Propriedades de navegação que você
não toca já ficavam de fora no EF Core 10, e `Select(o => new { o.Id, o.Total })` já
era um `SELECT` simples lá também. Uma mudança separada do EF Core 11 remove joins de
Includes em split queries (`whats-new-in-ef-core-11`). Esta aqui trata de joins
explícitos e de navegações cujas colunas ficam sem uso.

### Por que um join some e o outro fica

Os dois joins têm riscos diferentes, e o EF raciocina sobre eles separadamente:

- Um **`LEFT JOIN` para uma chave única** nunca muda o número de linhas. Cada pedido
  mantém exatamente uma linha, case ou não um cupom. Ele pode ser removido sempre que
  as colunas dele não são usadas. Mesmo sem relacionamento no modelo, o EF 11 removeu
  o join do cupom e o EF 10 o manteve.
- Um **`INNER JOIN` pode remover linhas**: um pedido sem cliente desapareceria. Removê-lo
  só é correto se esse pedido não existe. O EF 11 só o remove quando o modelo diz que
  sim, o que significa uma chave estrangeira *obrigatória* que ele considera
  constrained. Sem relacionamento no modelo, só chaves simples e um `join` explícito, o
  EF 11 manteve o inner join na Q2 e na Q3.

Essa segunda regra é o assunto da próxima seção.

### Declarando uma chave estrangeira que o banco não impõe

Há duas APIs, em pacotes diferentes, com significados diferentes:

```csharp
// Relacional: a migration não cria a constraint FOREIGN KEY.
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId)
    .ExcludeForeignKeyFromMigrations();

// Core: o relacionamento não tem constraint nenhuma.
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId)
    .IsConstrained(false);
```

As duas produzem o mesmo schema. Nenhuma `FOREIGN KEY`, e o índice na coluna da chave
estrangeira continua sendo criado:

```sql
CREATE INDEX "IX_Orders_CustomerId" ON "Orders" ("CustomerId");
```

`ExcludeForeignKeyFromMigrations` está descrita na página "what's new" do EF Core 11:
o relacionamento continua plenamente suportado para consultas e change tracking, e só
a constraint é suprimida. `IsConstrained` é um membro público do pacote core
(`IForeignKey.IsConstrained` e o método do builder), e não a encontrei naquela página,
então confira a documentação de chaves estrangeiras para a descrição atual dela.

### Os mesmos dados, respostas diferentes

Este é o experimento que separa as duas, executado no SQLite com o EF Core 11.0.0. A
tabela tem dois pedidos. O pedido 1 pertence ao cliente 1, que existe. O pedido 2 tem
`CustomerId = 99`, e o cliente 99 não existe: um órfão. Cada linha abaixo é um banco
novo criado com `EnsureCreated` para aquele modelo.

| Modelo | Inserir o órfão | `join` e `Select(o)` | `Include(Customer)` | `Count()` |
|---|---|---|---|---|
| Padrão (constraint criada) | rejeitado: `FOREIGN KEY constraint failed` | 1 (sem join no SQL) | não executado | não executado |
| `ExcludeForeignKeyFromMigrations()` | aceito | **2** (join podado) | **1** (`INNER JOIN`) | 2 |
| `IsConstrained(false)` | aceito | **1** (`INNER JOIN` mantido) | **2** (`LEFT JOIN`) | 2 |
| Sem relacionamento, `join` simples | aceito | 1 (`INNER JOIN` mantido) | não se aplica | não se aplica |

Com `ExcludeForeignKeyFromMigrations`, o modelo continua dizendo "esta chave
estrangeira é obrigatória e o principal existe". O EF acredita e remove o inner join,
então a consulta que nunca lê `Customer` devolve o órfão, enquanto
`Include(Customer)`, que precisa das colunas do cliente, mantém o `INNER JOIN` e o
descarta em silêncio. `Count()` é 2 e `Where(o => o.Customer != null).Count()` é 1, no
mesmo banco. Nada lança exceção. Três consultas com cara de corretas discordam.

Com `IsConstrained(false)` o EF não presume que o principal existe. O join explícito
fica e filtra o órfão, o `Include` vira `LEFT JOIN`, e o órfão volta com
`Customer == null` mesmo com a propriedade declarada como não anulável
(`Customer = null!`). Esse é o modelo honesto para dados que podem estar sujos, e o
custo passa para o seu código: todo lugar que confia em `order.Customer` precisa lidar
com `null` agora.

A escolha segue de quem garante a integridade:

- **Outra coisa garante**, por exemplo um DBA criou a constraint fora das migrations, ou
  a outra tabela vive em um banco que as migrations não gerenciam: use
  `ExcludeForeignKeyFromMigrations()`. O modelo está certo de que as linhas casam.
- **Nada garante**, como em uma importação que pode rodar em qualquer ordem: use
  `IsConstrained(false)` e escreva consultas que esperam um órfão.

## Trade-offs

- **Uma constraint também é uma dica de otimização.** Ela protege os dados e deixa o EF
  produzir SQL mais curto. Abrir mão dela compra liberdade na ordem de carga e custa
  as duas coisas.
- **A poda só é de graça com dados limpos.** Com constraints impostas, toda consulta
  podada devolve exatamente o que a não podada devolvia. Se os seus dados já têm órfãos
  atrás de um relacionamento em que o EF acredita, subir para o 11 pode mudar contagens
  de linhas sem erro. Procure órfãos antes do upgrade
  (`WHERE NOT EXISTS (SELECT 1 FROM Customers c WHERE c.Id = o.CustomerId)`).
- **`ExcludeForeignKeyFromMigrations` em dados sujos é uma armadilha.** Lê-se como "sem
  constraint" e significa "sem constraint, e confie em mim". A tabela acima é o
  resultado quando a confiança está mal colocada.
- **`IsConstrained(false)` leva trabalho para o seu código.** Propriedades de
  navegação que nunca eram nulas agora podem ser, então as anotações de nulidade do
  compilador deixam de ser uma garantia para esse relacionamento.
- **Teste com uma fixture de órfão.** Uma linha com chave pendurada em um banco de
  testes teria mostrado a diferença entre essas duas opções antes de a produção
  mostrar.
- **A saída do SQL Server aqui é offline.** A comparação do EF 10 com o 11 prova o SQL
  gerado, e as contagens de linhas vêm da execução no SQLite. Confira o plano no seu
  servidor antes de contar com ganho de velocidade por ter menos joins.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Foreign and principal keys in relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/foreign-and-principal-keys) (doc)
- [Relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
