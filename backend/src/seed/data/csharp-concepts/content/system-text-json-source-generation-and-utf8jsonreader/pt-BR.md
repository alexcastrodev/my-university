---
version: 1.0
updatedAt: 2026-10-15
title: "System.Text.Json: Source Generation, JsonNode e Utf8JsonReader"
summary: JsonSerializerContext e [JsonSerializable], o que muda sob trimming e AOT (avisos reais, sem publicar AOT), JsonDocument versus JsonNode versus POCO medidos, Utf8JsonReader e Utf8JsonWriter e streaming com DeserializeAsyncEnumerable.
---
## Objective

O serializador do conceito anterior descobre seus tipos por reflexão em tempo de
execução. É prático e tem três custos: a primeira chamada é mais lenta, há avisos
sob trimming e há falha dura sob Native AOT. Este conceito cobre a alternativa
que leva esse trabalho para a compilação (`JsonSerializerContext` e
`[JsonSerializable]`), o que de fato muda quando o app sofre trimming, e as
três ferramentas de nível mais baixo que você escolhe quando não quer um modelo
de objetos completo: `JsonDocument`, `JsonNode` e o par
`Utf8JsonReader` / `Utf8JsonWriter`, além de ler arrays em streaming com
`DeserializeAsyncEnumerable`. Opções e polimorfismo estão no conceito de
serialização e opções.

## Use Cases

- Publicar um serviço com trimming ou Native AOT que precisa serializar sem
  reflexão.
- Ler um campo de uma resposta grande sem criar objetos para o resto.
- Editar um documento JSON cuja forma não é sua (adicionar uma propriedade e
  manter o resto).
- Processar elemento a elemento um array de vários megabytes enquanto ele chega.

## Deep Dive

### O que o gerador de código produz

Declare uma classe partial derivada de `JsonSerializerContext` e liste os tipos
raiz. Todos os números abaixo vêm de .NET 10.0.0 (SDK 10.0.100), macOS 27.0.1,
Apple M4 Max.

```csharp
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, UseStringEnumConverter = true)]
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(Order[]))]
partial class AppJsonContext : JsonSerializerContext;

JsonSerializer.Serialize(order, AppJsonContext.Default.Order);
// {"id":1,"customer":"Ana","total":9.5,"tags":["a","b"],"status":"Shipped"}
```

Para um record de 5 membros o gerador emitiu 569 linhas em 9 arquivos (com
`EmitCompilerGeneratedFiles`): uma fábrica de `JsonTypeInfo<Order>`, um delegate
de construtor e um handler de escrita por tipo, incluindo `int`, `string`,
`decimal`, `List<string>` e o enum, descobertos percorrendo os membros. Regras
que me surpreenderam:

- Tipos de membros são descobertos, coleções não. Com só `Order` listado,
  `GetTypeInfo(typeof(Status))` foi encontrado, mas `typeof(List<Order>)` deu
  `null`; `Order[]` funcionou porque eu o listei.
- Um tipo não listado falha alto: `InvalidOperationException: JsonTypeInfo
  metadata for type 'Person' was not provided by TypeInfoResolver of type
  'AppJsonContext'`, ou `NotSupportedException` por meio de uma instância de
  options.
- O contexto tem as próprias opções. `[JsonSourceGenerationOptions]` as define
  em tempo de compilação, e `AppJsonContext.Default.Options` é somente leitura
  ("cannot be modified once encapsulated by a JsonSerializerContext"). Um
  contexto sem configuração usa os padrões simples: minha primeira execução leu
  um payload em minúsculas sem erro e não ligou nada, até eu adicionar
  `JsonSerializerDefaults.Web`.
- Chame as sobrecargas que recebem `JsonTypeInfo<T>` ou um contexto. Para manter
  a reflexão como reserva, `JsonTypeInfoResolver.Combine(AppJsonContext.Default,
  new DefaultJsonTypeInfoResolver())` serializou o `Person` não listado, com os
  avisos de volta.

Existem dois modos de geração. O padrão (metadata) gera tudo o que é preciso
nos dois sentidos. `GenerationMode = Serialization` (fast path) gera só um
handler de escrita: escreveu `Order` bem, mas a leitura lançou "did not provide
property metadata", e um `Shape` polimórfico também falhou na escrita. A
documentação diz que polimorfismo só é suportado no modo metadata, então mantenha
o padrão a menos que você só escreva e o profiling mostre a necessidade.

Velocidade, medida num record de 5 membros: 0,52 us por chamada com o contexto
contra 0,60 us com reflexão depois de aquecido, o que não é motivo para
adotá-lo. O ganho mensurável é a partida: o primeiro serialize mais deserialize
num processo novo levou uma mediana de cerca de 15,4 ms com o contexto e 19,9 ms
com reflexão (12 execuções cada, `dotnet App.dll` dependente de framework). Os
outros ganhos estão na próxima seção.

### O que muda sob trimming e AOT, sem publicar AOT

Eu não publiquei Native AOT. Trimming e os analisadores bastam para ver o
contrato. Com `IsAotCompatible` ligado, o compilador avisou nestas chamadas:

| Chamada | Aviso |
|---|---|
| `Serialize(o)` | IL2026 e IL3050 |
| `Serialize(o, optionsComResolverDoContexto)` | IL2026 e IL3050 (a sobrecarga é anotada, não importa o que as options contêm) |
| `Serialize(o, JsonSerializerOptions.Web)` | IL2026 e IL3050, na chamada e no próprio `Web` |
| `Serialize(o, ctx.Order)` ou `Serialize(o, typeof(Order), ctx)` | nenhum |
| `new JsonStringEnumConverter()` | IL3050 |
| `new JsonStringEnumConverter<Status>()` | nenhum |

A regra: passe um `JsonTypeInfo` ou um contexto, nunca uma sobrecarga só com
options, e use o conversor de enum genérico
(`[JsonConverter(typeof(JsonStringEnumConverter<Level>))]` no enum, ou
`UseStringEnumConverter = true` no contexto).

Em tempo de execução o quadro é mais duro que os avisos. Um app com
`PublishTrimmed=true` gravou
`System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault: false` no
`runtimeconfig.json` (a documentação diz que o trimming desliga a reflexão a menos
que você defina a propriedade), e um `Serialize(o)` simples então lançou
`InvalidOperationException: Reflection-based serialization has been disabled`.
Religar com `<JsonSerializerIsReflectionEnabledByDefault>true</...>` é pior de um
jeito silencioso: para uma classe cujos getters nada mais referenciava, o app com
trimming imprimiu `{}` enquanto o mesmo código sem trimming imprimiu
`{"Name":"gear","Teeth":12}`. O trimmer removeu membros que só a reflexão
usaria. Um app com contexto publicado com trimming do mesmo jeito imprimiu o
JSON certo, e esse é o argumento real a favor do gerador.

### JsonDocument versus JsonNode versus um POCO

Os três leem JSON sem um tipo seu. `JsonDocument` é uma visão somente leitura
sobre um buffer do pool (por isso é `IDisposable`); `JsonNode` é uma árvore
mutável de objetos. A mesma tarefa, somar `total` das linhas com `status` igual a
`"paid"` num array de 2.000 linhas e 277.561 bytes, 300 repetições:

| Abordagem | Tempo por execução | Alocado por execução |
|---|---|---|
| deserializar para array de records (source gen) | 2,3 ms | 1.141 KB |
| `JsonDocument` | 1,0 ms | 0,1 KB (buffers vêm do pool) |
| `JsonNode` | 1,8 ms | 2.850 KB |
| `Utf8JsonReader` | 0,43 ms | 0 KB |

As quatro devolveram 666499,75. O reader é o mais rápido e não aloca, mas meu
laço só funciona porque `status` vem antes de `total` em toda linha: o estado é
mantido à mão. Comportamentos para conhecer:

- `JsonDocument`: `GetProperty` com nome ausente lança `KeyNotFoundException`
  (use `TryGetProperty`); `GetInt32` numa string lança `InvalidOperationException`.
  Um `JsonElement` usado depois do `Dispose` lança `ObjectDisposedException`,
  então faça `Clone()` antes (o clone sobreviveu ao descarte).
- Números mantêm o texto: `1.10` continuou `1.10` em `GetRawText` e no
  `JsonNode`, e um número de 20 dígitos lido como `double` perdeu precisão
  (`1.2345678901234567E+19`) enquanto `GetDecimal` manteve
  `12345678901234567890.123456789`.
- `JsonNode`: chave ausente devolve `null`, então `node["nope"]["x"]` é uma
  `NullReferenceException`. Um nó tem um único pai: atribuir um nó já anexado a
  outro lugar lançou "already has a parent"; use `DeepClone()`. `Add` com chave
  existente lança, o indexador substitui.
- Segundo a documentação, o `JsonSerializerOptions` passado a um `JsonNode` ou
  `JsonDocument` só contribui com conversores customizados, então
  `DefaultIgnoreCondition` não se aplica.

### Utf8JsonReader e Utf8JsonWriter

`Utf8JsonReader` é um `ref struct` só para frente sobre `ReadOnlySpan<byte>` ou
`ReadOnlySequence<byte>`. Não pode ser campo de uma classe, não atravessa um
`await` e deve ser passado por `ref`, porque é mutável e uma cópia perderia a
posição. Percorrer um objeto pequeno mostrou o que `Read()` entrega: um token
para `StartObject`, `PropertyName`, `Number` e assim por diante, com
`CurrentDepth` e `TokenStartIndex` (offset em bytes). Compare nomes com
`ValueTextEquals("status"u8)`, que não aloca e trata escapes. `Skip()` pulou um
objeto aninhado até a próxima propriedade.

As falhas são específicas: `{"a":1,}` gerou uma `JsonReaderException` citando a
vírgula final e sua posição em bytes, e `GetInt32` num token string lançou
`InvalidOperationException`. Para dados que chegam em pedaços, passe
`isFinalBlock: false` e o `CurrentState` anterior, depois realimente os bytes a
partir de `BytesConsumed`. Alimentar 7 bytes por vez produziu 14 tokens, o mesmo
que ler o buffer inteiro. O buffer precisa ser pelo menos do tamanho do maior
token (documentação).

`Utf8JsonWriter` escreve num `IBufferWriter<byte>` ou num stream e acumula até o
`Flush` (0 bytes visíveis antes, 2 depois para `{}`). Ele valida a estrutura: um
número direto dentro de um objeto, sem nome de propriedade, lançou
`InvalidOperationException`; com `SkipValidation = true` escreveu o inválido
`{1}`. O encoder padrão é conservador: `Ação <b> + é` virou
`Ação <b> + é`, e
`JavaScriptEncoder.UnsafeRelaxedJsonEscaping` manteve o texto legível, o que só é
seguro quando a saída nunca é embutida em HTML.

### Arrays em streaming com DeserializeAsyncEnumerable

`JsonSerializer.DeserializeAsyncEnumerable<T>(stream)` entrega cada elemento de
um array de nível superior assim que a chave de fechamento foi lida. Com um pipe
escrevendo uma linha a cada 300 ms, as linhas saíram em 1 ms, 303 ms e 604 ms, e
não no fim. Lê de um `Stream` ou de um `PipeReader` (.NET 10). Espera um array:
um único objeto de nível superior falhou com erro de "could not be converted".
Passar `topLevelValues: true` lê em vez disso uma sequência de valores separados
por espaço (2 objetos no meu teste). O lado do endpoint disso está no conceito de
async streams.

## Trade-offs

- **Source generation leva falhas para a compilação e adiciona uma tarefa de
  registro.** Todo tipo raiz e toda coleção precisa ser listado, e um esquecido
  falha em tempo de execução.
  ```csharp
  [JsonSerializable(typeof(List<Order>))] // sem esta linha, List<Order> não tem metadata
  ```
- **O gerador remove a reflexão, não a disciplina com opções.** O contexto leva
  as próprias regras de caixa e de ignorar, então um contexto e um
  `JsonSerializerOptions` compartilhado podem discordar. Defina os padrões no
  contexto.
- **O modo fast path só escreve e não é polimórfico.** É menor, mas uma mudança
  futura do tipo "agora também lemos isso" falha em tempo de execução.
- **`JsonDocument` é barato e frágil.** Memória do pool significa regras de
  descarte: devolva um `Clone()`, nunca o elemento. A busca de propriedade é
  sequencial.
- **`JsonNode` é conveniente e aloca.** Custou 2,5 vezes a memória de uma leitura
  tipada do mesmo payload aqui, em troca de flexibilidade de edição.
- **`Utf8JsonReader` é rápido e implacável.** Lógica que depende de ordem,
  buffers parciais manuais, nenhum `await` dentro do laço. Use em caminhos quentes
  e para pular payloads grandes, não como padrão.
- **Números são texto até você pedir.** `GetDouble` pode perder dígitos que
  `GetDecimal` mantém, então escolha pelo significado do campo.

## Lab

Neste lab você recebe `AppJsonContext` como uma classe parcial quase vazia (com um `[JsonSerializable(typeof(Status))]` provisório só para o gerador ter o que emitir) e `Codec` com os métodos **vazios**. O seu trabalho é trocar o JSON baseado em reflection por um `JsonSerializerContext` gerado em tempo de compilação, entender o que ele descobre e o que não descobre, e descer para `Utf8JsonReader` e `Utf8JsonWriter` quando quiser processar JSON sem montar objetos nem strings. O gerador já vem no SDK, então não há pacote: você só declara atributos.

**O cenário**

Pedidos (`Order`) serializados com metadados gerados, e payloads processados direto em bytes UTF-8.

- `Models.cs`: `Status`, `Order` (com um array `Tags`) e `Person`, que **não** é registrado de propósito: é o "tipo esquecido".
- `AppJsonContext.cs`: o contexto a configurar.
- `Codec.cs`: `Serialize`, `Deserialize`, `SerializeAll`, `IsRegistered`, `SerializeWithFallback`, `ReadTokens`, `SumPaid`, `WriteSummary`, `WriteInvalid` e `ReadTokensInChunks`.

Coleções não são descobertas pelo gerador: precisam ser listadas.

**O que você vai fazer, passo a passo**

1. **Declarar o contexto (TODO-00).** Em `AppJsonContext`, adicione `[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, UseStringEnumConverter = true)]`, registre `Order` e `Order[]` com `[JsonSerializable]` e apague o placeholder. Em `Codec.Serialize` e `Deserialize`, use `AppJsonContext.Default.Order` (não a sobrecarga com `JsonSerializerOptions`, que usa reflection). Um payload em minúsculas deve ser aceito.
2. **Serializar coleções e perguntar ao contexto (TODO-01).** `SerializeAll` usa `AppJsonContext.Default.OrderArray`, então converta com `ToArray()` antes (`List<Order>` não tem metadados). `IsRegistered` pergunta ao contexto com `GetTypeInfo`, em vez de tentar serializar e capturar a exceção.
3. **Manter reflection como fallback (TODO-02).** Em `SerializeWithFallback`, monte `JsonSerializerOptions(JsonSerializerDefaults.Web)` cujo `TypeInfoResolver` é `JsonTypeInfoResolver.Combine(AppJsonContext.Default, new DefaultJsonTypeInfoResolver())`: tipos listados usam código gerado e `Person` cai para reflection.
4. **Ler sem alocar (TODO-03).** `ReadTokens` percorre o payload com `Utf8JsonReader` e devolve o `TokenType` de cada token; JSON inválido deve virar `JsonException`. `SumPaid` soma o `total` das linhas com `status` igual a `"paid"` sem alocar strings, usando `ValueTextEquals("status"u8)` e `GetDecimal()`. A ordem das chaves varia, objetos e arrays aninhados são pulados com `Skip()` e a linha termina num `EndObject` com `CurrentDepth` 1. O reader é um `ref struct`: passe por `ref`.
5. **Escrever direto no buffer (TODO-04).** `WriteSummary` escreve `{"count":N,"orders":[...]}` num `IBufferWriter<byte>` com `Utf8JsonWriter`, sem string intermediária nem indentação, com `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` quando `relaxedEncoder` for verdadeiro, e chama `Flush()`. `WriteInvalid` escreve `StartObject`, um número solto e `EndObject`, com `SkipValidation` vindo do parâmetro: o writer validador deve lançar `InvalidOperationException` sozinho.
6. **Ler dados que chegam em pedaços (TODO-05).** `ReadTokensInChunks` dá o mesmo resultado de `ReadTokens`, fingindo que os dados chegam `chunkSize` bytes por vez. Guarde `offset` e `available`, crie o `Utf8JsonReader` com `isFinalBlock: available == utf8Json.Length` e o `state`, leia até `Read()` devolver false, avance `offset` por `BytesConsumed` e guarde `reader.CurrentState`.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `List<Order>` não está registrado enquanto `Status` está, o que o fallback combinado resolve e por que o writer com `SkipValidation` produz `{1}`.

**Desafios opcionais**

- **TODO-06:** adicione um segundo contexto com `GenerationMode = JsonSourceGenerationMode.Serialization`. Escreva um `Order` com ele e depois tente ler um. O que acontece e por quê?
- **TODO-07:** faça o parse com `JsonDocument`, devolva um `JsonElement` de um método que já descartou o documento e observe a exceção. Depois devolva `element.Clone()`.

**Pré-requisitos:** records e atributos em C#, `JsonSerializer.Serialize`/`Deserialize` básicos, noções de `Span<T>` e `ref struct`, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário com a dica (em `AppJsonContext.cs` e `Codec.cs`), então os testes vermelhos são o seu checklist.

## Documentation Links

- [How to use source generation in System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) (doc)
- [Source-generation modes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation-modes) (doc)
- [How to use a JSON DOM, JsonDocument and JsonNode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [How to use Utf8JsonReader, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-utf8jsonreader) (doc)
- [How to use Utf8JsonWriter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-utf8jsonwriter) (doc)
- [What's new in .NET libraries for .NET 10, PipeReader support, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
