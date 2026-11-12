---
version: 1.0
updatedAt: 2026-11-12
title: "Testes end-to-end com Playwright for .NET"
summary: Escreva testes Playwright for .NET com MSTest 4 contra um app ASP.NET Core em Kestrel real (não TestServer), com locators, auto-wait, trace viewer e Page Objects, e saiba por que o pacote Microsoft.Playwright.MSTest descobre 0 testes com MSTest 4.
---
## Objective

Testes unitários, `WebApplicationFactory` e bUnit param antes de um navegador real.
Um teste end-to-end conduz o Chromium contra o app rodando, com JavaScript, CSS e rede
de verdade, e por isso pega o que as camadas de baixo não pegam: um botão que existe
mas não dá para clicar, um script que nunca carrega. O objetivo é escrever testes
Playwright for .NET com MSTest 4 contra um app ASP.NET Core rodando num socket Kestrel
real (não `TestServer`): locators que um usuário usaria, asserções web-first que
esperam, um trace para ler uma falha e um Page Object para que o DOM fique numa classe
só. Também cobre uma armadilha real de compatibilidade: o pacote
`Microsoft.Playwright.MSTest` não funciona com MSTest 4.

## Use Cases

- Provar que a página, o script e a API funcionam juntos num fluxo crítico (adicionar
  uma tarefa, concluir, ver o total).
- Checar comportamento que só um navegador tem: foco, visibilidade, uma resposta lenta
  seguida de renderização, um reload que mantém os dados.
- Reproduzir uma falha de CI a partir de um trace (screenshots, snapshots do DOM, rede)
  em vez de um stack trace e um palpite.
- Rodar poucos fluxos de fumaça depois de um deploy enquanto os muitos testes rápidos
  ficam nas camadas unitária e de integração.

## Deep Dive

### O pacote que descobre 0 testes

O caminho documentado é `Microsoft.Playwright.MSTest` e uma classe base `PageTest`. Com
MSTest 4.5.3 no SDK .NET 11 GA, um projeto que referencia `MSTest` 4.5.3 e
`Microsoft.Playwright.MSTest` 1.64.1 compila, imprime o aviso MSTEST0082 para os membros
herdados com `[TestInitialize]` e `[TestCleanup]`, e o `dotnet test` responde "No test is
available". A causa está nas referências do assembly: `Microsoft.Playwright.MSTest.dll`
referencia `Microsoft.VisualStudio.TestPlatform.TestFramework` 14.0.0.0, o nome de assembly
do MSTest 2.x, enquanto o MSTest 4 traz `MSTest.TestFramework`. O MSTest compara seus
atributos por identidade exata de tipo, então os hooks do `PageTest` são ignorados em
silêncio, e o adapter não consegue carregar o assembly antigo ao descobrir os testes. O
nuspec do pacote ainda depende do MSTest 2.2.7. Trocar o MSTest pela 3.11.1 faz o mesmo
teste passar, o que confirma a causa.

A saída com MSTest 4 é referenciar o pacote core `Microsoft.Playwright` (1.64.1) e escrever
você mesmo a classe base pequena:

```xml
<PackageReference Include="MSTest" Version="4.5.3" />
<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.14" />
<PackageReference Include="Microsoft.Playwright" Version="1.64.1" />
```

São cerca de 30 linhas, mostradas abaixo, e tiram a dependência de um pacote que está
atrás do framework.

### Instale o navegador uma vez

O Playwright usa seus próprios navegadores. Compilar o projeto de teste copia o
`playwright.ps1` para junto do assembly; rode-o uma vez:

```bash
dotnet build
pwsh bin/Debug/net10.0/playwright.ps1 install chromium
```

Sem PowerShell, um console app que chama
`Microsoft.Playwright.Program.Main(["install", "chromium"])` faz o mesmo (foi assim que o
lab foi verificado). Use `PLAYWRIGHT_BROWSERS_PATH` para escolher onde os navegadores
ficam. O teste só precisa do Chromium; no CI, instale antes do `dotnet test` e faça cache
da pasta.

### Kestrel real, não TestServer

O `WebApplicationFactory` hospeda o app no `TestServer` por padrão, que não tem socket:
um navegador não consegue abri-lo. Suba o Kestrel no lugar, uma vez por execução:

```csharp
[TestClass]
public static class TestEnvironment
{
    private static WebApplicationFactory<Program>? _factory;
    private static IPlaywright? _playwright;
    public static string BaseUrl { get; private set; } = "";
    public static IBrowser Browser { get; private set; } = null!;
    public static TaskStore Store => _factory!.Services.GetRequiredService<TaskStore>();

    [AssemblyInitialize]
    public static async Task Start(TestContext _)
    {
        _factory = new WebApplicationFactory<Program>();
        _factory.UseKestrel(0);          // uma porta livre em 127.0.0.1
        _factory.StartServer();
        BaseUrl = _factory.CreateClient().BaseAddress!.ToString();

        _playwright = await Playwright.CreateAsync();
        Browser = await _playwright.Chromium.LaunchAsync(new() { Headless = true });
    }

    [AssemblyCleanup]
    public static async Task Stop()
    {
        await Browser.CloseAsync();
        _playwright?.Dispose();
        if (_factory is not null) await _factory.DisposeAsync();
    }
}
```

`UseKestrel(0)` (novo no .NET 10, veja o concept de WebApplicationFactory) escolhe uma
porta livre, e o `BaseAddress` do client diz qual. Um host e um processo de navegador
atendem a execução inteira; subir um navegador por teste é o erro lento. Como o host é
compartilhado, os testes zeram o estado do servidor (aqui o singleton `TaskStore`) antes
de cada um.

### Uma classe base: um contexto por teste, um trace quando falha

O substituto do `PageTest` é uma classe base com hooks do MSTest. Um contexto de navegador
é barato e isolado (cookies e storage próprios), então cada teste ganha um novo. O trace
grava screenshots e snapshots do DOM e só é salvo quando o teste não passou:

```csharp
public abstract class E2ETest
{
    public TestContext TestContext { get; set; } = null!;
    protected IBrowserContext Context { get; private set; } = null!;
    protected IPage Page { get; private set; } = null!;

    [TestInitialize]
    public async Task OpenBrowserContext()
    {
        TestEnvironment.Store.Clear();
        Context = await TestEnvironment.Browser.NewContextAsync(new() { BaseURL = TestEnvironment.BaseUrl });
        await Context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true });
        Page = await Context.NewPageAsync();
    }

    [TestCleanup]
    public async Task CloseBrowserContext()
    {
        var failed = TestContext.CurrentTestOutcome != UnitTestOutcome.Passed;
        await Context.Tracing.StopAsync(failed
            ? new() { Path = Path.Combine(TestContext.TestResultsDirectory!, $"{TestContext.TestName}.zip") }
            : null);
        await Context.CloseAsync();
    }
}
```

Um teste que falha deixa `<NomeDoTeste>.zip` na pasta de resultados (com as configurações
padrão, junto do assembly de teste). Abra com `playwright.ps1 show-trace arquivo.zip`: uma
linha do tempo com cada ação, a página antes e depois, o console e a rede.

### Locators e asserções web-first

Um locator descreve como um usuário encontra um elemento, e é preguiçoso: nada é procurado
até uma ação ou asserção usá-lo. Prefira role, label, texto e test id a CSS:

```csharp
Page.GetByRole(AriaRole.Button, new() { Name = "Add task" });
Page.GetByLabel("New task", new() { Exact = true });
Page.GetByTestId("open-count");
```

Esses sobrevivem a uma mudança de estilo e funcionam como checagem de acessibilidade, já
que um elemento sem role ou label também é difícil de achar para um leitor de tela. As
ações (`ClickAsync`, `FillAsync`, `CheckAsync`) esperam o elemento estar anexado, visível,
estável e habilitado antes de agir. As asserções usam `Expect`, que tenta de novo até
passar ou estourar o tempo (5 segundos por padrão):

```csharp
using static Microsoft.Playwright.Assertions;

await Expect(Tasks.Loading).ToBeVisibleAsync();
await Expect(Tasks.Loading).ToBeHiddenAsync();
await Expect(Tasks.OpenCount).ToHaveTextAsync("0 open");
```

A página do lab mostra "Loading tasks..." por 300 ms porque a API é lenta de propósito. O
teste não precisa de sleep: cada `Expect` espera a página chegar. Não leia um valor uma vez
e faça `Assert.AreEqual` nele (`await locator.TextContentAsync()`): esse retrato não tem
retry e é a maior fonte de testes E2E instáveis.

O auto-wait tem limites, que aparecem como falhas reais. No lab, um teste adicionou duas
tarefas em seguida. A página limpa o input quando o primeiro POST volta, então o título da
segunda tarefa, digitado cedo demais, foi apagado, e o teste falhou com "expected count 2,
was 1". A correção é um ponto de sincronização que o usuário também teria: esperar a
primeira tarefa aparecer antes de digitar a segunda. Outra armadilha é a asserção que passa
pelo motivo errado: a lista fica escondida até carregar, então `ToHaveCountAsync(0)` é
verdadeira antes de qualquer coisa chegar; espere o "0 open" primeiro.

### Page Object: o DOM numa classe

Quando dez testes repetem `GetByRole(AriaRole.Button, new() { Name = "Add task" })`,
renomear esse botão quebra dez testes. Um Page Object é dono dos locators e das ações no
nível do usuário, e os testes dizem o que uma pessoa faz:

```csharp
public sealed class TasksPage(IPage page)
{
    public ILocator Items => page.GetByRole(AriaRole.List, new() { Name = "Task list" }).GetByRole(AriaRole.Listitem);
    public ILocator OpenCount => page.GetByTestId("open-count");

    public async Task OpenAsync() => await page.GotoAsync("/");

    public async Task AddAsync(string title)
    {
        await page.GetByLabel("New task", new() { Exact = true }).FillAsync(title);
        await page.GetByRole(AriaRole.Button, new() { Name = "Add task" }).ClickAsync();
    }
}
```

```csharp
await Tasks.OpenAsync();
await Tasks.AddAsync("Write the report");
await Expect(Tasks.Items).ToHaveCountAsync(1);
```

Mantenha as asserções no teste, não no Page Object: o objeto expõe locators e ações, e o
teste decide o que checar. A suíte do lab tem seis testes e roda em cerca de 6 segundos.

## Trade-offs

- **E2E é a camada mais lenta e menos precisa.** Uma falha diz "algo neste fluxo quebrou",
  não qual linha. Guarde o E2E para poucos fluxos críticos; teste regras em testes unitários,
  o contrato HTTP com `WebApplicationFactory` e componentes com bUnit.
- **bUnit vs Playwright.** O bUnit renderiza um componente em milissegundos, sem navegador,
  e não enxerga CSS, navegação real nem interop de JavaScript. O Playwright enxerga tudo
  isso e custa um navegador. Use os dois no Blazor.
- **Host e navegador compartilhados são rápidos e pedem disciplina.** Zerar o estado do
  servidor por teste e usar um contexto por teste dá isolamento. Rodar os testes E2E em
  paralelo exige dados por teste (títulos únicos) porque o store é compartilhado.
- **Seletores prendem os testes à marcação.** Locators por role e label prendem ao que o
  usuário percebe, que muda menos, mas um botão renomeado na UI ainda os quebra. O Page
  Object mantém isso em um arquivo.
- **Navegadores são uma dependência.** O passo de instalação, o cache e a versão fixada pelo
  pacote (a 1.64.1 corresponde a um build específico do Chromium) precisam ser tratados em
  toda máquina de desenvolvimento e no CI. O pacote e o navegador andam juntos.
- **`Microsoft.Playwright.MSTest` é feito para a identidade antiga do assembly do MSTest.**
  Com o MSTest 3.11.1, o `PageTest` funciona (verificado). No MSTest 4, use o pacote core e
  sua própria classe base, e confira as notas de versão do pacote Playwright antes de
  abandonar a classe base.
- **O Selenium ainda existe.** O auto-wait, o tracing e os contextos por teste do Playwright
  são os motivos de equipes migrarem do Selenium; veja o concept de Selenium para o modelo
  mais antigo.

## Lab

O app de tarefas já está implementado: uma minimal API e uma página estática que lista, adiciona, conclui e apaga tarefas, com uma lista que responde após 300 ms. Sua tarefa é escrever os testes Playwright que o conduzem num Chromium headless.

**O que você vai praticar**

- Um Page Object com locators por role, label e test id.
- Asserções web-first que esperam, sem sleep.
- Um host Kestrel real com `WebApplicationFactory.UseKestrel(0)` e um trace salvo na falha.
- Encontrar a corrida de digitação e a asserção que passa pelo motivo errado.

**Pré-requisitos:** o concept de WebApplicationFactory, o ciclo de vida do MSTest, .NET 10 SDK e o Chromium instalado uma vez (veja o README).

**Como funciona:** o host, o navegador e a classe base já vêm prontos. `TasksPage` e os seis testes são seus; cada um falha com `TODO-NN: write this test` até você escrevê-lo. O README explica por que o lab usa `Microsoft.Playwright` e não `Microsoft.Playwright.MSTest`.

## Documentation Links

- [Playwright for .NET: Getting started](https://playwright.dev/dotnet/docs/intro) (doc)
- [Playwright for .NET: Test runners](https://playwright.dev/dotnet/docs/test-runners) (doc)
- [Playwright: Locators](https://playwright.dev/dotnet/docs/locators) (doc)
- [Playwright: Auto-waiting](https://playwright.dev/dotnet/docs/actionability) (doc)
- [Playwright: Trace viewer](https://playwright.dev/dotnet/docs/trace-viewer) (doc)
- [Playwright: Page object models](https://playwright.dev/dotnet/docs/pom) (doc)
- [WebApplicationFactory<TEntryPoint>.UseKestrel method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1.usekestrel) (doc)
- [MSTEST0082 analyzer, Microsoft Learn](https://learn.microsoft.com/dotnet/core/testing/mstest-analyzers/mstest0082) (doc)
