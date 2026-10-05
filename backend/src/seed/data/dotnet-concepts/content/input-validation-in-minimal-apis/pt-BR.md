---
version: 1.0
updatedAt: 2026-10-05
title: "Validação de Entrada em Minimal APIs"
summary: Data annotations com AddValidation (.NET 10), a resposta 400 com erros por campo, a armadilha de tipos não descobertos e o que anotações não conseguem expressar.
---
## Objective

Tudo o que chega por HTTP é entrada não confiável. Sem uma checagem, um cliente
pode criar um jogo sem nome, com preço negativo ou com um título de dez mil
caracteres, e o dado ruim fica no banco até outra coisa quebrar por causa dele.
O objetivo é declarar as regras de validação uma vez, no tipo da requisição, e
fazer o ASP.NET Core rejeitar requisições inválidas com `400` antes de o seu
handler rodar. A partir do .NET 10, minimal APIs têm suporte embutido para isso,
e ele vem com algumas armadilhas que valem ser conhecidas antes de depender dele.

## Use Cases

- Rejeitar um `POST /games` com nome ausente, nome acima de 50 caracteres ou
  preço fora da faixa permitida, com uma mensagem por campo.
- Validar um parâmetro de query ou de rota (`?page=0`) sem escrever um `if` em
  cada handler.
- Dar ao front end uma lista legível por máquina dos campos que falharam, para
  um formulário destacá-los.
- Manter os handlers livres de ruído de validação, para que lidem só com entrada
  válida.

## Deep Dive

### O bug que motiva isso

Minimal APIs não validam nada por padrão. Esta requisição é aceita e gravada:

```text
POST /games
{ "genreId": 1, "price": 59.99, "releaseDate": "2023-10-20" }   // sem name

HTTP/1.1 201 Created
```

Dá para checar cada propriedade à mão no handler, mas isso se repete em todo
endpoint e em todo campo, e esconde a lógica de verdade.

### Declare as regras com data annotations

Coloque as regras no tipo que modela a requisição. Os atributos ficam em
`System.ComponentModel.DataAnnotations`:

```csharp
public record CreateGameDto(
    [Required][StringLength(50)] string Name,
    [Range(1, 50)] int GenreId,
    [Range(1, 100)] decimal Price,
    DateOnly ReleaseDate);
```

Os mais comuns são `[Required]`, `[StringLength(max)]`, `[Range(min, max)]`,
`[RegularExpression]`, `[EmailAddress]` e `[MinLength]`/`[MaxLength]` para
coleções. O `UpdateGameDto` repete os mesmos atributos: compartilhar um tipo
entre criar e atualizar é tentador, mas os dois divergem assim que um campo
passa a ser somente leitura depois da criação.

### Ligue: `AddValidation`

Atributos num tipo não fazem nada até a validação ser registrada. No .NET 10,
isso é uma linha:

```csharp
builder.Services.AddValidation();
```

A partir daí, o framework valida todo parâmetro de todo handler de minimal API
que tenha atributos de validação, antes de chamar o handler. Uma falha
interrompe com `400 Bad Request` e um corpo de problema de validação que lista
cada campo que falhou:

```json
{
  "title": "One or more validation errors occurred.",
  "errors": {
    "Name": ["The Name field is required."],
    "Price": ["The field Price must be between 1 and 100."]
  }
}
```

Note que as chaves são os nomes das propriedades C# (`Name`), não camelCase, e
que todas as falhas voltam juntas, então um formulário pode marcar todos os
campos ruins de uma vez. Parâmetros também são validados:
`([Range(1, 100)] int page)` rejeita `?page=0` no mesmo formato. O handler nunca
é invocado, então pode assumir que a entrada é válida.

### Uma armadilha silenciosa: tipos que não são descobertos

No .NET 10 a configuração de validação encontra os tipos a validar em tempo de
compilação. Num projeto de teste, um `CreateDto` declarado como tipo
**internal** (um `record` sem modificador `public`, no fim do `Program.cs`)
nunca foi validado. Uma requisição com nome vazio e preço 500 voltou `200 OK`,
enquanto o mesmo record tornado `public` devolveu `400` com os dois erros.
Parâmetros como `[Range] int page` continuaram funcionando, o que torna a falha
fácil de passar despercebida.

A regra prática: mantenha os DTOs de requisição `public` e escreva um teste por
DTO que envia um corpo inválido e espera `400`. Se um tipo precisar ficar
internal, consulte a documentação atual sobre `[ValidatableType]` e sobre como a
descoberta funciona na sua versão.

### O que anotações não conseguem expressar

Data annotations checam o formato de um valor. Elas não conhecem o banco:

- `[Range(1, 50)]` em `GenreId` não prova que o gênero 17 existe. Se não existir,
  o `SaveChangesAsync` lança uma `DbUpdateException` pela foreign key e o
  cliente vê um `500`. Cheque a existência no handler e responda `400` ou `422`
  você mesmo.
- Regras que comparam dois campos (data final depois da inicial) precisam de
  `IValidatableObject` ou de um `ValidationAttribute` customizado.
- Unicidade ("já existe um jogo com esse nome") pertence ao banco, como um
  índice único, com a violação traduzida para `409 Conflict`.

### Mensagens e regras customizadas

Todo atributo aceita um `ErrorMessage`, e uma regra customizada é uma subclasse
pequena:

```csharp
public sealed class NotFutureAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context) =>
        value is DateOnly d && d > DateOnly.FromDateTime(DateTime.UtcNow)
            ? new ValidationResult("Release date cannot be in the future.")
            : ValidationResult.Success;
}
```

## Trade-offs

- **Atributos misturam regras no tipo do contrato.** É compacto e as regras
  ficam visíveis ao lado do campo, mas o DTO passa a conhecer validação. Uma
  biblioteca como o FluentValidation mantém as regras numa classe separada e
  lida melhor com regras condicionais ou entre campos, ao custo de uma
  dependência a mais e de configuração.
- **Um validador que passa não é uma requisição segura.** A validação checa o
  formato e as faixas que você listou. Ela não diz nada sobre autorização,
  existência de linhas relacionadas ou invariantes de negócio, que continuam
  pertencendo ao handler ou ao domínio.
- **Skip silencioso é pior que falha barulhenta.** O caso do tipo internal acima
  devolve `200` com dado ruim e nada nos logs. Testes que verificam `400` para
  um corpo inválido são a única rede de segurança confiável.
- **Regras duplicadas divergem.** Copiar `[StringLength(50)]` do DTO de criação
  para o de atualização são dois lugares para mudar. Se os dois compartilham as
  regras de verdade, extraia uma base comum ou uma constante:
  ```csharp
  public const int NameMaxLength = 50;   // usada pelos dois DTOs e pela configuração do EF
  ```
- **Faixas de decimal são fáceis de errar.** `[Range(1, 100)]` num `decimal`
  compara por meio de uma conversão; para limites fracionários use
  `[Range(typeof(decimal), "0.01", "100")]`. E alinhe o tamanho da coluna do
  banco ao atributo (`[StringLength(50)]` e `HasMaxLength(50)`), ou um dos dois
  está mentindo.

## Documentation Links

- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
- [What's new in ASP.NET Core 10, validation support](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0#validation-support-in-minimal-apis) (doc)
- [System.ComponentModel.DataAnnotations namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.dataannotations) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [FluentValidation documentation](https://docs.fluentvalidation.net/) (doc)
