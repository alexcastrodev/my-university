---
version: 1.0
updatedAt: 2026-10-15
title: "Roteamento, Layouts e Navegação no Blazor"
summary: "@page, parâmetros e constraints, query string, NavigationManager, NavLink, layouts aninhados e o tratamento de not found do .NET 10, observados em um app rodando."
---
## Objective

Uma página Blazor é um componente com uma URL. Em volta dessa URL existe um
conjunto pequeno de mecanismos fáceis de usar e fáceis de interpretar mal: o
template da rota e suas constraints, a query string, o `NavLink` que destaca a
página atual, os layouts que a envolvem, o `NavigationManager` que move entre
páginas e, novidade do .NET 10, o que acontece quando nada casa. Este concept
acompanha uma requisição por esses mecanismos em um Blazor Web App rodando e
registra o que cada um realmente fez, inclusive os casos que devolvem `404` ou
`500`.

## Use Cases

- Desenhar as URLs de uma página: parâmetros obrigatórios, opcionais e
  catch-all, e constraints que rejeitam valores ruins antes do seu código rodar.
- Ler filtros e paginação da query string sem fazer parsing manual.
- Destacar a entrada ativa do menu corretamente, inclusive quando a URL tem
  query string.
- Dar a uma seção do site a sua própria moldura com layouts aninhados, sem
  repetir marcação em cada página.
- Devolver uma página de "não encontrado" de verdade, com status `404`, quando um
  id não existe.

## Deep Dive

### De `@page` até uma rota

Um componente com a diretiva `@page` é compilado em uma classe que carrega um
`RouteAttribute`. O `Router` do `Routes.razor` varre o assembly que você informa
e entrega o componente correspondente ao `RouteView`. Este é o arquivo do
template de um Blazor Web App no SDK 10.0.100:

```razor
<Router AppAssembly="typeof(Program).Assembly"
        AdditionalAssemblies="new[] { typeof(Client._Imports).Assembly }"
        NotFoundPage="typeof(Pages.NotFound)">
    <Found Context="routeData">
        <RouteView RouteData="routeData" DefaultLayout="typeof(Layout.MainLayout)" />
        <FocusOnNavigate RouteData="routeData" Selector="h1" />
    </Found>
</Router>
```

O `AdditionalAssemblies` é como os componentes roteáveis do projeto `.Client` são
encontrados. O `DefaultLayout` é o layout das páginas que não escolhem um, e o
`FocusOnNavigate` move o foco para o primeiro `<h1>` depois de uma navegação,
para que leitores de tela anunciem a nova página. A documentação distingue dois
routers. Quando a página é renderizada estaticamente, o router usa endpoint
routing e o caminho HTTP. Se você dá ao `Routes` um render mode interativo, o
router passa a ser interativo e segue a URL do documento sem uma requisição ao
servidor.

### Templates de rota e constraints

Um componente pode ter várias linhas `@page`, e os parâmetros são ligados às
propriedades `[Parameter]` pelo nome, sem diferenciar maiúsculas de minúsculas.
Um componente com estas rotas foi requisitado com `curl` em um app rodando:

```razor
@page "/rt/products/{Id:int}"
@page "/rt/p/{Id:int}"
@page "/rt/opt/{Name?}"
@page "/rt/files/{*Path}"
```

| Requisição | Status | Resultado |
|---|---|---|
| `/rt/products/42` | 200 | `Id=42` |
| `/rt/p/7` | 200 | `Id=7` (segunda rota do mesmo componente) |
| `/RT/Products/42` | 200 | `Id=42`, a URL mantém a caixa que o cliente enviou |
| `/rt/products/abc` e `/rt/products/1.5` | 404 | a constraint `int` rejeitou o segmento |
| `/rt/opt` e `/rt/opt/ana` | 200 | `Name` é null, depois `ana` |
| `/rt/files/a/b/c.txt` | 200 | `Path=a/b/c.txt` (o catch-all mantém as barras) |
| `/rt/guid/3f2504e0-...` e `/rt/guid/zzz` | 200 e 404 | constraint `guid` |

Uma constraint que falha não é um erro no seu código: a rota simplesmente não
casa e a requisição termina no caminho de not found descrito mais abaixo. A
documentação lista `bool`, `datetime`, `decimal`, `double`, `float`, `guid`,
`int`, `long` e `nonfile`. As constraints numéricas e de data fazem parsing com a
cultura invariante, então assumem uma URL não localizada. A `nonfile` importa
para um parâmetro opcional na raiz, como `@page "/{optional:nonfile?}"`, que sem
ela pode capturar a URL de uma folha de estilo. O parâmetro catch-all é sempre
`string` e precisa ser o último.

### Query strings

Parâmetros de rota não leem a query string. Use `[SupplyParameterFromQuery]`:

```razor
@page "/rt/q"
@code {
    [SupplyParameterFromQuery] public int Page { get; set; }
    [SupplyParameterFromQuery(Name = "t")] public string? Tag { get; set; }
}
```

| Requisição | Resultado |
|---|---|
| `/rt/q` | `Page=0 Tag=(null)` |
| `/rt/q?Page=3&t=x` | `Page=3 Tag=x` |
| `/rt/q?page=4` | `Page=4` (o nome casa sem diferenciar caixa) |
| `/rt/q?Page=abc` | 500 |

A última linha é a que vale lembrar. O log do servidor mostra
`InvalidOperationException: Cannot parse the value 'abc' as type 'System.Int32'
for 'Page'`, então um parâmetro de query tipado transforma uma URL malformada em
erro de servidor, e não em um valor padrão. Para entradas que o usuário pode
editar à mão, receba um `string?` e faça o parsing com `int.TryParse`.

### NavigationManager

O `NavigationManager` injetado sabe onde você está e monta URLs sem concatenar
strings. Em `/rt/q?Page=3&t=x` ele imprimiu:

```text
Uri         http://localhost:5320/rt/q?Page=3&t=x
BaseUri     http://localhost:5320/
Relative    rt/q?Page=3&t=x                  (ToBaseRelativePath(Uri))
Next        http://localhost:5320/rt/q?Page=4&t=x   (GetUriWithQueryParameter("Page", Page + 1))
```

O `GetUriWithQueryParameter` troca um parâmetro e mantém os outros. O
`NavigateTo(url)` vai para outra página, usando enhanced navigation quando
disponível, a menos que você passe `forceLoad: true`, e o `Refresh()` recarrega
a atual. Os valores relativos de `href` são resolvidos contra o
`<base href="/">` do `App.razor`, e é por isso que os links do template não têm
barra inicial.

### NavLink

O `NavLink` renderiza um `<a>` e acrescenta a classe `active` (e
`aria-current="page"`) quando o `href` casa com a URL atual. O `Match` controla a
regra. Três links em `/rt/q`, com `rt/q` como `NavLinkMatch.All`, `rt` como
`NavLinkMatch.Prefix` e `rt/other` com o padrão:

```text
<a id="all"    href="rt/q"     class="active" aria-current="page">
<a id="prefix" href="rt"       class="active" aria-current="page">
<a id="other"  href="rt/other">
```

A mesma saída voltou para `/rt/q?Page=2` e `/rt/q#frag`. Esse é o comportamento
do .NET 10 listado nas release notes: com `NavLinkMatch.All` a query string e o
fragmento agora são ignorados, e uma chave de `AppContext` restaura a regra
antiga. Use `Prefix` para um link de seção ("Products" ativo em qualquer página
de produto) e `All` para o link da home, senão `/` casa com tudo.

### Layouts, aninhados e por pasta

Um layout é um componente que herda de `LayoutComponentBase` e renderiza
`@Body`. Um layout pode declarar um layout, e é assim que o aninhamento
funciona. Com o `InnerLayout` declarando `@layout OuterLayout` e o `OuterLayout`
declarando `@layout MainLayout`, uma página com `@layout InnerLayout` renderizou,
de fora para dentro:

```text
MainLayout (sidebar, área de conteúdo)
  OuterLayout   <div data-layout="Outer"><h2>Outer layout</h2>
    InnerLayout <div data-layout="Inner"><h3>Inner layout</h3>
      page      <h1>Nested page</h1>
```

Uma página sem `@layout` recebeu o `MainLayout` pelo `DefaultLayout`. Colocar
`@layout InnerLayout` no `_Imports.razor` de uma pasta o aplicou a toda página
dentro dela: uma página sem `@layout` próprio renderizou dentro do layout interno
e do externo. É o jeito barato de dar a `/admin/*` a sua própria moldura.

### Tratando "not found" no .NET 10

Três situações diferentes terminaram do mesmo jeito no app do template: uma URL
que não casa com nenhuma rota (`/does-not-exist`), uma constraint que falha
(`/rt/products/abc`) e uma página que chama `NavigationManager.NotFound()`
(`/rt/missing/500`). Cada uma devolveu `404` com o corpo da página `/not-found`,
porque o template chama `UseStatusCodePagesWithReExecute("/not-found")` e define
`NotFoundPage` no router. Requisitar `/not-found` diretamente devolve `200`, já
que é uma página comum.

O `NotFound()` também funciona quando o router é interativo. Com o `Routes` em
`InteractiveServer` e sem prerender, um botão que chamava `NotFound()` substituiu
o conteúdo da página pela página Not Found, deixou a URL inalterada e não
recarregou a página. O mesmo botão em uma região interativa, com o `Routes`
estático do template, não fez nada visível, porque não existia um router
interativo para reagir. O `NotFoundPage`, o `NavigationManager.NotFound()` e o
evento `OnNotFound` estão nas release notes do ASP.NET Core 10, que também
dizem que o antigo fragmento `<NotFound>` não é suportado quando `NotFoundPage`
é usado.

## Trade-offs

- **Uma constraint que falha parece uma página inexistente.** Depurar "por que
  esta URL dá 404" significa checar a constraint antes dos dados, e a cultura da
  constraint é invariante.
  ```razor
  @page "/orders/{Id:int}"   @* /orders/abc é um 404, não uma exceção *@
  ```
- **Parâmetros de query tipados podem lançar exceção.** O
  `[SupplyParameterFromQuery]` com `int` devolve `500` em `?Page=abc`.
  ```csharp
  [SupplyParameterFromQuery(Name = "page")] public string? PageText { get; set; }
  private int Page => int.TryParse(PageText, out var p) && p > 0 ? p : 1;
  ```
- **O `OnInitialized` não roda de novo quando só os parâmetros mudam.** A
  documentação avisa que navegar de `/user/1` para `/user/2` reaproveita a
  instância do componente, então carregue os dados em `OnParametersSetAsync`.
- **Layouts aninhados multiplicam a marcação que você precisa manter
  consistente.** Cada nível é mais uma `div` de embrulho e mais um lugar onde uma
  regra de CSS pode vazar, então mantenha a cadeia curta e deixe a moldura
  compartilhada em um só layout.
- **O `NotFound()` precisa de um router que consiga ouvi-lo.** No static SSR ele
  vira um `404` mais a página re-executada, no modo interativo precisa de um
  `Routes` interativo. Teste os dois caminhos se o seu site mistura os dois.
- **`href` relativo depende do `<base>`.** Um link como `href="rt/q"` quebra se o
  `<base href>` estiver ausente ou errado, por exemplo atrás de um prefixo de
  caminho.

## Documentation Links

- [ASP.NET Core Blazor routing and navigation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/routing) (doc)
- [ASP.NET Core Blazor navigation, NavigationManager and NavLink, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/navigation) (doc)
- [ASP.NET Core Blazor layouts, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/layouts) (doc)
- [What's new in ASP.NET Core 10, Blazor NotFound handling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Handle errors in ASP.NET Core, status code pages re-execution, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling) (doc)
