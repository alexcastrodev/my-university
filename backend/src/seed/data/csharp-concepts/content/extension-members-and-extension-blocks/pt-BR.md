---
version: 1.0
updatedAt: 2026-10-15
title: "Extension members e extension blocks (C# 14)"
summary: Os blocos extension(Tipo receptor) do C# 14 com métodos e propriedades de instância, métodos e propriedades estáticos e operadores, blocos genéricos, receptores null e ref, o que o compilador emite (tipos de agrupamento e marcadores lidos com ilspy), teste de compatibilidade binária com a sintaxe this, ambiguidade e como resolvê-la, e o que não é permitido com os erros reais do compilador.
---
## Objective

Desde o C# 3, extension methods permitem acrescentar métodos com cara de
instância a um tipo que não é seu, por meio de um método estático cujo
primeiro parâmetro leva `this`. O C# 14 generaliza a ideia com extension
blocks: `extension(Tipo receptor) { ... }` dentro de uma classe estática pode
declarar métodos de instância, propriedades de instância, métodos estáticos,
propriedades estáticas e operadores, e quem chama usa tudo isso como se o
próprio tipo tivesse declarado. Este conceito mostra cada tipo de membro
rodando no SDK do .NET 10, blocos genéricos, receptores `null` e `ref`, o que o
compilador emite nos metadados (lido com ilspy), um teste de compatibilidade
binária entre a sintaxe antiga e a nova, como a ambiguidade é resolvida e o
que o recurso não permite, com os erros reais do compilador.

## Use Cases

- `sequence.IsEmpty` como propriedade em todo `IEnumerable<T>`, em vez de um
  método que finge ser propriedade.
- "Factories estáticas" em tipos que você não controla, como `Money.Zero`, e
  helpers em classes estáticas como `Math`.
- Operadores para um tipo de terceiros, por exemplo `+` para concatenar
  sequências.
- Migrar os extension methods `this` de uma biblioteca para a sintaxe nova sem
  quebrar quem já está compilado contra ela.
- Agrupar todas as extensões de um receptor num bloco só, em vez de repetir
  `this IEnumerable<T> source` em cada método.

## Deep Dive

### O bloco e os tipos de membro

Um extension block mora numa classe estática de nível superior e não
genérica. O parâmetro dele é o receptor, e o nome desse parâmetro fica visível
em todo membro de instância:

```csharp
public static class SequenceExtensions
{
    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty => !source.Any();                                    // propriedade de instância
        public string JoinWith(string separator) => string.Join(separator, source); // método de instância
        public IEnumerable<TResult> MapTo<TResult>(Func<T, TResult> map) => source.Select(map);
        public static IEnumerable<T> operator +(IEnumerable<T> left, IEnumerable<T> right) => left.Concat(right);
    }

    extension(IEnumerable<int>)                    // sem nome: só membros estáticos
    {
        public static IEnumerable<int> Sequence(int start, int count) => Enumerable.Range(start, count);
    }
}

public static class MathExtensions
{
    extension(Math)                                // uma classe estática pode ganhar membros estáticos
    {
        public static double Remap(double v, double fromLo, double fromHi, double toLo, double toHi)
            => toLo + (v - fromLo) * (toHi - toLo) / (fromHi - fromLo);
    }
}

public static class MoneyExtensions
{
    extension(Money m)
    {
        public static Money Zero => new(0);
        public static Money operator *(Money left, int factor) => new(left.Amount * factor);
    }
}
```

As chamadas, com a saída do `dotnet run` no SDK 10.0.100:

```csharp
int[] empty = [];
List<string> names = ["ana", "bia"];
Console.WriteLine($"{empty.IsEmpty} {names.IsEmpty} {names.JoinWith(" + ")}"); // True False ana + bia
Console.WriteLine(string.Join(",", IEnumerable<int>.Sequence(1, 3)));       // 1,2,3
Console.WriteLine(Math.Remap(5, 0, 10, 0, 100));                             // 50
Console.WriteLine(Money.Zero);                                               // Money { Amount = 0 }
Console.WriteLine(string.Join(",", names + ["caio"]));                       // ana,bia,caio
Console.WriteLine(new Money(10) * 3);                                        // Money { Amount = 30 }
Console.WriteLine(string.Join(",", names.MapTo(s => s.Length)));             // 3,3
```

Os parâmetros de tipo seguem uma regra da referência oficial: ponha o
parâmetro de tipo no bloco quando o receptor usa ele
(`extension<T>(IEnumerable<T>)`), no membro quando só o membro usa
(`MapTo<TResult>`), nunca nos dois.

### Receptores: `null` e `ref`

Membros de extensão de instância são chamadas estáticas por baixo, então um
receptor `null` não lança exceção por si só, exatamente como nos extension
methods clássicos. Para value types, o receptor pode ser passado por
referência:

```csharp
public static class TextExtensions
{
    extension(string? text) { public bool IsBlank => string.IsNullOrWhiteSpace(text); }
}
public static class RefExtensions
{
    extension(ref int value) { public void Increment() => value++; }
}

string? missing = null;
Console.WriteLine(missing.IsBlank);   // True
int counter = 41;
counter.Increment();
Console.WriteLine(counter);           // 42
```

`extension(ref string s)` é rejeitado com error CS9300 "The 'ref' receiver
parameter of an extension block must be a value type or a generic type
constrained to struct".

### O que o compilador emite

Descompilando a classe acima com `ilspycmd -lv CSharp1` (resumido, sem os
atributos de nulidade e com os corpos condensados) aparecem duas camadas:

```csharp
[Extension]
public static class SequenceExtensions
{
    [SpecialName][Extension]
    public sealed class <G>$E09FCB5EB13C1AE2FC524F6744DE5322<$T0>        // tipo de agrupamento
    {
        [SpecialName]
        public static class <M>$28EDA03CA84F5B82CE261A172FD7A22C           // tipo marcador
        {
            public static void <Extension>$(IEnumerable<$T0> source) { }   // codifica o receptor
        }
        [ExtensionMarker("<M>$28EDA03CA84F5B82CE261A172FD7A22C")]
        public bool IsEmpty { get { throw null; } }                         // esqueleto, sem corpo
        [ExtensionMarker("<M>$28EDA03CA84F5B82CE261A172FD7A22C")]
        public string JoinWith(string separator) { throw null; }
    }

    public static bool get_IsEmpty<T>(IEnumerable<T> source) => !Enumerable.Any(source);  // implementação
    [Extension]
    public static string JoinWith<T>(IEnumerable<T> source, string separator) => string.Join(separator, source);
    public static IEnumerable<int> Sequence(int start, int count) => Enumerable.Range(start, count);
}
```

Os tipos aninhados são metadados para compiladores: descrevem cada bloco (a
especificação diz que os nomes, baseados no conteúdo, ficam estáveis entre
recompilações e reordenações) e carregam membros esqueleto cujo corpo só faz
`throw`. O código de verdade fica em métodos estáticos de implementação comuns
na classe de fora: o receptor vira o primeiro parâmetro, os parâmetros de tipo
do bloco vão na frente, e uma propriedade vira `get_IsEmpty`. Os pontos de
chamada vão direto para eles:

```text
IL_000b: call bool SequenceExtensions::get_IsEmpty<int32>(class System.Collections.Generic.IEnumerable`1<!!0>)
IL_001a: call string SequenceExtensions::JoinWith<int32>(class System.Collections.Generic.IEnumerable`1<!!0>, string)
```

Um método de instância num bloco é emitido com `[Extension]`, o mesmo formato
de um extension method clássico; propriedades e membros estáticos não. Como os
métodos de implementação são métodos estáticos públicos, sempre dá para
chamá-los pelo nome: `SequenceExtensions.get_IsEmpty(names)` devolveu
`False`.

### Compatibilidade binária, testada

A referência oficial diz que as duas sintaxes geram o mesmo IL para extension
methods e que a conversão é compatível em binário e em código-fonte. O
experimento: uma class library `TextLib` v1 com
`public static string Shout(this string s)` e `IsBlank(this string? s)`, um
app console compilado contra ela, e depois a v2 da biblioteca reescrita com
extension blocks e copiada por cima da saída do app, sem recompilar o app:

```text
# v1, app compilado contra ela
HI! (v1, this syntax)
True
# v2 copiada por cima, app não recompilado
HI! (v2, extension block)
True
# v3 (IsBlank() virou propriedade) copiada por cima
Unhandled exception. System.MissingMethodException: Method not found: 'Boolean TextLib.TextExt.IsBlank(System.String)'.
```

Trocar método por método é seguro. Transformar um método em propriedade não
é, porque a implementação vira `get_IsBlank`: é uma API nova, e quem foi
compilado contra a antiga quebra em runtime.

### Resolução e ambiguidade

Um membro declarado pelo próprio tipo sempre ganha. Com `Box.Label` e
`Box.Describe()` declarados na classe e também como membros de extensão,
`box.Label` e `box.Describe()` imprimiram "instance property instance method".
Entre extensões, as regras são as clássicas: os candidatos vêm das classes
estáticas em escopo pelo `using`. Quando duas batem igualmente:

```csharp
o.Hello();     // error CS0121: The call is ambiguous between the following methods or properties:
               //   'E1.extension(object).Hello()' and 'E2.extension(object).Hello()'
_ = o.Answer;  // error CS9286: 'object' does not contain a definition for 'Answer' and no accessible
               //   extension member 'Answer' for receiver of type 'object' could be found ...
"x".Trimmed(); // error CS0121: ... 'Modern.extension(string).Trimmed()' and 'Classic.Trimmed(string)'
```

Vale guardar o caso da propriedade: uma propriedade de extensão ambígua é
reportada como "não encontrada", não como ambígua. A última linha mostra um
método `this` clássico e um método de bloco competindo em pé de igualdade.
Para desambiguar, chame o método de implementação pela classe:
`E1.Hello(o)` imprimiu "E1.Hello" e `E2.get_Answer(o)` imprimiu `2`.

### O que não é permitido

Membros de extensão não têm armazenamento. No C# 14 estes foram rejeitados
(SDK 10.0.100):

| Declaração num bloco | Resultado |
|---|---|
| campo, auto-property `{ get; set; }`, event, indexer | error CS9282: This member is not allowed in an extension block |
| acessor `init` | error CS9304: cannot declare init-only accessors in an extension block |
| membro `virtual` | error CS0106: The modifier 'virtual' is not valid for this item |
| membro de instância com receptor sem nome | error CS9303: cannot declare instance members in an extension block with an unnamed receiver parameter |

A referência oficial coloca extension indexers como novidade do C# 15, o que
bate com o CS9282 acima. Se você precisa de estado por objeto, o
`ConditionalWeakTable<TKey, TValue>` da BCL consegue anexá-lo sem manter os
objetos vivos, mas uma propriedade que esconde uma busca numa tabela
surpreende quem lê. Dois detalhes de versão: com `LangVersion` 13 um bloco nem
chega a ser reconhecido (aparecem erros de sintaxe como CS1513 "} expected" e
CS1001 "Identifier expected", e não uma mensagem de "feature not available"),
e o C# 14 transformou `extension` em palavra-chave contextual, então um tipo
chamado `extension` agora dá error CS9306 "Types and aliases cannot be named
'extension'".

## Trade-offs

- **Descoberta.** Membros de extensão só existem onde o namespace deles foi
  importado, e quem lê `x.IsEmpty` não sabe se o tipo é dono do membro.
  Mantenha-os num namespace com nome claro.
- **Propriedades devem continuar baratas.** O `IsEmpty` acima chama `Any()`,
  que começa uma enumeração; numa query LINQ preguiçosa, isso começa a
  executá-la.
- **Método para propriedade é breaking change.** Método para método de bloco
  não é; verificado acima.
  ```csharp
  public bool IsBlank() => ...;   // v2: compatível com a v1
  public bool IsBlank => ...;     // v3: MissingMethodException para quem chamava a v1
  ```
- **O tipo pode pegar o seu nome depois.** Se a biblioteca ganhar um `IsEmpty`
  de verdade, ele vence em silêncio a sua extensão, o que só é bom se os dois
  significarem a mesma coisa.
- **Sem estado, sem polimorfismo.** Extensões não podem ser virtuais nem
  guardar dados; quando precisar de um dos dois, embrulhe o tipo ou herde dele.

## Documentation Links

- [What's new in C# 14: extension members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Extension member declarations (extension keyword), C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/extension) (doc)
- [Extension members, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods) (doc)
- [Extension members, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/extensions) (doc)
- [ExtensionMarkerAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.extensionmarkerattribute) (doc)
- [C# compiler breaking changes since C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2010) (doc)
- [ConditionalWeakTable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.conditionalweaktable-2) (doc)
