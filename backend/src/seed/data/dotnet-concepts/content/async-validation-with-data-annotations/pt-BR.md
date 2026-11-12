---
version: 1.0
updatedAt: 2026-11-12
title: "Validação Assíncrona com Data Annotations"
summary: AsyncValidationAttribute e IAsyncValidatableObject nas Minimal APIs do .NET 11, para regras que consultam banco ou serviço, com a ordem em que as regras rodam, o ProblemDetails gerado, o cancelamento pelo token da requisição e o que ficou de fora porque não foi executado.
---
## Objective

"Este e-mail já está cadastrado" é a regra de validação que mais se pede primeiro, e até o .NET 10 ela não podia ser escrita como data annotation, porque um `ValidationAttribute` é síncrono e uma chamada ao banco não é. Ou você bloqueava uma thread na consulta, ou tirava a regra do atributo e a colocava no handler. O ASP.NET Core 11 acrescenta dois tipos que resolvem isso: `AsyncValidationAttribute` para uma regra sobre uma propriedade, e `IAsyncValidatableObject` para uma regra sobre o objeto inteiro. A validação das Minimal APIs que você já ligou com `AddValidation()` executa os dois, espera por eles, entrega o token de cancelamento da requisição e transforma as falhas no mesmo `400 application/problem+json` de qualquer outra regra.

Este concept mostra como esses dois tipos se parecem, em que ordem as regras rodam, como é a resposta e o que acontece quando o cliente vai embora. Todo comportamento abaixo foi executado no SDK 11.0.100 com um teste de `WebApplicationFactory`.

## Use Cases

- Rejeitar um cadastro cujo e-mail já existe, com a mensagem no campo `Email`.
- Checar que uma linha referenciada existe (um gênero, um código de cupom, um tenant) e responder `400` com erro de campo em vez de um `500` vindo de uma chave estrangeira.
- Uma regra entre campos que precisa de dados de um serviço: uma reserva cujas datas não podem se sobrepor a outra.
- Uma regra que chama um serviço externo, em que a chamada deve parar se o cliente desistir.

## Deep Dive

### O que faltava

O concept de validação de entrada termina com uma lista do que anotações não conseguem expressar: existência no banco e unicidade. O `ValidationAttribute.IsValid` síncrono não tem `async`, então uma regra que precisava de `await` tinha duas opções ruins. Chamar `.Result` bloqueia uma thread do pool durante toda a consulta. Checar no handler divide as regras em dois lugares, e a resposta do handler costuma ser um `400` montado à mão que não se parece com o do framework.

### Uma regra sobre uma propriedade: `AsyncValidationAttribute`

Derive de `AsyncValidationAttribute` e sobrescreva `IsValidAsync`. Ele recebe o valor, o `ValidationContext` e um `CancellationToken`:

```csharp
public sealed class UniqueEmailAttribute : AsyncValidationAttribute
{
    // abstrato na classe base, então precisa existir
    protected override ValidationResult? IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException("The async path is the one that runs.");

    protected override async Task<ValidationResult?> IsValidAsync(
        object? value, ValidationContext validationContext, CancellationToken cancellationToken)
    {
        var repository = validationContext.GetRequiredService<IUserRepository>();
        var exists = await repository.EmailExistsAsync((string)value!, cancellationToken);
        return exists
            ? new ValidationResult("Email already registered.", [validationContext.MemberName ?? "Email"])
            : ValidationResult.Success;
    }
}
```

Três coisas nesse código merecem atenção.

**O método síncrono é obrigatório.** `IsValid` é abstrato em `AsyncValidationAttribute`, então a classe não compila sem ele. No projeto de teste ele lançava `NotSupportedException` e nunca foi chamado pela Minimal API, nem para uma requisição válida nem para uma inválida. Lançar é um jeito de descobrir se você algum dia estiver errado sobre isso. Se o mesmo atributo também for usado por código que chama `Validator.TryValidateObject` (validação de data annotations comum, fora da Minimal API), um `IsValid` que lança vira uma falha em tempo de execução ali, então implemente de verdade nesse caso.

**Os serviços vêm do contexto.** Um atributo é criado pelo compilador a partir da sintaxe de atributo, então não há injeção no construtor. `validationContext.GetRequiredService<T>()` resolve a partir do service provider da requisição. O repositório é um serviço normal, então um `DbContext` com escopo por trás dele também funciona.

**Informe o membro.** O segundo argumento de `ValidationResult` é a lista de nomes de membros, e ele decide a chave em `errors`. Sem ele a mensagem não fica ligada a um campo. `validationContext.MemberName` é a propriedade em que o atributo está.

Usar é igual a qualquer outra anotação:

```csharp
public record Registration(
    [property: Required] string Name,
    [property: EmailAddress, UniqueEmail] string Email);

builder.Services.AddValidation();
builder.Services.AddSingleton<IUserRepository, InMemoryUserRepository>();

app.MapPost("/users", (Registration registration) =>
    TypedResults.Created("/users/1", registration));
```

O mesmo atributo também funciona em um parâmetro do handler. `([UniqueEmail] string email)` num `MapGet` rejeitou `?email=taken@x.com` com a chave `email` em minúsculas, porque para parâmetros a chave é o nome do parâmetro e para propriedades é o nome da propriedade.

### Uma regra sobre o objeto inteiro: `IAsyncValidatableObject`

Quando a regra envolve vários campos, implemente `IAsyncValidatableObject` no tipo. O `ValidateAsync` devolve um `IAsyncEnumerable<ValidationResult>`, então você pode dar `yield return` em cada problema que encontrar:

```csharp
public record Order(DateOnly Start, DateOnly End, [property: Range(1, 10)] int Quantity)
    : IAsyncValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext) =>
        throw new NotSupportedException("The async path is the one that runs.");

    public async IAsyncEnumerable<ValidationResult> ValidateAsync(
        ValidationContext validationContext,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // faça await de um serviço aqui: checagem de sobreposição, consulta de calendário
        if (End < Start)
        {
            yield return new ValidationResult("End must be after Start.", [nameof(End)]);
        }
    }
}
```

A interface herda `IValidatableObject`, então o `Validate` síncrono também precisa existir aqui, e também não foi chamado. O atributo `[EnumeratorCancellation]` é o que deixa o token chegar ao iterador quando quem chama o fornece. A requisição `{"Start":"2026-12-10","End":"2026-12-01","Quantity":1}` devolveu:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": { "End": ["End must be after Start."] },
  "traceId": "00-a6f815e56c8d1798e997afc5b2e77992-3fd383f64ca9c04b-02"
}
```

### A ordem em que as regras rodam

A ordem é a parte menos óbvia, e é o motivo para escrever os testes. Estes são os casos medidos com um repositório que conta suas chamadas:

| Requisição | O que rodou | Resultado |
|---|---|---|
| `Name` vazio, `Email` já usado | `[Required]` e `UniqueEmail` rodaram (propriedades diferentes) | `errors` tem `Name` e `Email` |
| `Email` é `not-an-email` | `[EmailAddress]` falhou, `UniqueEmail` não rodou, 0 chamadas ao repositório | `errors` só tem a mensagem de formato |
| `Quantity` 0 e `End` antes de `Start` | a regra da propriedade falhou, `ValidateAsync` não rodou | `errors` só tem `Quantity` |
| `Quantity` 1 e `End` antes de `Start` | as regras de propriedade passaram, `ValidateAsync` rodou | `errors` tem `End` |

Duas regras saem disso. Numa mesma propriedade, os atributos síncronos rodam primeiro e uma falha impede o assíncrono, então um e-mail malformado nunca chega ao banco. Entre propriedades as regras são independentes e todas as falhas vêm juntas, que é o que um formulário precisa. A regra do objeto só roda quando as regras das propriedades passaram, o mesmo formato do `IValidatableObject` no mundo síncrono. Ponha as checagens baratas em atributos síncronos e guarde os assíncronos para o que realmente precisa de I/O: a ordem faz das baratas um filtro de graça.

### A resposta é o ProblemDetails que você já tem

Uma regra assíncrona que falha volta como `400` com `application/problem+json`, com os nomes dos campos como chaves em `errors`, usando o nome da propriedade em C# (`Email`, não `email`) para propriedades. O formato não mudou: um cliente que já trata o `400` síncrono trata este. No projeto usado aqui isso exige `AddProblemDetails()`, como no concept de problem details; o `type`, o `title` e o `traceId` do exemplo acima vêm dele.

O handler não roda. É a mesma garantia da validação síncrona, e é por isso que a regra assíncrona é uma casa melhor para "já existe" do que o handler: o handler pode assumir que a entrada é válida.

### Cancelamento: o token é o da requisição

O token passado a `IsValidAsync` e `ValidateAsync` é cancelado quando o cliente desconecta. No teste, uma requisição para uma regra que espera 1,5 segundo na chamada ao repositório foi abortada pelo cliente após 200 ms, e o repositório viu `OperationCanceledException` e registrou `canceled` em vez de terminar. Se a regra passa `CancellationToken.None` (ou esquece o parâmetro e chama uma sobrecarga sem ele), a consulta roda até o fim para um cliente que já foi embora. Para uma consulta barata e indexada isso não importa. Para uma chamada lenta a outro serviço importa, e é uma linha a conferir em toda regra assíncrona.

### O que não está coberto

As notas de versão descrevem APIs assíncronas equivalentes para formulários Blazor no `EditContext`. Na auditoria que sustenta esta página elas só compilaram, e nada as exercitou em um navegador, então esta página não diz nada sobre o comportamento delas. O mesmo vale para a validação assíncrona de options (`IAsyncValidateOptions<T>`): um teste no GA 11.0.100 não a disparou, então ela ficou de fora de propósito. As duas são funcionalidades para testar no seu projeto antes de depender delas. O concept de formulários Blazor cobre o lado síncrono do `EditForm`.

## Trade-offs

- **Uma chamada ao banco dentro da validação roda em toda requisição.** Uma regra que consulta em todo POST transforma cada requisição em uma busca, inclusive as que falhariam mais tarde de qualquer jeito. Os atributos síncronos da mesma propriedade filtram valores malformados antes, mas um e-mail com cara de válido ainda paga uma consulta. Mantenha a regra assíncrona para o que é barato e indexado.
- **É uma checagem, não uma garantia.** Entre a consulta da validação e o `INSERT`, outra requisição pode tomar o e-mail. O índice único no banco continua sendo a regra de verdade: mantenha-o e traduza a violação para `409 Conflict`. O atributo assíncrono dá ao caso comum um `400` limpo com mensagem no campo, não a correção.
- **O método síncrono é código morto que você precisa escrever.** `IsValid` e `Validate` precisam existir e nunca são chamados pela Minimal API. Lançar torna isso visível, mas também significa que o tipo quebra em código que usa o validador síncrono. Decida uma vez quais caminhos de código validam seus tipos.
- **I/O escondido em uma anotação.** Um atributo num DTO que abre uma conexão passa despercebido ao ler o tipo. Um nome como `UniqueEmail` é uma pista; um comentário é barato. Mantenha o I/O atrás de um serviço e o atributo fino.
- **Uma API nova e ainda jovem.** Ela chegou durante as previews do .NET 11 e não existe no .NET 10. Bibliotecas como o FluentValidation têm regras assíncronas há anos e mantêm as regras fora do DTO; a versão embutida é o passo menor se você já usa anotações.
- **Os testes carregam o contrato.** A ordem das regras e o comportamento do cancelamento não estão nas assinaturas dos tipos. Um teste por regra que posta um valor ruim e confere o `400`, mais um para o cancelamento, é o que mantém isso verdadeiro entre atualizações.

## Lab

Neste lab você recebe uma API com os tipos `Registration` e `Order` e um repositório em memória, mas a validação está desligada e as duas regras assíncronas estão vazias. Você liga a validação, escreve o `UniqueEmailAttribute` contra o repositório e escreve a regra do objeto, e depois lê os testes que mostram a ordem das regras e o cancelamento. O lab usa `net11.0` e precisa do SDK 11. Sem Docker e sem banco de dados.

**O cenário**

Os testes rodam a API em memória com `WebApplicationFactory<Program>` e trocam o repositório por um falso que conta chamadas e registra se uma consulta lenta foi cancelada.

- `Program.cs`: `POST /users` e `POST /orders`.
- `Models.cs`: `Registration` e `Order` (o `IAsyncValidatableObject`).
- `UniqueEmailAttribute.cs`: o `AsyncValidationAttribute`.
- `IUserRepository.cs`: a interface e a implementação em memória.

**O que você vai fazer, passo a passo**

1. **Ligue a validação (TODO-00).** Registre os serviços de validação. Até lá toda requisição inválida é aceita.
2. **Escreva a regra da propriedade (TODO-01).** Em `IsValidAsync`, obtenha o `IUserRepository` do contexto, chame-o com o token e devolva um `ValidationResult` no membro `Email`.
3. **Escreva a regra do objeto (TODO-02).** Em `Order.ValidateAsync`, dê `yield return` num resultado em `End` quando ele for anterior a `Start`.

**Como você sabe que terminou**

`dotnet test` fica verde, e você consegue explicar por que um e-mail malformado não faz nenhuma chamada ao repositório, por que `Quantity = 0` esconde o erro de `End` e por que os métodos síncronos que lançam nunca são alcançados.

**Desafios opcionais**

- **TODO-03:** passe `CancellationToken.None` no atributo e veja qual teste falha.
- **TODO-04:** escreva no console em `IsValid` e `Validate` e confirme que nunca são chamados.

**Pré-requisitos:** Minimal APIs, data annotations, `async`/`await` e o SDK 11.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O starter compila e os testes dos TODOs falham até você completá-los.

## Documentation Links

- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11.0) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
- [AsyncValidationAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.dataannotations.asyncvalidationattribute) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
