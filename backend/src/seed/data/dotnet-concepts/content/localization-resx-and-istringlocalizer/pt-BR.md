---
version: 1.0
updatedAt: 2026-10-28
title: "Localização: resx e IStringLocalizer"
summary: CurrentCulture versus CurrentUICulture, arquivos resx e satellite assemblies, a cadeia de fallback, a chave devolvida quando falta tradução, as regras de nome que falham em silêncio, UseRequestLocalization com query string, cookie e Accept-Language, mensagens de validação localizadas e o modo invariante de globalização, com a saída real de cada experimento.
---
## Objective

Localizar um app significa duas coisas diferentes que o .NET guarda em duas propriedades diferentes: formatar números, datas e moeda do jeito que uma região espera (`CultureInfo.CurrentCulture`) e escolher qual texto traduzido mostrar (`CultureInfo.CurrentUICulture`). O ASP.NET Core acrescenta três peças por cima: arquivos `.resx` compilados em satellite assemblies e lidos pelo `ResourceManager`, a abstração `IStringLocalizer<T>`, que transforma uma tradução ausente na própria chave em vez de uma exceção, e `UseRequestLocalization`, um middleware que escolhe a cultura de cada requisição pela query string, por um cookie ou pelo `Accept-Language`. A maioria das falhas aqui é silenciosa: um arquivo de recurso com o nome errado, uma cultura neutra que não sabe formatar moeda, um cabeçalho que o middleware ignora, um contêiner que força o modo invariante. Este conceito monta um app Minimal API e um console de testes e mostra o que cada uma dessas situações realmente imprimiu. Versões usadas: SDK 10.0.100 (runtime do .NET e do ASP.NET Core 10.0.0; `Microsoft.Extensions.Localization` e o middleware de localização de requisições vêm no shared framework, sem pacote extra), no macOS (Apple Silicon).

## Use Cases

- Servir a mesma API ou interface em português, inglês, alemão e japonês, com preços e datas formatados por região.
- Deixar o usuário escolher o idioma uma vez (cookie) e mantê-lo, respeitando o `Accept-Language` do navegador na primeira visita.
- Devolver mensagens de validação no idioma de quem chamou, a partir de controllers MVC.
- Decidir se uma imagem de contêiner pode rodar em modo invariante ou se precisa de ICU porque o app formata ou compara texto por cultura.

## Deep Dive

### Duas culturas: uma formata, a outra traduz

Formatei o mesmo `decimal` (`1234567.89m`) e o mesmo `DateTime` (2026-10-28 14:30) e pedi a um localizer a chave `"Hello"` com um argumento, definindo as duas culturas com cada valor:

```csharp
CultureInfo.CurrentCulture = new CultureInfo(c);    // números, datas, moeda, ordenação
CultureInfo.CurrentUICulture = new CultureInfo(c);  // qual .resx é lido
Console.WriteLine($"{amount:C} | {amount:N2} | {when:d} | {when:D} | {when:t} | {loc["Hello", "Ana"]}");
```

```text
pt-BR  | R$ 1.234.567,89 | 1.234.567,89 | 28/10/2026 | quarta-feira, 28 de outubro de 2026 | 14:30 | Olá, Ana!
en-US  | $1,234,567.89 | 1,234,567.89 | 10/28/2026 | Wednesday, October 28, 2026 | 2:30 PM | Hello, Ana!
de-DE  | 1.234.567,89 € | 1.234.567,89 | 28.10.2026 | Mittwoch, 28. Oktober 2026 | 14:30 | Hallo, Ana!
ja-JP  | ¥1,234,568 | 1,234,567.89 | 2026/10/28 | 2026年10月28日 水曜日 | 14:30 | こんにちは、Anaさん
```

Repare no `ja-JP`: o iene não tem casas decimais, então o `C` arredondou o valor para `¥1,234,568`. Depois separei as duas propriedades:

```text
Culture=de-DE, UICulture=pt-BR  ->  1.234.567,89 € | Mittwoch, 28. Oktober 2026 | Olá, Ana!
Culture=pt-BR, UICulture=en-US  ->  R$ 1.234.567,89 | quarta-feira, 28 de outubro de 2026 | Hello, Ana!
```

A busca de recursos seguiu apenas o `CurrentUICulture`. A página de localização do .NET descreve seu exemplo de fallback em termos de `CurrentCulture`; na minha execução o texto ignorou o `CurrentCulture` por completo.

### A cultura é async-local

O `CurrentCulture` vive no execution context, e é assim que o middleware consegue defini-lo por requisição sem vazar para outras requisições. Defini `pt-BR` e testei:

```text
caller before: pt-BR
Task.Run sees: pt-BR
inside after await: ja-JP                         (a method that set ja-JP, then awaited)
caller after awaiting a method that set ja-JP: pt-BR
new Thread sees: pt-BR
UnsafeQueueUserWorkItem sees: en-US              (no context flow: the process default)
```

Uma mudança desce para o trabalho iniciado depois, nunca sobe de volta para quem chamou. Código que não propaga o execution context enxerga o padrão do processo (`en-US` aqui, vindo de `LANG=en_US.UTF-8`).

### Arquivos .resx, satellite assemblies e AddLocalization

Usei uma classe marcadora no namespace raiz e um arquivo por cultura:

```csharp
builder.Services.AddLocalization(o => o.ResourcesPath = "Resources");
namespace LocDemo { public class SharedResource { } }   // nunca instanciada
```

```text
Resources/SharedResource.resx         Hello="Hello, {0}!"  Farewell="Goodbye"  NameRequired=...
Resources/SharedResource.pt-BR.resx   Hello="Olá, {0}!"    NameRequired="O nome é obrigatório."
Resources/SharedResource.pt.resx      Farewell="Tchau"
Resources/SharedResource.de.resx      Hello="Hallo, {0}!"
Resources/SharedResource.ja.resx      Hello="こんにちは、{0}さん"
```

O `dotnet build` embutiu o arquivo neutro no assembly principal e compilou cada cultura no seu próprio satellite assembly, numa pasta com o nome da cultura:

```text
bin/Debug/net10.0/de/LocDemo.resources.dll
bin/Debug/net10.0/ja/LocDemo.resources.dll
bin/Debug/net10.0/pt/LocDemo.resources.dll
bin/Debug/net10.0/pt-BR/LocDemo.resources.dll
manifest resources of LocDemo.dll: LocDemo.Resources.SharedResource.resources
```

Os serviços registrados eram `ResourceManagerStringLocalizerFactory` e `ResourceManagerStringLocalizer`: o `IStringLocalizer` é uma camada fina sobre o velho `ResourceManager`. `IHtmlLocalizer` e `IViewLocalizer` atendem views MVC; segundo a documentação, eles fazem HTML-encode dos argumentos, mas não da string do recurso. Views ficam fora do escopo aqui.

### A cadeia de fallback e a chave ausente

`loc["Hello", "Ana"]` preenche o placeholder `{0}` com o argumento. Busquei chaves sob UI cultures diferentes e imprimi o `LocalizedString` inteiro:

```text
pt-BR Hello:    Value="Olá, Ana!"   ResourceNotFound=False SearchedLocation=LocDemo.Resources.SharedResource
pt-BR Farewell: Value="Tchau"       ResourceNotFound=False   (found in pt)
pt-PT Hello:    Value="Hello, Ana!" ResourceNotFound=False   (pt has no Hello: neutral)
pt-PT Farewell: Value="Tchau"       ResourceNotFound=False
fr-FR Hello:    Value="Hello, Ana!" ResourceNotFound=False   (no fr at all: neutral)
pt-BR Missing:  Value="Missing"     ResourceNotFound=True
pt-BR "Total: {0}", 42: Value="Total: 42" ResourceNotFound=True
```

A cadeia é `pt-BR`, depois o pai `pt` (`CultureInfo("pt-BR").Parent` imprimiu `pt`, cujo pai é a cultura invariante), depois o `.resx` neutro. Uma chave ausente devolve a própria chave, ainda formatada com os argumentos, então a página mostra inglês (ou a chave) em vez de quebrar. O único sinal é o `ResourceNotFound`. O `GetAllStrings` mostra o que uma cultura realmente contribui: sob `pt-BR` ele devolveu `NameRequired, Hello` com `includeParentCultures: false` e acrescentou `Farewell=Tchau` com `true`.

### Recursos neutros ausentes: ResourceManager lança, IStringLocalizer não

Criei `NoNeutral.pt-BR.resx` sem arquivo neutro e perguntei tanto ao `new ResourceManager("LocDemo.Resources.NoNeutral", assembly).GetString("Title", culture)` quanto a um `IStringLocalizer`:

```text
raw ResourceManager, existing base, missing key: GetString returned null
NoNeutral pt-BR: Sem neutro
NoNeutral en-US: MissingManifestResourceException: Could not find the resource "LocDemo.Resources.NoNeutral.resources"
  among the resources "LocDemo.Resources.SharedResource.resources" embedded in the assembly "LocDemo", nor among the
  resources in any satellite assemblies for the specified culture. Perhaps the resources were embedded with an incorrect name.
IStringLocalizer NoNeutral en-US: Value="Title" ResourceNotFound=True SearchedLocation=LocDemo.Resources.NoNeutral
```

É por isso que a documentação do ASP.NET Core diz que dá para dispensar o `.resx` neutro e usar o texto do idioma padrão como chave. Uma variação: com `[assembly: NeutralResourcesLanguage("en", UltimateResourceFallbackLocation.Satellite)]` e sem satellite `en`, o `ResourceManager` consultado em `fr-FR` lançou `MissingSatelliteAssemblyException: The satellite assembly named "Sat.resources.dll, PublicKeyToken=null" for fallback culture "en" either could not be found or could not be loaded.`

### Regras de nome: a falha que imprime a chave

A factory calcula o nome do recurso a partir do nome completo do tipo menos o namespace raiz, com o `ResourcesPath` na frente. Para `LocDemo.Endpoints.Orders` ela procura `Resources/Endpoints.Orders.pt-BR.resx` (ou `Resources/Endpoints/Orders.pt-BR.resx`). Criei `Resources/Orders.pt-BR.resx` no lugar, o erro clássico, ao lado de um arquivo com o nome certo para `Invoices`:

```text
Orders   (file Resources/Orders.pt-BR.resx):           Value="Title"   ResourceNotFound=True  SearchedLocation=LocDemo.Resources.Endpoints.Orders
Invoices (file Resources/Endpoints.Invoices.pt-BR.resx): Value="Faturas" ResourceNotFound=False SearchedLocation=LocDemo.Resources.Endpoints.Invoices
```

Nenhuma exceção, nenhum log, nenhum aviso de build: a página simplesmente mostra `Title`. O `SearchedLocation` diz o nome exato que ela queria. Duas variações da documentação: uma classe `SharedResource` colocada na pasta `Resources` (namespace `MyApp.Resources`) faz a factory procurar em `Resources/Resources/`, e um projeto cujo `RootNamespace` difere do nome do assembly (por exemplo `my-project.csproj`) precisa de `[assembly: RootNamespace("...")]`.

### Escolhendo a cultura por requisição

```csharp
string[] supported = ["en", "pt-BR"];
app.UseRequestLocalization(o =>
{
    o.SetDefaultCulture("en").AddSupportedCultures(supported).AddSupportedUICultures(supported);
    o.ApplyCurrentCultureToResponseHeaders = true;   // adiciona Content-Language
});
```

Os `RequestCultureProviders` padrão imprimiram `QueryStringRequestCultureProvider, CookieRequestCultureProvider, AcceptLanguageHeaderRequestCultureProvider`, e vence o primeiro que devolve uma cultura suportada. Meu endpoint devolvia as culturas, o provider vencedor (`IRequestCultureFeature.Provider`), uma string localizada e `1234.5m.ToString("C")`:

```text
(nothing)                       Content-Language: en  {"culture":"en","uiCulture":"en","provider":null,"text":"Hello, Ana!","price":"¤1,234.50"}
?culture=pt-BR                  {"culture":"pt-BR","uiCulture":"pt-BR","provider":"QueryStringRequestCultureProvider","price":"R$ 1.234,50"}
?ui-culture=pt-BR               {"culture":"pt-BR","uiCulture":"pt-BR",...}   (one value sets both)
?culture=en&ui-culture=pt-BR    {"culture":"en","uiCulture":"pt-BR","text":"Olá, Ana!","price":"¤1,234.50"}
Cookie .AspNetCore.Culture=c=pt-BR|uic=pt-BR      provider CookieRequestCultureProvider, pt-BR
Accept-Language: pt-BR          Content-Language: pt-BR, provider AcceptLanguageHeaderRequestCultureProvider
?culture=en + pt-BR cookie      en (query wins)      pt-BR cookie + Accept-Language: en   pt-BR (cookie wins)
?culture=fr-FR + Accept-Language: pt-BR           pt-BR (unsupported query value skipped, next provider used)
```

Olhe o preço para `en`: `¤1,234.50`. `en` é uma cultura neutra, sem região, então não tem símbolo de moeda e imprime o `¤` genérico. As culturas suportadas usadas para formatação devem ser específicas (`en-US`, `pt-BR`); as neutras servem bem como UI cultures.

### Accept-Language, fallback para os pais e o que é ignorado

```text
Accept-Language: fr-FR                    -> en, provider null (default)
Accept-Language: en-GB                    -> en, provider AcceptLanguageHeaderRequestCultureProvider
Accept-Language: pt                       -> en, provider null
Accept-Language: pt-PT                    -> en, provider null
Accept-Language: fr-FR, pt-BR;q=0.8       -> pt-BR
Accept-Language: fr, de, es, pt-BR        -> en, provider null
```

`FallBackToParentCultures` e `FallBackToParentUICultures` (ambos `true` por padrão) só sobem: `en-GB` casou com `en`, mas `pt` não casou com `pt-BR` e `pt-PT` também não. Num branch com os dois em `false`, `Accept-Language: en-GB` e `?culture=en-GB` caíram no padrão com `provider` nulo. A última linha é o `MaximumAcceptLanguageHeaderValuesToTry` (padrão 3): `pt-BR` era a quarta entrada e nunca foi testada, enquanto `fr, de, pt-BR` resolveu para `pt-BR`.

### O cookie de cultura e um provider por segmento de rota

`CookieRequestCultureProvider.MakeCookieValue(new RequestCulture("pt-BR"))` monta o valor; ao anexá-lo a partir de um endpoint, a resposta trouxe `Set-Cookie: .AspNetCore.Culture=c%3Dpt-BR%7Cuic%3Dpt-BR; path=/` (codificado em URL, sem expiração, ou seja, um cookie de sessão a menos que você passe `CookieOptions`).

Para URLs como `/pt-BR/hello`, um provider customizado inserido em primeiro lugar:

```csharp
o.AddInitialRequestCultureProvider(new CustomRequestCultureProvider(ctx =>
{
    var seg = ctx.Request.Path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
    return Task.FromResult(seg is not null && supported.Contains(seg, StringComparer.OrdinalIgnoreCase)
        ? new ProviderCultureResult(seg) : null);
}));
```

`/pt-BR/hello` respondeu em `pt-BR` com provider `CustomRequestCultureProvider`, e `/pt-BR/hello?culture=en` também, porque o provider inserido roda antes da query string. A documentação também cita o `RouteDataRequestCultureProvider` para um valor de rota `{culture}`.

### Mensagens de validação localizadas

O MVC trata o `ErrorMessage` como chave de recurso. Apontei todos os atributos para o recurso compartilhado:

```csharp
builder.Services.AddControllers().AddDataAnnotationsLocalization(o =>
    o.DataAnnotationLocalizerProvider = (type, factory) => factory.Create(typeof(SharedResource)));
public class PersonDto { [Required(ErrorMessage = "NameRequired")] public string? Name { get; set; } }
```

Enviei `{}` por POST ao controller e a um endpoint Minimal API validado pelo `AddValidation()` do .NET 10:

```text
MVC ?culture=pt-BR     400 {"title":"One or more validation errors occurred.","errors":{"Name":["O nome é obrigatório."]}}
MVC (en)               400 {... "errors":{"Name":["The name is required."]}}
Minimal ?culture=pt-BR 400 {"title":"One or more validation errors occurred.","errors":{"Name":["NameRequired"]}}
```

A mensagem foi localizada, mas o `title` do ProblemDetails continuou em inglês. No .NET 10 o validador de Minimal API imprimiu a chave crua; a documentação do ASP.NET Core coloca a localização das mensagens de validação de Minimal API (via `Microsoft.Extensions.Validation`) no ASP.NET Core 11.

### Globalização invariante, ICU e imagens chiseled

O mesmo código de console em três configurações:

```text
ICU (default)                       CurrentCulture.Name='en-US'
  new CultureInfo("pt-BR") ok: C=R$ 1.234.567,89 D=quarta-feira, 28 de outubro de 2026, compare("a","B") = -1
DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1    CurrentCulture.Name='' UICulture=''
  CultureNotFoundException: Only the invariant culture is supported in globalization-invariant mode.
  See https://aka.ms/GlobalizationInvariantMode for more information. (Parameter 'name') pt-BR is an invalid culture identifier.
plus DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false
  new CultureInfo("pt-BR") ok: Name=pt-BR C=¤1,234,567.89 D=Wednesday, 28 October 2026
  localizer["Hello"] under UI pt-BR: Olá, Ana!     compare("a","B") = 31
```

Ou seja, em modo invariante criar `pt-BR` lança exceção, e o app web nem subiu: `SetDefaultCulture("en")` lançou a mesma `CultureNotFoundException` (`en is an invalid culture identifier.`). Com predefined-cultures-only desligado, o nome é aceito e as traduções continuam vindo do satellite assembly, mas a formatação é invariante e a comparação vira ordinal. É isso que as imagens chiseled fazem com você: o conceito `containerizing-dotnet-sdk-publish-dockerfile-chiseled` mostrou que elas definem `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true` e não trazem ICU; um app localizado precisa da variante `-extra` ou da imagem completa.

Os dados de cultura não fazem parte do .NET: a documentação diz que eles vêm do ICU (mantidos pelo CLDR, não pelo runtime), que o .NET carrega o ICU que a plataforma oferece e que existe a opção `System.Globalization.AppLocalIcu` para distribuir uma versão específica do ICU junto com o app. Neste Mac (macOS 27.0.1), `pt-BR` deu `ShortDatePattern=dd/MM/yyyy`, `LongDatePattern=dddd, d 'de' MMMM 'de' yyyy`, `ShortTimePattern=HH:mm`, separador de milhar `.`, decimal `,`, e o separador em `R$ 1.234.567,89` era um espaço comum U+0020. Não rodei em Linux; testes que comparam strings formatadas exatamente podem quebrar quando a versão do ICU muda.

### O que localização não é

Fuso horário é outro problema: `pt-BR` diz como imprimir uma data, não em qual offset ela está. Converter para o fuso do usuário está planejado como uma lição própria sobre datas, horas e fusos horários. E o `.resx` é apenas o armazenamento padrão: a documentação descreve o `IStringLocalizerFactory` como o nível mais baixo da abstração, que é o ponto onde uma implementação baseada em arquivos JSON ou em banco de dados substituiria a `ResourceManagerStringLocalizerFactory` registrada (não construí uma).

## Trade-offs

- **resx é compilado e seguro, mas só muda com deploy.** Satellite assemblies são rápidos e versionados junto com o código; mudar uma tradução exige build. Uma factory baseada em banco permite editar ao vivo e traz um problema de cache e de invalidação.
- **Tradução ausente é silenciosa por design.** Aparece a chave ou o texto neutro, e o `ResourceNotFound` é o único sinal; registre em log ou teste.
  ```csharp
  var s = loc["Checkout"]; if (s.ResourceNotFound) logger.LogWarning("Missing {Key} in {Location}", s.Name, s.SearchedLocation);
  ```
- **Culturas neutras não sabem formatar dinheiro.** Use culturas específicas (`en-US`) em `SupportedCultures`; `en` imprimiu `¤1,234.50`.
- **Accept-Language é uma dica.** Só os 3 primeiros valores são testados e o fallback só vai de filho para pai; ofereça uma escolha explícita (cookie ou URL), como a documentação recomenda.
- **O modo invariante economiza tamanho e quebra culturas.** Ele lança exceção em `new CultureInfo("pt-BR")` ou, com predefined-cultures-only desligado, formata tudo como invariante.
- **Cultura não é fuso horário nem lugar para guardar preferência de idioma.** Guarde a cultura escolhida pelo usuário e o fuso dele como dados separados.

## Documentation Links

- [Globalization and localization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization?view=aspnetcore-10.0) (doc)
- [Strategies for selecting language and culture in a localized ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization/select-language-culture?view=aspnetcore-10.0) (doc)
- [Provide localized resources for languages and cultures in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization/provide-resources?view=aspnetcore-10.0) (doc)
- [Localization in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/localization) (doc)
- [.NET globalization and ICU, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) (doc)
- [Globalization config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
