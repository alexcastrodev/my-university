---
version: 1.0
updatedAt: 2026-10-15
title: "Source generators e código amigável a AOT"
summary: Os geradores que a plataforma já traz (GeneratedRegex, JsonSerializerContext, LoggerMessage), como ler o que eles emitem, o que os analisadores IL2026 e IL3050 dizem do caminho com reflexão e como escrever um IIncrementalGenerator pequeno.
---
## Objective

Reflexão e geração de código em tempo de execução eram como as bibliotecas
.NET descobriam seus tipos, e é exatamente isso que trimming e Native AOT não
conseguem enxergar. Um source generator move esse trabalho para o tempo de
compilação: ele lê seu código e adiciona novos arquivos C# à compilação, e o
resultado é código comum, visível e analisável. Este conceito mostra os
geradores que a plataforma entrega (`[GeneratedRegex]`, `JsonSerializerContext`,
`[LoggerMessage]`), como ler o que eles emitem, o que os analisadores de AOT
dizem sobre a alternativa com reflexão e quão pequeno pode ser um gerador
incremental próprio.

## Use Cases

- Deixar um app de console ou uma minimal API seguro para trimming ou para
  publicação com Native AOT.
- Trocar um `new Regex(...)` em caminho quente por código que o compilador
  consegue otimizar.
- Eliminar boilerplate como `ToString`, mapeadores ou `INotifyPropertyChanged`
  com um gerador próprio.
- Depurar "o que o framework gerou para o meu tipo?".
- Ganhar startup mais rápido ao evitar a descoberta por reflexão.

## Deep Dive

### Os três geradores da plataforma em um projeto

Os três vêm com o SDK ou com um pacote da Microsoft; nenhum exige referência ao
Roslyn. Este projeto de console `net10.0` (SDK 10.0.100) usa os três juntos,
com `IsAotCompatible` ligado para que os analisadores de trim e AOT rodem em um
build normal:

```csharp
var m = Rx.Order().Match("order-42");
Console.WriteLine($"regex: {m.Success} {m.Groups[1].Value}");

var json = JsonSerializer.Serialize(new Item("pen", 3), AppJson.Default.Item);
Console.WriteLine($"json: {json}");

using var lf = LoggerFactory.Create(b => b.AddSimpleConsole());
Log.Created(lf.CreateLogger("demo"), 42);

record Item(string Name, int Qty);

[JsonSerializable(typeof(Item))]
partial class AppJson : JsonSerializerContext;

static partial class Rx
{
    [GeneratedRegex(@"^order-(\d+)$")]
    public static partial Regex Order();
}

static partial class Log
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Created order {Id}")]
    public static partial void Created(ILogger logger, int id);
}
```

```text
regex: True 42
json: {"Name":"pen","Qty":3}
info: demo[165548891]
      Created order 42
```

O número estranho é o id do evento: omiti o `EventId`, então o gerador produziu
um. Cada gerador é disparado por um atributo em um tipo ou método `partial` e
fornece a metade que falta. A documentação diz isso para o gerador de regex e
para o `[LoggerMessage]`, cujo método precisa ser `partial` e retornar `void`;
se for estático, recebe o `ILogger` como parâmetro. A página de logging também
informa que o gerador exige um compilador C# 9 ou posterior.

### Vendo o que foi gerado

Duas propriedades fazem os arquivos aparecerem em disco:

```xml
<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
<CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/generated</CompilerGeneratedFilesOutputPath>
```

Minha execução gerou uma pasta por gerador: `RegexGenerator.g.cs`, seis
arquivos `AppJson*.g.cs` e `LoggerMessage.g.cs`. O arquivo de regex começa com
uma explicação do padrão em comentários XML ("Match the string "order-"", "1st
capture group"). Ler esses arquivos é a forma mais rápida de entender o que um
gerador realmente faz, e dá para colocar breakpoints neles.

Uma armadilha que encontrei de verdade: quando a pasta de saída fica dentro do
projeto, o build seguinte trata esses `.cs` como fontes normais e ainda recebe a
saída do gerador, então cada membro é definido duas vezes. O build falhou com
erros como `CS0102: The type 'AppJson' already contains a definition for
'String'`. A correção é excluir a pasta:

```xml
<ItemGroup><Compile Remove="generated/**" /></ItemGroup>
```

### O que os analisadores dizem do caminho com reflexão

Com `IsAotCompatible` ligado, adicionei a chamada clássica com reflexão ao lado
da gerada:

```csharp
JsonSerializer.Serialize(new Item("pen", 3));
```

```text
warning IL2026: Using member 'JsonSerializer.Serialize<TValue>(TValue, JsonSerializerOptions)'
which has 'RequiresUnreferencedCodeAttribute' can break functionality when trimming...
Use the overload that takes a JsonTypeInfo or JsonSerializerContext...
warning IL3050: ... which has 'RequiresDynamicCodeAttribute' can break functionality
when AOT compiling... Use System.Text.Json source generation for native AOT applications.
```

A sobrecarga que recebe `AppJson.Default.Item` não gerou aviso. Essa é a ideia
toda: o contexto lista os tipos em tempo de compilação, então o trimmer e o
compilador AOT enxergam cada construtor e propriedade. Um `new Regex(pattern)`
simples não gerou aviso no meu build; a página de regex recomenda o gerador por
startup, throughput e capacidade de trimming, e diz que o analisador
`SYSLIB1045` sugere a conversão para padrões conhecidos em compilação. Regexes
que o gerador não consegue implementar (por exemplo com
`RegexOptions.NonBacktracking`, segundo a documentação) caem para uma instância
`Regex` em cache.

### Escrevendo um gerador incremental pequeno

Um gerador próprio é uma classe que implementa `IIncrementalGenerator` em um
projeto separado. O meu mirava `netstandard2.0`, referenciava
`Microsoft.CodeAnalysis.CSharp` 4.14.0 e carregou normalmente no compilador do
SDK 10. Ele emite um atributo `[AutoToString]` e, para cada classe anotada, um
`ToString`:

```csharp
[Generator]
public sealed class ToStringGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(c =>
            c.AddSource("AutoToStringAttribute.g.cs", AttributeSource));

        var models = context.SyntaxProvider.ForAttributeWithMetadataName(
            "Gen.AutoToStringAttribute",
            predicate: static (node, _) => node is ClassDeclarationSyntax,
            transform: static (ctx, _) => /* lê o símbolo, devolve um modelo pequeno */);

        context.RegisterSourceOutput(models, static (spc, m) =>
            spc.AddSource($"{m.Name}.g.cs", /* monta o texto da classe parcial */));
    }
}
```

O app o referencia como analyzer, não como biblioteca:

```xml
<ProjectReference Include="../Gen/Gen.csproj"
                  OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
```

Com `[AutoToString] public partial class Person`, a saída foi
`Person { Name=Ada, Age=36 }`, e o `Person.g.cs` emitido era a classe parcial de
poucas linhas que alguém escreveria à mão. Duas regras de projeto importam. O
pipeline deve passar entre etapas só modelos pequenos e comparáveis por valor
(strings, arrays de strings), nunca `ISymbol` ou nós de sintaxe, para que o
compilador perceba que nada mudou e pule a regeneração; o cookbook do Roslyn
linkado abaixo trata disso, e não medi aqui. E o `predicate` barato filtra a
sintaxe primeiro, para que o `transform` caro rode só para os candidatos.

## Trade-offs

- **Código gerado é seguro para AOT e rápido**, mas é código no seu assembly:
  muitas regexes ou tipos JSON aumentam o binário, e uma regex pouco usada pode
  não merecer o gerador.
- **JSON gerado por fonte** exige que cada tipo serializado esteja registrado
  em um `JsonSerializerContext`; um tipo esquecido simplesmente não é coberto
  pelo contexto, então confira os membros gerados.
- **Membros parciais** são o contrato: o atributo só funciona em tipos e métodos
  `partial`, então você edita declarações que antes deixava em paz.
- **Geradores próprios** eliminam boilerplate, mas rodam dentro do compilador e
  da IDE, são difíceis de depurar, pedem um projeto extra e podem deixar o
  editor lento se o pipeline não for incremental.
- **`EmitCompilerGeneratedFiles`** ajuda em revisão e depuração, mas a pasta de
  saída precisa ficar fora da compilação e do ruído do controle de versão.

## Documentation Links

- [Roslyn SDK and source generators overview](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/)
- [Incremental generators cookbook](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.cookbook.md)
- [.NET regular expression source generators](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators)
- [System.Text.Json source generation](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation)
- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation)
- [Introduction to AOT warnings](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings)
