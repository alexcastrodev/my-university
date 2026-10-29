---
version: 1.0
updatedAt: 2026-10-28
title: "Reflection: Metadados de Tipos e Seus Custos"
summary: typeof, GetType e Type.GetType, as armadilhas de BindingFlags, membros privados, Activator e Invoke com ref e out, TargetInvocationException, genéricos, NullabilityInfoContext, ReflectionTypeLoadException, o custo medido contra delegates e UnsafeAccessor, e o que quebra com trimming e Native AOT.
---
## Objective

`System.Reflection` lê os metadados do assembly em tempo de execução: listar
propriedades, chamar um método pelo nome, ler um campo privado, montar `List<T>`
para um `T` conhecido só em execução. Serializers, DI e test runners nasceram
dela. Os custos passam despercebidos: buscas vazias por causa do `BindingFlags`
errado, exceções embrulhadas, boxing, e código que o trimmer e o Native AOT não
enxergam. Este conceito cobre a API no .NET 10 / C# 14, o custo medido, o que a
substitui e o trimming.

## Use Cases

- Um carregador de plugins, test runner ou mapper que descobre tipos desconhecidos.
- Ler ou alterar um campo privado num teste, ou para contornar uma biblioteca.
- Trocar um `PropertyInfo.GetValue` quente por um delegate ou `[UnsafeAccessor]`.
- Preparar código para `PublishTrimmed` ou `PublishAot` (IL2xxx e IL3050).

## Deep Dive

### Obtendo um Type

`typeof(T)` é resolvido na compilação, `obj.GetType()` dá o tipo em execução (e
lança `NullReferenceException` em `null`), e `Type.GetType(string)` lê um nome:

```csharp
Animal a = new Dog(); Console.WriteLine($"{typeof(Animal)} {a.GetType()}");  // Animal Dog
Console.WriteLine(typeof(Dog).AssemblyQualifiedName);
// Dog, Basics, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null
Type.GetType("Dog");                                       // found: current assembly
Type.GetType("System.Text.Json.JsonSerializer");           // null
Type.GetType("System.Text.Json.JsonSerializer, System.Text.Json");  // found
Type.GetType("System.Text.Json.JsonSerializer", throwOnError: true);
// TypeLoadException: Could not resolve type 'System.Text.Json.JsonSerializer'
// in assembly 'Basics, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null'.
```

Como diz a documentação, um nome só com namespace acha apenas tipos do assembly
chamador ou do `System.Private.CoreLib` (`"System.Int32"` resolveu); senão,
inclua o assembly. Tipos aninhados usam `+` (`"Outer.Inner"` retornou `null`).

### Descoberta e as armadilhas de BindingFlags

`GetProperties()`, `GetFields()`, `GetMethods()`, `GetConstructors()` e
`GetMembers()` sem argumentos usam `Public | Instance | Static`. Passar flags
substitui esse padrão; não soma a ele:

```csharp
typeof(Dog).GetProperties();                          // Name, Species, Sound
typeof(Dog).GetProperties(BindingFlags.Instance);     // (empty)
typeof(Dog).GetProperties(BindingFlags.Public | BindingFlags.Instance
                          | BindingFlags.DeclaredOnly);   // Name
typeof(Dog).GetFields(BindingFlags.NonPublic | BindingFlags.Instance);
// <Name>k__BackingField, <Age>k__BackingField, <Secret>k__BackingField
typeof(Dog).GetFields();                              // Id, Kind (no Animal.Population)
typeof(Dog).GetFields(BindingFlags.Public | BindingFlags.Static
                      | BindingFlags.FlattenHierarchy);   // Kind, Population
typeof(Dog).GetMethod("Speak");
// AmbiguousMatchException: Ambiguous match found for 'Dog System.String Speak()'.
typeof(Dog).GetMethod("Speak", [typeof(int)]);        // System.String Speak(Int32)
```

`Instance` sozinho não acha nada: some `Public`, `NonPublic` ou os dois.
Estáticos herdados exigem `FlattenHierarchy`, e a documentação diz que mesmo
assim só voltam públicos e protegidos (o `private static` da base nunca
apareceu). Privados da base só aparecem no próprio tipo base. Passe os tipos dos
parâmetros em sobrecargas; nomes diferenciam maiúsculas sem `IgnoreCase`. Sobre a ordem, a documentação da API diz "starting
with .NET 7, the ordering is deterministic based upon the metadata ordering in
the assembly" (antes era indefinida); `class Order3 { Z; A; M(); B }` deu
`Z, A, B`. Mesmo assim, ordene explicitamente.

### Membros privados, criação de instâncias, invocação

```csharp
typeof(Animal).GetField("_secret", BindingFlags.NonPublic | BindingFlags.Instance)!
    .SetValue(dog, "changed");                           // private field: works
typeof(Dog).GetField("Id")!.SetValue(dog, 99);           // readonly instance field: works
typeof(Dog).GetProperty("Name")!.SetValue(dog, "Rex2");  // private setter: works
typeof(Cfg).GetField("Limit")!.SetValue(null, 5);        // static readonly
// FieldAccessException: Cannot set initonly static field 'Limit' after type 'Cfg' is initialized.
// (a const field: FieldAccessException: Cannot set a constant field.)

Activator.CreateInstance(typeof(Dog), "Bolt");       // picks Dog(string)
Activator.CreateInstance(typeof(Dog), 5);            // Dog(int) is private
// MissingMethodException: Constructor on type 'Dog' not found.
Activator.CreateInstance(typeof(Dog), BindingFlags.NonPublic | BindingFlags.Instance,
    null, [5], null);                                // works
typeof(Dog).GetConstructor([typeof(string)])!.Invoke(["Ace"]);

object?[] callArgs = [10, null];                     // static bool TryHalf(int n, out int half)
var ok = typeof(Calc).GetMethod("TryHalf")!.Invoke(null, callArgs);
Console.WriteLine($"{ok} {callArgs[1]}");            // True 5: the out value lands in the array

var boom = typeof(Calc).GetMethod("Boom")!;          // throws InvalidOperationException("boom inside")
boom.Invoke(null, null);  // TargetInvocationException: Exception has been thrown by
                          // the target of an invocation. (InnerException: boom inside)
boom.Invoke(null, BindingFlags.DoNotWrapExceptions, null, null, null);
// InvalidOperationException: boom inside   (no wrapper)
```

`ref` e `out` passam pelo array de argumentos (o parâmetro aparece como
`System.Int32&`). Erros na chamada saem direto (`TargetParameterCountException:
Parameter count mismatch.`; `TargetException: Non-static method requires a
target.` para instância `null`), mas exceção *dentro* do alvo vem embrulhada,
também de construtor via `Activator.CreateInstance` ou getter via `GetValue`.
`BindingFlags.DoNotWrapExceptions` funciona no .NET 10.

### Genéricos, atribuição, nulabilidade, GetTypes

```csharp
var closed = typeof(Dictionary<,>).MakeGenericType(typeof(string), typeof(int));
Console.WriteLine(closed);   // System.Collections.Generic.Dictionary`2[System.String,System.Int32]
// IsGenericTypeDefinition: True for Dictionary<,>; closed.GetGenericArguments(): String, Int32
Activator.CreateInstance(typeof(Dictionary<,>));
// ArgumentException: Cannot create an instance of ...Dictionary`2[TKey,TValue]
// because Type.ContainsGenericParameters is true.
typeof(Calc).GetMethod("Describe")!.MakeGenericMethod(typeof(int)).Invoke(null, [5]);
// "Int32:5" (static string Describe<T>(T v))

typeof(Animal).IsAssignableFrom(typeof(Dog));                       // True
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<string>)); // True (covariance)
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<int>));    // False (value type)
typeof(IEnumerable<>).IsAssignableFrom(typeof(List<int>));          // False (open type)
```

`IsAssignableFrom` lê pelo lado do destino (`IsAssignableTo`, ao contrário) e
ignora conversões numéricas (`long` a partir de `int`: `False`). Para genérico
aberto, busque em `GetInterfaces()` por `GetGenericTypeDefinition()`. Nulabilidade
não faz parte do `Type` (`string?` é `System.String`);
`new NullabilityInfoContext().Create(prop)` a lê: `ReadState` foi `Nullable` para `string? Nick`, `NotNull` para
`string Name`, e `Nullable` em `GenericTypeArguments[0]` de `List<string?>`.

Varrer um assembly falha por inteiro quando um tipo não carrega. Com `LibA.dll`
contendo `Fine`, `Derived : LibB.BaseThing` e `AlsoFine`, e `LibB.dll` apagado,
`asm.GetTypes()` lançou `ReflectionTypeLoadException` ("Unable to load one or
more of the requested types."), seu `Types` trouxe `Fine, AlsoFine, null` e
`LoaderExceptions[0]` disse "Could not load file or assembly 'LibB, ...'".
Use os `ex.Types` não nulos e registre `LoaderExceptions`; `GetExportedTypes()`
apenas lançou `FileNotFoundException`.

### Quanto custa

BenchmarkDotNet 0.15.8, `ShortRunJob`, Apple M4 Max, 1.000 leituras por invocação:

| Leitura de `p.Age` | Por chamada | Alocado |
|---|---|---|
| `p.Age` direto | cerca de 0.26 ns | 0 |
| accessor de campo `[UnsafeAccessor]` | cerca de 0.26 ns | 0 |
| `Func<Person,int>` em cache via `CreateDelegate` | cerca de 1.3 ns | 0 |
| `Expression.Lambda(...).Compile()` em cache | cerca de 1.3 ns | 0 |
| `PropertyInfo.GetValue` em cache | cerca de 5.9 ns | 24 B |
| `GetProperty("Age")` a cada chamada, depois `GetValue` | cerca de 8.5 ns | 24 B |
| `GetProperties()`: `Person` (2) / `HttpRequestMessage` | cerca de 17 / 43 ns | 40 / 208 B |

Um `GetValue` em cache custou cerca de 20 vezes a leitura direta, e os 24 bytes
são o `int` em boxing (uma `string` não alocou nada). Repetir a busca somou só
cerca de 3 ns, mas cada `GetProperties()` retorna um array novo. Monte os
delegates uma vez e guarde em cache (o conceito de árvores de expressão mediu o
`Compile()` como caro).

### UnsafeAccessor: acesso privado sem reflection

O .NET 8 trouxe `[UnsafeAccessor]`: um método `extern` cujo corpo o runtime gera
para alcançar um membro diretamente. O primeiro parâmetro é o tipo alvo:

```csharp
static class Accessors
{
    [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_balance")]
    public static extern ref decimal Balance(Account a);
    [UnsafeAccessor(UnsafeAccessorKind.Method, Name = "Audit")]   // private method
    public static extern string Audit(Account a, string who);
    [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_balanse")]   // typo
    public static extern ref decimal Wrong(Account a);
}
static class BoxAccessors<T>   // generic targets: since .NET 9
{ [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_value")] public static extern ref T Value(Box<T> b); }
Accessors.Balance(acc) = 500m;                  // writes through the ref
Console.WriteLine(Accessors.Audit(acc, "x"));   // x saw 500
Console.WriteLine(BoxAccessors<int>.Value(new Box<int>(42)));   // 42
Accessors.Wrong(acc);   // MissingFieldException: Field not found: 'Account._balanse'.
```

O erro de digitação compilou sem aviso e só falhou na chamada; assinatura de
método errada deu `MissingMethodException: Method not found: 'Account.Audit'.`.
Alvos genéricos exigem classe accessor genérica com os mesmos parâmetros de
tipo. `Constructor` e `StaticField` funcionaram; um accessor de campo rodou
também sob Native AOT.

### Trimming e Native AOT

Publicar um app pequeno com `-p:PublishTrimmed=true`, e com
`-p:PublishAot=true` (funcionou com o toolchain do Xcode já instalado: um
binário de 2 MB), apontou o que o analisador não conseguia seguir: IL2057 em
`Type.GetType(args[0])`, IL2026 em `JsonSerializer.Serialize`, e:

```text
Program.cs(10,13): warning IL2075: 'this' argument does not satisfy 'DynamicallyAccessedMemberTypes.PublicProperties'
  in call to 'System.Type.GetProperties()'. The return value of method 'System.Object.GetType()' does not have ...
```

O AOT acrescentou IL3050 ("...has 'RequiresDynamicCodeAttribute' can break
functionality when AOT compiling") em `JsonSerializer.Serialize` e em
`MakeGenericType`. Os avisos eram reais. Nos dois binários,
``Type.GetType("System.Collections.Generic.PriorityQueue`2, System.Collections")``
retornou `null` (o build sem trimming encontrou), `JsonSerializer.Serialize`
lançou `InvalidOperationException: Reflection-based serialization has been
disabled for this application.`, e sob AOT
`Activator.CreateInstance(typeof(List<>).MakeGenericType(typeof(Guid)))` lançou
``NotSupportedException: 'System.Collections.Generic.List`1[System.Guid]' is
missing native code or metadata.`` (`typeof(int)` funcionou). Os tipos do
próprio app sobreviveram, então uma busca passa localmente e falha num tipo de
biblioteca. Um parâmetro `Type` anotado com
`[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)]` faz
o trimmer manter esses membros, sem aviso no `GetMethod`. A correção segura para
AOT leva o trabalho para a compilação: source generators e a geração de código
do `System.Text.Json` (`[JsonSerializable]` funcionou no binário nativo).

## Trade-offs

- **Flexibilidade custa checagem do compilador.** Nomes de membros são strings;
  use `nameof` quando puder e combinações completas de `BindingFlags`.
- **Cache, depois delegate.** Delegates em cache ficam perto da chamada direta;
  `GetValue` faz boxing. `UnsafeAccessor` é o mais rápido e quebra ao renomear.
- **Reflection e trimming se opõem.** Anote com `DynamicallyAccessedMembers`,
  marque o resto `RequiresUnreferencedCode`; para AOT, use um source generator.

## Documentation Links

- [Reflection in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/overview) (doc)
- [Attributes and reflection (C#), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) (doc)
- [BindingFlags enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.bindingflags?view=net-10.0) (doc)
- [Type.GetProperties method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.type.getproperties?view=net-10.0) (doc)
- [UnsafeAccessorAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafeaccessorattribute?view=net-10.0) (doc)
- [Prepare .NET libraries for trimming, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) (doc)
