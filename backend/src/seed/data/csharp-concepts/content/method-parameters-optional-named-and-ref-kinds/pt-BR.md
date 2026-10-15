---
version: 1.0
updatedAt: 2026-10-15
title: "Parâmetros de Método: Opcionais, Nomeados e Tipos de ref"
summary: Valores padrão gravados no chamador (com uma quebra binária reproduzida e o IL que a explica), argumentos nomeados, resolução de overload na prática, ref, out, in e ref readonly do C# 12, e as cópias defensivas de structs que não são readonly.
---
## Objective

A assinatura de um método é um contrato com dois lados, e o C# leva parte do
trabalho para o lado de quem chama, em tempo de compilação. Parâmetros
opcionais são preenchidos pelo compilador do chamador, então mudar um valor
padrão não alcança código que já foi compilado. A resolução de overload
escolhe um método comparando conversões, com critérios de desempate que
surpreendem. E os tipos de ref (`ref`, `out`, `in`, `ref readonly`) decidem se
o método chamado vê uma cópia, um alias gravável ou um alias somente leitura,
com cópias defensivas escondidas quando a struct não é `readonly`. Este
conceito cobre essas regras com experimentos, incluindo uma quebra binária de
verdade e o IL que a explica.

## Use Cases

- Adicionar um parâmetro a um método público sem quebrar quem já chama.
- Deixar legível no ponto da chamada uma chamada com vários booleanos ou
  números.
- Escolher entre overloads e parâmetros opcionais ao desenhar uma API.
- Passar structs grandes sem copiá-las e sem deixar o método chamado
  modificá-las.
- Devolver mais de um valor num método no estilo `TryX`.

## Deep Dive

### Parâmetros opcionais ficam gravados no chamador

Um parâmetro com valor padrão (`int timeoutSeconds = 30`) é marcado como
`[opt]` nos metadados, e o padrão fica guardado como constante. Quando quem
chama omite o argumento, o compilador do chamador lê essa constante e a
emite na chamada. O método chamado nunca "aplica" o padrão em tempo de
execução. Isso leva a uma quebra binária, que este experimento reproduz com
uma class library e um app de console que referencia a DLL compilada:

```csharp
// Lib v1 (v2 only changes the default to 5)
public static string Get(string url, int timeoutSeconds = 30) => $"GET {url} with timeout {timeoutSeconds}s";
// App
Console.WriteLine(Lib.Http.Get("/orders"));
```

```text
v1 lib, app built against v1:          GET /orders with timeout 30s
v2 lib dropped in, app NOT rebuilt:    GET /orders with timeout 30s
app rebuilt against v2:                GET /orders with timeout 5s
```

O IL do app recompilado, lido com `ilspycmd -il`, mostra o motivo: o argumento
é um literal no chamador, e a biblioteca só carrega metadado.

```text
// App.dll, <Main>$
IL_0000: ldstr "/orders"
IL_0005: ldc.i4.5
IL_0006: call string [Lib]Lib.Http::Get(string, int32)

// Lib.dll, Get
[opt] int32 timeoutSeconds
.param [2] = int32(5)
```

Ou seja, um valor padrão faz parte do contrato público, como um `const`. Numa
biblioteca que outros compilam contra, trate a mudança dele como breaking
change, ou use um overload cujo corpo fornece o valor, resolvido em tempo de
execução.

### Argumentos nomeados

Argumentos nomeados deixam o ponto da chamada dizer o que cada valor significa
e pular parâmetros opcionais do meio. Desde o C# 7.2, um argumento nomeado
também pode vir antes de posicionais, desde que esteja na posição correta:

```csharp
static void Send(string to, string subject = "(none)", string body = "") => ...

Send(to: "ana", body: "hi");             // to=ana subject=(none) body=hi
Send("ana", subject: "re", "hello");     // to=ana subject=re body=hello
```

Os nomes dos parâmetros também entram no contrato: renomear um parâmetro
quebra, em tempo de compilação, todo chamador que usou o nome.

### Resolução de overload na prática

O compilador reúne os candidatos aplicáveis e escolhe aquele cujos tipos de
parâmetro são a melhor conversão para cada argumento. Alguns resultados da
mesma execução:

```csharp
static void Show(long x)   { }
static void Show(double x) { }
Show(5);     // Show(long): int -> long is better than int -> double
Show(5f);    // Show(double): the only candidate that accepts a float

static void Pick(int a) { }
static void Pick(int a, int b = 0) { }
Pick(1);     // Pick(int): on a tie, the candidate with no omitted optionals wins
Pick(1, 2);  // Pick(int, int = 0)

static void Box(object? o) { }
static void Box(string? s) { }
Box(null);   // Box(string): string converts to object, so it is more specific

static void Sum(params int[] xs) { }
static void Sum(params ReadOnlySpan<int> xs) { }
Sum(1, 2, 3); // Sum(params ReadOnlySpan<int>)
```

O último caso é o `params` com coleções do C# 13, visto no conceito de
interfaces de coleção: quando os dois existem, o overload com span vence e
evita a alocação do array. Misturar overloads e parâmetros opcionais no mesmo
grupo de métodos é o que deixa a resolução difícil de prever; escolha um
estilo por nome de método.

### `ref`, `out`, `in` e `ref readonly`

Por padrão, um argumento é passado por valor: o método chamado recebe uma
cópia do valor (para uma classe, uma cópia da referência). Os tipos de ref
passam um alias para a variável de quem chama:

| Modificador | Chamado pode ler | Chamado pode escrever | Quem chama precisa passar | Desde |
|---|---|---|---|---|
| `ref` | sim | sim | uma variável atribuída, com `ref` | C# 1 |
| `out` | depois de atribuir | precisa atribuir antes de retornar | uma variável, com `out` | C# 1 |
| `in` | sim | não | uma variável, ou qualquer valor (cria-se um temporário) | C# 7.2 |
| `ref readonly` | sim | não | uma variável, com `ref` ou `in` | C# 12 |

O `out` combina com declarações `out var` e com descartes:
`int.TryParse(s, out _)` checa uma string sem guardar o número.

`in` e `ref readonly` significam "alias somente leitura", mas o `in` aceita
de bom grado um rvalue e o copia em silêncio para um temporário, enquanto o
`ref readonly` pede uma variável de verdade. O compilador avisa quando essa
intenção não é cumprida:

```csharp
static void PeekReadonly(ref readonly Counter c) { }
static void PeekValue(ref readonly int v) { }

PeekReadonly(new Counter()); // warning CS9193: Argument 1 should be a variable because it is passed to a 'ref readonly' parameter
int x = 3;
PeekValue(x);                // warning CS9192: Argument 1 should be passed with 'ref' or 'in' keyword
PeekValue(in x);             // fine
```

A documentação de referência resume assim: quando a API exige que o argumento
seja passado por referência (ele deve apontar para um local real, não para um
temporário), escolha `ref readonly`; quando o objetivo é só evitar a cópia de
um valor grande, `in` basta. Nenhum tipo de ref pode ser usado em métodos
`async` ou iteradores (erros CS1988 e CS1623): os parâmetros deles são
içados para um objeto de máquina de estados no heap, e uma referência a uma
variável de quem chama não pode ser guardada ali.

### Cópias defensivas

Um alias somente leitura para uma struct mutável tem um problema: chamar um
método nela pode alterá-la. O compilador não sabe se `Increment()` escreve,
então chama o método numa cópia escondida:

```csharp
struct Counter { public int Value; public void Increment() => Value++; }

static void Peek(in Counter c)
{
    c.Increment();                 // compiles, but runs on a copy
    Console.WriteLine(c.Value);    // 1: the value it had before the call
}
```

É uma surpresa de corretude (a chamada não faz nada) e de desempenho (a
cópia é justamente o que o `in` deveria evitar). Declarar a struct como
`readonly struct`, ou marcar membros específicos como `readonly`, avisa o
compilador que a cópia não é necessária. Passe structs grandes com `in` só
quando elas forem `readonly`.

## Trade-offs

- **Parâmetros opcionais versus overloads.** Opcionais mantêm a superfície
  pequena e as chamadas legíveis, mas os valores ficam compilados nos
  chamadores. Overloads carregam o padrão dentro da biblioteca, o que é mais
  seguro para pacotes públicos.
  ```csharp
  public static string Get(string url) => Get(url, timeoutSeconds: 30); // default lives here
  public static string Get(string url, int timeoutSeconds) => ...;
  ```
- **Argumentos nomeados tornam públicos os nomes de parâmetro.** Chamadas
  legíveis, ao custo de nunca renomear um parâmetro numa API publicada.
- **`in` não é de graça.** Para valores pequenos, passar por valor é mais
  simples e tão rápido quanto (a própria referência observa que não há ganho
  para um único `int`); para structs mutáveis, ele acrescenta cópias
  defensivas.
- **`out` versus tupla ou record de retorno.** `TryX(out T)` combina com `if`;
  uma tupla fica mais clara quando toda saída sempre tem valor.
- **Parâmetros booleanos escondem a intenção.** `Export(true, false)` pede
  argumentos nomeados ou, melhor ainda, um enum ou um tipo de opções.

## Documentation Links

- [Method parameters and modifiers, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters) (doc)
- [Named and optional arguments, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/named-and-optional-arguments) (doc)
- [What's new in C# 12: ref readonly parameters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
- [Structure types: readonly struct, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [Overload resolution, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1264-overload-resolution) (doc)
