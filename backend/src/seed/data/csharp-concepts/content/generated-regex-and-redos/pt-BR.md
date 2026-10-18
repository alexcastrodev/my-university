---
version: 1.0
updatedAt: 2026-10-15
title: "Regex Gerado e ReDoS"
summary: Como declarar um regex com GeneratedRegex, o que ele custa e economiza (com medições), quando cai em fallback, os analisadores SYSLIB1040 a 1045 e como se defender de ReDoS com timeout, padrão mais seguro ou NonBacktracking.
---
## Objective

Um `Regex` pode ser executado de três jeitos: interpretado (o padrão),
compilado para IL em tempo de execução (`RegexOptions.Compiled`) ou gerado como
C# em tempo de build com o atributo `[GeneratedRegex]`. A forma gerada elimina o
trabalho de inicialização, roda pelo menos tão rápido quanto `Compiled` e
funciona onde geração de código em runtime não funciona, como no Native AOT.
Este conceito cobre como declarar um regex gerado, o que ele custa e economiza
(com medições), os casos em que ele cai em silêncio num `Regex` comum e os
analisadores que orientam o uso. Cobre também ReDoS, o ataque de negação de
serviço por expressão regular: um padrão com quantificadores aninhados ambíguos
pode levar tempo exponencial numa entrada hostil curta, e as defesas são um
timeout de match, um padrão mais seguro ou o motor sem backtracking.

## Use Cases

- Transformar um `static readonly Regex` ou um `new Regex(...)` por requisição
  num regex gerado, para que um caminho quente inicie rápido e não aloque nada
  na construção.
- Publicar com Native AOT ou trimming, onde `RegexOptions.Compiled` não consegue
  emitir IL.
- Validar entrada controlada por um atacante (campo de busca, header, nome de
  upload) sem deixar uma requisição prender um núcleo de CPU.
- Revisar padrões legados à procura de backtracking catastrófico antes que
  cheguem à produção.

## Deep Dive

### Declarando um regex gerado

Coloque o atributo num método `partial` ou, desde o .NET 9 e o C# 13, numa
propriedade `partial` somente de leitura, dentro de uma classe `partial`. O
gerador de código escreve o corpo:

```csharp
public static partial class Patterns
{
    [GeneratedRegex(@"(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})")]
    public static partial Regex Date();

    [GeneratedRegex(@"(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})")]
    public static partial Regex DateProp { get; }

    [GeneratedRegex(@"\d+", RegexOptions.None, matchTimeoutMilliseconds: 250)]
    public static partial Regex WithTimeout();
}

Patterns.Date().IsMatch("2025-11-11");                       // True
Patterns.DateProp.Match("on 2025-11-11").Groups["y"].Value;   // 2025
ReferenceEquals(Patterns.Date(), Patterns.Date());            // True: uma única instância em cache
Patterns.WithTimeout().MatchTimeout;                          // 00:00:00.2500000
Patterns.Date().MatchTimeout;                                 // -00:00:00.0010000, infinito por padrão
```

O tipo gerado deriva de `Regex`, então tudo do conceito anterior (`Match`,
`EnumerateMatches`, `Count`) funciona igual. O método devolve um singleton em
cache, então você não precisa de um campo `static readonly` próprio. A flag
`RegexOptions.Compiled` é ignorada. O atributo aceita também um nome de cultura
como terceiro argumento, que é como `IgnoreCase` sabe quais regras de caixa
embutir. Repare que o timeout padrão continua infinito: o atributo não torna o
padrão seguro, você pede o timeout com `matchTimeoutMilliseconds`.

### Interpretado, compilado, gerado: custo e velocidade

O interpretador faz o parse do padrão e percorre opcodes na hora do match.
`Compiled` faz o mesmo parse e depois emite IL (construção cara, e o IL ainda
precisa passar pelo JIT no primeiro uso). O gerador move tudo isso para o build
e deixa C# comum no seu assembly, que você pode ler e percorrer no depurador.
Medido no .NET 10, Apple M4 Max, build Release, cada modo em processo próprio,
o tempo para construir o objeto e rodar um match (três execuções por modo,
todas a menos de 1 ms uma da outra):

```text
interpretado     cerca de 6,1 ms
Compiled         cerca de 9,4 ms
NonBacktracking  cerca de 18,9 ms
gerado           cerca de 1,6 ms
```

E a vazão em regime, contando datas numa string de 11.400 caracteres (mediana de
2.000 execuções, depois do aquecimento):

```text
interpretado     35,7 us/op
Compiled         35,8 us/op
NonBacktracking  93,2 us/op
gerado           23,6 us/op
```

São medições com Stopwatch de um padrão simples, então leia como uma direção, não
como um benchmark: aqui `Compiled` não superou o interpretador, e outros padrões
podem diferir. O que não muda é o formato: o gerado tem a menor inicialização e
nenhum reflection emit em runtime, que a documentação cita como o motivo de ele
ser a escolha para AOT e para apps trimados menores.

### Quando o gerador cai em fallback

Em dois casos o gerador não consegue emitir código próprio e passa a manter em
cache um `Regex` comum (ainda útil, mas sem a velocidade nem o benefício de AOT):
backreference com `IgnoreCase` e `RegexOptions.NonBacktracking`. Dá para ver o
segundo:

```csharp
[GeneratedRegex(@"(?<y>\d{4})", RegexOptions.NonBacktracking)]
public static partial Regex NB();

Patterns.NB().GetType().FullName;     // System.Text.RegularExpressions.Regex  (um Regex comum)
Patterns.Date().GetType().BaseType;   // System.Text.RegularExpressions.Regex  (Date() é uma subclasse gerada)
```

### Analisadores

Os analisadores do SDK usam os IDs SYSLIB1040 a SYSLIB1045. O SYSLIB1045 sugere
converter um `new Regex(...)` ou uma chamada estática `Regex.IsMatch(...)` com
padrão constante num regex gerado, e oferece um code fix. É só um diagnóstico de
nível informativo, então não aparece na saída do `dotnet build` até você
elevá-lo no `.editorconfig`:

```text
# .editorconfig
[*.cs]
dotnet_diagnostic.SYSLIB1045.severity = warning

# saída do build
Program.cs(3,19): warning SYSLIB1045: Use 'GeneratedRegexAttribute' to generate the regular expression implementation at compile-time.
```

Os demais são erros que apontam mau uso. Um padrão inválido falha no build, não
na primeira requisição:

```text
error SYSLIB1042: The specified regex is invalid. 'Invalid pattern '(unclosed' at offset 9. Not enough )'s.'
error SYSLIB1043: GeneratedRegexAttribute method or property must be partial, parameterless, non-generic, non-abstract, and return Regex.
```

SYSLIB1040 é uso inválido do atributo, SYSLIB1041 é mais de um atributo no mesmo
membro, e SYSLIB1044 é uma limitação interna do gerador.

### ReDoS: backtracking catastrófico, sempre com limite

Um motor com backtracking que falha um match precisa provar que nenhum caminho
funciona, e com quantificadores aninhados o número de caminhos é exponencial no
tamanho da entrada. O clássico é `^(a+)+$` contra uma sequência de `a` seguida
de algo que não é `a`. A demonstração abaixo sempre define um timeout curto, então
não consegue travar:

```csharp
var evil = new string('a', 26) + "!";
var bounded = new Regex(@"^(a+)+$", RegexOptions.None, TimeSpan.FromMilliseconds(200));
try { bounded.IsMatch(evil); }
catch (RegexMatchTimeoutException e)
{
    // interpretado: timeout em 200 ms (limite 200 ms, padrão ^(a+)+$)
}
```

Resultados reais, cada um com limite de 200 ms:

```text
interpretado   ^(a+)+$  em 26 a + "!"   timeout em 200 ms
gerado         ^(a+)+$  em 26 a + "!"   timeout em 199 ms   (gerar código não conserta o algoritmo)
(a|aa)+        em 30 a + "!"            timeout em 199 ms   (alternativas sobrepostas)
NonBacktracking ^(a+)+$ em 26 a + "!"   False em 13 ms
reescrito  ^(?>a+)$                      False em 0 ms
```

Três defesas, que podem ser combinadas. Primeiro, um `matchTimeout` em todo regex
que vê entrada não confiável, tratado como erro e nunca repetido sem fim. A
documentação recomenda um timeout sempre que o motor com backtracking é usado
sobre entrada não confiável. Segundo, uma reescrita que remove a ambiguidade:
`(a+)+` e `a+` aceitam as mesmas strings, então escreva `a+`; um grupo atômico
`(?>...)` impede o motor de voltar para dentro de uma parte que já casou.
Terceiro, `RegexOptions.NonBacktracking`, cujo tempo é linear no tamanho da
entrada, para padrões que não precisam de lookaround nem de backreferences.
Limite também o tamanho da entrada antes de casar: um teto de 2 KB num campo de
formulário elimina a maior parte do perigo.

## Trade-offs

- **Código gerado aumenta o assembly.** Cada padrão adiciona C# compilado no seu
  projeto. Para um padrão usado uma vez na inicialização, o interpretador é mais
  simples e o custo dele não importa.
- **O padrão precisa ser constante em tempo de compilação.** Um padrão lido de
  configuração ou montado a partir de entrada do usuário não pode usar
  `[GeneratedRegex]`. Nesses casos, construa um `Regex` com timeout, e prefira
  `NonBacktracking` quando o próprio padrão não é confiável.
- **O fallback esconde a perda.** `NonBacktracking` e backreferences com
  `IgnoreCase` compilam sem reclamar, mas entregam um `Regex` comum. Confira o
  tipo, ou o código gerado, quando você escolheu o gerador por causa de AOT.
- **Um timeout limita o dano, mas gasta CPU até disparar.** Na demonstração cada
  requisição ruim custou seus 200 ms inteiros de um núcleo. Sob carga, um limite
  curto mais um teto de tamanho da entrada vale mais que um limite longo.
- **`RegexMatchTimeoutException` não é prova de ataque.** Um limite apertado numa
  máquina ocupada pode estourar para uma entrada inocente. Registre em log com o
  padrão (a exceção expõe `Pattern` e `MatchTimeout`), rejeite a requisição e não
  tente uma alternativa mais lenta.
- **Reescrever um padrão pode mudar o que ele aceita.** Trocar `(a+)+` por `a+` é
  seguro porque aceitam as mesmas strings, mas trocar um grupo por um grupo
  atômico pode rejeitar entradas que antes casavam por backtracking. Mantenha um
  teste com strings que casam e com strings hostis.
  ```csharp
  Regex.IsMatch("aab", @"(?>a+)ab");   // False: o grupo atômico fica com os dois a, então "ab" não casa
  Regex.IsMatch("aab", @"a+ab");       // True
  ```

## Lab

Neste lab você recebe `Patterns` com quatro regexes (três ainda sem implementação, uma construída do jeito antigo) e `InputValidator`, que valida texto não confiável contra o padrão vulnerável `^(a+)+$`. O seu trabalho é declarar as regexes com `[GeneratedRegex]`, ver quando o gerador cai para um `Regex` comum e defender o validador contra backtracking catastrófico (ReDoS) com timeout, um padrão mais seguro e um limite de tamanho. A ideia central é que um timeout é uma rede de segurança, não a correção.

**O cenário**

Uma entrada hostil de 41 caracteres (`aaaa...!`) não pode prender um núcleo de CPU. Os testes nunca dependem de execuções lentas: só do timeout disparando ou do padrão corrigido respondendo na hora.

- `Patterns.cs`, `Date()`: deve capturar os grupos nomeados `y`, `m` e `d` de textos como `2025-11-11`.
- `Patterns.cs`, `Legacy()`: o padrão vulnerável `^(a+)+$` com timeout de 200 ms, hoje criado com `new Regex`.
- `Patterns.cs`, `Safe()` e `Linear()`: as duas defesas, um padrão reescrito e o mesmo texto no motor sem backtracking.
- `InputValidator.cs`: `Check`, que devolve `Valid`, `Invalid`, `TooLong` ou `TimedOut`, com `MaxLength = 2048`.

**O que você vai fazer, passo a passo**

1. **Gerar a regex de data (TODO-00).** Transforme `Date()` num método `partial` com `[GeneratedRegex]` (a classe já é `partial`), com os grupos `y`, `m` e `d`. O gerador devolve a mesma instância em cache e um tipo derivado de `Regex`.
2. **Gerar o padrão vulnerável mantendo o timeout (TODO-01).** Faça `Legacy()` ser gerado, preservando os 200 ms. Com a entrada hostil ele deve lançar `RegexMatchTimeoutException`.
3. **Escrever um padrão seguro (TODO-02).** Reescreva o padrão para aceitar exatamente as mesmas strings de `Legacy()`, mas sem backtracking catastrófico, gerado com timeout de 1000 ms (rede de segurança, não a correção).
4. **Trocar de motor (TODO-03).** Mantenha o texto do padrão de `Legacy`, mas rode no motor não-backtracking e gere o método. Depois confira que tipo o gerador realmente devolveu.
5. **Proteger o validador (TODO-04 e TODO-05).** Em `InputValidator.Check`, rejeite primeiro entradas acima de `MaxLength`, antes de rodar qualquer regex. Depois case com `Patterns.Legacy()` e converta `RegexMatchTimeoutException` em `ValidationResult.TimedOut`, em vez de deixá-la escapar.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `Safe()` e `Linear()` aceitam a entrada hostil sem timeout e qual tipo `Linear()` devolve (e o que isso diz sobre o que o gerador consegue fazer).

**Desafios opcionais**

- **TODO-06:** adicione uma propriedade `partial Regex DateProp { get; }` só de leitura com o mesmo padrão de `Date()` (propriedades parciais, C# 13).
- **TODO-07:** adicione `Patterns.CountDates(string text)` usando `Regex.Count` sobre `Date()`.
- **TODO-08:** crie um `.editorconfig` que eleva `SYSLIB1045` a warning, escreva uma chamada `new Regex("\\d+")` e leia a saída do build.

**Pré-requisitos:** noções de `System.Text.RegularExpressions`, métodos `partial` em C# e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos ainda não implementados lançam `NotImplementedException` e os comentários `TODO-NN` dizem o que fazer, então os testes vermelhos são o seu checklist.

## Documentation Links

- [.NET regular expression source generators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators) (doc)
- [GeneratedRegexAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.generatedregexattribute) (doc)
- [SYSLIB diagnostics for regex source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib1040-1049) (doc)
- [Backtracking in .NET regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/backtracking-in-regular-expressions) (doc)
- [Best practices for regular expressions in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex) (doc)
- [Regex.MatchTimeout property, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.regex.matchtimeout) (doc)
