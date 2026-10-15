---
version: 1.0
updatedAt: 2026-10-15
title: "Formulários no Blazor: EditForm e Validação"
summary: Model, EditContext e validator em um formulário Blazor, quando cada regra dispara, a validação de objetos aninhados e coleções do .NET 10, erros vindos do servidor, InputBase<T> e a relação com a validação de minimal APIs.
---
## Objective

Um formulário Blazor são três objetos que costumam ser vistos como um só: o
model (sua classe), o `EditContext` (a contabilidade: quais campos mudaram, quais
mensagens existem) e os componentes que leem os dois (`InputText`,
`ValidationMessage`, `DataAnnotationsValidator`). Quando essa separação fica
clara, regras customizadas, erros do servidor e inputs customizados deixam de ser
truques. Este concept roda um formulário em Interactive Server no SDK 10.0.100 e
registra os eventos do `EditContext` para mostrar o que valida quando, depois
acrescenta os três pontos de extensão (`IValidatableObject` e atributos
customizados, um `ValidationMessageStore`, uma subclasse de `InputBase<T>`) e a
mudança do .NET 10 que permite que data annotations validem objetos aninhados e
itens de coleção. Formulários enviados de páginas de static SSR estão em Blazor
Static SSR and Enhanced Navigation, e as mesmas annotations do lado da API estão
em Input Validation in Minimal APIs.

## Use Cases

- Montar um formulário de criação ou edição com mensagens por campo e um resumo.
- Rejeitar um submit por um motivo que só o servidor conhece (um nome de usuário
  já usado).
- Validar um pedido com cliente e lista de itens a partir de um único `EditForm`.
- Escrever um input que interpreta um formato próprio, como `25%`.

## Deep Dive

### Model, `EditContext` e o validator

O `EditForm` precisa de `Model` ou de `EditContext`. Com `Model` ele cria o
contexto para você; com `EditContext` você é o dono e pode assinar seus eventos.
O componente `DataAnnotationsValidator` é o que liga os dois: ele escuta o
contexto e roda os atributos do model. Sem ele, o `EditForm` só rastreia
mudanças e nada valida. Um formulário sobre um model `Signup` (`[Required]`,
`[StringLength(10, MinimumLength = 3)]`, `[Range(18, 120)]` em um `int`,
`[EmailAddress]` e `IValidatableObject`), com log nos eventos do contexto,
produziu isto quando um campo foi editado e depois o formulário foi enviado:

```text
OnFieldChanged Name modified=True
OnValidationStateChanged messages=1      <- os atributos do campo rodaram
...
OnValidationRequested                    <- submit: o model inteiro é validado
OnValidationStateChanged messages=2
invalid submit                           <- OnInvalidSubmit
```

As regras por trás dessa saída, todas vistas na execução:

- Editar um campo valida **só os atributos da propriedade desse campo**. A regra
  de `IValidatableObject.Validate` `admin is reserved.` não apareceu quando `Name`
  virou `admin`. Ela apareceu no submit e em `ctx.Validate()`.
- Um submit dispara `OnValidationRequested`, depois `OnValidSubmit` ou
  `OnInvalidSubmit`. Use `OnSubmit` se quiser chamar `Validate()` você mesmo.
- As classes CSS `modified invalid` e `modified valid` são adicionadas aos
  inputs, então estilizar não exige código.
- Digitar `abc` em um `InputNumber<int>` gerou `The Age field must be a number.`
  do próprio componente de input, não de um atributo, e o model manteve o valor
  antigo. Uma falha de binding também é uma mensagem de validação.

O Blazor confirma o valor no evento `change` (quando o input perde o foco), não a
cada tecla, a menos que você use `@bind-Value:event="oninput"`.

### Objetos aninhados e coleções no .NET 10

Antes do .NET 10, o `DataAnnotationsValidator` validava as propriedades do objeto
do model e parava ali: um `Customer` ou uma `List<OrderItem>` dentro dele não era
visitado. As release notes do ASP.NET Core 10 descrevem o novo comportamento e
três passos para ativá-lo: chamar `AddValidation()` no `Program.cs`, declarar os
tipos do model em um arquivo `.cs` (não em um `.razor`, porque a saída de um
source generator não pode alimentar outro) e colocar `[ValidatableType]` no tipo
raiz. Os outros tipos são descobertos a partir dele.

```csharp
[ValidatableType]
public class Order
{
    public Customer Customer { get; set; } = new();
    public List<OrderItem> Items { get; set; } = [new(), new()];
}
public class Customer { [Required(ErrorMessage = "Email is required.")] public string? Email { get; set; } }
public class OrderItem { [Range(1, 10, ErrorMessage = "Quantity must be 1 to 10.")] public int Quantity { get; set; } }
```

O mesmo formulário, executado duas vezes. Enviando um pedido sem email e com duas
quantidades `0`:

```text
sem AddValidation : result = valid, nenhuma mensagem
com AddValidation : result = invalid
                    Email is required.
                    Quantity must be 1 to 10.
                    Quantity must be 1 to 10.
```

Depois da mudança, corrigir o email do cliente no campo removeu a mensagem dele
na hora e deixou as duas mensagens de quantidade, então os campos aninhados
também validam campo a campo. Adicionar `using Microsoft.Extensions.Validation;`
ao arquivo do model tornou `[ValidatableType]` ambíguo (`CS0104`) no meu projeto,
então deixe esse `using` de fora. As release notes também listam
`[SkipValidation]` para excluir uma propriedade ou tipo, uma implementação gerada
por source generator (mais amigável a trimming e AOT que a reflexão) e a mesma
ordem do `Validator`: primeiro as propriedades (descendo nos objetos aninhados),
depois os atributos de nível de tipo, depois `IValidatableObject`, e os passos
seguintes são pulados se um anterior reportar erro. Para um model em uma
biblioteca ou no projeto `.Client`, as notes dizem para expor um método que chama
`AddValidation` em um `IServiceCollection` e chamá-lo também no app.

### O mesmo motor das minimal APIs

`AddValidation` é o registro usado nas minimal APIs
(`Microsoft.Extensions.Validation`). No mesmo app, uma minimal API que recebia o
mesmo `Order` devolveu isto com `AddValidation` ligado, e `200` com o corpo
inválido quando estava desligado:

```text
HTTP 400  {"errors":{"Customer.Email":["Email is required."],
                     "Items[0].Quantity":["Quantity must be 1 to 10."]}}
```

Então um único conjunto de annotations serve ao formulário e ao endpoint, e as
chaves (`Customer.Email`, `Items[0].Quantity`) são os caminhos que os dois lados
usam para as mensagens. A diferença que vale lembrar: um formulário Blazor
validava as propriedades de nível superior sem `AddValidation`, enquanto uma
minimal API não validava nada sem ele.

### Regras customizadas, erros do servidor e inputs

Três pontos de extensão, todos rodando em uma página `/custom`:

- **Um atributo customizado** derivado de `ValidationAttribute` que devolve um
  `ValidationResult` com `c.MemberName`; `root is banned.` apareceu na mudança do
  campo como qualquer regra nativa.
- **Um `ValidationMessageStore`** para erros que os atributos não têm como saber.
  Depois que o `Save` achou o nome `ana` já usado, o formulário adicionou uma
  mensagem a esse campo e chamou `NotifyValidationStateChanged`:

  ```csharp
  store = new ValidationMessageStore(ctx);
  ctx.OnFieldChanged += (_, e) => { store.Clear(e.FieldIdentifier); ctx.NotifyValidationStateChanged(); };
  // no Save: store.Add(ctx.Field(nameof(Form.UserName)), "ana is already taken.");
  //          ctx.NotifyValidationStateChanged();
  ```

  A mensagem apareceu após o submit e sumiu quando o usuário editou o campo,
  porque o handler limpa as mensagens daquele campo; um store mantém suas
  mensagens até você limpá-las. Enviar `bob` em seguida salvou.
- **Uma subclasse de `InputBase<T>`** para um valor que não é texto simples.
  Sobrescrever `TryParseValueFromString` e `FormatValueAsString` deu um input que
  mostrava `10%` para o inteiro `10`, aceitava `25%` e, para `abc`, reportava
  `The Discount field must look like 50%.`, marcava o input como
  `modified invalid` e deixava o texto digitado na caixa:

  ```csharp
  protected override string? FormatValueAsString(int v) => v + "%";
  protected override bool TryParseValueFromString(string? s, out int result, [NotNullWhen(false)] out string? error)
  {
      if (s is not null && s.EndsWith('%') && int.TryParse(s.AsSpan(0, s.Length - 1), out result)) { error = null; return true; }
      result = default; error = $"The {DisplayName ?? FieldIdentifier.FieldName} field must look like 50%."; return false;
  }
  ```

## Trade-offs

- **`DataAnnotationsValidator` é simples e declarativo, com expressividade
  limitada.** Regras que precisam de I/O (unicidade) ou de vários campos juntos
  pertencem a `IValidatableObject` ou a um message store, não a atributos.
- **Validação aninhada é opt-in com três condições.** Esqueça o
  `[ValidatableType]` ou ponha o model em um `.razor` e nada aninhado é validado,
  sem erro que avise.
  ```csharp
  [ValidatableType]            // só no model raiz do formulário
  public class Order { ... }
  ```
- **Regras de campo e de model disparam em momentos diferentes.** Uma regra que só
  aparece no submit surpreende quem observa a página enquanto digita; mantenha
  poucas regras entre campos.
- **No Interactive Server toda checagem roda no servidor.** Cada mudança de campo
  é uma mensagem pelo circuito, então nenhum erro aparece antes da ida e volta, e
  as regras do formulário não substituem a validação de uma API por trás.
- **Um `InputBase<T>` customizado assume o parsing e a formatação.** É o lugar
  certo para um formato, e a mensagem de erro que você escreve é sua para
  localizar.
- **Um modelo de annotations compartilhado é um acoplamento.** A mesma classe
  validando o formulário e o endpoint evita duplicação, e também faz com que uma
  mudança em um seja mudança no outro.

## Documentation Links

- [ASP.NET Core Blazor forms validation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/validation) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
- [ASP.NET Core Blazor input components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/input-components) (doc)
- [What's new in ASP.NET Core 10, Blazor form validation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
