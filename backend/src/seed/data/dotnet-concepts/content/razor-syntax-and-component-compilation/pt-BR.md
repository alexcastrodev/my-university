---
version: 1.0
updatedAt: 2026-10-15
title: "Sintaxe Razor e Compilação de Componentes"
summary: Como um arquivo .razor vira uma classe C# (EmitCompilerGeneratedFiles), o que cada diretiva gera, o que o BuildRenderTree faz com o markup, as regras do @, warnings que passam batido e a diferença entre Razor, Razor Pages e Blazor.
---
## Objective

Um arquivo `.razor` parece um template, mas o build o trata como código-fonte:
o compilador Razor o transforma em uma classe C# antes de o compilador C# rodar.
Saber como essa classe é explica a maior parte dos "por quês" do Blazor: por que
os membros de `@code` se comportam como membros de uma classe comum, por que um
componente não pode ser uma tag em minúsculas, por que um `@` solto quebra o
build, e por que `@rendermode` e `@typeparam` às vezes colidem. Este concept liga
o `EmitCompilerGeneratedFiles` em um Blazor Web App no SDK 10.0.100, lê o código
gerado de uma página pequena e depois testa os limites da sintaxe renderizando.
Também separa as três coisas que as pessoas chamam de "Razor": a sintaxe, as
Razor Pages e views MVC (`.cshtml`) e os componentes Blazor (`.razor`). Roteamento,
ciclo de vida e render modes dos componentes estão nos outros concepts de Blazor;
aqui o foco é como o arquivo vira código.

## Use Cases

- Depurar um erro de compilação que aponta para o código gerado e não para o seu
  arquivo.
- Entender o que uma diretiva como `@inject`, `@inherits` ou `@typeparam` faz com
  a classe.
- Decidir entre manter o markup no `.razor` ou usar uma partial class em
  code-behind.
- Explicar para o time a diferença entre uma Razor Page e um componente Razor.

## Deep Dive

### Olhe a classe gerada

Por padrão os arquivos gerados ficam dentro do compilador. Colocar
`<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>` no projeto os
grava em disco; a documentação do Razor SDK lista essa propriedade e diz que
`UseRazorSourceGenerator` vale `true` por padrão, então a compilação usa source
generation e o resultado vai para o assembly do próprio app. Depois do build os
arquivos estavam em `obj/Debug/net10.0/generated/Microsoft.CodeAnalysis.Razor.Compiler/.../`,
um `*_razor.g.cs` por componente (`Components_Pages_Probe_razor.g.cs`). Para esta
página:

```razor
@page "/probe/{Id:int}"
@attribute [StreamRendering]
@implements IDisposable
@inject ILogger<Probe> Log

<h1>Order @Id</h1>
<button @onclick="Add">Add</button>

@code {
    [Parameter] public int Id { get; set; }
    List<string> Items = ["a", "b"];
    void Add() => Items.Add("c");
    public void Dispose() => Log.LogInformation("disposed");
}
```

a classe gerada, sem as diretivas `#line`, era:

```csharp
[StreamRendering]
[RouteAttribute("/probe/{Id:int}")]
public partial class Probe : ComponentBase, IDisposable
{
    protected override void BuildRenderTree(RenderTreeBuilder __builder) { /* ... */ }

    [Parameter] public int Id { get; set; }          // o bloco @code, colado
    List<string> Items = ["a", "b"];
    void Add() => Items.Add("c");
    public void Dispose() => Log.LogInformation("disposed");

    [InjectAttribute] private ILogger<Probe> Log { get; set; } = default!;
}
```

Cada diretiva tem uma tradução literal. `@page` virou um atributo `[Route]` (então
um componente roteável é só uma classe com um atributo), `@attribute` copiou o
argumento para a classe, `@implements` adicionou uma interface, `@inject` virou
uma propriedade com `[Inject]` inicializada com `default!`, e `@code` foi colado
no corpo da classe sem mudanças. O nome da classe é o nome do arquivo, e o
namespace veio do namespace raiz mais a pasta (`app.Components.Pages`), a menos
que `@namespace` o substitua; a documentação de componentes dá essa ordem de
prioridade. Como a classe é `partial`, outro arquivo pode completá-la: um
`Cb.razor.cs` com `public partial class Cb { string Build() => "..."; }` foi
chamado pelo markup de `Cb.razor` e renderizou `from code-behind`. A documentação
avisa que os `@using` do `_Imports.razor` valem só para arquivos `.razor`, então
a metade `.cs` precisa dos próprios `using`.

### O que o `BuildRenderTree` faz com o markup

O markup vira chamadas em um `RenderTreeBuilder`, cada uma marcada com um número
de sequência que é apenas uma posição no código-fonte. As linhas relevantes da
página acima e de mais algumas construções (`@key`, `@bind`, um componente filho):

```csharp
__builder.OpenElement(0, "h1");
__builder.AddContent(1, "Order ");
__builder.AddContent(2, Id);
__builder.CloseElement();
// ...
foreach (var item in Items) {
    __builder.OpenElement(10, "li");
    __builder.SetKey(item);
    __builder.AddContent(11, item.ToUpper());
    __builder.CloseElement();
}
// ...
__builder.AddAttribute(19, "value", BindConverter.FormatValue(Name));
__builder.AddAttribute(20, "onchange", EventCallback.Factory.CreateBinder(this, __value => Name = __value, Name));
__builder.SetUpdatesAttributeName("value");
// ...
__builder.OpenComponent<Badge>(22);
__builder.AddComponentParameter(23, nameof(Badge.Text), TypeCheck<string>(Name));
__builder.AddAttribute(24, "ChildContent", (RenderFragment)((__builder2) => {
    __builder2.AddMarkupContent(25, "<strong>inside</strong>");
}));
__builder.CloseComponent();
```

Quatro coisas aparecem. O controle de fluxo em C# (`@if`, `@foreach`) é copiado
literalmente em volta das chamadas ao builder, então os "loops" do Razor são
loops C# de verdade, e os números dentro do corpo do loop são os mesmos a cada
iteração porque identificam um lugar no código, não um item. `@key` é uma chamada
(`SetKey`) e `@bind` se expande em um atributo `value` mais um callback
`onchange` criado por `CreateBinder`, e por isso um campo com bind é lido e
escrito pela mesma expressão. Um componente filho é um `OpenComponent<Badge>`
tipado, e o nome do parâmetro passa por `nameof`, então um erro de digitação em
um parâmetro é erro de compilação e não surpresa em runtime. O conteúdo entre as
tags de um componente vira uma lambda `RenderFragment` atribuída a
`ChildContent`. A documentação de rendering explica quando o framework executa
esse método de novo; o ponto aqui é que `BuildRenderTree` é código comum que roda
a cada render.

### O que o parser faz com o `@`

Renderizar a página mostrou as regras do parser em ação. `@Id` é uma expressão
implícita e `@(Quantity * Price)` uma explícita; a página imprimiu `Total: 3,0`
porque o resultado da expressão é formatado com a cultura atual desta máquina,
que usa vírgula decimal. A referência de sintaxe diz que expressões implícitas
não podem ter espaços (exceto depois de `await`) nem generics, que exigem a forma
explícita. No código gerado a frase `(contact: help@example.com, literal at: @@home)`
é uma única chamada `AddMarkupContent` com `... help@example.com, literal at: @home)`:
o e-mail foi deixado em paz, como a referência promete, e `@@` virou um `@`
literal em tempo de compilação. Um comentário Razor `@* ... *@` não deixou nada
na saída.

A saída é codificada em HTML: `@(1 < 2 ? "a<b" : "c")` renderizou `a&lt;b`. Para
emitir HTML cru é preciso optar por isso, e o código gerado mostra como:

```razor
@((MarkupString)"<em>raw</em>")   @* renderizou <em>raw</em> como markup de verdade *@
```

Esse cast é todo o opt-in, então um `MarkupString` montado a partir de entrada do
usuário é uma brecha de XSS. O whitespace também é uma decisão de compilação. Com
`@preservewhitespace` no padrão (`false`, segundo a referência), o whitespace em
volta de blocos de código e nas pontas dos elementos é removido; a lista
renderizada saiu como `<ul><li>A</li><li>B</li></ul><button>Add (many)</button>`,
sem as quebras de linha do código-fonte.

### Tags, nomes e o warning que passa batido

Uma tag é um componente só se o nome bate com um que está em escopo e começa com
letra maiúscula (regra documentada). `<badge>lowercase is html</badge>`
renderizou como um elemento `<badge>` literal, e `<Badge Text="x" />` como o
`<span>` do componente. Um componente com nome errado não é erro:
`<Bdge Text="x" />` compilou com o warning `RZ10012` ("Found markup element with
unexpected name 'Bdge'") e a página renderizou `<Bdge Text="x"></Bdge>` como
markup comum. Compilar com `-p:WarningsAsErrors=RZ10012` transformou isso em
erro, uma boa configuração para o CI, porque do contrário o typo vai para
produção.

### Generics, classes base e os limites

`@typeparam TItem` fez a classe gerada ser `Grid<TItem>`, `@inherits GridBase`
definiu a classe base, e um uso com `Items="@(new[] { 1, 2, 3 })"` compilou por um
helper gerado `TypeInference.CreateGrid_0`, de modo que `TItem` foi inferido como
`int` e `Context="n"` tipou o template da linha. Um template inline como
`RenderFragment Footer => @<p>footer @Items.Count()</p>;` virou uma lambda. Dois
limites apareceram nos testes, ambos no SDK 10.0.100:

- O mesmo template como inicializador de campo
  (`RenderFragment Footer = @<p>@Items...</p>;`) falhou com `CS0236`, porque um
  inicializador de campo não pode referenciar um membro de instância. Isso é C#,
  não Razor; use uma propriedade.
- Colocar `@rendermode InteractiveServer` no componente genérico `Grid<TItem>`
  falhou com `CS0305: Using the generic type 'Grid<TItem>' requires 1 type
  arguments`. O código gerado anexa à classe um atributo aninhado
  `__PrivateComponentRenderModeAttribute` e o referencia sem os argumentos de
  tipo. Não encontrei nada sobre isso na documentação, então confira a versão do
  seu SDK antes de depender de um render mode em um componente genérico.

### Razor, Razor Pages e Blazor

Razor é a sintaxe. Um arquivo `.cshtml` (Razor Pages ou view MVC) compila para uma
classe derivada de `RazorPage`, cujo `ExecuteAsync` escreve literais e valores na
resposta enquanto a página roda no servidor para uma requisição. Um arquivo
`.razor` compila para uma subclasse de `ComponentBase` cujo `BuildRenderTree`
monta uma árvore que o renderer compara e aplica. Algumas diretivas existem só em
um dos dois: a referência marca `@model`, `@section` e as diretivas de Tag Helper
como só `.cshtml`, e `@code`, `@layout`, `@typeparam`, `@rendermode` e os
atributos `@bind`/`@on...` como só `.razor`. Os dois passam pelo mesmo Razor SDK.

## Trade-offs

- **Markup e código no mesmo arquivo mantêm o componente junto, e uma partial
  class em code-behind tira o C# do markup.** A partial class enxerga os mesmos
  membros; só precisa dos próprios `using`.
  ```csharp
  public partial class Cb { string Build() => "from code-behind"; } // Cb.razor.cs
  ```
- **Geração em tempo de compilação dá parâmetros tipados e erros de compilação, e
  move alguns erros para o código gerado.** Um erro pode ser reportado em uma
  linha de um arquivo `.g.cs`; `EmitCompilerGeneratedFiles` é como você o lê.
- **`MarkupString` é a válvula de escape e o perigo.** Ele ignora a codificação
  por definição.
  ```razor
  @((MarkupString)userComment)   @* nunca com entrada sem sanitização *@
  ```
- **Remover whitespace mantém o DOM pequeno e surpreende layouts que dependem dos
  espaços.** `@preservewhitespace true` no topo do arquivo restaurou as quebras de
  linha na página de teste.
- **Um componente desconhecido é warning, não erro.** Sem warnings-as-errors, um
  typo em uma tag renderiza como um elemento desconhecido.
- **Generics e render modes interagem com atributos gerados.** Valide um
  componente com `@typeparam` mais `@rendermode` no seu SDK em vez de supor que
  funciona.

## Documentation Links

- [Razor syntax reference for ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/razor) (doc)
- [ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/) (doc)
- [ASP.NET Core Razor component rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Razor SDK, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/sdk) (doc)
- [ASP.NET Core Razor component generic type support, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/generic-type-support) (doc)
