---
version: 1.0
updatedAt: 2026-09-16
question: Por que lambdas em um loop for enxergam todas o mesmo valor?
---
## Question

# Por que lambdas em um loop `for` enxergam todas o mesmo valor?

## Short Answer

Porque uma lambda captura a **variável**, não o valor dela. Um loop `for` declara uma única variável `i` para o loop inteiro, então todas as lambdas a compartilham e enxergam seu valor final. Um loop `foreach`, desde o C# 5, declara uma variável nova a cada iteração, então não tem esse problema.

## What It Is

Quando uma lambda usa uma variável local do método que a contém, o compilador move essa variável para uma classe oculta de "closure". O método e a lambda passam a ler e escrever o **mesmo campo** desse objeto. É por isso que uma lambda consegue ver mudanças feitas depois de ter sido criada.

Em `for (int i = 0; i < 3; i++)`, `i` é declarada uma vez, antes da primeira iteração. Existe um objeto de closure, um `i`, e quando as lambdas rodam o loop já terminou e `i` vale `3`.

## A Breaking Change in C# 5

Antes do C# 5, o `foreach` tinha exatamente o mesmo comportamento, e esse era um dos "bugs" mais reportados da linguagem. O time do C# fez uma rara quebra de compatibilidade: no C# 5, a variável de iteração do `foreach` passou a ter **escopo lógico dentro do corpo do loop**, então cada iteração recebe sua própria cópia.

Eles deliberadamente **não** mudaram o `for`, porque a variável dele é visivelmente declarada e atualizada fora do corpo (`i++`), e mudar isso seria ainda mais confuso.

## Practical Example

```csharp
var actions = new List<Action>();

for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));
actions.ForEach(a => a());        // imprime 333

actions.Clear();
foreach (var n in new[] { 0, 1, 2 })
    actions.Add(() => Console.Write(n));
actions.ForEach(a => a());        // imprime 012 (C# 5+)

actions.Clear();
for (int i = 0; i < 3; i++)
{
    int copy = i;                 // uma variável nova por iteração
    actions.Add(() => Console.Write(copy));
}
actions.ForEach(a => a());        // imprime 012
```

## Solution and Conclusion

Quando uma lambda criada dentro de um loop `for` (ou dentro de um `while`, ou antes de um `await`) precisa do valor atual, copie-o para uma variável local declarada **dentro** do corpo do loop. Lembre também que capturas estendem o tempo de vida da variável e alocam um objeto de closure, então use lambdas `static` quando quiser que o compilador garanta que nada está sendo capturado.

## References

- [Lambda expressions: capture of outer variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions#capture-of-outer-variables-and-variable-scope-in-lambda-expressions) (doc)
- [Iteration statements: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) (doc)
