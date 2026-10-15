---
version: 1.0
updatedAt: 2026-10-15
title: "Top-Level Programs, Implicit Usings e Namespaces"
summary: O que o compilador gera para um top-level program, as regras do ponto de entrada, como ImplicitUsings, global using, using static e aliases se combinam, namespaces com escopo de arquivo e como resolver conflito de nomes.
---
## Objective

Um projeto de console novo tem uma linha de código, e `Console` resolve sem
nenhum `using`. Não há mágica: o compilador envolve seus comandos numa classe e
num método gerados, e o SDK escreve um arquivo oculto cheio de diretivas
`global using`. Este conceito mostra o que é gerado, as regras de um
top-level program, como `ImplicitUsings`, `global using`, `using static` e
aliases de `using` se combinam, como funcionam namespaces com escopo de arquivo
e como resolver um conflito de nomes com alias ou `global::`.

## Use Cases

- Ler um stack trace que menciona `Program.<Main>$` e saber de onde veio.
- Tornar o `Program` gerado visível para um projeto de testes (testes de
  integração que precisam do tipo do ponto de entrada).
- Corrigir um erro de "referência ambígua" causado por um using implícito.
- Manter imports compartilhados num lugar só com `global using` ou itens
  `<Using>`.
- Dar um nome legível a uma tupla, um array ou um tipo genérico comprido.

## Deep Dive

### Em que um top-level program se transforma

Um arquivo com top-level statements é compilado para um método de ponto de
entrada dentro de uma classe chamada `Program`, no namespace global. Segundo a
documentação, a forma do método gerado (mostrado como `Main` por conveniência)
depende do que o seu código contém:

| O código contém | Ponto de entrada |
|---|---|
| `await` e `return` | `static async Task<int> Main(string[] args)` |
| `await` | `static async Task Main(string[] args)` |
| `return` | `static int Main(string[] args)` |
| nenhum dos dois | `static void Main(string[] args)` |

Por isso `args` existe sem ser declarado, `return 3;` define o código de saída
e `await` funciona no topo. Os nomes reais não são `Main`. Um programa que lança
exceção numa função local imprime este stack trace no .NET 10:

```csharp
void Fail() => throw new InvalidOperationException("boom");
try { Fail(); } catch (Exception e) { Console.WriteLine(e.StackTrace); }
// at Program.<<Main>$>g__Fail|0_0()
// at Program.<Main>$(String[] args)
```

O método é `<Main>$` (um nome que nenhum código C# consegue escrever) e a sua
função local virou um método de `Program` com nome gerado pelo compilador. Num
projeto com `await`, reflexão sobre `Program` listou `<Main>$`, mais um
wrapper `<Main>` sintetizado e as funções locais com nomes do compilador. A
classe `Program` é `internal` por padrão: `typeof(Program).IsPublic` imprimiu
`False` e `Namespace` imprimiu string vazia.

### As regras

- Só um arquivo do projeto pode ter top-level statements. Um segundo arquivo
  falha com `CS8802: Only one compilation unit can have top-level statements`.
- Você pode escrever um método chamado `Main`, mas ele não será o ponto de
  entrada, e a opção de compilador `-main` não consegue escolher um.
- Os `using` vêm primeiro. Namespaces e declarações de tipo precisam vir
  depois dos comandos, e os top-level statements estão implicitamente no
  namespace global, então um namespace declarado no mesmo arquivo não os envolve.

Para tornar o `Program` acessível a outro assembly, declare uma classe parcial
em qualquer arquivo:

```csharp
public partial class Program { }
```

Compilou e `typeof(Program).IsPublic` imprimiu `True`. É a forma padrão de
deixar um projeto de testes referenciar o tipo do ponto de entrada.

### De onde vem o `Console`: ImplicitUsings

Desde o .NET 6, projetos C# no estilo SDK podem habilitar
`<ImplicitUsings>enable</ImplicitUsings>`. O SDK então gera um arquivo em
`obj/` com um `global using` para cada namespace de um conjunto padrão que
depende do SDK:

- `Microsoft.NET.Sdk`: `System`, `System.Collections.Generic`, `System.IO`,
  `System.Linq`, `System.Net.Http`, `System.Threading`,
  `System.Threading.Tasks`.
- `Microsoft.NET.Sdk.Web`: esse conjunto mais `System.Net.Http.Json` e os
  namespaces do ASP.NET Core e de `Microsoft.Extensions` para hosting,
  configuração, injeção de dependência, roteamento e logging.
- `Microsoft.NET.Sdk.Worker`: o conjunto base mais os namespaces de
  configuração, injeção de dependência, hosting e logging de
  `Microsoft.Extensions`.

O arquivo gerado na minha execução (`obj/Debug/net10.0/<nome>.GlobalUsings.g.cs`)
tinha exatamente os sete namespaces base como `global using System;` e assim
por diante. Você personaliza o conjunto com itens MSBuild:

```xml
<ItemGroup>
  <Using Include="System.Globalization" />
  <Using Include="System.Text.Json" Alias="Json" />
  <Using Include="System.Math" Static="true" />
  <Using Remove="System.Net.Http" />
</ItemGroup>
```

As quatro formas compilaram e funcionaram num projeto de console .NET 10: um
namespace, um alias, um import estático e uma remoção.

### global using, using static e aliases

`global using` tem o efeito de adicionar a mesma diretiva a todos os arquivos da
compilação. Ele precisa vir antes de todos os usings não globais e antes de
qualquer declaração de namespace ou tipo, e a ordem entre os usings globais não
importa. `using static` importa os membros estáticos e os tipos aninhados de um
tipo, então `using static System.Console;` permite escrever `WriteLine`. Dá para
combinar os dois (`global using static System.Math;`). Extension members
declarados num tipo de `using static` ficam disponíveis para a busca de
extensões, mas os nomes deles não são importados para uso sem qualificação.

Um alias dá nome a um namespace ou a um tipo. Desde o C# 12 o alvo pode ser
qualquer tipo, incluindo tuplas e arrays (a documentação cita também ponteiros
e outros tipos unsafe):

```csharp
using Point = (int X, int Y);
using Matrix = int[,];
using Cache = System.Collections.Generic.Dictionary<string, int>;

Point p = (1, 2);
Matrix m = new int[2, 2];
Cache c = new() { ["a"] = 1 };
Console.WriteLine($"{p} {m.Length} {c.Count}");   // (1, 2) 4 1
```

Um alias não pode ser um genérico aberto (`List<T>` não vale, `List<int>` vale),
e o lado direito precisa ser totalmente qualificado: não pode usar outro alias.

### Namespaces com escopo de arquivo e conflitos

`namespace Acme.Billing;` (C# 10) coloca o arquivo inteiro no namespace sem um
nível de aninhamento. Um arquivo só pode ter um, e misturar com um namespace de
bloco falha com `CS8955`. Namespaces de bloco continuam necessários quando um
arquivo declara vários namespaces.

Um using implícito pode criar ambiguidade. Com `using System.Timers;` num
projeto com implicit usings, isto falha:

```csharp
using System.Timers;
Timer t = new(100);
// error CS0104: 'Timer' is an ambiguous reference between
// 'System.Timers.Timer' and 'System.Threading.Timer'
```

Resolva com um alias (`using Timer = System.Timers.Timer;`) ou o nome completo.
Quando um tipo seu esconde um do framework, `global::` começa a busca na raiz:
com `Acme.Data.File` declarado, `typeof(File)` continuou significando
`System.IO.File` no arquivo top-level, e `typeof(global::Acme.Data.File)`
nomeou o seu. A forma `alias::Nome` (por exemplo `S::Socket`) só funciona
quando o lado esquerdo é um alias de namespace.

## Trade-offs

- **Top-level statements tiram cerimônia e escondem o ponto de entrada.** Bom
  para ferramentas e scripts pequenos; o `Program` gerado surpreende quem
  procura `static void Main`. Mitigação: conheça o nome `<Main>$` nos stack
  traces e use um `Main` explícito ou uma classe quando o time preferir.
- **Implicit usings reduzem ruído e tornam invisíveis as dependências de um
  arquivo.** O leitor não vê de onde vem `Task`, e um namespace implícito novo
  pode criar ambiguidade (o exemplo do `Timer`). Mitigação: mantenha curta a
  lista de `<Using>` e desabilite `ImplicitUsings` em bibliotecas que querem
  imports explícitos.
- **`global using` e `using static` encurtam o código e o enfraquecem.** Um
  import estático de `Console` é aceitável num script, mas um `using static`
  de um tipo com nomes comuns (`Math`, `File`) deixa as chamadas ambíguas para
  quem lê. Mantenha os usings globais num arquivo só.
- **Aliases nomeiam formas, não tipos.** `using Point = (int X, int Y);` é uma
  ferramenta de legibilidade: não cria um tipo novo, então um `Point` e
  qualquer outro `(int, int)` são intercambiáveis e não carregam
  comportamento. Use um `record struct` quando o nome precisa significar algo
  para o compilador.

## Documentation Links

- [Top-level statements, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/top-level-statements) (doc)
- [The using directive, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-directive) (doc)
- [.NET project SDK overview, implicit using directives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview#implicit-using-directives) (doc)
- [MSBuild properties for .NET SDK projects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [Namespaces, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/namespaces) (doc)
- [What's new in C# 12, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
