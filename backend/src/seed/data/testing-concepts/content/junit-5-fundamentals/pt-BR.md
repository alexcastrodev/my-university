---
version: 1.0
updatedAt: 2026-08-06
title: "Fundamentos do JUnit 5"
summary: "O ciclo de vida de teste do JUnit 5, asserções vs. suposições, testes aninhados/marcados, e testes parametrizados/dinâmicos, do JUnit in Action, Third Edition, Cap. 2."
---
## Objective

O JUnit 5 é um `framework de ciclo de vida de teste`: ele cria uma nova instância de teste por método, roda setup e teardown ao redor dela em uma ordem fixa, e avalia `assertions` (asserções) e `assumptions` (suposições) sobre o resultado. `@ParameterizedTest`, `@RepeatedTest` e `@Nested` estendem esse modelo básico para cobrir muitas entradas, execuções repetidas e sub-cenários agrupados sem duplicar código de teste.

## Use Cases

- Agrupar setup/teardown ao redor de cada método de teste com `@BeforeEach`/`@AfterEach`, e uma vez por classe com `@BeforeAll`/`@AfterAll`.
- Falhar rápido diante de um valor errado com `assertEquals`/`assertTrue`, ou agrupar várias verificações relacionadas com `assertAll` para que todas sejam avaliadas e reportadas mesmo que uma falhe.
- Pular um teste em tempo de execução, em vez de reprová-lo, quando uma pré-condição não é atendida, via `assumeTrue`/`assumeFalse`.
- Rodar a mesma lógica de teste contra muitas entradas com `@ParameterizedTest` e uma fonte como `@ValueSource` ou `@CsvSource`, em vez de copiar e colar métodos `@Test` quase idênticos.
- Repetir o mesmo teste um número fixo de vezes com `@RepeatedTest`, para revelar instabilidade em código que envolve aleatoriedade ou tempo.
- Organizar testes relacionados em uma hierarquia de classes aninhadas com `@Nested`, para que o setup possa ser restrito a um sub-cenário.
- Dar um nome legível a uma classe ou método de teste com `@DisplayName`, exibido por IDEs e relatórios de build em vez do nome bruto do método.

## Deep Dive

### O ciclo de vida do teste

Toda classe de teste segue a mesma ordem fixa: `@BeforeAll` uma vez, então, para cada método `@Test`, o `@BeforeEach` de uma instância nova, o teste, `@AfterEach`, e por fim `@AfterAll` uma vez no final.

```java
class SUTTest {
    private static ResourceForAllTests resourceForAllTests;
    private SUT systemUnderTest;

    @BeforeAll
    static void setUpClass() {
        resourceForAllTests = new ResourceForAllTests("shared resource");
    }

    @BeforeEach
    void setUp() {
        systemUnderTest = new SUT("fresh per test");
    }

    @Test
    void testRegularWork() {
        assertTrue(systemUnderTest.canReceiveRegularWork());
    }

    @AfterEach
    void tearDown() {
        systemUnderTest.close();
    }

    @AfterAll
    static void tearDownClass() {
        resourceForAllTests.close();
    }
}
```

Métodos `@BeforeAll`/`@AfterAll` precisam ser `static`, a menos que a classe esteja anotada `@TestInstance(Lifecycle.PER_CLASS)`, porque por padrão o JUnit cria uma **nova instância de teste por método de teste**; ainda não há instância no momento em que `@BeforeAll` rodaria sobre ela.

### Asserções vs. suposições

Métodos de `Assertions` reprovam o teste imediatamente quando a verificação não se sustenta; `assertAll` agrupa várias asserções para que todas rodem e sejam reportadas, mesmo que as anteriores já tenham falhado:

```java
@Test
void accountInvariants() {
    Account account = new Account("1", 100);
    assertAll("account",
        () -> assertEquals("1", account.getId()),
        () -> assertTrue(account.getBalance() > 0),
        () -> assertThrows(IllegalArgumentException.class,
                () -> account.withdraw(-1))
    );
}
```

`Assumptions` parecem semelhantes, mas significam algo diferente: quando uma suposição falha, o teste é **abortado** (reportado como pulado), não reprovado; útil para pré-condições que o teste não controla, como "só rode isto quando um valor de configuração estiver presente":

```java
@Test
void onlyRunsWithApiKeyConfigured() {
    assumeTrue(System.getenv("API_KEY") != null);
    // ... test that needs the API key
}
```

### Testes aninhados e marcados

`@Nested` agrupa testes ao redor de um sub-cenário, permitindo que uma classe interna tenha seu próprio `@BeforeEach`, que se compõe com o da classe externa:

```java
class AccountTest {
    Account account;

    @BeforeEach
    void createAccount() {
        account = new Account("1", 100);
    }

    @Nested
    class WhenBalanceIsPositive {
        @Test
        void canWithdraw() {
            account.withdraw(50);
            assertEquals(50, account.getBalance());
        }
    }
}
```

`@Tag("slow")` em uma classe ou método permite que um build selecione ou exclua subconjuntos de testes (por exemplo, `mvn test -Dgroups=slow`) sem mudar o código de teste, e `@Disabled("reason")` desliga um teste registrando o motivo, em vez de comentá-lo.

### Testes parametrizados e repetidos

`@ParameterizedTest` roda um único método de teste uma vez por valor de origem, evitando métodos `@Test` quase duplicados:

```java
@ParameterizedTest
@ValueSource(strings = {"", "  ", "\t"})
void blankStringsAreInvalid(String input) {
    assertTrue(input.isBlank());
}

@ParameterizedTest
@CsvSource({"1,1,2", "2,3,5", "-1,1,0"})
void addsTwoNumbers(int a, int b, int expected) {
    assertEquals(expected, a + b);
}
```

`@RepeatedTest(n)` em vez disso reexecuta o mesmo teste `n` vezes sem entrada variável, injetando um `RepetitionInfo` se o método precisar saber em qual repetição está:

```java
@RepeatedTest(5)
void repeatedWithInfo(RepetitionInfo info) {
    System.out.println("Run " + info.getCurrentRepetition() + " of " + info.getTotalRepetitions());
}
```

### Testes dinâmicos

`@TestFactory` gera casos de teste em tempo de execução em vez de declarar cada um em tempo de compilação; útil quando o conjunto de casos vem de dados em vez do próprio código-fonte:

```java
@TestFactory
Stream<DynamicTest> dynamicTestsForSquares() {
    return IntStream.rangeClosed(1, 3)
        .mapToObj(n -> DynamicTest.dynamicTest(
            "square of " + n,
            () -> assertEquals(n * n, square(n))));
}
```

## Trade-offs

- **`@BeforeAll` exige `static` (ou ciclo de vida `PER_CLASS`)**: como uma nova instância de teste é criada por método de teste por padrão, um campo de instância ainda não está visível quando o método de setup (padrão, por classe) precisaria rodar:

```java
class Broken {
    Resource r; // instance field

    @BeforeAll
    void setUp() { r = new Resource(); } // error: @BeforeAll method must be static
}
```

- **Suposições pulam, asserções reprovam**: confundir os dois muda o que um build vermelho ou um teste pulado realmente significa, e dashboards de CI tratam os dois de forma bem diferente:

```java
assumeTrue(false); // test reported as ABORTED/skipped, not failed
assertTrue(false); // test reported as FAILED
```

- **Testes parametrizados trocam legibilidade por cobertura**: um método cobrindo dez entradas é menos código do que dez métodos `@Test` quase idênticos, mas uma mensagem de falha agora precisa incluir qual entrada falhou, e depurar significa encontrar a linha certa na fonte, não o nome certo do método.
- **Testes dinâmicos não são detectáveis estaticamente**: como `@TestFactory` gera `DynamicTest`s em tempo de execução, IDEs não conseguem listá-los antes de uma execução da forma como listam métodos `@Test`, o que torna fluxos de "rodar só este caso" mais desajeitados.

## Documentation Links

- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) (doc)
- [JUnit 5 Jupiter API: Assertions](https://junit.org/junit5/docs/current/api/org.junit.jupiter.api/org/junit/jupiter/api/Assertions.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 2, "Exploring core JUnit," pp. 15-46 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
