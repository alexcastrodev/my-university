---
version: 1.0
updatedAt: 2026-11-20
title: "SIMD no .NET: Vector<T>, Vector128/256/512 e Hardware Intrinsics"
summary: Por que o JIT não vetoriza um laço comum, Vector<T> e Vector128/256/512 com resto escalar, máscaras e ConditionalSelect, o padrão de despacho por IsHardwareAccelerated, AdvSimd no Apple Silicon, soma, contagem e busca de bytes medidas contra LINQ, span.Count, IndexOf e TensorPrimitives, as armadilhas de ponto flutuante e de leitura além do fim, e as operações de lane do .NET 11 (só na documentação).
---
## Objective

SIMD (uma instrução, vários dados) faz uma instrução da CPU trabalhar em 4, 8,
16 ou mais elementos de uma vez. O .NET expõe isso em camadas: `Vector<T>`
(largura escolhida pelo hardware), `Vector128<T>`, `Vector256<T>` e
`Vector512<T>` (largura fixa, portáveis), intrinsics de plataforma como
`AdvSimd` (Arm) e `Avx2` (x86), e `TensorPrimitives` (laços prontos). Mostra
que o JIT não vetoriza um laço comum, como escrever kernels de soma, contagem e
busca tratando o resto, e, com números, quando compensa e quando o framework já
fez o trabalho. Tudo rodou em um Apple M4 Max, então os caminhos de x64 (AVX2,
AVX-512) e as APIs do .NET 11 ficam marcados como "docs only".

Versions: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, BenchmarkDotNet
0.15.8, System.Numerics.Tensors 10.0.14, macOS arm64 (Apple M4 Max, NEON de 128
bits). O .NET 11 não está instalado aqui.

## Use Cases

- Somar, escalar ou comparar arrays numéricos grandes (sinais, pixels,
  embeddings) quando o laço é o caminho quente.
- Contar ou achar bytes em um buffer, o que `IndexOf` e `Count` já fazem.
- Trocar um desvio por elemento por uma máscara.

## Deep Dive

### O que o JIT não faz

Um registrador NEON tem 128 bits: 16 bytes, ou 4 ints ou floats. Um
`add v16.4s, v16.4s, v17.4s` soma quatro ints. O JIT não transforma um laço
escalar nisso. O `DOTNET_JitDisasm` de uma soma simples de ints mostra um
elemento por iteração, sem registrador vetorial:

```text
ldr     w4, [x0, x3]      ; load one int
add     w2, w4, w2        ; add it
add     x3, x3, #4        ; next element
sub     w1, w1, #1
cbnz    w1, <loop>
```

A versão com `Vector<int>` compila para `ldr q17, [x4]`, um `add` vetorial e
`addv s16, v16.4s` para juntar as lanes (`DOTNET_TieredCompilation=0
DOTNET_JitDisasm`, .NET 10.0.0). O RyuJIT não auto-vetoriza os seus laços:
código vetorizado é código que você, ou a BCL, escreveu com esses tipos.

### O que esta máquina informa

`Vector.IsHardwareAccelerated` e `Vector128.IsHardwareAccelerated` são `True`;
`Vector256` e `Vector512` são `False`. `Vector<int>.Count` vale 4 aqui (8 em
AVX2, 16 em 512 bits, docs only). `AdvSimd.Arm64.IsSupported` é `True`; `Sse2`,
`Avx2` e `Avx512F` são `False`. `Vector256<int>.IsSupported` é `True` embora a
largura não seja acelerada: roda um fallback de software lento
(`Vector512.Create(1)` funcionou), então escolha o caminho com
`IsHardwareAccelerated`, não com `IsSupported`. O intrinsic de outra
arquitetura lança exceção (`Avx2.Add` deu `PlatformNotSupportedException`). Com
`DOTNET_EnableHWIntrinsic=0` (botão de teste) todos viraram `False`, o que
testa o fallback escalar.

### `Vector<T>`: soma com resto escalar

```csharp
static int SumInt(ReadOnlySpan<int> x)
{
    var acc = Vector<int>.Zero;
    int i = 0, last = x.Length - Vector<int>.Count;
    for (; i <= last; i += Vector<int>.Count) acc += new Vector<int>(x.Slice(i));
    int sum = Vector.Sum(acc);                 // fold the lanes
    for (; i < x.Length; i++) sum += x[i];     // remainder: 1003 % 4 = 3 elements
    return sum;
}
```

Para `1..1003`, a soma escalar e a `SumInt` deram `503506`. `Vector.Dot` deu `60`
para `{1,2,3,4}` contra `{8,7,6,5}`. Uma comparação devolve uma máscara (todos
os bits ligados nas lanes em que é verdadeira) e `ConditionalSelect` escolhe
por lane sem desvio: para `v = <-4 -1 2 5>` a máscara `GreaterThan(v, 0)` foi
`<0 0 -1 -1>` e `ConditionalSelect(mask, v, 0)` deu `<0 0 2 5>`. `EqualsAll` e
`GreaterThanAny` reduzem a máscara a um `bool`. Os tipos de elemento são os
numéricos primitivos, não `char` nem `bool`.

### `Vector128<T>`: largura fixa e uma máscara legível

`Vector128<byte>` sempre tem 16 bytes. `Equals` dá `255` nas lanes que batem e
`ExtractMostSignificantBits` empacota o bit mais alto de cada lane em um inteiro
que dá para contar ou varrer. Para os bytes `0,1,2,3,2,5,2,7,8,9,2,11,12,13,14,2`
contra `2`, a máscara teve `255` nas lanes 2, 4, 6, 10 e 15, os bits foram
`1000010001010100`, popcount 5, primeira ocorrência na lane 2.
`PopCount(bits)` é a contagem e `TrailingZeroCount(bits)` o primeiro índice; o
.NET 10 também tem `Vector128.Count(v, x)` e `IndexOf` (`5` e `2` acima).
`Vector128.Create(span)` com um span menor que o vetor lança
`ArgumentOutOfRangeException` (medido); `LoadUnsafe` não verifica.

### O padrão de despacho

```csharp
static int CountEqual(ReadOnlySpan<byte> data, byte value)
{
    int count = 0, i = 0;
    if (Vector128.IsHardwareAccelerated && data.Length >= Vector128<byte>.Count)
    {
        var target = Vector128.Create(value);
        for (int last = data.Length - 16; i <= last; i += 16)
            count += (int)uint.PopCount(Vector128.Equals(
                Vector128.Create(data.Slice(i)), target).ExtractMostSignificantBits());
    }
    for (; i < data.Length; i++) if (data[i] == value) count++;   // remainder or all
    return count;
}
```

`IsHardwareAccelerated` é uma constante em tempo de JIT, então o ramo não
tomado some. Em 1000 bytes aleatórios imprimiu `path Vector128: CountEqual = 3`
e, com `DOTNET_EnableHWIntrinsic=0`, `path scalar: CountEqual = 3`. Um caminho
`Vector256` entra na frente com a mesma guarda (falsa aqui, então docs only).

### Medido: soma, contagem e busca

Release, BenchmarkDotNet 0.15.8, Apple M4 Max; 1.000.000 de ints (0 a 99),
1.000.000 de floats e 1 MiB de bytes aleatórios. Média por chamada.

| Tarefa | Variante | Tempo |
|---|---|---|
| Soma de `int[]` | laço escalar | 256 us |
| | LINQ `Sum()` | 128 us |
| | `Vector<int>` (`Slice`, `LoadUnsafe`) | 129, 125 us |
| | `Vector<int>`, 4 acumuladores | 38 us |
| | `TensorPrimitives.Sum` | 123 us |
| Soma de `float[]` | laço escalar | 560 us |
| | LINQ `Sum()` | 573 us |
| | `Vector<float>` | 146 us |
| | `TensorPrimitives.Sum` | 128 us |
| Contar bytes `== 7` | laço escalar (LINQ `Count`: 296) | 281 us |
| | `Vector128` + `ExtractMostSignificantBits` | 54,6 us |
| | `span.Count(7)` | 54,5 us |
| | `Vector128`, contadores de byte por lane | 24,8 us |
| Primeiro byte (acerto no fim) | laço escalar | 268 us |
| | laço `Vector128` | 37,4 us |
| | `span.IndexOf` | 16,7 us |

O `Sum` do LINQ em `int[]` já é vetorizado (igual ao `Vector<int>`); em
`float[]` não é. Um acumulador fica limitado pela latência, porque cada soma
espera a anterior: quatro acumuladores independentes foram 3,3 vezes mais
rápidos que um, 6,7 vezes mais rápidos que o laço escalar, e venceram o
`TensorPrimitives.Sum<int>` aqui. O `Slice` custa uma checagem de limites por
iteração (visível no disassembly). O `span.Count` empatou com o meu kernel de
`ExtractMostSignificantBits`; um kernel que soma as máscaras `0xFF` em
contadores de byte por lane (descarregados no máximo a cada 255 vetores) foi
2,2 vezes mais rápido que os dois em arm64. O `span.IndexOf` bateu o meu laço
por 2,2 vezes: para buscar, chame-o.

### Desvios e entradas pequenas

Somar só os valores positivos de 1.000.000 de ints em -100..99:

| Variante | Tempo |
|---|---|
| `if (x > 0) s += x`, ordem aleatória | 2.382 us |
| mesmo laço, dados ordenados (desvio previsível) | 254 us |
| `Vector<int>` com máscara + `ConditionalSelect` + alargamento, aleatório | 125 us |

O laço com desvio é 9,4 vezes mais lento em dados aleatórios do que nos mesmos
valores ordenados: é o preditor de desvios falhando, não a aritmética. A versão
com máscara é 19 vezes mais rápida. Em `int[]` pequenos (ns por chamada; abaixo
de 1 ns é a resolução do harness), escalar, `Vector<int>` e
`TensorPrimitives.Sum` levaram 0,46, 0,49 e 0,78 com N=3 (nenhum vetor cabe,
todos rodam código escalar), 4,6, 1,5 e 1,4 com N=16, 16,7, 4,9 e 2,6 com N=64,
e 266, 110 e 76 com N=1024.

### Hardware intrinsics: AdvSimd aqui, Avx2 como ponte

Um intrinsic mapeia um método para uma instrução. Em Arm64:

```csharp
if (AdvSimd.Arm64.IsSupported)
{
    var total = AdvSimd.Arm64.AddAcross(bytes);     // adds all 16 byte lanes: 93
}
```

Rodou aqui (`93`; `AdvSimd.CompareEqual` deu a mesma máscara de
`Vector128.Equals`). `Sse2`, `Avx2` (256 bits) e `Avx512F` compilam em arm64,
mas `IsSupported` é `False`: corpos docs only. A classe SVE está marcada para
avaliação: no .NET 10.0.100, usá-la é o erro de compilação `SYSLIB5003`. A doc
lembra que `(vector & mask) == Vector128<byte>.Zero` já vira `ptest` em x86,
então um `Sse41.TestZ` escrito à mão não é necessário.

### Armadilhas

- **Ler além do fim.** O limite `i <= length - Count` mais um resto escalar é a
  defesa. `LoadUnsafe` e cargas por ponteiro não verificam; a doc avisa de
  "non-deterministic results" ou `AccessViolationException`. O offset é
  `nuint`: confira `Length >= Count` antes de `Length - Count`. Não provocado
  aqui (docs only). `LoadAligned` exige memória alinhada; a doc recomenda
  `Create(span)` e `LoadUnsafe` (alinhamento não medido).
- **O float muda de resultado.** A soma vetorial soma em outra ordem e a soma
  de float não é associativa. 1003 floats aleatórios: escalar `494980.84`,
  `Vector<float>` `494980.53`, acumulador `double` `494980.6481`. Para
  1.000.000 vezes `0.1f`, o laço escalar deu `100958.34` e a soma vetorial
  `99759.85` (matematicamente `100000`). Testes precisam de tolerância.
- **Desvio por elemento** derrota as lanes; **entradas curtas** podem perder
  para um laço comum. Use máscaras e meça.
- **Teste todos os caminhos**, com tamanhos em torno de múltiplos de `Count`
  (comparei 11 tamanhos de 0 a 100003 com o resultado escalar).

### Novo no .NET 11: construção e composição de lanes (docs only)

A página de runtime do .NET 11 (GA, atualizada em 2026-11-10) lista métodos
novos em `Vector64/128/256/512<T>` e `Vector<T>`: `CreateGeometricSequence`,
`CreateAlternatingSequence`, `CreateHarmonicSequence`; `Zip`, `ZipLower`,
`ZipUpper`, `Unzip`, `UnzipEven`, `UnzipOdd`; `Concat*` e `Reverse`. Os
exemplos dela: `Vector128.CreateGeometricSequence(1, 2)` (lanes 1, 2, 4, 8) e
`Vector128.Zip(a, b)`, que devolve as metades intercaladas como tupla. Foram
aprovados em dotnet/runtime#122557, integrados em #127690, revertidos em #129610
e reaplicados em #129627, tudo em 2026-06-19. Nada disso rodou aqui (sem SDK do
.NET 11). A mesma página diz que `Count`, `IndexOf` e `LastIndexOf` em Arm64
deixaram de passar por `ExtractMostSignificantBits` (5 a 50% mais rápidos),
coerente com a diferença medida acima (não remedido).

### Book vs today

A era de 2015 do `System.Numerics.Vectors` ensinava `Vector<T>` para
portabilidade e intrinsics SSE/AVX escritos à mão, com fallback, para
velocidade. Hoje a doc chama a família de largura fixa `Vector128<T>` de "the
recommended starting point for new vectorized algorithms". Para somas,
contagens e buscas, você não deveria escrever nada disso: `Sum` do LINQ em
`int`, `span.Count`, `span.IndexOf`, `SearchValues<T>` e `TensorPrimitives` já
fazem, e o `IndexOf` bateu o meu laço por 2,2 vezes. Escreva um kernel quando
um profile apontar um laço que nenhum deles cobre e mantenha a versão escalar
como oráculo de teste. "Usa SIMD" não é velocidade: 3,3 vezes separaram um
acumulador de quatro.

## Trade-offs

- **Velocidade versus manutenção.** Cada largura e conjunto de instruções é
  mais um caminho a escrever e testar; intrinsics por plataforma multiplicam.
- **`Vector<T>` versus `Vector128<T>`.** `Vector<T>` adapta a largura, mas o
  algoritmo não pode contar com ela; `Vector128<T>` é fixo e mais simples, mas
  o hardware de 256 bits fica ocioso sem um caminho `Vector256`.
- **À mão versus BCL.** `span.IndexOf` foi 2,2 vezes mais rápido que o meu
  laço. Prefira a biblioteca até um profile mostrar a diferença; mantenha um
  caminho escalar para entradas pequenas.
- **Cobertura só na documentação.** AVX2, AVX-512 e os métodos de lane do .NET
  11 foram lidos, não executados; números do Apple Silicon não valem em x64.

## Documentation Links

- [Use SIMD and hardware intrinsics in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/simd) (doc)
- [Vector<T> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.vector-1) (doc)
- [Vector128 class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.intrinsics.vector128) (doc)
- [AdvSimd class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.intrinsics.arm.advsimd) (doc)
- [TensorPrimitives class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.tensors.tensorprimitives) (doc)
- [What's new in .NET 11 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [API proposal: more Vector<T> sequence and lane APIs, dotnet/runtime#122557](https://github.com/dotnet/runtime/issues/122557) (doc)
- [Reapply "Add lane construction and composition APIs", dotnet/runtime#129627](https://github.com/dotnet/runtime/pull/129627) (doc)
