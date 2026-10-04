---
version: 1.0
updatedAt: 2026-10-04
title: "List e Array por Dentro"
summary: Crescimento e capacity do List<T>, covariância de arrays, modificar a coleção durante um foreach e fatiar sem copiar com Span e CollectionsMarshal.AsSpan.
---
## Objective

`List<T>` e arrays parecem intercambiáveis até você chegar nos limites deles.
Uma lista é um invólucro fino em torno de um array que cresce alocando um maior
e copiando, então sua capacity, e não sua contagem, decide quanta memória ela
ocupa e com que frequência copia. Um array tem tamanho fixo, mas a versão com
tipos por referência é covariante, o que move um erro de tipo do tempo de
compilação para uma exceção em runtime. Os dois lançam exceção ou se comportam
mal quando alterados durante um `foreach`, e os dois podem ser expostos como um
`Span<T>` que evita cópias ao preço de regras de tempo de vida. Este conceito
cobre crescimento e capacity, covariância de arrays, modificar uma coleção
enquanto ela é enumerada e as ferramentas baseadas em span para fatiar sem
alocar.

## Use Cases

- Preencher uma lista com uma quantidade conhecida de itens, como as linhas de
  uma query, sem pagar por redimensionamentos repetidos.
- Entender por que `object[] a = new string[1]; a[0] = 1;` compila e depois
  falha.
- Remover itens que satisfazem uma condição enquanto percorre uma lista.
- Processar parte de um array ou lista num caminho quente sem copiá-la.

## Deep Dive

### Count, capacity e crescimento

`List<T>` mantém um `T[]` interno. `Count` é quantos itens estão em uso, e
`Capacity` é o tamanho desse array. Uma lista vazia nova tem capacity 0, o
primeiro `Add` aloca um array de 4, e toda vez que ele enche a lista dobra a
capacity: aloca um array novo, copia todos os itens e descarta o antigo. Isso
torna o `Add` O(1) amortizado, mas cada passo de crescimento copia tudo e deixa
lixo para trás.

```csharp
var list = new List<int>();
Console.WriteLine(list.Capacity);        // 0
list.Add(1);
Console.WriteLine(list.Capacity);        // 4
for (var i = 0; i < 4; i++) list.Add(i);
Console.WriteLine(list.Capacity);        // 8, o quinto item forçou uma cópia

var sized = new List<int>(10_000);       // uma alocação adiantada
sized.EnsureCapacity(20_000);            // cresce uma vez se a capacity for menor (.NET 6+)
sized.TrimExcess();                      // encolhe o array para Count se estiver quase vazio
```

Quando você sabe ou consegue estimar o tamanho final, passe-o ao construtor.
Quando uma lista continua viva muito depois de ser preenchida, `TrimExcess`
devolve a cauda não usada, mas realoca, então chame uma vez depois que a lista
parar de crescer, e não num laço.

### Covariância de arrays

Arrays de tipos por referência são covariantes: um `string[]` pode ser atribuído
a um `object[]`. O compilador permite, então a checagem de tipo vai para o
runtime, onde cada escrita num array assim confere o tipo real do elemento:

```csharp
object[] objects = new string[2];
objects[0] = "ok";
objects[1] = 42;      // compila, depois lança ArrayTypeMismatchException

IList<object> list = new List<string>(); // não compila: List<T> é invariante
```

A covariância vale só para tipos por referência: um `int[]` não é um `object[]`.
Ela existe por razões históricas (antes dos generics) e custa uma checagem de
tipo nas escritas em arrays cujo tipo de elemento não é selado. Prefira
`IReadOnlyList<T>` quando precisar passar "uma sequência de itens derivados como
uma sequência de itens base", porque a interface somente leitura é covariante
com segurança e não pode ser escrita.

### Alterando uma coleção enquanto a enumera

`List<T>` carrega um número de versão interno que `Add`, `Remove`, `Insert`,
`Clear` e a ordenação incrementam. O enumerador lembra a versão com que
começou e a confere em cada `MoveNext`:

```csharp
var numbers = new List<int> { 1, 2, 3, 4 };

foreach (var n in numbers)
    if (n % 2 == 0)
        numbers.Remove(n);   // InvalidOperationException: Collection was modified

numbers.RemoveAll(n => n % 2 == 0);          // a ferramenta certa: uma passada, sem exceção
for (var i = numbers.Count - 1; i >= 0; i--) // ou percorra de trás para frente, e os índices continuam válidos
    if (numbers[i] % 2 == 0) numbers.RemoveAt(i);
```

Arrays não têm versão e não mudam de tamanho, então um `foreach` sobre um array
nunca lança essa exceção. Atribuir a elementos durante a enumeração é permitido,
e o laço simplesmente enxerga os novos valores. Desde o .NET Core 3.0, o
`Dictionary` também permite `Remove` e `Clear` durante a enumeração sem
invalidar o enumerador, uma diferença que as pessoas esquecem quando passam de
um tipo para outro.

### Spans: fatiar sem copiar

Um `Span<T>` é uma visão sobre uma região contígua de memória (um array, parte
do array de uma lista, memória da stack), e fatiá-lo não aloca nada. A sintaxe de
range num array, ao contrário, copia:

```csharp
int[] data = [10, 20, 30, 40, 50];

int[] copy = data[1..4];            // array novo com 20, 30, 40
Span<int> view = data.AsSpan(1, 3); // mesma memória, sem alocação
Span<int> view2 = data.AsSpan()[1..4];
view[0] = 99;                       // data[1] agora vale 99

ReadOnlySpan<int> readOnly = view;  // janela somente leitura sobre a mesma memória
```

Para uma `List<T>`, `CollectionsMarshal.AsSpan(list)` devolve um span sobre o
array interno dos primeiros `Count` itens, sem cópia. Isso é poderoso em laços
apertados e perigoso em geral:

```csharp
var items = new List<int> { 1, 2, 3 };
Span<int> span = CollectionsMarshal.AsSpan(items);
items.Add(4);        // pode realocar o array interno
span[0] = 100;       // escreve no array ANTIGO: items[0] não muda
```

Nunca adicione nem remova itens da lista enquanto segura o span, e não guarde o
span num campo (um `Span<T>` é um `ref struct` e não pode viver no heap). O C# 14
acrescenta mais conversões implícitas entre arrays, `Span<T>` e
`ReadOnlySpan<T>`, então métodos de extensão escritos para spans podem ser
chamados direto em arrays.

## Trade-offs

- **Pré-dimensionar só troca memória por velocidade se a estimativa for boa.**
  Uma capacity grande demais desperdiça memória em cada lista que continua viva,
  e `new List<T>(count)` é uma promessa sobre a capacity, não sobre o `Count`.
  ```csharp
  var list = new List<int>(100);
  list[0] = 1;   // ArgumentOutOfRangeException: Count ainda é 0
  ```
- **Dobrar pode exagerar.** Uma lista que cresce até 1.048.577 itens tem capacity
  de 2.097.152, quase metade sem uso. Para uma lista grande e duradoura, montada
  uma vez, crie-a a partir de uma fonte de tamanho exato (um array ou `ToList()`
  numa sequência dimensionada) ou chame `TrimExcess`.
- **A covariância de arrays torna as escritas checadas e mais lentas.** Uma
  escrita num array de um tipo por referência não selado precisa de uma checagem
  em runtime, e um bug vira uma exceção longe da causa. Tipos de elemento selados
  e tipos por valor pulam a checagem.
- **`RemoveAll` e laços de trás para frente não são o mesmo que filtrar.** Eles
  mudam a lista no lugar, o que é errado quando outra parte do código guarda a
  mesma lista. Se a lista é compartilhada, produza uma nova com
  `Where(...).ToList()`.
- **Spans são rápidos e rígidos.** Não podem ser capturados por lambdas, usados
  através de `await` nem guardados em campos de classes comuns. Use `Memory<T>`
  quando a região precisa sobreviver à chamada ou cruzar um `await`.
- **`CollectionsMarshal.AsSpan` contorna a checagem de versão.** A rede de
  segurança da própria lista, a `InvalidOperationException`, não protege um span:
  você recebe escritas silenciosas num array obsoleto em vez de uma exceção.

## Documentation Links

- [List<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1) (doc)
- [Arrays, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/arrays) (doc)
- [Covariance and contravariance in generics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) (doc)
- [Memory<T> and Span<T> usage guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
- [CollectionsMarshal.AsSpan, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.asspan) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
