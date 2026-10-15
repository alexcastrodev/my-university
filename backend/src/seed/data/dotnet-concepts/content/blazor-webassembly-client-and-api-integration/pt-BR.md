---
version: 1.0
updatedAt: 2026-10-15
title: "Cliente Blazor WebAssembly e Integração com API"
summary: Um cliente standalone chamando uma API de outra origem, observado no navegador: CORS visto dos dois lados, a armadilha do base address, named clients, tamanho do download com trimming, compressão e invariant globalization, e lazy loading de assemblies.
---
## Objective

Um componente Blazor WebAssembly roda no navegador, então toda chamada que ele
faz à sua API é uma requisição do navegador, com as regras do navegador: a
same-origin policy, os preflights de CORS e um download que acontece antes do
primeiro pixel. Este concept monta um cliente standalone (`dotnet new blazorwasm`,
SDK 10.0.100) e uma minimal API separada, roda os dois e observa o que acontece em
um navegador de verdade: a falha exata quando falta CORS, o que a API enxerga em
cada caso, uma URL relativa que devolve HTML sem avisar, named clients, o tamanho
do publish e o que trimming, compressão e invariant globalization fazem com ele,
e o lazy loading de um assembly. Onde colocar o acesso a dados atrás de uma
interface para o mesmo componente rodar no servidor ou no navegador está em
Blazor Data Access and Streaming Rendering; a escolha do render mode está em
Blazor Render Modes and Hosting Models. Este aqui trata do cliente e da fronteira
HTTP.

## Use Cases

- Subir um front end WebAssembly ao lado de uma API existente em outra origem.
- Diagnosticar "TypeError: Failed to fetch" quando a API está saudável.
- Estimar e reduzir o download inicial de um app WebAssembly.
- Adiar código pouco usado com lazy loading de assemblies.

## Deep Dive

### O projeto standalone

`dotnet new blazorwasm` cria um projeto com
`Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"`. O `Program.cs` monta um
`WebAssemblyHostBuilder`, registra os root components e dá ao app um `HttpClient`
cujo base address é a origem que serviu o app:

```csharp
builder.Services.AddScoped(sp =>
    new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
```

Esse template não tem projeto de servidor: a saída é um conjunto de arquivos
estáticos, e a documentação diz que qualquer servidor de arquivos estáticos pode
hospedá-la. Dentro de um componente, `OperatingSystem.IsBrowser()` retornou
`True`. A documentação descreve esse `HttpClient` como implementado sobre a Fetch
API do navegador e sujeito aos limites dela, incluindo a same-origin policy, e
como "focused on making requests back to the server of origin".

### Como o CORS aparece dos dois lados

A página de teste chama uma API em outra porta. A API é uma minimal API com dois
endpoints e uma policy ligada por configuração:

```csharp
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5602").AllowAnyHeader().AllowAnyMethod()));
// ...
app.UseCors();
app.MapGet("/api/products", () => new[] { new Product(1, "Pen", 1.5m), new Product(2, "Ink", 7m) });
app.MapPost("/api/products", (Product p) => Results.Created($"/api/products/{p.Id}", p));
```

```razor
items = await Http.GetFromJsonAsync<List<Product>>("http://localhost:5601/api/products") ?? [];
```

Com a policy desligada, o console do navegador imprimiu `has been blocked by CORS
policy: No 'Access-Control-Allow-Origin' header is present`, e o componente
capturou `HttpRequestException: TypeError: Failed to fetch`. Essa mensagem é tudo
que o lado .NET recebe: sem status code, sem corpo. O log da API (com request
logging ligado) mostra a parte que surpreende:

```text
GET  /api/products   -> 200   (o endpoint rodou; o navegador descartou a resposta)
OPTIONS /api/products -> 405  (o preflight do POST com JSON; o POST nunca foi enviado)
```

Um GET simples é enviado e executado, e só a leitura é bloqueada, então CORS não
é defesa para um GET que altera estado. Um POST com corpo JSON dispara um
preflight antes, e sem policy a API respondeu 405 e o navegador parou. Com a
policy ligada, a mesma página registrou `GET 200`, `OPTIONS 204`, `POST 201` e
mostrou `post 201`. A origem precisa bater exatamente, esquema, host e porta: o
mesmo cliente aberto em `http://127.0.0.1:5602` em vez de `localhost:5602` falhou
de novo com `Failed to fetch`. A documentação acrescenta que `SetBrowserRequestMode`
com `NoCors` não contorna isso para uma API que você não controla. O conselho dela
é chamar o seu próprio backend, que chama a API externa a partir de código no
servidor, ou usar um proxy. Credenciais de cookie são opt-in por requisição
(`SetBrowserRequestCredentials(BrowserRequestCredentials.Include)`).

### A armadilha do base address

O client padrão aponta para a origem que serve os arquivos estáticos. Uma chamada
relativa como `Http.GetAsync("api/products")` no app standalone vai, portanto,
para o servidor de desenvolvimento e não para a API:

```text
200 text/html http://localhost:5602/ first: <!DOCTYPE html><html lang="en
JsonException: ExpectedStartOfValueNotFound, < Path: $ | LineNumber: 0
```

O host estático respondeu o caminho desconhecido com `index.html` e um 200, então
a falha aparece como erro de parsing de JSON e não como 404. Quando a API está em
outra origem, dê ao client essa origem. Um named client faz isso sem mudar o
padrão:

```csharp
builder.Services.AddHttpClient("api", c => c.BaseAddress = new Uri("http://localhost:5601"));
```

```razor
@inject IHttpClientFactory Factory
var http = Factory.CreateClient("api");
var items = await http.GetFromJsonAsync<List<Product>>("api/products");
```

Isso exige o pacote `Microsoft.Extensions.Http`, como a documentação diz; a página
então leu `http://localhost:5601/ -> 2 items, first Pen`. Typed clients são
suportados do mesmo jeito. Em um Blazor Web App a documentação traz uma ressalva:
os serviços de `HttpClient` não são registrados no projeto de servidor por padrão,
então um componente WebAssembly que sofre prerender precisa do registro também no
servidor, ou do prerender desligado para ele.

### O que o navegador baixa

No `dotnet run` (Debug) o navegador fez cerca de 200 requisições, um `.wasm` por
assembly. Desde o .NET 8 os assemblies são entregues por padrão como arquivos
`.wasm` no formato Webcil (`WasmEnableWebcil` desliga). Um publish em Release é
bem diferente. Publiquei o template com uma página e uma mudança no router no SDK
10.0.100 e somei os arquivos que o cliente carrega (os `.wasm`, os scripts
`dotnet*.js` e `blazor.webassembly.js` e um arquivo de dados do ICU):

| Publish | Arquivos `.wasm` | Raw | Brotli |
|---|---|---|---|
| Padrão (com trimming) | 37 | 7,0 MiB | 2,25 MiB |
| `-p:PublishTrimmed=false` | 201 | 18,8 MiB | 5,85 MiB |
| `-p:InvariantGlobalization=true` | 37 | 6,4 MiB | 2,09 MiB |

Essas somas incluem o assembly lazy de 4,9 KB da próxima seção e ficam perto dos
6,7 e 2,1 MiB medidos para o template Auto no concept de render modes. A
documentação diz que o Blazor faz trimming de IL em todo build Release, e a linha
sem trimming mostra quanto isso vale. A granularidade padrão do trimmer é
`partial`: só as bibliotecas centrais do framework e as que aderiram ao trimming
são cortadas. `InvariantGlobalization=true` tirou da saída o arquivo de dados do
ICU (o padrão era `icudt_EFIGS.dat`, 0,5 MiB raw, que segundo a documentação é o
arquivo carregado para a cultura `en-US`). A mesma página diz que a invariant
globalization reduz o tamanho do download e acelera o startup, e que a cultura
invariante é geralmente baseada em `en-US`, então serve para apps que não precisam
de localização.

O publish também gravou um `.br` e um `.gz` ao lado de cada arquivo, o que a
documentação descreve como compressão estática (Brotli no nível máximo, e gzip)
que o host precisa servir: um host estático sem content negotiation para arquivos
pré-comprimidos exige trabalho extra, e a documentação descreve um workaround com
decoder de Brotli. A pasta de publish não tinha `blazor.boot.json`. O build também
imprimiu uma recomendação de instalar o workload `wasm-tools`; não instalei
workloads, então relinking e AOT não foram medidos.

### Lazy loading de um assembly

Uma class library `Reports` com uma página roteável (`/reports`) é referenciada
pelo cliente e marcada para lazy loading pelo nome do arquivo, com a extensão:

```xml
<ProjectReference Include="../Reports/Reports.csproj" />
<BlazorWebAssemblyLazyLoad Include="Reports.wasm" />
```

```razor
@inject LazyAssemblyLoader Loader
<Router AppAssembly="@typeof(App).Assembly" AdditionalAssemblies="lazy" OnNavigateAsync="OnNavigate" ...>

@code {
    List<Assembly> lazy = [];
    bool loaded;
    async Task OnNavigate(NavigationContext ctx)
    {
        if (ctx.Path == "reports" && !loaded)
        {
            lazy.AddRange(await Loader.LoadAssembliesAsync(["Reports.wasm"]));
            loaded = true;
        }
    }
}
```

Ler `performance.getEntriesByType('resource')` no navegador mostrou que
`Reports.*.wasm` não foi requisitado na inicialização e apareceu depois de
`Blazor.navigateTo('/reports')`; a página então renderizou conteúdo do assembly
lazy. Carregar `/reports` direto também funcionou, porque o `OnNavigateAsync`
roda na primeira navegação. Em Debug o `Reports.pdb` foi baixado na
inicialização, só o assembly foi adiado. O assembly de teste tinha 4,9 KB, então
isso mostra o mecanismo, não uma economia. A documentação avisa para não aplicar
lazy loading em assemblies do runtime, que podem ter sido cortados pelo trimming,
e cada dependência de um assembly lazy precisa da própria entrada.

### Rodando dois projetos

A API e o cliente são dois processos. `dotnet run --no-launch-profile --urls
http://localhost:5601` na pasta da API e o mesmo com `5602` na pasta do cliente
funcionaram. A flag importa: no Blazor Web App que rodei para os experimentos de
Razor, definir `ASPNETCORE_URLS` foi ignorado porque a URL do launch profile
venceu, e o app falhou ao tentar usar uma porta já ocupada. Mantenha a origem
permitida no CORS e o base address da API no cliente em configuração, não no
código, para as duas portas mudarem juntas.

## Trade-offs

- **O WebAssembly elimina o circuito por usuário no servidor e adiciona um
  download.** O template padrão com trimming tem cerca de 2,2 MiB com Brotli
  antes do seu código, enquanto uma página renderizada no servidor precisou de um
  script de 47,5 KB com Brotli na medição do concept de render modes.
- **CORS é regra do navegador, então o cliente .NET não consegue dizer por que a
  chamada falhou.** Ligue o log de requisições na API para separar uma resposta
  bloqueada de uma requisição que nunca chegou.
  ```text
  Logging__LogLevel__Microsoft.AspNetCore=Information dotnet run --no-launch-profile ...
  ```
- **Um named client evita a armadilha do base address e adiciona um pacote.** O
  client padrão serve para APIs de mesma origem; use `AddHttpClient("api", ...)`
  para as demais.
- **O trimming reduz o download e torna a reflection frágil.** A documentação do
  trimmer avisa que código com muita reflection (JS interop, serialização JSON)
  pode perder tipos ou nomes de parâmetros, então teste a saída publicada e não só
  o `dotnet run`.
- **Lazy loading adia bytes e adiciona um atraso na navegação.** Compensa quando o
  assembly adiado é grande e pouco usado, e pede um estado `<Navigating>`.
- **A invariant globalization economizou 0,6 MiB raw (0,16 MiB com Brotli) e abre
  mão dos dados de locale.** Serve para uma ferramenta só em inglês, e é errada
  para um app que formata datas e números por usuário.

## Documentation Links

- [Call a web API from an ASP.NET Core Blazor app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/call-web-api) (doc)
- [Host and deploy ASP.NET Core Blazor WebAssembly, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/webassembly/) (doc)
- [Lazy load assemblies in ASP.NET Core Blazor WebAssembly, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-lazy-load-assemblies) (doc)
- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Configure the Trimmer for ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/configure-trimmer) (doc)
- [ASP.NET Core Blazor globalization and localization, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/globalization-localization) (doc)
