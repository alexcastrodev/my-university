---
version: 1.0
updatedAt: 2026-10-28
title: "Value converters, value comparers e IDs fortemente tipados"
summary: Value converters do EF Core 10 na prática: conversores prontos e próprios, ConfigureConventions por tipo, null que nunca chega ao conversor, o que traduz e o que quebra nas queries, o ValueComparer que evita perder alterações em tipos mutáveis, comparers de chave, IDs fortemente tipados do banco à rota da Minimal API, o custo por linha e quando preferir complex type, owned type ou entidade.
---
## Objective

Um value converter deixa uma propriedade com um tipo de domínio (`Email`, `Money`, `ProductId`, um enum) enquanto a coluna guarda algo que o banco entende (uma string, um decimal, um `Guid`). É um dos recursos mais usados do EF Core e um dos mais fáceis de errar sem perceber: nulls passam por fora dele, queries não enxergam o interior do tipo convertido, tipos mutáveis precisam de um value comparer ou suas alterações nunca são salvas, e uma chave `Guid` convertida deixa de ser gerada. Este conceito roda cada um desses casos no EF Core 10 e mostra o que chegou ao banco: `ValueConverter<TModel,TProvider>` prontos e próprios, `ConfigureConventions` para todas as propriedades de um tipo, a tradução de queries e suas falhas, o bug do `ValueComparer` e a correção, comparers de chave, IDs fortemente tipados como chave primária, chave estrangeira e via HTTP numa Minimal API, os conversores prontos que vale conhecer, o custo por linha e quando um complex type, um owned type ou uma entidade se encaixa melhor. O conceito de construção do modelo já cobre onde a configuração mora e por que a configuração pré-convenção vence as annotations; este parte disso. Versões usadas: SDK 10.0.100 (runtime do ASP.NET Core 10.0.0), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 contra PostgreSQL 18.6.

## Use Cases

- Guardar um enum como texto legível, um value object `Money` como `numeric(18,2)` e um `Email` como `varchar(254)` em minúsculas, enquanto a entidade mantém os tipos de domínio.
- Dar a cada agregado um id tipado (`ProductId`, `OrderId`), para que um id de produto nunca seja passado onde se espera um id de pedido, da rota até a coluna.
- Manter uma pequena lista de tags numa coluna sem perder alterações feitas com `Add` ou `Remove`.
- Normalizar valores na entrada e na saída, como um `DateTime` sempre gravado em ticks UTC.

## Deep Dive

### Um conversor por valor

A entidade mantém seus tipos de domínio. Três propriedades ganham um conversor, escrito de três jeitos:

```csharp
public enum Status { Active, Pending, Archived }
public sealed record Email(string Value);
public readonly record struct Money(decimal Amount);
public class MoneyConverter() : ValueConverter<Money, decimal>(m => m.Amount, d => new Money(d));
public class EmailConverter() : ValueConverter<Email, string>(e => e.Value.ToLowerInvariant(), s => new Email(s));
// ConfigureConventions(ModelConfigurationBuilder b): uma regra para todas as propriedades do tipo
b.Properties<Money>().HaveConversion<MoneyConverter>().HavePrecision(18, 2);
b.Properties<Email>().HaveConversion<EmailConverter>().HaveMaxLength(254);
// OnModelCreating: por propriedade
c.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);   // atalho: o EF escolhe o conversor
c.Property(x => x.SeenAt).HasConversion(new ValueConverter<DateTime, long>(
    d => d.ToUniversalTime().Ticks, t => new DateTime(t, DateTimeKind.Utc)));
```

`HasConversion<string>()` informa só o tipo do provider; lendo o modelo de volta, a propriedade tinha um `EnumToStringConverter<Status>`, a mesma classe que você criaria à mão. A instância explícita de `ValueConverter` é o que você escreve quando a conversão é sua ou é compartilhada. `GenerateCreateScript()` mostra que os facets configurados junto do conversor vão para a coluna convertida, e que `Email` e `Email?` (`Backup`) usam o mesmo conversor:

```text
SQLite                                    PostgreSQL
"Status" TEXT NOT NULL                    "Status" character varying(16) NOT NULL
"Email" TEXT NOT NULL                     "Email" character varying(254) NOT NULL
"Backup" TEXT NULL                        "Backup" character varying(254)
"Balance" TEXT NOT NULL                   "Balance" numeric(18,2) NOT NULL
"SeenAt" INTEGER NOT NULL                 "SeenAt" bigint NOT NULL
```

Salvei `Status.Pending`, `new Email("Ana@X.io")`, `new Money(12.5m)` e um `DateTime` local das 10:00, com o processo rodando sob `TZ=America/Sao_Paulo`, no PostgreSQL:

```text
stored:    Pending | ana@x.io | NULL | 12.50 | 639287892000000000
read back: Pending Email { Value = ana@x.io } Money { Amount = 12.50 } 2026-10-28T13:00:00.0000000Z Utc
```

O email foi para minúsculas pelo conversor, e as 10:00 locais voltaram como 13:00 UTC com `Kind = Utc`. Duas observações da mesma execução: o tamanho 254 não aparece no DDL do SQLite (o SQLite não tem tamanhos), e `ConfigureConventions` vale para toda propriedade `Money` e `Email` do modelo, inclusive as que forem criadas no ano que vem.

### Null nunca chega ao conversor

A documentação diz que um `null` nunca é passado a um conversor: null na coluna é null na entidade e vice-versa. Mapeei um `Email?` opcional com um conversor que lançaria exceção com null (`e => e!.Value`) e salvei um contato sem email:

```text
stored Email: NULL      read back Email is null: True
Where(c => c.Email == null)  ->  WHERE "c"."Email" IS NULL
```

Nenhuma exceção. O conversor só vê valores não nulos, e é por isso que um único conversor atende `Email` e `Email?`. Converter o próprio null é possível com uma flag no construtor, `convertsNulls: true`, mas o compilador reclama: `warning EF1001: ... is an internal API that supports the Entity Framework Core infrastructure`. Tentei mesmo assim, mapeando `string? Nick` para `""` no banco:

```csharp
c.Property(x => x.Nick).HasConversion(new ValueConverter<string?, string>(
    v => v ?? "", s => s == "" ? null : s, convertsNulls: true));
// gravado Nick: '' (string vazia)            lido de volta Nick is null: True
// Where(c => c.Nick == null)  ->  WHERE "c"."Nick" IS NULL     count: 0
```

Escrita e leitura concordaram, mas a query continuou traduzindo `== null` para `IS NULL` e não achou nada, enquanto o `Nick` da linha era null no .NET. A documentação XML desse construtor avisa exatamente sobre isso (queries quebradas, GitHub issue 26230). Deixe null ser null.

### Queries sobre membros convertidos

Dentro de uma query, o EF Core só consegue tratar uma propriedade convertida como valor inteiro: ele converte o parâmetro e compara colunas. Rodei cada uma destas contra três clientes no SQLite (o SQL do PostgreSQL aparece onde difere):

```text
c.Email == new Email("B@X.IO")       WHERE "c"."Email" = @target   (@target = 'b@x.io')    1 row
list.Contains(c.Email)               WHERE "c"."Email" IN (@list1, @list2)                 2 rows
                                     PostgreSQL: WHERE c."Email" = ANY (@list)
c.Email.Value.Contains("x.io")       InvalidOperationException (could not be translated)
c.Email.Value.ToUpper() == "A@X.IO"  InvalidOperationException (could not be translated)
c.Balance.Amount > 5                 InvalidOperationException (could not be translated)
c.Status > Status.Pending            WHERE "c"."Status" > 'Pending'                        0 rows
OrderBy(c => c.Status)               Active, Archived, Pending
```

A igualdade funcionou mesmo com maiúsculas diferentes, porque o parâmetro também passou pelo `EmailConverter`. Acessar um membro do value object falhou com a mensagem padrão:

```text
The LINQ expression 'DbSet<Customer>()
    .Where(c => c.Email.Value.ToUpper() == "A@X.IO")' could not be translated. Either rewrite the query in a form that can be translated, or switch to client evaluation explicitly by inserting a call to 'AsEnumerable', 'AsAsyncEnumerable', 'ToList', or 'ToListAsync'.
```

A documentação lista isso como limitação conhecida (issue 10434) e sugere colunas JSON no lugar. A comparação do enum é a silenciosa: em C#, `Archived > Pending` é verdadeiro, mas o banco comparou as strings `'Archived'` e `'Pending'` e não devolveu nenhuma linha, e o `OrderBy` ordenou em ordem alfabética. Guarde enums como números se você ordena ou filtra por faixa. Um cast traduziu nos dois providers: `((string)(object)c.Email).Contains("x.io")` virou `instr(CAST("c"."Email" AS TEXT), 'x.io') > 0` no SQLite e `c."Email"::text LIKE '%x.io%'` no PostgreSQL, e `Sum(c => (decimal)(object)c.Balance)` devolveu 30.0. Não encontrei isso na página de value conversions, então cubra com um teste se depender dele.

### Tipos mutáveis precisam de um ValueComparer

O change tracking funciona por snapshot: o EF Core copia cada valor quando a entidade é carregada e compara no `SaveChanges`. A documentação diz que, para um tipo convertido, ele usa o `Equals` do tipo e, para um tipo por referência, guarda a mesma referência como snapshot, então um objeto alterado é igual a si mesmo. Gravei `List<string> Tags` como string separada por vírgulas, só com `HasConversion(to, from)`. A validação do modelo registrou:

```text
warn: CoreEventId.CollectionWithoutComparer[10620] (Microsoft.EntityFrameworkCore.Model.Validation)
      The property 'Post.Tags' is a collection or enumeration type with a value converter but with no value comparer. Set a value comparer to ensure the collection/enumeration elements are compared correctly.
```

Depois carreguei um post, chamei `post.Tags.Add("sqlite")` e `post.Blob[0] = 9` (um `byte[]` comum, sem conversor), `DetectChanges()`, e salvei:

```text
Post {Id: 1} Unchanged
    Blob: '0x090203'
    Tags: 'System.Collections.Generic.List`1[System.String]'
SaveChanges returned 0             (no UPDATE in the log)
in the database: ef,dotnet | 010203
```

As duas alterações se perderam sem nenhum erro. A documentação explica o caso do `byte[]`: arrays que não são chave são comparados por referência de propósito, então trocar o array é detectado e alterá-lo por dentro não é. A correção é um comparer com expressões de igualdade, hash e snapshot, em que o snapshot precisa ser uma cópia profunda:

```csharp
p.Property(x => x.Tags).HasConversion(to, from, new ValueComparer<List<string>>((a, b) => a!.SequenceEqual(b!),
    l => l.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())),
    l => l.ToList()));
p.Property(x => x.Blob).Metadata.SetValueComparer(new ValueComparer<byte[]>((a, b) => a!.SequenceEqual(b!), a => a.Aggregate(0, (h, x) => HashCode.Combine(h, x)), a => a.ToArray()));
```

```text
Post {Id: 1} Modified
    Blob: '0x090203' Modified Originally '0x010203'
    Tags: 'System.Collections.Generic.List`1[System.String]' Modified Originally 'System.Collections.Generic.List`1[System.String]'
UPDATE "Posts" SET "Blob" = @p0, "Tags" = @p1 WHERE "Id" = @p2 RETURNING 1;
SaveChanges returned 1             in the database: ef,dotnet,sqlite | 090203
```

O aviso sumiu. Num design novo, um `List<string>` nem precisa de conversor: o EF Core mapeia coleções de primitivos para JSON por convenção (veja o conceito de colunas JSON). A documentação diz que classes imutáveis com igualdade por valor, e structs, também dispensam comparer, e esse é o principal motivo para fazer value objects imutáveis.

O mesmo comparer decide a identidade da chave: a qual entidade rastreada uma chave pertence, e o que o `Find` consegue responder da memória. Fiz um id como classe comum sem `Equals` (`sealed class ShopId(Guid value)`), salvei uma loja e chamei `Find(new ShopId(g))` e `Attach` com outra instância com o mesmo Guid:

```text
no comparer:   Find -> SELECT ... FROM "Shops" (went to the database)   Attach duplicate key: accepted, tracked=3
with comparer: Find -> no SQL (identity map)                            Attach duplicate key: "The instance of entity type 'Shop' cannot be tracked because another instance with the same key value..."
```

Sem comparer, uma única linha acabou rastreada três vezes. O modelo também informou um comparer separado do lado do provider (`GetProviderValueComparer()` era o padrão para `Guid`); `HasConversion(converter, valueComparer, providerValueComparer)` define os dois, e a documentação cita `SetKeyValueComparer` para o caso raro em que chaves precisam de outra semântica. Um id `record` ou `record struct` ganha igualdade por valor de graça e evita tudo isso.

### IDs fortemente tipados

Uma interface marcadora, um conversor genérico e um loop com reflection em `ConfigureConventions` cobrem todos os tipos de id:

```csharp
public interface IStrongId { Guid Value { get; } }
public readonly record struct ProductId(Guid Value) : IStrongId;
public readonly record struct OrderId(Guid Value) : IStrongId;
public class StrongIdConverter<T>() : ValueConverter<T, Guid>(id => id.Value, FromGuid()) where T : struct, IStrongId
{
    static Expression<Func<Guid, T>> FromGuid()   // g => new T(g): C# não tem "new T(arg)" para parâmetro de tipo
    { var g = Expression.Parameter(typeof(Guid)); return Expression.Lambda<Func<Guid, T>>(Expression.New(typeof(T).GetConstructor([typeof(Guid)])!, g), g); }
}
// ConfigureConventions
foreach (var t in typeof(IStrongId).Assembly.GetTypes().Where(t => t.IsValueType && typeof(IStrongId).IsAssignableFrom(t)))
    b.Properties(t).HaveConversion(typeof(StrongIdConverter<>).MakeGenericType(t));
```

A forma mais curta, `b.Properties<IStrongId>().HaveConversion(typeof(StrongIdConverter<>))`, compilou mas não teve efeito: a construção do modelo falhou com "The 'ProductId' property 'Product.Id' could not be mapped because the database provider does not support this type." Com o loop, `Product.Id`, `Order.Id` e a chave estrangeira `Order.ProductId` viraram `TEXT` no SQLite (`Product.Id` foi `uuid` no PostgreSQL), o relacionamento e o índice foram criados por convenção, `Find(prod.Id)` funcionou e `Where(o => o.ProductId == prod.Id)` enviou um parâmetro comum.

A armadilha é a geração de valores. Uma chave `Guid` comum é `ValueGenerated=OnAdd` por convenção; a convertida não foi:

```text
Product.Id   ValueGenerated=Never   converter=StrongIdConverter`1
after Add: product id = 00000000-0000-0000-0000-000000000000
second Add: The instance of entity type 'Product' cannot be tracked because another instance with the same key value for {'Id'} is already being tracked.
```

Com um único produto, o EF Core inseriu tranquilamente o Guid todo zerado. Adicionar `.ValueGeneratedOnAdd()` à chave resolveu, e os ids foram atribuídos no cliente, no `Add`, antes do `SaveChanges`: `after Add: fbd37c9a-... / f6715b49-...`. As release notes do EF Core 7 dizem que chaves convertidas podem usar valores gerados se o tipo subjacente suportar; você precisa pedir. Para um id `int` (`SeqId`) com `ValueGeneratedOnAdd`, o PostgreSQL criou `GENERATED BY DEFAULT AS IDENTITY` e o SQLite criou `INTEGER ... PRIMARY KEY` sem `AUTOINCREMENT` (os valores 1 e 2 ainda vieram do rowid). A documentação do provider SQLite diz que o EF Core 10 permite adicionar `UseAutoincrement()` numa chave convertida. Outra opção é deixar o domínio criar o id (por exemplo uma factory que use `Guid.CreateVersion7()`) e manter `ValueGeneratedNever`, como faz o conceito de mapeamento do domínio.

### O id via HTTP

O id também precisa atravessar a fronteira da API como uma string simples. Sem ajuda, os dois lados quebram. Um parâmetro de rota de um record struct sem `TryParse` nem compila: `error ASP0020: Parameter 'id' of type RawId should define a bool TryParse(string, IFormatProvider, out RawId) method, or implement IParsable<RawId>`. E o System.Text.Json o serializou como objeto: `{"id":{"value":"0f8fad5b-..."}}`. Implementar `IParsable<T>` e um pequeno `JsonConverter<T>` resolveu os dois:

```csharp
[JsonConverter(typeof(ProductIdJsonConverter))]
public readonly record struct ProductId(Guid Value) : IParsable<ProductId>
{
    public override string ToString() => Value.ToString();
    public static ProductId Parse(string s, IFormatProvider? p) => new(Guid.Parse(s, p));
    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? p, out ProductId r) { var ok = Guid.TryParse(s, p, out var g); r = new(g); return ok; }
}
public sealed class ProductIdJsonConverter : JsonConverter<ProductId>
{
    public override ProductId Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => new(r.GetGuid());
    public override void Write(Utf8JsonWriter w, ProductId v, JsonSerializerOptions o) => w.WriteStringValue(v.Value);
}
app.MapGet("/products/{id}", (ProductId id) => store.TryGetValue(id, out var p) ? Results.Ok(p) : Results.NotFound());
```

```text
GET  /products/0f8fad5b-d9cb-469f-a165-70867728950e  -> 200 {"id":"0f8fad5b-d9cb-469f-a165-70867728950e","name":"Pen"}
GET  /products/not-a-guid                            -> 400 (empty body)
POST /products {"id":"7c9e6679-...","name":"Ink"}    -> 201 Location: /products/7c9e6679-7425-40de-944b-e07fc1f90ae7
POST /products {"id":"oops","name":"Ink"}            -> 400
```

### Conversores prontos e como um Guid é gravado

Mapeei uma linha com `BoolToZeroOneConverter<int>`, `DateTimeToBinaryConverter`, `EnumToStringConverter<Status>` e `GuidToBytesConverter`, mais uma chave `Guid` comum, todas com o Guid `0f8fad5b-d9cb-469f-a165-70867728950e`:

```text
            SQLite                                      PostgreSQL
Id (Guid)   TEXT  0F8FAD5B-D9CB-469F-A165-70867728950E  uuid   0f8fad5b-d9cb-469f-a165-70867728950e
Active      INTEGER 1                                   integer 1
When        INTEGER 5250973802427387904                 bigint 5250973802427387904
S           TEXT Archived                               text Archived
Ref (bytes) BLOB 5BAD8F0FCBD99F46A16570867728950E       bytea 5bad8f0fcbd99f46a16570867728950e
```

O SQLite grava um `Guid` comum como texto em maiúsculas, 36 caracteres, enquanto o PostgreSQL tem um `uuid` nativo de 16 bytes. O `GuidToBytesConverter` usa a ordem de bytes do .NET, então os três primeiros grupos saem invertidos (`5BAD8F0F` para `0f8fad5b`): SQL puro ou outra ferramenta que leia essa coluna precisa saber disso. O `DateTimeToBinaryConverter` (a documentação o lista como o que `HasConversion<long>()` faz para um `DateTime`) junta os ticks e o `Kind` num único `long`, ao contrário dos ticks puros do meu conversor. A documentação lista o resto, como `BoolToStringConverter`, `TimeSpanToTicksConverter` e `CastingConverter`.

### O custo por valor

Um conversor roda uma vez por valor lido ou gravado. Carreguei 100 000 linhas com `AsNoTracking().ToList()` do SQLite num build Release, 20 rodadas cronometradas, alternando a ordem: uma entidade com `Guid`, `string`, `decimal`, `int`, e outra com `ProductId`, `Email`, `Money` e um enum como string:

```text
plain:     median 68 ms (min 60, max 99),  allocated 44 MB
converted: median 78 ms (min 72, max 127), allocated 50 MB     (second run: 66 against 78 ms)
```

Cerca de 15 por cento mais lento e cerca de 6 MB a mais, boa parte pelos objetos `Email` extras: real, mas pequeno perto da ida e volta ao banco.

### Conversor, complex type, owned type ou entidade

| Necessidade | Use |
|---|---|
| Um único valor com regras (`Email`, `Money` numa só moeda, um id, um enum) | Value converter |
| Um value object com vários campos, trocado inteiro, consultado por campo (`Address`, `Money` com moeda) | Complex type (colunas ou JSON) |
| Uma parte com identidade oculta, ou um mapeamento owned já existente (a documentação agora direciona novos mapeamentos JSON para complex types) | Owned type |
| Algo com ciclo de vida próprio, referenciado de outros lugares, ou uma lista grande que cresce | Entidade separada |

Um conversor mapeia para exatamente uma coluna e esconde o interior do valor do LINQ. Um complex type mapeia cada membro para uma coluna, ou para uma coluna JSON consultável por membro, como mostra o conceito de colunas JSON.

## Trade-offs

- **O interior de um valor convertido é invisível para o LINQ.** Igualdade e `Contains` sobre valores inteiros traduzem; membros, métodos e faixas não, e enums como string ordenam em ordem alfabética.
- **Tipos convertidos mutáveis perdem gravações em silêncio.** Sem comparer, alterações no próprio objeto deixam a entidade `Unchanged`. O EF Core avisou (evento 10620) para o `List<string>` convertido, e não disse nada sobre o `byte[]` alterado. Prefira tipos imutáveis.
- **Chaves Guid convertidas não são geradas por padrão.** `ValueGenerated=Never` significa que um id esquecido vira o Guid todo zerado. Adicione `ValueGeneratedOnAdd()` ou crie o id no domínio.
- **Um id fortemente tipado toca todas as camadas.** Conversor, comparer (se for classe), `IParsable<T>`, `JsonConverter<T>`, parâmetros de SQL puro (a documentação diz que tipos com value conversion não podem ser usados como parâmetros nas APIs de SQL puro). A própria documentação do EF Core avisa que o padrão adiciona complexidade; use onde misturar ids é um risco real.
- **Null não é seu para converter.** `convertsNulls` é uma API interna e quebrou queries com `== null` na minha execução.
- **O formato de armazenamento vaza.** Minúsculas, ticks UTC ou a ordem de bytes do `GuidToBytesConverter` são invisíveis no C# e evidentes para qualquer outro leitor da tabela. Escolha formatos que outras ferramentas consigam ler.

## Documentation Links

- [Value conversions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-conversions) (doc)
- [Value comparers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-comparers) (doc)
- [Model bulk configuration, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/bulk-configuration) (doc)
- [What's new in EF Core 7, value generation for guarded keys, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/whatsnew) (doc)
- [SQLite value generation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/value-generation) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding?view=aspnetcore-10.0) (doc)
