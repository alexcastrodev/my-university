---
version: 1.0
updatedAt: 2026-11-12
title: "Tipos Union no C# 15: Valores de um Conjunto Fechado de Tipos"
summary: A declaração union do C# 15, o que o compilador gera, patterns que testam o conteúdo, o valor default e CS8509/CS8655, a union escrita à mão sem boxing, o suporte do System.Text.Json e o que acontece em target frameworks antigos.
---
## Objective

Uma declaração `union`, nova no C# 15, nomeia um tipo cujo valor é exatamente um
de uma lista fechada de case types: `union Pet(Cat, Dog, Bird);`. O compilador dá
a ela uma conversão implícita de cada case type e conhece a lista, então um
`switch` que trata todos os case types é exaustivo sem braço `_`, e um que falta
vira warning. Antes do C# 15 a mesma ideia exigia uma classe base abstrata, uma
interface marcadora ou uma biblioteca como OneOf. Este conceito cobre o que a
declaração gera, como patterns leem uma union, o que `default` faz, os
diagnósticos, a union escrita à mão que evita boxing, o suporte do
System.Text.Json e o que acontece em target frameworks antigos. Tudo foi
compilado e executado no SDK 11.0.100.

## Use Cases

- Um resultado de método que é um entre vários tipos sem relação, como um
  pagamento que é `Approved`, `Declined` ou `Pending`, em que o chamador precisa
  tratar cada um.
- Despacho de mensagens ou comandos sobre um conjunto fixo de tipos que não têm
  classe base comum e que você pode não controlar.
- Trocar um `Result<T>` feito à mão ou um genérico do OneOf por um tipo que o
  compilador confere (veja `result-types-versus-exceptions`).
- Um corpo JSON que pode ser número ou string, mapeado para um único tipo C#.

## Deep Dive

### O que uma declaração gera

```csharp
public record class Cat(string Name);
public record class Dog(string Name);
public record class Bird(string Name);
public union Pet(Cat, Dog, Bird);
```

Reflection numa union confirma a forma. `typeof(Pet).IsValueType` é `true`, o
tipo carrega `UnionAttribute` e implementa `IUnion`, e tem um construtor público
por case type mais uma propriedade `Value` do tipo `object?`. Case types podem
ser classes, structs, interfaces, tipos anuláveis, parâmetros de tipo ou outras
unions (`union Option<T>(None, Some<T>)` é válido, segundo a referência). Uma
union não é um record: não adiciona igualdade, clonagem nem desconstrução, e não
adiciona dados próprios. Ela só compõe tipos que já existem.

```csharp
Pet p = new Dog("Rex");        // a conversão implícita chama o construtor de Dog
Console.WriteLine(p.Value);    // Dog { Name = Rex }
```

Quando um case type é de valor, o valor sofre boxing no `object?`:
`union IntOrString(int, string)` guarda o `int` como objeto, e
`IntOrString x = 42; x.Value.GetType()` imprime `System.Int32`, lido desse
objeto. Se dois case types podem aceitar o valor de origem, o compilador escolhe
a melhor conversão pelas regras de sempre: com `union U(int, long)`, `U u = 5;`
guarda um `Int32` e `U v = 5L;` guarda um `Int64`. Quando nenhuma é melhor, é
erro: `union U(IFormattable, IComparable)` com `U u = 5;` dá `CS0457: Ambiguous
user defined conversions`.

Uma declaração pode ter corpo com métodos e propriedades calculadas, mas não
campos de instância, auto-properties nem eventos field-like (`CS9373`), nem um
construtor público explícito com um parâmetro, porque o compilador reserva esses
como membros de criação (`CS9374`).

### Patterns testam o conteúdo

A regra mais importante: numa union, um pattern de tipo ou de declaração testa o
**conteúdo**, não o valor da union. `Dog d` pergunta se `Value` é um `Dog`.

```csharp
string name = p switch
{
    Dog d => d.Name,
    Cat c => c.Name,
    Bird b => b.Name,
};
```

Um pattern recursivo com tipo (`Dog { Name: "Rex" }`) testa o conteúdo e depois
olha dentro do `Dog`. Um pattern recursivo sem tipo usa os membros da própria
union, um pattern `var` ou de descarte captura a própria union, e `null` testa o
conteúdo. Por isso `p is Pet` não compila (`CS8121`): nenhum case type é `Pet`.
E para o valor default, os dois testes naturais discordam:

```csharp
Pet empty = default;
Console.WriteLine(empty is not null);  // False: o conteúdo é nulo
Console.WriteLine(empty is { });       // True: o struct union em si existe
```

Use `is not null` para "tem valor" e um braço `null` num switch.

### Exaustividade e o valor default

Tratar todos os case types dispensa o descarte. Deixar um de fora dá o warning
que você já conhece dos enums, com o case faltante nomeado:

```csharp
Console.WriteLine(p switch { Dog d => 1, Cat c => 2 });
// warning CS8509: ... the pattern 'Bird' is not covered.
```

Um braço de descarte ou `var` esconde esse warning no dia em que alguém
acrescentar um quarto case type, então prefira um braço `null` quando precisar
tratar conteúdo vazio. É no null que unions têm uma lacuna: `default(Pet)` e
qualquer elemento de array ou campo do tipo `Pet` que nunca foi atribuído guardam
`Value` nulo. Para `Pet`, cujos case types são todos não anuláveis, o compilador
rastreia o conteúdo como "not null", então omitir o braço `null` não gera
warning, e o switch lança em runtime:

```csharp
Pet p = default;
p switch { Dog d => 1, Cat c => 2, Bird b => 3 };
// SwitchExpressionException: Non-exhaustive switch expression failed to match
// its input. Unmatched value was Pet.
```

Com um case type anulável, `union NP(Cat?, Dog)`, o conteúdo é "maybe null" e
omitir o braço `null` é `CS8655`, um warning que o lab transforma em erro. Regra
prática: trate `null` sempre que um valor default possa chegar ao switch, o que
vale sempre para unions struct em arrays e campos.

### Uma union escrita à mão, sem boxing

A union gerada é sempre struct e sempre faz boxing de cases de valor. Quando isso
importa, escreva a union você mesmo. Um tipo é uma union se tem `[Union]`, um
construtor público por case type (um parâmetro) e uma propriedade pública
`Value` do tipo `object?`. O **padrão de acesso sem boxing** opcional acrescenta
`HasValue` e um `TryGetValue(out T)` por case type, e então o compilador casa
tipos via `TryGetValue` em vez de ler `Value`:

```csharp
[System.Runtime.CompilerServices.Union]
public struct IntOrText : System.Runtime.CompilerServices.IUnion
{
    private readonly int _int;
    private readonly string? _text;
    private readonly byte _tag; // 0 = nada, 1 = int, 2 = texto

    public IntOrText(int value) { _int = value; _tag = 1; }
    public IntOrText(string? value) { if (value is not null) { _text = value; _tag = 2; } }

    public object? Value => _tag switch { 1 => _int, 2 => _text, _ => null };
    public bool HasValue => _tag != 0;
    public bool TryGetValue(out int value) { value = _int; return _tag == 1; }
    public bool TryGetValue(out string value) { value = _text!; return _tag == 2; }
}
```

No lab, um `switch` sobre mil desses (`int i => i, string s => s.Length, null =>
0`) alocou 0 bytes depois do aquecimento, medido com
`GC.GetAllocatedBytesForCurrentThread`. O contrato de uma union customizada:
`Value` devolve `null` ou um dos case types, um valor criado a partir de um case
type informa esse tipo, e `HasValue` e `TryGetValue` concordam com `Value`. O
compilador confia em você nisso. O mesmo atributo também permite unions baseadas
em classe, e uma interface aninhada `IUnionMembers` (um "union member provider")
quando os construtores precisam ficar privados; os dois estão descritos na
referência da linguagem.

### System.Text.Json

O serializador do .NET 11 trata uma declaração `union` como um contrato de
union. Ele escreve o valor do case sem envelope e lê de volta pelo tipo do token
JSON:

```csharp
IntOrString n = 42, s = "hi";
JsonSerializer.Serialize(n);                     // 42
JsonSerializer.Serialize(s);                     // "hi"
JsonSerializer.Deserialize<IntOrString>("7");    // Value é o int 7
JsonSerializer.Serialize<IntOrString>(default);  // null
JsonSerializer.Deserialize<IntOrString>("true"); // JsonException: nenhum case type serve
```

O limite são cases com o mesmo formato JSON. `Pet` tem três cases em forma de
objeto, então `JsonSerializer.Deserialize<Pet>("{\"Name\":\"R\"}")` lança
`JsonException: JSON value type 'Object' is ambiguous for union type 'Pet'
because multiple case types can use this value type. Specify a custom type
classifier to support deserialization.` Um `TypeClassifier` em `[JsonUnion]` é a
forma de resolver; para contratos novos com vários cases em forma de objeto, uma
hierarquia `closed` com discriminador costuma servir melhor (veja
`closed-classes-and-exhaustive-hierarchies`). Não executei a integração com o
ASP.NET Core; o post do time do ASP.NET diz que unions funcionam como corpo em
Minimal APIs, MVC e SignalR, mas não em query string, rota, header nem form.

### Target frameworks antigos

Uma `union` precisa de `UnionAttribute` e `IUnion` de
`System.Runtime.CompilerServices`, e o runtime do .NET 11 os traz. Em `net10.0` a
mesma declaração é `CS0518: Predefined type
'System.Runtime.CompilerServices.IUnion' is not defined` mais `CS0656` para o
construtor do atributo. Declarar os dois tipos no seu projeto (uma classe de
atributo que permite classes e structs, e `interface IUnion { object? Value { get; } }`)
fez compilar em `net10.0`; compilei isso, mas não executei num runtime .NET 10.
No C# 14 (`LangVersion` 14) não há contorno: `union` é erro de sintaxe. Se o
serializador reconhece um atributo declarado como polyfill é algo a testar antes
de depender disso.

## Trade-offs

- **Boxing para cases de valor.** O struct gerado guarda um `object?`, então
  `union IntOrString(int, string)` aloca para cada `int`. Em caminhos quentes,
  escreva a union à mão com `TryGetValue`, ou use uma hierarquia de classes.
- **`default` é um buraco.** Uma union struct nunca atribuída guarda `null` e pode
  passar pelo compilador. Sempre acrescente um braço `null`.
- **Acrescentar um case type é breaking change para consumidores.** Todo `switch`
  sobre uma union pública fica não exaustivo (warning CS8509) quando você
  acrescenta um case. Por isso union é para conjuntos que você controla e versiona.
- **Union versus hierarquia closed.** Unions agrupam tipos que não precisam de
  base comum, inclusive tipos que você não controla (`int`, `string`). Uma classe
  `closed` torna uma hierarquia exaustiva quando a base é sua. Use a union no
  primeiro caso e a hierarquia no segundo.
- **Union versus exceções e métodos `Try`.** Um resultado union é explícito, mas
  obriga o chamador a escrever um `switch`. Use onde a falha é um desfecho
  esperado, não para erros de programação.
- **Cobertura do ecossistema.** O System.Text.Json conhece unions no .NET 11. Para
  ORM, driver de banco ou mapper, confira o suporte antes de pôr uma union num
  modelo.

## Lab

Neste lab você trabalha com um gateway de pagamento que responde `Approved`, `Declined` ou `Pending`. As declarações das unions já vêm prontas; seu trabalho é o código que as usa, mais uma union escrita à mão. O projeto `src` transforma CS8509 e CS8655 em erros, então um case type faltando não compila.

**O cenário**

`Payments.cs` tem `Payments.Describe`, `DescribeSafe`, `ToJson` e `FromJson`, e o struct `IntOrText` com quatro membros stubados. Os testes usam `default(PaymentResult)`, um case `int`, um case `string` e medem alocações.

**O que você vai fazer, passo a passo**

1. **Switch exaustivo (TODO-00).** Em `Describe`, um braço por case type e nenhum `_`. Um valor `default` deve lançar `SwitchExpressionException`, e o teste confere.
2. **O valor default (TODO-01).** Em `DescribeSafe`, acrescente `null => "no result"`.
3. **JSON (TODO-02).** Implemente `ToJson` e `FromJson` para `IntOrString`: o case é escrito sem envelope e `true` lança `JsonException`.
4. **Sem boxing (TODO-03).** Em `IntOrText`, implemente `Value`, `HasValue` e os dois `TryGetValue`. O teste espera 0 bytes alocados ao somar mil valores.

**Como saber que terminou**

`dotnet test` fica verde com 12 testes. Você deve conseguir dizer por que `Describe(default)` lança e `DescribeSafe(default)` não, e por que `IntOrString` aloca e `IntOrText` não.

**Desafios opcionais**

- Remova o braço `Pending` de `Describe` e leia a mensagem CS8509.
- Quebre `TryGetValue(out int)` de propósito e veja qual teste percebe.

**Pré-requisitos:** `switch` expressions, records e o SDK do .NET 11 (os projetos miram `net11.0`).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo membro stubado lança `NotImplementedException`, então os testes vermelhos são seu checklist.

## Documentation Links

- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [Unions, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/unions) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions and closed hierarchies in ASP.NET Core, .NET Blog](https://devblogs.microsoft.com/dotnet/unions-and-closed-hierarchies-in-aspnetcore/) (doc)
- [Errors and warnings for pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/pattern-matching-warnings) (doc)
