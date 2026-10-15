---
version: 1.0
updatedAt: 2026-10-15
title: "Colunas JSON e Complex Types"
summary: ToJson em complex e owned types, coleções em uma coluna JSON, o SQL real gerado para consultar e atualizar dentro do documento (conferido em SQLite), o que não traduz, ExecuteUpdate sobre JSON e o que mudou no EF Core 10.
---
## Objective

O conceito de mapeamento mostrou como um value object vira algumas colunas a mais
na linha do dono, via owned type ou complex type. Este conceito trata da outra
forma de guardar: colocar o valor inteiro, ou uma lista de valores, em uma única
coluna JSON. O EF Core 10 transformou os complex types no caminho recomendado para
isso, trouxe coleções de complex types e ensinou o `ExecuteUpdate` a alterar
propriedades dentro do documento. O foco aqui é o que chega de fato ao banco: a
coluna, o SQL gerado para ler e escrever dentro do JSON e o ponto em que a
tradução para. Todo SQL abaixo foi capturado do log de uma execução em SQLite com
`Microsoft.EntityFrameworkCore.Sqlite` 10.0.13; o que se afirma sobre SQL Server e
PostgreSQL vem da documentação deles e não foi rodado.

## Use Cases

- Um cliente com uma lista de endereços de entrega que sempre é lida e gravada
  junto com ele, em que uma tabela filha só acrescentaria um join.
- Preferências do usuário ou configurações de feature cujo formato muda com
  frequência e que ninguém consulta entre linhas, a não ser por um ou dois campos.
- Tags guardadas como `List<string>`, sem tabela de junção.
- Uma correção de dados pontual que muda um campo dentro do JSON de milhares de
  linhas sem carregá-las.

## Deep Dive

### Uma coluna por value object

O modelo abaixo tem uma coleção primitiva, duas propriedades complex (uma
opcional), uma coleção complex e, para comparar, um owned type, tudo mapeado para
JSON:

```csharp
class Customer
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<string> Tags { get; set; } = [];        // coleção primitiva
    public required Address Address { get; set; }       // complex, obrigatório
    public Address? Billing { get; set; }               // complex, opcional (EF Core 10)
    public List<Address> Shipping { get; set; } = [];   // coleção complex (EF Core 10)
    public required Prefs Prefs { get; set; }           // owned, para comparar
}
record Address(string Street, string City, string Country);

modelBuilder.Entity<Customer>(b =>
{
    b.ComplexProperty(c => c.Address, a => a.ToJson());
    b.ComplexProperty(c => c.Billing, a => a.ToJson());
    b.ComplexCollection(c => c.Shipping, a => a.ToJson());
    b.OwnsOne(c => c.Prefs, p => p.ToJson());
});
```

O `GenerateCreateScript()` no SQLite gera uma coluna `TEXT` por propriedade,
`NULL` só na opcional, e as linhas guardam JSON puro (as chaves saíram em ordem
alfabética):

```
"Tags" TEXT NOT NULL      ["vip","beta"]
"Address" TEXT NOT NULL   {"City":"Lisboa","Country":"PT","Street":"Rua A"}
"Billing" TEXT NULL       NULL
"Shipping" TEXT NOT NULL  [{"City":"Porto","Country":"PT","Street":"Dock 1"}, ...]
```

`Tags` não precisou de configuração: desde o EF Core 8, uma coleção de primitivos
vira um array JSON por convenção. O tipo da coluna é escolha do provider. Segundo o
What's new do EF Core 10, o SQL Server usa o tipo nativo `json` quando você chama
`UseAzureSql` ou define o compatibility level 170 (SQL Server 2025), e colunas JSON
existentes em `nvarchar` são convertidas pela próxima migration, a menos que você
fixe o tipo da coluna. A documentação do Npgsql diz que `ToJson` é suportado desde
o provider 8.0, recomenda `jsonb` em vez de `json` e recomenda complex types em vez
de owned types a partir do EF Core 10.

### O que o EF Core 10 mudou

Antes do EF Core 10, o mapeamento JSON existia só para owned types (desde o EF
Core 7). O EF Core 10 traz, para complex types: `ToJson`, propriedades complex
opcionais, coleções via `ComplexCollection` e complex types `struct`. A validação
do modelo confirma as regras, com estas mensagens da minha execução:

```
ComplexCollection sem ToJson         -> "must be mapped to a JSON column"
List<Point> (record struct)          -> "complex value type collections are not supported"
Note? só com membros anuláveis       -> falha como colunas ("requires at least one required
                                        property"), funciona com ToJson
```

A orientação oficial é preferir complex types a owned types tanto para JSON quanto
para table splitting, porque o owned type carrega uma chave escondida: a mesma
instância não pode ser atribuída duas vezes, a comparação é por identidade e, como
se vê adiante, o `ExecuteUpdate` não funciona com ele.

### Consultando dentro do documento

Filtros, ordenação e projeções sobre membros dentro do JSON viram as funções JSON
do provider. No SQLite, o EF Core 10 gera o operador `->>` e `json_each`:

```csharp
db.Customers.Where(c => c.Address.City == "Lisboa")
// WHERE "c"."Address" ->> 'City' = 'Lisboa'

db.Customers.Where(c => c.Tags.Contains("vip"))
// WHERE 'vip' IN (SELECT "t"."value" FROM json_each("c"."Tags") AS "t")

db.Customers.Where(c => c.Shipping.Any(s => s.Country == "ES"))
// WHERE EXISTS (SELECT 1 FROM (
//     SELECT "s"."value" ->> 'Country' AS "Country"
//     FROM json_each("c"."Shipping", '$') AS "s") AS "s0"
//   WHERE "s0"."Country" = 'ES')

db.Customers.Select(c => c.Shipping[0].City)            // "c"."Shipping" ->> '$[0].City'
db.Customers.Select(c => c.Tags.Count)                  // json_array_length("c"."Tags")
db.Customers.OrderBy(c => c.Address.City)               // ORDER BY "c"."Address" ->> 'City'
```

`GroupBy` sobre um membro do JSON, `ToUpper().StartsWith(...)` sobre um deles e
`Distinct` sobre uma coleção projetada também traduziram. Uma armadilha durante a
conferência: o `ToQueryString()` imprimiu as subqueries de `json_each` com um
`FROM ( )` vazio, embora a consulta tenha rodado certo. O SQL que aparece no
`LogTo` é o que foi executado, então leia esse.

### O que não traduz

Três falhas e uma surpresa saíram da mesma execução:

- Um método C# sobre o valor (`Where(c => Util.IsEu(c.Address))`) lança "could not
  be translated", como qualquer outro método que o EF Core não conhece.
- `SelectMany(c => c.Shipping)` lançou "requires the SQL APPLY operation, which is
  not supported on SQLite". É limitação do SQLite, e a mesma consulta pode traduzir
  em outro provider.
- `ExecuteUpdate` sobre uma propriedade de owned type em JSON lança, com uma
  mensagem que sugere mapear o tipo como complex type.
- Comparar valores inteiros, `Where(c => c.Billing == c.Address)`, virou
  `"c"."Billing" = "c"."Address"`, uma comparação do texto JSON. Depois de regravar
  `Billing` com os mesmos valores em outra ordem de chaves, a consulta não devolveu
  nenhuma linha, enquanto `ana.Billing == ana.Address` em .NET dava `true`. Comparar
  com um parâmetro deu no mesmo: o parâmetro é serializado e comparado como texto.
  No SQLite, a igualdade por valor só vale para documentos que o próprio EF Core
  escreveu.

### Escrevendo: SaveChanges e ExecuteUpdate

Com `SaveChanges`, a coluna JSON do complex type foi sempre regravada inteira.
Mudar uma cidade com `with`, alterar no lugar uma propriedade de uma classe complex
mutável, trocar um elemento da coleção ou acrescentar um: tudo gerou

```sql
UPDATE "Customers" SET "Shipping" = @p0 WHERE "Id" = @p1 RETURNING 1;
```

O owned type em JSON se comportou diferente: mudar uma propriedade gerou uma
atualização parcial, `SET "Prefs" = json_set("Prefs", '$.Theme', @p0)`, e mudar duas
voltou a regravar o documento inteiro. São observações em SQLite com a 10.0.13, não
garantias documentadas.

O `ExecuteUpdate` é onde o EF Core 10 dá poder de verdade. Agora ele alcança
membros dentro de uma coluna JSON de complex type e gera uma atualização parcial:

```csharp
await db.Customers
    .Where(c => c.Address.Country == "PT")
    .ExecuteUpdateAsync(s => s.SetProperty(c => c.Address.City, c => c.Address.City + "!"));
```

```sql
UPDATE "Customers" AS "c"
SET "Address" = json_set("c"."Address", '$.City', ("c"."Address" ->> 'City') || '!')
WHERE "c"."Address" ->> 'Country' = 'PT'
```

Definir um valor complex inteiro ou uma coleção primitiva inteira manda um único
parâmetro serializado. Para o SQL Server 2025, as release notes mostram a mesma
operação usando o método `modify` do tipo `json`, e versões mais antigas do SQL
Server são suportadas com colunas `nvarchar(max)`.

Indexar uma coleção dentro do `ExecuteUpdate` também funciona, e foi aí que achei o
canto mais afiado. `SetProperty(c => c.Shipping[0].City, "X")` sem filtro virou
`json_set("c"."Shipping", '$[0].City', @p)` para todas as linhas. Para um cliente
com a lista vazia, o SQLite criou o elemento, e a coluna ficou `[{"City":"X"}]`.
Carregar esse cliente não lançou nada: veio um `Address` com `Street` e `Country`
em `null`, mesmo sendo `string` não anulável. Nada no banco confere o formato do
JSON, então filtre pela coleção antes (`Where(c => c.Shipping.Count > 0)`).

## Trade-offs

- **Não há schema dentro da coluna.** O banco confere a coluna, não o documento.
  Um update em lote, uma correção manual ou outro serviço pode gravar um formato
  que os seus tipos não esperam, e o EF Core materializa mesmo assim.
  ```csharp
  .ExecuteUpdateAsync(s => s.SetProperty(c => c.Shipping[0].City, "X")); // [] virou [{"City":"X"}]
  ```
- **Consultar dentro do JSON é mais difícil de indexar.** Um filtro em
  `Address ->> 'City'` não usa um índice comum de coluna. A página de complex types
  lista índices sobre caminhos dentro de complex types como recurso do EF Core 11;
  no EF Core 10, um índice de expressão precisa ser criado na migration com SQL
  bruto, se o banco suportar. Se você filtra muito por um campo, ele provavelmente
  quer ser uma coluna de verdade.
- **A escrita pode ser maior que a mudança.** Na execução em SQLite, mudar uma
  cidade regravou o array `Shipping` inteiro. Documentos grandes que mudam com
  frequência custam mais do que os mesmos dados em linhas.
- **Igualdade de texto não é igualdade de valor.** Comparar dois valores JSON numa
  consulta comparou strings no SQLite, então ordem das chaves e formatação decidem
  o resultado.
  ```csharp
  db.Customers.Where(c => c.Billing == c.Address) // false depois de reordenar as chaves
  ```
- **Owned types em JSON são um beco sem saída para trabalho em lote.** Recusam o
  `ExecuteUpdate` e carregam uma identidade escondida. Na minha execução os dois
  tipos gravaram o JSON com o mesmo formato (nomes das propriedades como chaves),
  então migrar é sobretudo mudança de configuração, mas gere uma migration e leia
  antes de confiar nisso.
- **O comportamento muda por provider.** `SelectMany` sobre uma coleção JSON
  falhou no SQLite, o tipo da coluna muda de provider para provider e as
  atualizações parciais são geradas de jeitos diferentes. Rode testes de
  integração no banco que vai para produção.

## Documentation Links

- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [What's new in EF Core 8, primitive collections, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#primitive-collections) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Owned entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/owned-entities) (doc)
- [JSON data type, SQL Server, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/data-types/json-data-type) (doc)
- [JSON mapping, Npgsql EF Core provider](https://www.npgsql.org/efcore/mapping/json.html) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
