---
version: 1.0
updatedAt: 2026-10-15
title: "Arquivos Estáticos e MapStaticAssets"
summary: O manifest gerado no build, fingerprint e pré-compressão, os headers que o servidor envia, o que o MapStaticAssets não serve, quando ainda usar UseStaticFiles e o efeito do ShortCircuit.
---
## Objective

Servir CSS, JavaScript e imagens parece a parte menos interessante de um app web,
mas é ela que decide a velocidade das páginas e se o usuário vê arquivos velhos
depois de um deploy. Desde o .NET 9 o caminho recomendado é o `MapStaticAssets`,
que faz no build o que o `UseStaticFiles` fazia a cada requisição: comprime,
calcula o fingerprint e descreve cada arquivo num manifest, e depois serve tudo
como endpoint roteado. O objetivo é entender o que há nesse manifest, como ficam
os headers de resposta com e sem ele, o que ele não consegue servir e quando o
`UseStaticFiles` ainda é a ferramenta certa.

## Use Cases

- Obter URLs com hash do conteúdo e cache longo para CSS e JS sem um bundler à
  parte.
- Entender por que um arquivo copiado para o servidor dá 404 mesmo estando no
  `wwwroot`.
- Servir um documento padrão (`index.html`) num site pequeno ou num host de SPA.
- Combinar os dois mecanismos: assets otimizados do build e uploads de usuários
  numa pasta fora do projeto.
- Manter middlewares como log ou rate limiting longe das requisições de arquivos
  estáticos.

## Deep Dive

### O que o build produz

Um projeto com `Microsoft.NET.Sdk.Web` descobre os arquivos sob `wwwroot` (o web
root padrão; só essa pasta é endereçável) em tempo de build e grava um manifest
ao lado do assembly, chamado `{AssemblyName}.staticwebassets.endpoints.json`. O
experimento usou `dotnet new web` (SDK 10.0.100), com uma folha de estilo
`app.css` de 20 KB, um `index.html`, um arquivo com extensão desconhecida e uma
cópia da folha de estilo em `lib/icons/`. A única mudança no `Program.cs` foi a
chamada:

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapStaticAssets();
app.MapGet("/api/hello", () => "hello");
app.Run();
```

Lendo o manifest depois do `dotnet build` e do `dotnet publish`:

```text
build:    app.css -> app.css, app.css.gz                       (só gzip)
publish:  app.css -> app.css, app.css.gz, app.css.br           (gzip e brotli)
          20924 bytes brutos, 3726 bytes gzip, 1393 bytes brotli
rotas:    app.css                  Cache-Control: no-cache
          app.21z5vmge6z.css       Cache-Control: max-age=31536000, immutable
```

Cada asset tem duas rotas. A simples (`/app.css`) revalida sempre. A com
fingerprint (`/app.21z5vmge6z.css`) carrega um hash do conteúdo, então a resposta
pode ficar em cache por um ano com `immutable`: quando o arquivo muda, o nome
muda, e o navegador pede outra URL. A documentação descreve o fingerprint como um
SHA-256 do conteúdo em Base64. A compressão acontece no build, então não se gasta
CPU comprimindo a cada requisição, e imagens e fontes que já são comprimidas são
puladas.

### O que o servidor envia

Contra o app publicado (Production, `curl` na porta 5310):

```text
GET /app.css                              -> 200, 20924 bytes, Cache-Control: no-cache, ETag "aqhc...", Vary: Accept-Encoding
GET /app.css  Accept-Encoding: gzip, br   -> 200, 1393 bytes,  Content-Encoding: br
GET /app.css  Accept-Encoding: gzip       -> 200, 3726 bytes,  Content-Encoding: gzip
GET /app.21z5vmge6z.css                   -> 200, Cache-Control: max-age=31536000, immutable
GET /app.css  If-None-Match: "aqhc..."    -> 304 Not Modified
```

O header `Vary: Accept-Encoding` é o que impede um cache de entregar um corpo Brotli
a um cliente que não decodifica. O `ETag` vem do hash do conteúdo até na rota sem
fingerprint, então uma revalidação custa um 304 e nenhum corpo. Em Development, a
documentação diz que o framework reescreve o `Cache-Control` para `no-cache` para
que as edições apareçam, e o `EnableStaticAssetsDevelopmentCaching` desliga isso.

### O que ele não serve

O `MapStaticAssets` serve a partir do manifest, não olhando o disco. Duas
consequências, ambas observadas. Primeiro, um arquivo jogado no `wwwroot` depois
do publish dá 404:

```text
echo late > pub/wwwroot/late.txt
GET /late.txt  -> 404           (fora do manifest)
```

Segundo, não há documentos padrão. `GET /` também dá 404 mesmo com o
`index.html` existindo, enquanto `GET /index.html` funciona. A documentação lista
os casos que continuam com o static file middleware: arquivos fora do web root,
arquivos do disco ou de recursos embutidos, headers de resposta customizados,
directory browsing, documentos padrão e mapeamentos de MIME customizados. Para o
documento padrão, o par `UseDefaultFiles` e depois `UseStaticFiles` é
necessário:

```csharp
app.UseDefaultFiles();   // reescreve "/" para "/index.html"
app.UseStaticFiles();    // serve do disco
app.MapStaticAssets();   // tudo o que o build conhecia
```

Com isso, `GET /` devolveu o `index.html` e `GET /late.txt` devolveu `200` do
disco, e `GET /app.css` continuou vindo do endpoint do manifest, com o ETag do
build e o gzip, então o middleware não assumiu um arquivo que o endpoint do
manifest já controlava. A qualidade difere: segundo a documentação, a compressão
e o fingerprint de build não estão disponíveis para o file middleware, e o ETag
dele tinha outro aspecto (`"1dd5cddcb573234"`) em relação ao hash de conteúdo dos
endpoints do manifest.

Um ajuste relacionado: a documentação diz que o `MapStaticAssets` carrega os
metadados do manifest de forma antecipada, o que custa memória, e para mil assets
ou mais ela recomenda um bundler, ou excluir uma pasta com a propriedade MSBuild
`StaticWebAssetEndpointExclusionPattern` e deixar o `UseStaticFiles` servi-la.

### Posição no pipeline e short-circuit

O `UseStaticFiles` é middleware, então fica no pipeline onde você o colocar; o
`MapStaticAssets` é um endpoint, então o pipeline inteiro ao redor dele roda
primeiro. Um pequeno logger de requisições colocado antes da chamada mostrou isso:

```text
requisições: GET /app.css, GET /api/hello
logger viu (padrão):                  /app.css  /api/hello
logger viu (MapStaticAssets().ShortCircuit()):  /api/hello
```

O `ShortCircuit()` no builder retornado (documentado exatamente para isso) faz a
resposta do asset pular o resto dos middlewares. Ele também pula coisas que você
pode querer, como uma etapa de autenticação ou de CORS, então use só quando os
arquivos estáticos realmente não precisam de nenhuma.

### Referenciando o nome com fingerprint

O fingerprint só ajuda se a página aponta para a URL com hash. A documentação diz
que o framework guarda o mapa de arquivo físico para fingerprint e o usa para
achar assets gerados (CSS com escopo do Blazor, arquivos citados em import maps de
JS) e para gerar links de preload. Em UIs baseadas em Razor, o template faz essa
ligação por você. Um HTML escrito à mão não tem essa ajuda: ele aponta para
`app.css`, o que funciona, mas ganha a revalidação `no-cache` e não o cache de um
ano.

As release notes acrescentam um detalhe do .NET 10: o script do Blazor agora é
servido como static web asset com compressão e fingerprint automáticos, quando
antes vinha de um recurso embutido no shared framework.

## Trade-offs

- **O manifest é um retrato do build.** O que não está nele não é servido, e um
  deploy que copia arquivos para o `wwwroot` à mão os perde.
  ```csharp
  app.UseStaticFiles();   // só para arquivos que o build não conhecia
  ```
- **Pré-compressão troca disco e memória por CPU.** O publish guarda três cópias
  de cada asset de texto; para arquivos raramente pedidos, os metadados em
  memória podem não compensar.
- **Cache longo exige a URL com hash.** Apontar para o nome simples mantém a
  revalidação a cada carga, seguro porém mais lento; apontar à mão para um nome
  com fingerprint fica velho quando o hash muda.
- **Dois mecanismos, dois comportamentos.** ETags, compressão e headers diferem
  entre o manifest e o file middleware, então teste a URL que você entrega.
- **Short-circuit é um ganho com custo.** Pular o pipeline também pula
  middlewares que adicionam headers de segurança ou registram requisições.

## Documentation Links

- [Serve static files in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Response compression in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/response-compression) (doc)
- [ASP.NET Core Blazor static files, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/static-files) (doc)
- [Cache-Control header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) (doc)
