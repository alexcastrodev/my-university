---
version: 1.0
updatedAt: 2026-11-12
title: "QuickGrid e Virtualize no Blazor"
summary: Grade com ordenação e paginação (QuickGrid sobre IQueryable e sobre ItemsProvider), lista virtualizada, o HTML que o .NET 11 gera com estado na URL e como testar com WebApplicationFactory e bUnit.
---
## Objective

A tela mais comum de um app de negócio é uma tabela com ordenação e páginas, e a
segunda mais comum é uma lista longa demais para renderizar. O Blazor traz um
componente para cada: `QuickGrid` (o pacote
`Microsoft.AspNetCore.Components.QuickGrid`) e `Virtualize` (no framework). Este
concept monta os dois, mostra o HTML que a grade produz, a diferença entre dar a ela
um `IQueryable` e um `ItemsProvider`, e o que mudou no .NET 11: a grade guarda página
e ordenação na URL, então funciona em SSR estático, e o `Virtualize` ganhou
ancoragem e um warning novo de analyzer. Tudo que está marcado como executado foi
rodado no .NET 11.0.100 GA com `WebApplicationFactory` e bUnit 2.15.2. Não havia
navegador, então o comportamento de rolagem é atribuído à documentação.

## Use Cases

- Uma página de admin ou relatório com colunas ordenáveis e paginador, em SSR
  estático, com links que podem ser compartilhados e salvos.
- Uma grade sobre uma tabela grande em que só a página visível deve ser consultada
  (`ItemsProvider`).
- Um feed ou log de milhares de linhas renderizado como uma janela (`Virtualize`).
- Testar essas páginas sem navegador, com `WebApplicationFactory` para o HTML e bUnit
  para o componente.

## Deep Dive

### QuickGrid sobre um IQueryable

```razor
@page "/products"

<QuickGrid Items="Catalog.All" Pagination="pagination">
    <PropertyColumn Property="p => p.Name" Sortable="true" IsDefaultSortColumn="true" />
    <PropertyColumn Property="p => p.Price" Sortable="true" />
</QuickGrid>
<Paginator State="pagination" />

@code {
    private readonly PaginationState pagination = new() { ItemsPerPage = 5 };
}
```

`Items` recebe um `IQueryable<T>`; `PropertyColumn` liga uma coluna a uma
propriedade, `Sortable` a torna ordenável, e `PaginationState` mais `Paginator`
dão o paginador. Com 23 produtos em memória, um `GET /products` simples devolveu as
cinco primeiras linhas ordenadas por `Name` (`Name01` a `Name05`) e o paginador
mostrou `Page 1 of 5` com `23 items`. Com um `IQueryable` do Entity Framework Core,
a documentação aponta um pacote adaptador para consultas assíncronas (o pacote tem a
interface `IAsyncQueryExecutor`; não rodei EF aqui); veja
`blazor-data-access-and-streaming-rendering` para entender por que o tempo de vida
do `DbContext` importa.

### O que o .NET 11 mudou: estado na URL, controles como links

A requisição `/products?page=2&sort=Name&direction=desc` devolveu `Name18` a
`Name14`, e o markup mostra por que isso funciona sem circuito:

```text
<th class="col-sort-desc" aria-sort="descending">
  <a class="col-title" href="http://localhost/products?page=1&amp;sort=Name&amp;direction=asc">Name ...
<a class="go-first"    href=".../products?sort=Name&amp;direction=desc" aria-disabled="true">
<a class="go-next"     href=".../products?page=2&amp;sort=Name&amp;direction=desc">
<a class="go-last"     href=".../products?page=5&amp;sort=Name&amp;direction=desc">
```

Os cabeçalhos das colunas e o paginador são âncoras simples, e a página, a coluna de
ordenação e a direção vêm da query string. Pontos de atenção, todos dessa execução:

- O número da página na URL é **base 1** (`page=2` é a segunda página), enquanto
  `PaginationState.CurrentPageIndex` é base 0.
- O link da primeira página omite `page`, e os controles desabilitados ainda têm
  `href` com `aria-disabled="true"`.
- Com `page=1` na URL os links de cabeçalho mantiveram `page=1`; não verifiquei o que
  fazem a partir da página 3, então teste a combinação que você publicar em vez de
  assumir.
- Um teste ou um CSS que espera botões no cabeçalho vai quebrar. As notas de versão e
  a página de breaking change do QuickGrid descrevem os controles renderizando como
  links no 11.

Os nomes dos parâmetros são configuráveis. `QuickGrid.QueryParameterNameOptions`
recebe um prefixo (o construtor é `QueryParameterNameOptions(string prefix)`), para
que duas grades na mesma página não disputem `page` e `sort`. Confirmei o tipo e os
padrões (`page`, `sort`, `direction`) na referência; não renderizei duas grades.
`OnRowClick` também existe na grade no 11; o comportamento no navegador não foi
testado.

### ItemsProvider: peça só a fatia

Com `Items` a grade fatia um `IQueryable`. Com `ItemsProvider` você recebe uma
requisição e devolve uma página mais o total, que é o formato para uma API ou uma
chamada ao banco:

```razor
<QuickGrid ItemsProvider="provider" Pagination="pagination"> ... </QuickGrid>

provider = async request =>
{
    var page = await Service.QueryAsync(request.StartIndex, request.Count ?? 5,
                                        request.GetSortByProperties());
    return GridItemsProviderResult.From(page.Items, page.Total);
};
```

`request.GetSortByProperties()` devolve pares `(PropertyName, Direction)`. Para
`/remote?page=3&sort=Price&direction=desc` o serviço viu `Start=10, Count=5, sort
"Price Descending"` e a página mostrou `Name13` até `Name09`, então o que saiu do
servidor foi uma fatia, não 23 linhas. Duas regras que valem teste: o
`TotalItemCount` deve ser o total depois do filtro (ele alimenta o paginador), e o
provider recebe um `CancellationToken` que você deve repassar.

### Virtualize: renderize uma janela, não a lista

```razor
<div style="height: 200px; overflow-y: auto">
  <Virtualize Context="item" ItemsProvider="LoadAsync" ItemSize="20"
              OverscanCount="3" ItemComparer="StringComparer.Ordinal">
    <ItemContent><div class="row">@item</div></ItemContent>
    <Placeholder><div class="row placeholder">...</div></Placeholder>
  </Virtualize>
</div>
```

O `Virtualize` precisa de um contêiner de rolagem com altura limitada, de uma altura
por item (`ItemSize`, padrão de 50 px segundo a referência) e de um provider que
devolve os itens de um intervalo pedido mais o total (`ItemsProviderResult<T>`). No
bUnit, com o JS runtime em modo loose e sem layout real, uma lista de 10.000 itens
renderizou 106 linhas, a primeira sendo `Item 0`, e o provider foi chamado com
intervalos de no máximo algumas centenas de itens. O 106 é consistente com o
`MaxItemCount` documentado de 100 mais o overscan, mas não isolei os dois. O que o
bUnit não mostra é a rolagem: o lado do navegador (um `IntersectionObserver`) decide
qual janela pedir em seguida, e isso é documentado, não testado aqui.

O que o 11 acrescenta, segundo as notas de versão e a referência:

- **Ancoragem.** `AnchorMode` (o enum é `VirtualizeAnchorMode`, flags que podem ser
  combinadas) controla o que o viewport faz nas bordas quando chegam itens, para que
  um chat ou log fique preso ao fim. O exemplo da nota escreve `AnchorMode="Start"`;
  o tipo existe na referência do GA, comportamento não executado.
- **`ScrollToItemAsync(index)`** rola o viewport até um item (vale a última chamada).
- **`ItemComparer`** permite ao componente distinguir itens inseridos antes de itens
  inseridos depois quando as janelas do provider se sobrepõem.
- **Overscan.** As notas de versão dizem que o padrão de `OverscanCount` passou de 3
  para 15. Eu defini explicitamente e não medi o padrão.
- **Um warning novo de analyzer.** Compilar a página sem `ItemComparer` em um
  `Virtualize` com `ItemsProvider` deu `BL0011: Virtualize uses 'ItemsProvider'
  without 'ItemComparer'. Set ItemComparer to an IEqualityComparer that identifies
  items by a unique key.` Adicionar o comparer silenciou. Para records e tipos com
  igualdade por valor, a referência diz que o padrão serve.

O `QuickGrid` também expõe `AnchorMode`.

### Testando

Duas camadas, como no lab. `WebApplicationFactory` para a página estática: leia o
HTML, afirme as linhas e os hrefs. bUnit para o componente: a grade carrega os dados
de forma assíncrona, então o primeiro `Markup` ainda não tem linhas e o teste precisa
esperar.

```csharp
using var ctx = new BunitContext();
ctx.JSInterop.Mode = JSRuntimeMode.Loose;          // QuickGrid e Virtualize importam JS
var cut = ctx.Render<Products>();
cut.WaitForAssertion(() => Assert.Equal(5, cut.FindAll("tbody tr").Count));
```

O bUnit 2 renomeou coisas: `TestContext` agora é `BunitContext` e
`RenderComponent<T>` é `Render<T>` (os nomes antigos compilam com warning ou dão erro,
dependendo do membro). Rodou em `net11.0` com a 2.15.2.

## Trade-offs

- **`Items` é o caminho fácil e carrega pelo `IQueryable`.** Serve para dados em
  memória ou do EF Core, mas com `ItemsProvider` a paginação e o total são seus.
  ```csharp
  return GridItemsProviderResult.From(slice, totalAfterFilter);
  ```
- **Estado na URL é compartilhável e testável, e também é entrada.** `page` e `sort`
  vêm do usuário; uma coluna de ordenação que o seu provider não conhece não pode
  virar um `OrderBy` por string.
- **Links no lugar de botões mudam estilo e testes.** Também dão clique do meio e
  botão voltar funcionando em SSR estático, ao preço de uma navegação completa (ou
  enhanced) por clique.
- **O `Virtualize` precisa de altura fixa por item para ser preciso.** Com linhas de
  altura variável a barra de rolagem estima, e o placeholder deve ter altura parecida.
- **Virtualizar esconde o resto da lista da busca e de ferramentas de
  acessibilidade.** O conteúdo fora da janela não está no DOM, então a busca na página
  e alguns fluxos de leitor de tela não o veem.
- **Nota de versão.** O `QuickGrid` é um pacote separado: fixe-o na mesma major do
  framework (`11.0.0` aqui).

## Lab

Neste lab você monta uma página de Blazor Web App com `QuickGrid` (paginação e ordenação guardadas na URL, sobre um `IQueryable` e sobre um `ItemsProvider`) e um feed com `Virtualize`. Os testes usam `WebApplicationFactory` para o HTML das páginas estáticas (linhas e links) e bUnit 2.15.2 para os componentes. O lab usa `net11.0` e precisa do SDK 11.

**O que você vai fazer, passo a passo**

1. **Grade paginada e ordenável (TODO-00).** Em `Products.razor`, adicione 5 itens por página, um `Paginator`, colunas ordenáveis e ordenação padrão por nome.
2. **Página e ordenação pela URL (TODO-01).** `?page=2&sort=Name&direction=desc` mostra `Name18` a `Name14`.
3. **Links (TODO-02).** Cabeçalhos e paginador são âncoras com os hrefs esperados.
4. **ItemsProvider (TODO-03).** Em `Remote.razor`, peça ao serviço só a fatia solicitada.
5. **Virtualize (TODO-04).** Em `Feed.razor`, renderize uma janela de 10.000 itens.
6. **bUnit (TODO-05).** O teste da grade precisa de `WaitForAssertion`; leia por quê.

**Como saber que terminou:** `dotnet test` verde. **Pré-requisitos:** componentes Blazor e noções de SSR estático, xUnit, bUnit e o SDK do .NET 11. **Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`.

## Documentation Links

- [ASP.NET Core Blazor QuickGrid component, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/quickgrid) (doc)
- [ASP.NET Core Razor component virtualization, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/virtualization) (doc)
- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [Breaking change: QuickGrid controls render as links, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/quickgrid-controls-render-as-links) (doc)
- [bUnit documentation](https://bunit.dev/docs/getting-started/) (doc)
