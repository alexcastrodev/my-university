---
version: 1.0
updatedAt: 2026-09-21
question: O string? muda alguma coisa em tempo de execução?
---
## Question

# O `string?` muda alguma coisa em tempo de execução?

## Short Answer

Não. Para tipos por referência, `string?` e `string` são o **mesmo tipo em tempo de execução**, `System.String`. O `?` é uma anotação para a análise estática do compilador, guardada como atributos de metadados. Nada impede que um `null` chegue a um parâmetro `string` em tempo de execução.

## What It Is

Os nullable reference types (habilitados por padrão em projetos novos desde o .NET 6, via `<Nullable>enable</Nullable>`) permitem declarar intenção: `string` significa "nunca deveria ser null", `string?` significa "pode ser null". O compilador então rastreia o estado de nulidade de cada variável pelo seu código e avisa quando você acessa algo que pode ser null, ou atribui `null` a algo não anulável.

O resultado é compilado em atributos `[Nullable]` e `[NullableContext]`, para que outros assemblies consigam ler suas anotações. Mas os tipos no IL não mudam.

## The Contrast with `int?`

É fácil confundir, porque a sintaxe é idêntica:

- `int?` é **`Nullable<int>`**, uma struct diferente com uma flag `HasValue`. Ela existe de verdade em tempo de execução.
- `string?` é **só `string`** mais uma dica em tempo de compilação.

Então nullable reference types são avisos, não garantias. Reflection, desserializadores, bibliotecas antigas sem anotações ou o operador `!` (null-forgiving) podem colocar um `null` onde o compilador acha que não existe nenhum.

## Practical Example

```csharp
#nullable enable

string Greet(string name) => $"Hello, {name.ToUpper()}";

string? maybe = null;
Greet(maybe);    // aviso CS8604: possível argumento de referência nula
Greet(maybe!);   // sem aviso, mas NullReferenceException em tempo de execução

// Mesmo tipo em tempo de execução:
string? a = "x";
string b = "y";
Console.WriteLine(a.GetType() == b.GetType());  // True: os dois são System.String

// APIs públicas ainda precisam de checagens em tempo de execução
public void Register(string name)
{
    ArgumentNullException.ThrowIfNull(name); // quem chama pode estar com nullable desabilitado
}
```

## Solution and Conclusion

Trate nullable reference types como um linter poderoso, e deixe-o rigoroso com `<WarningsAsErrors>nullable</WarningsAsErrors>`. Use `!` só quando você sabe algo que o compilador não consegue ver. Nas fronteiras públicas (APIs públicas, entrada desserializada), mantenha checagens reais em tempo de execução, como `ArgumentNullException.ThrowIfNull`.

## References

- [Nullable reference types: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references) (doc)
- [Null-forgiving operator: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-forgiving) (doc)
