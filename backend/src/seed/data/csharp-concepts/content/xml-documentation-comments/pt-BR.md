---
version: 1.0
updatedAt: 2026-10-28
title: "Comentários de Documentação XML"
summary: Como GenerateDocumentationFile gera o arquivo XML, os IDs T:, M: e P:, a sintaxe de cref para genéricos, sobrecargas e tipos aninhados, os avisos CS1591, CS1570, CS1572, CS1573, CS1574 e CS1587 com as mensagens reais, inheritdoc e include, records e construtores primários, o XML dentro do pacote NuGet e uma política de build que exige docs sem ruído.
---
## Objective

O compilador lê um comentário `///` como XML, confere nomes de parâmetros e
referências `cref` contra o código e, quando pedido, grava tudo num `.xml` ao
lado da DLL, lido por editores, NuGet, geradores de documentação e pelo OpenAPI
do ASP.NET Core. Este conceito, no .NET 10 / C# 14, liga o arquivo, lê o que o
compilador grava (IDs, `cref`, `inheritdoc`, `include`), provoca os avisos
comuns com as mensagens exatas, cobre records, construtores primários e membros
`required`, empacota uma biblioteca e fecha com uma política de pouco ruído.

## Use Cases

- Uma biblioteca NuGet cujos usuários precisam dos parâmetros nos tooltips.
- Uma classe base ou interface documentada uma vez e reusada via `<inheritdoc/>`.
- Um gate de CI que falha com membro público sem doc ou `<param>` desatualizado.
- Uma web API cujos comentários XML alimentam o OpenAPI, sem afogar em CS1591.

## Deep Dive

### Ligando o arquivo

`GenerateDocumentationFile` vale `false` em um `classlib` novo (`dotnet msbuild
-getProperty` confirma); com `true`, o build grava `<AssemblyName>.xml` ao lado
da DLL em `bin/<config>/net10.0`:

```csharp
/// <summary>Creates a circle.</summary>
/// <param name="radius">The radius; must be positive.</param>
/// <exception cref="ArgumentOutOfRangeException"><paramref name="radius"/> is zero or negative.</exception>
public Circle(double radius) { /* ... */ }      // na classe Circle, namespace Shapes
```

```text
<doc> <assembly> <name>Shapes</name> </assembly> <members>      (excerpt)
<member name="M:Shapes.Circle.#ctor(System.Double)">
    <summary>Creates a circle.</summary>
    <param name="radius">The radius; must be positive.</param>
    <exception cref="T:System.ArgumentOutOfRangeException"><paramref name="radius"/> is zero or negative.</exception>
</member>
```

Cada `name` é uma ID string: prefixo (`T:` tipo, `M:` método ou construtor,
`P:` propriedade; a especificação traz `F:`, `E:` e outros), nome completo e
tipos dos parâmetros. Todo `cref` vira essa forma, e assim as ferramentas ligam
o XML à DLL (a doc lembra que o arquivo não tem informação de tipo própria).

### As tags

| Tag | Para quê |
|---|---|
| `summary`, `remarks` | Descrição curta que o editor mostra primeiro; explicação longa |
| `param`, `typeparam` | Descrevem um parâmetro ou parâmetro de tipo (nomes conferidos) |
| `paramref`, `typeparamref` | Citam um deles no meio do texto (nomes conferidos) |
| `returns`, `value` | O que o método retorna, o que a propriedade guarda |
| `exception` | `cref` de uma exceção que o membro lança, e quando |
| `example`, `code`, `c` | Exemplo de uso; bloco de código; código inline |
| `para`, `list` | Quebra de parágrafo; lista com marcadores, numerada ou tabela |
| `see`, `seealso` | Link inline, entrada de "Veja também" (`cref`, `href` ou `langword`) |
| `inheritdoc`, `include` | Reaproveitar docs de base, interface ou `cref`; de um arquivo XML |

O compilador copia qualquer XML bem formado, inclusive tags inventadas; ele só
confere os nomes em `param`, `paramref`, `typeparam`, `typeparamref` e todo `cref`.

### Sintaxe de cref: genéricos, sobrecargas, tipos aninhados

Parâmetros genéricos vão entre chaves, porque `<` encerraria o atributo XML:

```csharp
/// <see cref="Bag{T}"/> <see cref="List{T}"/> <see cref="Bag{T}.Map{TOut}(Func{T, TOut})"/>
/// <see cref="Bag{T}.Options"/> <see cref="Circle.Radius"/> <see cref="Circle(double)"/>
/// <see cref="Dictionary{TKey, TValue}.TryGetValue"/> <see cref="T:System.String"/>
/// <see cref="Circle.Scale"/> <see cref="Bag{int}"/> <see langword="null"/>
```

```text
T:Shapes.Bag`1   T:System.Collections.Generic.List`1   M:Shapes.Bag`1.Map``1(System.Func{`0,``0})
T:Shapes.Bag`1.Options   P:Shapes.Circle.Radius   M:Shapes.Circle.#ctor(System.Double)
M:System.Collections.Generic.Dictionary`2.TryGetValue(`0,`1@)   T:System.String
warning CS0419: Ambiguous reference in cref attribute: 'Circle.Scale'. Assuming 'Circle.Scale(double)',
  but could have also matched other overloads including 'Circle.Scale(double, double)'.
warning CS1584: XML comment has syntactically incorrect cref attribute 'Bag{int}'
warning CS1658: Type parameter declaration must be an identifier not a type. See also error CS0081.
```

`` `1 `` é a aridade do tipo e `` `0 `` seu primeiro parâmetro de tipo (com
crase dupla, o mesmo para o método), e `@` marca um `ref`/`out`. Um nome sem
parâmetros só funciona com uma única sobrecarga (`TryGetValue`); com duas, o
CS0419 escolhe uma. Escreva `Bag{T}`, não `Bag{int}`. Um prefixo `T:` passa intacto.

### O que o compilador confere

Um arquivo com erros de propósito, compilado duas vezes. Sem a propriedade, o
build não reporta nenhum diagnóstico de documentação, nem mesmo o CS1587. Com
`-p:GenerateDocumentationFile=true`:

```text
CS1591: Missing XML comment for publicly visible type or member 'Undocumented'
CS1570: XML comment has badly formed XML -- 'End tag 'summary' does not match the start tag 'b'.'
CS1572: XML comment has a param tag for 'denom', but there is no parameter by that name
CS1573: Parameter 'denominator' has no matching param tag in the XML comment for 'Holder.Div(int, int)' (but other parameters do)
CS1571: XML comment has a duplicate param tag for 'a'
CS1574: XML comment has cref attribute 'DoesNotExist' that could not be resolved
CS1711: XML comment has a typeparam tag for 'U', but there is no type parameter by that name
CS1587: XML comment is not placed on a valid language element     (/// above a local)
```

Todos são avisos. Um `<paramref>` errado é CS1734 e um parâmetro de tipo sem
doc é CS1712, redigidos como as linhas acima. CS1573 e CS1712 só disparam se
algum parâmetro estiver documentado: um membro sem nenhum `<param>` fica em
silêncio, assim como um `<returns>` ausente. O CS1591
cobre membros `public` e `protected` de tipos públicos (um campo `protected` e
um `override` sem doc geraram aviso), nunca os `internal`. Um comentário mal
formado some do arquivo com `<!-- Badly formed XML comment ignored for member
"T:Bad.Malformed" -->`, e um cref não resolvido fica com prefixo `!:`
(`cref="!:DoesNotExist"`).

### inheritdoc e include

```csharp
/// <inheritdoc/>
public sealed class Square : Shape, INamed
{
    /// <inheritdoc/>
    public override double Area() => 1;     // de Shape.Area; XML: <inheritdoc/>
    /// <inheritdoc/>
    public string Name => "square";         // de INamed.Name; XML: <inheritdoc/>
    /// <inheritdoc cref="Shape.Draw(double)" path="/param"/>
    public void Paint(double scale) { }
    // XML: <inheritdoc cref="M:Inh.Shape.Draw(System.Double)" path="/param"/>
    /// <inheritdoc/>
    public void Orphan() { }                // sem membro base; XML: <inheritdoc/>
    /// <include file="docs/shared.xml" path="docs/members[@name='calc']/Sum/*"/>
    public static int Sum(int a, int b) => a + b;
    // XML: <summary>Adds two numbers (from shared.xml).</summary><param name="a">Left.</param>...
}
```

O compilador **não** expande o `inheritdoc`: grava a tag como está (com o cref
virado ID) e deixa a resolução para editores e geradores de documentação.
`Orphan` não gerou diagnóstico; só um `cref` inválido dentro da tag deu CS1574.
A tag satisfaz o CS1591 do próprio membro, mas num tipo ela não cobre membros
novos (um `Extra()` sem doc ainda recebeu CS1591). A documentação acrescenta
que o Visual Studio mostra docs herdadas em overrides sem doc, só na IDE.

O `include` faz o contrário: o compilador insere o resultado do XPath. Um
arquivo ausente dá `CS1589: Unable to include XML fragment '...' of file
'docs/missing.xml' -- File not found.` e um comentário XML na saída; um XPath
que não casa com nada passa em silêncio, deixando só `<!-- No matching
elements were found for the following include tag -->`. `/** */` gera o mesmo
XML que `///`.

### Records, construtores primários, required e init

```csharp
/// <summary>A money amount.</summary>
/// <param name="Amount">The numeric value.</param>
/// <param name="Currency">ISO 4217 code.</param>
public record Money(decimal Amount, string Currency);
// T:Rec.Money e M:Rec.Money.#ctor(System.Decimal,System.String): summary + os dois params
// P:Rec.Money.Amount: <summary>The numeric value.</summary>  (Currency idem)

/// <summary>A service with a primary constructor.</summary>
/// <param name="clock">Time source.</param>
public class Greeter(TimeProvider clock) { /* ... */ }
// T:Rec.Greeter e M:Rec.Greeter.#ctor(System.TimeProvider): summary + param
```

Num record posicional, o `<param>` também vira o `<summary>` da propriedade;
num construtor primário de classe, documenta só o construtor, porque esses
parâmetros não são membros. As verificações continuam: `<param name="clok">`
gerou CS1572 e CS1573, e um record que documenta só `Amount` recebeu CS1573
para `Currency`. Um record sem tags `<param>` não recebeu CS1591 pelas
propriedades posicionais públicas, e o XML não tem entrada para elas.
`required` e `init` não mudam nada: a propriedade se documenta como qualquer
outra, e um `public required int Timeout` sem doc recebeu CS1591.

### Pacotes e o arquivo do IntelliSense

Com a propriedade ligada, `dotnet pack -o feed` pôs o arquivo ao lado da DLL:

```text
lib/net10.0/Shapes.dll
lib/net10.0/Shapes.xml
```
Um app de console que consome o pacote recebeu só `Shapes.dll` no `bin`; o XML
fica na pasta do pacote, ao lado da DLL que os editores resolvem. Com
`-p:CopyDocumentationFilesFromPackages=true` ele foi copiado também. A doc exige
o nome e a pasta do assembly para o IntelliSense achá-lo. DocFX e geradores
parecidos consomem os mesmos comentários (não instalados aqui); o Source Link,
que aponta o depurador para o fonte por trás de um PDB, é outro recurso.

### Transformando avisos em gate

```text
-p:TreatWarningsAsErrors=true                         error CS1591: Missing XML comment ...
.editorconfig  dotnet_diagnostic.CS1591.severity = error   error CS1591, without TWAE
.editorconfig  dotnet_diagnostic.CS1591.severity = none    succeeds, even with TWAE
NoWarn containing CS1591                                   succeeds, XML still written
severity = error, GenerateDocumentationFile off            succeeds: nothing is checked
```

Promover a família toda tem efeito de ordem: com CS1570 e CS1584 como erros, o
build parou neles e escondeu CS1572, CS1574 e CS1591 até o XML ser corrigido.
(O conceito de analyzers mostra que o IDE0005 também depende desta propriedade.)

## Trade-offs

- **Bibliotecas sim, apps quase nunca.** Num pacote, a doc é superfície de API
  e o CS1591 é um gate justo. Os tipos públicos de um app não têm consumidores
  externos; ligue o arquivo só se o OpenAPI precisar e silencie o ruído:
  ```xml
  <GenerateDocumentationFile>true</GenerateDocumentationFile>
  <NoWarn>$(NoWarn);CS1591</NoWarn>
  ```
- **Barre a família, não tudo.** `TreatWarningsAsErrors` mistura doc com avisos
  sem relação. Uma lista dirigida só falha por doc fora de sincronia:
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);CS0419;CS1570;CS1571;CS1572;CS1573;CS1574;CS1584;CS1587;CS1589;CS1591;CS1711;CS1712;CS1734</WarningsAsErrors>
  ```
  Coloque num `Directory.Build.props` para `src` e afrouxe o CS1591 no
  `.editorconfig` para testes ou pastas de código gerado.
- **inheritdoc é um ponteiro, não uma cópia.** Elimina duplicação, mas o
  compilador nunca confere se existe uma base, e uma ferramenta que não o
  resolve não mostra nada.

## Documentation Links

- [XML documentation comments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/xmldoc/) (doc)
- [Recommended XML tags for C# documentation comments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/xmldoc/recommended-tags) (doc)
- [Documentation comments, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/documentation-comments) (doc)
- [Compiler Warning CS1591, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs1591) (doc)
- [C# compiler options that control output: DocumentationFile, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/output) (doc)
- [MSBuild reference for .NET SDK projects: GenerateDocumentationFile, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props#generatedocumentationfile) (doc)
