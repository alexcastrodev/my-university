---
version: 1.0
updatedAt: 2026-10-15
title: "Geração de Documentos OpenAPI no ASP.NET Core 10"
summary: AddOpenApi e MapOpenApi, OpenAPI 3.1 por padrão no .NET 10, comentários XML e Description nos Produces, transformers, múltiplos documentos e geração em build, com a saída real do gerador.
---
## Objective

Um documento OpenAPI é o contrato legível por máquina de uma API HTTP: rotas,
parâmetros, corpos de requisição e resposta, status codes, schemas. Clientes,
UIs de documentação, testes de contrato e geradores de código leem esse
documento. Desde o .NET 9 o ASP.NET Core gera o documento sozinho, com o pacote
`Microsoft.AspNetCore.OpenApi`, e desde o .NET 10 ele mira OpenAPI 3.1 por
padrão, lê comentários XML e deixa os atributos de resposta carregarem uma
descrição. O objetivo é saber o que o gerador produz a partir do seu código,
quais partes dessa saída você controla e como (atributos, comentários XML,
transformers) e o que muda entre 3.0 e 3.1, usando saída real em vez de
suposição.

## Use Cases

- Publicar `/openapi/v1.json` de uma minimal API para o time de front end gerar
  um cliente tipado em vez de ler o seu código.
- Separar uma aplicação em um documento público e um de admin, cada um só com os
  seus endpoints.
- Versionar o documento gerado no build, para ver mudanças de contrato no diff de
  um pull request ou alimentar um teste de contrato.
- Adicionar o que o framework não infere (título da API, flag de deprecação, um
  campo de extensão) sem mexer em cada endpoint.

## Deep Dive

### O setup mínimo

Duas chamadas: registrar os serviços e mapear o endpoint. Tudo abaixo foi
executado com `Microsoft.AspNetCore.OpenApi` 10.0.12 no SDK 10.0.100.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();          // nome do documento "v1" por padrão
var app = builder.Build();

app.MapOpenApi();                       // GET /openapi/{documentName}.json
app.MapOpenApi("/openapi/{documentName}.yaml"); // opcional: YAML em outra rota
```

`curl localhost:5300/openapi/v1.json` devolve um documento que começa assim:

```json
{ "openapi": "3.1.1", "info": { "title": "api | v1", "version": "1.0.0" }, ... }
```

O título vem do nome do assembly e do nome do documento. A rota YAML serve o
mesmo conteúdo com `openapi: '3.1.1'` na primeira linha. Repare que o
`MapOpenApi` não verifica o ambiente: num processo sem `ASPNETCORE_ENVIRONMENT`
(ou seja, Production) o endpoint respondeu `200`. Os templates envolvem a chamada
em `if (app.Environment.IsDevelopment())`, e essa proteção é decisão sua, não do
framework.

### O que o gerador lê do seu código

O documento nasce dos metadados do endpoint, então quanto mais o handler diz,
menos você anota. Com um handler que retorna `Results<Ok<GameDto>, NotFound>`, o
gerador emitiu as duas respostas sem nenhum atributo:

```csharp
public static Results<Ok<GameDto>, NotFound> GetGame(int id) => ...;
```

```json
"responses": {
  "200": { "description": "OK", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/GameDto" } } } },
  "404": { "description": "Not Found" }
}
```

Um handler que retorna `IResult` esconde tudo isso, que é o caso prático em que
`TypedResults` (conceito anterior) compensa. Para o que os tipos não dizem, use
`WithSummary`, `WithDescription`, `WithTags`, `WithName` (vira o `operationId`)
e `Produces<T>`/`ProducesProblem`. No .NET 10, `[ProducesResponseType]`,
`[Produces]` e `[ProducesDefaultResponseType]` também aceitam `Description`, que
substitui o "OK" genérico:

```csharp
[ProducesResponseType<string>(StatusCodes.Status200OK, Description = "A plain text greeting.")]
```

```json
"200": { "description": "A plain text greeting.", "content": { "text/plain": ... } }
```

As release notes apresentam isso para controllers; nesta execução também
funcionou num handler de minimal API.

### Comentários XML viram documentação

Com `<GenerateDocumentationFile>true</GenerateDocumentationFile>` no arquivo de
projeto, o pacote usa um source generator em build para pegar os comentários XML
e levá-los ao documento. O mapeamento, como observado na saída:

```csharp
/// <summary>Gets a game by id.</summary>
/// <remarks>Returns 404 when the id is unknown.</remarks>
/// <param name="id">The game identifier.</param>
public static Results<Ok<GameDto>, NotFound> GetGame(int id) => ...;

/// <summary>A game in the catalog.</summary>
/// <param name="Price">Price in euros.</param>
public record GameDto(int Id, string Name, decimal Price);
```

```json
"summary": "Gets a game by id.",
"description": "Returns 404 when the id is unknown.",
"parameters": [ { "name": "id", "in": "path", "description": "The game identifier.", ... } ]
...
"GameDto": { "description": "A game in the catalog.", "properties": { "price": { "description": "Price in euros.", ... } } }
```

`<summary>` vira o summary da operação, `<remarks>` a description, `<param>` a
descrição do parâmetro, e os comentários de tipo e de membro viram descrições de
schema (num record posicional, as tags `<param>` documentam as propriedades). A
pegadinha que a documentação cita: o compilador não guarda comentários XML
escritos em lambdas, então um `MapGet("/x", () => ...)` inline não ganha nada.
Mova o handler para um método nomeado e referencie-o, como `GamesApi.GetGame`
acima. Uma lambda ainda aceita `WithSummary` e `WithDescription`.

### Schemas: o que é copiado e o que não é

Data annotations nos DTOs chegam ao schema, com uma armadilha nos records. Num
record posicional, um atributo escrito no parâmetro mira o parâmetro do
construtor, não a propriedade, e o gerador lê propriedades. A primeira execução
com `[Required, StringLength(50)] string Name` gerou um schema sem `maxLength`.
Escrever `[property: StringLength(50)]` resolveu:

```csharp
public record CreateGameDto(
    [property: Required, StringLength(50)] string Name,
    [property: Range(0, 1000)] decimal Price,
    string? Genre);
```

```json
"name":  { "maxLength": 50, "minLength": 0, "type": "string" },
"price": { "maximum": 1000, "minimum": 0, "type": ["number", "string"], "pattern": "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$", "format": "double" },
"genre": { "type": ["null", "string"] }
```

Dois detalhes que valem uma leitura atenta. Os números saem como
`["number", "string"]` com um `pattern` porque os defaults de JSON do ASP.NET
Core aceitam número escrito como string, e o schema descreve o que o servidor
aceita, não só o que ele emite. E `genre` aparece em `required` mesmo sendo
nullable: num record posicional o parâmetro do construtor não tem valor padrão,
então "obrigatório" e "nullable" são fatos separados.

### 3.0 versus 3.1

O OpenAPI 3.1 se alinha ao JSON Schema draft 2020-12, e isso aparece nos casos de
nullable e de união. O mesmo `genre` e o mesmo `price` com
`options.OpenApiVersion = OpenApiSpecVersion.OpenApi3_0`:

```json
"genre": { "type": "string", "nullable": true },
"price": { "anyOf": [ { "type": "number" }, { "type": "string" } ], ... }
```

O cabeçalho do documento virou `3.0.4`. Fique no 3.0 só quando algum consumidor
da sua cadeia não lê 3.1. A atualização também aparece no código dos
transformers: o gerador migrou para `Microsoft.OpenApi` 2.x, onde `OpenApiAny`
deixou de existir e os valores de extensão são `JsonNode`. A documentação diz que
essas mudanças valem mesmo se você ficar no 3.0. Para registrar: a mesma página
diz que o .NET 11 muda o padrão para 3.2, então fixe `OpenApiVersion` se algum
consumidor depende de uma versão.

### Transformers

Quando atributos não bastam, um transformer edita o documento. Há três tipos,
cada um com forma por delegate, por instância e por classe ativada pelo DI:

```csharp
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, context, ct) =>
    {
        document.Info.Title = "Game Store API";
        return Task.CompletedTask;
    });
    options.AddOperationTransformer((operation, context, ct) => { /* por operação */ return Task.CompletedTask; });
    options.AddSchemaTransformer((schema, context, ct) =>
    {
        if (context.JsonTypeInfo.Type == typeof(decimal))
            schema.Description = "Money, two decimal places.";   // todo decimal do documento
        return Task.CompletedTask;
    });
});
```

Segundo a documentação, os schema transformers rodam primeiro (conforme cada
schema é registrado), depois os operation transformers e por último os document
transformers, cada grupo na ordem em que foram adicionados, uma vez por
documento. Para mudar um endpoint só, `AddOpenApiOperationTransformer` prende o
transformer àquele endpoint:

```csharp
games.MapGet("/ping", () => "pong")
     .AddOpenApiOperationTransformer((op, ctx, ct) => { op.Deprecated = true; return Task.CompletedTask; });
// saída: "deprecated": true
```

Os usos reais mais comuns são título e servidores da API, um security scheme
(como `Bearer`) registrado uma vez com um requirement por operação, e uma
resposta de erro compartilhada. No .NET 10 o contexto do transformer oferece
`GetOrCreateSchemaAsync` para construir o schema de um tipo C# e adicioná-lo aos
components do documento.

### Vários documentos e geração em build

`AddOpenApi("admin")` registra um segundo documento, servido em
`/openapi/admin.json`. Qual endpoint vai para qual documento é decidido por
`ShouldInclude`, cujo padrão compara o group name do endpoint com o nome do
documento. Um endpoint com `.WithGroupName("admin")` apareceu só no documento
`admin`; os endpoints sem group name apareceram nos dois:

```text
v1:    /games/{id}  /games  /games/ping  /games/legacy
admin: /admin/games/{id}  /games/{id}  /games  /games/ping  /games/legacy
```

Para gravar os arquivos durante o `dotnet build`, adicione
`Microsoft.Extensions.ApiDescription.Server` (10.0.12 foi restaurado aqui) e, se
quiser, escolha a pasta:

```xml
<PackageReference Include="Microsoft.Extensions.ApiDescription.Server" Version="10.0.12">
  <PrivateAssets>all</PrivateAssets>
</PackageReference>
<PropertyGroup>
  <OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/spec</OpenApiDocumentsDirectory>
</PropertyGroup>
```

O log do build disse `Writing document named 'admin' to .../spec/bt_admin.json`
e gerou `bt.json` para o `v1`: o nome do projeto, mais `_<documento>` quando o
nome não é `v1`. O gerador sobe o ponto de entrada da sua app com um servidor de
mentira, então o código de startup que precisa de banco ou de segredo também
roda. Proteja esse código (a documentação compara
`Assembly.GetEntryAssembly()?.GetName().Name` com `"GetDocument.Insider"`).

## Trade-offs

- **O documento descreve o que o código declara, não o que ele faz.** Um handler
  que retorna `IResult` é documentado como um `200` vazio: sem schema de corpo e
  sem `404`, mesmo que o código possa devolver um.
  ```csharp
  app.MapGet("/g/{id}", (int id) => id == 1 ? Results.Ok(new GameDto(1, "Zelda", 1m)) : Results.NotFound());
  // gerado: "responses": { "200": { "description": "OK" } }
  ```
- **Comentários XML custam uma configuração de build e um método por endpoint.**
  Lambdas ficam sem documentação, então o estilo empurra você para handlers
  nomeados. Em geral é uma boa estrutura de qualquer forma, mas é uma restrição.
- **O 3.1 é a spec melhor, e o padrão pode mudar debaixo de você.** Uma
  ferramenta da sua cadeia pode só entender 3.0, e a documentação diz que o
  padrão muda de novo no .NET 11. Defina `OpenApiVersion` explicitamente quando
  algum consumidor importar.
  ```csharp
  options.OpenApiVersion = OpenApiSpecVersion.OpenApi3_0; // fixe no que seus consumidores leem
  ```
- **Transformers são poderosos e presos à versão da biblioteca.** A migração para
  `Microsoft.OpenApi` 2.x quebrou código de transformer escrito para o .NET 9.
  Mantenha-os pequenos e cobertos por um teste que compara o documento gerado.
- **O schema espelha o serializador, não a sua intenção.** O tratamento de número
  vindo de string, as regras de construtor de record e o `required` seguem o
  comportamento do `System.Text.Json`. Se um gerador de cliente produz
  `string | number` onde você queria `number`, ajuste as opções de JSON ou use um
  schema transformer, não o cliente.
- **A geração em build executa o seu startup.** Sem proteção, ela pode exigir uma
  connection string durante o build numa máquina que não tem nenhuma.
- **Gerar o documento não é cumprir o contrato.** O gerador só documenta. Nada
  confere a API em execução contra o arquivo, então adicione um teste de contrato
  ou compare o documento versionado no CI.

## Lab

Neste lab você recebe uma API de jogos com os endpoints já escritos, mas nenhum documento OpenAPI servido. O seu trabalho é registrar o gerador do pacote `Microsoft.AspNetCore.OpenApi`, servir `/openapi/v1.json` e depois moldar o que há nele com metadados de endpoint, transformers, exclusão e mais de um documento nomeado. A ideia central é sentir que o documento OpenAPI é derivado do código, e que você controla seu conteúdo por metadados e transformers em vez de escrever o JSON à mão.

**O cenário**

Os testes sobem a API em ambiente `Development`, leem o JSON servido com `System.Text.Json.Nodes` e conferem caminhos e propriedades, não o texto inteiro (a saída do gerador muda entre versões).

- `Program.cs`: tudo acontece aqui. Um grupo `/games` com `GET /{id}` (200 com `GameDto` ou 404), `GET /` e `GET /legacy`, mais `GET /internal/health` e `GET /admin/stats` fora do grupo.
- `GameDto.cs`: o record `GameDto(Id, Name, Price)` usado nas respostas.

**O que você vai fazer, passo a passo**

1. **Servir o documento (TODO-00).** Chame `AddOpenApi` (documento "v1") e `MapOpenApi`, para `/openapi/v1.json` responder. O lambda de opções é onde entram os TODO-02 e TODO-06.
2. **Descrever um endpoint (TODO-01).** Em `GET /games/{id}`, use metadados de endpoint para dar o resumo "Gets a game by id", o nome de operação (operationId) "GetGame", a tag "Games" e respostas tipadas: 200 com `GameDto` e 404.
3. **Personalizar o documento (TODO-02).** Adicione um document transformer com título "Game Store API", versão "2.0.0" e um servidor com url "https://api.example.com".
4. **Marcar um só endpoint como obsoleto (TODO-03).** Em `GET /games/legacy`, use um operation transformer anexado ao próprio endpoint, para que só ele fique `deprecated`.
5. **Esconder sem remover (TODO-04).** Tire `/internal/health` do documento, mantendo o endpoint funcionando.
6. **Criar um segundo documento (TODO-05).** Registre um documento chamado "admin" e faça `/admin/stats` aparecer só nele. Lembre que endpoints sem nome de grupo aparecem em todos os documentos.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir abrir `/openapi/v1.json` e `/openapi/admin.json` e explicar de onde vem cada pedaço do JSON, e por que `/games` aparece nos dois documentos enquanto `/admin/stats` aparece só em um.

**Desafios opcionais**

- **TODO-06:** adicione um schema transformer que define a descrição de todo `decimal` como `Money in euros`. Isso habilita o último teste (o de sufixo `_Bonus`).
- **TODO-07:** defina `options.OpenApiVersion` como `OpenApiSpecVersion.OpenApi3_0` e compare como `price` e as propriedades anuláveis são escritos em 3.0 e em 3.1.

**Pré-requisitos:** Minimal APIs e route groups, metadados de endpoint (lab de parameter binding) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo o trabalho fica em `src/OpenApiLab/Program.cs`, onde cada TODO está marcado em comentário ao lado do endpoint que ele afeta; no começo os testes falham porque nenhum documento é servido.

## Documentation Links

- [Generate OpenAPI documents, ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi) (doc)
- [Customize OpenAPI documents, transformers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/customize-openapi) (doc)
- [What's new in ASP.NET Core 10, OpenAPI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0#openapi) (doc)
- [Use the generated OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/using-openapi-documents) (doc)
- [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1.html) (doc)
