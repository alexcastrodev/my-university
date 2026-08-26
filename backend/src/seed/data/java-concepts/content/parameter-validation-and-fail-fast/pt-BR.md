---
version: 1.0
updatedAt: 2026-08-13
title: Validação de Parâmetros e Fail-Fast
summary: Valide os parâmetros de um método ou construtor logo no topo do corpo e lance imediatamente uma exceção clara, em vez de deixar um argumento inválido se propagar até falhas confusas ou um estado de objeto corrompido.
---
## Objective

Todo método e construtor tem restrições implícitas sobre os valores que aceita — um índice não pode ser negativo, uma referência não pode ser `null`, um valor precisa ser positivo. Checar essas restrições bem no topo do corpo do método, antes de qualquer cálculo ou atribuição de campo, é o que permite que um argumento inválido falhe imediatamente e com clareza, em vez de corromper o estado ou aparecer como um erro confuso em outro lugar completamente diferente. Este conceito é sobre *quando* e *onde* validar e lançar exceção — não sobre a mecânica de `throw`/`throws`/checked-vs-unchecked (veja o conceito Exception Handling Fundamentals para isso).

## Use Cases

- Validar parâmetros de construtor antes de eles serem atribuídos a campos, de forma que um objeto nunca possa existir em um estado que viole seus próprios invariantes.
- Proteger os argumentos de um método público com checagens explícitas (e um `@throws` documentado), em vez de deixar um valor inválido fluir para dentro da lógica do método e falhar em algum lugar sem relação.
- Usar `Objects.requireNonNull` com uma mensagem descritiva, para que um argumento `null` falhe apontando para *qual* argumento, em vez de um `NullPointerException` puro mais tarde.
- Validar as precondições de um método auxiliar não público com `assert`, ganhando uma rede de segurança durante o desenvolvimento com custo essencialmente nulo em produção.
- Rejeitar um índice fora do intervalo ou um valor malformado na fronteira da API, em vez de calcular silenciosamente uma saída errada.

## Deep Dive

### Fail fast no topo do método

Um método que armazena um valor fornecido pelo chamador sem checá-lo não evita o problema — apenas move a falha para outro lugar, mais tarde, desconectando-a de sua causa real. Aqui está um factory method que envolve um `int[]` em uma view de `List` mas nunca checa o array que recebe:

```java
static List<Integer> intArrayAsList(int[] a) {
    // 'a' is captured for later use — never validated here
    return new AbstractList<Integer>() {
        public Integer get(int i) { return a[i]; }
        public int size()         { return a.length; }
    };
}
```

```java
List<Integer> view = intArrayAsList(null);   // compiles, returns a perfectly normal-looking List
// ... view gets passed to another layer, stored in a field, returned from a getter ...
int first = view.get(0);   // NullPointerException — but the real mistake happened far away, at the intArrayAsList call
```

A exceção é real, mas quando ela é lançada, o stack trace aponta para `get(0)`, não para o chamador que passou `null` em primeiro lugar — rastrear o bug de verdade significa caminhar para trás por tudo que tocou `view` no meio do caminho. Checar o parâmetro no topo do método corrige exatamente isso:

```java
static List<Integer> intArrayAsList(int[] a) {
    Objects.requireNonNull(a, "a must not be null");
    return new AbstractList<Integer>() {
        public Integer get(int i) { return a[i]; }
        public int size()         { return a.length; }
    };
}
```

Agora `intArrayAsList(null)` lança exceção imediatamente, no erro real, com uma mensagem nomeando o parâmetro real. É também por isso que parâmetros de construtor merecem atenção especial: um construtor que pula a validação e armazena um valor ruim não arrisca apenas uma chamada ruim — ele deixa existir um objeto que viola seus próprios invariantes durante toda a sua vida útil, então *toda* chamada de método posterior nele passa a ser suspeita. E não é só sobre exceções — um método que nunca valida pode facilmente retornar normalmente com um resultado silenciosamente errado, o que é pior: nada quebra, então nada aponta para o bug de jeito nenhum.

### Objects.requireNonNull e escolhendo o tipo de exceção certo

`Objects.requireNonNull` é a forma padrão, de uma linha, de checar null em um parâmetro e falhar com uma mensagem clara em vez de um `NullPointerException` puro vindo de qualquer linha que aconteça de desreferenciá-lo primeiro:

```java
public final class Order {
    private final Customer customer;
    private final List<LineItem> items;

    public Order(Customer customer, List<LineItem> items) {
        this.customer = Objects.requireNonNull(customer, "customer must not be null");
        this.items = Objects.requireNonNull(items,
                () -> "items must not be null for customer " + customer.id());
    }
}
```

A sobrecarga que recebe uma `String` constrói a mensagem antecipadamente; a sobrecarga que recebe um `Supplier<String>` só chama a função se a checagem de fato falhar, o que importa quando construir a própria mensagem não é gratuito (aqui, `customer.id()` só roda no caminho de falha — e só depois que a checagem de `customer` já passou).

Nem todo argumento ruim é um `null`, então o tipo de exceção deve corresponder ao tipo de violação:

```java
public void withdraw(long amountCents) {
    if (amountCents <= 0)
        throw new IllegalArgumentException("amountCents must be positive: " + amountCents);
    if (amountCents > balanceCents)
        throw new IllegalArgumentException("insufficient funds: balance=" + balanceCents + ", requested=" + amountCents);
    balanceCents -= amountCents;
}
```

Para um índice ruim especificamente, `IndexOutOfBoundsException` é a escolha convencional — e `Objects.checkIndex(int index, int length)` faz a checagem de intervalo para você, lançando-a automaticamente quando `index < 0` ou `index >= length`:

```java
public char charAt(String s, int index) {
    Objects.checkIndex(index, s.length());   // throws IndexOutOfBoundsException if out of range
    return s.charAt(index);
}
```

As três — `NullPointerException`, `IllegalArgumentException`, `IndexOutOfBoundsException` — são unchecked, e isso é intencional: um argumento inválido normalmente é um erro de programação, não uma condição da qual o chamador imediato deveria se recuperar em runtime. Documentá-las ainda faz parte do contrato do método: o Javadoc de um método público deveria listar toda restrição de validade sobre seus parâmetros via `@throws`, para que a restrição e a falha que ela produz fiquem visíveis antes de qualquer um ler a implementação:

```java
/**
 * Withdraws the given amount from this account.
 *
 * @param amountCents the amount to withdraw, in cents; must be positive
 * @throws IllegalArgumentException if amountCents is not positive, or exceeds the current balance
 */
public void withdraw(long amountCents) { ... }
```

### assert para invariantes internos — e por que é a ferramenta errada para parâmetros públicos

Para um método não público, o chamador é o seu próprio código, então em vez de uma checagem completa de validade você pode declarar uma *suposição* com `assert` e deixar a JVM verificá-la durante o desenvolvimento:

```java
// package-private helper — only called by sort() in this same class
private static void merge(long[] a, int lo, int mid, int hi) {
    assert a != null;
    assert lo >= 0 && lo <= mid && mid <= hi && hi <= a.length;
    // ... perform the merge, trusting these hold ...
}
```

Um `assert` fica desabilitado por padrão: a JVM precisa ser iniciada com `-ea` (ou `-enableassertions`) para que a condição seja de fato avaliada. Com assertions desabilitadas, uma instrução `assert` custa essencialmente nada em runtime — ela degenera para uma única checagem barata de flag que pula direto por cima — motivo exato pelo qual ela é adequada para invariantes que você quer checar com rigor no desenvolvimento e nos testes, sem pagar por isso em produção. Quando a condição de um assertion habilitado é `false`, ele lança `AssertionError`, não nenhuma das exceções de validação padrão.

Essa diferença é exatamente por que `assert` é a ferramenta errada para validar os parâmetros de um método *público*. O próprio guia de assertions da Oracle afirma isso diretamente: "não use assertions para checagem de argumento em métodos públicos." O contrato de parâmetros de um método público precisa ser reforçado independentemente de `-ea` ter sido passado ou não — usar `assert` ali significa que a checagem simplesmente desaparece em qualquer deployment que não habilite assertions:

```java
// WRONG — a public method whose only protection is an assert
public void setRefreshRate(int rate) {
    assert rate > 0 && rate <= MAX_REFRESH_RATE;   // gone entirely without -ea
    this.rate = rate;
}
```

```java
// RIGHT — enforced unconditionally, and throws the type callers actually expect
public void setRefreshRate(int rate) {
    if (rate <= 0 || rate > MAX_REFRESH_RATE)
        throw new IllegalArgumentException("Illegal rate: " + rate);
    this.rate = rate;
}
```

## Trade-offs

- **Validar em todo lugar adiciona boilerplate, e um pouco de custo em runtime** — todo ponto de entrada público agora executa checagens extras antes de fazer o trabalho de verdade. Esse é um preço razoável pela segurança em uma fronteira de API, mas é fácil exagerar: revalidar o mesmo valor já checado em cada camada interna por que ele passa só duplica custo sem pegar nada de novo.
- **Algumas restrições são mais baratas de reforçar implicitamente do que explicitamente** — se o próprio cálculo vai naturalmente falhar com uma entrada ruim e lançar uma exceção apropriada, uma checagem prévia explícita pode ser trabalho redundante:
  ```java
  List<Object> list = new ArrayList<>(List.of("a", "b", 1)); // 1 isn't Comparable to String
  Collections.sort((List) list); // no pre-check needed — throws ClassCastException naturally, mid-sort
  ```
- **A sobrecarga com `Supplier` de `Objects.requireNonNull` adia o custo de construir a mensagem** — passar uma `String` simples constrói essa mensagem em toda chamada, mesmo no caminho não-nulo; um `Supplier<String>` só é invocado quando a checagem de fato falha.
  ```java
  Objects.requireNonNull(items, () -> "items must not be null for order " + orderId); // concatenation runs only on failure
  ```
- **`assert` é opt-in, e esse opt-in é fácil de esquecer** — como as assertions ficam desabilitadas por padrão, um time que nunca roda sua suíte de testes com `-ea` não recebe nenhuma das checagens que esses asserts deveriam fornecer, sem nenhum aviso de que elas estão faltando.
  ```
  java -ea  -cp out com.example.Main   # assertions run
  java      -cp out com.example.Main   # same code, assertions silently skipped
  ```

## Documentation Links

- [Objects (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html) — doc
- [IllegalArgumentException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IllegalArgumentException.html) — doc
- [IndexOutOfBoundsException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IndexOutOfBoundsException.html) — doc
- [NullPointerException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/NullPointerException.html) — doc
- [AssertionError (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AssertionError.html) — doc
- [Chapter 14.10, The assert Statement — The Java Language Specification (SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html) — doc
- [Programming With Assertions — Oracle](https://docs.oracle.com/javase/8/docs/technotes/guides/language/assert.html) — doc
- [JavaDoc Documentation Comment Specification for the Standard Doclet (JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/specs/javadoc/doc-comment-spec.html) — doc
