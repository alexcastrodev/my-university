---
version: 1.0
updatedAt: 2026-11-19
title: "Razor Pages, Tag Helpers e View Components"
summary: Razor Pages num app net10.0 real, medido requisição por requisição, com handlers e o que o BindProperty liga, o HTML dos Tag Helpers contra o dos HTML Helpers, o 400 do antiforgery, _ViewImports, layouts e seções, um Tag Helper próprio com testes, view components e quando usar cada peça, os scripts de validação cliente do template dotnet new webapp e o custo de compilar views (tamanho do assembly, subida e primeira requisição).
---
## Objective

Razor Pages é o jeito baseado em páginas de renderizar HTML no servidor no ASP.NET Core: um arquivo `.cshtml` mais um `PageModel` com handlers `OnGet`/`OnPost`, Tag Helpers que transformam atributos `asp-*` em HTML de verdade e view components para blocos reutilizáveis com lógica própria. A lição anterior de MVC cobriu controllers, filtros e binding; esta roda um app Razor Pages e registra o que cada requisição devolveu: a escolha do handler, o que os Tag Helpers emitem em comparação com os HTML Helpers, o 400 do antiforgery, um Tag Helper próprio com testes, as regras dos view components, os scripts de validação cliente que o `dotnet new webapp` entrega e o que as views custam no build e na primeira requisição. Versions: SDK 10.0.100, `net10.0`, runtime `Microsoft.AspNetCore.App` 10.0.0 (Razor Pages, MVC e os Tag Helpers embutidos estão no shared framework, sem pacote). Testes: `xunit` 2.9.3, `Microsoft.AspNetCore.Mvc.Testing` 10.0.0. Bibliotecas do template: jQuery 3.7.1, jquery-validation 1.21.0, jquery-validation-unobtrusive 4.0.0.

## Use Cases

- Back offices, áreas administrativas e sites cheios de formulários em que uma página é uma URL e um fluxo de formulário.
- Manter um site Razor Pages ou MVC existente: ler atributos `asp-*`, `_ViewImports` e layouts sem adivinhar.
- Extrair um bloco repetido (badge do carrinho, menu, widget) para um Tag Helper, um partial ou um view component, sabendo qual escolher.
- Estimar se um site com mil páginas paga algum preço por views pré-compiladas.

## Deep Dive

### O modelo de página, os handlers e o que o `[BindProperty]` liga

```csharp
public class IndexModel(Store store) : PageModel            // DI no construtor funciona
{
    [BindProperty] public ItemInput Input { get; set; } = new();
    [BindProperty(SupportsGet = true)] public string? Filter { get; set; }

    public void OnGet(int? id) => Trace = $"OnGet id={id} Filter={Filter} Input.Name={Input.Name}";
    public IActionResult OnPost()
    {
        if (!ModelState.IsValid) return Page();                 // renderiza de novo com os erros
        store.Items.Add(Input);
        return RedirectToPage(new { id = Input.Id });           // post-redirect-get
    }
    public async Task<IActionResult> OnPostDeleteAsync(int id)  // handler nomeado "Delete"
    { store.Items.RemoveAll(i => i.Id == id); return RedirectToPage(); }
}
```

```text
@page "{id:int?}"   (Items/Index.cshtml)
GET  /Items/5                      -> OnGet id=5 Filter= Input.Name=
GET  /Items?Filter=Key             -> OnGet id= Filter=Key Input.Name=
GET  /Items?Input.Name=hello       -> Input.Name= (vazio: sem SupportsGet)
GET  /Items/abc                    -> 404 (a restrição :int)
POST /Items (inválido)             -> 200, mesma página, classes input-validation-error
POST /Items (válido)               -> 302 Location: /Items/4
POST /Items/1?handler=Delete       -> 302 Location: /Items/1
POST /Items?handler=Nope (válido)  -> 302, o OnPost rodou
PUT  /Items (com token)            -> 200, página renderizada (não há OnPut)
```

O `[BindProperty]` liga só no POST; `SupportsGet = true` é a adesão explícita para o GET, por isso `Filter` foi ligado e `Input.Name` não. Três resultados me surpreenderam. `RedirectToPage()` sem argumentos reaproveitou o valor de rota `id=1` da requisição atual, então depois do Delete o navegador foi para `/Items/1`; passe `new { id = (int?)null }` ou outro nome de página quando não for isso que você quer. Um `?handler=Nope` desconhecido não falhou: caiu no `OnPost`. E um verbo sem handler renderiza a página com 200 em vez de 405. O nome do handler vem do método (`OnPostDeleteAsync` é `Delete`), e `asp-page-handler="Delete"` escreve `?handler=Delete` na action do formulário.

### Tag Helpers contra HTML Helpers: o mesmo HTML

`<input asp-for="Input.Name" class="form-control" />` e `@Html.TextBoxFor(m => m.Input.Name, new { @class = "form-control" })` sobre uma propriedade `[Required, StringLength(20, MinimumLength = 3)]`, renderizados pela mesma página:

```text
TAG:  <input class="form-control" type="text" data-val="true" data-val-length="The field Name must be a string with a minimum length of 3 and a maximum length of 20." data-val-length-max="20" data-val-length-min="3" data-val-required="The Name field is required." id="Input_Name" maxlength="20" name="Input.Name" value="" />
HTML: <input class="form-control" data-val="true" data-val-length="The field Name ..." data-val-length-max="20" data-val-length-min="3" data-val-required="The Name field is required." id="Input_Name" maxlength="20" name="Input.Name" type="text" value="" />
```

Mesmos atributos, ordem diferente, então o navegador não vê diferença; o ganho é que o Tag Helper parece HTML no arquivo (um designer consegue abrir) e ganha IntelliSense nos `asp-*`. Os dois emitem os `data-val-*` a partir dos atributos de validação, e uma propriedade `number` ganha ainda um `<input name="__Invariant" type="hidden" value="Input.Quantity">`. O `asp-validation-for` renderizou `<span class="field-validation-valid" data-valmsg-for="Input.Name" ...>`, que depois de um POST inválido virou `field-validation-error` com a mensagem dentro. Outros embutidos medidos: `asp-page="/Items/Index" asp-route-filter="kb"` gerou `href="/Items?filter=kb"`, e `<form method="get" asp-page=...>` gerou `action="/Items"` e nenhum token.

`<environment>` é um Tag Helper sobre o `IHostEnvironment`: com `ASPNETCORE_ENVIRONMENT=Development` a página emitiu `href="/css/site.css?v=zeR5PHeeHbxfGkL8WV86OzdoF6UnjuCmnagaocD-cbo"` (do `asp-append-version`) e com `Staging` o outro ramo, `href="/css/site.css"`. `<cache>` e `<distributed-cache>` em três requisições: o bloco foi renderizado na requisição 1 e as quatro seguintes serviram o texto em cache; o `vary-by-query="id"` renderizou de novo só para `?id=1` (requisição 3) e `?id=2` (requisição 5); o `<distributed-cache>` usou o `AddDistributedMemoryCache()` registrado. Os detalhes estão na lição de CacheView. `<component>` (componentes Razor dentro de uma página) e as opções do `<partial>` ficam só na documentação aqui.

### Antiforgery: 400 sem o token

Todo `<form method="post">` sem `action` ganhou um campo oculto `__RequestVerificationToken`, e a resposta definiu `.AspNetCore.Antiforgery.<hash>=...; samesite=strict; httponly`, `Cache-Control: no-cache, no-store` e `X-Frame-Options: SAMEORIGIN`. Postando em `/Items` com `curl`:

```text
sem token, sem cookie      400
só cookie                  400
só token (sem cookie)      400
cookie + token no form     302
cookie + header RequestVerificationToken   302
POST /Ping (página só com OnGet), sem token  400   (com token: 200)
POST /Webhook, [IgnoreAntiforgeryToken] na classe PageModel  200 "webhook accepted"
POST /Items?handler=Open, [IgnoreAntiforgeryToken] no método handler  400
```

O Razor Pages valida o token em todo verbo não seguro por padrão (a página do Learn diz que as Razor Pages são protegidas automaticamente), ao contrário do controller MVC da lição anterior, em que um `[HttpPost]` sozinho devolveu 200 sem token. O `[IgnoreAntiforgeryToken]` funciona na classe `PageModel` ou globalmente; num método handler o compilador imprimiu `warning MVC1001: 'IgnoreAntiforgeryTokenAttribute' cannot be applied to Razor Page handler methods` e a requisição continuou com 400. Um `<form method="post" action="/Items">` escrito à mão ficou sem token (a documentação: ele é gerado quando `action` é vazio ou ausente), então daria 400 no envio; o `asp-antiforgery="true"` forçou a geração, e o `Html.BeginForm` também emitiu o token. Para `fetch`, envie o header `RequestVerificationToken`. O ataque e a camada de Fetch Metadata estão na lição de CSRF.

### `_ViewImports`, `_ViewStart`, layouts e seções

O `_ViewImports.cshtml` guarda `@using`, `@namespace` e `@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers`; o `_ViewStart.cshtml` roda antes de cada página e define o `Layout`. Os dois valem para a pasta e as de baixo. As falhas que encontrei:

```text
@removeTagHelper numa página   <badge status="ok">Paid</badge> e <input asp-for="Input.Name" />
                             saíram literais, sem erro, o navegador ignorou os atributos
Areas/Admin/Pages/Dashboard  <a asp-page="/Dashboard"> saiu cru: Pages/_ViewImports não vale para
                             uma area; depois de criar Areas/Admin/Pages/_ViewImports.cshtml: href="/Admin/Dashboard"
seção "Footer" na página, layout sem RenderSection  500 InvalidOperationException: The following
                             sections have been defined but have not been rendered by the page at
                             '/Pages/Shared/_Layout.cshtml': 'Footer'. To ignore an unrendered section call IgnoreSection("sectionName").
layout com RenderSection("Scripts", required: true), página sem ela  500 The layout page '/Pages/Shared/_Layout2.cshtml'
                             cannot find the section 'Scripts' in the content page '/Pages/NeedSection.cshtml'.
```

Um Tag Helper que não foi importado é só marcação comum, a causa mais frequente de "meu asp-for não faz nada". No template, os scripts de validação vão na seção `Scripts` como `<partial name="_ValidationScriptsPartial" />`; o `<partial>` é a forma em tag do `Html.PartialAsync`, e `model="..."` passa o modelo (`model='"from partial"'` renderizou `<i>from partial</i>`).

### Um Tag Helper próprio e seus testes

```csharp
[HtmlTargetElement("badge")]                                  // <badge status="ok">Paid</badge>
public class BadgeTagHelper : TagHelper
{
    public string Status { get; set; } = "info";              // atributo "status"
    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = "span";
        output.Attributes.SetAttribute("class", $"badge badge-{Status}");
    }
}
[HtmlTargetElement("a", Attributes = "external")]             // só <a ... external>
public class ExternalLinkTagHelper : TagHelper
{
    public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        output.Attributes.RemoveAll("external");
        output.Attributes.SetAttribute("rel", "noopener noreferrer");
        output.Attributes.SetAttribute("target", "_blank");
        output.Content.SetHtmlContent((await output.GetChildContentAsync()).GetContent() + " (external)");
    }
}
```

Com `@addTagHelper *, Lab` no `_ViewImports`: `<span class="badge badge-ok">Paid</span>` e `<a href="https://learn.microsoft.com" rel="noopener noreferrer" target="_blank">docs (external)</a>`. A classe precisa ser pública, `Status` mapeia para `status` (PascalCase para kebab-case) e um Tag Helper que não casa com o filtro `Attributes` nunca roda. Os testes unitários precisam só dos tipos do framework, sem host; o teste de página passa pelo `WebApplicationFactory<Program>` (`public partial class Program;` no `Program.cs`):

```csharp
var ctx = new TagHelperContext("badge", [], new Dictionary<object, object>(), "id");
var output = new TagHelperOutput("badge", [], (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));
new BadgeTagHelper { Status = "ok" }.Process(ctx, output);   // TagName "span", class "badge badge-ok"
// WebApplicationFactory: POST /Items sem token => 400; GET /Compare contém o <span class="badge badge-ok">
```

```text
Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: 262 ms - Lab.Tests.dll (net10.0)
```

### View components, e quando usar cada peça

```csharp
public class CartSummaryViewComponent(ICart cart) : ViewComponent        // DI no construtor
{ public IViewComponentResult Invoke(string label = "items") => View(new CartSummaryModel(cart.Count, label)); }
// view: Pages/Shared/Components/CartSummary/Default.cshtml
```

```text
[tag]     <vc:cart-summary label="tag" />                                          <span class="cart">3 tag</span>
[invoke]  @await Component.InvokeAsync("CartSummary", new { label = "invoke" })    <span class="cart">3 invoke</span>
[typed]   @await Component.InvokeAsync(typeof(CartSummaryViewComponent), ...)      <span class="cart">3 typed</span>
[default] <vc:cart-summary />                                                      <span class="cart">3 items</span>
GET /Items?label=hack     -> <span class="cart">3 in cart   (a query string não chegou ao componente)
GET /Components/CartSummary, GET /CartSummary -> 404, 404
InvokeAsync("CartSummary", new { lable = "typo" }) -> 200, usou o padrão "items" em silêncio
<vc:cart-summary lable="x" />                      -> 200, igual
InvokeAsync("CartSummary", new { label = 5 })      -> 500 InvalidCastException: Int32 to String
InvokeAsync("Nope") -> 500 A view component named 'Nope' could not be found. ...
```

A página do Learn declara a regra: view components "don't use model binding", os parâmetros vêm da chamada, e um view component nunca trata uma requisição diretamente. Um erro de digitação numa propriedade do objeto anônimo ou no atributo da tag é ignorado sem aviso, então teste o ponto de chamada. O nome é a classe sem o sufixo `ViewComponent`, em kebab-case no `<vc:...>`, que precisa de `@addTagHelper *, Lab`.

| Necessidade | Use |
| --- | --- |
| Marcação reutilizável, dados vêm do modelo da página | partial view (`<partial>`) |
| Marcação com lógica ou serviços próprios (contagem do carrinho, menu vindo do banco) | view component |
| Alterar ou estender um elemento ou atributo HTML, sem marcação nova própria | Tag Helper |
| Widget interativo dentro de uma página de servidor | componente Razor via `<component>` (só documentação) |

### Validação cliente: o `jquery-validation-unobtrusive` ainda é o padrão?

Sim, com uma ressalva. O `dotnet new webapp` no SDK 10.0.100 cria `wwwroot/lib/` com bootstrap 5.3.3, jQuery 3.7.1, jquery-validation 1.21.0 (`jquery.validate.min.js` com 25.308 bytes) e jquery-validation-unobtrusive 4.0.0 (5.824 bytes), e `Pages/Shared/_ValidationScriptsPartial.cshtml` com as duas tags de script. O `_Layout` carrega `jquery.min.js` (87.533 bytes) e o bundle do Bootstrap, mas não os scripts de validação, e as três páginas do template (Index, Privacy, Error) não têm formulário, então nada referencia o partial até você criar uma página com formulário e incluí-lo em `@section Scripts`. Os atributos `data-val-*` são o contrato: com `AddViewOptions(o => o.HtmlHelperOptions.ClientValidationEnabled = false)` o mesmo input renderizou `id="Input_Name" maxlength="20" name="Input.Name"` com zero atributos `data-val`, então o servidor continua validando e o navegador não. A página de validação do Learn ainda mostra os scripts unobtrusive, com versões de CDN mais antigas que as do template (jQuery 3.6.0, validate 1.19.3).

### O que uma view Razor custa

As views são compiladas dentro do assembly do app no build; `RazorCompileOnBuild` vale true por padrão. Mesmo app (20 `.cshtml`) mais cópias da página Items com formulário, Release, build limpo, 5 subidas a frio cada (mediana), nesta máquina; "listening" é o tempo até um `/ping` de Minimal API responder:

| Variante | `.cshtml` | `Lab.dll` | build | listening | 1º `GET /Items` | `GET /Items` aquecido |
| --- | --- | --- | --- | --- | --- | --- |
| pré-compilada | 20 | 98.816 B | 2,0 s | 185 ms | 48 ms | 0,5 ms |
| pré-compilada | 219 | 2.907.648 B | 3,3 s | 215 ms | 49 ms | 0,5 ms |
| pré-compilada | 1.019 | 14.319.616 B | 8,8 s | 334 ms | 53 ms | 0,5 ms |
| `RazorCompileOnBuild=false` | 20 | 18.432 B | 2,0 s | n/d | `/Items` 404 | n/d |
| pacote de runtime compilation | 20 | 18.944 B | 2,0 s | 770 ms | 540 ms | 0,5 ms |

Cerca de 14 KB de IL por página com formulário, e o custo aparece na subida (+150 ms para 1.000 páginas, a tabela de endpoints), não por requisição: as requisições aquecidas ficaram em 0,5 ms. Desligar a propriedade tirou as views da DLL e `/Items` devolveu 404, como o doc do SDK avisa. Com `Microsoft.AspNetCore.Mvc.Razor.RuntimeCompilation` 10.0.0 e `AddRazorRuntimeCompilation()`, o Roslyn compilou na primeira requisição (540 ms contra 48 ms); uma edição no `.cshtml` foi servida sem rebuild assim que o file watcher a viu (em até 2 s aqui) e a primeira requisição depois da edição levou 112 ms. A página do Learn diz que a runtime compilation "was obsoleted starting in .NET 10", desliga o Hot Reload e não é recomendada em produção: referenciar a classe da extensão pelo nome deu o warning `ASPDEPR003` ("For development scenarios, use Hot Reload instead"), enquanto a chamada `.AddRazorRuntimeCompilation()` no `Program.cs` compilou sem warning. Use `dotnet watch` e mantenha a compilação em build.

### Livro vs hoje, e onde o Razor Pages está

Comparado com WebForms, não há ViewState, árvore de controles nem eventos de ciclo de vida da página: um handler roda, devolve um resultado, e a resposta é HTML que você consegue ler. Comparado com o MVC (exame 70-486), o mesmo motor Razor, os Tag Helpers e os filtros funcionam, mas a unidade de código é a página: o Learn lista como benefício o código da página junto da página e a lógica e os view models específicos da view juntos no próprio namespace e diretório. Do lado do mercado, o guia atual do Learn "Choose an ASP.NET Core web UI" diz: "For new project development, we recommend ASP.NET Core Blazor", e descreve o Razor Pages como um modelo baseado em páginas "built on ASP.NET Core MVC". Então leia o Razor Pages como o modelo da grande base instalada e dos sites renderizados no servidor que não precisam de interatividade de componentes; o Blazor static SSR dá o mesmo fluxo renderizado no servidor com componentes (veja as lições de static SSR e de formulários), e os dois dividem o mesmo host pelo Component Tag Helper.

## Trade-offs

- **Razor Pages vs views MVC.** Páginas mantêm um fluxo de formulário em dois arquivos e servem bem a CRUD; o MVC serve a muitas actions sobre um recurso e a APIs compartilhadas. Os dois usam os mesmos Tag Helpers e `_ViewImports`, e convivem no mesmo app.
- **Tag Helpers vs HTML Helpers.** Mesmo HTML de saída; Tag Helpers leem como marcação mas falham em silêncio quando não importados (`@addTagHelper`), então deixe o import no `_ViewImports` e teste o HTML renderizado.
- **Partial, view component ou Tag Helper.** O view component paga uma classe e uma chamada próprias, mas usa DI e é dono dos seus dados; não use quando um partial e o modelo da página bastam, e lembre que o ponto de chamada não é verificado em compilação.
- **O antiforgery vem ligado, deixe ligado.** O 400 é o recurso; ponha `[IgnoreAntiforgeryToken]` na classe `PageModel` de um webhook, nunca num formulário de navegador, e lembre que um atributo `action` escrito à mão tira o token a menos que você acrescente `asp-antiforgery="true"`.
- **Views pré-compiladas.** O custo é subida e tamanho da DLL (14 KB por página aqui), não tempo de requisição; a runtime compilation compra editar-e-atualizar com uma primeira requisição de 540 ms e uma API obsoleta.
- **Validação com jQuery.** O template ainda a entrega e o contrato `data-val-*` a deixa de graça, mas é uma dependência de jQuery; desligar o `ClientValidationEnabled` mantém só a validação no servidor.
- **Projetos novos.** A Microsoft recomenda Blazor para UI nova; escolha Razor Pages quando a equipe, o site existente ou um back office orientado a formulários já se encaixam, e evite misturar um terceiro modelo sem motivo.

## Documentation Links

- [Introduction to Razor Pages in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/?view=aspnetcore-10.0) (doc)
- [Tag Helpers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/tag-helpers/intro?view=aspnetcore-10.0) (doc)
- [Author Tag Helpers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/tag-helpers/authoring?view=aspnetcore-10.0) (doc)
- [View components in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/view-components?view=aspnetcore-10.0) (doc)
- [Partial views in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/partial?view=aspnetcore-10.0) (doc)
- [Layout in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/layout?view=aspnetcore-10.0) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0) (doc)
- [Razor file compilation in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/view-compilation?view=aspnetcore-10.0) (doc)
- [ASP.NET Core Razor SDK, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/sdk?view=aspnetcore-10.0) (doc)
- [Choose an ASP.NET Core web UI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/choose-web-ui?view=aspnetcore-10.0) (doc)
- [Model validation in ASP.NET Core MVC and Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-10.0) (doc)
