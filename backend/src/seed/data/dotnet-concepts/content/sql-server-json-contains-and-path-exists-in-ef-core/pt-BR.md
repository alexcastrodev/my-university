---
version: 1.0
updatedAt: 2026-11-14
title: "JSON no SQL Server 2025 com EF Core 11: JSON_CONTAINS e JSON_PATH_EXISTS"
summary: Quando o Contains sobre uma coleção JSON vira JSON_CONTAINS (nível de compatibilidade 170) e quando continua OPENJSON, EF.Functions.JsonContains (experimental, EF9106) e JsonPathExists, com a tabela de variações que decide o caso do parâmetro. SQL gerado offline, sem servidor.
---
## Objective

O EF Core guarda coleções como JSON há várias versões: um `List<string> Tags` vira
uma coluna com `["ef-core","sql"]`, e um complex type também pode morar em uma coluna
JSON. Consultar isso significava `OPENJSON`, que expande o array inteiro em linhas
para responder "este valor está aí dentro?". O SQL Server 2025 acrescentou
`JSON_CONTAINS`, e o EF Core 11 o usa de duas formas: automaticamente, no `Contains`
do LINQ que você já escreve, e de forma explícita, por `EF.Functions.JsonContains` e
`EF.Functions.JsonPathExists`.

A parte que decide se você se beneficia não é a função, é *quando* o EF a escolhe.
Este concept mostra as condições exatas, achadas gerando o SQL de cada variação no EF
Core 11.0.0. Todo o SQL aqui foi gerado offline com `ToQueryString()`, sem servidor,
então prova a tradução e não diz nada sobre velocidade nem sobre o que um servidor
devolve. O lado do armazenamento (colunas JSON, complex types, índices JSON) está em
`json-columns-and-complex-types`.

## Use Cases

- Filtrar linhas por uma tag, papel ou permissão guardada em um array JSON.
- Perguntar se uma propriedade opcional existe em um documento JSON.
- Consultar um documento JSON mapeado para um complex type.
- Escrever um filtro JSON que o índice JSON do SQL Server 2025 possa atender.

## Deep Dive

### Contains sobre uma coleção JSON, antes e depois

O modelo é comum. `Tags` e `Scores` são coleções primitivas, e `Contact` é um complex
type mapeado para uma coluna JSON:

```csharp
public class Blog
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<string> Tags { get; set; } = new();
    public List<int> Scores { get; set; } = new();
    public string? JsonData { get; set; }
    public Contact Contact { get; set; } = new();
}
public class Contact { public string City { get; set; } = ""; public List<string> Phones { get; set; } = new(); }

modelBuilder.Entity<Blog>().ComplexProperty(b => b.Contact, c => c.ToJson());
```

A mesma consulta é traduzida conforme o nível de compatibilidade do SQL Server que você
configura. Em 160, que é o padrão do EF Core 11:

```csharp
db.Blogs.Where(b => b.Tags.Contains("ef-core"));
```

```sql
WHERE N'ef-core' IN (
    SELECT [t].[value]
    FROM OPENJSON([b].[Tags]) WITH ([value] nvarchar(max) '$') AS [t]
)
```

Em 170, que é o SQL Server 2025 (`o.UseSqlServer(cs, s => s.UseCompatibilityLevel(170))`):

```sql
WHERE JSON_CONTAINS([b].[Tags], N'ef-core') = 1
```

A mesma troca vale para `List<int>` (`JSON_CONTAINS([b].[Scores], 5) = 1`) e para uma
coleção dentro de um complex type JSON:

```sql
-- compat 160
WHERE N'123' IN (SELECT [p].[value] FROM OPENJSON(JSON_QUERY([b].[Contact], '$.Phones')) WITH ([value] nvarchar(max) '$') AS [p])
-- compat 170
WHERE JSON_CONTAINS(JSON_QUERY([b].[Contact], '$.Phones'), N'123') = 1
```

A forma nova não desmonta o array, e a documentação observa que ela pode usar um
índice JSON quando existe. Se o otimizador de fato usa é uma pergunta para o plano de
execução em um servidor real, que uma execução offline não responde.

### A pegadinha: um parâmetro mantém a tradução antiga

`JSON_CONTAINS` não consegue procurar um `NULL` do SQL. Então o EF só o usa quando
consegue afirmar que o valor procurado, ou os elementos da coleção, não podem ser
nulos. Todo o resto cai para `OPENJSON`. No nível de compatibilidade 170, cada
variação deu:

| O valor procurado | Tradução |
|---|---|
| uma constante: `Tags.Contains("ef-core")` | `JSON_CONTAINS` |
| uma variável local: `Tags.Contains(tag)` | `OPENJSON` |
| uma coluna obrigatória: `Tags.Contains(b.Name)` | `JSON_CONTAINS([b].[Tags], [b].[Name]) = 1` |
| uma coluna anulável: `Tags.Contains(b.Nick)` | `OPENJSON` |
| uma constante em `List<string?>` | `JSON_CONTAINS` |
| `MaybeTags.Contains(null)` | `EXISTS (... OPENJSON ... WHERE [m].[value] IS NULL)` |

A linha da variável é a que importa na prática. Uma caixa de busca, um parâmetro de
API ou um argumento de método chegam ao EF como um parâmetro cujo valor só se conhece
quando a consulta roda, então a consulta é traduzida uma vez para todos os valores
possíveis, e `NULL` é um deles. Declarar a variável como `string` não anulável não
mudou isso, e envolvê-la em `EF.Constant(tag)` embutiu o literal mas ainda produziu
`OPENJSON`. Então o ganho "de graça" cobre constantes e colunas obrigatórias, e não o
valor típico vindo do usuário. Para esse caso há uma saída.

### EF.Functions.JsonContains

Quando você mesmo chama a função, você escolhe a forma e o EF não questiona a
anulabilidade:

```csharp
// um valor em um caminho
db.Blogs.Where(b => EF.Functions.JsonContains(b.JsonData!, 8, "$.Rating") == 1);

// um parâmetro contra uma coleção primitiva, que o Contains não traduziria
db.Blogs.Where(b => EF.Functions.JsonContains(b.Tags, tag) == 1);
```

```sql
WHERE JSON_CONTAINS([b].[JsonData], 8, N'$.Rating') = 1
WHERE JSON_CONTAINS([b].[Tags], @tag) = 1
```

Os argumentos são o JSON, o valor a procurar, um caminho opcional (`"$.Rating"`) e um
modo de busca opcional, repassado como `int?` (`..., N'$.tag', 1)`). A função devolve
um `int`, então a comparação com `1` fica por sua conta. Três coisas de quando foi
executada:

- É uma API **experimental**. O compilador reporta **EF9106** até você suprimir, o que
  é um aviso de que a assinatura pode mudar.
- **Não é limitada pelo nível de compatibilidade.** No nível 160 o EF gerou
  `JSON_CONTAINS` do mesmo jeito, então contra um servidor mais velho que 2025 a
  consulta compila e depois falha em tempo de execução.
- Como `JSON_CONTAINS` não encontra `NULL`, uma chamada que passa um valor `null` não
  significa "contém um nulo". Trate esse caso no seu código.

### EF.Functions.JsonPathExists

`JsonPathExists` pergunta se um caminho está presente em um documento JSON, o que é
uma pergunta diferente de o valor naquele caminho ser algo específico:

```csharp
db.Blogs.Where(b => EF.Functions.JsonPathExists(b.JsonData!, "$.OptionalInt"));
db.Blogs.Where(b => EF.Functions.JsonPathExists(b.Contact, "$.City"));
```

```sql
WHERE JSON_PATH_EXISTS([b].[JsonData], N'$.OptionalInt') = 1
WHERE JSON_PATH_EXISTS([b].[Contact], N'$.City') = 1
```

Ela devolve um `bool`, então sem `== 1`, e aceita uma coluna string com JSON e também
um complex type mapeado para JSON. Não é marcada como experimental: o mesmo projeto
compilou sem suprimir nenhum diagnóstico quando só `JsonPathExists` era usada.
`JSON_PATH_EXISTS` está no SQL Server desde 2022, segundo a documentação, então
funciona no nível padrão. Como um `null` JSON no caminho é tratado é um detalhe do SQL
Server para ler na documentação dele, e não foi executado aqui.

## Trade-offs

- **O nível de compatibilidade é a sua promessa sobre o servidor.** O EF não detecta a
  versão. Configure 170 só quando todo ambiente roda SQL Server 2025 ou Azure SQL com
  o recurso, incluindo o banco do CI. Um nível errado quebra em tempo de execução ou
  mantém em silêncio o SQL mais lento. Fixe-o explicitamente, como o concept de
  upgrade aconselha.
- **A maior parte do ganho exige uma constante ou uma coluna obrigatória.** Para um
  valor vindo do usuário você escolhe entre `OPENJSON` (portável, qualquer valor) e um
  `JsonContains` explícito (SQL mais curto, API experimental, tratamento de nulo por
  sua conta). Meça com um índice JSON no lugar antes de decidir que importa.
- **Duas traduções podem discordar sobre `NULL`.** `Contains(null)` passa por
  `OPENJSON` e encontra nulos JSON, enquanto `JSON_CONTAINS` não. Por isso o EF recusa o
  caminho rápido quando não tem certeza, e por isso uma chamada escrita à mão pede
  cuidado.
- **Um array JSON ainda não é uma tabela de junção.** Para um filtro quente em "linhas
  que têm a tag X" sobre uma tabela grande, uma tabela filha com um índice comum
  continua sendo o desenho mais previsível. `JSON_CONTAINS` com um índice JSON
  diminui a distância, mas é um recurso novo do SQL Server 2025 e o índice é uma
  adição recente ao EF.
- **SQL offline prova tradução, não velocidade.** Confira o plano e o tempo em um SQL
  Server 2025 real antes de mover uma consulta para a forma nova.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [JSON_CONTAINS, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/json-contains-transact-sql) (doc)
- [JSON_PATH_EXISTS, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/json-path-exists-transact-sql) (doc)
- [CREATE JSON INDEX, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-json-index-transact-sql) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
