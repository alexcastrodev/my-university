---
version: 1.0
updatedAt: 2026-11-20
title: "Escrevendo um Analyzer Roslyn e um Source Generator Incremental"
summary: DiagnosticAnalyzer com a regra DateTime.Now contra TimeProvider, escolha entre ação de sintaxe, operação e símbolo, code fix com DocumentEditor e FixAll, testes com Microsoft.CodeAnalysis.Testing, empacotamento NuGet, severidade por .editorconfig e um IIncrementalGenerator cujo cache incremental é medido com GeneratorDriver.
---
## Objective

O Roslyn roda o seu código dentro do compilador. Um analyzer reporta um diagnóstico para um padrão que você quer proibir, um code fix reescreve esse padrão e um source generator incremental escreve o código repetitivo que você escreveria à mão. Este conceito constrói um de cada do zero e mede o que dá errado: uma regra que marca `DateTime.Now` e `DateTimeOffset.UtcNow` (use um `TimeProvider`, veja [Controlling Time in Tests with TimeProvider and FakeTimeProvider](/dotnet-testing-concepts/controlling-time-with-timeprovider)), o code fix dela, os testes com `Microsoft.CodeAnalysis.Testing`, o pacote NuGet que entrega tudo e um gerador `[EnumExtensions]` cujo pipeline é conferido com um `GeneratorDriver`. O conceito [Source Generators and AOT-Friendly Code](/dotnet-concepts/source-generators-and-aot-friendly-code) já mostra um gerador pequeno de `[AutoToString]` e enuncia a regra "nunca guarde símbolos no modelo". Aqui o gerador é a parte secundária: este conceito mede essa regra em vez de repetir o passo a passo, e o analyzer, o fix, os testes e o empacotamento são a parte que nenhum outro cobre.

Versões: .NET SDK 10.0.100 (compilador 5.0.0), TFM do host `net10.0`, projetos de analyzer em `netstandard2.0`, `Microsoft.CodeAnalysis.CSharp` 4.14.0, `Microsoft.CodeAnalysis.CSharp.Workspaces` 4.14.0, `Microsoft.CodeAnalysis.Analyzers` 5.9.0, `Microsoft.CodeAnalysis.CSharp.{Analyzer,CodeFix,SourceGenerators}.Testing` 1.1.4, MSTest 4.5.3, macOS arm64.

## Use Cases

- Uma regra de time que os analyzers embutidos não conhecem ("sem `DateTime.Now`", "sem `new HttpClient()`"), aplicada no build em vez de na revisão de código.
- Um code fix para que o `dotnet format` migre as violações existentes com um único comando.
- Um gerador para código repetitivo que depende dos seus tipos (helpers de enum, mappers, listas de registro).
- Entregar tudo isso a outros repositórios como um único pacote NuGet.

## Deep Dive

### O projeto, e por que as versões parecem antigas

Um assembly de analyzer é carregado pelo compilador, então ele tem como alvo `netstandard2.0` e referencia só os pacotes do Roslyn (`PrivateAssets="all"`, para nada vazar para os consumidores). O Roslyn dele não pode ser mais novo que o compilador que o carrega. Empacotei o mesmo analyzer contra a 5.12.0, a mais recente do NuGet, e compilei um consumidor com o SDK 10.0.100:

```text
CSC : warning CS9057: Analyzer assembly '.../analyzers/dotnet/cs/TimeRules.dll' cannot be used
because it references version '5.12.0.0' of the compiler, which is newer than the currently
running version '5.0.0.0'.
```

O build passou e a regra sumiu em silêncio, só com um warning. Com a 4.14.0 carregou normalmente, então escolha o Roslyn mais antigo que tenha as APIs que você usa. O mesmo projeto contém o gerador, e `record` precisa de um polyfill no `netstandard2.0`: `namespace System.Runtime.CompilerServices { internal static class IsExternalInit { } }`. O lado do atributo marcador está em [Attributes: Custom and Compiler-Read](/csharp-concepts/attributes-custom-and-compiler-read).

`EnforceExtendedAnalyzerRules` mais `Microsoft.CodeAnalysis.Analyzers` fazem o compilador conferir o seu analyzer. Medido: `Console.WriteLine` e `File.ReadAllText` dentro de uma ação deram `error RS1035: The symbol 'File' is banned for use by analyzers: Do not do file IO in analyzers` (e o mesmo para `Console`); com a propriedade em false, nenhuma mensagem. Omitir `ConfigureGeneratedCodeAnalysis` e `EnableConcurrentExecution` deu `warning RS1025` e `RS1026`, e o primeiro build da regra deu `RS2008` até eu adicionar `AnalyzerReleases.Shipped.md` e `AnalyzerReleases.Unshipped.md` (uma tabela com id da regra, categoria e severidade).

### O analyzer

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class DateTimeNowAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "TP0001";
    private static readonly DiagnosticDescriptor Rule = new(DiagnosticId,
        title: "Use TimeProvider instead of the system clock",
        messageFormat: "'{0}' reads the system clock directly; use a TimeProvider so tests can control time",
        category: "Design", defaultSeverity: DiagnosticSeverity.Warning, isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics { get; } = ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterCompilationStartAction(start =>
        {
            if (start.Compilation.GetTypeByMetadataName("System.TimeProvider") is null) return; // before .NET 8
            start.RegisterOperationAction(AnalyzeProperty, OperationKind.PropertyReference);
        });
    }

    private static void AnalyzeProperty(OperationAnalysisContext context)
    {
        var reference = (IPropertyReferenceOperation)context.Operation;
        var property = reference.Property;
        if (!property.IsStatic || property.Name is not ("Now" or "UtcNow")) return;
        var type = property.ContainingType;
        if (type.ContainingNamespace.ToDisplayString() != "System" || type.Name is not ("DateTime" or "DateTimeOffset")) return;
        context.ReportDiagnostic(Diagnostic.Create(Rule, reference.Syntax.GetLocation(), $"{type.Name}.{property.Name}"));
    }
}
```

O descritor é o contrato (id, severidade padrão, mensagem), e o `Initialize` só registra callbacks. O estado por compilação fica na ação de início de compilação, não em campos: na IDE uma instância do analyzer sobrevive a muitas compilações (a definição de sessão do Roslyn). Essa ação roda uma vez por compilação, então é o lugar de resolver tipos e de decidir ficar em silêncio.

### Sintaxe, operação ou símbolo

Seis usos no mesmo código (`DateTime.Now`, `System.DateTime.UtcNow`, um alias `D.Now`, `using static` com um `Now` solto, `DateTimeOffset.UtcNow` e `Mine.DateTime.Now` num tipo parecido), dois analyzers:

```text
Comparação de texto no nó de sintaxe ("...DateTime.Now"): 4 reports: DateTime.Now, System.DateTime.UtcNow,
                                                         DateTimeOffset.UtcNow, Mine.DateTime.Now (errado)
Operação (IPropertyReferenceOperation):                  5 reports: os mesmos reais mais D.Now e Now
```

A comparação de texto perde o alias e o nome solto, e marca o tipo parecido. A ação de operação enxerga o que o código significa: recebe o `IPropertySymbol` resolvido, não importa como foi escrito. Um analyzer de sonda no mesmo exemplo contou os callbacks: `PropertyReference` 6, `SimpleMemberAccessExpression` 7, `IdentifierName` 20, `NamedType` 2, `Method` 7 (o acessor `get_Now` incluído). Então: use ação de operação para comportamento dentro de corpos de método, ação de nó de sintaxe quando a regra é sobre forma (nome ou layout, só sintaxe) e ação de símbolo para declarações (nome de método, tipo base, atributo ausente). Uma ação de símbolo nunca vê o que está dentro de um corpo. Pelo documento de semântica das ações do Roslyn, a ação de símbolo roda uma vez por declaração e a de operação uma vez por nó de operação.

`ConfigureGeneratedCodeAnalysis(None)` importa: com `Analyze | ReportDiagnostics` no lugar, o meu teste com uma classe `[GeneratedCode]` falhou com `Mismatch between number of diagnostics returned, expected "0" actual "1"`. `EnableConcurrentExecution` deixa o compilador rodar callbacks em paralelo, então os callbacks precisam ser thread-safe.

### O code fix

```csharp
[ExportCodeFixProvider(LanguageNames.CSharp, Name = nameof(UseTimeProviderCodeFix)), Shared]
public sealed class UseTimeProviderCodeFix : CodeFixProvider
{
    public override ImmutableArray<string> FixableDiagnosticIds { get; } = ImmutableArray.Create(DateTimeNowAnalyzer.DiagnosticId);
    public override FixAllProvider GetFixAllProvider() => WellKnownFixAllProviders.BatchFixer;

    public override async Task RegisterCodeFixesAsync(CodeFixContext context)
    {
        var root = await context.Document.GetSyntaxRootAsync(context.CancellationToken);
        var node = root?.FindNode(context.Span, getInnermostNodeForTie: true);
        if (node is null) return;
        context.RegisterCodeFix(
            CodeAction.Create("Use TimeProvider", ct => ReplaceAsync(context.Document, node, ct),
                equivalenceKey: nameof(UseTimeProviderCodeFix)), context.Diagnostics);
    }
}
```

O `ReplaceAsync` monta a substituição com o `DocumentEditor`: `GetSymbolInfo` no nó e depois `editor.ReplaceNode(node, provider.GetUtcNow()...)`, onde `provider` é um `TimeProvider` já visível naquela posição (um campo, parâmetro ou local achado com `model.LookupSymbols`) e, se não houver, `TimeProvider.System`. `DateTime.UtcNow` vira `.GetUtcNow().UtcDateTime`, `DateTime.Now` vira `.GetLocalNow().DateTime` e `DateTimeOffset` não precisa de sufixo. O fix mora num projeto separado porque precisa do `Microsoft.CodeAnalysis.CSharp.Workspaces`, que o compilador não carrega.

Duas coisas que medi. Primeira: colocar o `Simplifier.Annotation` na expressão inteira deixou `global::System.TimeProvider.System.GetLocalNow()` na saída do segundo e do terceiro fix de um mesmo arquivo (o diff do teste mostrou exatamente isso); anotar só o nome do tipo `global::System.TimeProvider` resolveu, e aí ele é reduzido para `TimeProvider` com `using System;` e para `System.TimeProvider` sem ele. Montar o tipo com `SyntaxGenerator.TypeExpression` falhou de outro jeito: o harness rejeita um `QualifiedName` onde se esperava uma expressão. Segunda: o fix não é isento de mudança de comportamento (veja [Dates, Times and Time Zones](/csharp-concepts/dates-times-and-time-zones) sobre `DateTimeKind`):

```text
DateTime.Now.Kind: Local                       GetLocalNow().DateTime.Kind: Unspecified
GetUtcNow().LocalDateTime.Kind: Local          DateTime.UtcNow.Kind: Utc, GetUtcNow().UtcDateTime.Kind: Utc
provider falso com fuso UTC+5: GetLocalNow().DateTime = 17:00, GetUtcNow().LocalDateTime = 12:00 (fuso do sistema UTC)
```

`.DateTime` respeita o `LocalTimeZone` do provider mas perde o `Kind`; `.LocalDateTime` mantém `Local` mas usa o fuso da máquina. Escolhi o primeiro (um fuso falso então funciona nos testes) e a mensagem da regra deveria dizer isso. Um fix que muda comportamento é uma decisão para documentar, não para esconder.

`GetFixAllProvider` devolve o batch fixer, e sem ele não aparece "Fix all". Ele também exige um `equivalenceKey` não nulo, porque o FixAll agrupa os fixes por essa chave (segundo o documento FixAllProvider do Roslyn). O batch fixer aplica cada fix ao snapshot original da solução e mantém só as mudanças cujos trechos não se sobrepõem, então é errado para fixes que se sobrepõem ou que adicionam declarações. Aqui cada fix troca a sua própria expressão. O `dotnet format analyzers Consumer.csproj --diagnostics TP0001 --severity warn` rodou o fix do pacote sobre um projeto e mudou as três ocorrências numa passada, e o projeto recompilado ficou com 0 warnings:

```text
-Console.WriteLine(D.Now.Year > 2000);                  +Console.WriteLine(TimeProvider.System.GetLocalNow().DateTime.Year > 2000);
-public string Stamp() => DateTimeOffset.UtcNow.ToString("O");   +public string Stamp() => TimeProvider.System.GetUtcNow().ToString("O");
```

### Testando com Microsoft.CodeAnalysis.Testing

O harness compila um trecho, roda o analyzer, compara os diagnósticos com a marcação, aplica o fix e compara o resultado. `{|TP0001:...|}` marca o trecho que deve carregar aquele diagnóstico:

```csharp
var test = new CSharpCodeFixTest<DateTimeNowAnalyzer, UseTimeProviderCodeFix, DefaultVerifier>
{
    TestCode = source, FixedCode = fixedSource, ReferenceAssemblies = ReferenceAssemblies.Net.Net100,
};
await test.RunAsync();   // source: "DateTime M() => {|TP0001:DateTime.UtcNow|};"
```

Seis testes: as três formas de relógio e os fixes delas, um fix que prefere um `_clock` injetado, alias mais `using static` mais o nome completo, um tipo parecido e `DateTime.Today`, que devem ficar em silêncio (um teste sem marcação afirma "nenhum diagnóstico"), e código gerado. Um trecho com diagnóstico faltando ou sobrando falha com um diff. O harness não percebeu um FixAll ausente: com `GetFixAllProvider` devolvendo `null` todos os testes continuaram verdes, então a rodada do `dotnet format` acima é a verificação de verdade. A configuração teve armadilhas. O `DefaultVerifier` funciona direto com o MSTest 4 (os pacotes de verifier para xunit e mstest param na 1.1.2 e não são necessários). Referenciar o projeto do analyzer com `PrivateAssets="all"` não levou o Roslyn ao projeto de teste, que restaurou o Roslyn 3.8.0 do pacote de testes e imprimiu conflitos `MSB3277` até eu adicionar um `Microsoft.CodeAnalysis.CSharp.Workspaces` 4.14.0 explícito. Os pacotes de teste também trouxeram `System.Security.Cryptography.Pkcs` 9.0.6 e os warnings `NU1902`/`NU1903`; uma referência direta à 10.0.15 resolveu. No SDK do .NET 10, o `dotnet test` precisa de `{ "test": { "runner": "Microsoft.Testing.Platform" } }` no `global.json` e de `dotnet test --project <caminho>`.

### Empacotando como pacote NuGet

(O empacotamento em geral está em [Packaging and Publishing a NuGet Library](/dotnet-concepts/packaging-and-publishing-a-nuget-library).) O pacote não tem `lib/`, só os assemblies em `analyzers/dotnet/cs`:

```xml
<PropertyGroup>
  <PackageId>Contoso.TimeRules</PackageId>
  <IncludeBuildOutput>false</IncludeBuildOutput>
  <SuppressDependenciesWhenPacking>true</SuppressDependenciesWhenPacking>
  <DevelopmentDependency>true</DevelopmentDependency>
  <TargetsForTfmSpecificContentInPackage>$(TargetsForTfmSpecificContentInPackage);AddAnalyzersToPackage</TargetsForTfmSpecificContentInPackage>
</PropertyGroup>
<Target Name="AddAnalyzersToPackage">
  <ItemGroup>
    <TfmSpecificPackageFile Include="../TimeRules/bin/$(Configuration)/netstandard2.0/TimeRules.dll" PackagePath="analyzers/dotnet/cs" />
    <TfmSpecificPackageFile Include="../TimeRules.CodeFixes/bin/$(Configuration)/netstandard2.0/TimeRules.CodeFixes.dll" PackagePath="analyzers/dotnet/cs" />
  </ItemGroup>
</Target>
```

Um projeto de pacote separado guarda isso porque o projeto do analyzer não pode referenciar o code fix que o referencia. O `unzip -l` mostrou `analyzers/dotnet/cs/TimeRules.dll` (16 KB, analyzer mais gerador) e `TimeRules.CodeFixes.dll`, e o nuspec tinha `developmentDependency` true e nenhuma dependência. Um app console que referencia o pacote de um feed local imprimiu `warning TP0001` para `DateTimeOffset.UtcNow`, `D.Now` e `Now`. A severidade é escolha do consumidor no `.editorconfig` (veja [Analyzers, EditorConfig and Build Quality Gates](/dotnet-concepts/analyzers-editorconfig-and-build-quality-gates) para o mecanismo):

```text
dotnet_diagnostic.TP0001.severity = error        3 erros, Build FAILED
dotnet_diagnostic.TP0001.severity = suggestion   build ok, 0 warnings
dotnet_diagnostic.TP0001.severity = none         build ok, 0 warnings
```

Mantenha as dependências no mínimo. Um analyzer que chamava o `Newtonsoft.Json` sem entregá-lo ao lado do analyzer deu `warning AD0001: Analyzer 'A' threw an exception of type 'System.IO.FileNotFoundException' ... 'Newtonsoft.Json, Version=13.0.0.0'`. O cookbook do Roslyn diz que dependências de tempo de geração precisam ser copiadas à mão para `analyzers/dotnet/cs` (só docs, entregá-las não foi rodado aqui).

### O gerador incremental

```csharp
[Generator(LanguageNames.CSharp)]
public sealed class EnumExtensionsGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(c => c.AddSource("EnumExtensionsAttribute.g.cs", AttributeSource));

        var models = context.SyntaxProvider.ForAttributeWithMetadataName(
                "Contoso.EnumExtensionsAttribute",
                predicate: static (node, _) => node is EnumDeclarationSyntax,       // barato, só sintaxe
                transform: static (ctx, _) => ToModel((INamedTypeSymbol)ctx.TargetSymbol))
            .WithTrackingName("EnumModel")
            .Where(static m => m is not null);

        context.RegisterSourceOutput(models, static (spc, m) => spc.AddSource($"{m!.Name}Extensions.g.cs", Render(m)));
    }
}
internal sealed record EnumModel(string? Namespace, string Name, EquatableArray<string> Members);
```

`ForAttributeWithMetadataName` é a porta de entrada: o cookbook diz que ele é pelo menos 99 vezes mais eficiente que o `CreateSyntaxProvider`, e o atributo deixa o usuário optar. O `ToModel` copia strings do símbolo e devolve um record, e o atributo marcador vem dentro do gerador pela saída de pós-inicialização. Um consumidor com `[EnumExtensions] enum Color { Red, Green = 5, Blue }` imprimiu `Green` e `42` para `((Color)42).ToStringFast()`, e o `EmitCompilerGeneratedFiles` gravou o `ColorExtensions.g.cs` em `obj/generated` (dentro de `obj`, então o próximo build não o compila duas vezes).

A incrementalidade é o que decide o desempenho no editor. O teste com o driver roda o mesmo gerador sobre quatro compilações (primeira execução, editar outro arquivo, editar o arquivo do próprio enum fora do enum, adicionar um membro) com `trackIncrementalGeneratorSteps: true`, e lê o motivo da etapa rastreada:

```text
modelo guarda INamedTypeSymbol:         New, Modified,  Modified,  Modified    a saída rodou 4 vezes
record com ImmutableArray<string>:      New, Modified,  Modified,  Modified    a saída rodou 4 vezes
record com EquatableArray<string>:      New, Unchanged, Unchanged, Modified    a saída rodou 2 vezes
o gerador real (mesmo modelo):          New, Unchanged, Unchanged, Modified
```

Um símbolo é um objeto novo a cada compilação, e `ImmutableArray<T>` compara por referência, então os dois primeiros modelos nunca são iguais e a saída (e toda etapa depois dela) roda de novo a cada tecla; o terceiro compara por valor, e o pipeline para ali. O cookbook lista as mesmas regras, e acrescenta que símbolos podem manter compilações antigas vivas na memória. O teste real afirma `New, Unchanged, Unchanged, Modified`, e um segundo teste usa o `CSharpSourceGeneratorTest` para comparar os arquivos gerados com o texto esperado.

### Depuração

Não consegui anexar um depurador nesta rodada (só docs). O tutorial do Roslyn diz que o template de analyzer do Visual Studio abre uma segunda instância experimental do Visual Studio no F5, e também que testes unitários são muito mais rápidos que testar de forma interativa. Na prática o ciclo aqui foi o harness de testes, o `GetRunResult()` do driver para geradores e o `EmitCompilerGeneratedFiles` para ler o que um gerador emitiu.

### Livro vs hoje

Tutoriais antigos montam geradores sobre o `ISourceGenerator`, a API v1; a documentação do Roslyn diz que os geradores incrementais a substituem. Eles também usam pacotes de verifier por framework (`...Testing.XUnit`, última versão 1.1.2) e um projeto VSIX para depurar. Hoje: `IIncrementalGenerator` com `ForAttributeWithMetadataName`, `DefaultVerifier` com qualquer framework de teste e o pacote NuGet como forma de entrega. Um tutorial que varre todos os nós com `CreateSyntaxProvider` e leva o símbolo para o modelo funciona, e é a forma lenta e gulosa de memória medida acima.

## Trade-offs

- **Versão do Roslyn.** Uma referência antiga roda em mais SDKs mas não tem as APIs novas; uma nova dá `CS9057` e uma regra morta em silêncio num SDK mais antigo (5.12.0 contra o compilador 5.0.0).
- **Operação versus sintaxe.** Operações resolvem alias e `using static` (os 5 usos reais achados, contra 3 achados e 1 report falso na comparação de texto), mas só existem dentro de código executável; uma regra sobre declarações ou layout sai mais barata como ação de símbolo ou de sintaxe.
- **Um fix é uma promessa.** `.GetLocalNow().DateTime` muda o `Kind` de `Local` para `Unspecified`; ofereça o fix seguro e documente a diferença, e mantenha o diagnóstico mesmo quando não há fix automático.
- **Um assembly ou dois.** Analyzer e gerador numa DLL só dão um pacote só, mas todo consumidor carrega os dois, e o fix precisa do assembly Workspaces que o compilador não tem.
- **Código gerado é superfície entregue.** Um gerador roda a cada tecla na IDE: um símbolo no modelo ou uma coleção com igualdade por referência faz ele reemitir o tempo todo (4 de 4 execuções contra 2 de 4).
- **Sem dependências.** Tudo que o analyzer chama precisa ir empacotado ao lado dele, ou o usuário vê `AD0001`.

## Documentation Links

- [The .NET Compiler Platform SDK (Roslyn APIs), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/) (doc)
- [Tutorial: Write your first analyzer and code fix, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/tutorials/how-to-write-csharp-analyzer-code-fix) (doc)
- [Source generators overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview) (doc)
- [Incremental generators cookbook, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.cookbook.md) (doc)
- [Incremental generators design, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md) (doc)
- [Analyzer actions semantics, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/analyzers/Analyzer%20Actions%20Semantics.md) (doc)
- [FixAllProvider, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/analyzers/FixAllProvider.md) (doc)
- [Roslyn analyzer rules for analyzer authors (RS rules), dotnet/roslyn-analyzers](https://github.com/dotnet/roslyn-analyzers/blob/main/src/Microsoft.CodeAnalysis.Analyzers/Microsoft.CodeAnalysis.Analyzers.md) (doc)
- [Analyzer NuGet conventions, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/guides/analyzers-conventions) (doc)
- [TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
- [dotnet format, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format) (doc)
