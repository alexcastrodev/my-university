---
version: 1.0
updatedAt: 2026-10-15
title: Generic math e membros static abstract em interfaces
summary: As interfaces de generic math do .NET 7 sobre membros static abstract do C# 11, como escolher a menor constraint para um Sum genérico, um tipo próprio entrando no algoritmo, divisão inteira e overflow em código genérico (operadores checked), o assembly que o JIT gera, como o Enumerable.Sum usa isso e o que o compilador recusa.
---
## Objective

Antes do .NET 7, um método que somava números precisava de uma sobrecarga por
tipo, ou de um desvio por `object` com casts, porque um parâmetro de tipo `T`
não tinha `+`. Generic math resolve isso com duas peças que chegaram juntas: o
C# 11 permite que uma interface declare membros `static abstract` e
`static virtual` (operadores inclusive), e o .NET 7 trouxe uma família de
interfaces em `System.Numerics` que todos os tipos numéricos nativos
implementam. Este conceito mostra como escolher a menor constraint para um
algoritmo, como encaixar um tipo seu, onde divisão inteira e overflow mordem em
código genérico e o que o JIT realmente produz. O mecanismo de `static abstract`
foi apresentado no conceito de interfaces; aqui ele vai para o trabalho.

## Use Cases

- Um único `Sum`, `Average` ou `Clamp` para `int`, `double`, `decimal`,
  `BigInteger` e os seus value types, no lugar de um bloco de sobrecargas.
- Tipos de domínio (`Money`, `Vector2`, `Meters`) participando dos mesmos
  algoritmos que os números nativos, implementando só os operadores que usam.
- Código de biblioteca que faz parse, converte e calcula sem saber o tipo
  numérico exato (`IParsable<T>`, `CreateChecked`).
- Manipulação de bits escrita uma vez para inteiros de qualquer largura
  (`IBinaryInteger<T>`).

## Deep Dive

### A família de interfaces

As interfaces vêm em camadas. As mais grossas descrevem um tipo de número; as
mais finas descrevem uma única capacidade:

| Interface | O que oferece |
|---|---|
| `INumberBase<T>` | `T.Zero`, `T.One`, `CreateChecked/Saturating/Truncating`, `IsNaN`, `IsInteger` e os operadores básicos |
| `INumber<T>` | acrescenta comparação: `T.Clamp`, `T.Max`, `T.Min`, `T.Sign` |
| `IBinaryInteger<T>` | `PopCount`, `LeadingZeroCount`, `RotateLeft`, `DivRem` |
| `IFloatingPointIeee754<T>` | `T.NaN`, `T.Pi`, `T.Epsilon`, funções trigonométricas e logaritmos |
| `IAdditionOperators<TSelf, TOther, TResult>` e irmãs | um operador cada: `+`, `-`, `*`, `/`, `%`, `<<`, `==`, `<` |
| `IAdditiveIdentity<TSelf, TResult>` | `T.AdditiveIdentity` (o zero do `+`) |

As interfaces de operador têm três parâmetros de tipo para que entrada e
resultado possam ser diferentes, e de propósito não agrupam operações: a
documentação cita `Matrix4x4`, que tem `*` mas não tem `/`. Tudo isso fica em
`System.Numerics`, menos as interfaces de parse (`IParsable<T>`), que estão em
`System` e apareceram no conceito de parsing.

### Um `Sum` genérico: peça o mínimo

`INumber<T>` é a constraint óbvia, mas uma soma só precisa de `+` e de um zero.
Pedir exatamente isso deixa entrar tipos que não são "números":

```csharp
using System.Numerics;

static T Sum<T>(IEnumerable<T> values)
    where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T total = T.AdditiveIdentity;
    foreach (var v in values) total += v;
    return total;
}

readonly record struct Money(long Cents)
    : IAdditionOperators<Money, Money, Money>, IAdditiveIdentity<Money, Money>
{
    public static Money operator +(Money a, Money b) => new(a.Cents + b.Cents);
    public static Money AdditiveIdentity => new(0);
}

Sum<int>([1, 2, 3])                          // 6
Sum<double>([0.5, 0.25])                     // 0.75
Sum<decimal>([0.1m, 0.2m])                   // 0.3
Sum<BigInteger>([BigInteger.Pow(2, 100), 1]) // 1267650600228229401496703205377
Sum<Money>([new(1050), new(250)])            // Money { Cents = 1300 }
```

`T.AdditiveIdentity` e `+` são membros estáticos acessados pelo parâmetro de
tipo. `Money` não é um número, não tem `/` nem comparação, e mesmo assim
funciona porque implementa só as duas capacidades que o algoritmo pediu.
`total += v` compila porque a atribuição composta usa o `+` que a constraint
garante.

As interfaces mais grossas compensam quando você precisa de muitas capacidades
ao mesmo tempo:

```csharp
static T Clamp01<T>(T v) where T : INumber<T> => T.Clamp(v, T.Zero, T.One);
static T Bits<T>(T v) where T : IBinaryInteger<T> => T.PopCount(v);

Clamp01(1.7) + " " + Clamp01(-2f) + " " + Clamp01(0.5m)   // 1 0 0.5
Bits(255) + " " + Bits(255UL) + " " + Bits((byte)7)       // 8 8 3
```

### Misturando tipos: a armadilha da divisão inteira

Código genérico executa os operadores do tipo que recebe, divisão inteira
inclusive:

```csharp
static T Average<T>(IReadOnlyList<T> values) where T : INumber<T>
    => Sum(values) / T.CreateChecked(values.Count);

static TResult AverageAs<T, TResult>(IReadOnlyList<T> values)
    where T : INumber<T> where TResult : INumber<TResult>
{
    TResult total = TResult.Zero;
    foreach (var v in values) total += TResult.CreateChecked(v);
    return total / TResult.CreateChecked(values.Count);
}

Average<int>([1, 2])                                 // 1  (divisão de int)
AverageAs<int, double>([1, 2])                       // 1.5
AverageAs<int, long>([int.MaxValue, int.MaxValue])   // 2147483647, sem overflow
```

Um segundo parâmetro de tipo para o resultado é o padrão que a documentação
oficial usa para médias. Acumular num `TResult` mais largo também elimina o
overflow que `Average<int>` sofreria com valores grandes. `CreateChecked` é a
conversão que lança exceção quando o valor não cabe; as variantes saturating e
truncating são comparadas no conceito de conversões numéricas.

### `checked` em código genérico

Uma expressão `checked` dentro de um método genérico chama o operador checked
do tipo. `IAdditionOperators` declara esse operador como `static virtual`,
então um tipo que escreve só o `+` continua satisfazendo a constraint, e num
contexto checked é o `+` comum dele que roda:

```csharp
static T SumChecked<T>(IEnumerable<T> values)
    where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T total = T.AdditiveIdentity;
    foreach (var v in values) total = checked(total + v);
    return total;
}

readonly record struct SafeMoney(long Cents) /* mesmas interfaces de Money */
{
    public static SafeMoney operator +(SafeMoney a, SafeMoney b) => new(unchecked(a.Cents + b.Cents));
    public static SafeMoney operator checked +(SafeMoney a, SafeMoney b) => new(checked(a.Cents + b.Cents));
    public static SafeMoney AdditiveIdentity => new(0);
}

Sum<int>([int.MaxValue, 1])                               // -2147483648 (dá a volta)
SumChecked<int>([int.MaxValue, 1])                        // OverflowException
SumChecked<double>([double.MaxValue, double.MaxValue])    // Infinity
SumChecked<Money>([new(long.MaxValue), new(1)])           // Money { Cents = -9223372036854775808 }
SumChecked<SafeMoney>([new(long.MaxValue), new(1)])       // OverflowException
```

`checked` não muda nada para `double`, e só protege o seu tipo se ele definir
`operator checked`. Escrever `checked` no algoritmo é um pedido; cada tipo
decide se atende.

### O que o JIT gera

O conceito de generics mostrou que o runtime compila uma cópia separada do
código genérico para cada value type. É isso que deixa generic math barato.
Para este `Sum<T>(ReadOnlySpan<T>)` com constraint `INumberBase<T>`, o
`DOTNET_JitDisasm` num Mac com Apple Silicon (Release, tiered compilation
desligada) mostrou a instanciação de `int` como um loop simples (recortado,
comentários meus):

```text
; Assembly listing for method Program:<<Main>$>g__Sum|0_0[int](System.ReadOnlySpan`1[int]):int (FullOpts)
            mov     w2, wzr            ; T.Zero
G_M000_IG04:
            ldr     w4, [x0, x3]
            add     w2, w4, w2         ; total += v
            add     x3, x3, #4
            sub     w1, w1, #1
            cbnz    w1, G_M000_IG04
```

Nenhuma chamada de interface, nenhum boxing: `GC.GetAllocatedBytesForCurrentThread()`
em volta de uma chamada sobre 1.000 `int`s marcou `0` bytes. A referência do C#
explica o motivo: chamadas a membros `static abstract` não têm despacho em
runtime; são resolvidas a partir do argumento de tipo.

### Dentro do LINQ

`Enumerable.Sum` usa a mesma maquinaria. No código-fonte do .NET 10, as
sobrecargas para `IEnumerable<int>`, `long`, `float`, `double` e `decimal`
tentam obter um span da fonte e, quando conseguem, chamam um único
`Sum<T, TResult>(ReadOnlySpan<T>)` privado com constraint `INumber<T>`. Esse
método vetoriza só `int` e `long` (quando há aceleração de hardware e o span é
grande o bastante) e mantém a checagem de overflow em todos os caminhos. Por
isso `new[] { int.MaxValue, 1 }.Sum()` lança `OverflowException`, enquanto um
loop `+=` escrito à mão dá a volta.

### O que o compilador recusa

```csharp
List<INumber<int>> list = [];
// error CS8920: The interface 'INumber<int>' cannot be used as type argument.
//   Static member 'IParsable<int>.Parse(string, IFormatProvider?)' does not have
//   a most specific implementation in the interface.
var z = INumber<int>.Zero;
// error CS8926: A static virtual or abstract interface member can be accessed
//   only on a type parameter.
```

Essas interfaces são constraints, não tipos para variáveis ou coleções. Se o
que você quer é "uma lista de números de qualquer tipo", generic math é a
ferramenta errada.

## Trade-offs

- **Tamanho da constraint versus alcance.** `INumber<T>` é fácil de escrever,
  mas exclui tipos como `Money`. Interfaces de operador finas alcançam mais
  tipos e deixam as assinaturas longas.
  ```csharp
  where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>   // Money entra
  where T : INumber<T>                                              // Money fica de fora
  ```
- **A semântica segue o tipo.** O mesmo código trunca a divisão para `int`,
  ignora `checked` para `double` e dá a volta ou lança exceção no seu tipo
  conforme os operadores dele. Teste o algoritmo com cada tipo que você promete
  suportar.
- **Implementar `INumber<T>` você mesmo é grande.** Ele puxa parse,
  formatação, comparação e uma dúzia de operadores. Implemente só as interfaces
  pequenas que os seus algoritmos usam.
- **Não é ferramenta de polimorfismo.** Sem despacho em runtime e sem variáveis
  `INumber<int>` (CS8920, CS8926). Código que precisa lidar com números cujo
  tipo só se conhece em runtime continua precisando de sobrecargas, `switch` ou
  `decimal` em tudo.
- **Código de aplicação raramente precisa.** A documentação diz que quem mais
  ganha são autores de bibliotecas. Para um tipo concreto só, um método não
  genérico é mais fácil de ler.

## Lab

Neste lab você recebe `Algorithms` e dois tipos de valor (`Money` e `SafeMoney`) com os corpos **vazios** (`NotImplementedException`). O seu trabalho é escrever algoritmos genéricos que funcionam para `int`, `double`, `decimal`, `BigInteger` e para um tipo seu, restringindo o parâmetro de tipo à menor interface de `System.Numerics` de que ele precisa. A ideia central é sentir que `static abstract` deixa você chamar `T.Zero` ou `T.AdditiveIdentity` direto no tipo, e ver onde a divisão inteira e o `checked` mudam o resultado.

**O cenário**

Uma soma, uma média e alguns utilitários numéricos escritos uma vez só, sem um método para cada tipo.

- `Algorithms.cs`: `Sum`, `Average`, `AverageAs`, `Clamp01`, `Bits` e `SumChecked`, cada um com sua constraint genérica (`IAdditionOperators`, `INumber<T>`, `IBinaryInteger<T>`).
- `Money.cs`, `Money`: um valor que **não é um número**. Não tem divisão nem comparação, só `+` e um zero, e mesmo assim entra em `Sum`.
- `Money.cs`, `SafeMoney`: a mesma ideia, mas com um `operator checked +` para respeitar o contexto `checked`. O `operator +` normal já vem pronto.

Repare que cada método pede o mínimo: a soma precisa de `+` e de um zero, nada mais.

**O que você vai fazer, passo a passo**

1. **Somar com a menor constraint (TODO-00).** Em `Sum`, comece de `T.AdditiveIdentity` e some cada valor com `+=`. Uma sequência vazia devolve o zero do tipo.
2. **Fazer seu próprio tipo entrar na soma (TODO-01).** Em `Money`, implemente `operator +` somando os centavos em contexto `unchecked` (o `+` simples dá a volta no overflow) e `AdditiveIdentity` devolvendo o zero.
3. **Evitar divisão inteira e overflow (TODO-02).** Em `Average`, divida a soma pela quantidade convertida com `T.CreateChecked` e note o que acontece com `int`. Em `AverageAs<T, TResult>`, acumule em `TResult` (comece de `TResult.Zero` e converta cada valor com `TResult.CreateChecked`) e divida pela contagem convertida.
4. **Usar membros estáticos de interface (TODO-03 e TODO-04).** `Clamp01` limita entre `T.Zero` e `T.One` para qualquer `INumber<T>`. `Bits` conta os bits ligados de qualquer largura inteira com `T.PopCount`.
5. **Pedir `checked` no algoritmo e honrar no tipo (TODO-05).** Em `SumChecked`, some dentro de um contexto `checked`: `total = checked(total + v)`. Em `SafeMoney`, o `operator checked +` lança `OverflowException` no overflow, usando um contexto `checked` na soma. Só tipos que definem esse operador ficam protegidos: `Money` continua dando a volta.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `Average<int>([1, 2])` dá 1 e `AverageAs<int, double>` dá 1.5, por que `SumChecked<double>` devolve infinito em vez de lançar, e por que `SumChecked<Money>` não protege nada.

**Desafios opcionais**

- **TODO-06:** tente `List<INumber<int>> list = [];` e `var z = INumber<int>.Zero;`. Leia os erros do compilador (CS8920, CS8926) e explique por que essas interfaces são constraints, não tipos para variáveis.
- **TODO-07:** `Clamp01` usa só `T.Clamp`, `T.Zero` e `T.One`, mas exige o `INumber<T>` inteiro. Que interfaces menores ainda dariam zero, um e comparações? O que `Money` ganharia, e o que se perde em legibilidade?

**Pré-requisitos:** generics e constraints em C#, interfaces com membros `static abstract` (C# 11) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` com um comentário `TODO-NN` explicando o passo, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Generic math, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
- [interface keyword: static abstract and virtual members, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) (doc)
- [Tutorial: Explore static virtual members in interfaces, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/static-virtual-interface-members) (doc)
- [What's new in C# 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-11) (doc)
- [INumber<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.inumber-1) (doc)
- [IAdditionOperators<TSelf,TOther,TResult>.CheckedAddition, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.iadditionoperators-3.op_checkedaddition) (doc)
