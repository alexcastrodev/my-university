---
version: 1.0
updatedAt: 2026-10-14
title: "Versões do C#, o Compilador e Recursos Preview"
summary: Como a versão da linguagem é escolhida a partir do target framework, como inspecioná-la e sobrescrevê-la, quais recursos do C# 14 funcionam em net8.0/net9.0 e quais exigem runtime novo, e como funcionam LangVersion preview e EnablePreviewFeatures.
---
## Objective

Um projeto C# tem dois números de versão que as pessoas confundem o tempo todo:
a versão da linguagem (qual sintaxe o compilador aceita) e o target framework
(em qual runtime e bibliotecas o código roda). O compilador vem com o SDK, então
o SDK do .NET 10 consegue compilar código C# 14 que tem como alvo o .NET 8. Mas
só alguns recursos do C# são trabalho puro de compilador. Outros precisam de um
tipo ou de uma capacidade de runtime que frameworks antigos não têm. Este
conceito explica como a versão padrão é escolhida, como sobrescrevê-la e
inspecioná-la, quais recursos do C# 14 sobrevivem em um framework antigo
(verificado compilando, sem chute) e como os recursos preview são habilitados.

## Use Cases

- Atualizar para o SDK do .NET 10 enquanto a aplicação ainda mira o .NET 8 e
  querer usar `field` ou atribuição null-conditional hoje.
- Ler um erro como "Feature 'x' is not available in C# 12.0" e saber se o
  caminho é mudar o `LangVersion` ou o target framework.
- Descobrir qual versão da linguagem um build usa de verdade na máquina de CI.
- Experimentar um recurso preview do compilador em um projeto descartável sem
  deixá-lo vazar para o código de produção.

## Deep Dive

### O padrão segue o target framework, não o SDK

Quando você não define `LangVersion`, o compilador escolhe o padrão a partir do
target framework, para que um projeto compilado por um SDK mais novo continue
com a linguagem para a qual foi desenhado. Dá para observar isso com o mesmo
arquivo-fonte:

```xml
<!-- p.csproj, só o TargetFramework muda -->
<TargetFramework>net8.0</TargetFramework>  <!-- padrão C# 12 -->
<TargetFramework>net9.0</TargetFramework>  <!-- padrão C# 13 -->
<TargetFramework>net10.0</TargetFramework> <!-- padrão C# 14 -->
```

Pedir a propriedade ao MSBuild em um projeto `net8.0` com o SDK 10.0.100
devolve o valor efetivo:

```
$ dotnet msbuild -getProperty:LangVersion
12.0        (projeto net10.0: 14.0)
```

Outro truque é forçar um diagnóstico que imprime a versão do compilador e da
linguagem. Um arquivo que contém só `#error version` falha com:

```
error CS8304: Compiler version: '5.0.0-2.25523.111 (b0f34d51)'. Language version: 12.0.
```

(projeto `net8.0` com configuração padrão; o mesmo arquivo em um projeto
`net10.0` informa 14.0.) A versão do compilador pertence ao SDK, a versão da
linguagem pertence ao projeto. A Microsoft recomenda não definir `LangVersion` e
subir o target framework, porque o padrão é a combinação que linguagem e
bibliotecas testaram juntas.

### Sobrescrevendo o LangVersion

`LangVersion` aceita um número (`13.0`, `14`), `default`/`latestMajor` (a maior
versão major que este compilador suporta, ignorando o target framework),
`latest` (a maior versão lançada, incluindo minors) e `preview`. Duas regras
importam na prática:

- O valor é limitado pelo compilador. Com o SDK 10.0.100, definir `LangVersion`
  como `15` falha com `CS1617: Invalid option '15'`, e um SDK do .NET 9
  (9.0.307) rejeita `14` do mesmo jeito. Linguagem mais nova exige SDK mais novo.
- `latest` e `default` dependem da máquina. A documentação desaconselha
  `latest` porque duas máquinas com SDKs diferentes compilam linguagens
  diferentes. Fixe um número explícito se precisar sobrescrever, ou melhor, fixe
  o SDK com `global.json`.

### O que funciona em um target framework antigo

Definindo `<LangVersion>14</LangVersion>` em projetos `net8.0` e `net9.0` e
compilando um programa pequeno por recurso, com o SDK 10.0.100, o resultado foi
este (sem `LangVersion`, cada linha do C# 14 falha com `CS9202` ou `CS9260`,
"not available in C# 12.0/13.0"):

| Recurso | net8.0 | net9.0 | net10.0 |
|---|---|---|---|
| Palavra-chave `field` em accessors | funciona | funciona | funciona |
| Atribuição null-conditional `a?.B = x` | funciona | funciona | funciona |
| `nameof(List<>)` | funciona | funciona | funciona |
| Modificadores em parâmetros de lambda `(out x) => ...` | funciona | funciona | funciona |
| Extension blocks `extension(string s) { ... }` | funciona | funciona | funciona |
| Partial constructors | funciona | funciona | funciona |
| Operadores compostos do usuário (`operator +=`) | funciona | funciona | funciona |
| `params ReadOnlySpan<int>` (C# 13) | funciona | funciona | funciona |
| `allows ref struct` (C# 13) | `CS9240`, runtime sem generics by-ref-like | funciona | funciona |
| `System.Threading.Lock` (tipo, .NET 9) | `CS0234`, tipo ausente | funciona | funciona |

O padrão é a regra de bolso: sintaxe que o compilador consegue reduzir (lowering)
para código que já roda no runtime antigo funciona em todo lugar, enquanto um
recurso que depende de uma capacidade nova do runtime (`allows ref struct`
precisa de suporte do runtime para tipos ref-like como argumento genérico) ou de
um tipo novo de biblioteca (`Lock`) falha no framework antigo mesmo com o
`LangVersion` mais novo. A documentação diz isso diretamente: cada recurso tem
seu próprio requisito mínimo de API ou de runtime.

Um recurso merece nota. As conversões implícitas de span do C# 14 são uma
mudança de linguagem, então um extension method escrito para
`ReadOnlySpan<int>` só pode ser chamado em um `int[]` num projeto `net9.0`
depois que você sobe a versão da linguagem:

```csharp
int[] arr = [1, 2, 3];
Console.WriteLine(arr.Twice());   // LangVersion 14: 6
// C# 13 padrão: erro CS1929, 'int[]' does not contain a definition for 'Twice'
static class E { public static int Twice(this ReadOnlySpan<int> s) => s.Length * 2; }
```

### Recursos preview e EnablePreviewFeatures

Dois mecanismos diferentes se chamam "preview" e fazem coisas diferentes:

- `<LangVersion>preview</LangVersion>` manda o compilador aceitar a sintaxe da
  próxima versão da linguagem, ainda não lançada. Compilou normalmente no SDK
  10.0.100 para um programa que não usava nada novo. Sintaxe preview pode mudar
  ou sumir e não é suportada em produção.
- `<EnablePreviewFeatures>true</EnablePreviewFeatures>` faz o opt-in de APIs e
  recursos de runtime preview, os marcados com `[RequiresPreviewFeatures]`. Sem
  ele, usar esse tipo gera o warning `CA2252` ("requires opting into preview
  features"); com ele, o código roda.

```csharp
using System.Runtime.Versioning;
Foo.Bar();   // warning CA2252 a menos que EnablePreviewFeatures seja true
[RequiresPreviewFeatures] static class Foo { public static void Bar() => Console.WriteLine("preview api"); }
```

Também dá para compilar com um SDK mais novo que o runtime em que você publica:
um projeto pode mirar `net10.0` e usar um compilador mais novo via
`LangVersion`, desde que os recursos usados sejam só de compilador e o SDK esteja
fixado no `global.json` para o time inteiro concordar.

### Padrão versus implementação

O C# é especificado separadamente do Roslyn, o compilador que o implementa. As
edições do ECMA-334 linkadas no Microsoft Learn param na era do C# 7, e as
versões seguintes são descritas pela especificação da linguagem mantida pela
Microsoft e pelas propostas de recurso no repositório `csharplang`. Na prática o
Roslyn é a referência: um recurso existe quando o Roslyn o entrega, e cada página
"What's new in C# N" é a prova para uma afirmação de versão.

## Trade-offs

- **Subir o `LangVersion` em um framework antigo compra sintaxe, não
  bibliotecas.** A maior parte da sintaxe do C# 14 funciona em `net8.0`, mas um
  recurso que precisa de capacidade de runtime ou de biblioteca falha na
  compilação ou, pior, só em algumas máquinas. Teste com o menor framework que
  você suporta.
  ```csharp
  static T Id<T>(T t) where T : allows ref struct => t; // net8.0: CS9240
  ```
- **Deixar o `LangVersion` sem definir é o padrão seguro, mas parece lento.**
  Você recebe C# 12 em um projeto .NET 8 mesmo com o SDK do .NET 10, e precisa
  subir o target framework para avançar. A vantagem é que todo contribuidor vê a
  mesma linguagem, seja qual for o SDK instalado.
- **`latest` e `preview` fazem o build depender da máquina.** Duas pessoas com
  SDKs diferentes podem discordar sobre o código compilar ou não. Fixe o SDK no
  `global.json` se usar essas opções.
  ```json
  { "sdk": { "version": "10.0.100", "rollForward": "disable" } }
  ```
- **Sintaxe preview é uma aposta.** Pode mudar antes do lançamento, e o código
  escrito para ela pode parar de compilar. Mantenha em projetos de exploração.
- **Multi-targeting multiplica a matriz de testes.** Uma biblioteca que mira
  `net8.0` e `net10.0` com `LangVersion` alto precisa ser compilada e testada
  para cada alvo, porque um recurso pode compilar em um alvo e falhar em outro.

## Documentation Links

- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [Compiler options for language feature rules (LangVersion), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [MSBuild properties for .NET SDK projects (EnablePreviewFeatures), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [CA2252: Opt in to preview features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2252) (doc)
