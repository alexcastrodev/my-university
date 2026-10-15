---
version: 1.0
updatedAt: 2026-10-15
title: "System.Text.Json: Serialização e Opções"
summary: Reuso e custo do JsonSerializerOptions (medido), JsonSerializerDefaults.Web e o preset Strict do .NET 10, políticas de nomes, JsonIgnoreCondition, números e enums, polimorfismo com JsonDerivedType, required, construtores e nulos.
---
## Objective

O `System.Text.Json` parece simples (`Serialize`, `Deserialize`) e seus padrões
são conservadores de propósito, o que significa que a maioria das surpresas vem
do que ele faz em silêncio: uma propriedade cujo nome difere em maiúsculas é
pulada e fica no valor padrão, um argumento de construtor ausente vira `0` ou
`null`, um tipo derivado é escrito como a base. Este conceito trata do objeto
`JsonSerializerOptions`, que controla tudo isso: por que reutilizá-lo (com a
medição do que acontece quando você não reutiliza), o que o
`JsonSerializerDefaults.Web` e o preset `Strict` do .NET 10 mudam, políticas de
nomes, `JsonIgnoreCondition`, números e enums, polimorfismo com
`[JsonDerivedType]`, membros `required`, construtores e tratamento de nulos.
Geração de código, `JsonNode` e o leitor de baixo nível ficam no próximo
conceito.

## Use Cases

- Escolher um único conjunto de opções para uma API HTTP, de modo que todo
  endpoint e todo cliente concordem sobre caixa, enums e nulos.
- Fazer um leitor de configuração ou de mensagens falhar alto diante de erro de
  digitação e campo ausente, em vez de preencher com padrões.
- Serializar uma hierarquia de classes (formas, eventos, comandos) e receber o
  subtipo certo de volta.
- Descobrir por que um campo que você enviou nunca chega, ou por que um caminho
  quente aloca dezenas de kilobytes por serialização.

## Deep Dive

### Os padrões são lenientes na leitura e silenciosos na perda

Todos os números abaixo saíram de .NET 10.0.0 (SDK 10.0.100), macOS 27.0.1,
Apple M4 Max. Comece com um record posicional e um payload com a caixa errada:

```csharp
record Order(int Id, string Customer, decimal Total, string? Note, Status Status, DateOnly Date);

var json = """{"ID":2,"customer":"Bo","total":1,"status":"Pending"}""";
JsonSerializer.Deserialize<Order>(json);
// Order { Id = 0, Customer = , Total = 0, Note = , Status = Pending, Date = 01/01/0001 }
```

Nenhuma exceção, e nenhuma propriedade foi ligada: a correspondência padrão
diferencia maiúsculas de minúsculas, então todo membro ficou no valor padrão
(`Status` aparece como `Pending` só porque esse é o valor zero do enum). Esse é
o relato de bug mais comum sobre serializadores, e é por isso que as opções
importam mais que a chamada.

O `JsonSerializerDefaults.Web` (ou o singleton `JsonSerializerOptions.Web`,
disponível desde o .NET 9) muda três coisas: nomes em camelCase na escrita, nomes
sem diferenciar caixa na leitura e `AllowReadingFromString` para números. A
documentação lista exatamente essas três, e ler as propriedades de volta
confirmou. Com as opções Web o mesmo payload deixa de perder as chaves, mas agora
falha em `"status":"Pending"`, porque enum é número a menos que você adicione um
conversor (abaixo). O ASP.NET Core usa esses padrões web nos próprios endpoints.

### Reutilize a instância de options e saiba o que custa uma "nova"

A documentação manda reutilizar o `JsonSerializerOptions` em vez de criar um por
chamada, porque os metadados dos tipos ficam em cache na instância. Medi com um
record de 7 propriedades, 20.000 chamadas numa instância compartilhada contra
instâncias novas:

| Options por chamada | Tempo por `Serialize` | Alocado por chamada |
|---|---|---|
| uma instância compartilhada | 1,0 us | cerca de 540 B |
| `new JsonSerializerOptions(Web)` a cada vez | 1,0 us | cerca de 770 B |
| options novo + `new JsonStringEnumConverter()` a cada vez | 58 us | cerca de 33 KB |
| options novo + objeto de política de nomes novo a cada vez | 57 us | cerca de 33 KB |

A segunda linha me surpreendeu: criar uma instância nova com as mesmas
configurações não foi mais lento. O motivo está no código-fonte do runtime
(`JsonSerializerOptions.Caching.cs`, v10.0.0): depois de usada, uma instância
procura um contexto de cache compartilhado entre os rastreados, casando por uma
igualdade conservadora que compara quase todas as configurações, com o resolver
de type info e cada conversor comparados por referência. Configurações simples
idênticas compartilham metadados. Um conversor ou política novo não casa com
nada, então toda chamada reconstrói os metadados, que é o 58x e os 33 KB. O
array de rastreamento tem um número limitado de entradas (64 nesse código), então
não construa seu design em cima desse cache. A regra que vale de qualquer jeito:
crie o options uma vez, num campo estático ou no contêiner de DI, e passe para
todo mundo.

Uma instância de options vira somente leitura no primeiro uso. Alterá-la depois
lança `InvalidOperationException` ("read-only or has already been used"). Para
derivar uma variante, copie:
`new JsonSerializerOptions(shared) { WriteIndented = true }`. A cópia não leva o
cache de metadados, segundo a documentação, então para efeito de custo é uma
instância nova. `JsonSerializerOptions.Default` e `.Web` são singletons
somente leitura.

### Nomes, caixa e chaves de dicionário

`PropertyNamingPolicy` reescreve os nomes dos membros na escrita e também é
aplicada na correspondência durante a leitura. Políticas embutidas: `CamelCase`,
`SnakeCaseLower`, `SnakeCaseUpper`, `KebabCaseLower`, `KebabCaseUpper`. Para
`FirstName`, `LastName`, `HTTPCode` os resultados foram:

```csharp
// CamelCase     {"firstName":"a","lastName":"b","httpCode":"c"}
// SnakeCaseLower {"first_name":"a","last_name":"b","http_code":"c"}
// KebabCaseUpper {"FIRST-NAME":"a","LAST-NAME":"b","HTTP-CODE":"c"}
```

Dois detalhes que mordem: a política de nomes não toca nas chaves de dicionário
(uma chave `FirstKey` continuou `FirstKey`; para isso é preciso
`DictionaryKeyPolicy`), e um atributo `[JsonPropertyName("Custom-Name")]` sempre
vence qualquer política.

### Ignorar membros e a família null/default

```csharp
record Ign(int Count, string? Note, string Keep, [property: JsonIgnore] string Secret);
new Ign(0, null, "x", "y");
// default            {"Count":0,"Note":null,"Keep":"x"}
// WhenWritingNull    {"Count":0,"Keep":"x"}
// WhenWritingDefault {"Keep":"x"}
```

`JsonIgnoreCondition.WhenWritingDefault` descarta tudo o que é igual ao padrão do
tipo, o que inclui o número `0` (veja `Count` acima). Quase nunca é o que uma API
quer para um zero de verdade, então prefira `WhenWritingNull` globalmente e ponha
`[JsonIgnore(Condition = ...)]` na única propriedade que precisa da outra regra.
`[JsonIgnore]` sozinho significa "nunca", na leitura e na escrita.

As regras de visibilidade importam para o ciclo completo. Campos públicos são
ignorados a menos que `IncludeFields = true` (ou `[JsonInclude]`). Uma
propriedade com setter privado é pulada na leitura (ficou `0`) a menos que tenha
`[JsonInclude]`, e uma propriedade só com getter nunca é preenchida. Membros
desconhecidos do JSON são descartados em silêncio por padrão.

### Números e enums

`long` e `decimal` são escritos como números JSON, então um `long.MaxValue`
chega arredondado a um cliente JavaScript; `JsonNumberHandling.WriteAsString`
produz `{"L":"1","D":"2","I":"3"}` para esse caso. Ler um número entre aspas em
um `long` lança exceção por padrão e funciona com `AllowReadingFromString`, que o
preset Web liga. `NaN` e infinito não podem ser escritos a menos que você aceite
com `AllowNamedFloatingPointLiterals` (senão `ArgumentException`), e `1.5` lido
em um `int` é `JsonException`, não truncamento. Um `double` escreve `0.1 + 0.2`
como `0.30000000000000004`, enquanto `decimal` escreve `0.3`.

Enums são números por padrão (`Shipped` vira `1`), e o leitor padrão aceita
qualquer inteiro, até um indefinido: `7` num enum de dois membros voltou como `7`
sem erro. Adicione `JsonStringEnumConverter` para escrever nomes, e passe
`allowIntegerValues: false` para rejeitar números (aí ele lançou exceção para
`7`). O mesmo conversor, construído com uma política de nomes, casou `"shipped"`
e escreveu de volta em camelCase, e um valor `[Flags]` virou `"Read, Write"`.
Para builds com trimming e AOT use o genérico
`[JsonConverter(typeof(JsonStringEnumConverter<Level>))]` no enum, como o próximo
conceito explica.

### Polimorfismo com [JsonDerivedType]

Sem anotação, o `System.Text.Json` serializa o tipo estático que você pede.
`Serialize<Animal>(new Dog("Rex", 4))` escreveu `{"Name":"Rex"}` e perdeu
`Legs`, enquanto `Serialize<object>(...)` escreveu `{"Legs":4,"Name":"Rex"}`.
Desserializar sempre cria o tipo declarado. Para fazer a hierarquia ir e voltar,
declare os tipos derivados e, para a leitura, um discriminador:

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(Circle), "circle")]
[JsonDerivedType(typeof(Square), "square")]
abstract record Shape;
record Circle(double Radius) : Shape;
record Square(double Side) : Shape;

JsonSerializer.Serialize<Shape>(new Circle(2));  // {"kind":"circle","Radius":2}
JsonSerializer.Serialize(new Circle(2));         // {"Radius":2}   (o tipo estático é Circle)
JsonSerializer.Deserialize<Shape>("""{"kind":"square","Side":5}""");  // Square { Side = 5 }
```

O nome padrão do discriminador é `$type`. Três comportamentos que confirmei: um
valor desconhecido lança `JsonException`; o discriminador precisa vir primeiro no
objeto, e `{"Side":5,"kind":"square"}` falha com uma `NotSupportedException`
cuja mensagem ("must specify a type discriminator") engana, porque o
discriminador está lá, só que tarde. Definir
`AllowOutOfOrderMetadataProperties = true` resolve, ao custo de buffer em leituras
por streaming, como a documentação avisa. Por fim, um subtipo em tempo de
execução que você não declarou (`Kitten : Cat`, só `Cat` declarado) lança
`NotSupportedException` na escrita, a menos que a base aceite com
`UnknownDerivedTypeHandling = FallBackToBaseType`, que escreveu `{"Name":"Mia"}`
e portanto perdeu o membro extra.

### required, construtores e nulos

Três coisas controlam "tem que estar presente". O modificador `required` do C# e
o `[JsonRequired]` significam o mesmo para o serializador (a documentação diz que
ambos viram `JsonPropertyInfo.IsRequired`) e ambos lançam `JsonException` quando
o membro está ausente. Os parâmetros de construtor são a brecha: um record
posicional `Pos(string Name, int Age)` lido de `{"Name":"x"}` produziu `Age = 0`
sem erro, até que `RespectRequiredConstructorParameters = true` o fez lançar
exceção ("missing required properties including: 'Age'"). Um parâmetro com valor
padrão (`int Age = 7`) é opcional e recebe esse valor.

Nulos têm outra chave. Por padrão um `null` para um `string` não anulável é
aceito, e uma propriedade ausente também: a anotação é ignorada. Com
`RespectNullableAnnotations = true`, `{"Name":null}` lança exceção, e serializar
um `null` que a propriedade diz não poder ser nulo também. `null` para um `int`
comum sempre falha, e `null` para `int?` é aceito. Note que `required` com um
valor `null` ainda passa sem `RespectNullableAnnotations`: presença e nulidade
são checadas de forma independente.

### As opções estritas do .NET 10

O .NET 10 adiciona `JsonSerializerOptions.Strict`, um preset somente leitura. A
página "What's new in .NET libraries for .NET 10" o lista assim: proibir membros
sem correspondência, proibir propriedades duplicadas, manter a correspondência
com diferenciação de caixa e ligar `RespectNullableAnnotations` e
`RespectRequiredConstructorParameters`. Ler as propriedades confirmou
`Unmapped=Disallow Dup=False Nullable=True ReqCtor=True CaseInsensitive=False`.
O comportamento nos payloads anteriores:

```csharp
Deserialize<Person>("""{"Name":"a","Age":1,"Extra":1}""", Strict);   // JsonException: 'Extra' could not be mapped
Deserialize<Person>("""{"Name":"a","Name":"b","Age":1}""", Strict);   // JsonException: Duplicate property 'Name'
Deserialize<Person>("""{"name":"a","AGE":1}""", Strict);              // JsonException (diferencia caixa, sem correspondência)
Deserialize<Person>("""{"Name":"a","Age":1}""", Strict);              // Person { Name = a, Age = 1 }
```

Sem ele, o mesmo payload com duplicata manteve em silêncio o último valor (`b`).
`AllowDuplicateProperties = false` também existe isolado, e a documentação
registra que a mesma chave existe no `JsonDocumentOptions`. A documentação
descreve o `Strict` como compatível na leitura com o `Default`: o que o `Default`
escreveu o `Strict` lê, e o `Strict` leu de volta um record com propriedade
polimórfica escrito pelo `Default`. Parta dele com
`new JsonSerializerOptions(JsonSerializerOptions.Strict) { ... }` e acrescente só
o que precisa, como `WriteIndented` ou uma política de nomes.

### Controles menores que valem conhecer

`[JsonPropertyOrder]` muda a ordem de escrita (menor primeiro, padrão `0`).
`[JsonExtensionData]` num `Dictionary<string, JsonElement>` captura membros sem
correspondência e os escreve de volta. Por padrão uma propriedade de lista com
inicializador é substituída na leitura; `PreferredObjectCreationHandling =
Populate` acrescenta na lista existente (`["a","b"]` mais `["c"]` deu
`["a","b","c"]`). `ReadCommentHandling = Skip` e `AllowTrailingCommas = true`
são necessários para JSON em estilo de configuração: comentário e vírgula final
lançam exceção por padrão.

## Trade-offs

- **Strict pega deriva de contrato e rejeita extras inofensivos.** Um cliente que
  adiciona um campo quebra um leitor `Strict`. Bom para configuração e mensagens
  internas, arriscado para uma API pública que você não controla.
  ```csharp
  Deserialize<Person>("""{"Name":"a","Age":1,"NewField":true}""", Strict); // JsonException
  ```
- **Os padrões Web trocam correção por tolerância.** Correspondência sem caixa e
  números entre aspas aceitam clientes desleixados e escondem bugs do cliente.
  Decida por fronteira, não por projeto.
- **`WhenWritingDefault` confunde "ausente" com "zero".** Ele remove um `0`
  verdadeiro (`Count` sumiu no exemplo acima). Use `WhenWritingNull`
  globalmente e seja explícito por propriedade.
- **Polimorfismo amarra o formato de transporte aos nomes dos seus tipos.** As
  strings de discriminador são um contrato: renomear uma classe é seguro só
  porque você escolheu `"circle"` em vez de depender do nome do tipo, e um
  subtipo novo quebra leitores antigos que lançam exceção para discriminador
  desconhecido.
- **Reuso de options é uma decisão de ciclo de vida.** Uma instância estática é a
  mais rápida e imutável depois do primeiro uso, então mudanças tardias (nomes
  por tenant, por exemplo) exigem uma cópia. Uma cópia que carrega uma instância
  de conversor nova paga o custo dos metadados de novo.
- **Records e `required` são verificados de formas diferentes.** `required` e
  `[JsonRequired]` são aplicados por padrão, parâmetros posicionais não.
  Confiar no construtor de um record como validação exige
  `RespectRequiredConstructorParameters`, ou `Strict`.

## Documentation Links

- [How to instantiate JsonSerializerOptions, reuse and Web defaults, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/configure-options) (doc)
- [What's new in .NET libraries for .NET 10, Serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [Serialize properties of derived classes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) (doc)
- [Require properties for deserialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/required-properties) (doc)
- [Customize property names and values, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/customize-properties) (doc)
- [Handle overflow or missing members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/missing-members) (doc)
- [Ignore properties, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/ignore-properties) (doc)
