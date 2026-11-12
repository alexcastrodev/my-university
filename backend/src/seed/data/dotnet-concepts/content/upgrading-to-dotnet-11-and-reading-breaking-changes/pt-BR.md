---
version: 1.0
updatedAt: 2026-11-12
title: "Atualizando para o .NET 11 e Lendo as Breaking Changes"
summary: Como ler a página de breaking changes e o caso real do 10 para o 11, com antes e depois rodados nos SDKs 10 e 11. Mudanças silenciosas (conversões numéricas, CRC32 em ZIP, GZip vazio, args[0], publish AOT) e as quebras do compilador (CS7083, CS8352, CS9380, with).
---
## Objective

Um upgrade de major tem dois tipos de quebra. O primeiro se anuncia: um erro de compilação,
uma API que sumiu, um pacote que não restaura. O segundo não: o projeto compila, os testes que
existiam passam e algumas respostas são diferentes. O upgrade do .NET 10 para o 11 tem os dois, e
o segundo é o perigoso, porque aparece sem nenhuma troca de alvo.

Este concept é um método para ler a página de breaking changes e depois um caso trabalhado. O
caso é o upgrade 10 para 11, com cada mudança rodada antes e depois: no SDK 10.0.100 com o runtime
10, e no SDK 11.0.100 com o runtime 11 (macOS arm64). Um lab companheiro parte de um projeto
escrito para .NET 10 e pede que você corrija o que quebra, guiado por testes. O que a release
adiciona está em `whats-new-in-dotnet-11`. Itens que vieram só das páginas da Microsoft estão
marcados como "só doc".

## Use Cases

- Planejar a mudança de um serviço do .NET 10 LTS para o .NET 11 e decidir o que testar primeiro.
- Revisar um pull request que troca `net10.0` por `net11.0` e tem build verde.
- Atualizar o SDK do servidor de build antes do target framework, sabendo o que só isso quebra.
- Explicar por que uma aplicação `net10.0` passou a se comportar diferente depois que uma imagem base mudou.

## Deep Dive

### Lendo a página de breaking changes

A Microsoft mantém uma página de breaking changes por release, agrupada por área (core libraries,
JIT, SDK, extensions, deployment e outras), e uma página por mudança. Três perguntas ordenam cada
entrada:

1. **Binária, de código-fonte ou comportamental?** Uma mudança binária quebra um assembly já
   compilado. Uma de código-fonte quebra o build quando você recompila. Uma comportamental não
   quebra nada, e só a saída é diferente. As entradas comportamentais são as que precisam de teste.
2. **Onde se aplica?** Algumas dependem do runtime (a biblioteca base, o JIT), outras do SDK
   (build e publish), outras da versão do compilador, e outras só da versão de linguagem que um
   target framework seleciona. O mesmo upgrade pode quebrar em momentos diferentes para cada uma.
3. **Existe uma chave?** Várias entradas nomeiam uma propriedade ou configuração que restaura o
   comportamento antigo. Uma chave é uma ponte para um prazo, e não deve ser onde a correção termina.

A lista também é um rascunho por um tempo depois da release: as páginas são editadas, e um item
que era verdade num release candidate pode ser diferente no build GA. O padrão do publish Native
AOT otimizado, abaixo, é um exemplo.

### Uma ordem segura

1. Leia a lista das suas áreas e marque as entradas comportamentais.
2. Instale o SDK 11 e compile com o projeto ainda em `net10.0`. Isso isola o compilador e o SDK do
   runtime.
3. Troque para `net11.0` numa branch e leia os warnings, não só os erros.
4. Escreva testes de caracterização para o que o seu código assume: arredondamento, conversões,
   formatos de arquivo, parsing de linha de comando. Um teste que registra a resposta de hoje é
   barato e pega exatamente as entradas do segundo tipo.
5. Rode a suíte nos dois runtimes se puder. Só depois atualize a imagem base.

### Mudanças silenciosas: o runtime decide

O mesmo código rodou no SDK 10 com `net10.0` (runtime 10), e no SDK 11 com `net11.0` e com
`net10.0` (runtime 11 nos dois). A terceira execução, um projeto `net10.0` executado pelo
runtime 11 com `DOTNET_ROLL_FORWARD=Major`, imprimiu exatamente o que o `net11.0` imprimiu.

```csharp
double d = double.Parse("300.0"), n5 = double.Parse("-5.0"), big = double.Parse("1e10");
Console.WriteLine($"byte 300.0={(byte)d} byte -5.0={(byte)n5} sbyte 1e10={(sbyte)big} short 1e10={(short)big}");
Console.WriteLine($"decimal(0.1f)={(decimal)0.1f} decimal(0.1+0.2)={(decimal)(0.1 + double.Parse("0.2"))}");
Console.WriteLine($"Round(2.675,2)={Math.Round(double.Parse("2.675"), 2)} Round(2.675m,2)={Math.Round(2.675m, 2)}");
```

Os valores passam por `double.Parse` porque o compilador dobra expressões constantes em tempo
de build com regras próprias, e a tabela lista as expressões como atalho.

| Expressão | Runtime 10 | Runtime 11 |
|---|---|---|
| `(byte)300.0` | `44` | `255` |
| `(byte)-5.0` | `251` | `0` |
| `(sbyte)1e10` | `-1` | `127` |
| `(short)1e10` | `-1` | `32767` |
| `(decimal)(0.1 + 0.2)` | `0.3` | `0.3000000000000000444089209850` |
| `(decimal)0.1f` | `0.1` | `0.100000001490116119384765625` |
| `Math.Round(2.675, 2)` | `2.68` | `2.67` |
| `Math.Round(1.15, 1)` | `1.2` | `1.1` |
| `Math.Round(2.675m, 2)` | `2.68` | `2.68` |

Casts de float para inteiros pequenos agora saturam e `NaN` vira zero. Double para decimal
mantém o valor binário exato em vez de cerca de 15 dígitos significativos. `Math.Round` sobre um
`double` arredonda o valor binário exato, então 2.675, que na verdade é 2.67499999..., desce. A
sobrecarga de `decimal` não mudou, e essa é a correção: mantenha dinheiro como `decimal` desde a
origem e nunca converta a partir de um `double`. Os concepts `numeric-conversions-rounding-and-overflow`
e `numeric-types-and-binary-representation` explicam a representação.

Duas mudanças de biblioteca transformam um problema latente em exceção ou em tamanho:

```csharp
// uma entrada de ZIP guardada sem compressão, com um byte invertido
using var rs = zip.Entries[0].Open();
new StreamReader(rs).ReadToEnd();
// runtime 10: devolve "hel�o world hello world", sem erro
// runtime 11: InvalidDataException: The CRC32 checksum of the extracted data does not match
//             the expected value from the archive.

using (new GZipStream(ms, CompressionMode.Compress, true)) { }   // nada escrito
// ms.Length: runtime 10 dá 0, runtime 11 dá 20      (DeflateStream: 0 e 2, BrotliStream: 1 e 1)
```

A primeira é uma correção que expõe dados que você já recebia errados, então um caminho de upload
deve capturar `InvalidDataException`. A segunda quebra qualquer código que decide "esse payload
está vazio" pelo tamanho dos bytes comprimidos. Veja `compression-zip-gzip-brotli-and-tar`.

Mais uma depende de como o programa é iniciado:

```csharp
Console.WriteLine(Environment.GetCommandLineArgs()[0]);
```

Iniciado pelo apphost (`./out/t`), o runtime 10 imprimiu o caminho completo de `t.dll`, e o
runtime 11 imprimiu `./out/t`. Por um symlink chamado `special_name` que aponta para o apphost,
imprimiu o caminho do `.dll` no 10 e `./special_name` no 11. Com `dotnet out/t.dll` os dois
imprimem o caminho do `.dll`. `Environment.ProcessPath` é o caminho do executável e não mudou.
Código que monta o nome do programa a partir do elemento zero deve usá-lo. O concept de console é
`console-apps-exit-codes-and-system-commandline`.

### O publish Native AOT: o que o SDK GA faz

O SDK 11 tem um publish otimizado para Native AOT que compila mas pula o build completo, então os
alvos depois de `Build` e o `PostBuildEvent` não rodam e o `bin/` fica pequeno. Os release
candidates foram relatados fazendo isso por padrão. O SDK GA não faz: seus targets dizem "This
optimization is opt-in in .NET 11", e `UseOptimizedPublish` tem padrão `false` com `PublishAot`.
Três alvos marcadores (antes de `CoreCompile`, depois de `Build` e um evento de pós-build) foram
rodados com `dotnet publish`:

| Publish | Marcador `CoreCompile` | Marcador `AfterBuild` | `PostBuildEvent` | Arquivos em `bin/` |
|---|---|---|---|---|
| SDK 10 | rodou | rodou | rodou | 198 |
| SDK 11, padrão | rodou | rodou | rodou | 207 |
| SDK 11, `-p:UseOptimizedPublish=true` | rodou | não rodou | não rodou | 8 |

Então hoje nada quebra por padrão, e um pipeline que assina ou copia arquivos a partir de um hook
vai quebrar no dia em que alguém ligar a chave. Veja `native-aot-and-its-limits`.

### Quebras do compilador do SDK 11

Mudanças de compilador viajam com o SDK, não com o runtime, e algumas também dependem da versão
de linguagem do alvo (C# 15 para `net11.0`). Cada trecho abaixo foi compilado de três jeitos:
SDK 10 com `net10.0`, SDK 11 com `net10.0` (C# 14) e SDK 11 com `net11.0` (C# 15).

**1. `with(...)` numa collection expression.** No C# 15 um primeiro elemento escrito `with(...)`
é uma lista de argumentos para a coleção, não uma chamada:

```csharp
List<int> xs = [with(10), 3];          // uma função local chamada "with" devolve n
Console.WriteLine($"Count={xs.Count} Capacity={xs.Capacity} first={xs[0]}");
// SDK 10 / net10.0:   Count=2 Capacity=2 first=10
// SDK 11 / net10.0:   error CS9327: Feature 'collection expression arguments' is not available in C# 14.0
// SDK 11 / net11.0:   Count=1 Capacity=10 first=3     (warning CS8321: 'with' is declared but never used)
```

Isso é uma mudança silenciosa de significado, e o aviso de função não usada é a única pista. Num
tipo que não aceita argumentos ela é barulhenta:

```csharp
object[] xs = [with(1, 2), 3];
// SDK 11 / net11.0:   error CS9355: 'with(...)' elements are not supported for type 'object[]'
```

A correção é o identificador literal, `[@with(10), 3]`, que compilou nos três setups com o
resultado original.

**2. `CS8352`: um span que sobrevive ao seu buffer de pilha.**

```csharp
scoped Span<int> keep = default;
foreach (var x in source)
{
    Span<int> items = [x];     // um buffer de pilha para esta iteração
    keep = items;              // o SDK 10 aceitou isto e imprimiu keep.Length = 1
}
// SDK 11, os dois alvos: error CS8352: Cannot use variable 'items' in this context because
//   it may expose referenced variables outside of their declaration scope
```

O código antigo lia um buffer que não existia mais. Copie os dados para fora dentro da iteração:
`keep = items.ToArray();` com `int[] keep`.

**3. `CS7083`: `&&` entre uma interface e um `dynamic`.** Com uma interface `I1` que declara
`static operator true` e `false`, `I1 x = new C1(); dynamic y = new C1(); x && y;` compilava no
SDK 10 e lançava em tempo de execução:

```text
RuntimeBinderException: Operator '&&' cannot be applied to operands of type 'I1' and 'C1'
```

No SDK 11 é erro de compilação, nos dois alvos: `CS7083: Expression must be implicitly
convertible to Boolean or its type 'I1' must not be an interface and must define operator
'false'.` Declarar `C1 x` resolve: compilou e imprimiu `C1` em todo lugar.

**4. `CS9380`: um tipo chamado `closed`.**

```csharp
class closed { }
// SDK 10 e SDK 11 / net10.0:   warning CS8981: The type name 'closed' only contains lower-cased ascii characters
// SDK 11 / net11.0:            error CS9380: Types and aliases cannot be named 'closed'.
```

`closed` é um modificador no C# 15, então a quebra aparece quando a versão de linguagem sobe
para 15, não quando o SDK sobe. `class @closed { }` mantém o nome CLR `closed`, e esse nome é o
que um serializador ou um mapeamento de banco enxerga.

A mesma página lista `union` como nova palavra contextual, um modificador `safe` ligado às regras
de memory safety ainda em preview, uma mudança em `nameof(this.P)` dentro de atributos e uma
correção de parsing para um padrão de `switch`. Esses não foram recompilados aqui para este
concept. O lado da linguagem está em `csharp-language-versions-and-preview-features` e
`whats-new-in-csharp-15`.

### As entradas só de documentação

As páginas listam mais coisas que não foram rodadas para este concept: um mutex nomeado com escopo
de usuário por padrão no Unix, `IHost.RunAsync` lançando exceção quando um `BackgroundService`
falha, um restore que deixa de usar a pasta global de pacotes para achar a próxima melhor versão,
novas restrições de `PackageId` (`NU5052`) e mudanças em configuração e options de
`Microsoft.Extensions`. As de ASP.NET Core e EF Core têm checklists próprios:
`migrating-from-aspnet-core-10-to-11` e `upgrading-from-ef-core-10-to-11-breaking-changes`. Rode
as que tocam o seu código antes de confiar em qualquer uma.

## Trade-offs

- **Trocar o alvo não é o momento de risco.** A imagem base ou o runtime instalado é. Uma aplicação
  `net10.0` executada pelo runtime 11 imprimiu todos os valores da tabela acima. Fixe o runtime na
  imagem até os testes concordarem.
  ```csharp
  (byte)double.Parse("300.0")   // 44 no runtime 10, 255 no runtime 11
  ```
- **Compilador primeiro, alvo depois tem custo.** Atualizar só o SDK mantém o C# 14 e ainda
  quebra `CS8352`, `CS7083` e `with` em `object[]`. Evita as mudanças de palavra-chave do C# 15,
  então é um passo útil, e precisa de um `global.json` para o build não flutuar.
- **Uma chave não é uma correção.** `UseOptimizedPublish` ou um identificador com `@` deixa o build
  verde. Garanta que o hook, o nome guardado ou a regra de arredondamento seja algo que você decidiu.
- **Testes de caracterização fixam o comportamento de hoje, inclusive os bugs.** Um teste que
  registra o byte com wrap do runtime 10 estaria errado no 11. Escreva a regra que você quer
  (`Math.Clamp`, um decimal lido de texto) e deixe o teste falhar na versão que discorda.
  ```csharp
  (byte)Math.Clamp(300.0, 0, 255)   // 255 em todo runtime
  ```
- **A lista é um rascunho.** O padrão do publish otimizado mudou entre o release candidate e o
  build GA, então leia a página do build que você entrega e rode a conferência você mesmo.

## Documentation Links

- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [Float to small integer conversions saturate, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/11/fp-to-small-integer) (doc)
- [Math.Round with digits, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/math-round-digits) (doc)
- [Decimal and BigInteger floating point conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/decimal-biginteger-floating-point-conversions) (doc)
- [Environment.GetCommandLineArgs and the apphost, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/environment-getcommandlineargs-apphost-invocation-name) (doc)
- [Compiler breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2011) (doc)
