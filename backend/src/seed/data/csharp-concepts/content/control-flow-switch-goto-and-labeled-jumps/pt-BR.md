---
version: 1.0
updatedAt: 2026-11-12
title: "Fluxo de Controle: switch, goto e Saltos com Rótulo"
summary: O switch statement e a proibição de fall-through, goto case e goto default, goto com rótulo e o break e continue com rótulo do C# 15 (estável no SDK 11.0.100), com os erros reais do compilador e a escolha entre rótulo, flag e função local.
---
## Objective

O C# tem quatro formas de sair da linha de execução atual sem retornar: `break`,
`continue`, `goto` e (dentro de um `switch` statement) `goto case`. Este concept
cobre o **statement** `switch` e a regra de não haver fall-through, `goto case` e
`goto default`, `goto` com rótulo, e o `break` e `continue` com rótulo do C# 15,
que deixam um statement aninhado sair de um laço externo, ou continuá-lo, sem
variável de flag nem `goto`. `break` e `continue` com rótulo são uma feature
estável no C# 15 (SDK 11.0.100, sem precisar de `LangVersion` preview). A
expressão `switch` e os patterns estão em `type-constant-and-relational-patterns`;
aqui o assunto é o statement e os saltos. Todo código de erro e saída abaixo foi
compilado no SDK 11.0.100.

## Use Cases

- Sair de dois ou três laços aninhados assim que uma busca tem sucesso.
- Pular para a próxima linha (ou o próximo arquivo, ou o próximo registro) de
  dentro de um laço interno.
- Um `switch` em que um case continua deliberadamente em outro, por exemplo
  níveis ou permissões que incluem os de baixo.
- Um laço `while` cujo corpo é um `switch` que precisa conseguir continuar ou
  parar o laço, e não só o switch.
- Ler comentários de code review como "troque essa flag por um rótulo" e decidir
  se o rótulo é mais claro.

## Deep Dive

### O `switch` statement e o fim do fall-through

Em um `switch` statement, toda seção precisa terminar em um statement que não
alcance o próximo rótulo: `break`, `return`, `throw`, `continue` ou um `goto`. Se
uma seção cai pelo fim, o compilador recusa:

```csharp
switch (n)
{
    case 1:
        Console.WriteLine("one");
    case 2:               // error CS0163: Control cannot fall through from one case label ('case 1:')
        Console.WriteLine("two");
        break;
}
```

A última seção tem a mesma regra, reportada como `CS8070`. Empilhar rótulos sem
statements entre eles é permitido, porque não há código para cair:

```csharp
case 0:
case -1:
    text = "none";
    break;
```

Outras checagens vêm da mesma análise: uma constante repetida é `CS0152`, e um
`goto case 5;` para um rótulo que não existe é `CS0159: No such label 'case 5:'
within the scope of the goto statement`. Uma cláusula `when` funciona também no
statement (`case int n when n > 10:`), e um `case` pode ser um pattern, então o
switch statement compartilha a sintaxe de patterns com a expressão.

### `goto case` e `goto default`

Quando você quer a continuação estilo C, você diz isso:

```csharp
static string Tier(int n)
{
    string r = "";
    switch (n)
    {
        case 3: r += "gold ";   goto case 2;
        case 2: r += "silver "; goto case 1;
        case 1: r += "bronze";  break;
        case 0:
        case -1: r = "none";    break;
        default: r = "?";       break;
    }
    return r;
}
// 3: "gold silver bronze", 2: "silver bronze", 1: "bronze", 0: "none", 9: "?"
```

`goto default;` salta para a seção default, útil quando um case com pattern
(`case int:`) decide que, no fim, não trata a entrada. Com `F(50)`, `F(1)`,
`F("x")` e `F(2.5)` sobre um switch com `case int n when n > 10`,
`case int: goto default;`, `case string s` e `default`, os resultados são `big`,
`other`, `s:x` e `other`. Quando a continuação é na verdade uma consulta, uma
**expressão** `switch` costuma ler melhor, porque não tem saltos:
`k switch { 3 => "gold silver bronze", 2 => "silver bronze", _ => "?" }`.

### `goto` com rótulo

`goto label;` salta para um statement com rótulo no mesmo método, no mesmo bloco
ou em um bloco que o envolve. Não dá para saltar para dentro de um bloco:

```csharp
goto inside;
{
    inside: Console.WriteLine();   // error CS0159: No such label 'inside'
}
```

Um rótulo nunca usado é `CS0164` (warning), um duplicado é `CS0140` e um ausente é
`CS0159`. Os usos legítimos clássicos são pequenos: um retry escrito como salto
para trás (um laço costuma ser mais claro) e, antes do C# 15, sair de laços
aninhados:

```csharp
int found = -1;
for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++)
        if (i * j == 2) { found = i * 10 + j; goto done; }
done:
Console.WriteLine(found);   // 12
```

Esse é o caso que o `break` com rótulo substituiu na maior parte do código.
Prefira-o agora, a menos que o salto vá para algo que não é a saída de um laço.

### `break` e `continue` com rótulo (C# 15)

Um rótulo antes de um laço (`for`, `foreach`, `while`) ou de um `switch` pode ser
alvo de `break` ou `continue` de qualquer ponto dentro dele:

```csharp
int visited = 0;
int[][] grid = [[1, 0, 1], [2, 3, 9], [4, 5, 6]];
outer:
for (int r = 0; r < grid.Length; r++)
{
    for (int c = 0; c < grid[r].Length; c++)
    {
        visited++;
        if (grid[r][c] == 0) continue outer;   // próxima linha
        if (grid[r][c] == 3) break outer;      // sai dos dois laços
    }
}
// visited é 4
```

`foreach` funciona igual (um `continue rows;` sobre `foreach` aninhados contou 8
células na mesma grade, porque cada 0 pula o resto da sua linha). Um `switch`
também pode ter rótulo, o que importa dentro de um laço, porque um `break` simples
em uma seção do switch só sai do switch:

```csharp
int i = 0;
loop:
while (i < 10)
{
    i++;
    sw:
    switch (i)
    {
        case 2: continue loop;   // próxima iteração do while
        case 4: break sw;        // sai do switch, depois imprime
        case 6: break loop;      // sai do while
        default: break;
    }
    Console.WriteLine($"after switch i={i}");
}
// imprime para i = 1, 3, 4, 5; termina com i 6
```

As regras, a partir dos erros que o compilador deu:

| Código | Caso |
|---|---|
| `CS9393` | `break nope;` sem laço ou switch envolvente com esse rótulo |
| `CS9393` | o rótulo está em um `if` ou bloco, não em um laço ou switch |
| `CS9393` | o salto está dentro de uma função local e o rótulo fica fora dela |
| `CS1632` | o salto está dentro de uma lambda: o controle não pode sair de um método anônimo |
| `CS0140` | dois rótulos com o mesmo nome em um método |
| `CS0164` | warning: um rótulo que nada referencia |
| `CS9327` | o projeto está em `LangVersion` 14 |

É uma feature só de compilador, como o `with(...)` em
`collection-expressions-spread-and-with-arguments`: o IL emitido são desvios
comuns, então compila para frameworks alvo mais antigos com `LangVersion` 15 no
SDK 11. O panorama está em `whats-new-in-csharp-15`.

### Escolhendo: rótulo, flag, função local ou exceção

O mesmo problema de "sair de dois laços" tem quatro soluções:

- **Uma flag** (`bool found`) testada na condição de cada laço. Funciona em todo
  lugar, mas acrescenta estado, e um teste esquecido mantém o laço interno
  rodando.
- **Uma função local** que faz `return`. Muitas vezes a melhor: a busca vira um
  método com nome que devolve o resultado, sem salto nenhum (veja
  `local-functions-lambdas-and-closures`).
- **Um rótulo** (`break outer;`). Curto e visível, bom quando os laços estão em um
  método e a saída é um salto puro.
- **Uma exceção.** Nunca para fluxo de controle no caminho normal (veja
  `exceptions-try-catch-filters-and-finally`).

Um teste útil: se o código depois dos laços precisa da posição encontrada,
devolva-a de um método. Se só precisa saber que o laço terminou, um rótulo basta.

## Trade-offs

- **Saltos escondem a forma do laço.** Um `continue outer;` três níveis abaixo é
  fácil de ler errado. Mantenha curtos os laços com rótulo, dê ao rótulo o nome do
  que ele itera (`rows`, `files`) e extraia a parte interna se ela crescer.
- **Um rótulo precisa ser usado.** Um rótulo sem referência é `CS0164`. Trate o
  warning como sinal de que um refactor deixou estrutura morta.
- **Rótulos param nas fronteiras de método.** Uma lambda ou função local não
  consegue saltar para um rótulo fora dela (`CS1632`, `CS9393`), então mover o
  corpo de um laço para uma delas pode quebrar um `continue outer`.
- **Cadeias de `goto case` crescem.** É legal e explícito, mas uma cadeia longa
  é uma máquina de estados disfarçada. Se os cases são valores a consultar, use
  uma expressão `switch`.
- **Exige o C# 15.** Projetos no SDK 10 recebem `CS9327` para saltos com rótulo.
  Até todo build estar no SDK 11, a flag ou a função local é a escolha portável.
- **`break` dentro de `switch` não é `break` do laço.** O bug mais comum em laços
  com switch é escrever `break` esperando que o laço pare. Coloque rótulo no laço.

## Lab

Escreva cinco rotinas pequenas que precisam de saltos que um `break` ou `continue` simples não expressa: um switch statement com `goto case`, um retry com rótulo e `goto`, uma busca em grade que sai de dois laços, uma varredura de linhas com `continue` rotulado e um laço de comandos com um switch dentro.

**O cenário**

Um projeto de biblioteca (`Flow.cs`) e um projeto de testes. O starter tem stubs com `NotImplementedException` e comentários descrevendo cada rotina.

**O que você vai fazer, passo a passo**

1. **goto case (TODO-00).** `Flow.Tier`: o `3` também ganha os níveis de baixo.
2. **goto com rótulo (TODO-01).** `Flow.Retry` com um salto para trás.
3. **break com rótulo (TODO-02).** `Flow.FindFirst` sai dos dois laços e conta as células visitadas.
4. **continue com rótulo (TODO-03).** `Flow.CountOpenCells` pula o resto da linha depois de um 0.
5. **Rótulo em volta de um switch (TODO-04).** `Flow.RunCommands`: `continue loop;` e `break loop;` de dentro do switch.

**Como saber que terminou**

`dotnet test` fica verde com 14 testes. Você deve conseguir explicar por que um `break` simples não pararia o laço no TODO-04.

**Desafios opcionais**

- Reescreva o TODO-02 com uma flag e com uma função local, e compare os três.
- Reproduza `CS9393`, `CS0140` e `CS1632`, e `CS9327` com `LangVersion` 14.

**Pré-requisitos:** laços, `switch` statements e o SDK do .NET 11 (os projetos miram `net11.0`).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo método stubado lança `NotImplementedException`, então os testes vermelhos são seu checklist.

## Documentation Links

- [Jump statements, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/jump-statements) (doc)
- [The switch statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/selection-statements#the-switch-statement) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
