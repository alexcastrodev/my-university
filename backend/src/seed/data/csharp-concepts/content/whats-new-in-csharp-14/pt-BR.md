---
version: 1.0
updatedAt: 2026-10-15
title: "Novidades do C# 14: Um Mapa dos Recursos"
summary: Mapa de navegação das novidades do C# 14 (extension members, field, atribuição condicional nula, conversões de span, nameof genérico, lambdas com modificadores, partial construtores e eventos, operadores compostos), com um resumo curto de cada uma e o link para o conceito que aprofunda.
---
## Objective

O C# 14 vem com o .NET 10 e é a versão padrão da linguagem em projetos que
miram `net10.0`. A página oficial "What's new in C# 14" lista nove itens. Este
conceito é um mapa, não um tutorial: cada recurso recebe um resumo curto, um
trecho mínimo quando ajuda e o apontamento para o conceito que vai fundo. Use
para decidir o que ler em seguida e o que procurar ao atualizar uma base de código.

## Use Cases

- Ter o quadro completo do C# 14 de uma vez, antes de ler os conceitos profundos.
- Planejar a migração para o SDK do .NET 10 e saber quais recursos podem mudar o
  comportamento de código existente.
- Revisar um pull request que usa sintaxe nova que você ainda não reconhece.
- Escolher qual recurso adotar primeiro no guia de estilo do time.

## Deep Dive

A lista segue a ordem da página oficial. As regras de versão (quais recursos
exigem um target framework mais novo) estão em
`csharp-language-versions-and-preview-features`.

### Extension members

Os novos blocos `extension` declaram métodos de extensão e também propriedades de
extensão, além de membros que parecem estáticos do tipo estendido, inclusive
operadores definidos pelo usuário. Um bloco com nome de receptor
(`extension(IEnumerable<int> s)`) adiciona membros no estilo de instância; um
bloco só com o tipo (`extension(IEnumerable<int>)`) adiciona membros no estilo
estático. Os métodos de extensão clássicos com `this` continuam funcionando. Uma
verificação mínima no SDK 10.0.100:

```csharp
static class E { extension(IEnumerable<int> s) { public int Count0 => s.Count(); } }
// new int[] { 1, 2, 3 }.Count0  imprime 3
```

Aprofundamento: `extension-members-and-extension-blocks`.

### A palavra-chave field

Dentro do acessor de uma propriedade, `field` se refere a um campo de apoio
sintetizado pelo compilador, então dá para escrever o corpo de um ou dos dois
acessores sem declarar um campo privado. Serve para validação, inicialização
preguiçosa (`get => field ??= ...`) e notificação de mudança. A página oficial
alerta para um risco: um tipo que já tem um membro chamado `field` pode mudar de
significado ou confundir quem lê, e você desambigua com `@field` ou `this.field`.

Aprofundamento: `properties-init-accessors-and-the-field-keyword`.

### Atribuição condicional nula

`?.` e `?[]` agora podem ficar do lado esquerdo de `=` e das atribuições
compostas. O lado direito só é executado quando o alvo não é nulo, então
`customer?.Order = GetCurrentOrder()` nunca chama `GetCurrentOrder` para um
cliente nulo. Incremento e decremento (`++`, `--`) não são permitidos ali.

Aprofundamento: `operators-null-handling-and-null-conditional-assignment`.

### Conversões implícitas de span

A linguagem agora reconhece a relação entre `T[]`, `Span<T>` e `ReadOnlySpan<T>`
e adiciona conversões implícitas entre eles. Os tipos span podem ser receptores
de métodos de extensão, compõem com outras conversões e participam da inferência
de tipos genéricos. Como conversões alimentam a resolução de overload, uma
atualização pode escolher um overload diferente do anterior; o conceito
aprofundado mostra os casos.

Aprofundamento: `span-memory-and-slicing-without-allocating`.

### Tipos genéricos não vinculados em nameof

`nameof` aceita um tipo genérico não vinculado. `nameof(List<>)` avalia para
`List`, e `nameof(Dictionary<,>)` para `Dictionary` (os dois impressos no SDK
10.0.100). Antes do C# 14 era preciso fechar o tipo, como em `nameof(List<int>)`.
Este é o único recurso aqui sem conceito dedicado; a regrinha acima é a história
toda, e a tabela de versões em `csharp-language-versions-and-preview-features`
mostra que ele compila em target frameworks mais antigos.

### Parâmetros de lambda simples com modificadores

Dá para pôr `ref`, `in`, `out`, `ref readonly` ou `scoped` num parâmetro de
lambda sem escrever o tipo: `(text, out result) => int.TryParse(text, out result)`
agora compila quando o tipo de delegate alvo fornece os tipos. O `params` continua
exigindo lista de parâmetros com tipos explícitos.

Aprofundamento: `local-functions-lambdas-and-closures`.

### Eventos e construtores partial

Construtores de instância e eventos podem ser `partial`, com exatamente uma
declaração de definição e uma de implementação. Só a declaração de implementação
do construtor pode ter inicializador `this()` ou `base()`, e só uma declaração
parcial do tipo pode usar a sintaxe de construtor primário. A implementação de um
evento tem os acessores `add` e `remove`, e a definição é field-like. Isso serve
sobretudo a source generators.

Aprofundamento: `partial-types-and-partial-members`. Relacionado:
`primary-constructors-for-classes-and-structs`.

### Operadores de atribuição composta definidos pelo usuário

Um tipo agora pode declarar `+=`, `-=` e afins como métodos de instância que
retornam `void` e alteram o objeto no lugar, em vez de depender de `x = x + y`.
Quando o operando é uma variável e existe esse operador, o compilador o usa. Uma
execução rápida no SDK 10.0.100:

```csharp
class Acc {
    public int Total, Allocs;
    public void operator +=(int x) { Total += x; }
    public static Acc operator +(Acc a, int x) => new() { Total = a.Total + x, Allocs = a.Allocs + 1 };
}
// acc += 5; acc += 7;  dá Total 12 e Allocs 0: o operador + nunca foi chamado
```

A motivação na especificação do recurso é evitar alocação e cópia em tipos
grandes. Ainda não há conceito dedicado a este recurso; ele é descrito só aqui, e
a regra do par com `checked` está na especificação linkada abaixo.

### Diretivas de file-based apps

A página também lista novas diretivas de pré-processador para file-based apps. A
referência diz que o compilador C# ignora qualquer diretiva que comece com `#:` ou
`#!`, enquanto o sistema de build as lê quando você roda um arquivo único com
`dotnet run Program.cs`. Não são sintaxe da linguagem, então ficam fora do mapa
acima.

## Trade-offs

- **Adotar tudo de uma vez.** Os recursos são independentes, então o time pode
  entrar um a um. Comece pelos que tiram boilerplate com pouco risco (`field`,
  atribuição condicional nula) e revise com testes os que mudam regras de
  resolução (conversões de span).
- **Sintaxe nova versus ferramentas.** Analyzers, formatadores, geradores de código
  e IDEs antigas podem atrasar. Fixe o SDK com `global.json` para que toda máquina
  compile a mesma linguagem.
- **Operadores no lugar versus semântica de valor.** Um `+=` que altera o objeto é
  mais rápido em tipos grandes, mas fácil de usar mal em referências
  compartilhadas; mantenha tipos imutáveis no `+` comum.
- **O mapa não é o território.** Esta página repete só o que a página oficial
  confirma. Detalhes de comportamento, casos de borda e saídas medidas estão nos
  conceitos linkados.

## Documentation Links

- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [The extension keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/extension) (doc)
- [Null-conditional assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/null-conditional-assignment) (doc)
- [First-class span types, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/first-class-span-types) (doc)
- [Partial members, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) (doc)
- [User-defined compound assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/user-defined-compound-assignment) (doc)
