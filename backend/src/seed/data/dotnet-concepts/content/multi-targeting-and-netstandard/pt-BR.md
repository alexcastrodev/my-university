---
version: 1.0
updatedAt: 2026-10-15
title: "Multi-targeting e .NET Standard"
summary: Como TargetFrameworks gera um pacote com várias pastas lib, como o NuGet escolhe o assembly de cada consumidor, #if e polyfills para cobrir lacunas entre alvos, e o que o C# permite em netstandard2.0.
---
## Objective

Uma biblioteca no NuGet é consumida por projetos que você não controla: um app
web .NET 10, um worker .NET 8, talvez um serviço legado em .NET Framework. O
multi-targeting compila um projeto para vários target frameworks e empacota
todas as saídas em um único pacote; o NuGet escolhe a melhor para cada
consumidor. Este conceito mostra o que isso produz, como compilação condicional
e polyfills preenchem as lacunas entre alvos, para que o `netstandard2.0` ainda
é útil em 2026 e quais recursos do C# acompanham você até um alvo antigo.

## Use Cases

- Uma biblioteca que precisa funcionar para clientes em .NET Framework 4.8 e
  também usar APIs modernas rápidas no .NET atual.
- Decidir entre só `netstandard2.0` e `netstandard2.0;net10.0`.
- Usar uma API nova da BCL no alvo moderno e um fallback no antigo.
- Usar setters `init` ou records em código que também compila para
  `netstandard2.0`.
- Conferir que um pacote multi-target expõe a mesma API pública em cada alvo.

## Deep Dive

### O que o multi-targeting produz

Troque `TargetFramework` pelo plural `TargetFrameworks`. O SDK roda o build uma
vez por alvo, e o `dotnet pack` coloca cada saída em sua própria pasta `lib`.
Empacotei este projeto com o SDK 10.0.100:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>netstandard2.0;net10.0</TargetFrameworks>
    <LangVersion>latest</LangVersion>
    <PackageId>Contoso.Multi</PackageId>
    <Version>1.0.0</Version>
  </PropertyGroup>
</Project>
```

```text
lib/net10.0/Multi.dll
lib/netstandard2.0/Multi.dll
dependencies: group net10.0, group .NETStandard2.0
```

No restore, o NuGet compara o target framework do consumidor com essas pastas e
pega a compatível mais próxima. Para ver isso, a biblioteca abaixo expõe qual
ramo do código foi compilado:

```csharp
public static string Describe(string text)
{
#if NET10_0_OR_GREATER
    return $"net10 path: {text.Contains('x')}";
#else
    return $"fallback path: {text.IndexOf('x') >= 0}";
#endif
}
```

Dois consumidores referenciaram o pacote a partir de um feed local. O app de
console `net10.0` imprimiu `net10 path: True`. Um app `net8.0` não tem pasta
`net8.0` no pacote, então o NuGet caiu para `netstandard2.0` e imprimiu
`NETSTANDARD2_0 | fallback path: True`. A primeira lição: um consumidor numa
versão entre os seus alvos recebe o assembly mais antigo, não um intermediário.
Se o desempenho dos usuários de .NET 8 importa, acrescente `net8.0` à lista.

O SDK define símbolos de pré-processador para cada alvo (`NET10_0`,
`NETSTANDARD2_0`) e para faixas (`NET10_0_OR_GREATER`, `NET5_0_OR_GREATER`).
Prefira a forma `_OR_GREATER`, porque um alvo novo adicionado depois continua
escolhendo o ramo moderno.

### Quais alvos escolher

A orientação da Microsoft separa dois objetivos. Para APIs e recursos modernos,
como trimming e Native AOT, inclua um alvo `net` recente. Para abrangência,
acrescente `netstandard2.0`, que o .NET Framework 4.6.1 em diante e todo o .NET
suportam. A documentação diz ainda que o .NET 5 e posteriores tornam o .NET
Standard desnecessário na maioria dos cenários, que nenhuma versão nova do .NET
Standard será lançada e que se deve pular o `netstandard2.1` em favor de um alvo
`net`, já que o .NET Framework não o implementa. Ela indica o `netstandard2.0`
para compartilhar código entre o .NET Framework e o resto do .NET. Uma regra
pragmática:

- Apps e bibliotecas internas de um produto: um único `net10.0`.
- Biblioteca pública que usuários de .NET Framework precisam:
  `netstandard2.0;net10.0`.
- Biblioteca pública que não precisa de Framework: só `net10.0` (ou o LTS mais
  antigo suportado que você quer alcançar).

O alvo `netstandard2.0` não é de graça. Sua superfície de API é menor (sem
`Span<T>` de fábrica, por exemplo), então o código escrito para ele costuma
precisar de padrões mais antigos e menos eficientes do que o mesmo código no
`net10.0`. O ramo condicional acima é como você dá o caminho melhor aos
consumidores modernos.

### Polyfills e versão da linguagem

Cada alvo tem uma versão padrão do C#. Meu primeiro build do alvo
`netstandard2.0` falhou num namespace de escopo de arquivo:

```text
error CS8370: Feature 'file-scoped namespace' is not available in C# 7.3.
Please use language version 10.0 or greater.
```

O `netstandard2.0` usa C# 7.3 por padrão. A documentação afirma que usar uma
versão da linguagem mais nova que a associada ao target framework não é
suportado, e desaconselha `LangVersion=latest`, pois o valor muda conforme o
compilador instalado. Por isso o projeto acima é uma demonstração, não uma
recomendação: em produção, fixe uma versão explícita como `13.0` e teste. O que
observei com o override: recursos só de sintaxe compilam, enquanto recursos que
precisam de tipos de runtime não.

```csharp
public class Feat
{
    public string Name { get => field; set => field = value?.Trim() ?? ""; }
    public int Id { get; init; }
}
```

No `netstandard2.0`, isso compilou a palavra-chave `field` (recurso do C# 14
que é pura transformação do compilador), mas falhou no `init` com `CS0518:
Predefined type 'System.Runtime.CompilerServices.IsExternalInit' is not defined
or imported`. A correção usual é um polyfill: declarar você mesmo o tipo que
falta, como `internal` e só onde a BCL não o tem.

```csharp
#if !NET5_0_OR_GREATER
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
#endif
```

Com esse arquivo o projeto compilou para os dois alvos. Um tipo como
`ReadOnlySpan<char>` é outro caso: falhou com `CS0234` no `netstandard2.0`, e a
solução ali é uma referência de pacote (`System.Memory`), adicionada de forma
condicional com `Condition="'$(TargetFramework)' == 'netstandard2.0'"`. Não
rodei esse pacote aqui, então trate como o caminho usual, não como resultado
medido.

### Mantendo os alvos honestos

Compilar não é o mesmo que ser compatível. Um assembly `netstandard2.0` pode
chamar uma API que lança `PlatformNotSupportedException` em algum runtime. Duas
ferramentas ajudam. O analisador de compatibilidade de plataforma sinaliza
essas chamadas. E a validação de pacote (do conceito anterior) confere se um
pacote multi-target expõe APIs consistentes entre os alvos e o compara com uma
versão baseline. Mantenha o nome do assembly idêntico em todos os alvos: a
orientação avisa que nomes diferentes por alvo podem quebrar consumidores.

## Trade-offs

- **Mais alvos, mais alcance**, mas cada `#if` extra é um caminho de código que
  precisa dos próprios testes; rode a suíte contra cada alvo com
  `dotnet test -f net10.0` e outro framework que você distribui.
- **`netstandard2.0` como fallback** atende o .NET Framework, mas limita a
  superfície de API; o alvo moderno deixa você usar APIs novas onde existem.
- **Polyfills** permitem usar `init`, records ou `Index` em alvos antigos, mas
  são cópias suas de tipos da BCL, então mantenha-os `internal` e compilados só
  onde a BCL não os tem.
- **Forçar `LangVersion`** dá sintaxe nova em alvos antigos, mas a documentação
  o considera não suportado, e um recurso que precisa de tipo de runtime quebra
  na compilação ou, pior, só em execução.
- **Um único `net10.0`** é o mais simples e habilita anotações de trimming e
  AOT, mas exclui quem está no .NET Framework.

## Documentation Links

- [.NET Standard overview](https://learn.microsoft.com/en-us/dotnet/standard/net-standard)
- [Cross-platform targeting for .NET libraries](https://learn.microsoft.com/en-us/dotnet/standard/library-guidance/cross-platform-targeting)
- [Configure the C# language version](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version)
- [Target frameworks in SDK-style projects](https://learn.microsoft.com/en-us/dotnet/standard/frameworks)
- [Package validation overview](https://learn.microsoft.com/en-us/dotnet/fundamentals/apicompat/package-validation/overview)
