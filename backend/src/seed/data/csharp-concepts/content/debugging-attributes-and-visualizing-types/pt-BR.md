---
version: 1.0
updatedAt: 2026-11-20
title: "Atributos de depuração e visualização de tipos no .NET"
summary: DebuggerDisplay, DebuggerBrowsable, DebuggerTypeProxy, DebuggerStepThrough, DebuggerHidden, DebuggerNonUserCode e StackTraceHidden lidos por CustomAttributeData, o efeito de cada um no StackTrace, Debugger, Debug.Assert e Trace sem depurador, e o que o dotnet-dump ignora.
---
## Objective

Os atributos de `System.Diagnostics` mudam o que um depurador mostra e em quais
frames ele entra, e um deles, `[StackTraceHidden]`, muda o texto de toda
exceção que passa pelo seu código. Um projeto de teste não consegue conduzir um
depurador, então este conceito mede o que um programa observa: os atributos lidos
com `CustomAttributeData`, o proxy do próprio `List<T>` da BCL, como
`StackTrace`, `Exception.StackTrace` e `Environment.StackTrace` reagem a cada
atributo, o que `Debugger`, `Debug.Assert` e `Trace` fazem sem depurador
anexado, e se o `dotnet-dump analyze` respeita algum deles. O que as janelas do
Visual Studio, do Rider ou do VS Code fazem é "só docs": nenhuma IDE rodou aqui.

Versões: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, `dotnet-dump`
10.0.750501, macOS arm64 (Apple M4 Max).

## Use Cases

- Fazer `Customer { First, Last, Orders }` aparecer como `Ana Silva (2 orders)`
  numa janela de watch, em vez de `{Customer}`.
- Mostrar uma coleção própria como seus itens, e não como suas entranhas.

## Deep Dive

### Os atributos, lidos dos metadados

Eles se leem como qualquer atributo (veja
[atributos](/csharp-concepts/attributes-custom-and-compiler-read) e
[reflexão](/csharp-concepts/reflection-type-metadata-and-its-costs)). O
`AttributeUsage` de cada um, medido:

```text
DebuggerDisplayAttribute       Assembly, Class, Struct, Enum, Property, Field, Delegate  multiple=True  inherited=True
DebuggerBrowsableAttribute     Property, Field                                           multiple=False inherited=True
DebuggerTypeProxyAttribute     Assembly, Class, Struct                                   multiple=True  inherited=True
DebuggerStepThroughAttribute   Class, Struct, Constructor, Method                        multiple=False inherited=False
DebuggerHiddenAttribute        Constructor, Method, Property                             multiple=False inherited=False
DebuggerNonUserCodeAttribute   Class, Struct, Constructor, Method, Property              multiple=False inherited=False
StackTraceHiddenAttribute      Class, Struct, Constructor, Method                        multiple=False inherited=False
```

`DebuggerHidden` é o único atributo de passo que não vale em tipo, e nenhum dos
atributos de passo nem `StackTraceHidden` é herdado.

### DebuggerDisplay: uma string, não código

```csharp
[assembly: DebuggerDisplay("Money {Amount} {Currency,nq}", Target = typeof(Money))]

[DebuggerDisplay("{Name,nq} x{Qty}", Name = "line", Type = "OrderLine")]
public class OrderLine { public string Name { get; set; } = ""; public int Qty { get; set; } }

[DebuggerDisplay("{DebuggerDisplay,nq}")]          // o padrão da documentação
public class Customer
{
    public string First { get; set; } = ""; public string Last { get; set; } = "";
    public List<string> Orders { get; } = new();
    private string DebuggerDisplay => $"{First} {Last} ({Orders.Count} orders)";
}

[DebuggerDisplay("{Missing} and {Count - 2} and {Next()}")]
public class Dubious { public int Count = 8; public int Calls; public int Next() => ++Calls; }
```

`GetCustomAttributesData()` devolve o texto como foi escrito, inclusive a forma
no nível do assembly (para um tipo que não é seu):

```text
[DebuggerDisplayAttribute("{Name,nq} x{Qty}", Name = "line", Type = "OrderLine")]
[DebuggerDisplayAttribute("Money {Amount} {Currency,nq}", Target = typeof(Lab.Money))]
Dubious.Calls after reading its attribute "{Missing} and {Count - 2} and {Next()}": 0
```

Medido: o compilador não interpreta a string (`{Missing}` não nomeia membro
algum e o build teve 0 warnings e 0 erros); ler o atributo nunca avalia
`{Next()}`; e o atributo continua num assembly Release. As chaves guardam nomes
de membros como texto, então um rename não as atualiza, mas uma string
interpolada constante as mantém em sincronia (mesmos metadados da escrita à mão):

```csharp
[DebuggerDisplay($"{{{nameof(Name)},nq}} x{{{nameof(Qty)}}}")]   // -> "{Name,nq} x{Qty}"
```

Só docs, da página do Visual Studio: o texto entre chaves é avaliado como campo,
propriedade ou método; `,nq` tira as aspas; `Name` e `Type` mudam essas colunas;
`DebuggerDisplay` vence um `ToString()` sobrescrito; avaliar expressões é "a
operação mais cara do depurador" (tradução livre), acontece a cada exibição e
pode mudar o estado da aplicação; e a opção "Show raw structure of objects"
ignora o atributo. A ferramenta que você usa para olhar um objeto roda o seu
código, então `{Next()}` é o caso a evitar.

### DebuggerBrowsable e DebuggerTypeProxy

`[DebuggerBrowsable(estado)]` aceita `Never` (esconde), `Collapsed` ou
`RootHidden` (mostra os elementos, não o valor). Lido de uma classe que usa os
três, mais uma auto-propriedade:

```text
Field   Secret                  Never
Field   Flat                    RootHidden
Field   Folded                  Collapsed
Field   <Plain>k__BackingField  Never        <- build Debug
Field   <Plain>k__BackingField               <- build Release, sem atributo
```

As duas últimas linhas foram a única diferença entre as saídas Debug e Release:
o compilador acrescenta `DebuggerBrowsable(Never)` ao campo de apoio de uma
auto-propriedade só no Debug (SDK 10.0.100, uma propriedade).

`[DebuggerTypeProxy(typeof(P))]` troca a expansão do tipo pelos membros públicos
de `P`, cujo construtor recebe o alvo. A BCL faz isso com `List<T>`; este
programa leu o atributo, construiu o proxy por reflexão e leu suas propriedades:

```text
List`1: [DebuggerTypeProxyAttribute(typeof(System.Collections.Generic.ICollectionDebugView`1))]
        [DebuggerDisplayAttribute("Count = {Count}")]
  proxy ICollectionDebugView`1 (public=False): Items : Int32[]  RootHidden  value=[10, 20, 30]
```

O código-fonte do `dotnet/runtime` confere (`T[] Items` com `RootHidden`, copiado
a cada leitura). O mesmo padrão para uma coleção sua:

```csharp
[DebuggerTypeProxy(typeof(BagDebugView<>))][DebuggerDisplay("Count = {Count}")]
public class Bag<T> : IEnumerable<T> { /* ... */ }

public sealed class BagDebugView<T>(Bag<T> bag)    // a reflexão leu Items como String[] [x, y]
{
    [DebuggerBrowsable(DebuggerBrowsableState.RootHidden)] public T[] Items => bag.ToArray();
}
```

Só docs: o depurador cria um proxy "toda vez que precisa exibir uma variável"
(tradução livre), então mantenha o construtor barato; só os membros públicos
aparecem; em C# o alvo precisa ser um genérico aberto (`Bag<>`).

### Frames: passo, ocultação e código não do usuário

`[DebuggerStepThrough]`, `[DebuggerHidden]` e `[DebuggerNonUserCode]` são
instruções para um depurador em passo a passo (só docs). O que um programa vê é
que nenhum deles muda uma exceção. Uma cadeia que lança em `Thrower`, com um
atributo no método do meio (Debug e Release idênticos com `NoInlining`; o
inlining não foi variado):

```text
atributo no frame do meio       ex.StackTrace   new StackTrace(ex).FrameCount   frames no objeto
(nenhum)                        4 linhas        4                              Thrower > Plain > lambda > Case
[StackTraceHidden]              3 linhas        4                              Thrower > HiddenTrace > lambda > Case
[DebuggerHidden], [DebuggerStepThrough], [DebuggerNonUserCode]: cada um 4 linhas, 4 frames, igual a nenhum
```

Só `[StackTraceHidden]` (.NET 6) edita o texto, e o frame continua em
`GetFrames()`, então um código que percorre frames vê uma pilha que o texto não
mostra. Dois outros posicionamentos. No método que lança, a linha do `throw`
some e o frame do topo é o chamador, `at Lab.Stacks.Plain(Action a) ... line 11`
(`FrameCount` 4, 3 linhas). Numa classe estática `Guard`, o `NotNull` dela
sumiu e a primeira linha foi o chamador de `Guard.NotNull(null)` (`FrameCount`
3, 2 linhas). `Environment.StackTrace` segue a mesma regra. De dentro de um
método chamado por um oculto:

```text
new StackTrace().FrameCount = 4   (Inside > HiddenTrace > Run > Main)
StackTrace.ToString():     Inside, Run, Main
Environment.StackTrace:    get_StackTrace, Inside, Run, Main
```

A BCL é uma grande usuária. Membros declarados em `System.Private.CoreLib`
10.0.0, por reflexão: `DebuggerHidden` em 342 membros, `DebuggerStepThrough` em
63 membros e 6 tipos, `StackTraceHidden` em 49 membros e 7 tipos,
`DebuggerDisplay` em 56 tipos, `DebuggerTypeProxy` em 38, `DebuggerVisualizer`
em nenhum. Ela não esconde todo helper de throw: `ThrowIfNull(null)` ainda
mostrou `at System.ArgumentNullException.Throw(String paramName)`. Use nos seus
helpers quando o frame só atrapalharia (veja
[guard clauses](/csharp-concepts/guard-clauses-throwing-and-rethrowing) e
[exceções](/csharp-concepts/exceptions-try-catch-filters-and-finally)).

### Debugger, Debug.Assert e Trace sem depurador

Processos comuns, sem depurador em lugar nenhum, códigos de saída vindos de `$?`:

```text
                              build Debug                                          build Release
IsAttached, depois Launch()   False; Launch() devolveu True, IsAttached continuou False   igual
Debugger.Break()              seguiu em frente, exit 0                             igual
Debug.Assert(false, "msg")    "Process terminated. Assertion failed.", exit 134    chamada removida, exit 0
Trace.Assert(false, "msg")    "Process terminated. Assertion Failed", exit 134    igual, exit 134
Debug/Trace.WriteLine         nada no console (só o DefaultTraceListener)
  + ConsoleTraceListener      as duas linhas                                       só a linha do Trace
```

Três surpresas. `Debugger.Launch()` devolveu `True` com `IsAttached` ainda
`False`: nada foi lançado no macOS (o comportamento no Windows é só docs).
`Debugger.Break()` não faz nada sem depurador e não é `[Conditional]`, então um
esquecido vai para produção. E `Trace.Assert` derruba um processo Release: a
reflexão confirma que `Debug.Assert` e `Debug.WriteLine` têm
`Conditional("DEBUG")`, `Trace.Assert` e `Trace.WriteLine` têm
`Conditional("TRACE")`, e `TRACE` é definido no Release (veja
[diretivas de pré-processador](/csharp-concepts/preprocessor-directives-and-conditional-compilation)).
Uma invariante que nunca deve parar a produção é um `Debug.Assert`.

### O dotnet-dump não os aplica

O `dotnet-dump analyze` mostra uma string de display ou um proxy? Rodei um build
Release com um `OrderLine`, um `Customer`, um `Bag<string>`, um `Money` e um
`List<int>`, tirei `dotnet-dump collect --type Heap` (354 MB, de uma cópia
privada do runtime com o `createdump` executável, como no conceito
[dotnet-trace, dump e gcdump](/dotnet-concepts/diagnosing-production-with-dotnet-trace-dump-and-gcdump))
e rodei `dumpobj` em cada um. A saída é o objeto cru, por exemplo para
`Lab.Customer` três campos `<First>k__BackingField`, `<Last>k__BackingField` e
`<Orders>k__BackingField` com endereços como valores.

Nada de `Ana Silva (2 orders)` nem de `Count = 2`; um `List<string>` mostrou
`_items` e `_size 2`, e o `help` não tem comando sobre strings de display ou
proxies. `[DebuggerVisualizer]` nomeia um assembly separado que o depurador
carrega para desenhar um valor numa janela própria: só docs (veja a página do
Visual Studio sobre visualizadores personalizados).

### Livro vs hoje

Os livros antigos de .NET apresentam `DebuggerDisplay`, `Debug.Assert` e
`Debug.WriteLine` como o kit de diagnóstico. Os atributos de display e proxy não
mudaram e ainda valem três linhas num tipo que você inspeciona todo dia. O que
mudou: `Debug.WriteLine` não imprimiu nada aqui sem um listener, enquanto
`ILogger`, OpenTelemetry e EventPipe é que a produção lê (veja
[logging estruturado](/dotnet-concepts/structured-logging-with-serilog-and-log-sinks));
um assert que falha encerra o processo neste runtime (exit 134);
`[StackTraceHidden]` existe só desde o .NET 6, então material mais antigo não
tem como encurtar o texto de uma exceção; e o trabalho post-mortem passa pelo
`dotnet-dump`, onde os atributos de display não são usados (medido acima; a
janela de dump da IDE não foi executada).

## Trade-offs

- **A string de display é texto sem verificação que pode rodar seu código.**
  `{Missing}` compilou com 0 warnings, e `{Next()}` é uma chamada a cada
  atualização. Use `nameof` como acima e deixe a lógica numa propriedade
  privada sem efeito colateral.
- **Um proxy copia.** `Items` chama `ToArray()` a cada expansão: caro para uma
  sequência preguiçosa ou enorme. Limite o tamanho.
- **`[StackTraceHidden]` remove evidência.** Num método que lança, o texto
  nomeou o chamador. Reserve para helpers minúsculos e continue registrando a
  exceção completa.
- **`Trace.Assert` e um `Debugger.Break()` esquecido vão para produção.** O
  primeiro encerrou um processo Release (exit 134); o segundo não faz nada até
  um depurador anexar.

## Documentation Links

- [Display custom info using DebuggerDisplay, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/using-the-debuggerdisplay-attribute) (doc)
- [Use the DebuggerTypeProxy attribute, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/using-debuggertypeproxy-attribute) (doc)
- [Enhancing debugging with the debugger display attributes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/debug-trace-profile/enhancing-debugging-with-the-debugger-display-attributes) (doc)
- [Create custom visualizers of data, Visual Studio, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/debugger/create-custom-visualizers-of-data) (doc)
- [StackTraceHiddenAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stacktracehiddenattribute) (doc)
- [ICollectionDebugView.cs, dotnet/runtime, GitHub](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/ICollectionDebugView.cs) (doc)
- [dotnet-dump, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump) (doc)
