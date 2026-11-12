---
version: 1.0
updatedAt: 2026-11-12
title: "Estado no SSR do Blazor: TempData, Session e CacheView"
summary: Onde guardar estado entre requisições em uma página SSR estática (query string, formulário, TempData, sessão e CacheView), o que o .NET 11 acrescentou e o que cada opção custa, tudo executado no GA.
---
## Objective

Uma página SSR estática esquece tudo quando a resposta sai: não há circuito, nem
instância de componente, nem campos. Mesmo assim, uma página real precisa de uma
mensagem "salvo" depois de um redirect, de um carrinho que sobrevive a um clique, de
um filtro que sobrevive a um reload. Este concept compara os cinco lugares onde o
estado pode morar em um app Blazor com SSR estático (a query string, o formulário
postado, o TempData, a sessão e a saída de um bloco em cache) e o que o .NET 11
acrescentou: `[SupplyParameterFromTempData]`, `[SupplyParameterFromSession]`,
`ITempData` e o componente `CacheView`. Tudo abaixo foi executado no .NET 11.0.100
GA com `WebApplicationFactory`, lendo o HTML e os headers `Set-Cookie`. Não havia
navegador, então o que só acontece no cliente é atribuído à documentação.

## Use Cases

- Uma mensagem "salvo" depois de Post/Redirect/Get, mostrada uma vez e que some ao
  atualizar.
- Um carrinho ou o passo de um wizard guardado por visitante sem linha no banco.
- Um fragmento lento e compartilhado (caixa de notícias, menu) renderizado uma vez e
  servido da memória nas próximas requisições.
- Escolher entre cookie e servidor para guardar estado, sabendo o custo de cada um.

## Deep Dive

### Cinco lugares, uma pergunta: quem é dono do valor e por quanto tempo

| Mecanismo | Mora em | Duração | Uso típico |
|---|---|---|---|
| Query string, `[SupplyParameterFromQuery]` | a URL | enquanto o link existir | filtros, paginação |
| Formulário, `[SupplyParameterFromForm]` | o corpo da requisição | uma requisição | o próprio envio |
| TempData | um cookie (ou a sessão) | até ser lido uma vez | mensagem flash após redirect |
| Session | memória do servidor mais um cookie com o id | até expirar | carrinho, wizard |
| `CacheView` | memória do servidor, compartilhada | até expirar | um fragmento caro |

`[PersistentState]` não está na tabela de propósito: ele leva um valor do prerender
para a instância interativa da mesma página, que é outro problema. Veja
`blazor-data-access-and-streaming-rendering`. As linhas de formulário e query estão
em `blazor-static-ssr-and-enhanced-navigation` e `blazor-routing-layouts-and-navigation`;
o resto deste concept trata das três novidades.

### TempData: uma mensagem flash através do redirect

A página abaixo grava no handler do POST e redireciona para si mesma. A propriedade
é preenchida pelo TempData no GET seguinte:

```razor
@page "/flash"
@inject NavigationManager Nav

<p id="message">@Shown</p>

<EditForm Model="Model" FormName="flash" OnValidSubmit="Submit" Enhance>
    <InputText @bind-Value="Model.Text" />
    <button type="submit">Save</button>
</EditForm>

@code {
    [SupplyParameterFromTempData] private string? Message { get; set; }
    [SupplyParameterFromForm] private FlashModel Model { get; set; } = default!;
    private string? Shown;

    protected override void OnInitialized()
    {
        Model ??= new();
        Shown = Message;
        Message = null;          // consome o valor, veja abaixo
    }

    private void Submit()
    {
        Message = $"saved {Model.Text}";
        Nav.NavigateTo("flash");
    }
}
```

Postando `Text=hello` pelo `WebApplicationFactory`:

```text
POST /flash        302  Location: /flash
                        Set-Cookie: .AspNetCore.Components.TempData=CfDJ8...; path=/; samesite=lax; httponly
GET  /flash        <p id="message">saved hello</p>
GET  /flash        <p id="message"></p>
```

O cookie é HttpOnly, SameSite=Lax e o valor começa com `CfDJ8`, o prefixo de um
payload do Data Protection, então o TempData usa o key ring descrito em
`data-protection-key-ring-and-purposes` (em um cluster, todos os nós precisam do
mesmo anel). Um segundo cliente, com outro conjunto de cookies, viu a mensagem
vazia: o valor pertence a um navegador.

Dois detalhes me custaram tempo. Primeiro, **ler a propriedade não apaga o valor**:
na minha primeira versão, sem `Message = null`, três GETs seguidos mostraram
`saved a`. Atribuir `null` depois da leitura é o que torna o valor de leitura única
com o atributo. Segundo, o serviço `ITempData` (um cascading parameter) funciona ao
contrário, e é a API que já traz a regra de leitura única:

```razor
[CascadingParameter] public ITempData? TempData { get; set; }
// Peek("flash")  lê sem remover
// Get("flash")   lê e agenda a remoção
// Keep() / Keep("flash")  mantém por mais uma requisição
```

Execução: depois que o handler gravou `TempData["flash"] = "manual x"` e
redirecionou, o primeiro GET leu `manual x` tanto com `Peek` quanto com `Get`, o
segundo GET não leu nada e a resposta limpou o cookie (`expires=Thu, 01 Jan 1970`).
Use o atributo no caso simples e `ITempData` quando precisar de `Peek` ou `Keep`.

Onde o TempData fica guardado é uma configuração:
`RazorComponentsServiceOptions.TempDataProviderType` aceita `Cookie` (o padrão) e
`SessionStorage`, e `TempDataCookie` ajusta o cookie. Troquei para `SessionStorage`
e a resposta do POST deixou de trazer o cookie do TempData; o valor ficou na sessão
sob a chave `__BlazorTempData` como
`{"flash":{"type":"System.String","value":"manual x"}}`. A opção de cookie mantém o
servidor sem estado e é limitada pelo tamanho de cookie do navegador; a opção de
sessão exige um armazenamento de sessão que todos os nós alcancem.

Repare também no warning do compilador ao escrever a página: o `BL0008` avisa que
`[SupplyParameterFromForm]` com inicializador de propriedade pode ser sobrescrito
com `null` em um post. Use `default!` e `Model ??= new()` em `OnInitialized`, como
acima.

### Session: o carrinho que sobrevive

`[SupplyParameterFromSession]` lê e grava um valor em `HttpContext.Session`. Ele
precisa dos serviços e do middleware de sessão, que não fazem parte de
`AddRazorComponents()`:

```csharp
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession();
// ...
app.UseSession();
app.MapRazorComponents<App>();
```

```razor
[SupplyParameterFromSession] private string? Items { get; set; }
private void Add() { Items = string.IsNullOrEmpty(Items) ? Model.Item : $"{Items},{Model.Item}"; }
```

Dois POSTs (`apple`, `pear`) e depois dois GETs mostraram `apple,pear` nas duas
vezes, e um cliente novo viu `empty`. O que o atributo gravou na sessão não é uma
string simples:

```text
items={"type":"System.String","value":"apple"}
```

A chave saiu como `items`, em minúsculas, e o valor é um pequeno envelope JSON.
Então `Session.SetString("Items", "manual")` em outro endpoint criou uma segunda
chave sem relação e a página continuou mostrando `apple`. Se outro código precisa
compartilhar o valor, passe pelo mesmo atributo ou pelo mesmo formato, ou leia com
`ISession` usando a chave e o envelope exatos que você viu. A sessão em si é a
usual do ASP.NET Core: um cookie com um id e os dados em `IDistributedCache`.
`AddDistributedMemoryCache()` é por processo, então mais de uma instância precisa
de um cache compartilhado, como Redis (veja `caching-imemorycache-hybridcache-and-distributed`).

### CacheView: cachear um bloco da página

O `CacheView` renderiza o conteúdo filho uma vez e serve o HTML guardado depois.
Segundo a documentação de referência, em um acerto os componentes filhos nem são
instanciados nem renderizados. Ele varia pelo que você listar:

```razor
<CacheView VaryByQuery="category" ExpiresAfter="TimeSpan.FromMinutes(5)">
    <p id="stamp">@DateTime.UtcNow.Ticks</p>
    <p id="category">@(Category ?? "all")</p>
</CacheView>
```

Requisições com `DateTime.UtcNow.Ticks` como sonda:

```text
/news              639300741948323260  all
/news              639300741948323260  all      (mesmos ticks: servido do cache)
/news?category=a   639300741948368530  a
/news?category=a   639300741948368530  a        (em cache)
/news?category=b   639300741948375460  b        (entrada nova)
```

As outras propriedades `VaryBy*` na referência 11.0.0 são `VaryByRoute`,
`VaryByHeader`, `VaryByCookie`, `VaryByUser`, `VaryByCulture` e uma string livre
`VaryBy`, além de `Enabled`, `CacheKey`, `ExpiresAfter`, `ExpiresOn` e
`ExpiresSliding`. O armazenamento é em memória por padrão, com um limite de tamanho
(`CacheViewSizeLimit`, 100 MB por padrão segundo a documentação); se um `HybridCache`
estiver registrado ele é usado no lugar, e então a expiração deslizante não é
suportada. Não exercitei esses últimos pontos. É uma ferramenta diferente do output
caching (`output-caching-and-http-caching`): aquele cacheia uma resposta inteira por
política, este cacheia uma parte da página dentro da árvore de componentes.

### Adições menores e o lado CSRF de tudo isso

`<BasePath />` renderiza `<base href="/" />` a partir do base path do app, no lugar
da tag escrita à mão (execução: a saída foi exatamente `<base href="/" />`). As
notas de versão também listam `EnvironmentView` e `DisplayName`; não executei esses
dois.

Todo padrão aqui começa com um POST, então a regra de CSRF importa. Sem
`UseAntiforgery()` no pipeline, um POST para uma página se comportou assim no GA:

```text
sem Sec-Fetch-Site, sem Origin                          302
Sec-Fetch-Site: same-origin                             302
Sec-Fetch-Site: cross-site                              400
Origin: http://evil.example                             400
Sec-Fetch-Site: same-origin + Origin: http://localhost  302
```

É a checagem automática descrita em `csrf-protection-antiforgery-tokens-and-fetch-metadata`
e `whats-new-in-aspnet-core-11`, e ela protege os formulários de flash e de carrinho
sem token. Um cliente que não envia nenhum header de navegador (como o meu cliente de
teste) passa.

## Trade-offs

- **Um cookie é limitado e viaja em toda requisição.** TempData em cookie não tem
  estado no servidor, mas é limitado pelo tamanho do cookie, então mantenha as
  mensagens curtas e objetos de fora.
  ```csharp
  Message = "saved";   // um id ou um texto curto, não um modelo inteiro
  ```
- **O atributo não torna o TempData de leitura única sozinho.** Ler a propriedade
  deixa o valor no lugar; atribua `null` depois da leitura ou use `ITempData.Get`.
  ```csharp
  Shown = Message; Message = null;
  ```
- **A sessão é por visitante, mas custa memória e um armazenamento compartilhado.**
  Funciona de imediato em uma instância com `AddDistributedMemoryCache` e perde
  dados em silêncio em uma segunda instância se o cache não for compartilhado.
- **A chave e o formato da sessão pertencem ao atributo.** Código que grava a mesma
  chave à mão com `SetString` não será lido de volta, e o contrário também.
- **O `CacheView` é compartilhado entre usuários a menos que você faça variar.** Um
  bloco com qualquer dado pessoal deve variar por usuário (`VaryByUser`) ou ficar
  fora do cache, e dado velho é o preço da expiração escolhida.
  ```razor
  <CacheView VaryByUser="true" ExpiresAfter="TimeSpan.FromMinutes(1)">...</CacheView>
  ```
- **Este é estado de SSR estático.** Componentes interativos têm o circuito para
  estado vivo; essas ferramentas existem porque páginas estáticas não têm.

## Lab

Neste lab você monta um Blazor Web App que usa só server-side rendering estático e guarda estado entre requisições de três formas: uma mensagem flash com TempData após Post/Redirect/Get, um carrinho na sessão e um bloco de notícias cacheado pelo `CacheView` por valor da query string. Os testes chamam o app em memória com `WebApplicationFactory`, mantêm um conjunto de cookies por `HttpClient` (um navegador cada) e leem o HTML e os headers `Set-Cookie`. Nenhum navegador é usado. O lab usa `net11.0` e precisa do SDK 11.

**O que você vai fazer, passo a passo**

1. **Mensagem flash (TODO-00).** Em `Flash.razor`, forneça `Message` a partir do TempData para que `GET /flash` mostre `saved hello` uma vez depois do POST.
2. **Um navegador, uma mensagem (TODO-01).** Um segundo cliente não pode vê-la.
3. **Carrinho na sessão (TODO-02).** Em `Cart.razor`, forneça `Items` a partir da sessão e registre a sessão em `Program.cs`.
4. **Bloco em cache (TODO-03).** Em `News.razor`, envolva o bloco em `CacheView` variando por `category`.
5. **Base path (TODO-04).** Em `App.razor`, emita `<base href="/" />` com `BasePath`.
6. **Bônus.** Leia `ShouldStoreTempDataInSessionWhenConfigured` e descubra a opção que move o TempData para a sessão.

**Como saber que terminou:** `dotnet test` verde. **Pré-requisitos:** noções de SSR estático e o SDK do .NET 11 (xUnit, `Microsoft.AspNetCore.Mvc.Testing` 11.0.0). **Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`; use `--filter "Category!=Bonus"` para a parte obrigatória.

## Documentation Links

- [What's new in ASP.NET Core 11, Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [ASP.NET Core Blazor state management, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/) (doc)
- [Session and state management in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/app-state) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
