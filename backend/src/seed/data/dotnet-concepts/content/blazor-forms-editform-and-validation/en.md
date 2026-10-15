---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A Blazor form is three objects that people tend to see as one: the model (your
class), the `EditContext` (the bookkeeping: which fields changed, which messages
exist) and the components that read them (`InputText`, `ValidationMessage`,
`DataAnnotationsValidator`). Once you see that split, custom rules, server-side
errors and custom inputs stop being tricks. This concept runs a form in
Interactive Server on SDK 10.0.100 and logs the `EditContext` events to show what
validates when, then adds the three extension points (`IValidatableObject` and
custom attributes, a `ValidationMessageStore`, an `InputBase<T>` subclass) and
the .NET 10 change that lets data annotations validate nested objects and
collection items. Forms posted from static SSR pages are in Blazor Static SSR and
Enhanced Navigation, and the same annotations on the API side are in Input
Validation in Minimal APIs.

## Use Cases

- Building a create or edit form with field-level messages and a summary.
- Rejecting a submit for a reason only the server knows (a taken user name).
- Validating an order with a customer and a list of items from one `EditForm`.
- Writing an input that parses a custom format, such as `25%`.

## Deep Dive

### Model, `EditContext` and the validator

`EditForm` needs either `Model` or `EditContext`. With `Model` it creates the
context for you; with `EditContext` you own it and can subscribe to it. The
`DataAnnotationsValidator` component is what connects the two: it listens to the
context and runs the attributes on the model. Without it, `EditForm` only tracks
changes and nothing validates. A form on a `Signup` model (`[Required]`,
`[StringLength(10, MinimumLength = 3)]`, `[Range(18, 120)]` on an `int`,
`[EmailAddress]`, and `IValidatableObject`), with a log on the context events,
produced this when a field was edited and then the form was submitted:

```text
OnFieldChanged Name modified=True
OnValidationStateChanged messages=1      <- the field's attributes ran
...
OnValidationRequested                    <- submit: the whole model is validated
OnValidationStateChanged messages=2
invalid submit                           <- OnInvalidSubmit
```

The rules behind that output, all seen in the run:

- Editing a field validates **that field's property attributes** only. The
  `IValidatableObject.Validate` rule `admin is reserved.` did not show when
  `Name` was set to `admin`. It appeared on submit and on `ctx.Validate()`.
- A submit raises `OnValidationRequested`, then `OnValidSubmit` or
  `OnInvalidSubmit`. Use `OnSubmit` instead if you want to call `Validate()`
  yourself.
- `modified invalid` and `modified valid` CSS classes are added to the inputs, so
  styling needs no code.
- Typing `abc` in the `InputNumber<int>` gave `The Age field must be a number.`
  from the input component itself, not from an attribute, and the model kept the
  old value. A binding failure is a validation message too.

Blazor commits the value on the `change` event (when the input loses focus), not
on every keystroke, unless you bind with `@bind-Value:event="oninput"`.

### Nested objects and collections in .NET 10

Before .NET 10, `DataAnnotationsValidator` validated the properties of the model
object and stopped there: a `Customer` or a `List<OrderItem>` inside it was not
visited. The ASP.NET Core 10 release notes describe the new behavior and three
steps to opt in: call `AddValidation()` in `Program.cs`, declare the form model
types in a `.cs` file (not in a `.razor` file, because a source generator's
output cannot feed another generator), and put `[ValidatableType]` on the root
type. The other types are discovered from it.

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

The same form, run twice. Submitting an order with no email and two quantities
of `0`:

```text
without AddValidation : result = valid, no messages
with AddValidation    : result = invalid
                        Email is required.
                        Quantity must be 1 to 10.
                        Quantity must be 1 to 10.
```

After the change, fixing the customer email in the field removed its message at
once and left the two quantity messages, so the nested fields validate per field
as well. Adding `using Microsoft.Extensions.Validation;` to the model file made
`[ValidatableType]` ambiguous (`CS0104`) in my project, so leave that `using` out.
The release notes also list `[SkipValidation]` to exclude a property or type,
a source-generated implementation (friendlier to trimming and AOT than
reflection), and the same ordering as `Validator`: properties first (recursing
into nested objects), then type-level attributes, then `IValidatableObject`, and
the later steps are skipped if an earlier one reports an error. For a model in a
library or the `.Client` project, the notes say to expose a method that calls
`AddValidation` on an `IServiceCollection` and call it from the app too.

### Same engine as minimal APIs

`AddValidation` is the registration used for minimal APIs
(`Microsoft.Extensions.Validation`). In the same app, a minimal API that took the
same `Order` returned this with `AddValidation` on, and `200` with the invalid
body when it was off:

```text
HTTP 400  {"errors":{"Customer.Email":["Email is required."],
                     "Items[0].Quantity":["Quantity must be 1 to 10."]}}
```

So one set of annotations serves the form and the endpoint, and the keys
(`Customer.Email`, `Items[0].Quantity`) are the paths the two sides use for the
messages. The difference worth remembering: a Blazor form validated top-level
properties without `AddValidation`, whereas a minimal API validated nothing
without it.

### Custom rules, server errors and inputs

Three extension points, all run in one `/custom` page:

- **A custom attribute** derived from `ValidationAttribute` returning a
  `ValidationResult` with `c.MemberName`; `root is banned.` appeared on field
  change like any built-in rule.
- **A `ValidationMessageStore`** for errors the attributes cannot know. After
  `Save` found the user name `ana` taken, the form added a message to that field
  and called `NotifyValidationStateChanged`:

  ```csharp
  store = new ValidationMessageStore(ctx);
  ctx.OnFieldChanged += (_, e) => { store.Clear(e.FieldIdentifier); ctx.NotifyValidationStateChanged(); };
  // in Save: store.Add(ctx.Field(nameof(Form.UserName)), "ana is already taken.");
  //          ctx.NotifyValidationStateChanged();
  ```

  The message showed after the submit and disappeared when the user edited the
  field, because the handler clears that field's messages; a store keeps its
  messages until you clear them. Submitting `bob` then saved.
- **An `InputBase<T>` subclass** for a value that is not plain text. Overriding
  `TryParseValueFromString` and `FormatValueAsString` made an input that showed
  `10%` for the integer `10`, accepted `25%`, and for `abc` reported
  `The Discount field must look like 50%.`, marked the input
  `modified invalid`, and left the typed text in the box:

  ```csharp
  protected override string? FormatValueAsString(int v) => v + "%";
  protected override bool TryParseValueFromString(string? s, out int result, [NotNullWhen(false)] out string? error)
  {
      if (s is not null && s.EndsWith('%') && int.TryParse(s.AsSpan(0, s.Length - 1), out result)) { error = null; return true; }
      result = default; error = $"The {DisplayName ?? FieldIdentifier.FieldName} field must look like 50%."; return false;
  }
  ```

## Trade-offs

- **`DataAnnotationsValidator` is simple and declarative, with limited
  expressiveness.** Rules that need I/O (uniqueness) or several fields at once
  belong in `IValidatableObject` or a message store, not in attributes.
- **Nested validation is an opt-in with three conditions.** Forget the
  `[ValidatableType]` or put the model in a `.razor` file and nothing nested is
  validated, with no error to tell you.
  ```csharp
  [ValidatableType]            // on the root form model only
  public class Order { ... }
  ```
- **Field-level and model-level rules fire at different times.** A rule that
  appears only on submit surprises users who watch the page as they type; keep
  cross-field rules few.
- **In Interactive Server every check runs on the server.** Each field change is
  a message over the circuit, so no error appears before the round trip, and the
  form's rules do not replace the validation of an API behind it.
- **A custom `InputBase<T>` takes over parsing and formatting.** It is the right
  place for a format, and an error message you write is yours to localize.
- **A shared annotation model is a coupling.** The same class validating the form
  and the endpoint saves duplication, and it also means a change in one is a
  change in the other.

## Documentation Links

- [ASP.NET Core Blazor forms validation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/validation) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
- [ASP.NET Core Blazor input components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/input-components) (doc)
- [What's new in ASP.NET Core 10, Blazor form validation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
