---
version: 1.0
updatedAt: 2026-10-15
title: "Migrando do Newtonsoft.Json para o System.Text.Json"
summary: As diferenças de comportamento medidas rodando a mesma entrada nas duas bibliotecas (casing, comentários, números, datas, atributos ignorados, campos, object e DOM), como configurar o System.Text.Json para cada caso e uma ordem de migração guiada por testes.
---
## Objective

Migrar uma base de código do Newtonsoft.Json para o System.Text.Json raramente é
uma troca de nome. As duas bibliotecas discordam nos padrões (casing, aspas,
comentários, parse de números e datas), no que um atributo desconhecido faz
(silenciosamente nada) e em alguns recursos que não têm equivalente. As diferenças
perigosas são as silenciosas: `[JsonProperty]` ignorado, um campo que deixou de ser
escrito, um null onde antes havia um valor ligado. Este conceito lista as diferenças
de comportamento que medi passando a mesma entrada pelas duas bibliotecas, mostra
como configurar o System.Text.Json para ficar mais estrito ou mais permissivo,
cobre os substitutos de DOM e `JObject` e sugere uma ordem de migração que pega as
mudanças silenciosas com testes, e não com dados de produção. Opções e converters
estão nos conceitos anteriores.

## Use Cases

- Tirar os modelos de uma API do Newtonsoft.Json sem mudar o formato na rede.
- Decidir, para uma biblioteca que você mantém, quais recursos do Newtonsoft você
  realmente usa.
- Revisar um pull request que troca `JsonConvert.DeserializeObject` por
  `JsonSerializer.Deserialize`.
- Explicar por que um payload que "sempre funcionou" agora devolve um objeto vazio.

## Deep Dive

### Mesma entrada, resultado diferente

Passei payloads idênticos pelo Newtonsoft.Json 13.0.4 e pelo System.Text.Json do
.NET 10.0.0 (SDK 10.0.100) com configurações padrão nos dois lados. Falha na coluna
significa exceção.

| Entrada | Newtonsoft | System.Text.Json |
|---|---|---|
| `{"NAME":"a","age":3}` em `Name`, `Age` | liga os dois | não liga nada (`Name=""`, `Age=0`), sem erro |
| comentário `/* c */` dentro do objeto | aceito | `JsonException` |
| vírgula final | aceita | `JsonException` |
| aspas simples, nomes sem aspas | aceitos | `JsonException` |
| `"Age":"3"` (número entre aspas) | `3` | `JsonException` |
| `"Name":5` (número em string) | `"5"` | `JsonException` |
| `"Age":3.7` em `int` | `JsonReaderException` | `JsonException` |
| `"Age":null` em `int` | `JsonSerializationException` | `JsonException` |
| entrada com string vazia | devolve `null` | `JsonException` (sem tokens) |
| enum escrito como `"B"` sem converter | `B` | `JsonException` |
| nome de enum desconhecido `"Z"` | exceção | exceção |
| propriedade duplicada | a última vence | a última vence |

A primeira linha é a que dói: nenhuma exceção, toda propriedade no valor padrão. A
documentação chama nomes sem aspas, aspas simples e valores não string para
propriedades string de "not supported by design" (sem suporte por decisão de
projeto). Para os demais existe uma chave, e a configuração equivalente é:

```csharp
var o = new JsonSerializerOptions(JsonSerializerDefaults.Web)  // sem distinção de caixa, camelCase, números em strings
{
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true,
};
// {"name":"a", /* c */ "Age":3,}  ->  P(Name=a, Age=3)
```

Lembre que `Web` também muda a caixa da saída para camelCase. A saída padrão do
Newtonsoft usa o nome da propriedade como escrito, e o System.Text.Json padrão
também mantém isso, então uma migração que não pode mudar o formato na rede deve
ligar só `PropertyNameCaseInsensitive = true`, e não o preset `Web` inteiro.

### O que é ignorado ou escrito de outro jeito

Estes são os silenciosos. Uma classe de teste tinha um campo público, uma
propriedade com setter privado e atributos do Newtonsoft:

| Caso | Saída do Newtonsoft | Saída do System.Text.Json |
|---|---|---|
| campo público `Field` | escrito e lido de volta | não escrito, não lido (precisa de `IncludeFields` ou `[JsonInclude]`) |
| `[JsonProperty("old")]` | nome `old` | atributo ignorado, nome `Old` |
| `[Newtonsoft.Json.JsonIgnore]` | omitido | **escrito mesmo assim** (`{"Secret":7,...}`) |
| método `ShouldSerializeX()` | omite `X` quando falso | método ignorado, `X` escrito |
| `[Newtonsoft.Json.JsonRequired]` com propriedade ausente | `JsonSerializationException` | sem erro, objeto criado |
| setter privado | não atribui | não atribui (precisa de `[JsonInclude]`) |

O System.Text.Json tem os próprios `[JsonPropertyName]`, `[JsonIgnore]`,
`[JsonRequired]` e `[JsonInclude]`, em `System.Text.Json.Serialization`. Os
atributos do Newtonsoft continuam compilando e não fazem nada, então a migração não
falha alto: um modelo que mantém `using Newtonsoft.Json;` e um `[JsonIgnore]` vaza o
campo. Remover esse `using` faz o compilador listar cada atributo que falta traduzir,
e um teste de JSON de referência por modelo (descrito abaixo) pega o resto.

Diferenças de saída, a partir de um objeto com texto acentuado, `<`, `&`, um
double `1.0`, um decimal grande, um `DateTime`, um `DateTimeOffset`, um null e um
`Guid`:

- Texto: o Newtonsoft escreveu `Ação <b> & é` como está; o System.Text.Json escreveu
  `Ação <b> & é`. Os dois são JSON válido que decodifica
  igual, mas um teste que compara strings vai falhar. A documentação descreve isso
  como "Strict character escaping, configurable"; `JavaScriptEncoder.UnsafeRelaxedJsonEscaping`
  relaxa, o que só é seguro quando a saída nunca é embutida em HTML.
- Números: `1.0` virou `1` e `12345678901234567890m` perdeu o `.0`.
- `DateTime`, `DateTimeOffset`, `Guid`, `TimeSpan`, `Uri`, `byte[]` e chaves de
  dicionário não string saíram idênticos. ISO 8601 é o padrão nos dois.
- Datas na leitura: `"2024-01-02"` foi lida nos dois. O formato antigo
  `"/Date(1704164645000)/"` foi lido pelo Newtonsoft e lançou exceção no
  System.Text.Json, assim como `"2024-01-02 03:04"` (com espaço no lugar do `T`).
  Dados de sistemas antigos pedem um converter customizado.

### Ciclos, profundidade e referências

Um objeto que referencia a si mesmo falhou nos dois, com exceções diferentes
(`JsonSerializationException: Self referencing loop` contra
`JsonException: A possible object cycle was detected`). Os dois têm profundidade
máxima padrão de 64 (a documentação também nota que o ASP.NET Core reduz para 32 no
uso próprio). As opções de ignorar não produzem o mesmo JSON:
`ReferenceLoopHandling.Ignore` do Newtonsoft produziu `{"Name":"a"}`, enquanto
`ReferenceHandler.IgnoreCycles` do System.Text.Json produziu
`{"Name":"a","Next":null}`. Se um cliente interpreta esse formato, houve uma mudança
na rede.

### object, dicionários e o DOM

Qualquer coisa tipada como `object` é uma borda afiada. `Dictionary<string, object>`
a partir do mesmo JSON produziu `Int64`, `String`, `JArray`, `JObject`, `Double` no
Newtonsoft e um `JsonElement` para cada valor no System.Text.Json (a documentação
lista "inferred type to `object`" como não suportado de fábrica). Tipifique os
valores, use `JsonNode` ou escreva um converter para `object`.

Os substitutos de DOM são `JsonNode` (mutável, como `JObject`) e `JsonDocument`
(somente leitura). Uma chave ausente devolveu `null` nos dois. Diferenças que medi:
uma string de data continua string no `JsonNode` (kind `String`) mas vira um token
`Date` em `JObject.Parse`; `(int)node["a"]` e `GetValue<string>()` leem valores
tipados, e `(string)node["a"]` num número lançou `InvalidOperationException`. A
documentação afirma que não existe consulta JSONPath (`SelectToken` não tem
equivalente). `JsonNode.GetPath()` só devolve o caminho de um nó (`$.a[1].b`), então
você navega com indexadores ou LINQ.

### Preenchendo objetos existentes

`JsonConvert.PopulateObject` não tem equivalente direto (docs: "not supported,
workaround"). A partir do .NET 8 (docs) existe
`JsonSerializerOptions.PreferredObjectCreationHandling =
JsonObjectCreationHandling.Populate`, também disponível como atributo em tipo ou
propriedade, que preenche uma coleção existente em vez de substituí-la. Com
`Items = ["a"]` inicializado e `["b"]` no JSON: o Newtonsoft deu `a,b`, o
System.Text.Json por padrão deu `b`, e com `Populate` deu `a,b`. Vale para membros
que já guardam um valor, não para um objeto inteiro que você passa, e a
documentação avisa que hoje não funciona para tipos com construtor parametrizado.

### Uma ordem de migração que acha as mudanças silenciosas

1. Liste os recursos do Newtonsoft que você usa: busque por `JsonProperty`,
   `JsonConverter`, `JObject`, `TypeNameHandling`, `ShouldSerialize`,
   `PopulateObject`, `SelectToken`.
2. Para cada modelo, guarde um JSON de referência capturado do Newtonsoft e afirme
   que o System.Text.Json produz os mesmos bytes (ou a mesma árvore) e lê as mesmas
   entradas. Isso pega um `[JsonProperty]` esquecido, um campo ou um enum.
3. Migre uma fronteira de cada vez (um endpoint, um tipo de mensagem), não a solução
   inteira; as duas bibliotecas convivem no mesmo processo.
4. Trate os recursos sem equivalente como decisões de design: `TypeNameHandling`
   vira `[JsonDerivedType]` explícito (a saída muda: `{"$type":"dog",...}` com um
   nome que você escolhe, em vez de um nome qualificado por assembly), e JSONPath
   vira código.

## Trade-offs

- **Padrões mais estritos acham bugs e quebram produtores permissivos.** Um cliente
  que envia aspas simples ou comentários precisa ser corrigido ou atendido com um
  parse customizado.
  ```csharp
  new JsonSerializerOptions { ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true }
  ```
- **Sem exceção não significa sem mudança.** Sensibilidade a caixa, campos ausentes
  e atributos ignorados produzem um objeto, não um erro. Só testes enxergam.
- **Migrar compra velocidade e AOT, e custa recursos.** Source generation e uma
  dependência a menos são reais; JSONPath, `TypeNameHandling` e leitura permissiva
  não voltam.
- **Um converter para `object` ou datas legadas é um custo permanente.** Escreva uma
  vez, teste com os payloads antigos e mantenha esses payloads como fixtures.
- **Manter o Newtonsoft também é válido.** Se o código depende de JSONPath, de
  malabarismos com `JObject` ou de entradas permissivas, o custo da migração pode
  superar o benefício.

## Documentation Links

- [Migrate from Newtonsoft.Json to System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft) (doc)
- [System.Text.Json overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/overview) (doc)
- [How to use a JSON DOM, JsonDocument and JsonNode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [Customize character encoding, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/character-encoding) (doc)
- [How to preserve references and handle cycles, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/preserve-references) (doc)
