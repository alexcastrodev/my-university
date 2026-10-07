---
version: 1.0
updatedAt: 2026-10-07
question: O que a palavra-chave field faz em uma propriedade?
---
## Question

# O que a palavra-chave `field` faz em uma propriedade?

## Short Answer

Desde o C# 14, `field` dentro de um acessor de propriedade se refere ao **campo de apoio (backing field) que o compilador gera pra você**. Você pode adicionar validação ou efeitos colaterais em um acessor e manter o outro automático, sem declarar um campo privado na mão.

## What It Is

Auto-properties (`{ get; set; }`) são ótimas até você precisar de um pouquinho de lógica, como remover espaços de uma string ou rejeitar `null`. Até o C# 13, essa única linha de lógica te obrigava a abrir mão da auto-property: declarar um campo privado, escrever os dois acessores na mão e manter campo e propriedade sincronizados.

O C# 14 (lançado junto com o .NET 10) adiciona a palavra-chave contextual `field`. Dentro de um acessor `get`, `set` ou `init`, `field` é o campo de apoio sintetizado pelo compilador. Você escreve só o acessor que precisa de lógica, e o outro pode continuar como um simples `get;` ou `set;`.

## Why It Matters

O campo de apoio agora tem **escopo restrito à propriedade**. Nada mais na classe consegue mexer nele por acidente, então a invariante que você colocou no setter não pode ser contornada por um método que escreve direto no campo. Essa é uma garantia que o padrão antigo "campo privado + propriedade" nunca te deu.

Também funciona com inicialização preguiçosa (lazy) e com acessores `init`, e inicializadores continuam funcionando: `= "default"` inicializa o campo sintetizado.

## Practical Example

```csharp
public class Customer
{
    // Antes do C# 14
    private string _name = "";
    public string OldName
    {
        get => _name;
        set => _name = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
    }

    // C# 14
    public string Name
    {
        get;
        set => field = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
    } = "";

    // Inicialização preguiçosa sem campo extra
    public List<string> Tags => field ??= new List<string>();
}
```

## Solution and Conclusion

Use `field` sempre que uma auto-property precisar de um pouco de lógica em um acessor. Uma pegadinha: `field` é uma palavra-chave contextual, então se a sua classe já tem um membro chamado literalmente `field`, dentro de um acessor a palavra-chave vence. Use `this.field` ou `@field` para se referir ao membro. O compilador avisa sobre esse caso.

## References

- [The field keyword: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) (doc)
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
