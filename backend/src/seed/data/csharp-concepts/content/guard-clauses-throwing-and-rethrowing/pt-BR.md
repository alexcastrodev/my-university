---
version: 1.0
updatedAt: 2026-10-15
title: "Guard Clauses, Lançar e Relançar Exceptions"
summary: Erros de uso versus erros de execução, a família ThrowIf do .NET 6 ao 8, CallerArgumentExpression para guards próprios, throw helpers e inlining vistos na saída do JIT, DoesNotReturn e a análise de nulos, guards em métodos async e a diferença entre throw;, throw ex; e embrulhar a exception.
---
## Objective

O conceito anterior explicou como o runtime acha um handler. Este trata da
outra ponta: decidir quando um método deve lançar, como escrever as checagens
no começo de um método de forma curta e com boas mensagens, e como relançar
sem destruir a informação que o stack trace carrega. Ele cobre erros de uso
versus erros de execução, a família de helpers `ThrowIf`,
`CallerArgumentExpression` para guards próprios, por que throw helpers deixam
o caminho quente mais rápido (mostrado na saída do JIT), `[DoesNotReturn]` e a
análise de nulos, a armadilha do async em que o guard não lança na chamada, e
`throw;` versus `throw ex;` versus embrulhar.

## Use Cases

- Recusar um argumento `null`, vazio, negativo ou fora da faixa numa linha,
  com uma mensagem que nomeia a expressão exata.
- Escrever um guard reutilizável para uma regra de domínio que diz qual
  argumento a quebrou.
- Manter um método pequeno e muito chamado inlinável mesmo validando a
  entrada.
- Acrescentar contexto a uma falha de baixo nível sem perder a causa original.
- Fazer uma API async falhar no ponto da chamada, e não no `await`.

## Deep Dive

### Erros de uso e erros de execução

Dois tipos de falha merecem tratamentos diferentes. Um **erro de uso** é um bug
de quem chama: passar `null` onde um valor é obrigatório, um índice além do
fim, chamar `Read` num stream já descartado. A exception
(`ArgumentException`, `ArgumentNullException`, `ArgumentOutOfRangeException`,
`InvalidOperationException`, `ObjectDisposedException`) existe para ser vista
por um desenvolvedor e corrigida no código, não para ser capturada e tratada.
Um **erro de execução** vem do mundo lá fora: arquivo que não existe, conexão
que caiu, timeout. Essas (`IOException`, `HttpRequestException`,
`TimeoutException`) são as que um programa captura, no nível que consegue
tentar de novo, usar um plano B ou reportar.

Essa divisão responde "onde eu capturo?". Erros de uso propagam até o handler
de topo (um middleware de erro do ASP.NET Core, o laço de um worker), onde são
logados como bugs. Erros de execução são capturados numa fronteira com
contexto suficiente para agir: o repositório que pode tentar de novo, o
endpoint que pode devolver 503. Capturar em todo método só adiciona ruído e
costuma engolir informação.

Alguns tipos são reservados ao runtime. Nunca lance você mesmo
`NullReferenceException`, `IndexOutOfRangeException`,
`AccessViolationException` ou `StackOverflowException` (regra de análise
CA2201), e não lance o `Exception` puro nem `SystemException`, que nenhum
chamador consegue capturar de forma seletiva.

### A família `ThrowIf`

Guard clauses costumavam ocupar quatro linhas cada. A BCL agora tem helpers
estáticos que checam e lançam:

| Helper | Desde |
|---|---|
| `ArgumentNullException.ThrowIfNull` | .NET 6 |
| `ArgumentException.ThrowIfNullOrEmpty` | .NET 7 |
| `ObjectDisposedException.ThrowIf` | .NET 7 |
| `ArgumentException.ThrowIfNullOrWhiteSpace` | .NET 8 |
| `ArgumentOutOfRangeException.ThrowIfNegative`, `ThrowIfZero`, `ThrowIfNegativeOrZero`, `ThrowIfEqual`, `ThrowIfNotEqual`, `ThrowIfLessThan`, `ThrowIfGreaterThan`, `ThrowIfLessThanOrEqual`, `ThrowIfGreaterThanOrEqual` | .NET 8 |

Os helpers de faixa são genéricos: `ThrowIfNegative` e `ThrowIfZero` aceitam
qualquer `INumberBase<T>`, e os de comparação (`ThrowIfLessThan`,
`ThrowIfGreaterThan`, ...) qualquer `IComparable<T>`, então funcionam também
com `DateTime` e com seus próprios tipos comparáveis. Nenhum deles pede o nome
do parâmetro, e mesmo assim as mensagens trazem a expressão inteira (cultura
invariante):

```csharp
static void Place(Order order)
{
    ArgumentNullException.ThrowIfNull(order);
    ArgumentNullException.ThrowIfNull(order.Customer);
    ArgumentException.ThrowIfNullOrWhiteSpace(order.Customer.Email);
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(order.Quantity);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(order.Discount, 0.5m);
}
// Value cannot be null. (Parameter 'order.Customer')
// The value cannot be an empty string or composed entirely of whitespace. (Parameter 'order.Customer.Email')
// order.Quantity ('0') must be a non-negative and non-zero value. (Parameter 'order.Quantity')
// Actual value was 0.
// order.Discount ('0.7') must be less than or equal to '0.5'. (Parameter 'order.Discount')
// Actual value was 0.7.
```

Os analisadores CA1510 a CA1513 apontam checagens escritas à mão que um desses
helpers pode substituir.

### `CallerArgumentExpression` nos seus guards

O truque por trás dessas mensagens é um atributo do C# 10. Um parâmetro marcado
com `[CallerArgumentExpression(nameof(value))]` recebe, em tempo de
compilação, o texto-fonte do argumento passado para `value`. O parâmetro
precisa ser opcional, e o compilador o preenche quando quem chama não passa
nada:

```csharp
static T NotDefault<T>([NotNull] T? value,
    [CallerArgumentExpression(nameof(value))] string? expr = null)
{
    if (value is null || EqualityComparer<T>.Default.Equals(value, default!))
        throw new ArgumentException($"'{expr}' must not be null or default.", expr);
    return value;
}

var id = Guid.Empty;
NotDefault(id);   // ArgumentException: 'id' must not be null or default. (Parameter 'id')
```

O `[NotNull]` avisa a análise de nulos que, se o método retornou, `value` não
era `null`, então quem chama não precisa de `!` depois.

### Expressões `throw`

Desde o C# 7.0, `throw` pode ser uma expressão, o que mantém guards simples
dentro de uma atribuição ou de um condicional:

```csharp
_name = name ?? throw new ArgumentNullException(nameof(name));
string first = args.Length > 0 ? args[0] : throw new ArgumentException("No arguments.");
```

### Throw helpers e inlining

Um `throw new X($"...")` gera bastante IL: montar a mensagem, chamar o
construtor, o `throw` em si. Esse código mora no método mesmo quase nunca
rodando, e deixa o método maior para o inlining. Levá-lo para um método
separado marcado com `[DoesNotReturn]` encolhe o chamador:

```csharp
static int GetInline(int[] a, int i)
{
    if ((uint)i >= (uint)a.Length)
        throw new ArgumentOutOfRangeException(nameof(i), i, $"Index must be below {a.Length}.");
    return a[i];
}

static int GetHelper(int[] a, int i)
{
    if ((uint)i >= (uint)a.Length) ThrowIndex(i, a.Length);
    return a[i];
}

[DoesNotReturn]
static void ThrowIndex(int i, int length) =>
    throw new ArgumentOutOfRangeException(nameof(i), i, $"Index must be below {length}.");
```

Com otimizações ligadas, `GetInline` tem 78 bytes de IL e `GetHelper`, 19. A
saída do JIT para um chamador que usa cada um duas vezes (.NET 10, arm64,
tiered compilation desligada para que a primeira compilação já seja otimizada)
mostra a diferença: o chamador de `GetInline` faz duas chamadas reais a ele,
enquanto o chamador de `GetHelper` tem as checagens de limite e as leituras
inlinadas, e as duas chamadas a `ThrowIndex` ficam em blocos separados no fim,
cada uma seguida de `brk #0`, porque o JIT sabe que elas nunca retornam. É o
padrão que a BCL usa nas classes `ThrowHelper`. Faz diferença em métodos
pequenos de caminho quente; num método de serviço comum, um `throw` simples
resolve.

### `[DoesNotReturn]` e a análise de nulos

O atributo também informa o compilador. Sem ele, um helper que sempre lança
parece uma chamada qualquer:

```csharp
static int LenA(string? s)
{
    if (s is null) FailPlain(nameof(s));
    return s.Length;   // warning CS8602: Dereference of a possibly null reference.
}

static int LenB(string? s)
{
    if (s is null) Fail(nameof(s));   // Fail is [DoesNotReturn]
    return s.Length;   // no warning
}
```

### Guards em métodos async e iteradores

Um método `async` guarda toda exception na `Task` devolvida, inclusive as da
primeira linha. O guard roda, mas quem chama não vê nada até dar `await`:

```csharp
static async Task SaveAsync(string path)
{
    ArgumentNullException.ThrowIfNull(path);
    await Task.Delay(10);
}

Task t1 = SaveAsync(null!);   // no exception here; t1.Status is Faulted
```

Para falhar na chamada, divida o método: um método externo, não async,
valida e devolve a task de uma função local async.

```csharp
static Task SaveEagerAsync(string path)
{
    ArgumentNullException.ThrowIfNull(path);   // throws at the call
    return Core();

    async Task Core() => await Task.Delay(10);
}
```

Métodos iteradores têm o mesmo problema pelo mesmo motivo (o corpo só roda na
enumeração), como mostra o conceito de execução adiada do LINQ; a correção é a
mesma divisão.

### `throw;`, `throw ex;` e embrulhar

Dentro de um `catch`, três formas de deixar a falha seguir dão três stack
traces diferentes. Rodando contra o mesmo `int.Parse` com falha, duas chamadas
abaixo:

```csharp
catch (Exception) { throw; }
//   at System.Int32.Parse(String s)
//   at Program.<<Main>$>g__Parse|0_5(String s)
//   at Program.<<Main>$>g__Load|0_4()
//   at ... (the method with the catch)

catch (Exception ex) { throw ex; }
//   at ... (the method with the catch)        <- Parse and Load are gone

catch (Exception ex) { throw new InvalidOperationException("Loading settings failed.", ex); }
//   InvalidOperationException
//   ---> System.FormatException: The input string 'x' was not in a correct format.
//   at System.Int32.Parse(String s) ... (full original trace)
//   --- End of inner exception stack trace ---
```

`throw ex;` reinicia o trace no método atual, o que quase nunca é o que você
quer (o analisador CA2200 aponta). `throw;` preserva. Embrulhar é o certo
quando você acrescenta significado ("o carregamento das configurações falhou")
numa fronteira de camada, desde que a original entre como `innerException`.
Para relançar fora do bloco `catch`, use `ExceptionDispatchInfo`, visto no
conceito anterior.

## Trade-offs

- **Proteja toda entrada pública, não toda linha privada.** Membros públicos e
  protegidos validam; helpers privados chamados só por código já validado
  podem confiar na entrada. Validar duas vezes custa mais tempo de leitura que
  de CPU.
- **Exception específica vale mais que mensagem esperta.** Quem chama consegue
  filtrar por `ArgumentOutOfRangeException`; não consegue filtrar por uma
  frase.
- **Embrulhar acrescenta contexto e profundidade.** Cada camada que embrulha
  deixa o log mais longo. Embrulhe onde o significado muda (de infraestrutura
  para domínio), não em toda chamada.
  ```csharp
  catch (IOException ex) { throw new SettingsUnavailableException("Settings file is unavailable.", ex); }
  ```
- **Throw helpers trocam legibilidade por velocidade.** Uma classe
  `ThrowHelper` se paga em bibliotecas e caminhos quentes; em código de
  aplicação, o `throw` simples lê melhor.
- **Guards checam argumentos, não resultados de negócio.** "Saldo
  insuficiente" é um resultado esperado de uma chamada válida, candidato a um
  tipo de resultado ou a uma exception de domínio, não a `ArgumentException`.

## Documentation Links

- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [Exception-handling statements: throw, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) (doc)
- [Tracking caller information: CallerArgumentExpression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/caller-information) (doc)
- [ArgumentOutOfRangeException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.argumentoutofrangeexception) (doc)
- [Attributes for null-state static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [CA2200: Rethrow to preserve stack details, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200) (doc)
