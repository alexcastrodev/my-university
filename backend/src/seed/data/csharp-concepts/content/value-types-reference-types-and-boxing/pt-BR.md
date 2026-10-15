---
version: 1.0
updatedAt: 2026-10-15
title: "Value Types, Reference Types e Boxing"
summary: Semântica de cópia versus localização, por que "struct mora na stack" é meia verdade, layout e padding de structs, bugs de structs mutáveis por cópias invisíveis, onde o boxing se esconde (Equals, GetHashCode, enumeradores via interface, Nullable) e como medir alocações no .NET 10.
---
## Objective

A divisão entre value types (`struct`, `enum`, os tipos numéricos) e
reference types (`class`, `interface`, `delegate`, arrays, `string`) diz
respeito ao que uma variável guarda e ao que uma atribuição copia. A explicação
comum é "struct fica na stack, classe fica no heap", e ela erra com frequência
suficiente para causar bugs reais e otimizações inúteis. Este conceito explica
a semântica de cópia, onde os valores realmente ficam, o layout de uma struct,
os bugs que nascem de cópias invisíveis, onde o boxing se esconde e como medir
alocações em vez de chutar.

## Use Cases

- Decidir se um valor pequeno de domínio (uma coordenada, um valor com moeda)
  deve ser `struct` ou `class`.
- Entender por que `list[0].X = 5` não compila e `array[0].X = 5` compila.
- Achar a origem de alocações num caminho quente quando o profiler aponta para
  `ValueType.Equals` ou para um enumerador em box.
- Dimensionar uma struct antes de guardar milhões delas num array.
- Explicar um `InvalidCastException` ao ler um número de volta de um `object`.

## Deep Dive

### O que a variável guarda

Uma variável de tipo struct guarda os próprios campos. Uma variável de tipo
classe guarda uma referência para um objeto. Atribuição, passagem de argumento
e retorno copiam o conteúdo da variável, então a struct é copiada inteira e a
classe compartilha um único objeto:

```csharp
var p1 = new PointS { X = 1, Y = 2 };
var p2 = p1; p2.X = 10;
Console.WriteLine(p1.X); // 1: p2 é uma cópia independente

var c1 = new PointC { X = 1, Y = 2 };
var c2 = c1; c2.X = 10;
Console.WriteLine(c1.X); // 10: as duas variáveis apontam para o mesmo objeto

struct PointS { public int X; public int Y; }
class PointC { public int X; public int Y; }
```

### A stack é detalhe de implementação

Onde um valor fica depende de quem o contém, não de ele ser struct:

- Uma struct local num método comum fica no stack frame, ou só em
  registradores quando o JIT promove os campos dela.
- Uma struct que é campo de uma classe, ou elemento de um array, fica dentro
  desse objeto, no heap.
- Uma variável local capturada por uma lambda, ou usada através de `await` ou
  `yield`, é içada para um objeto gerado pelo compilador. Capturar um `int` e
  criar a lambda custou 88 bytes por chamada nas medições abaixo: o objeto de
  closure mais o delegate.

Também vale no sentido contrário. O JIT do .NET 10 aloca na stack arrays
pequenos de tamanho fixo e delegates quando a escape analysis prova que eles
não saem do método. Um método que monta `int[] n = { 1, 2, 3 }` e soma os
itens alocou 0 bytes por chamada depois de otimizado, enquanto as primeiras
chamadas, ainda sem otimização, alocaram. Isso é otimização, nunca garantia. A
única promessa da linguagem de "nunca no heap" é o `ref struct`, no fim desta
seção.

### Layout e tamanho

O tamanho de uma struct é a soma dos campos mais o padding de alinhamento. Os
compiladores de C# pedem layout sequencial para structs, então a ordem dos
campos importa:

```csharp
Unsafe.SizeOf<Padded>();  // 24
Unsafe.SizeOf<Packed>();  // 16
Unsafe.SizeOf<WithRef>(); // 16: com um campo de referência, o runtime reordenou

struct Padded  { public byte A; public long B; public byte C; }
struct Packed  { public long B; public byte A; public byte C; }
struct WithRef { public byte A; public string? S; public byte C; }
```

Todo objeto no heap paga ainda um cabeçalho e um ponteiro de tipo. Neste
runtime de 64 bits, `new object()` e uma classe com dois campos `int` ocuparam
24 bytes cada. Isso muda o custo de uma coleção: 1.000 structs de dois `int`
num array ocuparam 8.024 bytes num bloco contíguo, enquanto 1.000 instâncias
equivalentes de classe ocuparam 32.024 bytes (um array de referências de 8.024
bytes mais 1.000 objetos de 24 bytes) espalhados pelo heap.

As Framework Design Guidelines sugerem struct só quando o tipo representa um
valor único, tem menos de 16 bytes, é imutável e não vai sofrer boxing com
frequência. O limite de tamanho tem a ver com cópia: cada atribuição e cada
chamada por valor copia tudo.

### Structs mutáveis e cópias invisíveis

A maioria dos bugs com struct vem de código que altera uma cópia sem avisar:

```csharp
var list = new List<MPoint> { new() };
list[0].Move(5);
Console.WriteLine(list[0].X);   // 0: o indexador devolveu uma cópia

var arr = new[] { new MPoint() };
arr[0].Move(5);
Console.WriteLine(arr[0].X);    // 5: elemento de array é uma variável
foreach (var p in arr) p.Move(100);
Console.WriteLine(arr[0].X);    // 5: a variável do loop é uma cópia

var h = new Holder(); h.Bump(); h.Bump();
Console.WriteLine(h.Value);     // 0: chamadas num campo readonly rodam numa cópia

interface IMovable { void Move(int dx); }
struct MPoint : IMovable { public int X; public void Move(int dx) => X += dx; }
struct Counter { public int N; public void Increment() => N++; }
class Holder
{
    private readonly Counter _c;
    public void Bump() => _c.Increment();
    public int Value => _c.N;
}
```

O compilador pega as formas diretas. `list[0].X = 5` é o erro CS1612
("Cannot modify the return value of 'List<MPoint>.this[int]' because it is not
a variable"), o mesmo vale para o indexador de um dicionário, e `p.X = 1`
dentro do `foreach` é CS1654. Ele não pega a chamada de método, porque não sabe
se o método escreve. A correção é tornar a struct imutável: uma
`readonly struct` ou uma `readonly record struct`, atualizada com `with`, faz
qualquer escrita virar erro de compilação. A mesma cópia escondida aparece com
parâmetros `in` numa struct não readonly, como mostra Method Parameters:
Optional, Named and ref Kinds.

### Onde o boxing se esconde

Boxing converte um value type para `object`, `ValueType` ou uma interface,
copiando o valor para um objeto novo no heap. Os casos óbvios, `ArrayList`,
parâmetros do tipo interface e `string.Format` com `params object[]`, estão em
Generics: Constraints and Variance e no conceito de formatação. Estes são os
mais discretos, medidos por chamada (método mais abaixo):

| Código | Bytes por chamada |
|---|---|
| `a.Equals(b)` numa struct sem overrides | 48: `this` e `b` vão para box |
| a mesma struct implementando `IEquatable<T>` | 0 |
| `a.GetHashCode()` sem override | 24 |
| `Sink.O = 42 + x` (um box guardado num campo) | 24 |
| `foreach` sobre um `List<int>` tipado como `IEnumerable<int>` | 40 a frio ou com PGO desligado, 0 depois de otimizado com PGO |
| `flags.HasFlag(FileAttributes.Hidden)` | 48 a frio, 0 depois de otimizado |

O `ValueType.Equals` padrão compara campo a campo passando por `object`, e a
documentação dele recomenda sobrescrevê-lo, principalmente quando a struct tem
referências. Um `record struct` gera `IEquatable<T>` e os dois overrides.

O box é uma cópia com vida própria, e o unboxing é rígido quanto ao tipo:

```csharp
object o = 42;
long l = (long)o;        // InvalidCastException: o box guarda um int
long ok = (long)(int)o;  // unbox para int e depois converte

int? none = null;
object bn = none;        // null: um Nullable<T> vazio vira referência nula
int? some = 5;
object bs = some;
Console.WriteLine(bs.GetType()); // System.Int32, nunca Nullable<Int32>

var m = new MPoint();
object boxed = m;
((IMovable)boxed).Move(5);
Console.WriteLine($"{m.X} {((MPoint)boxed).X}"); // 0 5: só o box se moveu
```

### Medir em vez de chutar

`GC.GetAllocatedBytesForCurrentThread()` basta para uma checagem rápida:

```csharp
static long Alloc(Action action)
{
    const int N = 10_000;
    for (int round = 0; round < 5; round++)   // deixa a compilação em camadas otimizar
    {
        for (int i = 0; i < N; i++) action();
        Thread.Sleep(150);
    }
    long before = GC.GetAllocatedBytesForCurrentThread();
    for (int i = 0; i < N; i++) action();
    return (GC.GetAllocatedBytesForCurrentThread() - before) / N;
}
```

Rode em Release e aqueça antes, porque o código começa sem otimização (Tier0)
e a tabela acima muda depois do tier-up. Guarde os resultados num campo
estático: `object o = 42 + x; x = (int)o;` mediu 0 bytes, porque o JIT provou
que o box não escapa e o manteve fora do heap, enquanto o mesmo box guardado
num campo mediu 24. Todos os números aqui vêm do .NET 10.0.0 num Apple M4 Max
(arm64), Release, com a compilação em camadas e o PGO padrão. Para um serviço
rodando, o `dotnet-counters` mostra a taxa de alocação sem mexer no código.

### `ref struct`: a stack como regra

Um `ref struct` não pode sofrer boxing, não pode ser campo de classe, não pode
ser elemento de array e não pode ser capturado por lambda, então o compilador
garante que ele nunca chega ao heap. `Span<T>` é um deles, e `stackalloc`
atribuído a um `Span<T>` dá memória de stack segura sem `unsafe`. Span, Memory
e Slicing Sem Alocar parte daqui.

## Trade-offs

- **Struct versus classe.** A struct evita uma alocação e um salto de ponteiro,
  mas é copiada em cada atribuição e chamada, então uma struct grande move
  todos os seus bytes a cada vez. Mantenha structs pequenas, ou passe uma
  grande com `in` só quando ela for `readonly`.
- **Structs mutáveis.** Deixam alguns caminhos quentes mais baratos
  (`List<T>.Enumerator` é uma), mas geram bugs silenciosos por causa das
  cópias. Use `readonly struct` por padrão e permita mutação só em código
  privado e local.
- **Igualdade.** Sobrescrever `Equals` e `GetHashCode` e implementar
  `IEquatable<T>` é boilerplate, mas sem isso toda comparação faz boxing e
  passa pelo caminho lento padrão. O `record struct` escreve isso por você.
- **Abstração versus boxing.** Aceitar `object` ou uma interface deixa a API
  simples e faz boxing de todo argumento struct. Um método genérico com
  constraint para a interface evita o box, ao preço de uma cópia compilada por
  value type.
- **Confiar no JIT.** Escape analysis e PGO removem muitas alocações em regime
  estável, mas não em código frio, nem sempre sem PGO, e nunca quando o valor
  escapa. Meça o caminho real antes e depois de uma mudança.

## Documentation Links

- [Value types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types) (doc)
- [Structure types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [Boxing and unboxing, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing) (doc)
- [Choosing between class and struct, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct) (doc)
- [ValueType.Equals(Object), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.equals) (doc)
- [What's new in .NET 10 runtime: stack allocation and escape analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime#stack-allocation) (doc)
- [ref struct types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
