---
version: 1.0
updatedAt: 2026-10-15
title: "Static SSR e Enhanced Navigation no Blazor"
summary: Como o Blazor renderiza páginas só no servidor, o que enhanced navigation e enhanced forms fazem na rede, binding com antiforgery e streaming rendering, tudo observado em um app rodando.
---
## Objective

Static server-side rendering (static SSR) é o modo do Blazor sem circuito e sem
WebAssembly: uma requisição chega, a árvore de componentes Razor renderiza para
HTML, a resposta sai e o servidor esquece a página. É o padrão certo para a
maioria das páginas e, com três adições, parece bem menos a web de 2005:
enhanced navigation (links que não recarregam a página), enhanced forms (posts
que não recarregam a página) e streaming rendering (uma página que mostra
placeholders agora e os dados reais quando ficam prontos). Este concept explica
como cada um dos três funciona na rede, o que o token antiforgery tem a ver com
o binding do formulário e quais erros produzem um `400` silencioso.

## Use Cases

- Montar um site de conteúdo, admin ou CRUD com páginas renderizadas no servidor
  e `EditForm`, sem enviar um runtime WebAssembly nem manter um circuito aberto.
- Fazer a navegação entre páginas parecer instantânea sem tornar cada página
  interativa.
- Mostrar o esqueleto da página imediatamente enquanto uma consulta lenta ou uma
  chamada de API termina, com `[StreamRendering]`.
- Depurar um formulário que posta mas nunca faz o binding, ou um post que
  devolve `400 Bad Request` sem stack trace.

## Deep Dive

### O que o static SSR precisa

O projeto criado com `dotnet new blazor -int None` (SDK 10.0.100) mostra toda a
configuração. Não existe `AddInteractiveServerComponents` nem
`AddInteractiveWebAssemblyComponents`:

```csharp
builder.Services.AddRazorComponents();
// ...
app.UseAntiforgery();
app.MapStaticAssets();
app.MapRazorComponents<App>();
```

Os componentes com `@page` viram endpoints, uma requisição executa a árvore uma
vez e a saída é HTML. O `UseAntiforgery()` está no pipeline porque formulários
são um recurso de primeira classe aqui, e o template o coloca logo antes dos
endpoints. Eventos como `@onclick` não fazem nada em uma página estática, porque
não há ninguém escutando no browser.

### Enhanced navigation

O `blazor.web.js` intercepta o clique em um link interno do app e faz um `fetch`
do destino em vez de deixar o browser carregar um documento novo. O servidor
devolve a página completa e o script aplica as diferenças no DOM atual. Eu
confirmei isso em um browser com duas páginas que apontam uma para a outra:

| Conferência depois do clique | Link enhanced | Link com `data-enhance-nav="false"` |
|---|---|---|
| URL mudou | sim | sim |
| Conteúdo atualizou (um timestamp de render) | sim | sim |
| Uma variável de `window` definida antes do clique | continua lá | sumiu |
| Uma propriedade expando no elemento `<h1>` | continua lá (mesmo elemento) | sumiu (elemento novo) |
| Rede | um `GET` da página | página, CSS, scripts e favicon pedidos de novo |

A requisição leva `Accept: text/html; blazor-enhanced-nav=on` e a resposta tem o
header `blazor-enhanced-nav: allow` (mais um header `ssr-framing`). Um `curl` na
mesma URL com e sem esse `Accept` devolve a mesma página: um `diff` dos dois
mostra só o timestamp de render e um comentário HTML no final com os
initializers do Blazor, que a resposta enhanced omite (8156 contra 8367 bytes).
Ou seja, enhanced navigation é uma otimização no cliente sobre a renderização
normal do servidor, e sem o header a página continua funcionando com um load
completo.

Dá para desligar por link ou por subárvore com `data-enhance-nav="false"`.
Segundo a documentação, um destino que não é endpoint do Blazor faz o script
tentar de novo como load normal de página, e uma mudança de DOM feita à mão que
o servidor não renderiza pode ser protegida do patch com `data-permanent`. O
`NavigationManager.NavigateTo` segue a mesma lógica: com `forceLoad: false` usa
enhanced navigation quando disponível, e o `Refresh()` busca a página atual de
novo pelo mesmo caminho.

### Formulários: binding e o token antiforgery

Um `EditForm` em uma página estática precisa de um nome, de um model preenchido
a partir dos campos postados e de `Enhance` se você quer o comportamento sem
reload:

```razor
@page "/ssr/form"
<EditForm Model="Model" FormName="contact" OnValidSubmit="Submit" Enhance>
    <DataAnnotationsValidator />
    <InputText @bind-Value="Model.Name" />
    <ValidationMessage For="() => Model.Name" />
    <button type="submit">Send</button>
</EditForm>

@code {
    [SupplyParameterFromForm] private Contact? Model { get; set; }
    protected override void OnInitialized() => Model ??= new();
    private string? result;
    private void Submit() => result = $"Hello {Model!.Name}";
}
```

O `[SupplyParameterFromForm]` fica vazio no primeiro GET e é preenchido a partir
do corpo da requisição no POST, por isso o `??=` é necessário. A marcação que o
servidor produziu mostra o que faz o post funcionar:

```text
<form method="post" data-enhance="" action="/ssr/form">
  <input type="hidden" name="_handler" value="contact" />
  <input type="hidden" name="__RequestVerificationToken" value="..." />
  <input name="Model.Name" class="valid" />
```

O `_handler` é o `FormName`, o `__RequestVerificationToken` é o token
antiforgery (com um cookie correspondente) e o nome de campo `Model.Name` é o
caminho de propriedade usado no binding. Postar nessa URL com `curl` deu:

| POST | Status | Resultado |
|---|---|---|
| Token e cookie, `Name=Ana` | 200 | `Hello Ana` renderizado |
| Token e cookie, `Name=A` | 200 | mensagem de validação, sem resultado |
| Sem o campo de token | 400 | "A valid antiforgery token was not provided with the request" |
| Token mas sem cookie | 400 | a mesma mensagem |
| `_handler` desconhecido | 400 | "Cannot submit the form 'other' because no form on the page currently has that name." |

O `EditForm` renderiza o token para você. Um `<form method="post">` comum não:
ele precisa de `<AntiforgeryToken />` dentro e de `@formname`, senão o post é
rejeitado com o mesmo `400`. Em uma segunda página de teste, um post no
formulário com `<AntiforgeryToken />` fez o binding de `Q=hello`, e um post no
formulário sem ele falhou com `400`.

### Enhanced forms e redirects

Com `Enhance` (ou `data-enhance` em um `<form>` comum) o script posta com
`fetch` e aplica o patch na resposta. No browser, um submit inválido seguido de
um válido manteve o mesmo elemento `<input>` e uma variável de `window`, deixou
a URL em `/ssr/form` e atualizou a mensagem de validação e o resultado no
lugar. Colocar `data-enhance` em um elemento ancestral não ativa o recurso para
o formulário dentro dele; segundo a documentação, ele precisa estar no próprio
formulário.

O post-redirect-get usual funciona com `NavigationManager.NavigateTo`. Na minha
execução, um handler que chamava `NavigateTo("/ssr/nav/a")` respondeu ao post
com `302 Found` e um header `Location`, e com o header enhanced a resposta
também trouxe `blazor-enhanced-nav: allow`. No .NET 10 o template do Blazor Web
App define `BlazorDisableThrowNavigationException` como true no `.csproj`, o
que, segundo a documentação, muda os redirects do static SSR de modo que o
código depois do `NavigateTo` passa a continuar executando. Deixe o
`NavigateTo` por último, ou dê `return` depois dele.

### Streaming rendering

Normalmente a resposta é enviada depois que o `OnInitializedAsync` termina. Com
`@attribute [StreamRendering]` (`[StreamRendering(true)]` no .NET 8) o primeiro
render, com placeholders, é enviado primeiro e o render final segue na mesma
resposta. Duas páginas com `await Task.Delay(2000)` e um log dos chunks com
`curl -N`:

```text
/ssr/nostream   +2.0s  8100 bytes  "Loaded ok"
/ssr/stream     +0.0s  5696 bytes  "Loading..."
                +2.0s   145 bytes  <blazor-ssr><template blazor-component-id="16">
                                   <h1>Stream</h1><p id="data">Loaded ok</p></template>...
```

O segundo chunk é um `<template>` que o `blazor.web.js` move para o lugar. O
esqueleto da página chega na hora, e o custo é que o status code e os headers
já foram enviados: um erro depois do primeiro flush não pode mais virar outro
status. A documentação acrescenta que o host não pode fazer buffer da saída, e
que onde um proxy faz buffer a página degrada com elegância para um load normal.

## Trade-offs

- **Static SSR abre mão de estado na página.** Toda interação é um post e um
  render, então um widget com estado local (um filtro ao vivo, um contador)
  precisa de uma região interativa.
  ```razor
  <Counter @rendermode="InteractiveServer" /> @* uma região interativa em uma página estática *@
  ```
- **Enhanced navigation pode esconder estado velho.** O script e o DOM
  sobrevivem a um clique, então um script que inicializa no carregamento da
  página pode rodar uma vez, não a cada página. Use `data-enhance-nav="false"`
  em links para páginas que precisam de um load limpo.
- **Um erro de binding falha em silêncio.** Se o nome da propriedade ou o
  `FormName` não bate com os campos postados, o model fica vazio e você vê um
  formulário em branco ou um `400`, não uma exceção no seu código.
  ```razor
  <EditForm Model="Model" FormName="contact" Enhance> @* o nome precisa ser único na página *@
  ```
- **O antiforgery depende de um cookie.** Posts de outra origem, ou de um
  cliente que descarta cookies, falham com `400`. É a proteção funcionando, mas
  surpreende clientes estilo API que postam em uma página.
- **Streaming troca estabilidade de layout por velocidade.** Os placeholders
  se movem quando o conteúdo real chega, e é por isso que o atributo é opt-in;
  o tratamento de erro depois do primeiro chunk se limita ao que você consegue
  renderizar na página.
- **O `NavigateTo` em um handler antes lançava exceção.** Código que dependia
  da exceção para parar a execução muda de comportamento quando a nova
  propriedade é true.
  ```csharp
  Nav.NavigateTo("/done");
  return; // não dependa de uma exceção para encerrar o handler
  ```

## Lab

Neste lab você constrói um Blazor Web App que usa só renderização estática no servidor (sem circuito e sem WebAssembly) e vê exatamente o que o servidor envia: páginas HTML comuns, um parâmetro de rota com restrição de tipo, uma query string ligada a um componente e um `EditForm` aprimorado que posta com token antiforgery, valida e segue o padrão Post/Redirect/Get. Você recebe o projeto `BlazorSsrLab` com cinco páginas, e o `Program.cs` registra só `AddRazorComponents()`, sem modo de renderização interativo. A ideia central é que o HTML puro já funciona sozinho e que o script `blazor.web.js` só acrescenta navegação e formulários aprimorados por cima.

**O cenário**

Hoje a home está vazia, o layout não carrega o script do Blazor, a rota de pedidos não tem restrição, a busca ignora a query string e o contato é um formulário comum que o Blazor não trata.

- `Home.razor`, `Orders.razor`, `Search.razor`, `Contact.razor`, `Thanks.razor`: as páginas, envolvidas por `MainLayout.razor` e `App.razor`.
- `ContactModel.cs`: o modelo do formulário, com `[Required(ErrorMessage = "Name is required")]` em `Name`.
- `Program.cs`: `AddRazorComponents`, `UseAntiforgery` e `MapRazorComponents<App>`.
- `SsrTests.cs`: chama o app em memória com `WebApplicationFactory` e confere HTML, status e cabeçalhos. Nenhum navegador é usado.

**O que você vai fazer, passo a passo**

1. **Home em HTML puro (TODO-00).** Em `Home.razor`, renderize `<h1>Home</h1>` e um parágrafo com a hora de renderização (`<span id="stamp">` com `DateTime.UtcNow.Ticks`). O teste confere `text/html` e que a página não referencia `blazor.server.js` nem `blazor.webassembly.js`.
2. **Carregar o script (TODO-01).** Em `App.razor`, carregue `_framework/blazor.web.js`. O `<base href="/" />` já está lá e o teste confere os dois.
3. **Restrição de rota (TODO-02).** Em `Orders.razor`, restrinja a rota a inteiro: `/orders/42` mostra `Order 42` e `/orders/abc` deve dar `404`.
4. **Query string (TODO-03).** Em `Search.razor`, ligue o valor `term` da query string ao parâmetro `Term`. `/search?term=blazor` mostra `Results for: blazor`, e um valor como `<b>` deve sair codificado (`&lt;b&gt;`).
5. **Formulário aprimorado (TODO-04).** Em `Contact.razor`, troque o formulário comum por um `EditForm` com `FormName` `contact` e `Enhance`. O HTML deve ter `method="post"`, `data-enhance`, o campo oculto `_handler` com valor `contact`, o token antiforgery e um input `Model.Name`. Mantenha `DataAnnotationsValidator` e um `ValidationMessage`, e chame `Submit` num post válido.
6. **Ligar o post e redirecionar (TODO-05).** Ligue o formulário postado em `Model` com `[SupplyParameterFromForm]`. Nome vazio re-renderiza a página com `200` e `Name is required`. Nome válido responde `302` para `/thanks?name=Ana` (Post/Redirect/Get), e essa página mostra `Thanks, Ana`.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar o que o servidor devolve em cada rota e por que o `EditForm` adiciona o token antiforgery sozinho. Os testes não executam o `blazor.web.js`, então para ver a navegação e os formulários aprimorados no navegador rode `dotnet run --project src/BlazorSsrLab`, abra a URL impressa e acompanhe a aba Network (um `fetch` por navegação em vez de recarregar o documento).

**Desafios opcionais**

- **TODO-06:** o teste `ShouldRejectPostWithoutAntiforgeryToken` (categoria `Bonus`) posta em `/contact` com o cookie mas sem o campo do token e espera `400`. Não há código a escrever: leia o `Program.cs`, ache a linha que faz o servidor rejeitar esse post e explique por que o `EditForm` do TODO-04 adiciona o token para você.

**Pré-requisitos:** noções de ASP.NET Core (roteamento, middleware, `WebApplicationFactory`), componentes Razor básicos (`@page`, `[Parameter]`, `@code`) e o .NET 10 SDK (os testes usam xUnit e `Microsoft.AspNetCore.Mvc.Testing`, restaurados do nuget.org).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Para rodar só o trabalho obrigatório, use `dotnet test --filter "Category!=Bonus"`. Cada TODO está marcado em comentário no arquivo `.razor` correspondente, e os testes vermelhos mostram o que ainda falta.

## Documentation Links

- [ASP.NET Core Blazor navigation, enhanced navigation and form handling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/navigation) (doc)
- [ASP.NET Core Razor component rendering, streaming rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
- [ASP.NET Core Blazor render modes, static SSR, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes) (doc)
- [ASP.NET Core Blazor JavaScript with static server-side rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/static-server-rendering) (doc)
