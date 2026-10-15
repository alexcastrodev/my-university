---
version: 1.0
updatedAt: 2026-10-15
title: "Números Aleatórios, GUIDs e UUID v7"
summary: Random e Random.Shared, Shuffle e GetItems, RandomNumberGenerator para segurança, Guid.CreateVersion7 (.NET 9) e o que "ordenável" realmente garante em chaves de banco.
---
## Objective

"Me dê um número aleatório" e "me dê um id único" parecem um problema só e são pelo
menos três. Um jogo quer pseudoaleatoriedade rápida e repetível. Um token de
redefinição de senha quer imprevisibilidade que um atacante não consiga modelar. Uma
chave de banco quer unicidade e, se for chave clusterizada, uma ordem que não
espalhe os inserts pelo índice. O .NET tem uma ferramenta para cada: `Random`
(incluindo o thread-safe `Random.Shared`), `RandomNumberGenerator` para segurança, e
`Guid`, que desde o .NET 9 cria valores versão 7 (ordenados por tempo). Este conceito
mostra o que cada um garante, os helpers novos (`Shuffle`, `GetItems`) e onde os
GUIDs v7 ajudam e onde a ordenação deles é mais fraca do que se imagina.

## Use Cases

- Simulações, jogos, amostragem e testes que precisam de muitos valores aleatórios
  baratos, muitas vezes repetíveis a partir de uma seed.
- Gerar tokens, códigos de redefinição de senha, API keys e salts que não podem ser
  adivinhados.
- Embaralhar um baralho ou sortear itens de uma lista sem escrever Fisher-Yates à
  mão.
- Escolher o tipo da chave primária: `int` identity, GUID aleatório ou GUID
  ordenado por tempo.

## Deep Dive

### Random: rápido, com seed, não é segredo

`Random` é um gerador pseudoaleatório. A mesma seed produz a mesma sequência, o que
a documentação cita como útil para suítes de teste e para reproduzir partidas de
jogos, e é exatamente por isso que ele não serve para segredos. A documentação também
avisa que a sequência de uma seed pode mudar entre versões do .NET, então não grave
seeds como contrato:

```csharp
var a = new Random(42);
var b = new Random(42);
Console.WriteLine($"{a.Next()} {b.Next()}");      // 1434747710 1434747710
Console.WriteLine(a.Next(1, 7));                    // 1..6: o limite superior é exclusivo
Console.WriteLine(a.NextInt64(10_000_000_000));     // um long abaixo do limite
```

Segundo a documentação, uma instância não é thread safe, então compartilhar um único
`new Random()` entre threads é bug. Desde o .NET 6, `Random.Shared` é uma instância
thread-safe pronta. Chamamos de dentro de um `Parallel.For` 1000 vezes sem problema:

```csharp
var set = new ConcurrentBag<int>();
Parallel.For(0, 1000, _ => set.Add(Random.Shared.Next(100)));
Console.WriteLine(set.Count);    // 1000, sem exceções
```

Não dá para dar seed no `Random.Shared`. Quando você precisa de reprodutibilidade (um
teste, um replay), crie o seu `new Random(seed)` e mantenha numa thread só.

### Shuffle, GetItems e os helpers de string do .NET 10

O .NET 8 trouxe dois helpers que substituem laços comuns escritos à mão. `Shuffle`
embaralha um array ou span no lugar. `GetItems` sorteia valores com reposição de um
conjunto de opções, então a mesma opção pode sair duas vezes:

```csharp
int[] arr = [1, 2, 3, 4, 5, 6, 7, 8];
new Random(1).Shuffle(arr);
Console.WriteLine(string.Join(",", arr));                       // 2,1,5,7,4,3,6,8

string[] colors = ["red", "green", "blue"];
Console.WriteLine(string.Join(",", new Random(1).GetItems(colors, 5)));
// red,red,green,blue,green  (cinco sorteios entre três opções: repetição é esperada)
```

As saídas acima são da seed 1 neste SDK e, segundo a documentação, podem mudar em
outra versão. `GetItems` tem sobrecargas que recebem um span de destino. Segundo a
documentação da API, o .NET 10 acrescenta `Random.GetString(choices, length)` e
`Random.GetHexString(length)`:

```csharp
Console.WriteLine(new Random(1).GetString("abc", 8));   // aabcbbbc
Console.WriteLine(new Random(1).GetHexString(8));        // 317CA65F
```

São convenientes para dados de teste. Lembre que herdam a previsibilidade do
`Random`.

### RandomNumberGenerator para tudo que um atacante tentaria adivinhar

A orientação da documentação é direta: para "um número aleatório criptograficamente
seguro, como um adequado para criar uma senha aleatória", use os métodos estáticos de
`RandomNumberGenerator`. Desde o .NET 8 ele espelha os helpers acima:

```csharp
byte[] token = RandomNumberGenerator.GetBytes(16);                 // 16 bytes aleatórios
int die = RandomNumberGenerator.GetInt32(1, 7);                     // 1..6, limite superior exclusivo
string code = RandomNumberGenerator.GetHexString(8);                // 8 caracteres hex
string pin = RandomNumberGenerator.GetString("0123456789", 6);      // 6 dígitos
RandomNumberGenerator.Shuffle<int>(numbers);                        // embaralhamento seguro no lugar
```

Prefira `GetInt32` a reduzir bytes aleatórios com `% n` por conta própria. Gerar com
segurança custa mais que o `Random`, o que raramente importa para tokens. Para saída
segura em URL, combine os bytes com `Base64Url` do conceito de encodings. Esta seção
fica no nível de "qual API"; projetar um esquema de tokens (expiração, armazenamento,
comparação) é um tema de segurança à parte.

### Guid: v4 e v7

`Guid.NewGuid()` cria um valor versão 4: bits aleatórios mais os marcadores de versão
e variante. No .NET 9, `Guid.CreateVersion7()` cria um valor versão 7 seguindo a RFC
9562, que coloca um timestamp Unix em milissegundos nos primeiros 48 bits e preenche
o resto com dados aleatórios. A documentação afirma que o método usa `UtcNow` como
timestamp e "inicializa os subcampos rand_a e rand_b com dados aleatórios". Há também
uma sobrecarga que recebe um `DateTimeOffset` (lança `ArgumentOutOfRangeException`
antes da época Unix) e as propriedades `Guid.Version` e `Guid.Variant` para inspecionar
um valor (também .NET 9):

```csharp
var g4 = Guid.NewGuid();
Console.WriteLine($"{g4.Version} {g4.Variant}");        // 4 9
var t = DateTimeOffset.UtcNow;
var g7 = Guid.CreateVersion7(t);
Console.WriteLine(g7);                                  // 01a140fe-3a48-7c7e-98b3-8f9b5668440e
Console.WriteLine(g7.ToString("N")[..12] == t.ToUnixTimeMilliseconds().ToString("x12"));  // True
```

Os primeiros 12 dígitos hex são o timestamp em milissegundos, e o `7` depois do
segundo hífen é a versão.

### O que "ordenável" realmente significa

O prefixo de timestamp é o ponto: valores criados depois ordenam depois, então os
inserts caem perto do fim do índice em vez de lugares aleatórios, o argumento usual
para menos page splits e melhor comportamento de cache numa chave clusterizada (o
benefício depende do seu motor de banco, então meça nele). Mas a garantia é só na
granularidade de milissegundo, porque os bits restantes são aleatórios. Medimos:

```csharp
var spaced = new List<Guid>();
for (int i = 0; i < 5; i++) { spaced.Add(Guid.CreateVersion7()); Thread.Sleep(3); }
Console.WriteLine(spaced.SequenceEqual(spaced.OrderBy(x => x)));       // True: 3 ms de intervalo

var burst = Enumerable.Range(0, 10000).Select(_ => Guid.CreateVersion7()).ToList();
Console.WriteLine(burst.SequenceEqual(burst.OrderBy(x => x)));         // False: laço apertado
int inversions = 0;
for (int i = 1; i < burst.Count; i++)
    if (string.CompareOrdinal(burst[i - 1].ToString(), burst[i].ToString()) > 0) inversions++;
Console.WriteLine(inversions);   // 4966 de 9999 pares adjacentes fora de ordem nesta máquina
```

Então dois ids gerados no mesmo milissegundo não têm ordem relativa definida. Se você
precisa de ordem estrita (um log de eventos, por exemplo), acrescente uma coluna de
sequência ou use um gerador com contador. Não conte com a ordem de criação dentro de
uma rajada.

A ordenação também depende do banco. A documentação do SQL Server diz que a ordenação
de `uniqueidentifier` "não é implementada comparando os padrões de bits", então não
assuma que a ordem de bytes ou de string que você vê no .NET bate com a ordem que o
banco usa numa coluna GUID. Para chaves no SQL Server, a documentação do EF Core diz
que o provider já gera GUIDs sequenciais no cliente quando um GUID é chave primária,
então normalmente você deixa isso para o framework em vez de chamar
`CreateVersion7` você mesmo. Confira a documentação do seu provider antes de escolher.

Por fim, um GUID v7 revela o momento de criação a quem ler os 12 primeiros dígitos
hex. Não use onde um id público não deva mostrar quando a linha foi criada.

## Trade-offs

- **`Random` é barato e reproduzível, e previsível.** Bom para jogos e testes,
  inaceitável para tokens. Se o valor protege acesso a qualquer coisa, use
  `RandomNumberGenerator`, mesmo que o código pareça idêntico.
- **`Random.Shared` troca controle por conveniência.** É thread safe e não precisa de
  configuração, mas não dá para dar seed, então testes que exigem repetibilidade
  devem injetar um `Random` com seed.
- **GUIDs versão 7 melhoram a localidade dos inserts, não a ordem estrita.** O ganho é
  real em índices clusterizados e limitado à resolução de milissegundo. Dentro de um
  milissegundo são aleatórios, e entre bancos a ordem de classificação difere.
- **v7 revela o tempo, v4 não.** Um GUID v4 aleatório é o identificador público mais
  seguro. Use v7 para chaves internas e considere um id público separado.
- **GUIDs são maiores que ints.** 16 bytes em todo índice e chave estrangeira, e
  ilegíveis em logs. A ordenação por tempo resolve a fragmentação, não o tamanho.

## Documentation Links

- [Random class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.random) (doc)
- [RandomNumberGenerator class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator) (doc)
- [Guid.CreateVersion7 method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.guid.createversion7) (doc)
- [uniqueidentifier (Transact-SQL), Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/data-types/uniqueidentifier-transact-sql) (doc)
- [Generated values, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/generated-properties) (doc)
