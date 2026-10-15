---
version: 1.0
updatedAt: 2026-10-15
title: "Construir e Buscar Strings com Eficiência"
summary: StringBuilder versus concatenação em laço, string.Create e spans, ArrayPool, SearchValues para busca vetorizada (incluindo substrings no .NET 9) e como medir antes de otimizar.
---
## Objective

Strings são imutáveis, então toda "alteração" aloca uma nova, e o jeito óbvio de
procurar várias coisas ao mesmo tempo é um laço de chamadas a `IndexOf`. Os dois
funcionam num script avulso e custam caro num caminho quente. Este conceito mostra
as ferramentas do .NET para montar texto sem gerar uma pilha de lixo
(`StringBuilder`, `string.Create`, spans, `ArrayPool<T>`) e para buscar nele com
código vetorizado (`SearchValues<T>`), além de como medir em vez de chutar. Ele
continua o conceito de comparação de strings: toda busca aqui é ordinal.

## Use Cases

- Montar um relatório grande, um CSV ou uma linha de log a partir de milhares de
  pedaços dentro de um laço.
- Formatar um identificador ou um campo de largura fixa direto na `string` final,
  sem cópias intermediárias.
- Varrer cada requisição ou linha de log atrás de um conjunto de caracteres ou
  palavras proibidas, muitas vezes por segundo.
- Revisar um PR que "otimiza" código de string e decidir se a mudança é real ou só
  parece mais rápida.

## Deep Dive

### Concatenação em laço versus StringBuilder

`s += x` cria uma string nova a cada vez, copiando tudo que já foi montado, então
um laço de n acréscimos faz cópia O(n²). O `StringBuilder` mantém um buffer em
pedaços (chunks) e acrescenta em tempo constante amortizado, e você paga uma cópia
final no `ToString()`:

```csharp
const int N = 20000;
var sw = Stopwatch.StartNew();
string c = ""; for (int i = 0; i < N; i++) c += "x";
Console.WriteLine($"concat {sw.ElapsedMilliseconds}ms len {c.Length}");   // concat 12ms len 20000
sw.Restart();
var b2 = new StringBuilder(); for (int i = 0; i < N; i++) b2.Append("x");
Console.WriteLine($"sb {sw.ElapsedMilliseconds}ms len {b2.Length}");      // sb 0ms len 20000
```

Esses números vêm de uma execução num notebook, e um laço com `Stopwatch` feito à
mão é só um teste de fumaça (mais sobre isso abaixo). O que importa é a forma: a
linha da concatenação cresce de modo quadrático com N, a do builder não. Uma única
expressão como `"id=" + id + ";" + name` não é o problema; são poucos pedaços
fixos, não um laço. Uma string interpolada (`$"..."`) também é boa nesse caso.

O `StringBuilder` tem alguns detalhes que valem conhecer. `Append` devolve o
próprio builder, então as chamadas encadeiam, e `Append('x', 3)` repete um
caractere. Um builder novo começa com capacidade 16 e cresce adicionando chunks,
então passe o tamanho esperado ao construtor se você o souber. Para builders muito
grandes, `GetChunks()` entrega os pedaços como `ReadOnlyMemory<char>`, para
gravá-los num stream sem nunca chamar `ToString()`.

### string.Create e spans: formatar direto no resultado

Quando o tamanho final é conhecido, `string.Create` aloca a `string` uma vez e
deixa você preencher os caracteres por um `Span<char>`, sem builder temporário:

```csharp
string hex = string.Create(8, 0xBEEF, (span, v) => v.TryFormat(span, out _, "X8"));
Console.WriteLine(hex);     // 0000BEEF

int n = 42;
Span<char> stack = stackalloc char[32];
bool ok = stack.TryWrite($"id={n:D5}", out int w);   // interpolação dentro de um span
Console.WriteLine(stack[..w].ToString());             // id=00042
```

O argumento de estado (`0xBEEF` aqui) existe para que a lambda não precise
capturar nada, o que permite um delegate estático e sem alocação. `TryWrite` com
string interpolada formata em qualquer `Span<char>`, aqui um pequeno buffer de
`stackalloc`, e devolve `false` se o texto não coube. Use a pilha só para tamanhos
pequenos e limitados. É a mesma mecânica de spans do conceito de span, aplicada a
texto.

### Alugando buffers com ArrayPool

Para buffers temporários médios ou grandes, alugar vence alocar:

```csharp
char[] buf = ArrayPool<char>.Shared.Rent(10);
Console.WriteLine(buf.Length);       // 16: pelo menos o tamanho pedido
ArrayPool<char>.Shared.Return(buf);
```

A documentação diz que o array tem "pelo menos o tamanho pedido" e "pode não estar
zerado". Sempre fatie para o tamanho de que você realmente precisa, nunca confie em
`buf.Length` nem no conteúdo inicial, e devolva num `finally` para que uma falha não
vaze o buffer. Esquecer de devolver não é fatal, o pool só aloca um substituto, mas
você perde o benefício. Não use o buffer depois do `Return`: outro chamador pode já
ser o dono. Se o buffer guardou segredos, passe `clearArray: true` ao `Return`.

### SearchValues: um "qualquer um destes" vetorizado

Procurar um entre vários caracteres com `IndexOfAny("aeiou")` reanalisa o conjunto a
cada chamada. O `SearchValues<T>` faz essa análise uma vez, na criação, e escolhe um
algoritmo que pode usar SIMD. Crie uma vez, guarde num campo `static readonly` e use
com os métodos de busca de span:

```csharp
var vowels = SearchValues.Create("aeiou");
Console.WriteLine("rhythm and blues".AsSpan().IndexOfAny(vowels));   // 7

var words = SearchValues.Create(["error", "fatal"], StringComparison.OrdinalIgnoreCase);
Console.WriteLine("all ok, then FATAL happened".AsSpan().IndexOfAny(words));  // 13
Console.WriteLine("nothing".AsSpan().ContainsAny(words));                    // False
```

A sobrecarga que recebe strings devolve um `SearchValues<string>` e busca
substrings, não só caracteres. Segundo a documentação da API ela existe a partir do
.NET 9, e só `Ordinal` ou `OrdinalIgnoreCase` podem ser usados. As sobrecargas de
char e byte existem desde o .NET 8. O tipo concreto por trás da instância é detalhe
de implementação que o runtime escolhe a partir da sua entrada (nesta execução, um
especializado em ASCII), então não dependa dele.

### Meça, depois decida

Aqui está a mesma tarefa, achar a primeira de quatro palavras-chave, com um laço de
`IndexOf` e com `SearchValues`, sobre uma string de 9 KB, 20.000 iterações depois de
um aquecimento:

```
loop: 90.3 ms
searchvalues: 43.3 ms
```

Cerca de 2x nesta entrada e nesta máquina; a diferença muda com o tamanho do texto,
com a posição do primeiro acerto e com o conjunto de palavras. Esse é o ponto: não
carregue o número, carregue o hábito. Para decisões reais use o BenchmarkDotNet, que
cuida de aquecimento, tiers do JIT, ruído do GC e estatística, e pode reportar
alocações por operação com `[MemoryDiagnoser]`. Um laço de cronômetro como o acima
serve para conferir a ordem de grandeza, nunca para publicar uma conclusão.

## Trade-offs

- **`StringBuilder` não é de graça em trabalho pequeno.** Para três ou quatro
  pedaços conhecidos, um `+` simples ou uma string interpolada é mais rápido e mais
  claro, porque o builder é ele mesmo um objeto no heap. Use quando o número de
  acréscimos é desconhecido ou chega aos milhares.
- **`string.Create` e `stackalloc` trocam legibilidade por alocações.** Use onde o
  profiler apontar, como formatar milhões de identificadores. Um `stackalloc` de
  algumas centenas de chars é tranquilo; com um tamanho controlado por alguém de fora
  pode estourar a pilha.
- **Arrays do pool são estado mutável compartilhado.** Um bug que lê depois do
  `Return`, ou supõe memória zerada, gera dado corrompido longe da causa. Prefira a
  alocação simples até que ela apareça numa medição.
- **`SearchValues` paga na criação.** Construir um custa mais que uma busca avulsa,
  então criá-lo dentro do método quente anula o ganho. Uma busca rara numa string
  curta não compensa.
- **A busca vetorizada é ordinal.** `SearchValues<string>` não faz comparação com
  cultura. Para busca linguística, visível ao usuário, você ainda precisa dos métodos
  com cultura e do custo deles.

## Documentation Links

- [StringBuilder class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.stringbuilder) (doc)
- [String.Create method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.string.create) (doc)
- [SearchValues class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.searchvalues) (doc)
- [ArrayPool<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
