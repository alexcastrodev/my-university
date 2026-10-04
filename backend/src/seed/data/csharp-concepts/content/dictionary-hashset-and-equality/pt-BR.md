---
version: 1.0
updatedAt: 2026-10-04
title: "Dictionary, HashSet e Igualdade"
summary: Buckets e entries, o contrato Equals/GetHashCode, o bug da chave mutável, IEqualityComparer e StringComparer, records como chave e APIs de lookup sem hash duplo.
---
## Objective

`Dictionary<TKey, TValue>` e `HashSet<T>` dão busca em tempo quase constante, mas
só se o tipo da chave honrar um contrato que o compilador não verifica: objetos
iguais devem devolver o mesmo hash code, e o hash de uma chave não pode mudar
enquanto ela estiver na coleção. Quebre qualquer uma das regras e a coleção não
lança exceção, ela só deixa de achar itens que claramente contém. Este conceito
cobre como as duas coleções guardam os itens, o que `Equals` e `GetHashCode`
precisam garantir, como os comparers mudam as regras para strings e tipos
próprios, como records se comportam como chaves e as APIs de lookup sem
alocação adicionadas em versões recentes.

## Use Cases

- Um cache indexado por um valor composto, como id do tenant mais id do produto.
- Uma tabela de busca sem diferenciar maiúsculas de minúsculas para nomes de
  headers ou códigos digitados pelo usuário.
- Um conjunto de ids já processados, onde só importa "eu já vi isto?".
- Contar ocorrências com uma única busca por item em vez de duas.

## Deep Dive

### Como as coleções guardam os itens

Um `Dictionary` tem dois arrays. `entries` guarda os itens (hash code, chave,
valor e o índice da próxima entrada no mesmo bucket). `buckets` mapeia um número
de bucket, calculado a partir do hash code, para a primeira entrada desse
bucket. Uma busca calcula o hash, escolhe o bucket e percorre a cadeia curta
comparando hash codes e chamando `Equals`. Quando o array de entries enche, a
coleção aloca arrays maiores (o tamanho é um número primo, aproximadamente o
dobro) e reinsere tudo, e por isso adicionar muitos itens a um dicionário também
se beneficia de uma dica de capacity:

```csharp
var map = new Dictionary<string, int>(capacity: 10_000);
map.EnsureCapacity(50_000);   // cresce uma vez se a capacity for menor

var seen = new HashSet<int>(1_000);
bool added = seen.Add(42);    // false se 42 já estava lá
```

`HashSet<T>` usa a mesma estrutura sem valores. Use-o quando só a presença
importa: `Contains` é O(1) em média, enquanto `List<T>.Contains` percorre a lista
em O(n).

### O contrato de Equals e GetHashCode

As regras, em ordem de quão frequentemente são quebradas:

- Se `a.Equals(b)` é verdadeiro, `a.GetHashCode()` precisa ser igual a
  `b.GetHashCode()`. O inverso não é exigido: objetos diferentes podem colidir.
- O hash code de um objeto não pode mudar enquanto ele é uma chave. A coleção
  calculou o bucket uma vez, quando você o adicionou.
- `Equals` precisa ser reflexivo, simétrico e transitivo, e `x.Equals(null)`
  precisa devolver falso.
- Um hash code só é válido dentro de um processo em execução. Ele pode ser
  diferente entre execuções (os hashes de string são randomizados), então nunca o
  guarde num arquivo ou banco de dados.

Sobrescrever `Equals` sem `GetHashCode` faz o compilador avisar, e é um bug de
verdade: o dicionário compara hash codes primeiro, então dois objetos "iguais"
caem em buckets diferentes e nunca são comparados.

```csharp
public sealed class Sku : IEquatable<Sku>
{
    public string Code { get; }
    public Sku(string code) => Code = code;

    public bool Equals(Sku? other) =>
        other is not null && string.Equals(Code, other.Code, StringComparison.OrdinalIgnoreCase);

    public override bool Equals(object? obj) => Equals(obj as Sku);

    public override int GetHashCode() =>
        string.GetHashCode(Code, StringComparison.OrdinalIgnoreCase); // precisa combinar com o Equals acima
}
```

Implemente `IEquatable<T>` nos tipos usados como chave, porque o dicionário
genérico passa a chamar o `Equals` tipado em vez do de `object`, o que evita
boxing para structs.

### O bug da chave mutável

Se uma propriedade que participa do `GetHashCode` muda depois que o objeto foi
adicionado, a entrada continua no bucket do hash antigo e as buscas olham no
novo:

```csharp
// Point é uma classe com X e Y alteráveis, cujos Equals e GetHashCode usam os dois.
var key = new Point { X = 1, Y = 2 };
var map = new Dictionary<Point, string> { [key] = "a" };

key.X = 10;
Console.WriteLine(map.ContainsKey(key));          // False
Console.WriteLine(map.Count);                     // 1, a entrada ainda está lá
Console.WriteLine(map.ContainsKey(new Point { X = 1, Y = 2 })); // False também: o Equals falha
```

A entrada agora é inalcançável: nenhuma chave tem hash para o bucket dela e ao
mesmo tempo é igual a ela. Use tipos imutáveis como chaves (records com
propriedades `init`, `readonly record struct`, strings, ids).

### Comparers

Todo construtor aceita um `IEqualityComparer<TKey>`. Para strings, a comparação
padrão é ordinal (caracteres exatos), que é rápida e independe de cultura.
Escolha um comparer de propósito em vez de converter as chaves para minúsculas à
mão:

```csharp
var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
headers["Content-Type"] = "application/json";
Console.WriteLine(headers["content-type"]);   // encontrado

var names = new HashSet<string>(StringComparer.CurrentCultureIgnoreCase); // regras de cultura: evite para identificadores
```

Use `Ordinal` ou `OrdinalIgnoreCase` para identificadores, nomes de arquivo e
tokens de protocolo. Comparers sensíveis à cultura dependem do locale da máquina
(o I turco com e sem ponto é a surpresa clássica), então uma busca pode funcionar
num servidor e falhar em outro.

### Records como chaves

Um record gera `Equals` e `GetHashCode` a partir de todos os seus campos, então
dois records com os mesmos valores são a mesma chave:

```csharp
public readonly record struct TenantProduct(Guid TenantId, int ProductId);

var prices = new Dictionary<TenantProduct, decimal>();
prices[new TenantProduct(tenant, 7)] = 9.90m;
Console.WriteLine(prices[new TenantProduct(tenant, 7)]);   // 9.90

// Para uma classe (records já geram isto), combine os campos à mão:
public override int GetHashCode() => HashCode.Combine(TenantId, ProductId);
```

Records comparam cada campo com a igualdade do próprio campo, então um record
que contém uma `List<T>` ou um array os compara por referência, e dois records
com listas iguais não são iguais. Um record com propriedades alteráveis tem o
problema da chave mutável descrito acima, então deixe os records usados como
chave imutáveis.

### APIs de lookup que evitam hash duplo

O clássico "checa e adiciona" faz duas buscas:

```csharp
if (!map.ContainsKey(key)) map[key] = 1;       // dois hashes
map.TryAdd(key, 1);                            // um

var value = map.GetValueOrDefault(key, 0);     // uma busca, com valor padrão

// Contar ocorrências com uma busca e atualização no lugar:
ref int count = ref CollectionsMarshal.GetValueRefOrAddDefault(map, key, out _);
count++;
```

`GetValueRefOrAddDefault` devolve uma referência ao valor guardado dentro do
dicionário, então a atualização não precisa de uma segunda busca. A referência
só é válida até a próxima modificação do dicionário.

## Trade-offs

- **Um `GetHashCode` ruim degrada o dicionário para uma lista encadeada.**
  Devolver uma constante é válido e transforma toda busca num percurso de um
  bucket gigante.
  ```csharp
  public override int GetHashCode() => 1;  // correto, e O(n) por busca
  ```
- **`GetHashCode` não é único nem estável.** Dois valores diferentes podem ter o
  mesmo hash, e o valor muda entre execuções, então use-o só para tabelas em
  memória.
- **Ordinal é rápido e exato, o sensível à cultura é correto para pessoas e
  lento.** Ordenar ou comparar um texto que um usuário lê pode exigir regras de
  cultura, enquanto chaves que o programa cria devem ser ordinais.
- **Um `ref` para dentro de um dicionário morre na próxima mudança.** Adicionar
  um item pode redimensionar o array de entries, e depois disso o `ref int`
  antigo aponta para memória obsoleta que o dicionário não usa mais.
  ```csharp
  ref int c = ref CollectionsMarshal.GetValueRefOrAddDefault(map, "a", out _);
  map["b"] = 1;   // pode redimensionar
  c++;            // atualiza o array antigo, não o dicionário
  ```
- **`Dictionary<T, bool>` como conjunto desperdiça memória e esconde a
  intenção.** Use `HashSet<T>`, que também dá operações de conjunto
  (`UnionWith`, `IntersectWith`, `ExceptWith`).
- **A ordem de enumeração é detalhe de implementação.** Um dicionário muitas
  vezes devolve os itens na ordem de inserção até que algo seja removido, e então
  itens novos reaproveitam os espaços liberados, então não dependa dela. Use
  `SortedDictionary` ou ordene as chaves quando a ordem importar.

## Documentation Links

- [Dictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2) (doc)
- [Object.GetHashCode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode) (doc)
- [How to define value equality for a class or struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/statements-expressions-operators/how-to-define-value-equality-for-a-type) (doc)
- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [CollectionsMarshal.GetValueRefOrAddDefault, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.getvaluereforadddefault) (doc)
