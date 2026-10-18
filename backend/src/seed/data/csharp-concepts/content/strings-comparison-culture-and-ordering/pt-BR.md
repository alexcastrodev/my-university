---
version: 1.0
updatedAt: 2026-10-14
title: "Strings: Comparação, Cultura e Ordenação"
summary: Comparação ordinal versus cultural, StringComparison, StringComparer e CompareOptions, o novo NumericOrdering do .NET 10, o que o modo invariante de globalização muda em silêncio e imutabilidade e internamento de strings.
---
## Objective

Comparar duas strings parece uma operação só, mas o .NET tem duas bem
diferentes por trás. A comparação ordinal olha para code units UTF-16 e mais
nada: é rápida, exata e igual em qualquer máquina. A comparação sensível a
cultura pergunta à biblioteca de globalização (ICU no Linux e no macOS, ICU ou
NLS no Windows) como um idioma quer o texto ordenado, e a resposta depende da
cultura, da versão da biblioteca e até de o container ter ICU ou não. Este
conceito cobre quando cada uma é a certa, como `StringComparison`,
`StringComparer` e `CompareOptions` se mapeiam nelas, a opção
`CompareOptions.NumericOrdering` do .NET 10 que põe "file2" antes de "file10",
o que o modo invariante de globalização muda em silêncio e por que strings são
imutáveis e às vezes internadas.

## Use Cases

- Escolher a comparação para chaves de dicionário, nomes de arquivo, headers e
  identificadores (ordinal) versus nomes exibidos numa lista ordenada para uma
  pessoa (cultural).
- Ordenar rótulos numerados ou parecidos com versão, como "Windows 8",
  "Windows 10", "file07.txt", do jeito que um humano espera.
- Depurar código que funciona no notebook e quebra numa imagem Docker sem ICU ou
  rodando com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.
- Corrigir o bug do i turco, em que `ToLower()` ou uma comparação sem distinção
  de maiúsculas muda de comportamento conforme o locale do usuário.

## Deep Dive

### Ordinal versus cultural

`string.Equals(a, b)` e `==` são ordinais. Métodos que não recebem
`StringComparison`, como `Compare`, `CompareTo`, `StartsWith` e
`IndexOf(string)`, são sensíveis a cultura por padrão, e essa inconsistência é a
raiz de muitos bugs. A regra prática: passe a comparação explicitamente.

```csharp
Console.WriteLine(string.Equals("é", "é"));                                   // False (o padrão é ordinal)
Console.WriteLine(string.Equals("é", "é", StringComparison.InvariantCulture)); // True  (e + acento combinante == e acentuado pré-composto)
Console.WriteLine(string.Equals("é", "é", StringComparison.Ordinal));          // False
Console.WriteLine("ab".Equals("a­b", StringComparison.InvariantCulture));            // True  (hífen suave tem peso zero)
Console.WriteLine("ab".IndexOf("­", StringComparison.InvariantCulture));             // 0     (achou "nada" no índice 0)
Console.WriteLine("ab".IndexOf("­", StringComparison.Ordinal));                      // -1
```

Uma comparação linguística trata sequências canonicamente equivalentes como
iguais e ignora caracteres de peso zero, o que é certo para texto humano e
errado para uma checagem de segurança, um caminho de arquivo ou uma chave de
cache. A comparação ordinal também é a mais barata, porque pode comparar a
memória diretamente. `OrdinalIgnoreCase` dá casamento sem distinção de
maiúsculas sem consulta de cultura e é o padrão certo para identificadores,
extensões de arquivo e nomes de header HTTP.

A ordenação mostra a outra diferença. As mesmas seis palavras, ordenadas de três
jeitos (saída real no .NET 10, macOS com ICU):

```csharp
string[] words = ["zebra", "Apple", "apple", "Zebra", "äpple", "Äpple"];
// Ordinal : Apple, Zebra, apple, zebra, Äpple, äpple     (por code unit: maiúsculas, minúsculas, depois acentos)
// en-US   : apple, Apple, äpple, Äpple, zebra, Zebra     (palavras com a juntas, caixa como desempate)
// sv-SE   : apple, Apple, zebra, Zebra, äpple, Äpple     (em sueco, ä é uma letra depois do z)
```

### StringComparison, StringComparer e CompareOptions

Três tipos expressam a mesma escolha em níveis diferentes:

- `StringComparison` é o enum que você passa para uma chamada: `Ordinal`,
  `OrdinalIgnoreCase`, `CurrentCulture`, `CurrentCultureIgnoreCase`,
  `InvariantCulture`, `InvariantCultureIgnoreCase`.
- `StringComparer` é um objeto que implementa `IComparer<string>` e
  `IEqualityComparer<string>`. É o que você entrega a `Dictionary`, `HashSet`,
  `Order` e `Sort`. `StringComparer.Ordinal` e `OrdinalIgnoreCase` já vêm
  prontos; `StringComparer.Create(culture, options)` monta um cultural.
- `CompareOptions` é o conjunto de flags usado por `CompareInfo` e por
  `StringComparer.Create` para refinar uma comparação cultural: `IgnoreCase`,
  `IgnoreNonSpace` (diacríticos), `IgnoreSymbols`, `IgnoreWidth`,
  `IgnoreKanaType` e, no .NET 10, `NumericOrdering`. `Ordinal` e
  `OrdinalIgnoreCase` também são membros, mas não podem ser combinados com os
  outros (a chamada lança `ArgumentException`).

O problema do i turco é o que acontece quando uma comparação cultural é usada
onde se queria uma ordinal:

```csharp
var tr = new CultureInfo("tr-TR");
Console.WriteLine("TITLE".ToLower(tr));         // tıtle  (i sem ponto)
Console.WriteLine("TITLE".ToLowerInvariant());  // title
```

Use `ToLowerInvariant`/`ToUpperInvariant` ou comparers ordinais para texto de
protocolo, e deixe a caixa sensível a cultura para texto que uma pessoa lê.

### NumericOrdering, novo no .NET 10

Por padrão, uma comparação cultural ordena dígito a dígito, então "10" vem antes
de "2". `CompareOptions.NumericOrdering` compara cada sequência de dígitos
decimais Unicode (categoria `Nd`) pelo valor numérico. A página "What's new in
.NET 10 libraries" documenta a opção, com `"2"` e `"02"` iguais e `"Windows 8"`
antes de `"Windows 10"`.

```csharp
string[] files = ["file10.txt", "file2.txt", "file1.txt", "file07.txt", "file7.txt"];
var numeric = StringComparer.Create(CultureInfo.InvariantCulture, CompareOptions.NumericOrdering);

Console.WriteLine(string.Join(", ", files.Order(StringComparer.InvariantCulture)));
// file07.txt, file1.txt, file10.txt, file2.txt, file7.txt
Console.WriteLine(string.Join(", ", files.Order(numeric)));
// file1.txt, file2.txt, file07.txt, file7.txt, file10.txt

var info = CultureInfo.InvariantCulture.CompareInfo;
Console.WriteLine(info.Compare("7", "10"));                                  // 1
Console.WriteLine(info.Compare("7", "10", CompareOptions.NumericOrdering));  // -1
Console.WriteLine(info.Compare("7", "07", CompareOptions.NumericOrdering));  // 0
Console.WriteLine(info.Compare("1.5", "1.10", CompareOptions.NumericOrdering)); // -1: "5" < "10", o ponto encerra o número
Console.WriteLine(info.Compare("-5", "-10", CompareOptions.NumericOrdering));   // -1: o menos não faz parte do número
```

Observações de quem rodou: como "7" e "07" são iguais, o `GetHashCode` do comparer
devolve o mesmo valor para os dois, então um `HashSet<string>` criado com ele
trata os dois como duplicata. Sinais e pontos decimais não fazem parte do
número, então isso não é um ordenador de versão semântica nem de decimais
("1.5" vem antes de "1.10"). A flag lança `ArgumentException` com `IndexOf`,
`IsPrefix` e os demais métodos baseados em índice, e com `Ordinal`.

### Modo invariante de globalização e ICU em containers

Imagens de container enxutas costumam vir sem ICU. O runtime então falha na
inicialização, a menos que você opte pelo modo invariante
(`DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` ou
`<InvariantGlobalization>true</InvariantGlobalization>`). Esse modo remove a
dependência do ICU trocando o comportamento linguístico por comportamento
ordinal. O mesmo trecho, com e sem ele:

```csharp
// ICU                                         // Modo invariante
words.Order(StringComparer.InvariantCulture)   // apple, Apple, äpple, Äpple, zebra, Zebra  |  Apple, Zebra, apple, zebra, Äpple, äpple
Equals("é", "é", InvariantCulture)  // True                                      |  False
cmp.Compare("7", "10", NumericOrdering)        // -1                                        |  6
cmp.Compare("7", "07", NumericOrdering)        // 0                                         |  7
new CultureInfo("tr-TR")                       // funciona                                  |  CultureNotFoundException
```

Dois pontos chamam atenção. Nomes de cultura diferentes da invariante lançam
exceção, porque `PredefinedCulturesOnly` é true por padrão nesse modo. E o
`NumericOrdering` não falha: ele devolve em silêncio a diferença simples entre
caracteres (6 é `'7' - '1'`), então uma lista ordenada fica errada sem
exceção alguma. Se você depende de comportamento cultural, teste na mesma
imagem que vai para produção e prefira comparers ordinais explícitos onde a
cultura nunca foi a intenção. A documentação cita os analisadores CA1307 e
CA1309, que apontam chamadas sem `StringComparison`.

### Imutabilidade e internamento

Uma `string` nunca muda depois de criada, o que a torna segura para compartilhar
entre threads e para usar como chave de dicionário (o hash code é estável).
Constantes de compilação ficam guardadas uma vez num pool de internamento, então
literais idênticos compartilham um objeto. Uma string montada em tempo de
execução é outro objeto, a menos que você a interne:

```csharp
string a = "hello", b = "hel" + "lo", c = new string(['h', 'e', 'l', 'l', 'o']);
Console.WriteLine(ReferenceEquals(a, b));                  // True  (o compilador dobrou em um literal)
Console.WriteLine(ReferenceEquals(a, c));                  // False
Console.WriteLine(ReferenceEquals(a, string.Intern(c)));   // True
```

Confie em `==` ou `Equals` para igualdade, não em identidade de referência.
`string.Intern` raramente vale a pena: strings internadas vivem até o fim do
processo.

## Trade-offs

- **Ordinal é rápido e previsível, mas não é linguístico.** Ele ordena "Zebra"
  antes de "apple" e trata "é" e "é" como strings diferentes. Para
  listas ordenadas voltadas ao usuário, use uma cultura
  (`StringComparer.Create(culture, CompareOptions.None)`).
- **A comparação cultural depende do ambiente.** Versões do ICU e dados do CLDR
  mudam regras de ordenação entre releases e entre máquinas, então uma ordem
  persistida, ou um resultado de comparação cultural usado como chave, pode
  mudar depois de uma atualização do SO ou da imagem.
- **`NumericOrdering` resolve "file10", mas não "version 1.10".** Os dígitos são
  comparados como números inteiros, mas pontos e sinais encerram a sequência,
  então "1.5" vem antes de "1.10" só porque 5 < 10, e "-5" ainda vem antes de
  "-10", o oposto da ordem numérica. Para versões use `Version.Parse`, para
  números faça o parse.
- **`NumericOrdering` faz "7" ser igual a "07".** Isso é uma vantagem para
  ordenar, mas um risco num dicionário: `new Dictionary<string, T>(numeric)`
  funde chaves que diferem como texto.
- **O modo invariante troca correção por portabilidade.** O app sobe sem ICU e a
  imagem fica menor, mas comparações culturais viram ordinais, `new
  CultureInfo("tr-TR")` lança exceção e `NumericOrdering` devolve respostas
  erradas sem lançar nada.
- **Internar só economiza memória para strings repetidas.** `string.Intern` em
  entrada de usuário faz crescer um pool que nunca é liberado; um
  `Dictionary<string,string>` local como cache de deduplicação pode ser
  descartado.

## Lab

Neste lab você recebe `TextOps`, uma classe com **oito operações pequenas de texto** que lançam `NotImplementedException`. Cada uma tem uma comparação certa, e os testes alimentam textos em que as escolhas discordam: maiúscula contra minúscula, `é` pré-composto contra `e` mais acento combinante, hífen suave, o `I` turco e `file10` contra `file2`. A ideia central é decidir, caso a caso, entre comparação ordinal (para máquinas) e cultural (para pessoas), sem cair em bugs que dependem do locale.

**O cenário**

Textos que precisam ser ordenados, comparados e normalizados, uns para identificadores e protocolos, outros para gente ler.

- `TextOps.SortForPerson` e `SortOrdinal`: a ordenação cultural contra a por unidade de código UTF-16.
- `TextOps.SameIdentifier`, `SameText` e `LowerProtocol`: igualdade sem cultura, igualdade para pessoas e minúsculas sem depender do locale.
- `TextOps.NaturalOrder`: ordem numérica, para `file2` vir antes de `file10`.
- `TextOps.ContainsIgnoringAccents` e `Canonical`: busca ignorando acentos e caixa, e a instância internada de uma string.

Os testes culturais precisam de ICU, presente numa instalação normal de macOS, Linux ou Windows. Num container sem ICU, ou com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`, eles falham de propósito (veja o desafio opcional).

**O que você vai fazer, passo a passo**

1. **Ordenar do jeito que a pessoa espera (TODO-00).** Em `SortForPerson`, crie um comparer cultural com `StringComparer.Create(culture, CompareOptions.None)` e ordene com ele. Em inglês `äpple` fica junto de `apple`, em sueco o `ä` vem depois do `z`.
2. **Ordenar igual em qualquer máquina (TODO-01).** `SortOrdinal` ordena por unidade de código UTF-16.
3. **Comparar identificadores sem cultura (TODO-02).** `SameIdentifier` ignora a caixa sem nenhuma consulta de cultura, como em nomes de header e extensões (`OrdinalIgnoreCase`).
4. **Comparar texto para pessoas (TODO-03).** `SameText` trata como iguais sequências canonicamente equivalentes (`e` com acento combinante contra a letra pré-composta) e caracteres de peso zero, usando a cultura invariante.
5. **Minúsculas de protocolo (TODO-04).** `LowerProtocol` não pode depender da cultura atual: `"TITLE"` vira `"title"` até sob `tr-TR`.
6. **Ordem natural e busca sem acento (TODO-05 e TODO-06).** `NaturalOrder` usa o `CompareOptions.NumericOrdering` do .NET 10 com a cultura invariante. `ContainsIgnoringAccents` usa `CompareInfo.IndexOf` invariante com `CompareOptions.IgnoreNonSpace | IgnoreCase`.
7. **Internar a string (TODO-07).** `Canonical` devolve a instância do pool, para strings iguais compartilharem um só objeto.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar quando usar ordinal e quando usar cultural, e por que o `LowerProtocol` falharia na Turquia se usasse a cultura atual.

**Desafios opcionais**

- **TODO-08:** rode os testes prontos com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`. Quais falham, e qual devolveria em silêncio uma resposta errada em produção?

**Pré-requisitos:** strings e LINQ em C#, noções de `CultureInfo` e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário, então os testes vermelhos mostram o que falta.

## Documentation Links

- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
- [CompareOptions enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.compareoptions) (doc)
- [What's new in .NET libraries for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [.NET globalization and ICU, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) (doc)
- [StringComparer class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.stringcomparer) (doc)
- [.NET globalization invariant mode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
