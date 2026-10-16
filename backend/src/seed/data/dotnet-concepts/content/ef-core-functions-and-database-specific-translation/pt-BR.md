---
version: 1.0
updatedAt: 2026-10-16
title: "EF.Functions e a Tradução Específica de Cada Banco"
summary: Como um método .NET vira SQL, LIKE, Collate e Random rodados no SQLite com o SQL real, wildcards em entrada do usuário, Single versus First, funções específicas de cada provider e como mapear a sua própria.
---
## Objective

Uma consulta LINQ só roda no banco se todo método dentro dela tem uma tradução SQL
conhecida. A maioria tem, porque o EF Core mapeia um conjunto grande de membros de
`string`, `Math` e `DateTime` para cada provider. Para o resto, o EF Core oferece
`EF.Functions`, um catálogo de métodos que existem só para virar SQL (`Like`, `Random`,
`Collate`, `DateDiffDay` e assim por diante), e uma forma de mapear seus próprios
métodos para funções do banco. Este conceito explica como essa tradução funciona,
roda as funções mais comuns no SQLite para ver o SQL e as surpresas (diferença entre
maiúsculas e minúsculas, wildcards em entrada do usuário) e mostra como separar
tradução portável de tradução específica de provider antes que ela cause problema em
produção.

## Use Cases

- Uma caixa de busca que deve achar parte do nome de um produto.
- Um quiz ou uma amostragem que precisa de poucas linhas aleatórias.
- Um relatório que precisa de `DATEDIFF` ou de busca full-text, que o LINQ não tem como
  operador.
- Migrar um código que usa SQLite nos testes para SQL Server ou PostgreSQL em produção
  e querer saber quais consultas vão mudar de comportamento.

## Deep Dive

### Um método sem corpo

`EF.Functions` devolve uma instância de `DbFunctions`, e os métodos pendurados nela
são extension methods que só um provider de banco sabe interpretar. Eles não têm
implementação em .NET. As observações oficiais de `Like` e `Random` dizem que não há
implementação em memória e que a chamada lança exceção se a consulta passar para
avaliação no cliente. Reproduzi chamando `EF.Functions.Like` depois de
`AsEnumerable()`:

```
InvalidOperationException: The 'Like' method is not supported because the query has
switched to client-evaluation. ...
```

Isso dá um bom modelo mental. A consulta é traduzida até onde o EF Core consegue ir. Um
método que ele não reconhece dentro do `Where` faz a consulta inteira falhar com
`could not be translated`. O mesmo método desconhecido no último `Select` é permitido,
porque o banco pode devolver as colunas simples e o .NET aplica o método depois:

```csharp
db.Products.Where(p => Helpers.Slug(p.Name) == "chai")   // lança: não traduzível
db.Products.Select(p => Helpers.Slug(p.Name))            // o SQL seleciona só "Name"
```

A segunda consulta registrou `SELECT "p"."Name" FROM "Products" AS "p"` e depois rodou
`Slug` em cada valor na memória. Funciona, mas leva o custo do filtro para o seu
processo, então vale perceber quando isso acontece.

### LIKE e as outras formas de comparar texto

Todos os dados abaixo vêm de um banco SQLite com um produto chamado `Chai`. A mesma
pergunta, escrita de cinco jeitos, dá respostas diferentes:

```csharp
Where(p => p.Name == "CHAI")                              // nenhuma linha
Where(p => EF.Functions.Like(p.Name, "CHAI"))             // Chai
Where(p => p.Name.Contains("HAI"))                        // nenhuma linha
Where(p => p.Name.StartsWith("CH"))                       // Chai, Chef Anton's ...
Where(p => EF.Functions.Collate(p.Name, "NOCASE") == "chai")  // Chai
```
```sql
WHERE "p"."Name" = 'CHAI'
WHERE "p"."Name" LIKE 'CHAI'
WHERE instr("p"."Name", 'HAI') > 0
WHERE "p"."Name" LIKE 'CH%'
WHERE "p"."Name" COLLATE NOCASE = 'chai'
```

No SQLite, `==` e `Contains` (traduzido para `instr`) diferenciam maiúsculas de
minúsculas, enquanto `LIKE` e `StartsWith` (traduzido para `LIKE 'CH%'`) não, mas só
para ASCII: `Like(p.Name, "GUMBÄR%")` não encontrou `Gumbär Gummibärchen`. A observação
da API de `Like` diz o mesmo em termos gerais: a sensibilidade a maiúsculas depende da
configuração do banco. No SQL Server o resultado depende da collation da coluna, e o
`LIKE` do PostgreSQL diferencia maiúsculas, que é a razão de o provider Npgsql ter
`EF.Functions.ILike`. Uma suíte de testes em SQLite, portanto, prova pouco sobre
comparação de texto em outro motor. Quando você precisa de uma regra independente dos
padrões, declare-a: `EF.Functions.Collate(...)` ou uma comparação explícita com
`ToLower()`.

### Wildcards na entrada do usuário

`Like` recebe um padrão, e os caracteres `%`, `_`, `[`, `]` e `^` podem funcionar como
wildcards (o conjunto exato varia conforme o banco). Se o padrão vem de um usuário, o
usuário controla os wildcards. Isso não é SQL injection, porque o valor continua
viajando como parâmetro (`LIKE @Format`), mas muda o resultado:

```csharp
var input = "50%";
Where(p => EF.Functions.Like(p.Name, $"%{input}%"))
// @Format '%50%%'  =>  "50% Off Tea" e "500 Tea Bags"
```

O sinal de porcentagem casou com a segunda linha. Escape a entrada e passe um caractere
de escape:

```csharp
var escaped = input.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
Where(p => EF.Functions.Like(p.Name, $"%{escaped}%", "\\"))
// @Format '%50\%%' ESCAPE '\'  =>  "50% Off Tea"
```

Uma entrada `_` se comportou do mesmo jeito: `Tea{u}X` com `u = "_"` casou com `Tea_X` e
com `TeaZX`. O formato do padrão também importa para a velocidade. Na maioria dos
motores, um padrão com wildcard à esquerda (`%che%`) não consegue usar um índice
comum, enquanto um padrão por prefixo (`che%`) consegue, então uma busca "contém" numa
tabela grande normalmente pede busca full-text.

Também aparece na saída: o EF Core 10 nomeia o parâmetro pelo argumento (`@Format`),
e não `@__Format_1` como mostram logs e livros mais antigos, porque a versão
simplificou os nomes de parâmetros.

### Linhas aleatórias

`EF.Functions.Random()` existe desde o EF Core 6 e devolve um double entre 0 e 1,
exclusivo. No SQLite virou:

```sql
ORDER BY abs(random() / 9.2233720368547799E+18)
LIMIT @p
```

A página do provider SQL Server mapeia para `RAND()`, e a do Npgsql para `random()`.
Ordenar por um valor aleatório lê e ordena todas as linhas para devolver poucas, então
serve para tabelas pequenas, testes e amostragem, não para um caminho quente com
milhões de linhas. A forma de filtro `Where(p => EF.Functions.Random() > 0.5)` mantém
mais ou menos metade das linhas, uma metade diferente a cada execução.

### Single, First e o SQL que cada um pede

O livro também trata de obter uma única entidade. Logar os três comandos mostrou a
diferença:

```sql
-- Single           ... WHERE "p"."Id" = 1  LIMIT 2
-- First            ... WHERE "p"."Id" = 1  LIMIT 1
-- SingleOrDefault  ... WHERE "p"."Id" = 1  LIMIT 2
```

`Single` pede duas linhas para poder detectar duplicidade e lançar exceção. Se você não
precisa dessa garantia, `First` lê uma só.

### Tradução portável versus funções específicas de provider

As páginas de funções de cada provider são a fonte da verdade. Alguns exemplos delas: a
página do SQLite lista `EF.Functions.Glob`, `Collate` e `Regex.IsMatch` (para `REGEXP`,
que funcionou no meu teste); a do SQL Server lista `Contains` e `FreeText` (busca
full-text), de `DateDiffDay` a `DateDiffYear`, `IsDate`, `IsNumeric` e `AtTimeZone`; o
provider do Cosmos tem um conjunto próprio, e nele `EF.Functions.Like` simplesmente não é
traduzido (o outro conceito sobre NoSQL mostra a falha). Cada lista cresce por versão.
O EF Core 10 acrescentou, por exemplo, `DateOnly.DayNumber` e as partes de microssegundo
e nanossegundo, então consulte a página do seu provider antes de escrever uma
gambiarra.

Quando não existe tradução, você tem uma escada: reescrever a consulta com um operador
que traduz, mapear o seu próprio método ou escrever SQL.

```csharp
// mapeia um método CLR para uma função nativa do banco
public static int Instr(string text, string search) => throw new NotSupportedException();
modelBuilder.HasDbFunction(typeof(Db).GetMethod(nameof(Instr))!).HasName("instr").IsBuiltIn();
// Where(p => Db.Instr(p.Name, "Tea") > 0)  =>  WHERE instr("p"."Name", 'Tea') > 0
```

`IsBuiltIn()` importa no SQL Server, que exige que funções definidas pelo usuário sejam
qualificadas por schema e as nativas não. O mesmo mecanismo mapeia uma função escalar
sua, e um método que devolve `IQueryable<T>` pode mapear para uma função com valor de
tabela. `HasTranslation` deixa você montar a árvore de expressão SQL na mão, mas a
documentação avisa que é uma API de baixo nível, amarrada ao provider.

## Trade-offs

- **Uma função que traduz em um provider pode não traduzir em outro.** Rodar os testes
  em um motor diferente do de produção esconde lacunas de tradução, então rode contra o
  motor real as consultas que usam `EF.Functions`.
  ```csharp
  EF.Functions.Like(p.Name, "Tea%")   // ok no SQLite e no SQL Server, não no Cosmos
  ```
- **LIKE é uma linguagem de padrões, não um teste de substring.** Entrada sem escape
  muda o que casa, então faça o escape ou use `Contains` para busca de substring simples.
  ```csharp
  EF.Functions.Like(p.Name, $"%{escaped}%", "\\")
  ```
- **Diferença entre maiúsculas e minúsculas é configuração do banco.** O mesmo
  predicado devolve linhas diferentes conforme a collation, então declare a regra que
  você quer.
  ```csharp
  EF.Functions.Collate(p.Name, "NOCASE") == "chai"   // SQLite
  ```
- **Avaliação no cliente no último `Select` é silenciosa.** Está correta, mas leva
  trabalho para a memória; inspecione o SQL para ver o que ficou de fora.
- **Código específico de provider prende você.** `FreeText` ou `DateDiffDay` só existem
  no SQL Server, então isole essas consultas atrás de um repositório ou de uma classe de
  consultas.
- **Ordem aleatória é varredura completa.** Boa para uma tabela de quiz, errada para
  uma tabela grande.
- **Não executado aqui.** Só o SQLite foi executado. Os mapeamentos de SQL Server,
  PostgreSQL e Cosmos citados vêm das páginas oficiais dos providers.

## Documentation Links

- [Function mappings, SQLite provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/functions) (doc)
- [Function mappings, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/functions) (doc)
- [User-defined function mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/user-defined-function-mapping) (doc)
- [DbFunctionsExtensions.Like, API reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.dbfunctionsextensions.like) (doc)
- [DbFunctionsExtensions.Random, API reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.dbfunctionsextensions.random) (doc)
- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Translations, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/mapping/translations.html) (doc)
