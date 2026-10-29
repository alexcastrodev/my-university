---
version: 1.0
updatedAt: 2026-10-28
title: "Atributos: Personalizados e Lidos pelo Compilador"
summary: Como declarar um atributo com AttributeUsage e os erros de compilação das suas regras, targets como assembly, return e field, leitura por reflection e o custo de cada consulta, Inherited em overrides, os atributos que o compilador interpreta (caller info, Conditional, Obsolete, Experimental, nulabilidade, ModuleInitializer, SetsRequiredMembers, InlineArray) e um dispatcher de comandos com os avisos de trimming.
---
## Objective

Um atributo é uma classe cujas instâncias ficam gravadas como metadados em um
assembly, tipo, membro, parâmetro ou valor de retorno. Código e frameworks os
leem em runtime por reflection; o compilador lê outros durante o build, e eles
mudam o que ele emite ou reporta. Este conceito, no .NET 10 / C# 14, declara um
atributo e os erros de compilação das suas regras, lê o atributo com cada API de
reflection, mede `Inherited` em overrides e o custo de cada consulta, percorre os
atributos que o compilador interpreta e monta um dispatcher com `[Command]`.

## Use Cases

- Marcar classes para uma varredura no startup montar um registro sem lista manual.
- Helpers de guard e de assert que informam o chamador e a expressão que falhou.
- Depreciar ou lançar em preview uma API com id de diagnóstico e link próprios.
- Remover chamadas só de debug dos builds de release e anotar contratos de null.

## Deep Dive

### Declarando um atributo

Uma classe de atributo deriva de `Attribute` e, por convenção, termina em
`Attribute`; o sufixo é opcional no uso, então `[Tag]` e `[TagAttribute]` se
ligam à mesma classe. `[AttributeUsage]` diz onde ele pode aparecer
(`AttributeTargets`), se pode se repetir (`AllowMultiple`) e se classes
derivadas e membros que fazem override o enxergam (`Inherited`).

```csharp
[AttributeUsage(AttributeTargets.All, AllowMultiple = true, Inherited = false)]
sealed class TagAttribute(string name) : Attribute
{
    public string Name { get; } = name;      // posicional: um parâmetro do construtor
    public int Priority { get; set; }        // nomeado: uma propriedade pública de leitura e escrita
    public string[]? Kinds { get; set; }
    public Type? Target { get; set; }
}

[Tag("billing", Priority = 2, Kinds = ["pdf", "csv"], Target = typeof(Invoice))]
[Tag("audit")]
class Invoice { /* ... */ }
```

Uma classe sem `[AttributeUsage]` reporta `All False True` (qualquer target, sem
repetição, herdado). Os argumentos ficam nos metadados, então precisam ser
valores de compilação. Um build com os erros (`OnlyClass` só aceita classe) dá:

```text
[Tag(DateTime.Now.ToString())]  CS0182: An attribute argument must be a constant expression,
                                typeof expression or array creation expression of an
                                attribute parameter type
ctor(decimal amount)            CS0181: Attribute constructor parameter 'amount' has type
                                'decimal', which is not a valid attribute parameter type
[OnlyClass] on a method         CS0592: Attribute 'OnlyClass' is not valid on this
                                declaration type. It is only valid on 'class' declarations.
[OnlyClass, OnlyClass]          CS0579: Duplicate 'OnlyClass' attribute
```

Atribuir por nome uma propriedade só de leitura é CS0617, uma classe que não
deriva de `Attribute` é CS0616, e existir `Foo` e `FooAttribute` torna `[Foo]`
ambíguo (CS1614).

### Targets: assembly, return, field e property

Um prefixo escolhe o elemento que recebe o atributo (`assembly`, `module`,
`field`, `event`, `method`, `param`, `property`, `return`, `type`). A doc avisa
que `return:` é obrigatório mesmo se o `AttributeUsage` só permitir retornos.

```csharp
[assembly: AssemblyMetadata("Team", "payments")]
class Invoice
{
    [field: Tag("backing")] public int Amount { get; set; }   // o campo de apoio
    [property: Tag("prop")] public int Tax { get; set; }      // a propriedade (padrão)
    [field: Tag("field-kw")] public string Note { get; set => field = value.Trim(); } = "";
    [return: Tag("money")] public decimal Total() => Amount + Tax;
}
// <Amount>k__BackingField and <Note>k__BackingField: CompilerGenerated, DebuggerBrowsable, Tag
// property Tax: Tag    Total().ReturnParameter: money    assembly: Team=payments
```

`[field:]` funciona em auto-property e em propriedade do C# 14 que usa `field`,
pois as duas ganham um campo de apoio gerado. Com accessors escritos à mão não
há campo, e é só o warning CS0657 (`'field' is not a valid attribute location
for this declaration. ... All attributes in this block will be ignored.`).

### Lendo atributos, e o que cada consulta custa

```csharp
typeof(Invoice).IsDefined(typeof(TagAttribute));       // True, nenhuma instância criada
typeof(Invoice).GetCustomAttributes<TagAttribute>();   // as duas instâncias de Tag
typeof(Invoice).GetCustomAttribute<TagAttribute>();    // para atributos que não se repetem:
// AmbiguousMatchException: Multiple custom attributes of the same type 'TagAttribute' found.
foreach (var d in typeof(Invoice).GetCustomAttributesData()) Console.WriteLine(d);
// [System.Runtime.CompilerServices.NullableContextAttribute((Byte)1)]  (adicionado pelo compilador)
// [TagAttribute("billing", Priority = 2, Kinds = new String[2] { "pdf", "csv" }, Target = typeof(Invoice))]

var a1 = typeof(Invoice).GetCustomAttribute<OneAttribute>();
var a2 = typeof(Invoice).GetCustomAttribute<OneAttribute>();
ReferenceEquals(a1, a2);   // False, e o construtor rodou duas vezes
a1.Value = "mutated";      // a próxima consulta ainda devolve "v1"
```

`GetCustomAttributesData()` nunca rodou o construtor (um contador ficou em 0);
as outras consultas criam uma instância nova. Em 100.000 chamadas em Release,
`GetCustomAttribute<T>` levou cerca de 70 ms e 400 bytes por chamada,
`IsDefined` cerca de 35 ms e 96 bytes, e um resultado guardado em
`static readonly` menos de 1 ms e 0 bytes.

### Inherited, medido em classes e overrides

Pela doc, `Inherited` vale para "derived classes and overriding members", e os
métodos de `MemberInfo` ignoram `inherit` em propriedades e eventos. Com `[Inh]`
(`Inherited = true`) e `[NoInh]` (`false`) em uma base e nos seus membros
virtuais, sobrescritos na derivada, e `inherit: true` em toda chamada:

```text
derived class         Inh=True  NoInh=False
override method       Inh=True  NoInh=False   (MemberInfo and Attribute agree)
override property     MemberInfo.IsDefined=False     Attribute.IsDefined=True
override event        MemberInfo.IsDefined=False     Attribute.IsDefined=True
override's parameter  ParameterInfo.IsDefined=False  Attribute.IsDefined=True
class implementing an [Inh] interface: False with both APIs
```

### Caller information: guards e asserts

O compilador preenche em cada chamada os parâmetros opcionais com atributos de
caller info (um argumento explícito vence); `CallerArgumentExpression` (C# 10)
recebe o texto-fonte de outro argumento, veja o conceito de guard clauses.

```csharp
static int Positive(int value, [CallerArgumentExpression(nameof(value))] string? expr = null)
    => value > 0 ? value : throw new ArgumentOutOfRangeException(expr, value, "must be positive");
static void That(bool condition, [CallerArgumentExpression(nameof(condition))] string? expr = null,
    [CallerMemberName] string member = "", [CallerLineNumber] int line = 0)
{ if (!condition) throw new InvalidOperationException($"Check failed in {member} line {line}: {expr}"); }

Positive(qty * 2);          // must be positive (Parameter 'qty * 2')  Actual value was -6.
That(qty > 0 && qty < 10);  // Check failed in <Main>$ line 87: qty > 0 && qty < 10
```

### Conditional, Obsolete e Experimental

`[Conditional("SYMBOL")]` remove as chamadas, com as expressões dos argumentos,
quando o símbolo não está definido; o método precisa ser `void` (senão, CS0578).

```csharp
[Conditional("DEBUG")] static void Debug(string s) => Console.WriteLine($"debug {s}");
Debug(Expensive());   // Debug: "Expensive() ran", "debug x".  Release: nada.
```

`TRACE` é definido nas duas configurações, então chamadas `[Conditional("TRACE")]`
rodaram também em Release. Chamadas a uma biblioteca referenciada reportam:

```text
[Obsolete("Use NewPay instead")]          warning CS0618: 'Api.OldPay()' is obsolete: 'Use NewPay instead'
[Obsolete("Removed in v3", error: true)]  error CS0619: 'Api.Gone()' is obsolete: 'Removed in v3'
[Obsolete("Use Sum2", DiagnosticId = "LIB0001", UrlFormat = "https://example.com/obsolete/{0}")]
    warning LIB0001: 'Api.Sum()' is obsolete: 'Use Sum2' (https://example.com/obsolete/LIB0001)
[Experimental("LIBEXP01")]
    error LIBEXP01: 'Lib.Api.Preview()' is for evaluation purposes only and is subject to
    change or removal in future updates. Suppress this diagnostic to proceed.
```

Um `DiagnosticId` próprio silencia uma depreciação sem esconder todo CS0618.
`Experimental` é um **erro** com o id escolhido (sem código CSxxxx), embora a
página de atributos do C# fale em warning; dispara também no assembly que o
declara, `#pragma warning disable LIBEXP01` faz compilar, e id vazio é CS9211.

### Outros atributos que o compilador lê

- **Análise de nulabilidade**: `[NotNull]`, `[MaybeNull]`, `[NotNullWhen(true)]`
  e `[MemberNotNull]` dizem o que um método garante; `b.Name.Length` depois de
  um `Init()` marcado com `[MemberNotNull(nameof(Name))]` não gera aviso, sem o
  atributo é CS8602. O conceito de nullable reference types tem a tabela toda.
- **`[DoesNotReturn]`** marca throw helpers para essa análise; um método marcado
  que pode retornar recebe CS8763 (`A method marked [DoesNotReturn] should not return.`).
- **`[ModuleInitializer]`** roda quando o assembly carrega, antes do `Main`; um
  método que não seja static, sem parâmetros e `void` recebe CS8815.
- **`[SetsRequiredMembers]`**: um construtor que não define um membro `required`
  obriga um inicializador (CS9035); com o atributo o compilador confia sem checar:
  um construtor vazio compilou e deixou `Name` null, só com o warning CS8618.
- **`[InlineArray(8)]`** em uma struct de um campo cria um buffer fixo:
  `Unsafe.SizeOf<Buffer8>()` é 32 para `int`, e ela converte para `Span<int>`.
- **`[StringSyntax]`** diz a editores e analyzers o que uma string contém; o
  build não reporta nada. O construtor de `Regex` tem `StringSyntax("Regex")`.

### Um dispatcher com [Command], e os seus avisos de trimming

```csharp
[AttributeUsage(AttributeTargets.Class)]
sealed class CommandAttribute(string name) : Attribute { public string Name { get; } = name; }
[Command("greet")] sealed class Greet : ICommand { public string Run(string[] a) => $"hello, {a[0]}"; }

var commands = typeof(Program).Assembly.GetTypes()
    .Where(t => typeof(ICommand).IsAssignableFrom(t) && !t.IsAbstract)
    .Select(t => (attr: t.GetCustomAttribute<CommandAttribute>(), t))
    .Where(x => x.attr is not null)
    .ToDictionary(x => x.attr!.Name, x => (ICommand)Activator.CreateInstance(x.t)!,
                  StringComparer.OrdinalIgnoreCase);
// com uma classe [Command("add")] também: "greet ana" -> hello, ana   "ADD 2 3" -> 5
```

A varredura roda uma vez e o dicionário é o cache, mas o trimmer não a segue:
`-p:EnableTrimAnalyzer=true` reporta IL2026 em `GetTypes()` (`... can break
functionality when trimming application code. Types might be removed.`) e IL2077 em `Activator.CreateInstance(Type)`. `t.GetMethods()` em um parâmetro
`Type` comum é IL2070, que some ao anotar o parâmetro com
`[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)]`
(veja o conceito de native AOT). Source generators leem atributos da própria
compilação, como `[GeneratedRegex]` e `[JsonSerializable]` fazem, e poderiam
emitir esse dicionário como código. Frameworks leem os seus em runtime: ASP.NET
Core `[HttpGet]`, DataAnnotations `[Required]`, EF Core `[Key]`.

## Trade-offs

- **Ler em runtime custa a cada chamada.** Cada consulta decodifica metadados e
  aloca uma instância nova; faça cache por tipo ou membro, como o dispatcher faz.
- **`[field:]` pode sumir em silêncio.** Sem campo de apoio é só o CS0657:
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);CS0657</WarningsAsErrors>
  ```
- **Atributos lidos pelo compilador agem longe da declaração.** Uma chamada
  `[Conditional]` também pula os efeitos colaterais dos argumentos, e
  `[SetsRequiredMembers]` desliga uma checagem em vez de fazê-la.
- **Varreduras por reflection brigam com o trimming.** Um source generator não.

## Documentation Links

- [Attributes and reflection, C# guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) (doc)
- [Attributes interpreted by the compiler: Miscellaneous, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/general) (doc)
- [Attributes interpreted by the compiler: Tracking caller information, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/caller-information) (doc)
- [Attributes interpreted by the compiler: Nullable static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [AttributeUsageAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.attributeusageattribute) (doc)
