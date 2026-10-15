---
version: 1.0
updatedAt: 2026-10-15
title: "Delegates e invocação multicast"
summary: O que o compilador gera para um tipo delegate, Target e Method, Func, Action e Predicate versus tipos próprios, listas de invocação imutáveis com += e -= (remoção da ocorrência mais à direita), exceção no meio de um multicast, EnumerateInvocationList (.NET 9), cache de method group (C# 11) e ponteiros de função (C# 9).
---
## Objective

Um delegate é um objeto que aponta para um método: uma instância alvo (ou
nenhuma, no caso de método estático) mais o próprio método. Todo tipo delegate
é uma classe gerada pelo compilador, toda instância de delegate é imutável, e
todo delegate é multicast, ou seja, pode guardar uma lista de métodos e chamar
todos em ordem. Este conceito mostra o que o compilador emite para um tipo
delegate, como `+=` e `-=` montam e procuram de fato as listas de invocação, o
que acontece quando um método da lista lança exceção, como `Func`, `Action` e
`Predicate` se relacionam com tipos delegate próprios, como conversões de
method group são cacheadas, e onde os ponteiros de função do C# 9 entram quando
um delegate custa caro demais.

## Use Cases

- Passar comportamento para um algoritmo: uma comparação para o `Sort`, um
  predicado para o `FindAll`, um callback de retry para um helper HTTP.
- Espalhar uma notificação para vários ouvintes com uma única chamada, que é
  como events funcionam por baixo.
- Coletar todos os resultados, ou todas as exceções, de uma lista de handlers,
  e não só o último.
- Escolher entre um tipo delegate próprio (com nome, com parâmetros `ref`/`out`)
  e a família genérica `Func`/`Action`.
- Chamar código nativo ou uma tabela de despacho quente sem alocar delegate.

## Deep Dive

### Um tipo delegate é uma classe gerada

`delegate int Transform(int x);` é uma declaração de tipo. Reflection no .NET
10.0.0 mostra o que o compilador produziu:

```csharp
foreach (var m in typeof(Transform).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
    Console.WriteLine(m);
// Int32 Invoke(Int32)
// System.IAsyncResult BeginInvoke(Int32, System.AsyncCallback, System.Object)
// Int32 EndInvoke(System.IAsyncResult)
Console.WriteLine($"{typeof(Transform).BaseType}, sealed: {typeof(Transform).IsSealed}");
// System.MulticastDelegate, sealed: True
```

Chamar `t(3)` compila para `t.Invoke(3)`. O `BeginInvoke` ainda é gerado por
compatibilidade, mas chamá-lo no .NET lança `PlatformNotSupportedException`
(conferido no 10.0.0); use `Task.Run(() => t(3))` no lugar.

Uma instância carrega duas coisas, `Target` e `Method`:

```csharp
Transform inst = counter.Add;   // Target = counter, Method = Add
Transform stat = Ops.Square;    // Target = null,    Method = Square
```

A referência em `Target` é forte. Um delegate guardado em algo de vida longa
mantém o objeto alvo vivo, e essa é a raiz do vazamento por events do próximo
conceito.

### `Func`, `Action`, `Predicate` e tipos próprios

`Func<...>` (até 16 parâmetros mais o resultado), `Action<...>` e
`Predicate<T>` cobrem a maioria das assinaturas, e no .NET 10 os parâmetros de
tipo deles são declarados `allows ref struct`, então
`Func<ReadOnlySpan<char>, int>` compila. Mesmo assim, dois tipos delegate com a
mesma assinatura continuam sendo tipos diferentes:

```csharp
Func<int, bool> isEven = x => x % 2 == 0;
Predicate<int> p = isEven;          // error CS0029: Cannot implicitly convert type 'System.Func<int, bool>' to 'System.Predicate<int>'
Predicate<int> ok = isEven.Invoke;  // compila: um delegate novo que chama o antigo
```

O contorno aloca um segundo delegate e acrescenta um salto por chamada. Tipos
delegate próprios continuam sendo a ferramenta certa quando a assinatura
precisa de parâmetros `ref`, `out` ou `in`, que a família genérica não tem, ou
quando um nome documenta a intenção:

```csharp
delegate bool TryParse<T>(string s, out T value);
TryParse<int> tp = int.TryParse;    // tp("42", out var v) -> True, v = 42
```

Conversões de method group também aplicam variância por conta própria,
separada da variância `in`/`out` de delegates genéricos que o conceito de
generics cobre: `Func<object> f = GetText;` aceita um método que retorna
`string`, e `Action<string> a = TakeObject;` aceita um método que recebe
`object`.

### Multicast: listas de invocação imutáveis

`a += b` significa `a = (Transform)Delegate.Combine(a, b)`. O `Combine` nunca
altera as entradas; ele monta um delegate novo cuja lista de invocação é a
concatenação:

```csharp
Transform chain = Ops.Square;
Transform first = chain;
chain += Ops.Negate;
chain += Ops.Double;
Console.WriteLine($"{chain(3)}; first still has {first.GetInvocationList().Length} target");
// 6; first still has 1 target
// lista de invocação: Square, Negate, Double
```

Os três métodos rodaram em ordem, e quem chamou viu só o último retorno
(`Double(3) = 6`). O guia de delegates do Microsoft Learn dá a mesma regra para
parâmetros `out`: os valores vêm do último método chamado, e um argumento `ref`
passa por cada método, um depois do outro.

A imutabilidade tem um custo e um benefício. Medindo com
`GC.GetAllocatedBytesForCurrentThread` (.NET 10.0.0, Apple M4 Max, arm64,
Release), combinar um delegate de um método com outro alocou 104 bytes: um
`MulticastDelegate` novo mais o array por trás da lista. Em troca, um delegate
que você já leu nunca muda por baixo de você, então invocá-lo de várias threads
é seguro. Escrever `field += handler` num campo compartilhado não é: são uma
leitura, um combine e uma escrita, e duas threads podem perder uma
atualização. Events resolvem isso (próximo conceito).

### `-=`: remove a ocorrência mais à direita

A remoção compara delegates por valor: mesmo `Target` e mesmo `Method`. A
referência do C# define `a - b` como a remoção da sublista contígua mais à
direita de `a` que seja igual à lista de `b`, devolvendo `a` sem mudança quando
não há correspondência e `null` quando não sobra nada:

```csharp
Action seq = Ops.A;
seq += Ops.B; seq += Ops.A; seq += Ops.B;
seq -= Ops.A;                              // A, B, B: saiu o ÚLTIMO A

Action<string> log = s => Console.Write($"1:{s} ");
log += s => Console.Write($"2:{s} ");
log -= s => Console.Write($"2:{s} ");      // continua com 2 alvos

Transform only = Ops.Square;
only -= Ops.Square;                        // null

Transform a1 = counter.Add, a2 = counter.Add, a3 = new Counter().Add;
// a1 == a2: True, ReferenceEquals(a1, a2): False, a1 == a3: False
```

O caso da lambda é o bug clássico: duas lambdas idênticas compilam para dois
métodos diferentes, então a segunda nunca é igual à primeira. Guarde o
delegate numa variável ou campo se for removê-lo depois. O resultado `null`
também importa: depois de remover o último handler, chamar o campo direto lança
`NullReferenceException`, daí o `handler?.Invoke(...)`.

### Quando um método lança exceção

Uma exceção interrompe a lista de invocação naquele ponto e sobe para quem
chamou:

```csharp
Action<string> notify = s => Console.Write($"first:{s} ");
notify += s => throw new InvalidOperationException("second failed");
notify += s => Console.Write($"third:{s} ");
try { notify("x"); } catch (InvalidOperationException e) { Console.WriteLine($"caught: {e.Message}"); }
// first:x caught: second failed
```

O `third` nunca rodou. Quando todo ouvinte precisa rodar, ou quando você
precisa de todos os retornos, percorra a lista você mesmo:

```csharp
var errors = new List<Exception>();
foreach (var handler in Delegate.EnumerateInvocationList(notify))
{
    try { handler("y"); } catch (Exception e) { errors.Add(e); }
}
// first:y third:y errors: 1  ->  throw new AggregateException(errors) se precisar
```

`Delegate.EnumerateInvocationList<TDelegate>` (disponível desde o .NET 9)
devolve um enumerador struct já tipado e alocou 0 bytes por laço na medição
acima, enquanto `GetInvocationList()` devolveu um `Delegate[]` novo (48 bytes
para três métodos) que você ainda precisa converter elemento por elemento. O
enumerador só segue o padrão do `foreach`, não é um `IEnumerable<T>`, então
`.Select(...)` nele falha com CS1061. `HasSingleTarget` (mesma versão) diz se
um delegate é multicast sem alocar.

### Method groups e cache

Converter um nome de método em delegate é uma conversão de method group. Desde
o C# 11 o compilador cacheia o delegate de um method group estático num campo
estático escondido, como já fazia com lambdas que não capturam nada. O IL de
`Func<int, int> f = Square; return f(x);`, lido com `ilspycmd -il` e
resumido:

```text
IL_0001: ldsfld class System.Func`2<int32, int32> Ops/'<>O'::'<0>__Square'
IL_0007: brtrue.s IL_001c
IL_000b: ldftn int32 Ops::Square(int32)
IL_0011: newobj instance void class System.Func`2<int32, int32>::.ctor(object, native int)
IL_0017: stsfld class System.Func`2<int32, int32> Ops/'<>O'::'<0>__Square'
IL_001f: callvirt instance !1 class System.Func`2<int32, int32>::Invoke(!0)
```

Um method group de instância não tem como ser cacheado, porque o alvo muda a
cada objeto: `Transform t = calc.Add1;` mediu 64 bytes por conversão, o
estático 0. O conceito de closures cobre o que as lambdas alocam.

### Ponteiros de função (C# 9)

Um ponteiro de função é o endereço de um método estático com assinatura
tipada. Ele exige contexto `unsafe` (e `AllowUnsafeBlocks`), e a chamada vira
uma instrução `calli` em vez de um `callvirt Invoke` sobre um objeto:

```csharp
unsafe static int ViaPointer(int x)
{
    delegate*<int, int> p = &Square;   // IL: ldftn Ops::Square, depois calli int32(int32)
    return p(x);
}
```

Sem objeto, sem alocação (0 bytes medidos), sem lista de invocação, sem alvo.
Pegar `&c.Add1` de um método de instância falha com error CS8759 "Cannot
create a function pointer for 'C.Add1(int)' because it is not a static
method", e usar `delegate*` fora de `unsafe` dá error CS0214.
`delegate* unmanaged[Cdecl]<...>` chama código nativo com a convenção de
chamada indicada. Fora de interop e de laços de baixo nível muito quentes, o
delegate é o padrão mais seguro.

## Trade-offs

- **Delegates são objetos.** Cada method group de instância ou lambda que
  captura aloca, e um delegate guardado mantém o seu `Target` vivo. Method
  groups estáticos e lambdas sem captura são cacheados.
- **Multicast guarda só o último resultado.** Use
  `Delegate.EnumerateInvocationList` quando precisar de todos os resultados ou
  quiser isolar falhas.
  ```csharp
  foreach (var v in Delegate.EnumerateInvocationList(validators)) results.Add(v(input));
  ```
- **A remoção é por igualdade, não pelo texto do código.** Lambdas não podem
  ser desinscritas a menos que você tenha guardado a instância.
- **`Func`/`Action` versus tipos próprios.** A família genérica é
  intercambiável entre bibliotecas; um tipo próprio suporta `ref`/`out` e um
  nome com significado, mas não converte para `Func` sem um wrapper.
- **Ponteiros de função trocam segurança por velocidade.** `unsafe`, só
  métodos estáticos, sem multicast. Meça antes de usar.

## Documentation Links

- [Delegates, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/) (doc)
- [Using delegates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/using-delegates) (doc)
- [How to combine delegates (multicast delegates), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/how-to-combine-delegates-multicast-delegates) (doc)
- [Subtraction operator: delegate removal, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/subtraction-operator) (doc)
- [Delegate.EnumerateInvocationList method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.delegate.enumerateinvocationlist) (doc)
- [MulticastDelegate class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.multicastdelegate) (doc)
- [Unsafe code and function pointers, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/unsafe-code) (doc)
- [C# language version history (C# 9 function pointers, C# 11 method group conversion), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
