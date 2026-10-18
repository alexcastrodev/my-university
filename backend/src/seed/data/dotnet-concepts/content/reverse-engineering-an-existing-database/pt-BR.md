---
version: 1.0
updatedAt: 2026-10-16
title: "Engenharia Reversa de um Banco Existente"
summary: dotnet ef dbcontext scaffold no EF Core 10 contra um banco legado em SQLite, lendo o que ele gera (nomes, chaves, defaults, tabelas de junção, views, tabelas sem chave), as opções que importam, como rodar de novo sem perder código próprio e como mudar o código gerado com templates T4.
---
## Objective

Quando o banco existe antes do código C#, o `dotnet ef dbcontext scaffold` lê o
schema e escreve um `DbContext` e uma classe por tabela. Este conceito roda o
scaffolder no EF Core 10 contra um pequeno banco legado em SQLite e lê o que ele
produziu: nomes, chaves, defaults, tabelas de junção, views e tabelas sem chave
primária. Depois cobre as opções que importam, como repetir o comando sem perder
seu código e como alterar o código gerado com templates T4.

## Use Cases

- Começar uma API em cima de um banco que pertence a outro sistema.
- Gerar um primeiro modelo para um schema grande e depois mantê-lo à mão.
- Re-escanear a cada release porque o time de banco, e não o seu código, é a fonte
  da verdade do schema.
- Auditar um schema legado: o que o scaffolder não consegue expressar mostra onde o
  banco e o modelo de objetos discordam.

## Deep Dive

### Preparação e o schema legado

O projeto precisa do pacote do provider e do `Microsoft.EntityFrameworkCore.Design`
(use `PrivateAssets="all"` para ele não vazar para quem consome), além da
ferramenta `dotnet-ef` (`dotnet tool install --global dotnet-ef`). O schema legado
usa nomes em maiúsculas com underscore de propósito:

```sql
CREATE TABLE CUSTOMER (cust_id INTEGER PRIMARY KEY, cust_name TEXT NOT NULL, email TEXT,
  status TEXT NOT NULL DEFAULT 'A', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX UX_CUSTOMER_EMAIL ON CUSTOMER (email);
CREATE TABLE ORDER_HDR (ord_id INTEGER PRIMARY KEY, cust_id INTEGER NOT NULL REFERENCES CUSTOMER,
  total NUMERIC NOT NULL, net NUMERIC GENERATED ALWAYS AS (total * 0.9) STORED);
CREATE TABLE ORDER_LINE (ord_id INTEGER NOT NULL REFERENCES ORDER_HDR, line_no INTEGER NOT NULL,
  sku TEXT NOT NULL, qty INTEGER NOT NULL, PRIMARY KEY (ord_id, line_no));
CREATE TABLE TAG (tag_id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE ORDER_TAG (ord_id INTEGER NOT NULL REFERENCES ORDER_HDR,
  tag_id INTEGER NOT NULL REFERENCES TAG, PRIMARY KEY (ord_id, tag_id));
CREATE TABLE AUDIT_LOG (at TEXT, what TEXT);
CREATE VIEW V_ORDER_TOTALS AS SELECT c.cust_id, c.cust_name, SUM(o.total) AS total_spent
  FROM CUSTOMER c JOIN ORDER_HDR o ON o.cust_id = c.cust_id GROUP BY c.cust_id, c.cust_name;
```

```
dotnet ef dbcontext scaffold "Data Source=legacy.db" Microsoft.EntityFrameworkCore.Sqlite \
  --output-dir Models --context LegacyDb
```

Os dois argumentos obrigatórios são a connection string e o nome do pacote do
provider. O comando compila o projeto antes, então o projeto precisa compilar.

### O que sai

Os nomes são ajustados para o estilo .NET e os nomes originais ficam no mapeamento:
`CUSTOMER` vira `Customer`, `cust_id` vira `CustId`, `ORDER_HDR` vira `OrderHdr`.

```csharp
modelBuilder.Entity<Customer>(entity =>
{
    entity.HasKey(e => e.CustId);
    entity.ToTable("CUSTOMER");
    entity.HasIndex(e => e.Email, "UX_CUSTOMER_EMAIL").IsUnique();
    entity.Property(e => e.CustId).ValueGeneratedNever().HasColumnName("cust_id");
    entity.Property(e => e.Created).HasDefaultValueSql("CURRENT_TIMESTAMP").HasColumnName("created");
    entity.Property(e => e.Status).HasDefaultValue("A").HasColumnName("status");
});
```

Vale reparar em cada decisão que o scaffolder tomou por você:

- **A chave composta** de `ORDER_LINE` virou `HasKey(e => new { e.OrdId, e.LineNo })`.
- **A tabela de junção** `ORDER_TAG` não tem classe. Virou um many-to-many com
  `UsingEntity<Dictionary<string, object>>`, e `OrderHdr.Tags` e `Tag.Ords` são
  skip navigations. Isso só acontece com junções simples: duas foreign keys e mais
  nada.
- **Toda foreign key** recebeu `OnDelete(DeleteBehavior.ClientSetNull)`, porque o
  banco não declarou nenhuma ação `ON DELETE`. É a leitura certa do schema e
  raramente o que você quer para uma linha de pedido.
- **`AUDIT_LOG` não tem chave primária**, então virou uma entidade sem chave:
  `HasNoKey().ToTable("AUDIT_LOG")`. Dá para consultar, mas não para atualizar.
- **A view** também virou entidade sem chave, `HasNoKey().ToView("V_ORDER_TOTALS")`.
- **A coluna computada** `net` saiu como `HasComputedColumnSql()` sem expressão,
  porque o provider SQLite não recuperou a fórmula. Não leve esse modelo de volta
  para migrations.
- **`INTEGER PRIMARY KEY`** saiu como `ValueGeneratedNever()`. O SQLite faz essa
  coluna ser um alias do row id, mas o schema nunca disse `AUTOINCREMENT`, então o
  EF Core acredita que a aplicação fornece a chave. Adicionar dois clientes sem id
  falhou com "another instance with the same key value for {'CustId'} is already
  being tracked". Uma coluna declarada `INTEGER PRIMARY KEY AUTOINCREMENT` foi
  escaneada sem `ValueGeneratedNever`, então o resultado depende de como a chave foi
  declarada e do provider; confira todas as chaves.

A view mostra um limite de ler um schema. `SUM(...)` não tem tipo declarado no
SQLite, o scaffolder viu um tipo vazio e gerou `public byte[]? TotalSpent`; ler o
valor imprimiu `System.Byte[]`. Depois de mudar a view para
`CAST(SUM(o.total) AS REAL)` a propriedade virou `double?`. Revise o tipo de toda
coluna de view e prefira corrigir a view, ou usar `SqlQuery<T>` com um tipo seu, a
confiar no palpite.

### Opções que importam

- `--table CUSTOMER --table ORDER_HDR` limita a saída; `--schema` escolhe schemas
  inteiros. Por padrão todas as tabelas e views são escaneadas.
- `--data-annotations` move para a classe o que atributos conseguem expressar
  (`[Table("CUSTOMER")]`, `[Column("cust_id")]`, `[Key]`, `[Index(...)]`,
  `[ForeignKey]`, `[InverseProperty]`). A Fluent API continua com o resto: o
  `ValueGeneratedNever`, a coluna computada, o delete behavior e o many-to-many
  seguem no `OnModelCreating`. Não existe atributo para eles, então a flag não
  consegue eliminar a Fluent API.
- `--use-database-names` e `--no-pluralize` mantêm os nomes como estão no banco:
  `CUSTOMER.cs`, `public int cust_id`, `DbSet<CUSTOMER> CUSTOMER`.
- `--context-dir`, `--output-dir`, `--namespace` e `--context-namespace` definem
  onde os arquivos vão.
- `--no-onconfiguring` remove o método `OnConfiguring`. Sem ele a connection
  string, aqui um caminho absoluto, é escrita no código com um `#warning`. A
  documentação sugere `Name=ConnectionStrings:Legacy`, mas isso só resolve quando o
  projeto monta um host com `IConfiguration`; neste projeto de console o comando
  falhou com "named connection string ... was not found in the application's
  configuration". Prefira `--no-onconfiguring` e registrar o contexto com
  `AddDbContext`.
- Sem `--force`, uma segunda execução se recusa a mexer em arquivos existentes
  ("The following file(s) already exist ... Use the Force flag to overwrite these
  files").

### Rodar de novo sem perder seu código

O `--force` sobrescreve os arquivos gerados, então nunca os edite. Existem duas
costuras: cada entidade e o contexto são `partial`, e o contexto chama
`OnModelCreatingPartial` no fim do `OnModelCreating`. Chamadas Fluent feitas ali
sobrescrevem as geradas:

```csharp
public partial class LegacyDb
{
    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
        => modelBuilder.Entity<OrderLine>()
            .HasOne(l => l.Ord).WithMany(o => o.OrderLines)
            .HasForeignKey(l => l.OrdId)
            .OnDelete(DeleteBehavior.Cascade);
}
public partial class Customer { public string Display => $"{CustName} ({Status})"; }
```

Depois de `ALTER TABLE CUSTOMER ADD COLUMN phone TEXT` e de um novo scaffold com
`--force`, `Customer.Phone` apareceu, `Display` continuou compilando e o delete
behavior de `OrderLine` imprimiu `Cascade`. A única coisa que uma classe partial
não consegue é mudar uma propriedade gerada, como o tipo de `TotalSpent`; isso
exige um template ou uma mudança no banco.

### Templates

Desde o EF Core 7 o código gerado vem de templates T4 que você pode assumir. A
documentação os adiciona com `dotnet new install Microsoft.EntityFrameworkCore.Templates`
seguido de `dotnet new ef-templates`, que cria `CodeTemplates/EFCore/DbContext.t4` e
`EntityType.t4` no projeto. Peguei os mesmos dois arquivos do pacote NuGet sem
instalar um template global e acrescentei uma linha antes da classe:

```
/// <summary>Scaffolded from <#= EntityType.GetTableName() ?? EntityType.GetViewName() #>.</summary>
public partial class <#= EntityType.Name #>
```

O `scaffold --force` seguinte imprimiu `/// <summary>Scaffolded from CUSTOMER.</summary>`
acima de `Customer` e `V_ORDER_TOTALS` acima de `VOrderTotal`. Um terceiro
template, `EntityTypeConfiguration.t4`, produz uma classe
`IEntityTypeConfiguration<T>` por entidade, e comentar a checagem de
`IsSimpleManyToManyJoinEntityType()` transforma as tabelas de junção em classes.
Depois de atualizar o pacote, compare suas cópias com os templates novos.

## Trade-offs

- **Escanear uma vez ou escanear sempre.** Uma vez significa que o código gerado
  passa a ser seu e as migrations do EF assumem o schema; sempre significa que o
  banco é a fonte da verdade e suas mudanças vivem só em classes partial e
  templates. Misturar os dois gera migrations brigando com um banco que não é seu.
- **Nomes legados vazam para o modelo.** `OrderHdr` e `CustId` são legíveis, mas
  não são a linguagem do seu domínio. Uma classe partial não renomeia uma
  propriedade gerada, então renomeie por um template ou aceite os nomes.
- **Palpites nas bordas do schema.** Views, colunas computadas e tipos específicos
  do banco dependem do provider. Confira; o `byte[]` acima compilou sem problema e
  só falhou no uso.
- **O que o schema não consegue dizer nunca é escaneado.** Herança, owned types,
  table splitting e a maioria dos concurrency tokens não existem em um banco, então
  não saem. O conceito de herança mostra como adicionar o primeiro à mão.
- **Chaves geradas.** `ValueGeneratedNever` em toda chave inteira é seguro para
  linhas existentes e errado para linhas novas quando o banco de fato gera o valor.
  Corrija em `OnModelCreatingPartial` com
  `modelBuilder.Entity<Customer>().Property(c => c.CustId).ValueGeneratedOnAdd()`;
  com essa linha, os dois inserts que falharam antes funcionaram.

## Lab

Neste lab você roda o scaffolder do EF Core 10 (o motor por trás de `dotnet ef dbcontext scaffold`) contra um pequeno banco SQLite legado e lê o que ele produz: nomes, chaves, defaults, uma tabela de junção, uma view, uma tabela sem chave primária e uma coluna cujo tipo o scaffolder teve que adivinhar. Depois você altera o resultado com segurança, usando uma classe `partial` escrita à mão que sobrevive a um novo scaffold. Você recebe o banco legado e o scaffolder já montados (`LegacySchema` e `CreateScaffolder`), e o resto são stubs que lançam `NotImplementedException`. A ideia central é que o código gerado nunca se edita: o que é seu mora em outro arquivo.

**O cenário**

O banco legado usa nomes em maiúsculas com sublinhado de propósito.

- `LegacySchema.cs` (pronto): cria `CUSTOMER`, `ORDER_HDR`, `ORDER_LINE` (chave composta), `TAG`, `ORDER_TAG` (tabela de junção simples), `AUDIT_LOG` (sem chave primária) e a view `V_ORDER_TOTALS` (a coluna do `SUM` não tem tipo declarado).
- `Scaffolding.cs`: `ScaffoldSettings` (os flags da CLI como um record), `ScaffoldModel` e `ScaffoldToDirectory` para implementar. `Scaffold` já devolve nome de arquivo e código-fonte em memória.
- `Presets.cs`, `Findings.cs` e `PartialExtension.cs`: presets de flags, leitura do texto gerado e o arquivo escrito à mão.

O scaffolder roda dentro do processo de teste, sem `dotnet-ef`, servidor ou rede. Os testes conferem trechos do código gerado e o compilam com Roslyn para provar que o seu código à mão se encaixa.

**O que você vai fazer, passo a passo**

1. **Traduzir flags em chamada (TODO-00).** Em `ScaffoldModel`, chame `IReverseEngineerScaffolder.ScaffoldModel` com tabelas, `UseDatabaseNames`, `NoPluralize`, `UseDataAnnotations`, nome do contexto e namespaces, suprimindo o `OnConfiguring` e o aviso da connection string (o equivalente a `--no-onconfiguring`).
2. **Nomes do banco (TODO-01).** Em `Presets.DatabaseNames`, mantenha os nomes como o banco os tem (`--use-database-names --no-pluralize`), então `CUSTOMER` continua `CUSTOMER`.
3. **Data annotations (TODO-02).** Em `Presets.DataAnnotations`, use atributos (`[Table]`, `[Column]`, `[Key]`, `[Keyless]`) em vez de chamadas Fluent. Repare no que continua no `OnModelCreating` mesmo assim (`OnDelete`, `ValueGeneratedNever`, a tabela de junção).
4. **Só algumas tabelas (TODO-03).** Em `Presets.OnlyTables`, escaneie só as tabelas ou views nomeadas (`--table`).
5. **Ler o que o scaffolder decidiu (TODO-04).** Em `Findings.KeylessEntities`, ache as entidades sem chave pelo `HasNoKey()`. Em `ByteArrayProperties`, ache as propriedades tipadas como `byte[]` porque a coluna da view não tinha tipo.
6. **Estender sem editar (TODO-05).** Em `PartialExtension.Source`, escreva um segundo arquivo com `partial class LegacyDb` (`OnModelCreatingPartial`, com cascade em `OrderLine`) e `partial class Customer` (uma propriedade `Display`). Ele precisa compilar com o código gerado e sobreviver a um novo scaffold.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar por que a tabela de junção virou skip navigations em vez de uma classe, por que o `AuditLog` e a view são keyless e por que o seu arquivo parcial continua valendo depois de adicionar uma coluna e escanear de novo.

**Desafios opcionais**

- **TODO-06:** `ScaffoldToDirectory` escreve os arquivos em disco. Sem `force` o scaffolder deve se recusar a sobrescrever (o equivalente a `--output-dir Models` e `--force`).
- **TODO-07:** `PartialExtension.SourceWithGeneratedKeys` corrige o `ValueGeneratedNever()` que o scaffolder adivinhou para colunas `INTEGER PRIMARY KEY`, mantendo o cascade.

**Pré-requisitos:** C# e EF Core básicos (DbContext, Fluent API, data annotations), SQL básico (chaves primárias e estrangeiras, views) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada stub lança `NotImplementedException("TODO-NN")`, então os testes vermelhos indicam o TODO que falta.

## Documentation Links

- [Reverse engineering, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/scaffolding/) (doc)
- [Custom reverse engineering templates, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/scaffolding/templates) (doc)
- [EF Core tools reference, .NET CLI, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [Connection strings, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-strings) (doc)
- [Keyless entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keyless-entity-types) (doc)
