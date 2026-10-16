---
version: 1.0
updatedAt: 2026-10-15
title: "Scalar, arquivos .http e geração de clientes"
summary: Scalar como UI de referência do documento OpenAPI, arquivos .http com variáveis e ambientes, e geração de um cliente tipado com Kiota, mostrando que o cliente gerado é tão bom quanto o documento.
---
## Objective

Um documento OpenAPI só vale alguma coisa quando algo o consome. Este conceito cobre os três consumidores que você encontra primeiro: uma UI de referência navegável (Scalar), um arquivo de texto com requisições que você pode repetir e versionar (arquivos `.http`) e um cliente tipado gerado (Kiota). O fio condutor é que o documento é o contrato: um documento vago dá uma UI vaga e um cliente vago. Tudo aqui foi executado no SDK 10.0.100, contra uma minimal API pequena com `Microsoft.AspNetCore.OpenApi` 10.0.0, `Scalar.AspNetCore` 2.18.0 e a ferramenta Kiota 1.36.1.

## Use Cases

- Dar a um time de front-end ou a um parceiro uma página para ler e testar a API sem instalar nada.
- Manter no repositório um conjunto de requisições de exemplo, por ambiente, que qualquer desenvolvedor repete.
- Gerar um cliente fortemente tipado para um serviço seu, para que os chamadores parem de escrever URLs e DTOs à mão.
- Descobrir endpoints mal documentados, porque o cliente gerado os expõe como streams sem tipo.

## Deep Dive

### Scalar como UI de referência

O `Microsoft.AspNetCore.OpenApi` produz o documento, mas não traz visualizador. A documentação mostra Swagger UI e Scalar como opções, e a configuração do Scalar são duas linhas ao lado de `MapOpenApi`:

```csharp
builder.Services.AddOpenApi();
var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();            // /openapi/v1.json
    app.MapScalarApiReference(); // /scalar
}
```

O que a aplicação em execução respondeu:

```text
GET /scalar            -> 302, Location: scalar/
GET /scalar/           -> 200 text/html
GET /scalar/scalar.js  -> 200, 4571209 bytes
```

O script inline da página inicializa o Scalar com a fonte `{"title":"v1","url":"openapi/v1.json"}`, então com um único documento ele o encontra sozinho. O bundle é servido pela própria aplicação (um `scalar.js` relativo), não por CDN, o que importa em redes sem internet. A documentação é explícita sobre onde isso pertence: interfaces de OpenAPI (Swagger UI, ReDoc, Scalar) devem ficar habilitadas só em desenvolvimento, para limitar a exposição de informação. O `IsDevelopment()` acima é esse conselho, e cobre também o `MapOpenApi`, caso o documento não deva ser público.

### Arquivos .http: requisições como texto

Um arquivo `.http` é uma lista de requisições em texto puro. O Visual Studio 2022 (17.8 ou superior, segundo a documentação) edita e envia essas requisições; a documentação diz que o formato foi inspirado na extensão REST Client do VS Code e que o editor do Visual Studio não tem alguns recursos dela (histórico de requisições, importação de cURL, prompt variables e outros), então confira o editor que você realmente usa. A sintaxe da documentação, aplicada à API de teste:

```http
@host = http://localhost:5400

### list
GET {{host}}/games
Accept: application/json

### create
POST {{host}}/games
Content-Type: application/json

{ "name": "Shogi", "players": 2 }

### missing game
GET {{host}}/games/99
```

As regras que vale lembrar, todas da documentação: `###` separa requisições; uma linha que começa com `@` define uma variável usada como `{{nome}}`; os headers ficam logo abaixo da linha da requisição, sem linha em branco entre eles; o corpo começa depois de uma linha em branco; `#` e `//` iniciam comentários.

Os ambientes vêm de um arquivo chamado `http-client.env.json`, procurado na pasta do `.http` ou em uma pasta acima:

```json
{
  "$shared": { "HostAddress": "http://localhost:5400" },
  "dev":     { "token": "dev-only" },
  "staging": { "HostAddress": "https://staging.example.com" }
}
```

`$shared` fornece os padrões e um ambiente os sobrescreve (`staging` troca `HostAddress`). Uma variável definida dentro do próprio `.http` vence a do arquivo de ambiente. Segredos não pertencem ao arquivo versionado: a documentação coloca valores específicos do usuário em `http-client.env.json.user` e também suporta provedores de user secrets do ASP.NET Core, Azure Key Vault e DPAPI. Uma requisição pode receber um nome com `# @name login` e sua resposta ser usada depois, por exemplo `{{login.response.body.$.token}}`, mas só depois de você enviar a requisição nomeada uma vez.

Repeti as três requisições acima com `curl` contra a API em execução para conferir o que o arquivo descreve, já que não pude rodar o editor do Visual Studio aqui:

```text
POST /games     -> 201 Created, Location: /games/4
GET /games/99   -> 404, Content-Type: application/problem+json
```

### Gerando um cliente com Kiota

O Kiota é uma ferramenta de linha de comando que gera um cliente a partir de uma descrição OpenAPI. C# é uma das linguagens, junto com Go, Java, PHP, Python, Ruby e TypeScript. Instalada como tool (numa pasta de rascunho aqui, não globalmente):

```text
dotnet tool install Microsoft.OpenApi.Kiota --tool-path ./tools
./tools/kiota generate -l CSharp -d v1.json -o Client -c GamesClient -n Games.Client
```

Para três operações ele escreveu cinco arquivos (431 linhas na primeira execução): `GamesClient`, dois request builders e dois models. O código gerado precisa de pacotes de runtime; `kiota info -l CSharp` listou `Microsoft.Kiota.Bundle` na versão 2.1.2, que traz abstrações, serialização e o adaptador HTTP. O consumidor fica assim:

```csharp
var adapter = new HttpClientRequestAdapter(new AnonymousAuthenticationProvider())
    { BaseUrl = "http://localhost:5400" };
var client = new GamesClient(adapter);

var all = await client.Games.GetAsync();           // List<Game>
var one = await client.Games[2].GetAsync();        // Game
var created = await client.Games.PostAsync(new NewGame { Name = "Hex", Players = 2 });
```

```text
list: 1:Chess, 2:Go
one: Go players=2
created: 3 Hex
```

A estrutura de URLs vira um caminho fluente (`Games[2]`), então a árvore de endpoints é descoberta pelo autocomplete.

### O cliente é tão bom quanto o documento

Minha primeira versão de `GET /games/{id}` devolvia `Results.Ok(game)` ou `Results.NotFound()`. O documento declarava então só `200 OK` sem conteúdo, e o Kiota gerou um `GetAsync` que devolve um `Stream` cru. Duas linhas de metadado mudaram o documento e o cliente:

```csharp
.Produces<Game>()
.ProducesProblem(404);
```

O 200 passou a referenciar o schema `Game` e o 404 referenciou `ProblemDetails` como `application/problem+json`. Depois de regenerar, `GetAsync` devolveu `Game`, e o Kiota colocou uma entrada `404` no mapeamento de erros. Chamando um id inexistente:

```text
404 -> ProblemDetails status=404
```

A classe `ProblemDetails` gerada é uma `ApiException`, então o corpo de problema do conceito anterior de ProblemDetails chega como uma exceção tipada. Mais uma observação: o schema listava `id`, `name` e `players` como `required`, mas o model gerado expõe `int? Id` e `string? Name`. Trate as propriedades geradas como anuláveis e valide o que você usa.

### Outros geradores

A documentação do NSwag afirma que, a partir do .NET 9, o ASP.NET Core tem suporte nativo a OpenAPI e o NSwag não vem incluído, mas pode ser adicionado como pacote da comunidade; ele oferece geração de clientes pelo NSwagStudio, pelo pacote `NSwag.CodeGeneration.CSharp`, por linha de comando e por um pacote MSBuild. Não executei NSwag nem Refit aqui, então não afirmo nada sobre a saída deles. A conclusão prática vale igual: todo gerador lê o mesmo documento, então corrija as lacunas no documento, não nos arquivos gerados.

## Trade-offs

- **Uma UI em produção é superfície de ataque.** Ela lista todas as rotas e parâmetros. Mantenha atrás de `IsDevelopment()` ou de autenticação.
  ```csharp
  if (app.Environment.IsDevelopment()) { app.MapScalarApiReference(); }
  ```
- **Arquivos `.http` são texto portável, mas dependem do editor.** A sintaxe só é compartilhada em parte entre editores, e variáveis, ambientes e provedores de segredo variam. Não versione tokens; use o arquivo `.user` ou um provedor de segredos.
- **Clientes gerados derivam.** Regenere no CI a partir do documento versionado, ou cliente e servidor discordam em silêncio. Não edite arquivos gerados à mão.
- **A geração amplifica um contrato fraco.** `Results.Ok(...)` sem tipo gerou um `Stream`. Declare `Produces<T>` e `ProducesProblem`, ou use `TypedResults`, para que o documento diga o que o endpoint devolve.
- **Um cliente gerado é mais uma dependência.** O Kiota exige seus pacotes de runtime e adiciona muitos arquivos. Para duas chamadas a uma API de terceiros, um `HttpClient` tipado do conceito anterior pode dar menos código.

## Documentation Links

- [Use the generated OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/using-openapi-documents) (doc)
- [Use .http files in Visual Studio 2022, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/http-files) (doc)
- [Welcome to Kiota, Microsoft Learn](https://learn.microsoft.com/en-us/openapi/kiota/overview) (doc)
- [Install Kiota, Microsoft Learn](https://learn.microsoft.com/en-us/openapi/kiota/install) (doc)
- [Tutorial: Create a Minimal API with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/min-web-api) (doc)
- [Get started with NSwag and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/getting-started-with-nswag) (doc)
