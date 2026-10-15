---
version: 1.0
updatedAt: 2026-10-15
title: "Tuplas e Desconstrução"
summary: O que uma tupla é em tempo de execução (ValueTuple, struct mutável com campos públicos, layout Auto, Rest acima de sete elementos), para onde vão os nomes dos elementos (TupleElementNames, reflexão e o {} do System.Text.Json), == versus Equals, tuplas como chave de dicionário, as formas de desconstrução, Deconstruct próprio e por extensão, o System.Tuple legado e quando um record é a escolha melhor.
---
## Objective

Uma tupla é o jeito mais barato de retornar dois ou três valores de um
método: `(int Min, int Max) MinMax(...)`. Por trás da sintaxe está o
`System.ValueTuple`, uma struct mutável cujos nomes de elemento só existem no
compilador, o que tem consequências para reflexão, JSON, igualdade e chaves de
dicionário. A desconstrução é a outra metade: `var (min, max) = MinMax(...)`
funciona em tuplas e em qualquer tipo com um método `Deconstruct`. Este
conceito mostra o que uma tupla é em tempo de execução, para onde vão os
nomes, como a igualdade funciona de verdade, as formas de desconstrução, o
`System.Tuple` legado e o ponto em que um record é a escolha melhor. Os
positional patterns, que também chamam `Deconstruct`, estão em
`property-positional-and-list-patterns`.

## Use Cases

- Retornar vários valores de um método privado ou interno sem parâmetro `out`
  nem classe descartável.
- Chaves compostas de dicionário, como `(string City, int Year)`.
- Trocar duas variáveis, ou separar um `KeyValuePair` num `foreach`.
- Tornar seus tipos desconstruíveis, inclusive tipos que não são seus.
- Decidir quando uma tupla numa assinatura deve virar record.

## Deep Dive

Saída do .NET 10 (SDK 10.0.100) em arm64.

### O que uma tupla é em tempo de execução

```csharp
(string Name, int Age) p = ("Ana", 30);

p.GetType()             // System.ValueTuple`2[System.String,System.Int32]
p.GetType().IsValueType // True
p.Name == p.Item1       // True: Name é um apelido de compilação para Item1
p.ToString()            // (Ana, 30)
typeof((string, int)).GetFields()      // Item1, Item2
typeof((string, int)).GetProperties()  // (nenhuma)
```

A documentação diz com todas as letras: tipos tupla são value types e os
elementos são campos públicos, então tuplas são value types mutáveis.
`t.X = 10` compila e altera a variável local, e copiar uma tupla copia os
valores:

```csharp
var s1 = (A: 1, B: 2);
var s2 = s1;
s2.A = 99;            // s1 = (1, 2), s2 = (99, 2)
```

Alterar por um indexador falha pelo mesmo motivo que em qualquer struct: o
indexador de `List<T>` retorna uma cópia, então `list[0].X = 5` dá CS1612
("Cannot modify the return value of 'List<(int X, int Y)>.this[int]' because it
is not a variable"). Um elemento de array é uma variável, então
`arr[0].X = 5` funciona.

Acima de sete elementos o compilador aninha: `(1, 2, 3, 4, 5, 6, 7, 8, 9)` é
um `ValueTuple`8` cujo último campo `Rest` guarda um `ValueTuple`2`.
`big.Item9` continua retornando `9`: o IL é `ldfld Rest` seguido de
`ldfld Item2`.

O `ValueTuple` é declarado com `LayoutKind.Auto` (lido por reflexão:
`typeof(ValueTuple<,>).StructLayoutAttribute.Value` é `Auto`), então o runtime
pode reordenar os campos: `Unsafe.SizeOf<(byte, long)>()` é 16 e
`Unsafe.SizeOf<(int, int)>()` é 8. Não use tupla onde o layout de memória
precisa ser fixo (interop, casts com `MemoryMarshal`).

### Para onde vão os nomes

Nome de elemento é recurso do compilador. A documentação diz que o compilador
troca os nomes pelos nomes padrão, então eles não existem em tempo de
execução. Numa assinatura de método, os nomes sobrevivem só como um atributo
que o compilador lê de volta quando outro projeto chama o método:

```csharp
static (int Min, int Max) MinMax(int[] values) => (values.Min(), values.Max());

var m = typeof(Api).GetMethod("MinMax")!;
m.ReturnType                                   // System.ValueTuple`2[System.Int32,System.Int32]
m.ReturnParameter.GetCustomAttribute<TupleElementNamesAttribute>()!.TransformNames
                                               // Min, Max
```

Tudo que funciona por reflexão enxerga `Item1` e `Item2`. O System.Text.Json
serializa propriedades públicas por padrão, e tupla não tem nenhuma:

```csharp
JsonSerializer.Serialize(MinMax([3, 1, 4]))                                       // {}
JsonSerializer.Serialize(MinMax([3, 1, 4]), new JsonSerializerOptions { IncludeFields = true })
                                                                                  // {"Item1":1,"Item2":4}
```

Nenhuma das duas saídas é o que um cliente da API espera
(`{"min":1,"max":4}`), e esse é o motivo mais forte para nunca retornar tupla
de um endpoint HTTP.

Os nomes também podem ser inferidos das variáveis que montam a tupla (C# 7.1):
`var t = (name, age);` dá `t.name` e `t.age`. Atribuir um literal com nomes
que não batem com o destino é permitido, e os nomes são descartados com aviso:

```csharp
(int A, int B) t = (B: 1, A: 2);
// warning CS8123: The tuple element name 'B' is ignored because a different name
// or no name is specified by the target type '(int A, int B)'.
// t.A = 1, t.B = 2   (vale a posição, não o nome)
```

Desde o C# 12, um alias `using` pode nomear um tipo tupla:
`using Point = (int X, int Y);`. A documentação é explícita: o alias cria um
sinônimo, não um tipo novo. `Point` continua sendo `ValueTuple<int, int>`, e
qualquer `(int, int)` converte para ele. Para segurança de tipo, a mesma
página recomenda um positional record.

### Igualdade: `==` versus `Equals`

`==` e `!=` em tuplas (C# 7.3) são compilados elemento a elemento, por
posição, ignorando nomes e com as conversões usuais em cada elemento.
`Equals` é o método do `ValueTuple`, que exige o mesmo tipo de tupla:

```csharp
(int, string) a = (1, "x");
(long, string) b = (1L, "x");
a == b                      // True: 1 == 1L depois da conversão
a.Equals(b)                 // False: ValueTuple<int,string> vs ValueTuple<long,string>

var t1 = (A: 5, B: 10);
var t2 = (B: 5, A: 10);
t1 == t2                    // True: nomes ignorados, posições comparadas
```

A documentação acrescenta que todos os elementos dos dois lados são avaliados
antes da comparação, que depois para na primeira diferença.

`Equals` e `GetHashCode` combinam os elementos com
`EqualityComparer<T>.Default`, então a tupla é uma chave composta correta sem
escrever tipo nenhum:

```csharp
var visits = new Dictionary<(string City, int Year), int> { [("Lisbon", 2026)] = 7 };
visits[("Lisbon", 2026)]    // 7
```

Cada elemento precisa ter igualdade por valor para isso valer. Uma tupla que
contém uma `List<T>` compara a lista por referência:
`(1, list).Equals((1, new List<int> { 1 }))` é `False` mesmo com o mesmo
conteúdo (`dictionary-hashset-and-equality` cobre as regras).

### Desconstrução

```csharp
var (lo, hi) = MinMax([5, 2, 9]);      // lo = 2, hi = 9
(x, y) = (y, x);                        // troca sem variável temporária
(existing, var fresh) = (7, 8);         // C# 10: atribuir e declarar na mesma desconstrução
var (_, onlyHi) = MinMax([1, 2]);       // descarte do que não interessa

foreach (var (k, v) in dictionary)      // KeyValuePair tem um método Deconstruct
    Console.WriteLine($"{k}={v}");
```

Qualquer tipo vira desconstruível com um método `void Deconstruct` que
devolve cada componente por um parâmetro `out`. Sobrecargas precisam diferir
na quantidade de parâmetros `out`, senão a chamada fica ambígua. Pode ser
método de instância, ou método de extensão para tipos que você não pode
alterar:

```csharp
class Person(string first, string last)
{
    public void Deconstruct(out string First, out string Last) { First = first; Last = last; }
}

static class UriExt
{
    public static void Deconstruct(this Uri u, out string host, out int port) { host = u.Host; port = u.Port; }
}

var (first, last) = new Person("Ada", "Lovelace");          // Ada Lovelace
var (host, port) = new Uri("https://example.com:8443/x");   // example.com 8443
```

Positional records geram o `Deconstruct` a partir do construtor primário
(`records-and-with-expressions` mostra o membro gerado), então
`var (name, age) = new Rec("Cy", 40);` funciona sem código nenhum.

### `System.Tuple`, o legado

`Tuple.Create("Ana", 30)` cria um `System.Tuple<string, int>`, que é uma
classe, imutável, com propriedades `Item1`/`Item2` em vez de campos. Ele é
anterior à sintaxe de tuplas, não tem nomes de elemento e aloca a cada
criação. Ainda aparece em APIs antigas; `ToValueTuple()` converte, e código
novo não tem motivo para criar um.

## Trade-offs

- **Tupla versus record em valores de retorno.** Uma tupla não custa nada
  para declarar nem para alocar. Um record tem nome, sobrevive a reflexão e
  JSON, e pode carregar validação e comportamento. O conselho da documentação
  serve: tuplas para dados pouco relacionados, classe ou struct (um record) em
  APIs públicas.
- **Tupla versus parâmetros `out`.** Um retorno em tupla combina com `var` e
  desconstrução e funciona em métodos `async`, onde `out` não é permitido
  (CS1988). `TryX(out T)` continua melhor quando o método responde primeiro a
  uma pergunta de sim ou não (`method-parameters-optional-named-and-ref-kinds`
  compara os dois).
- **Chave composta como tupla ou como tipo.** `(string, int)` é uma chave de
  dicionário correta na hora. Um `readonly record struct` dá a mesma
  igualdade mais um nome que o resto do código consegue procurar, o que
  importa quando a chave aparece em mais de uma classe.
- **Nomes dão uma falsa sensação de segurança.** `(int Min, int Max)` e
  `(int Width, int Height)` são o mesmo tipo e convertem em silêncio nos dois
  sentidos. Se trocar um pelo outro seria bug, o dado merece um tipo próprio.
- **Campos mutáveis.** Alterar `t.X` é prático numa variável local, mas uma
  tupla num campo `readonly` (CS1648) ou atrás de um indexador de `List<T>`
  (CS1612) não pode ser alterada no lugar. Trate tuplas como valores e
  atribua uma nova.

## Documentation Links

- [Tuple types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples) (doc)
- [Deconstructing tuples and other types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/deconstruct) (doc)
- [Choosing between anonymous and tuple types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/choosing-between-anonymous-and-tuple) (doc)
- [TupleElementNamesAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.tupleelementnamesattribute) (doc)
- [ValueTuple struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetuple) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
