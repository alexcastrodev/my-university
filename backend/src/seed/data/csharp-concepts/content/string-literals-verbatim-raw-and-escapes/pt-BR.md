---
version: 1.0
updatedAt: 2026-10-15
title: "Literais de String: Verbatim, Raw e Escapes"
summary: As quatro formas de escrever uma string em C# (regular, verbatim, raw e UTF-8), as regras de indentação e de contagem de chaves dos raw literals, e onde a interpolação é permitida.
---
## Objective

O C# tem quatro formas de escrever a mesma string: um literal regular com
sequências de escape, um literal verbatim (`@"..."`), um raw string literal
(`"""..."""`, C# 11) e um literal UTF-8 (`"..."u8`). Cada uma resolve uma dor
diferente: escapar barras invertidas, embutir aspas, escrever JSON ou SQL de
várias linhas sem ruído e produzir bytes sem chamar um encoding. A interpolação
(`$`) combina com as três primeiras. Este conceito explica as regras de cada
forma como o compilador as aplica: como os raw literals removem a indentação,
como o `$$` conta chaves, o que um literal `u8` realmente é e onde a
interpolação é permitida em constantes.

## Use Cases

- Embutir um trecho de JSON, SQL ou HTML no código ou em um teste sem escapar
  cada aspa.
- Escrever caminhos do Windows e expressões regulares sem barras dobradas.
- Produzir um template JSON que contém chaves literais e alguns placeholders.
- Passar uma sequência constante de bytes para uma API que espera
  `ReadOnlySpan<byte>` (um header de protocolo, um magic number) sem alocar.

## Deep Dive

### Literais regulares e sequências de escape

Um literal regular usa a barra invertida para iniciar uma sequência de escape.
As mais comuns são `\n`, `\t`, `\"`, `\\` e `\0`, mais as formas Unicode
`\uXXXX`, `\UXXXXXXXX` (necessária para caracteres fora do BMP, como um emoji) e
a `\x` de tamanho variável. O C# 13 adicionou `\e` para o caractere ESC
(U+001B), útil para cores ANSI em terminal.

```csharp
Console.WriteLine("tab[\t] quote[\"] backslash[\\] unicode[\u00e9 \U0001F600]");
// tab[	] quote["] backslash[\] unicode[é 😀]
Console.WriteLine((int)'\e');   // 27 (C# 13 ou posterior)
```

Em um projeto cuja linguagem padrão é o C# 12 (alvo `net8.0`), `\e` falha com
`CS9202: Feature 'string escape character' is not available in C# 12.0`. Evite
`\x` seguido de dígitos hexadecimais em strings: ele consome até quatro dígitos,
então `"\x41BC"` é um único caractere (testado: `Length` 1), e não `A` seguido de
`BC`. Prefira `\u` com exatamente quatro dígitos (`"\u0041BC"` tem `Length` 3).

### Literais verbatim

Com o prefixo `@` o compilador para de processar escapes: a barra invertida é uma
barra invertida, e a string pode ocupar várias linhas. A única sequência
especial que sobra é a aspa dobrada `""` para uma aspa literal.

```csharp
string path = @"C:\temp\new";             // C:\temp\new
string q = @"He said ""hi""";             // He said "hi"
string multi = @"line1
  line2";                                 // a quebra de linha e os 2 espaços são mantidos
```

O espaço em branco faz parte do valor, então strings verbatim de várias linhas
obrigam você a quebrar a indentação do código. Com interpolação, tanto
`$@"..."` quanto `@$"..."` são aceitos, e em uma string verbatim interpolada
`{{` e `}}` são os escapes para chaves literais.

### Raw string literals (C# 11)

Um raw literal começa e termina com pelo menos três aspas duplas. Nada dentro é
sequência de escape, `\n` continua sendo dois caracteres e aspas não precisam de
escape. Quatro regras valem a pena e cada uma é um erro de compilação real:

1. Um raw literal de várias linhas precisa ter as aspas de abertura seguidas de
   uma quebra de linha e as aspas de fechamento sozinhas em uma linha própria
   (senão `CS9000`).
2. O espaço em branco antes das aspas de fechamento é removido de todas as
   linhas de conteúdo. Uma linha que não começa com esse mesmo espaço é erro
   (`CS8999`), e misturar tabs e espaços entre a linha de fechamento e uma linha
   de conteúdo também é erro (`CS9003`).
3. A primeira quebra de linha depois das aspas de abertura e a última antes das
   de fechamento não fazem parte do valor.
4. Se o conteúdo tem uma sequência de aspas, abra e feche com uma sequência
   maior.

```csharp
string json = """
    {
      "name": "Ana",
      "quote": "say "hi" now"
    }
    """;
// os 4 espaços antes do """ de fechamento são removidos:
// {
//   "name": "Ana",
//   "quote": "say "hi" now"
// }

string hasTriple = """"
    contains """ three quotes
    """";                       // contains """ three quotes

string deeper = """
        keep 4 extra
    base
    """;                        // "....keep.4.extra" e depois "base" (pontos são espaços)
```

A linha de fechamento define a linha de base: uma linha de conteúdo mais
indentada que o `"""` de fechamento mantém os espaços extras no valor, e é assim
que você preserva uma indentação proposital. Um raw literal de uma linha como
`"""a "quoted" word"""` não tem regras de quebra de linha. Barras invertidas não
são especiais: `"""C:\temp"""` é exatamente `C:\temp`.

### Raw literals interpolados e a contagem de cifrões

Em `$"""..."""` um par de chaves é um buraco, como em uma string interpolada
normal, então chaves literais viram problema para JSON. A solução é usar mais
`$`: com `$$`, o buraco é escrito `{{expr}}` e uma `{` simples é texto; com `$$$`
o buraco é `{{{expr}}}`, e assim por diante. Uma sequência de chaves maior que o
delimitador do buraco é erro (`CS9006`, "does not start with enough '$'
characters").

```csharp
string name = "Ana"; int id = 7;
string b = $$"""
    { "name": "{{name}}", "id": {{id}}, "tpl": "{x}" }
    """;
// { "name": "Ana", "id": 7, "tpl": "{x}" }
```

Escolha a quantidade de cifrões de modo que as chaves do conteúdo sejam mais
curtas que o delimitador do buraco.

### Literais UTF-8 (C# 11)

Um literal `"..."u8` não é uma `string`. É um `ReadOnlySpan<byte>` sobre bytes
guardados na seção de dados do assembly, já codificados em UTF-8, então não há
chamada de encoding nem alocação.

```csharp
ReadOnlySpan<byte> bytes = "héllo"u8;
Console.WriteLine(bytes.Length);                 // 6 (o é ocupa 2 bytes)
Console.WriteLine(Convert.ToHexString(bytes));   // 68C3A96C6C6F
byte[] arr = "abc"u8.ToArray();                  // 3, só aqui aloca
var x = "abc"u8;                                 // x é ReadOnlySpan<byte>
```

Por ser um span, valem os limites de span: `class C { ReadOnlySpan<byte> F = "a"u8; }`
falha com `CS8345` (um span não pode ser campo de uma classe comum). Use uma
propriedade `static ReadOnlySpan<byte> Header => "a"u8;`, que é também como
bibliotecas expõem tabelas constantes de bytes sem alocar. O sufixo funciona em
literais regulares, verbatim e raw, mas não em interpolados (testado: erro de
sintaxe).

### Quebras de linha em buracos, constantes e finais de linha

Desde o C# 11 um buraco pode conter quebras de linha, então uma expressão longa
pode ser formatada em várias linhas. É só sintaxe: o resultado é o mesmo de
escrever em uma linha.

```csharp
Console.WriteLine($"sum = {
    a +
    b
}");                       // sum = 7
```

Desde o C# 10 uma string interpolada pode ser `const` quando todo buraco é
também uma string constante: `const string Full = $"{Name}-v1";` compila,
enquanto um buraco com um `const int` não (`CS0133`). Por fim, as quebras de
linha dentro de literais verbatim e raw vêm do arquivo-fonte. Em um experimento
com o mesmo código, um arquivo com final de linha LF gerou strings sem `\r`, e
depois de converter o arquivo para CRLF tanto o literal verbatim quanto o raw
continham `\r`. Se os bytes exatos importam (hashes, snapshots), normalize com
`.ReplaceLineEndings()`.

## Trade-offs

- **Literais verbatim quebram a sua indentação.** Todo espaço em uma linha de
  continuação vira parte da string, então texto verbatim de várias linhas
  costuma ficar colado à esquerda no código. Um raw literal resolve isso, ao
  custo de exigir C# 11.
- **Raw literals concentram o significado na linha de fechamento.** O sentido de
  cada linha de conteúdo depende do `"""` final. Um copiar e colar que muda o
  espaço da linha de fechamento ou não compila ou desloca a indentação sem
  avisar.
  ```csharp
  string s = """
      a
    b      // CS8999: a linha não começa com o espaço da linha de fechamento
      """;
  ```
- **`$$` desloca o problema em vez de eliminá-lo.** Um template que mistura
  conteúdo com `{` e buracos precisa da contagem certa de cifrões, e uma edição
  posterior que adiciona uma sequência `{{` ao conteúdo pode quebrar a
  compilação (`CS9006`). Mantenha templates pequenos ou mova-os para um arquivo.
- **`u8` é rápido, mas restrito.** O span não pode ser guardado em campo,
  capturado por lambda nem usado através de `await`. Use uma propriedade
  `static ReadOnlySpan<byte>`, ou chame `.ToArray()` uma vez em um
  `static readonly byte[]` quando precisar guardá-lo.
- **Escapes são a forma mais portável.** Um literal regular com `\n` funciona em
  toda versão da linguagem, enquanto `\e`, raw literals e `u8` exigem C# 13, 11
  e 11. Em uma biblioteca que mira compiladores antigos, confira a versão da
  linguagem primeiro.

## Documentation Links

- [Strings, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/strings/) (doc)
- [Built-in reference types: string literals, raw string literals and UTF-8 literals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types) (doc)
- [Raw string literals, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/raw-string) (doc)
- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [What's new in C# 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-11) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
