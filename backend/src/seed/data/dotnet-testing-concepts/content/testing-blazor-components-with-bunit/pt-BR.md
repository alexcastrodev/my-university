---
version: 1.0
updatedAt: 2026-10-18
title: "Testando Componentes Blazor com bUnit e MSTest"
summary: Renderize componentes Blazor em memória com bUnit 2 dentro do MSTest, teste parâmetros, formulários, serviços fake, JSInterop estrito, cascading values, autorização e renderização assíncrona, e evite os testes que passam pelo motivo errado.
---
## Objective

Um componente Blazor é uma função dos seus parâmetros, dos seus serviços e dos
eventos que o usuário dispara, e a maioria dos bugs mora aí: um botão que continua
habilitado, uma mensagem de validação que nunca aparece, um delete que ignora o
"Cancelar". O bUnit renderiza um componente em memória, sem browser, deixa o teste
clicar e digitar, e expõe o markup resultante para as asserções, em milissegundos.
O objetivo é testar componentes com bUnit dentro do MSTest: parâmetros e
callbacks, formulários, serviços injetados com um fake, interop com JavaScript,
cascading values, autorização e renderização assíncrona, evitando os três jeitos
de um teste bUnit mentir (conferir antes de a renderização terminar, esconder
chamadas JavaScript atrás do modo loose e selecionar por classe CSS), e sabendo o
que o bUnit simplesmente não testa.

## Use Cases

- Provar que um formulário mostra as mensagens de validação e só dispara o
  callback para entrada válida.
- Testar um componente que carrega dados no `OnInitializedAsync`, incluindo os
  estados de carregando e de vazio, sem servidor e sem banco.
- Fixar quais chamadas JavaScript um componente faz (`confirm`, uma função de
  analytics ou de anúncio) e o comportamento para cada resposta.
- Conferir que um `AuthorizeView` esconde uma ação de usuários sem um papel.
- Manter os testes de componente verdes durante um redesign de CSS.

## Deep Dive

### O pacote e o contexto

O bUnit atual é o 2.11.3, um único pacote `bunit` com target `net10.0`. Ele não
depende de framework de teste, então fica ao lado do MSTest num projeto de teste
comum:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
  <PackageReference Include="bunit" Version="2.11.3" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
  <Using Include="Bunit" />
</ItemGroup>
```

Tudo passa por um `BunitContext`: o renderer, uma coleção de serviços, o JSInterop
fake. O setup mais simples é herdar dele:

```csharp
[TestClass]
public sealed class CounterTests : BunitContext
{
    [TestMethod]
    public void ClickingTheButtonIncrementsTheCount()
    {
        var cut = Render<Counter>();

        cut.Find("button").Click();

        cut.Find("[role=status]").MarkupMatches("<p role=\"status\">Clicked 1 of 3</p>");
    }
}
```

O MSTest cria uma instância nova da classe para cada método de teste e a descarta
(dispose) depois, então cada teste ganha o próprio renderer e os próprios
serviços, e `[Parallelize(Scope = ExecutionScope.MethodLevel)]` continua seguro.
Quando a classe já tem uma classe base, crie o contexto em vez de herdar:
`using var ctx = new BunitContext();`.

Antes do bUnit 2 a classe se chamava `TestContext`, que também é o nome do
`TestContext` do MSTest. Um arquivo que importa os dois namespaces não compila:

```text
error CS0104: 'TestContext' is an ambiguous reference between 'Bunit.TestContext'
and 'Microsoft.VisualStudio.TestTools.UnitTesting.TestContext'
```

O bUnit 2 a renomeou para `BunitContext`, trocou `RenderComponent` por `Render` e
renomeou os test doubles `Fake*` para `Bunit*`. Posts antigos com
`RenderComponent<T>` e `TestContext` são do bUnit 1.

### Parâmetros, callbacks e markup

Os parâmetros passam por um builder. Um parâmetro `EventCallback` aceita uma
lambda, que é como o teste captura o que o componente disparou:

```csharp
var reached = new List<int>();
var cut = Render<Counter>(p => p
    .Add(c => c.Max, 2)
    .Add(c => c.OnLimitReached, (int count) => reached.Add(count)));

cut.Find("button").Click();
cut.Find("button").Click();

Assert.IsTrue(cut.Find("button").HasAttribute("disabled"));
Assert.AreEqual(2, Assert.ContainsSingle(reached));
```

`Find` recebe um seletor CSS e lança exceção quando nada casa; `FindAll` devolve
uma lista. `MarkupMatches` compara HTML semanticamente, então espaços em branco e
a ordem de atributos e classes não importam. Use-o para um fragmento pequeno e
estável. Para o resto, confira a única coisa de que o teste trata (um atributo, um
texto), porque uma comparação do markup inteiro quebra a cada mudança não
relacionada.

### Eventos e formulários

`Click()`, `Change(value)`, `Input(value)` e `Submit()` disparam os mesmos eventos
que o browser dispararia. Um `EditForm` é uma árvore de componentes normal, então
o teste preenche os inputs e envia o formulário:

```csharp
[TestMethod]
public void AValidSubmitRaisesOnCreateAndClearsTheForm()
{
    var cut = RenderForm();
    cut.Find("#title").Change("Buy milk");
    cut.Find("#priority").Change("5");

    cut.Find("form").Submit();

    var created = Assert.ContainsSingle(_created);
    Assert.AreEqual("Buy milk", created.Title);
    Assert.AreEqual(5, created.Priority);
    Assert.AreEqual("", cut.Find("#title").GetAttribute("value"));
}
```

O `InputText` faz bind no `change`, então `Change` é o evento certo; um input com
`@bind:event="oninput"` precisa de `Input`. O caso inválido confere os dois lados:
a mensagem que o `DataAnnotationsValidator` produziu está no markup, e o callback
nunca rodou:

```csharp
cut.Find("form").Submit();

Assert.Contains("Give the task a title.", cut.Markup);
Assert.IsEmpty(_created);
```

### Serviços: registre o fake antes da primeira renderização

Um componente que injeta um serviço o recebe de `Services`, um
`IServiceCollection` normal. Registre um fake escrito à mão:

```csharp
Services.AddSingleton<ITaskStore>(store);
var cut = Render<TaskList>();
```

A ordem importa. Depois que uma renderização resolveu um serviço, a coleção fica
fechada, e um `AddSingleton` posterior lança "New services/implementations cannot
be registered with the Services provider in a BunitContext, after the first
services has been retrieved from it". Registre tudo, depois renderize.

### Renderização assíncrona: espere pelo estado, não pelo tempo

O `TaskList` carrega no `OnInitializedAsync`. Quando o store responde depois, o
`Render` retorna com "Loading tasks..." e o componente renderiza de novo quando a
task termina. O store fake do lab segura o `GetAllAsync` até o teste chamar
`Release()`, o que deixa os dois momentos explícitos:

```csharp
[TestMethod]
public void ShowsLoadingUntilTheStoreAnswers()
{
    var store = new FakeTaskStore(_milk, _dog) { HoldLoading = true };
    var cut = RenderList(store);
    Assert.Contains("Loading tasks...", cut.Markup);

    store.Release();

    cut.WaitForAssertion(() => Assert.HasCount(2, cut.FindAll("li")));
}
```

`Assert.HasCount(2, cut.FindAll("li"))` logo depois do `Release()` falha com
"actual count: 0". O `WaitForAssertion` roda a asserção agora e de novo depois de
cada renderização, e lança `WaitForFailedException` se ela não passou em um
segundo (o padrão; o segundo argumento muda isso). `WaitForState(predicate)` faz o
mesmo com uma condição. Nunca use `Thread.Sleep`.

A versão perigosa passa. Para um store vazio, "não há `<li>`" também é verdade
enquanto o componente ainda está carregando:

```csharp
store.Release();

// Conferir "nenhum <li>" logo de cara passaria com a lista ainda carregando.
cut.WaitForState(() => cut.Markup.Contains("No tasks yet."));
Assert.IsEmpty(cut.FindAll("li"));
```

Sem o `WaitForState`, o teste passa mesmo quando o `OnInitializedAsync` nunca
atribui a lista e a página fica presa em "Loading tasks..." para sempre. Espere o
sinal positivo do estado que você espera, depois confira o que precisa estar
ausente.

### Interop com JavaScript: estrito por padrão

O bUnit substitui o `IJSRuntime` pelo dele, e no modo padrão `Strict` uma chamada
que o teste não planejou lança exceção. A mensagem diz o que adicionar:

```text
Bunit.JSRuntimeUnhandledInvocationException: bUnit's JSInterop has not been configured to handle the call:
    InvokeAsync<bool>("confirm", "Delete 'Buy milk'?")
```

`Setup<T>` responde a um `InvokeAsync<T>`, casando o identificador e, quando
informados, os argumentos exatos. `SetupVoid` trata o `InvokeVoidAsync`, e
`VerifyInvoke` confere que uma chamada aconteceu:

```csharp
JSInterop.Setup<bool>("confirm", "Delete 'Buy milk'?").SetResult(false);
var cut = RenderList(store);

cut.Find("button[aria-label='Delete Buy milk']").Click();

Assert.HasCount(2, cut.FindAll("li"));
```

```csharp
JSInterop.SetupVoid("taskBoard.announce", "Added Walk the dog");
// ... preenche o formulário e envia ...
JSInterop.VerifyInvoke("taskBoard.announce");
```

`JSInterop.Mode = JSRuntimeMode.Loose` responde toda chamada não planejada com
`default(T)`. É conveniente para um componente que chama JavaScript que não
interessa ao teste, mas também faz o `confirm` devolver `false` em silêncio e
esconde se o componente chama JavaScript ou não. Prefira o modo estrito com
setups explícitos, e mude para loose por teste, com um motivo.

### Cascading values e autorização

`AddCascadingValue` envolve o componente num `<CascadingValue>`, como um layout
pai faria:

```csharp
var cut = Render<TaskList>(p => p.AddCascadingValue(new BoardSettings(HideCompleted: true)));
```

Um `<AuthorizeView>` precisa dos serviços de autorização e do authentication
state em cascata que uma aplicação real fornece. Sem eles, a renderização falha
com "There is no registered service of type
'Microsoft.AspNetCore.Authorization.IAuthorizationPolicyProvider'", mesmo em
testes que não tratam de autorização. `AddAuthorization()` registra os serviços e
a cascata, e devolve um `BunitAuthorizationContext` que define o usuário:

```csharp
private readonly BunitAuthorizationContext _auth;

public TaskListTests() => _auth = AddAuthorization();

[TestMethod]
public void OnlyALeadSeesClearCompleted()
{
    _auth.SetAuthorized("bob");
    var cut = RenderList(new FakeTaskStore(_milk));
    Assert.IsFalse(cut.FindAll("button").Any(b => b.TextContent.Trim() == "Clear completed"));

    _auth.SetRoles("lead");
    cut.Render();

    Assert.IsNotNull(ButtonWithText(cut, "Clear completed"));
}
```

`SetRoles`, `SetPolicies` e `SetClaims` cobrem views baseadas em papel, em policy
e em claim. `AddAuthorization` é uma extensão do contexto, então dentro de uma
classe que herda `BunitContext` ela é chamada em `this`.

### Selecione o que o usuário vê, não o CSS

Uma tarefa concluída renderiza `class="task done text-muted"`. Um teste que busca
`li.done` funciona até alguém mudar o estilo da lista. Selecione pelo que um
usuário ou um leitor de tela vê: um `aria-label`, um `id` ligado a um `<label>`,
o texto de um botão:

```csharp
cut.Find("input[aria-label='Done: Buy milk']").Change(true);

Assert.IsTrue(milk.Done);
Assert.IsTrue(cut.Find("input[aria-label='Done: Buy milk']").HasAttribute("checked"));
```

No lab, renomear a classe para `"task is-complete"` deixa os 14 testes verdes,
enquanto um teste escrito como `cut.FindAll("li.done")` fica vermelho numa mudança
que não quebrou nada. Um elemento difícil de selecionar sem classe CSS muitas
vezes está sem nome acessível, o que já é um bug por si só.

### Os testes protegem os componentes?

Quebre o código de produção de propósito, uma mudança por vez. Estes são os
resultados para a solution do lab:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `OnInitializedAsync` aguarda o store mas nunca atribui a lista | 8 testes de `TaskList`, incluindo os dois de carregamento |
| O delete ignora a resposta do `confirm` | `DecliningTheDeleteKeepsTheTask` |
| Marcar uma tarefa não a salva | `TickingTheCheckboxMarksTheTaskDoneAndSavesIt` |
| `Roles="lead"` removido do `AuthorizeView` | `OnlyALeadSeesClearCompleted` |
| O `HideCompleted` em cascata é ignorado | `HideCompletedFromTheCascadingSettingsHidesDoneTasks` |
| A chamada `taskBoard.announce` é removida | `AddingATaskSavesItShowsItAndAnnouncesIt` |
| `<DataAnnotationsValidator />` removido | os dois testes de formulário inválido |
| O contador desabilita em `count > Max` | `AtTheLimitTheButtonIsDisabledAndTheCallbackGetsTheCount` |
| A classe CSS de uma tarefa concluída renomeada | nenhum, como deve ser |

A primeira linha é a que o teste ingênuo do store vazio deixa passar.

### O que o bUnit não testa

O bUnit renderiza em memória com o próprio renderer. Ele consegue emular um render
mode (`SetAssignedRenderMode`, `SetRendererInfo`) para que um branch em
`RendererInfo.IsInteractive` seja testável, mas não roda um circuito do Blazor
Server, WebAssembly nem prerendering. Ele não roda JavaScript de verdade (só os
setups que você escreveu), não aplica CSS nem layout, e o
`BunitNavigationManager` registra as chamadas a `NavigateTo` sem um browser por
trás. Roteamento entre páginas, uma reconexão do SignalR, um módulo JS que lança
erro ou um botão escondido atrás de outro elemento pedem um teste end-to-end, por
exemplo com Playwright contra a aplicação rodando.

## Trade-offs

- **bUnit vs Playwright.** Testes bUnit rodam em milissegundos e apontam o
  componente; o Playwright testa a aplicação que o usuário vê, com JS, CSS e
  render modes reais, e custa segundos por teste e um servidor rodando. Muitos
  testes bUnit e poucos end-to-end é a divisão usual.
- **JSInterop estrito dá mais setup.** Cada chamada JS precisa de uma linha, e uma
  chamada nova no componente quebra testes antigos. Essa quebra é informação: o
  teste descobre que o componente agora depende de JavaScript.
  ```csharp
  JSInterop.Mode = JSRuntimeMode.Loose; // por teste, quando o JS realmente não importa
  ```
- **Fakes escritos à mão vs mocks.** Um store fake com a trava `HoldLoading` deixa
  o estado de carregamento explícito e não precisa de biblioteca; uma biblioteca
  de mock é mais curta para uma resposta avulsa, mas tende a verificar chamadas em
  vez do resultado renderizado.
- **`MarkupMatches` em fragmentos grandes é frágil.** A comparação semântica
  perdoa espaços e ordem de atributos, não uma `<div>` nova envolvendo tudo.
  Guarde-o para fragmentos pequenos e estáveis.
- **Herdar `BunitContext` gasta a única classe base.** Uma base compartilhada dos
  seus testes passa a ter de herdar `BunitContext`, ou o teste cria um
  `BunitContext` e chama `ctx.Render`.
- **Testes em arquivos `.razor` são uma opção.** O bUnit também renderiza
  fragmentos Razor escritos inline (`Render(@<Counter Max="2" />)`), e a
  documentação dele define o SDK do projeto de teste como `Microsoft.NET.Sdk.Razor`
  para isso. Eles ficam legíveis para componentes cheios de markup. O lab escreve
  só testes `.cs`, e o projeto de teste roda no `Microsoft.NET.Sdk` comum.
- **xUnit e NUnit funcionam igual.** O bUnit não depende de framework; com xUnit a
  classe de teste herda `BunitContext` do mesmo jeito, e `[Fact]` substitui
  `[TestMethod]`.

## Lab

Um quadro de tarefas numa Razor class library (um contador, um `EditForm` e uma lista de tarefas) já está implementado. Sua tarefa é escrever os testes bUnit em MSTest e aprender onde um teste de componente pode passar pelo motivo errado.

**O que você vai praticar**

- Renderizar com parâmetros e `EventCallback`s, e conferir com `Find`, `FindAll` e `MarkupMatches`.
- Preencher e enviar um `EditForm`, válido e inválido.
- Registrar um serviço fake e esperar a renderização assíncrona com `WaitForAssertion` e `WaitForState`.
- JSInterop estrito com `Setup<T>`, `SetupVoid` e `VerifyInvoke`.
- Cascading values, `AddAuthorization` e seletores que sobrevivem a uma mudança de CSS.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, Blazor Component Lifecycle and Parameters, Blazor Forms: EditForm and Validation, .NET 10 SDK.

**Como funciona:** cada método de teste está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. Um store fake já vem pronto e consegue segurar o carregamento de propósito. Os TODOs opcionais pedem para renomear uma classe CSS e quebrar os componentes, e ver quais testes percebem.

## Documentation Links

- [bUnit: writing tests](https://bunit.dev/docs/getting-started/writing-tests.html) (doc)
- [bUnit: migrating from 1.x to 2.x](https://bunit.dev/docs/migrations/1to2.html) (doc)
- [bUnit: verifying markup](https://bunit.dev/docs/verification/verify-markup.html) (doc)
- [bUnit: asynchronous assertions](https://bunit.dev/docs/verification/async-assertion.html) (doc)
- [bUnit: emulating IJSRuntime](https://bunit.dev/docs/test-doubles/emulating-ijsruntime.html) (doc)
- [bUnit: faking authentication and authorization](https://bunit.dev/docs/test-doubles/auth.html) (doc)
- [bUnit: render modes and RendererInfo](https://bunit.dev/docs/interaction/render-modes.html) (doc)
- [Test Razor components in ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/test) (doc)
