---
version: 1.0
updatedAt: 2026-08-17
title: "Reutilizando Fixtures de Teste, Testes Parametrizados e Bibliotecas de Asserção"
summary: "Por que a reutilização de fixtures baseada em construtor/@BeforeEach acopla os testes entre si e prejudica a legibilidade, por que métodos de fábrica privados (Object Mother) são o padrão melhor, quando recorrer a @ParameterizedTest e @MethodSource, e como o estilo fluente do AssertJ evita a armadilha da ordem de argumentos expected/actual."
---
## Objective

Uma vez que fixtures de teste começam a ocupar espaço real, há duas formas de reutilizar o código de setup entre testes, mas só uma delas, métodos de fábrica privados, evita acoplar os testes entre si. Testes parametrizados resolvem um problema diferente, mas relacionado (testes quase idênticos demais) e vêm com seu próprio trade-off de legibilidade. Ambos são potencializados pela escolha do estilo de asserção, onde uma biblioteca de asserção fluente reestrutura as asserções para se lerem como inglês simples, em vez de trivialidades de ordem de argumento `expected, actual`.

## Use Cases

- Decidir se a lógica de setup compartilhada pertence a um método `@BeforeEach`, a uma base compartilhada injetada via `@ExtendWith` do JUnit, ou a um método de fábrica privado simples na classe de teste.
- Colapsar quatro testes quase idênticos, que só diferem por um valor de entrada, em um único `@ParameterizedTest`, sem perder a capacidade de identificar qual caso é qual quando um falha.
- Escolher entre `@ValueSource`/`@CsvSource` e `@MethodSource` quando a entrada de um teste parametrizado não pode ser expressa como uma constante em tempo de compilação.
- Substituir uma parede de chamadas `assertEquals(expected, actual)` pela cadeia `assertThat(actual).isEqualTo(expected)` do AssertJ para corrigir o erro perene de ordem de argumento expected/actual.

## Deep Dive

### Reutilização de fixture baseada em construtor: conveniente, mas um anti-padrão

```java
class CustomerTests {
    private Store store;
    private Customer sut;

    @BeforeEach
    void setUp() {
        store = new Store();
        store.addInventory(Product.SHAMPOO, 10);
        sut = new Customer();
    }

    @Test
    void purchaseSucceedsWhenEnoughInventory() {
        boolean success = sut.purchase(store, Product.SHAMPOO, 5);
        assertThat(success).isTrue();
        assertThat(store.getInventory(Product.SHAMPOO)).isEqualTo(5);
    }
}
```

Isso parece o uso idiomático de `@BeforeEach`, mas Khorikov aponta essa como a forma *errada* de reutilizar fixtures, por dois motivos específicos:

1. **Acopla os testes entre si.** `store` e `sut` se tornam estado compartilhado; mudar a quantidade em `addInventory` para corrigir ou ajustar um teste muda silenciosamente as condições iniciais de todo outro teste na classe, produzindo falhas sem relação com o que você de fato pretendia mudar.
2. **Prejudica a legibilidade.** Um método de teste sem seção de arrange visível obriga a pular para `setUp()` para entender o que de fato está sendo testado, mesmo quando o setup é trivial; você não consegue mais saber, só de ler o teste, se algo mais está sendo configurado ali.

### A forma melhor: métodos de fábrica privados

```java
class CustomerTests {
    @Test
    void purchaseSucceedsWhenEnoughInventory() {
        Store store = createStoreWithInventory(Product.SHAMPOO, 10);
        Customer sut = createCustomer();

        boolean success = sut.purchase(store, Product.SHAMPOO, 5);

        assertThat(success).isTrue();
        assertThat(store.getInventory(Product.SHAMPOO)).isEqualTo(5);
    }

    private Store createStoreWithInventory(Product product, int quantity) {
        Store store = new Store();
        store.addInventory(product, quantity);
        return store;
    }

    private Customer createCustomer() {
        return new Customer();
    }
}
```

Este é o padrão **Object Mother**: um método (ou classe) cujo trabalho é produzir fixtures de teste prontas para uso. Ele encurta o teste da mesma forma que o construtor fazia, mas cada teste declara explicitamente o que precisa (`createStoreWithInventory(Product.SHAMPOO, 10)`), mantendo os testes desacoplados e autoexplicativos sem precisar reler o corpo do método. O padrão relacionado **Test Data Builder** atinge o mesmo objetivo através de uma interface de builder fluente em vez de uma chamada de método simples; lê-se um pouco melhor, mas custa mais boilerplate para escrever. Prefira métodos de fábrica no estilo Object Mother por padrão, a menos que o número de parâmetros opcionais torne um builder claramente compensador.

**A única exceção legítima**: uma fixture genuinamente necessária a praticamente todo teste, mais comumente uma conexão de banco de dados em testes de integração, pode viver no construtor/`@BeforeEach` de uma classe base compartilhada, já que não sobra uma pergunta significativa de "o que este teste precisa" para algo que todo teste precisa de forma idêntica. Coloque-a em uma classe base de teste comum, não duplicada por classe de teste.

### Testes parametrizados: trocando quantidade de testes por clareza por caso

```java
@ParameterizedTest
@CsvSource({
    "-1, false",
    "0, false",
    "1, false",
    "2, true"
})
void canDetectAnInvalidDeliveryDate(int daysFromNow, boolean expected) {
    DeliveryService sut = new DeliveryService();
    Delivery delivery = new Delivery(LocalDate.now().plusDays(daysFromNow));

    boolean isValid = sut.isDeliveryValid(delivery);

    assertThat(isValid).isEqualTo(expected);
}
```

Quatro testes separados e claramente nomeados colapsam em um único teste parametrizado, ao custo de um nome genérico o suficiente para cobrir todo caso, o que dificulta saber *especificamente o quê* cada linha está testando sem ler a própria linha. Como regra prática: combine casos positivos e negativos em um único teste parametrizado só quando os valores de entrada tornarem autoevidente qual caso é qual; caso contrário, extraia o caso positivo para seu próprio teste, com nome descritivo, e mantenha parametrizados apenas os casos negativos. Se o comportamento for complicado o suficiente para que nenhum esquema de nomenclatura fique claro, pule a parametrização por completo e escreva um teste por caso.

`@CsvSource`/`@ValueSource` só aceitam valores que o compilador consegue tratar como constantes; um valor calculado como `LocalDate.now().plusDays(n)` não pode entrar diretamente na anotação. `@MethodSource` é a válvula de escape: aponte-o para um método estático que constrói e retorna a lista real de argumentos em tempo de execução, exatamente análogo ao `[MemberData]` do livro.

```java
@ParameterizedTest
@MethodSource("deliveryDates")
void canDetectAnInvalidDeliveryDate(LocalDate deliveryDate, boolean expected) { ... }

static Stream<Arguments> deliveryDates() {
    return Stream.of(
        Arguments.of(LocalDate.now().minusDays(1), false),
        Arguments.of(LocalDate.now(), false),
        Arguments.of(LocalDate.now().plusDays(1), false),
        Arguments.of(LocalDate.now().plusDays(2), true)
    );
}
```

### Bibliotecas de asserção e o padrão de história

```java
// Positional, easy to get expected/actual backwards:
assertEquals(30, result);

// Fluent, reads as [subject] [action] [object]:
assertThat(result).isEqualTo(30);
```

O AssertJ é a contraparte do ecossistema Java para o Fluent Assertions (.NET) do livro: mesma motivação. `assertThat(result).isEqualTo(30)` se lê como uma pequena frase em inglês ("result é igual a 30"), da forma como a ordem posicional `expected, actual` de `assertEquals(30, result)` não se lê, e é uma fonte fácil de um teste silenciosamente errado se os dois forem trocados. Além da legibilidade, as asserções encadeáveis do AssertJ em coleções, exceções e datas reduzem significativamente o boilerplate de asserção em comparação com o `Assertions` puro do JUnit. O único custo real é mais uma dependência restrita ao escopo de teste, nunca enviada para produção, então uma adição de baixo risco.

## Trade-offs

- **Métodos de fábrica só continuam desacoplados se forem escritos de forma genérica**: um método de fábrica com os valores-alvo fixados dentro dele (em vez de recebidos como parâmetros) reintroduz silenciosamente o mesmo acoplamento entre testes que a abordagem de construtor tinha, só que movido para um método com nome diferente.
- **Testes parametrizados trocam quantidade de testes por clareza por linha**: colapsar tudo em um único teste parametrizado com nome genérico pode fazer um relatório de falha dizer *que* algo quebrou sem dizer *o quê*, sem ler os valores reais da linha que falhou.
- **Uma fixture compartilhada em uma classe base só é segura quando toda subclasse genuinamente precisa dela de forma idêntica**: a mesma régua de "todo teste precisa exatamente disto" que justifica uma conexão de banco de dados em uma classe base de teste de integração não se estende a fixtures que só alguns testes usam, que pertencem de volta a métodos de fábrica por teste.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 3 "The anatomy of a unit test", Seções 3.3, 3.5-3.6, pp. 50-63 (book)
- [JUnit 5 User Guide: Testes Parametrizados](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests) (doc)
- [AssertJ: asserções fluentes para Java](https://assertj.github.io/doc/) (doc)
