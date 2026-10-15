---
version: 1.0
updatedAt: 2026-10-15
title: "Nullable reference types e análise de fluxo"
summary: NRT como anotação e não como tipo (metadados e NullabilityInfoContext), os estados not-null e maybe-null e onde a análise de fluxo é propositalmente otimista, o operador !, os atributos de contrato (MaybeNullWhen, NotNullIfNotNull, MemberNotNull e cia.), T? em generics e notnull, nulls vindos de fora (RespectNullableAnnotations, EF Core), estratégia de migração e Nullable<T> com operadores lifted e boxing.
---
## Objective

Nullable reference types (NRT, C# 8) deixam você dizer quais referências podem
ser `null` (`string?`) e quais não podem (`string`), e o compilador passa a
acompanhar um estado de nulidade para cada expressão e a avisar quando os dois
não batem. É uma análise estática, não uma mudança no sistema de tipos: o
runtime nunca vê a diferença. Este conceito mostra onde a anotação fica nos
metadados, como funciona a análise de fluxo not-null / maybe-null e onde ela é
propositalmente furada, os atributos que descrevem contratos que o `?` não
consegue expressar, o que `T?` significa num genérico sem constraint, o que
ainda precisa ser checado em runtime e como o `Nullable<T>` (o `int?` de value
type) é diferente.

## Use Cases

- Deixar "isto pode faltar" visível na assinatura em vez de num comentário.
- Transformar um `NullReferenceException` achado em produção num warning
  achado no build.
- Escrever helpers `TryGet`, `Normalize` ou `Initialize` cujos chamadores
  recebem os warnings certos sem precisar de `!`.
- Migrar um código legado arquivo por arquivo.
- Ler colunas `int?` do banco e fazer contas com elas.

## Deep Dive

### Uma anotação, não um tipo

`string` e `string?` são o mesmo `System.String` em runtime. O compilador
registra a anotação em atributos, que o ilspy mostra no método compilado:

```csharp
public static string? Find(string key) => key == "x" ? "found" : null;
// descompilado: [NullableContext(1)] na classe, [return: Nullable(2)] em Find
// (1 = sem anotação, 2 = anotado)

var m = typeof(Api).GetMethod(nameof(Api.Find))!;
Console.WriteLine($"{m.ReturnType} {m.GetParameters()[0].ParameterType}"); // System.String System.String
var ctx = new NullabilityInfoContext();
// ctx.Create(m.ReturnParameter).ReadState -> Nullable, WriteState do parâmetro -> NotNull
```

Nada é imposto. `Api.Length(null!)` compila e lança `NullReferenceException`
lá dentro; chamar `Echo(string s)` por reflection com `null` simplesmente
passa `null`. APIs públicas continuam precisando de guard clauses
(`ArgumentNullException.ThrowIfNull`, veja o conceito de guard clauses),
porque quem chama pode estar com NRT desligado, usar reflection ou
desserializar dados.

O recurso é ligado por `<Nullable>enable</Nullable>` (os templates atuais e os
file-based apps já fazem isso) ou por região com `#nullable enable`, `disable`
e `restore`. A configuração tem duas chaves: `annotations` (o `?` passa a ter
significado) e `warnings` (a análise reporta). Referências declaradas com
annotations desligado são "nullable-oblivious": o compilador nem confia nem
desconfia delas.

### Estado de nulidade e análise de fluxo

Toda expressão é not-null ou maybe-null. Uma variável não anulável começa
not-null, uma anulável começa maybe-null, e atribuições e checagens mudam o
estado:

```csharp
string? maybe = Api.Find("y");
Console.WriteLine(maybe.Length);   // warning CS8602: Dereference of a possibly null reference.
Api.Length(maybe);                 // sem warning: depois do CS8602 o estado vira not-null
if (maybe is null) return;
Console.WriteLine(maybe.Length);   // sem warning: a checagem provou
string s = null;                   // warning CS8600: Converting null literal or possible null value to non-nullable type.
```

A segunda linha merece atenção: depois de avisar uma vez, o compilador assume
que o valor não é null, para não gerar uma cascata de warnings sobre o mesmo
problema. `is null`, `is not null`, `== null`, `?.`, `??`, `is { }` e
patterns alimentam a análise. Outros diagnósticos comuns: CS8603 (retorno
possivelmente null), CS8604 (argumento possivelmente null), CS8618 (campo não
anulável não preenchido pelo construtor), CS8625 (literal null para tipo não
anulável).

### Onde ela é propositalmente furada

A análise não olha dentro dos métodos que você chama. Uma checagem num campo
continua "provada" mesmo que uma chamada no meio volte o campo para `null`:

```csharp
class Cache
{
    private string? _name = "cached";
    private void Reset() => _name = null;
    public int UnsafeLength()
    {
        if (_name is not null)
        {
            Reset();
            return _name.Length;   // sem warning, NullReferenceException em runtime
        }
        return 0;
    }
}
```

Copie o campo para uma variável local antes de checar. A documentação oficial
lista outros buracos conhecidos: o `default` de uma struct com campos não
anuláveis, e `new string[3]`, cujos elementos são `null` sem nenhum warning.

### `!`: o operador null-forgiving

`maybe!` muda o estado para not-null e não gera nada no código. É uma promessa
ao compilador, então cada `!` é um ponto onde a análise deixa de proteger
você. `null!` e `default!` às vezes aparecem em campos preenchidos por um
framework depois da construção, mas `required`, um parâmetro de construtor ou
`[MemberNotNull]` são melhores porque mantêm a checagem.

### Atributos para contratos que o `?` não expressa

Os atributos de `System.Diagnostics.CodeAnalysis` descrevem contratos
condicionais:

| Atributo | Significado |
|---|---|
| `[AllowNull]` / `[DisallowNull]` | a entrada pode / não pode ser null, seja qual for o tipo |
| `[MaybeNull]` / `[NotNull]` | a saída pode ser null / não é null depois da chamada |
| `[NotNullWhen(bool)]` / `[MaybeNullWhen(bool)]` | depende do `bool` que o método devolve |
| `[NotNullIfNotNull(name)]` | o retorno não é null quando aquele argumento não é null |
| `[MemberNotNull(names)]` / `[MemberNotNullWhen]` | o método inicializa esses membros |
| `[DoesNotReturn]` / `[DoesNotReturnIf(bool)]` | o código depois da chamada é inalcançável |

Três deles em uso, cada um conferido removendo o atributo e vendo o warning
voltar:

```csharp
public static bool TryGet<TKey, TValue>(Dictionary<TKey, TValue> d, TKey key,
    [MaybeNullWhen(false)] out TValue value) where TKey : notnull => d.TryGetValue(key, out value);
// if (TryGet(map, "ana", out var c)) c.Name   -> sem warning
// if (!TryGet(map, "x", out var c)) c.Name    -> warning CS8602

[return: NotNullIfNotNull(nameof(input))]
public static string? Normalize(string? input) => input?.Trim();
// string r = Normalize("  Bia ");  -> sem warning; sem o atributo, CS8600

class Service
{
    private string? _connection;
    [MemberNotNull(nameof(_connection))]
    public void Connect() => _connection = "db-1";
    public int Use() { Connect(); return _connection.Length; } // sem warning; sem o atributo, CS8602
}
```

A mesma versão de `TryGet` sem o atributo compilou com um warning CS8601
dentro do método e nenhum warning no ponto de chamada, ou seja, quem chamava
ouvia que o valor era seguro mesmo quando o método devolvia `false`. Os
atributos levam a verdade para onde o chamador consegue usá-la.
`[NotNullWhen(true)]` em métodos Try e `[DoesNotReturn]` em throw helpers
estão nos conceitos de parsing e de guard clauses.

### `T?` em generics e `notnull`

Para um `T` sem constraint, `T?` significa "o default de `T` é possível", e
não `Nullable<T>`:

```csharp
public static T? FirstOrNone<T>(IReadOnlyList<T> items) => items.Count > 0 ? items[0] : default;
// FirstOrNone<int>([]) = 0, FirstOrNone<string>([]) = null
public static T Unconstrained<T>() => default;   // warning CS8603: Possible null reference return.
```

Com `int` o resultado é `0`, não `null`: um `T?` só vira `Nullable<T>` sob a
constraint `struct`. A constraint `notnull` vai no sentido contrário e rejeita
argumentos anuláveis, por isso `new Dictionary<string?, int>()` dá warning
CS8714 ("Nullability of type argument 'string?' doesn't match 'notnull'
constraint").

### Nulls que vêm de fora

Dados de fora não passam pela análise. O `System.Text.Json` ignora as
anotações por padrão; desde o .NET 9, `RespectNullableAnnotations` faz ele
respeitá-las:

```csharp
record Customer(string Name);
JsonSerializer.Deserialize<Customer>("""{"Name":null}""");   // Name = null aceito
JsonSerializer.Deserialize<Customer>("""{"Name":null}""",
    new JsonSerializerOptions { RespectNullableAnnotations = true });
// JsonException: The constructor parameter 'Name' on type 'Customer' doesn't allow null values. ...
```

A documentação lista os limites: uma propriedade ausente continua aceita, e
membros genéricos e elementos de coleção não são checados. O EF Core lê as
mesmas anotações para decidir se uma coluna é obrigatória (`string`) ou
opcional (`string?`), então ligar NRT num modelo existente pode mudar uma
migration.

### Migrando um código existente

O guia de migração sugere escolher um padrão e avançar arquivo por arquivo:
ou ligar o projeto e pôr `#nullable disable` nos arquivos ainda não migrados,
ou manter desligado e pôr `#nullable enable` nos já migrados. Começar com
`<Nullable>warnings</Nullable>` mostra por onde o `null` passa sem obrigar a
anotar ainda. Quando o projeto estiver limpo,
`<WarningsAsErrors>nullable</WarningsAsErrors>` mantém ele limpo.

### `Nullable<T>` em resumo

`int?` é outra coisa: `Nullable<int>`, uma struct com `HasValue` e `Value`.
Os operadores são lifted, e comparações com `null` dão falso nos dois
sentidos:

```csharp
int? a = 5, none = null;
// a + 1 = 6, none + 1 = null, none < 5 False, none >= 5 False, none == null True
bool? t = true, f = false, u = null;
// u & f = False, u | t = True, u & t = null, u | f = null
object boxed = a;          // faz boxing do int: boxed.GetType() é System.Int32
object? boxedNull = none;  // boxing de um int? vazio dá um null de verdade
// a.GetType() também é System.Int32; (int?)boxed faz o unboxing sem problema
_ = none.Value;            // warning CS8629, depois InvalidOperationException: Nullable object must have a value.
```

Não existe `Nullable<int>` em boxing: o runtime faz boxing do valor de baixo ou
produz `null`, por isso `GetType()` nunca informa `Nullable`.
`GetValueOrDefault()` (0 aqui) evita a exceção.

## Trade-offs

- **Warnings, não garantias.** Mantenha guard clauses nas portas de entrada
  públicas e valide dados desserializados.
- **A análise é otimista com campos.** Ela não verifica de novo depois de
  chamadas de método; copie campos para locais antes de confiar numa checagem.
- **O `!` cala a única ferramenta que você ligou.** Prefira `required`,
  parâmetros de construtor ou atributos.
  ```csharp
  public required string Name { get; init; }   // em vez de public string Name { get; set; } = null!;
  ```
- **Atributos fazem parte da API.** Um `[NotNullWhen(true)]` errado é pior que
  nenhum: quem chama perde warnings de que precisava.
- **Migrar leva tempo.** O `#nullable` por arquivo permite andar aos poucos;
  ligar tudo de uma vez costuma terminar numa pilha de `!`.

## Documentation Links

- [Nullable reference types, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/null-safety/nullable-reference-types) (doc)
- [Nullable reference types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-reference-types) (doc)
- [Attributes for null-state static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [Resolve nullable warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/nullable-warnings) (doc)
- [Nullable migration strategies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/update-applications/nullable-migration-strategies) (doc)
- [Nullable value types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-value-types) (doc)
- [Respect nullable annotations, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/nullable-annotations) (doc)
- [Working with nullable reference types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/nullable-reference-types) (doc)
