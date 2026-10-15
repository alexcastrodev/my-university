---
version: 1.0
updatedAt: 2026-10-15
title: "Funções Locais, Lambdas e Closures"
summary: O lowering de lambdas e funções locais lido no IL (display class, delegate em cache, closure em struct), alocações medidas, o escopo onde a closure nasce, lambdas static, tipo natural e valores padrão, modificadores de parâmetro sem tipo do C# 14 e quando preferir uma função local.
---
## Objective

Lambdas e funções locais parecem detalhes de sintaxe, mas o compilador faz
trabalho de verdade por trás delas: move variáveis capturadas para uma classe
ou struct gerada, reescreve todo uso dessas variáveis e decide se um delegate
pode ficar em cache ou precisa ser alocado a cada chamada. Este conceito lê
esse lowering no IL, mede o que cada forma aloca e cobre os recursos mais
novos de lambda: tipo natural e tipo de retorno explícito (C# 10), valores
padrão de parâmetro (C# 12) e modificadores de parâmetro sem tipo explícito
(C# 14). Termina com quando escolher uma função local em vez de uma lambda.

## Use Cases

- Escrever um helper que só um método precisa, sem alargar a classe.
- Passar comportamento para LINQ, eventos ou callbacks sem alocar num caminho
  quente.
- Validar argumentos na hora num método iterador ou async, com o trabalho real
  numa função local.
- Declarar uma lambda com `var` e argumento padrão, ou uma lambda para um
  delegate com parâmetros `out`, sem escrever todos os tipos.
- Diagnosticar um vazamento de memória mantido vivo por um delegate de vida
  longa.

## Deep Dive

### O que o compilador gera

Pegue três jeitos de aplicar um fator a uma lista:

```csharp
public static int Capturing(int[] items, int factor)
{
    Func<int, int> scale = x => x * factor;        // captures 'factor'
    ...
}
public static int NonCapturing(int[] items)
{
    Func<int, int> twice = x => x * 2;             // captures nothing
    ...
}
public static int LocalFunction(int[] items, int factor)
{
    ...
    int Scale(int x) => x * factor;                // captures, never becomes a delegate
}
```

Descompilar a DLL com `ilspycmd -lv CSharp1` (uma visão em C# 1, que não
consegue expressar lambdas e por isso mostra o código já rebaixado) dá, de
forma resumida:

```csharp
private sealed class <>c__DisplayClass0_0         // the closure for Capturing
{
    public int factor;
    internal int <Capturing>b__0(int x) => x * factor;
}

private sealed class <>c                          // non-capturing lambdas
{
    public static readonly <>c <>9 = new <>c();
    public static Func<int, int> <>9__1_0;        // cached delegate
    internal int <NonCapturing>b__1_0(int x) => x * 2;
}

private struct <>c__DisplayClass2_0               // a struct, for the local function
{
    public int factor;
}

public static int Capturing(int[] items, int factor)
{
    <>c__DisplayClass0_0 obj = new <>c__DisplayClass0_0();
    obj.factor = factor;
    Func<int, int> func = new Func<int, int>(obj.<Capturing>b__0);
    ...
}

public static int NonCapturing(int[] items)
{
    Func<int, int> func = <>c.<>9__1_0 ?? (<>c.<>9__1_0 = new Func<int, int>(<>c.<>9.<NonCapturing>b__1_0));
    ...
}

public static int LocalFunction(int[] items, int factor)
{
    <>c__DisplayClass2_0 obj = default;
    obj.factor = factor;
    ... num += <LocalFunction>g__Scale|2_0(x, ref obj);
}
```

O IL de `Capturing` confirma duas alocações antes de qualquer trabalho:

```text
IL_0000: newobj instance void Demo/'<>c__DisplayClass0_0'::.ctor()
IL_0008: stfld int32 Demo/'<>c__DisplayClass0_0'::factor
IL_000e: ldftn instance int32 Demo/'<>c__DisplayClass0_0'::'<Capturing>b__0'(int32)
IL_0014: newobj instance void class System.Func`2<int32, int32>::.ctor(object, native int)
```

Três fatos saem daí. Uma variável capturada deixa de ser local: vira campo da
display class, e toda leitura e escrita no método passa por esse campo, e é
por isso que closures enxergam mudanças posteriores (o conceito de execução
adiada do LINQ mostra o bug que isso causa). Uma lambda que não captura nada
vira método de instância de um singleton, e o delegate dela é criado uma vez e
guardado num campo estático. Uma função local que só é chamada diretamente
recebe as capturas numa struct passada por `ref`, então nada vai para o heap.

### Alocações medidas

`GC.GetAllocatedBytesForCurrentThread()` em volta de 1.000 chamadas de cada
método (.NET 10, arm64, depois de uma chamada de aquecimento):

| Forma | Bytes por chamada |
|---|---|
| lambda capturando um local | 88 (display class mais delegate) |
| lambda sem captura | 0 (delegate em cache) |
| função local capturando | 0 (closure em struct, na pilha) |
| conversão implícita de method group estático, `Func<int, int> f = Double;` | 0 |
| `new Func<int, int>(Double)` explícito | 64 |

A linha do method group é uma mudança do C# 11: o compilador passou a guardar
em cache o delegate de um method group estático, como já fazia com lambdas sem
captura. Escrever `new Func<...>(...)` explicitamente abre mão do cache.

### A alocação acontece onde o escopo começa

A display class é criada quando o escopo da variável capturada começa, não
quando a lambda roda. Para um parâmetro, isso é o início do método:

```csharp
static int Sum(int[] items, int factor)
{
    if (items.Length == 0) return 0;               // the fast path still pays
    return items.Select(x => x * factor).Sum();
}
// Sum([], 3) allocates 24 bytes per call
```

Quando o caminho rápido importa, leve o código que captura para outro método
ou para uma função local, para que a closure só seja montada no caminho que a
usa.

### Uma closure por escopo, compartilhada por todas as lambdas

Todas as lambdas de um mesmo escopo compartilham uma display class. Uma lambda
de vida curta e outra de vida longa, portanto, mantêm vivas as capturas uma da
outra:

```csharp
public static Func<int> Make(byte[] big, int small)
{
    Func<int> a = () => big.Length;     // used once, here
    Console.WriteLine(a());
    return () => small;                 // returned and stored
}
// lowered: one <>c__DisplayClass0_0 with fields 'big' and 'small'
```

O delegate devolvido só lê `small`, mas segura a display class, que segura
`big`. É uma fonte clássica de vazamento em handlers de evento e caches.

### Lambdas e funções locais `static`

Colocar `static` (em lambdas desde o C# 9, em funções locais desde o C# 8)
proíbe capturas, e uma alocação acidental vira erro de compilação:

```csharp
int factor = 3;
Func<int, int> f1 = static x => x * factor;
// error CS8820: A static anonymous function cannot contain a reference to 'factor'.
static int StaticLocal(int x) => x * factor;
// error CS8421: A static local function cannot contain a reference to 'factor'.
```

Use `static` em lambdas de caminho quente e em bibliotecas; passe o estado
necessário por um overload que recebe um argumento `state`, quando a API
oferece um.

### Tipo da lambda, tipo de retorno e valores padrão

Desde o C# 10, uma lambda tem tipo natural quando os tipos dos parâmetros são
conhecidos, então `var` funciona. O C# 10 também permite tipo de retorno
explícito, e o C# 12 permite valores padrão de parâmetro, caso em que o tipo
natural é um delegate sintetizado pelo compilador em vez de `Func`:

```csharp
var square = (int x) => x * x;               // Func`2
var choose = object (bool b) => b ? 1 : "one";
var inc = (int x, int by = 1) => x + by;     // <>f__AnonymousDelegate0`3
Console.WriteLine($"{inc(5)} {inc(5, 10)}"); // 6 15

var g = int.Parse;   // error CS8917: The delegate type could not be inferred.
```

Um method group sobrecarregado como `int.Parse` não tem um único tipo natural,
então ali o `var` precisa de uma lambda ou de um tipo de delegate explícito.

### Modificadores de parâmetro sem tipo (C# 14)

Antes do C# 14, um parâmetro de lambda com `ref`, `out`, `in`, `ref readonly`
ou `scoped` obrigava a escrever o tipo de todos os parâmetros. O C# 14 deixa o
modificador sozinho, com os tipos inferidos do delegate de destino:

```csharp
delegate bool TryParse<T>(string text, out T result);
delegate void RefAction<T>(ref T value);

TryParse<int> p = (text, out result) => int.TryParse(text, out result);
RefAction<int> twice = (ref x) => x *= 2;
// p("17", out var v) is true, v = 17; twice(ref n) turns 21 into 42
```

Com `LangVersion` 13, as mesmas linhas falham com o erro CS9260 "Feature
'simple lambda parameter modifiers' is not available in C# 13.0". O
modificador `params` é a exceção: `(params xs) => ...` continua sendo o erro
CS9272 e precisa de tipo explícito.

### Função local ou lambda

Uma função local pode ser genérica, recursiva, iteradora ou `async`, pode ser
chamada antes da declaração e pode ter atributos (C# 9). Ela não pode ser
sobrecarregada: duas funções locais com o mesmo nome num método dão o erro
CS0128. A principal vantagem prática é a closure em struct: enquanto ela só é
chamada, sem virar delegate, capturar não custa nada no heap. A documentação
acrescenta uma segunda condição: nenhuma das variáveis que ela captura pode
ser capturada também por uma lambda que vira delegate, porque aí as duas
compartilham a closure em classe. O padrão de guard dos conceitos anteriores
usa exatamente isso: um método público valida na hora e devolve o resultado
de uma função local async ou iteradora.

Variáveis de laço capturadas seguem a mesma regra de "variáveis, não valores"
mostrada no conceito de execução adiada do LINQ: a variável do `foreach` é uma
variável nova a cada iteração (as lambdas devolvem 0, 1, 2), enquanto o
contador de um `for` é uma única variável compartilhada por todas as lambdas
criadas no laço (3, 3, 3).

## Trade-offs

- **Lambdas são concisas; funções locais saem mais baratas quando ficam
  locais.** Converter uma função local em delegate (passá-la para um `Select`)
  traz de volta a closure em classe e a alocação.
- **Capturas escondem estado.** Uma lambda que captura cinco variáveis é uma
  classe com cinco campos que ninguém declarou. Passe valores como parâmetro
  quando a closure ficaria grande ou de vida longa.
- **Lambdas `static` trocam conveniência por garantia.** Elas obrigam a passar
  o estado explicitamente, o que dá mais código e nenhuma alocação escondida.
  ```csharp
  cache.GetOrAdd(key, static (k, arg) => Load(k, arg), factor);
  ```
- **Display classes compartilhadas estendem tempos de vida.** Um delegate
  guardado num evento ou num campo estático mantém vivas todas as variáveis
  capturadas por qualquer lambda do escopo dele.
- **A inferência de tipo tem bordas.** Method groups sobrecarregados não têm
  tipo natural, e `params` ainda exige tipos explícitos nos parâmetros da
  lambda, mesmo no C# 14.

## Documentation Links

- [Lambda expressions and anonymous functions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions) (doc)
- [Local functions, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/local-functions) (doc)
- [What's new in C# 14: simple lambda parameters with modifiers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Simple lambda parameters with modifiers, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/simple-lambda-parameters-with-modifiers) (doc)
- [Lambda improvements, C# 10 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-10.0/lambda-improvements) (doc)
- [C# language version history, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
