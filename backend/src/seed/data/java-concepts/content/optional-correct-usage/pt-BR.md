---
version: 1.0
updatedAt: 2026-08-18
title: "Optional: Uso Correto e os Próprios Avisos da API"
summary: Optional existe para tornar 'isso pode não ter um valor' parte do tipo de retorno de um método em vez de um null que quem chama precisa lembrar de checar — e por que o próprio JDK desaconselha usá-lo como campo, parâmetro ou dentro de uma coleção, além do anti-padrão isPresent()-então-get() e a armadilha de eagerness orElse-vs-orElseGet que pegam a maioria dos primeiros usos.
---
## Objective

`Optional<T>` é um objeto contêiner que ou contém um único valor não nulo, ou não contém nada. Sua única razão de existir é tornar "isso pode não produzir um valor" parte da *assinatura* de um método, em vez de um fato escondido no Javadoc (ou em lugar nenhum) que quem chama precisa lembrar de checar com um null-check. `Optional<User> findByEmail(String email)` diz a toda chamada, em tempo de compilação, que um resultado vazio é um resultado normal; `User findByEmail(String email)` retornando `null` não diz nada, e a `NullPointerException` aparece três frames de distância de onde o `null` nasceu. O que `Optional` *não é* é uma caixa genérica para valores anuláveis: o próprio Javadoc do JDK afirma que ele é "primariamente destinado ao uso como tipo de retorno de método," e a equipe do JDK tem sido explícita ao dizer que campos, parâmetros de método e elementos de coleção nunca foram o alvo. O restante deste conceito trata de por que essas regras existem, em vez de apenas afirmá-las, além dos métodos com os quais as pessoas confiavelmente erram. Você já viu `Optional` de passagem como o tipo de retorno de `findFirst()` em [Stream API Fundamentals](/java-concepts/stream-api-fundamentals) — aquele conceito o trata como "o que uma operação terminal específica acontece de retornar"; aqui ele é o assunto principal.

## Use Cases

- Uma busca que pode legitimamente não encontrar nada — `Optional<User> findByEmail(String)` — onde retornar `null` é uma armadilha e lançar uma exceção seria errado, porque "não encontrado" é um resultado comum, não uma falha.
- Forçar quem chama a tomar uma decisão explícita no ponto de chamada (`orElse`, `orElseThrow`, `ifPresentOrElse`) em vez de deixar um `null` viajar silenciosamente por três camadas antes de explodir em algum lugar sem relação.
- Encadear uma sequência de transformações que devem interromper limpo assim que algo estiver ausente (`map`/`flatMap`), em vez de escrever uma pirâmide de checagens de null aninhadas.
- Fornecer um fallback caro de calcular, mas só computá-lo quando de fato necessário (`orElseGet`).
- Reduzir uma coleção de buscas possivelmente ausentes apenas aos resultados presentes, via `flatMap(Optional::stream)`.

## Deep Dive

### Construindo um Optional: três fábricas, duas das quais lançam ou não exceção

Não existe construtor público — `Optional` é criado apenas através de métodos de fábrica estáticos, e escolher o errado é o primeiro erro comum.

```java
Optional<String> a = Optional.of("hello");        // value MUST be non-null
Optional<String> b = Optional.ofNullable(maybe);   // null -> empty, non-null -> present
Optional<String> c = Optional.empty();             // explicitly nothing
```

`of(value)` chama `Objects.requireNonNull` internamente: é uma *afirmação* de que você sabe que o valor está presente, e falha ruidosamente se você estiver errado. `ofNullable(value)` é a fábrica que aceita uma entrada possivelmente nula e converte silenciosamente `null` em `Optional.empty()`. Use `of` quando o valor for um literal ou algo já validado; use `ofNullable` na fronteira onde uma API legada que retorna null te entrega alguma coisa.

Uma referência `Optional` nunca deveria ser `null` em si mesma. Retornar `null` de um método declarado para retornar `Optional<T>` é estritamente pior do que retornar `null` de um método declarado para retornar `T`, porque a quem chama foi dito que não precisa de um null-check:

```java
public Optional<User> findByEmail(String email) {
    User u = repo.lookup(email);
    return u == null ? null : Optional.of(u);   // WRONG — never return a null Optional
}

public Optional<User> findByEmail(String email) {
    return Optional.ofNullable(repo.lookup(email));   // right
}
```

### O anti-padrão `isPresent()` / `get()`

Esse é o formato que aparece em quase todo código base que acabou de adotar `Optional`, e é aquele que vale nomear explicitamente:

```java
// BROKEN — Optional buys you nothing here
public String displayName(Long id) {
    Optional<User> user = findById(id);
    if (user.isPresent()) {
        return user.get().name();
    } else {
        return "anonymous";
    }
}
```

Compila, funciona, e é exatamente a checagem manual de null que `Optional` foi introduzido para eliminar — com uma alocação extra de objeto por cima. O tipo tem um método para exatamente isso:

```java
// FIXED
public String displayName(Long id) {
    return findById(id).map(User::name).orElse("anonymous");
}

// or, when the fallback is expensive to build
public String displayName(Long id) {
    return findById(id).map(User::name).orElseGet(() -> loadDefaultNameFromConfig());
}
```

A regra prática: se `get()` (ou `orElseThrow()` usado como substituto de `get()`) aparece dentro de um bloco `if (x.isPresent())`, existe um combinador que expressa a mesma coisa sem desembrulhar.

### `orElse(x)` vs. `orElseGet(supplier)` — eager vs. lazy

Essa é a única armadilha do mundo real mais comum de todas. `orElse` recebe um *valor*, então seu argumento é avaliado antes mesmo de `orElse` ser chamado — a avaliação eager comum de argumentos do Java. O valor é então descartado se o `Optional` acabou estando presente. `orElseGet` recebe um `Supplier`, que só é invocado quando o `Optional` está de fato vazio.

```java
static String expensiveDefault() {
    System.out.println("expensiveDefault() ran");
    return "default";
}

public static void main(String[] args) {
    Optional<String> present = Optional.of("actual value");

    String a = present.orElse(expensiveDefault());
    // prints: expensiveDefault() ran      <- ran anyway, result discarded
    // a == "actual value"

    String b = present.orElseGet(Main::expensiveDefault);
    // prints nothing                       <- never invoked
    // b == "actual value"
}
```

Com uma constante simples (`orElse("")`, `orElse(0)`) o eagerness não custa nada e `orElse` fica mais legível. No momento em que o fallback é uma chamada de método — uma leitura em banco, uma consulta de configuração, a construção de um objeto, uma escrita de log — `orElse` paga esse custo em *toda* invocação, incluindo o caso, esmagadoramente comum, em que o valor estava presente. Pior, se o fallback tem efeitos colaterais (inserir uma linha padrão, incrementar um contador), `orElse` os executa mesmo quando nada estava faltando, o que é um bug de correção, não só de performance.

O mesmo par eager/lazy existe para exceções: `orElseThrow(IllegalStateException::new)` constrói a exceção apenas no caminho vazio, motivo pelo qual não existe um overload `orElseThrow(SomeException)` que receba um valor.

### `map` e `flatMap`: encadeando sem desembrulhar

`map(fn)` aplica `fn` ao valor contido e reembrulha o resultado — e embrulha com semântica de `ofNullable`, então um mapper que retorna `null` produz um `Optional` vazio em vez de uma `NullPointerException`. É isso que permite que uma cadeia interrompa em qualquer elo. Compare com a versão em pirâmide de checagens de null:

```java
// null-check pyramid
public String zipOf(Long userId) {
    User user = repo.findById(userId);
    if (user != null) {
        Address addr = user.getAddress();
        if (addr != null) {
            String zip = addr.getZip();
            if (zip != null) {
                return zip;
            }
        }
    }
    return "UNKNOWN";
}
```

com a mesma lógica em forma de cadeia:

```java
public String zipOf(Long userId) {
    return findById(userId)             // Optional<User>
        .map(User::getAddress)          // Optional<Address>  (empty if getAddress() returns null)
        .map(Address::getZip)           // Optional<String>
        .orElse("UNKNOWN");
}
```

`flatMap` é para o caso em que o próprio mapper já retorna um `Optional`. Usar `map` ali produz um `Optional` aninhado, o que quase nunca é o que você quer:

```java
class User { Optional<Address> getAddress() { ... } }

// BROKEN — double-wrapped
Optional<Optional<Address>> nested = findById(id).map(User::getAddress);

// FIXED — flatMap unwraps one level
Optional<Address> addr = findById(id).flatMap(User::getAddress);
```

`filter(predicate)` se encaixa na mesma cadeia e transforma um valor presente mas indesejado em um vazio:

```java
Optional<User> activeAdmin = findById(id)
    .filter(User::isActive)
    .filter(u -> u.role() == Role.ADMIN);
```

### Encerrando uma cadeia: `orElseThrow`, `ifPresent`, `ifPresentOrElse`

`orElseThrow()` sem argumentos (adicionado no Java 10) é o substituto moderno de `get()`: comportamento idêntico — `NoSuchElementException` quando vazio —, mas o nome diz em voz alta que pode lançar exceção, enquanto `get()` soa como um acessor inofensivo. O overload com supplier escolhe o tipo da exceção:

```java
User u = findById(id).orElseThrow();                       // NoSuchElementException: No value present
User v = findById(id).orElseThrow(
        () -> new UserNotFoundException("no user " + id));  // your exception, built only when empty
```

Quando o objetivo é um efeito colateral em vez de um valor, use as formas com consumer em vez de um `if`:

```java
findById(id).ifPresent(user -> auditLog.record(user));       // do nothing when empty

findById(id).ifPresentOrElse(                                 // Java 9+
        user -> auditLog.record(user),
        () -> auditLog.recordMissing(id));                    // Runnable for the empty branch
```

`or(supplier)` (Java 9) encadeia fallbacks que são eles próprios opcionais, mantendo você dentro do mundo de `Optional`:

```java
Optional<Config> cfg = fromEnv()
    .or(this::fromFile)
    .or(this::fromDefaults);
```

### `Optional.stream()`: reduzindo uma coleção de buscas

`stream()` (Java 9) transforma um `Optional<T>` em um `Stream<T>` de exatamente zero ou um elemento. Sozinho isso parece inútil; seu propósito é ser usado como um mapper de `flatMap`, o que descarta os vazios e desembrulha os presentes em um único passo:

```java
List<User> found = emails.stream()
    .map(this::findByEmail)        // Stream<Optional<User>>
    .flatMap(Optional::stream)     // Stream<User> — empties vanish, presents unwrap
    .toList();
```

Compare com a dança pré-Java 9 que ele substitui, que é a mesma lógica escrita três vezes:

```java
List<User> found = emails.stream()
    .map(this::findByEmail)
    .filter(Optional::isPresent)
    .map(Optional::get)            // safe only because of the filter above — the compiler can't tell
    .toList();
```

A forma `flatMap(Optional::stream)` não tem nenhum `get()` nela, então não há linha alguma cuja segurança dependa de uma checagem que aconteceu antes no pipeline.

## Trade-offs

- **O JDK explicitamente não recomenda `Optional` como tipo de campo.** `Optional` não é `Serializable`, então um único campo `Optional` torna toda a classe envolvente não serializável pela serialização padrão; também custa uma alocação extra de objeto e um nível de indireção para algo que um campo anulável comum já modela, em cada instância em vez de uma vez por chamada.
  ```java
  class Account implements Serializable {
      private Optional<String> nickname = Optional.of("ace");   // compiles fine
  }
  new ObjectOutputStream(out).writeObject(new Account());
  // java.io.NotSerializableException: java.util.Optional
  ```
- **Como tipo de parâmetro de método, ele deixa toda chamada pior e ainda não fecha o buraco do null.** Chamadas que têm um valor simples precisam envolvê-lo só para te chamar, e nada impede uma chamada de passar `null` como a própria referência `Optional` — então o parâmetro ainda precisa de um null-check, exatamente o que ele deveria remover. Um overload ou um parâmetro anulável documentado faz o trabalho sem a cerimônia.
  ```java
  void register(String name, Optional<String> nickname) {
      if (nickname.isPresent()) { ... }   // NPE if the caller passed a null Optional
  }
  register("ana", Optional.of("ace"));    // every caller must wrap
  register("ana", null);                  // compiles — the hole is still open
  ```
- **`List<Optional<T>>` é quase sempre um sinal de design ruim.** Carregar ausência *dentro* de uma coleção significa que todo consumidor dessa coleção precisa desembrulhar elemento por elemento; as entradas ausentes quase sempre deveriam ter sido filtradas enquanto a coleção estava sendo construída.
  ```java
  List<Optional<User>> bad  = ids.stream().map(this::findById).toList();
  List<User>           good = ids.stream().map(this::findById).flatMap(Optional::stream).toList();
  ```
- **`Optional.of(null)` lança exceção imediatamente — `of` não é a fábrica "segura".** As pessoas recorrem a `of` porque é o nome mais curto e assumem que ele trata nulls; é `ofNullable` quem faz isso.
  ```java
  String maybeNull = System.getenv("NOT_SET");   // null
  Optional.of(maybeNull);        // NullPointerException, thrown right here
  Optional.ofNullable(maybeNull); // Optional.empty
  ```
- **As especializações primitivas são deliberadamente limitadas.** `OptionalInt`, `OptionalLong` e `OptionalDouble` existem para evitar boxing, mas não têm `map`, `flatMap` ou `filter` — então um resultado primitivo que precisa de mais encadeamento tem que ser boxado de volta com `stream().boxed()` ou tratado com `orElse` no final, e o estilo fluente não se mantém.
  ```java
  OptionalInt count = IntStream.of(1, 2, 3).max();
  count.map(n -> n * 2);   // does not compile: cannot find symbol - method map(...)
  ```
- **`Optional` é uma value-based class, então operações de identidade sobre ela não fazem sentido.** Comparar dois `Optional` com `==`, sincronizar em um deles, ou depender do seu identity hash é comportamento não especificado que uma futura JVM tem liberdade de mudar; `equals` compara os valores contidos e é a única comparação correta.
  ```java
  Optional.of("x") == Optional.of("x");        // unspecified — may be false
  Optional.of("x").equals(Optional.of("x"));    // true — the contract you can rely on
  ```
- **Envolver todo valor de retorno em `Optional` é seu próprio tipo de ruído.** Um método que genuinamente não pode falhar em produzir um resultado deveria retornar o resultado, não um `Optional` dele; e uma equipe que não combinou onde está o limite acaba com pontos de chamada que misturam cadeias de `Optional`, checagens de null e guardas defensivas de `isPresent()` para os mesmos dados, o que é mais difícil de ler do que qualquer uma das duas convenções aplicada de forma consistente.

## Documentation Links

- [Optional — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) — doc
