---
version: 1.0
updatedAt: 2026-08-19
title: Processamento de JSON em Java
summary: "O JDK ainda não tem suporte a JSON, então trabalhar com JSON significa escolher uma biblioteca e um de três modelos de processamento — data binding, o tree model, ou streaming — todos oferecidos pelo Jackson como o padrão de fato."
---
## Objective

JSON é o formato de transporte padrão para quase tudo com que um serviço Java conversa, mas o próprio JDK ainda não consegue ler ou escrever JSON: não há tipo JSON nenhum em `java.base`, e nenhum pacote `java.util.json`. (A JEP 540 do OpenJDK, *Simple JSON API*, está proposta para ter como alvo o JDK 28 como um módulo **incubating** `jdk.incubator.json` — e mesmo essa exclui deliberadamente object mapping.) Então todo programa Java que toca JSON escolhe uma biblioteca, e a decisão real não é "qual biblioteca" mas **qual dos três modelos de processamento**: *data binding* (JSON direto para seus próprios records/classes), o *tree model* (um grafo de nós genérico em memória que você navega por nome), ou um *parser streaming* (um cursor forward-only sobre tokens, sem guardar nada). Jackson é o padrão de fato porque é a única opção mainstream que te dá os três atrás de uma única fachada — e porque os frameworks já vêm com ele embutido.

## Use Cases

- Transformar o corpo de uma resposta HTTP em um `record` ou DTO, e um DTO de volta em um corpo de requisição — o caso do dia a dia de cliente/servidor REST.
- Ler três campos de uma config, manifest, ou payload de webhook grande cujo schema completo você não quer modelar — tree model mais um JSON Pointer.
- Consumir um export JSON de múltiplos gigabytes linha por linha, ou um array paginado, sem manter tudo no heap — o parser streaming.
- Sobreviver à evolução de schema: o provedor adiciona um campo, renomeia um, ou começa a enviar `null`, e sua desserialização não pode quebrar.
- Construir uma API REST com Spring Boot, onde o Jackson já está no classpath e seu trabalho é *configurá-lo* (bean `JsonMapper`, naming de propriedades, formato de data) em vez de chamá-lo diretamente.
- Emitir logs estruturados em JSON ou eventos de auditoria a partir de um grafo de objetos existente.
- Tratar dinheiro e identificadores corretamente, onde o único tipo "número" do JSON vai silenciosamente custar precisão.

## Deep Dive

Todo exemplo abaixo lê ou escreve este documento:

```json
{
  "name": "robinparse",
  "version": "1.2.3",
  "description": "Another Parser for JSON",
  "contributors": ["Robin Smythe", "Jon Jenz", "Jan Ardann"]
}
```

Jackson vem em três artefatos — `jackson-core` (streaming), `jackson-annotations`, `jackson-databind` (binding mais tree model, que puxa os outros dois). Dependa de `jackson-databind` e você recebe tudo:

```xml
<!-- Jackson 2.x — the version on most classpaths today -->
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.22.1</version>
</dependency>

<!-- Jackson 3.x — new groupId, new packages -->
<dependency>
  <groupId>tools.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>3.2.0</version>
</dependency>
```

Os snippets aqui usam `JsonMapper.builder().build()`, que compila sem alterações tanto no Jackson 2.10+ quanto no Jackson 3; só a linha de import muda (`com.fasterxml.jackson.databind.json.JsonMapper` vs `tools.jackson.databind.json.JsonMapper`).

### Data binding: JSON para um record e de volta

Data binding é o caminho mais curto: descreva a forma como um tipo Java, entregue o tipo ao Jackson, receba um objeto. Records funcionam diretamente — o Jackson lê os nomes dos componentes direto do arquivo de classe, então nenhuma anotação e nenhum setter são necessários:

```java
record SoftwareInfo(String name, String version,
                    String description, List<String> contributors) {}

var mapper = JsonMapper.builder().build();

SoftwareInfo info = mapper.readValue(json, SoftwareInfo.class);
System.out.println(info.contributors().get(1));   // Jon Jenz

String back = mapper.writeValueAsString(info);
```

`readValue` é sobrecarregado para `String`, `byte[]`, `File`, `InputStream`, `Reader` e `URL`; `writeValue(OutputStream, Object)` e `writeValueAsString(Object)` fazem o caminho inverso. Uma coleção genérica não pode ser descrita por um literal `Class`, porque erasure descarta o tipo do elemento — isso precisa de `TypeReference`:

```java
// WRONG: compiles, then blows up at the first use
List<SoftwareInfo> broken = mapper.readValue(arrayJson, List.class);
SoftwareInfo first = broken.get(0);
// ClassCastException: LinkedHashMap cannot be cast to SoftwareInfo

// RIGHT: TypeReference keeps the element type
List<SoftwareInfo> good =
    mapper.readValue(arrayJson, new TypeReference<List<SoftwareInfo>>() {});
```

`Map<String, Object>` é a válvula de escape não tipada e funciona da mesma forma — útil quando você genuinamente não sabe as chaves.

### Controlando o mapeamento com anotações

O mapeamento padrão (nome de propriedade Java para nome de propriedade JSON) cobre a maioria dos casos; `jackson-annotations` cobre o resto. Estas são as cinco que carregam peso real na prática:

```java
@JsonIgnoreProperties(ignoreUnknown = true)     // tolerate fields you don't model
public class Account {

    @JsonProperty("account_id")                 // JSON name differs from Java name
    private String id;

    @JsonAlias({"mail", "emailAddress"})        // accept legacy names on read only
    private String email;

    @JsonIgnore                                 // never read, never written
    private String passwordHash;

    @JsonInclude(JsonInclude.Include.NON_NULL)  // omit when null instead of "x": null
    private String nickname;

    // getters / setters
}
```

Sem `@JsonIgnoreProperties` (ou o setting global equivalente), um campo não modelado é uma falha total — o Jackson é estrito por padrão:

```java
record Point(int x, int y) {}

mapper.readValue("{\"x\":1,\"y\":2,\"z\":3}", Point.class);
// UnrecognizedPropertyException: Unrecognized field "z" (class Point),
// not marked as ignorable
```

Desligue isso globalmente quando você consome APIs de terceiros que não controla:

```java
var lenient = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
```

`@JsonProperty` em um componente de record também funciona, e `@JsonCreator` em um construtor ou static factory assume a construção do objeto quando os padrões não conseguem (múltiplos construtores, validação, uma forma "delegating" de um único argumento).

### O tree model: JsonNode

Quando você não tem uma classe para vincular — ou não quer uma — leia o documento em uma árvore `JsonNode` e a percorra. Todo nó é um `JsonNode`; objetos e arrays são só nós com filhos:

```java
JsonNode root = mapper.readTree(json);

String name = root.get("name").asText();          // asString() in Jackson 3.x
for (JsonNode contributor : root.get("contributors")) {   // JsonNode is Iterable
    System.out.println(contributor.asText());
}
```

A armadilha é `get` versus `path`. `get` retorna `null` para um campo ausente, então encadear chamadas leva direto a um `NullPointerException`; `path` retorna um `MissingNode` que mantém a cadeia viva e responde `isMissingNode()`:

```java
root.get("license").asText();               // NullPointerException — no such field
root.path("license").asText("unknown");     // "unknown" — MissingNode, default applied
root.path("license").isMissingNode();       // true
```

Construir uma árvore para saída é a operação espelhada, via `ObjectNode`/`ArrayNode`:

```java
ObjectNode out = mapper.createObjectNode();
out.put("name", "robinparse").put("version", "1.2.3");
out.putArray("contributors").add("Robin Smythe").add("Jon Jenz");

System.out.println(out.toString());
// {"name":"robinparse","version":"1.2.3","contributors":["Robin Smythe","Jon Jenz"]}
```

`mapper.convertValue(node, SoftwareInfo.class)` e `mapper.valueToTree(info)` convertem entre os dois modelos sem uma volta pelo texto — útil quando você precisa inspecionar um documento antes de decidir para qual tipo vinculá-lo.

### JSON Pointer: um valor de dentro de um documento aninhado

A RFC 6901 define JSON Pointer, uma sintaxe de caminho minúscula (nomes separados por `/`, índices de array como números) para endereçar um elemento dentro de um documento JSON. Não é XPath e não é JSONPath — sem wildcards, sem predicados, sem expressões — o que é exatamente por que não precisa de dependência extra: o Jackson o implementa em `JsonNode.at()`.

```java
JsonNode root = mapper.readTree("""
    {"firstName":"Robin","age":63,
     "roles":["Mork","Mrs. Doubtfire","Patch Adams"]}
    """);

root.at("/firstName").asText();        // Robin
root.at("/age").asInt();               // 63
root.at("/roles/1").asText();          // Mrs. Doubtfire
root.at("/roles").size();              // 3
```

Um pointer que não casa retorna `MissingNode` em vez de lançar exceção, então uma falha é um valor que você testa, não uma exceção que você captura. Use `requiredAt` quando uma falha *é* de fato um bug:

```java
root.at("/publisher/city").isMissingNode();   // true — no exception
root.requiredAt("/publisher/city");           // IllegalArgumentException: no node at that pointer
```

Dois caracteres são escapados, porque `/` e `~` são estruturais: `~1` significa uma `/` literal dentro de um nome, `~0` um `~` literal. Então o campo `"ft/pt"` é endereçado como `/ft~1pt`.

Onde um pointer não é suficiente — "todo autor de todo livro acima de $10" — isso é território de JSONPath, uma biblioteca separada (Jayway `json-path`), não algo que o Jackson distribui.

### O parser streaming: documentos grandes demais para segurar

Os dois modelos acima materializam o documento inteiro. Quando o documento é um export de 5 GB, a única opção é um cursor de token forward-only: `JsonParser` de `jackson-core`. Você puxa um token por vez e guarda o que interessa:

```java
var factory = JsonFactory.builder().build();

try (JsonParser p = factory.createParser(new File("huge.json"))) {
    while (p.nextToken() != null) {
        if (p.currentToken() == JsonToken.FIELD_NAME     // PROPERTY_NAME in Jackson 3
                && "name".equals(p.currentName())) {
            p.nextToken();                               // advance onto the value
            System.out.println(p.getText());             // getString() in Jackson 3
        }
    }
}
```

O uso de memória é de alguns kilobytes independentemente do tamanho do documento, e é a opção mais rápida — mas não há como voltar, sem acesso aleatório, e a profundidade de aninhamento é rastreada por você. A contrapartida geradora é `JsonGenerator`:

```java
try (JsonGenerator g = factory.createGenerator(System.out)) {
    g.writeStartObject();
    g.writeStringProperty("name", "robinparse");   // writeStringField in Jackson 2
    g.writeEndObject();
}
```

Na prática, streaming vale a pena por um de dois motivos: o documento não cabe em memória, ou você está em um hot path onde o overhead de binding aparece em um profile. Fora isso, use binding.

### Jackson 2 versus Jackson 3

O Jackson 3.0 foi lançado em outubro de 2025 (3.2.0 em junho de 2026) e é uma quebra dura — uma que você vai encontrar no momento em que um projeto migrar para o Spring Boot 4, que usa Jackson 3 por padrão. O Jackson 2.x não está morto: 2.21 é uma linha LTS mantida até 2028, e as duas majors são projetadas para conviver no mesmo classpath, porque os nomes de pacote diferem.

| | Jackson 2.x | Jackson 3.x |
|---|---|---|
| groupId | `com.fasterxml.jackson.core` | `tools.jackson.core` |
| pacotes | `com.fasterxml.jackson.*` | `tools.jackson.*` (annotations stay `com.fasterxml.jackson.annotation`) |
| ponto de entrada | `new ObjectMapper()` | `JsonMapper.builder().build()` — immutable, no public constructor |
| exceções | checked `JsonProcessingException` | unchecked `JacksonException` / `DatabindException` |
| baseline | Java 8 | Java 17 |

As mudanças de imutabilidade e de exceção não verificada são o que você sente no código:

```java
// Jackson 2.x — mutable mapper, checked exception
ObjectMapper mapper = new ObjectMapper();
mapper.enable(SerializationFeature.INDENT_OUTPUT);
try {
    mapper.readValue(json, Point.class);
} catch (JsonProcessingException e) { /* must be handled */ }

// Jackson 3.x — configure at build time, nothing to catch
var mapper = JsonMapper.builder()
        .enable(SerializationFeature.INDENT_OUTPUT)
        .build();
mapper.readValue(json, Point.class);   // JacksonException is a RuntimeException
```

Alguns padrões também mudaram: no 3.x `FAIL_ON_TRAILING_TOKENS` e `SORT_PROPERTIES_ALPHABETICALLY` estão ligados, `WRITE_DATES_AS_TIMESTAMPS` está desligado. Ordem alfabética de propriedades em particular vai mudar os bytes da sua saída, o que importa se algo a jusante compara JSON como texto.

### java.time e outros tipos do JDK

A surpresa mais comum do Jackson na versão 2.x: `java.time` não é suportado de fábrica. Serializar um record com um `LocalDate` falha completamente a menos que um módulo seja registrado.

```java
record Release(String version, LocalDate date) {}

var mapper = JsonMapper.builder().build();
mapper.writeValueAsString(new Release("1.2.3", LocalDate.of(2026, 8, 19)));
// InvalidDefinitionException: Java 8 date/time type `java.time.LocalDate`
// not supported by default: add Module
// "com.fasterxml.jackson.datatype:jackson-datatype-jsr310" to enable handling
```

Adicione a dependência, registre o módulo, e desabilite a saída de timestamp para obter strings ISO-8601 em vez de arrays numéricos:

```java
var mapper = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .build();
// {"version":"1.2.3","date":"2026-08-19"}
```

No Jackson 3 essa etapa toda desaparece: os três "módulos Java 8" (`jsr310`, `jdk8`, `parameter-names`) vêm embutidos em `jackson-databind`, e `WRITE_DATES_AS_TIMESTAMPS` já vem desligado por padrão.

### As alternativas, e por que o Jackson vence mesmo assim

**Gson** (Google) é o concorrente mais próximo e a API pequena mais agradável — dois métodos e nenhuma anotação para o caso comum:

```java
Gson gson = new Gson();
SoftwareInfo info = gson.fromJson(json, SoftwareInfo.class);
String out = gson.toJson(info);
```

Gson é código bom e ainda amplamente implantado, especialmente no Android. Mas seus próprios mantenedores o descrevem como estando em **modo de manutenção** — bugs são corrigidos, recursos novos grandes geralmente não são — o que é o ponto decisivo ao escolher para um serviço novo em 2026.

**org.json** (JSON-Java) é o mais baixo nível dos três. Não há binding nenhum: você trabalha nas próprias abstrações do JSON e puxa valores por nome, o que significa que o compilador não pode te ajudar.

```java
JSONObject obj = new JSONObject(new JSONTokener(inputStream));
String name = obj.getString("name");
JSONArray contribs = obj.getJSONArray("contributors");
for (Object contributor : contribs) {   // JSONArray implements Iterable<Object>
    System.out.println(contributor);
}
```

Ele sobrevive pela ubiquidade (vem empacotado no Android) e não pelo mérito — uma chave ausente lança `JSONException` em vez de fornecer um valor testável de ausência, não há data binding, e não há modo streaming. Tutoriais mais antigos ainda mostram um loop de índice aqui porque `JSONArray` é anterior à sua própria implementação de `Iterable`; ela tem uma há anos.

**JSON-B / JSON-P** (`jakarta.json.bind`, `jakarta.json`) são a opção standards-track, parte do Jakarta EE em vez do Java SE. A API de binding é genuinamente limpa, e por ser uma spec, as implementações são intercambiáveis (Eclipse Yasson, Parsson):

```java
Jsonb jsonb = JsonbBuilder.create();
SoftwareInfo info = jsonb.fromJson(json, SoftwareInfo.class);
String out = jsonb.toJson(info);
```

A pegadinha é que você só ganha isso de graça dentro de um container Jakarta EE / MicroProfile; fora de um, você está adicionando uma API de spec mais uma implementação para fazer o que uma única dependência do Jackson já faz.

O Jackson domina por razões estruturais, não estéticas: é o provedor JSON padrão no Spring Boot (Jackson 3 no Boot 4, Jackson 2 no Boot 3) e nas principais implementações JAX-RS (Jersey, RESTEasy, CXF); cobre os três modelos de processamento mais formatos não-JSON (XML, YAML, CBOR, Smile, Avro, Protobuf) atrás da mesma API `ObjectMapper`; e é desenvolvido ativamente em duas linhas de release paralelas. Na maioria dos projetos a escolha já foi feita pelo framework — você herda o Jackson quer tenha escolhido ou não, então conhecer seus knobs compensa mais do que escolher um favorito.

### Chegando ao JDK: a JEP 540

A JEP 540, *Simple JSON API (Incubator)*, está proposta para ter como alvo o **JDK 28** e colocaria JSON na plataforma pela primeira vez, no módulo incubating `jdk.incubator.json`. A forma é uma hierarquia sealed `JsonValue` mais uma fachada `Json`:

```java
// jdk.incubator.json — JDK 28, incubator module
int temperature = Json.parse(body)
        .get("properties")
        .get("periods")
        .get(0)
        .get("temperature")
        .asInt();
```

Note o que isso é e o que não é. É um tree model com factory methods (`JsonObject.of`, `JsonString.of`), navegação (`get(String)`, `get(int)`, `tryGet` retornando `Optional<JsonValue>`) e conversões (`asInt`, `asMap`, `asList`). Data binding, streaming, e parsing lenient estão **explicitamente fora de escopo** — o objetivo declarado é complementar Jackson e Gson para tarefas pequenas (ler um arquivo de config, cutucar uma resposta REST), não substituí-los. Até que ela seja lançada e saia de incubation, e para qualquer coisa envolvendo seus próprios tipos de domínio depois disso, uma biblioteca ainda é a resposta.

## Trade-offs

- **Data binding versus tree model** — binding te dá tipos em tempo de compilação e completion na IDE ao custo de uma classe por formato de documento; o tree model não precisa de classes mas adia todo erro para o runtime, onde um typo em um nome de campo é um `NullPointerException` em vez de um erro de compilação:

```java
record Point(int x, int y) {}
mapper.readValue(json, Point.class).ex();   // compile error: no such method
mapper.readTree(json).get("ex").asInt();    // compiles; NPE at runtime
```

- **Estrito por padrão** — um campo JSON não modelado é uma falha total, o que captura desvio real de schema cedo mas quebra no momento em que um provedor adiciona um campo. Relaxar isso é uma linha, e esquecer de relaxar é um incidente de produção clássico:

```java
mapper.readValue("{\"x\":1,\"y\":2,\"z\":3}", Point.class);
// UnrecognizedPropertyException: Unrecognized field "z"
```

- **JSON tem um único tipo número** — valores de ponto flutuante são vinculados a `double` por padrão, então quantias decimais são armazenadas como a aproximação binária mais próxima. Se o valor é dinheiro, opte por `BigDecimal`:

```java
String json = "{\"amount\":1.00000000000000000001}";

mapper.readTree(json).get("amount").getClass();   // DoubleNode
mapper.readTree(json).get("amount").asText();     // "1.0" — the extra digits are gone

var exact = JsonMapper.builder()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .build();
exact.readTree(json).get("amount").getClass();    // DecimalNode
exact.readTree(json).get("amount").asText();      // "1.00000000000000000001"
```

- **Binding roda sobre reflection** — o Jackson alcança dentro dos seus tipos em tempo de execução, o que é invisível no classpath mas não sob o module system ou uma imagem nativa GraalVM: um módulo strong precisa abrir (`opens`) seus pacotes de modelo, ou a construção falha:

```java
module com.example.app {
    requires com.fasterxml.jackson.databind;
    opens com.example.app.model to com.fasterxml.jackson.databind;
}
```

- **Streaming troca ergonomia por escala** — `JsonParser` usa alguns kilobytes de memória para qualquer tamanho de documento e é a opção mais rápida disponível, mas o código é uma máquina de estados: forward-only, sem acesso aleatório, profundidade de aninhamento rastreada à mão, e a um refactor de distância de ficar ilegível. Recorra a ele quando o documento não cabe no heap ou um profiler aponta para o binding, não por padrão.
- **Jackson 2 e 3 coexistem, o que é um recurso e um risco** — os pacotes renomeados deixam as duas majors conviverem em um classpath durante uma migração, mas nada impede metade de um codebase de importar cada um, e os tipos não interoperam. Duas classes `JsonNode` com o mesmo simple name produzem mensagens de erro que soam como absurdo até você notar o pacote.
- **Nenhum padrão significa nenhuma portabilidade de idiomas** — tratamento de JSON em Java é uma escolha de biblioteca sem padrão de plataforma, então o conhecimento não transfere limpo entre codebases (anotações do Jackson, `@SerializedName` do Gson, `@JsonbProperty` do JSON-B resolvem o mesmo problema de formas diferentes). A JEP 540 estreita isso só para os casos mais simples; ela não dá ao ecossistema uma API de binding comum.

## Documentation Links

- [Jackson databind — FasterXML/jackson-databind](https://github.com/FasterXML/jackson-databind) — doc
- [Migrating to Jackson 3 — FasterXML](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md) — doc
- [Jackson Releases (version and LTS status) — FasterXML wiki](https://github.com/FasterXML/jackson/wiki/Jackson-Releases) — doc
- [JEP 540: Simple JSON API (Incubator) — OpenJDK](https://openjdk.org/jeps/540) — doc
- [RFC 6901: JavaScript Object Notation (JSON) Pointer — IETF](https://datatracker.ietf.org/doc/html/rfc6901) — doc
- [RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format — IETF](https://datatracker.ietf.org/doc/html/rfc8259) — doc
- [Gson user guide — Google](https://github.com/google/gson/blob/main/UserGuide.md) — doc
- [JSON support in Spring Boot — Spring reference](https://docs.spring.io/spring-boot/reference/features/json.html) — doc
- [JSON-Java (org.json) — GitHub](https://github.com/stleary/JSON-java) — doc
- [Java SE 25 API — java.base has no JSON package](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html) — doc
