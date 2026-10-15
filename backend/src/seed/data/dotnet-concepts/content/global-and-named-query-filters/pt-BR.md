---
version: 1.0
updatedAt: 2026-10-15
title: "Query Filters Globais e Nomeados (EF Core 10)"
summary: HasQueryFilter para soft delete e multi-tenancy, filtros nomeados do EF Core 10 com IgnoreQueryFilters seletivo e a armadilha da navegação obrigatória.
---
## Objective

Um global query filter é um predicado que o EF Core adiciona a toda query sobre
um tipo de entidade, como se você tivesse escrito mais um `Where`. É assim que
soft delete e multi-tenancy costumam ser feitos: você declara a regra uma vez no
modelo, em vez de lembrar dela em cada query. O recurso é simples de usar e fácil
de errar de formas sutis, então este conceito cobre o que o filtro realmente
vira em SQL, a novidade do EF Core 10 de filtros nomeados (vários filtros numa
entidade, cada um desligado separadamente), como aplicar uma regra a várias
entidades e a armadilha da navegação obrigatória, que derruba linhas em silêncio.

## Use Cases

- Esconder linhas apagadas logicamente em todo lugar, e mostrá-las numa tela de
  administração.
- Manter cada tenant de uma tabela compartilhada longe das linhas dos outros.
- Combinar as duas regras e desligar só a de soft delete numa query de
  "restaurar" ou de auditoria, com a regra de tenant continuando ativa.
- Adicionar uma regra como "só artigos publicados" sem tocar nas queries
  existentes.

## Deep Dive

Os trechos rodaram no EF Core 10.0.13 com SQLite. O texto das queries é o que o
`ToQueryString()` imprimiu; o conceito de logging mostra como ver o SQL.

### No que o filtro vira em SQL

`HasQueryFilter` recebe uma lambda sobre a entidade. Toda query que parte desse
tipo de entidade recebe o filtro, e `IgnoreQueryFilters()` o remove numa query:

```csharp
modelBuilder.Entity<Blog>().HasQueryFilter(b => !b.IsDeleted);

db.Blogs.ToQueryString();
// SELECT "b"."Id", "b"."IsDeleted", "b"."Name", "b"."TenantId"
// FROM "Blogs" AS "b"
// WHERE NOT ("b"."IsDeleted")

db.Blogs.IgnoreQueryFilters().ToQueryString(); // mesmo SELECT, sem WHERE
```

O filtro também vale quando a entidade é alcançada de outro jeito. Compor sobre
SQL bruto embrulha o seu texto e coloca o filtro por fora, `Count` e
`SingleOrDefault` o carregam, e `ExecuteUpdate` e `ExecuteDelete` também:

```csharp
db.Blogs.FromSql($"SELECT * FROM Blogs") // ... FROM (SELECT * FROM Blogs) AS "b" WHERE NOT ("b"."IsDeleted")
db.Blogs.ExecuteUpdate(s => s.SetProperty(b => b.Name, b => b.Name + "!"));
// UPDATE "Blogs" AS "b" SET "Name" = "b"."Name" || '!' WHERE NOT ("b"."IsDeleted")   -> 1 linha (existem 2)
```

`Find` com uma chave que ainda não está rastreada também executou uma query com
o filtro e devolveu `null` para uma linha apagada logicamente, então não use
`Find` para olhar dados apagados.

### O filtro pode ler o contexto, mas o modelo é construído uma vez

Multi-tenancy precisa do tenant atual. O filtro pode referenciar um campo ou
propriedade do `DbContext`, e o EF Core transforma esse valor num parâmetro, de
modo que o mesmo modelo compilado atende tenants diferentes:

```csharp
class NamedDb(string file, string tenantId) : DbContext { /* ... */
    protected override void OnModelCreating(ModelBuilder b) =>
        b.Entity<Blog>().HasQueryFilter(x => x.TenantId == tenantId);
}
// tenant "t1": .param set @ef_filter__tenantId 't1'   WHERE "b"."TenantId" = @ef_filter__tenantId  -> fish-t1
// tenant "t2": .param set @ef_filter__tenantId 't2'   mesmo texto de SQL                           -> cats-t2
```

O porém: `OnModelCreating` roda uma vez por tipo de contexto e o modelo fica em
cache. Num teste, um contexto do mesmo tipo criado sem filtros veio primeiro, e
todos os contextos seguintes desse tipo ficaram sem filtro nenhum. A *forma* do
modelo, quais filtros existem, não pode depender de um argumento de construtor.
Só valores lidos dentro da lambda do filtro podem variar por instância. Uma
regra parecida vale para contextos em pool, que não devem guardar estado de
requisição nos próprios campos (veja o conceito de ciclo de vida do DbContext):
resolva o tenant de um serviço scoped.

### Um filtro por entidade, antes do EF Core 10

Até o EF Core 9, uma entidade tinha um único filtro. Chamar `HasQueryFilter` uma
segunda vez não adicionava uma regra, substituía a primeira:

```csharp
b.Entity<Blog>().HasQueryFilter(x => !x.IsDeleted);
b.Entity<Blog>().HasQueryFilter(x => x.TenantId == tenantId); // substitui a anterior
// WHERE "b"."TenantId" = @ef_filter__tenantId   -> fish-t1, fish-t1-deleted  (a linha apagada voltou)
```

O contorno era escrever uma lambda só com `&&`, que depois não dá para
separar: ignorar o filtro ignorava as duas regras.

### Filtros nomeados (EF Core 10)

O EF Core 10 adiciona uma sobrecarga que recebe um nome. Cada nome é um filtro
separado, e `IgnoreQueryFilters` tem uma sobrecarga que recebe os nomes a
desligar. A documentação descreve isso nas páginas "What's new in EF Core 10" e
"Global query filters". A saída abaixo vem de uma execução com dois filtros
nomeados e o tenant `t1`:

```csharp
modelBuilder.Entity<Blog>()
    .HasQueryFilter("SoftDeletionFilter", b => !b.IsDeleted)
    .HasQueryFilter("TenantFilter", b => b.TenantId == tenantId);

db.Blogs                                            // WHERE NOT ("b"."IsDeleted") AND "b"."TenantId" = @ef_filter__tenantId
db.Blogs.IgnoreQueryFilters(["SoftDeletionFilter"]) // WHERE "b"."TenantId" = @ef_filter__tenantId
db.Blogs.IgnoreQueryFilters(["TenantFilter"])       // WHERE NOT ("b"."IsDeleted")
db.Blogs.IgnoreQueryFilters()                       // sem WHERE: todos os filtros desligados
```

Os resultados sobre os mesmos dados foram `fish-t1`, depois
`fish-t1, fish-t1-deleted`, depois `fish-t1, cats-t2`, depois as três linhas.
Duas regras para lembrar:

- Um nome que não existe é aceito em silêncio. `IgnoreQueryFilters(["Typo"])`
  devolveu o resultado filtrado normal, sem exceção, então um nome escrito errado
  mantém o filtro ligado. Coloque os nomes em constantes compartilhadas entre o
  modelo e as queries.
- Não dá para misturar os estilos na mesma entidade. Um `HasQueryFilter` sem nome
  junto com um nomeado lançou `InvalidOperationException: Both anonymous and
  named query filters cannot be applied simultaneously. Specify either an
  anonymous filter or one or more named filters.` na construção do modelo.

### Uma regra para várias entidades

Uma regra de soft delete pertence a toda entidade que tem o flag. Percorra o
modelo e defina o mesmo filtro nomeado em cada uma. `SetQueryFilter(string,
LambdaExpression)` no tipo de entidade mutável é o equivalente em nível de
metadados da chamada fluente, e `GetDeclaredQueryFilters()` permite inspecionar
o resultado:

```csharp
foreach (var et in b.Model.GetEntityTypes().Where(t => typeof(ISoftDelete).IsAssignableFrom(t.ClrType)))
{
    var p = Expression.Parameter(et.ClrType, "e");
    var body = Expression.Equal(Expression.Property(p, nameof(ISoftDelete.IsDeleted)), Expression.Constant(false));
    et.SetQueryFilter("SoftDeletionFilter", Expression.Lambda(body, p));
}
// Comments.ToQueryString():  WHERE NOT ("c"."IsDeleted")
// model: key=SoftDeletionFilter  expr=e => (e.IsDeleted == False)
```

O lado da escrita é separado: o filtro esconde linhas mas não impede um delete.
Sobrescrever o `SaveChanges` para transformar `Deleted` em `Modified` com o flag
ligado faz do `Remove` um soft delete. Na execução, a entidade estava `Deleted`
antes do save e `Unchanged` com `IsDeleted=True` depois; a query padrão passou a
devolver só `a`, e `IgnoreQueryFilters()` devolveu `a, b`.

### A armadilha da navegação obrigatória

Se `Post` tem um relacionamento obrigatório com `Blog` e `Blog` tem filtro, uma
query que inclui o blog faz `INNER JOIN` com os blogs filtrados, então os posts
cujo blog está escondido somem também. Com um blog vivo e um apagado, cada um com
um post:

```csharp
db.Posts.ToList()                      // on-alive, on-deleted
db.Posts.Include(p => p.Blog).ToList() // on-alive            <- menos linhas que a primeira query
// FROM "Posts" AS "p"
// INNER JOIN (SELECT ... FROM "Blogs" AS "b" WHERE NOT ("b"."IsDeleted")) AS "b0" ON "p"."BlogId" = "b0"."Id"
```

O EF Core avisa disso quando o modelo é criado
(`Model.Validation[10622]: Entity 'Blog' has a global query filter defined and is the
required end of a relationship with the entity 'Post'...`). Há duas correções,
ambas conferidas na execução. Tornar a navegação opcional (`IsRequired(false)`),
e o join vira `LEFT JOIN`: `on-alive/alive, on-deleted/null`. Ou dar ao `Post` o
filtro correspondente (`!p.Blog.IsDeleted`), e as duas queries devolvem só
`on-alive`. Se você adiciona `IgnoreQueryFilters()` à query com o `Include`, ele
desliga o filtro da entidade incluída também (`on-alive/alive,
on-deleted/deleted`), porque o flag pertence à query inteira. Um detalhe a mais:
quando o resultado é projetado (`.Select(p => p.Title)`), o EF descarta o
`Include`, então o sintoma de linhas faltando só aparece quando as entidades são
realmente materializadas.

## Trade-offs

- **Um filtro esconde dados em silêncio.** Uma linha faltando parece bug em
  outro lugar, e quem consulta pelo mesmo contexto nunca vê linhas apagadas ou de
  outro tenant. Logue o SQL ao depurar e dê ao código de administração um
  caminho explícito com `IgnoreQueryFilters`.
  ```csharp
  var withDeleted = await db.Blogs.IgnoreQueryFilters(["SoftDeletionFilter"]).ToListAsync(ct);
  ```
- **É conveniência, não fronteira de segurança.** `IgnoreQueryFilters()` está a
  uma chamada de distância, e o SQL que você executa por conta própria
  (`ExecuteSql`, ADO.NET) não é uma query LINQ, então nenhum filtro é
  adicionado. Para isolamento forte entre tenants, adicione também um controle no
  nível do banco.
- **Erro de digitação no nome deixa o filtro ligado.** Um nome errado em
  `IgnoreQueryFilters([...])` mantém o filtro e não lança nada, o que aparece
  como "restaurar não encontra nada". Use constantes compartilhadas e cubra com
  um teste.
- **Soft delete deixa o dado na tabela.** Índices únicos ainda enxergam a linha
  apagada, então recriar um registro com o mesmo valor único falha, e a tabela
  cresce. No SQLite, um índice único com `HasFilter` resolveu (o segundo insert
  de `dup` lançou `UNIQUE constraint failed: Blogs.Name` sem ele e funcionou com
  ele). A string do filtro é SQL bruto do seu provider, então confira suporte e
  sintaxe.
  ```csharp
  b.Entity<Blog>().HasIndex(x => x.Name).IsUnique().HasFilter("\"IsDeleted\" = 0");
  ```
- **Soft delete não é cascade.** Só entidades rastreadas são convertidas pelo
  override de `SaveChanges`, então filhos que não foram carregados continuam
  vivos sob um pai apagado.
- **Toda query paga pelo predicado.** Pense em índices que cubram as colunas
  filtradas (`IsDeleted`, `TenantId`) e meça no seu banco.
- **O conjunto de filtros é fixo por tipo de contexto.** Formas de filtro
  diferentes por tenant ou por requisição pedem tipos de contexto diferentes ou
  uma model cache key customizada, não um flag de construtor.
- **Filtros são fáceis de esquecer nos testes.** Teste o resultado filtrado e o
  de `IgnoreQueryFilters` para cada regra, com dados que mudariam a resposta
  (uma linha apagada, uma linha de outro tenant).

## Documentation Links

- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [What's new in EF Core 10, named query filters, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Multi-tenancy in EF Core applications, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy) (doc)
- [EntityTypeBuilder.HasQueryFilter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.metadata.builders.entitytypebuilder-1.hasqueryfilter) (doc)
- [EntityFrameworkQueryableExtensions.IgnoreQueryFilters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.entityframeworkqueryableextensions.ignorequeryfilters) (doc)
