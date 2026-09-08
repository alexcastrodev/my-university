---
version: 1.0
updatedAt: 2026-08-13
title: "Anti-Padrões de Teste Unitário: Métodos Privados, Conhecimento de Domínio Vazado, e Tempo"
summary: "Por que testar métodos privados, expor estado privado, reimplementar a lógica do SUT em um teste, poluir o código de produção com switches só para teste, mockar classes concretas, e chamar o relógio do sistema diretamente remontam todos à mesma causa raiz, do Khorikov, Capítulo 11 \"Unit testing anti-patterns\"."
---
## Objective

Reconhecer um punhado de anti-padrões relacionados de teste unitário (testar métodos privados, expor estado privado, vazar conhecimento de domínio para o passo de arrange de um teste, poluir código de produção com um switch só para teste, mockar classes concretas, e chamar `Clock.systemDefaultZone()` (ou `new Date()`) diretamente dentro da lógica de negócio) e ver por que cada um remonta à mesma causa raiz que Khorikov nomeia no Capítulo 11: acoplar um teste a um detalhe de implementação em vez de a comportamento observável.

## Use Cases

- Decidir o que fazer quando um método privado parece "complexo demais para ficar sem teste": extraí-lo para sua própria classe com uma API pública, em vez de expô-lo ou usar reflection para acessá-lo.
- Revisar um teste que reimplementa o cálculo de produção para computar seu próprio valor "esperado", e substituí-lo por uma expectativa fixa e verificada de forma independente.
- Detectar uma flag booleana de construtor como `isTestEnvironment` no código de produção e refatorá-la para uma interface com uma implementação real e um fake só para teste.
- Tornar um método dependente de tempo (uma checagem de expiração, um timestamp de aprovação) deterministicamente testável injetando `java.time.Clock`, em vez de chamar `Clock.systemDefaultZone().instant()` inline.

## Deep Dive

### Testando métodos privados e expondo estado privado

Os dois anti-padrões compartilham o mesmo movimento ilegal: alcançar além da API pública de uma classe para tocar algo que ela deliberadamente mantém oculto. A correção para ambos também é a mesma: olhar para o que a API *pública* de fato precisa garantir, e testar isso.

Considere um método privado que cresceu complexo o suficiente para parecer que precisa de seus próprios testes:

```java
public class Order {
    private final Customer customer;
    private final List<Product> products;

    public String generateDescription() {
        return "Customer name: " + customer.getName()
            + ", total number of products: " + products.size()
            + ", total price: " + getPrice();
    }

    // Complex business logic, buried behind a private method
    private BigDecimal getPrice() {
        BigDecimal basePrice = /* computed from products */ BigDecimal.ZERO;
        BigDecimal discounts = /* computed from customer */ BigDecimal.ZERO;
        BigDecimal taxes = /* computed from products */ BigDecimal.ZERO;
        return basePrice.subtract(discounts).add(taxes);
    }
}
```

Tornar `getPrice()` package-private só para que um teste possa chamá-lo diretamente acoplaria o teste a um detalhe de implementação, exatamente o problema mock/stub-vs-comportamento-observável coberto em `observable-behavior-and-mock-fragility`. A complexidade de `getPrice()` não é um problema de teste, é um mau cheiro de design: uma abstração faltando. Extraia-a para sua própria classe com seu próprio método público legítimo:

```java
public class Order {
    private final Customer customer;
    private final List<Product> products;

    public String generateDescription() {
        PriceCalculator calc = new PriceCalculator();
        return "Customer name: " + customer.getName()
            + ", total number of products: " + products.size()
            + ", total price: " + calc.calculate(customer, products);
    }
}

public class PriceCalculator {
    public BigDecimal calculate(Customer customer, List<Product> products) {
        BigDecimal basePrice = /* computed from products */ BigDecimal.ZERO;
        BigDecimal discounts = /* computed from customer */ BigDecimal.ZERO;
        BigDecimal taxes = /* computed from products */ BigDecimal.ZERO;
        return basePrice.subtract(discounts).add(taxes);
    }
}
```

`PriceCalculator.calculate()` agora é legitimamente público, não tem entradas ou saídas ocultas, e pode ser testado diretamente com asserções simples de entrada/saída; sem reflection, sem visibilidade ampliada em `Order`.

Expor estado *privado* falha da mesma forma. Um `Customer` que se promove a um nível preferencial:

```java
public class Customer {
    private CustomerStatus status = CustomerStatus.REGULAR; // private state

    public void promote() {
        status = CustomerStatus.PREFERRED;
    }

    public BigDecimal getDiscount() {
        return status == CustomerStatus.PREFERRED
            ? new BigDecimal("0.05")
            : BigDecimal.ZERO;
    }
}
```

A tentação é tornar `status` package-private (ou adicionar um `getStatus()`) só para que um teste confirme que `promote()` funcionou. Mas o código de produção nunca lê `status` de fora da classe, só `getDiscount()` o faz, e esse já é público. O teste deveria afirmar sobre o que o *chamador* de fato observa:

```java
@Test
void promotingGrantsFivePercentDiscount() {
    Customer customer = new Customer();
    assertEquals(BigDecimal.ZERO, customer.getDiscount());

    customer.promote();

    assertEquals(new BigDecimal("0.05"), customer.getDiscount());
}
```

Se um futuro chamador genuinamente precisar do status bruto, exponha-o então, momento em que se torna comportamento observável real, não uma porta dos fundos de teste.

### Vazando conhecimento de domínio para os testes

Este anti-padrão aparece como um teste que não fixa um valor esperado, mas o *recalcula* usando a mesma lógica do código de produção:

```java
@Test
void addingTwoNumbers() {
    int value1 = 1;
    int value2 = 3;
    int expected = value1 + value2; // leaked domain knowledge

    int actual = Calculator.add(value1, value2);

    assertEquals(expected, actual);
}
```

Parece inofensivo para uma soma, mas o mesmo padrão em um algoritmo real de precificação ou impostos significa que o passo de "arrange" do teste é uma cópia colada do algoritmo de produção. Se esse algoritmo tiver um bug, a cópia no teste tem o *mesmo* bug, e a asserção continua passando; o teste tem zero chance de capturar o próprio erro que existe para capturar. Este é o mesmo modo de falha dos falsos positivos de `four-pillars-of-a-good-unit-test`, só que introduzido por lógica duplicada em vez de detalhes de implementação mockados.

A correção: fixe valores esperados que foram calculados de forma independente do SUT (à mão, por um especialista de domínio, ou a partir de uma implementação legada confiável), não chamando o mesmo caminho de código:

```java
@ParameterizedTest
@CsvSource({
    "1, 3, 4",
    "11, 33, 44",
    "100, 500, 600"
})
void addingTwoNumbers(int value1, int value2, int expected) {
    int actual = Calculator.add(value1, value2);
    assertEquals(expected, actual);
}
```

Agora um bug em `Calculator.add()` não tem onde se esconder; a expectativa não veio do mesmo lugar de onde o bug viria.

### Poluição de código e mockagem de classes concretas

Dois anti-padrões menores, mesma regra subjacente: mantenha preocupações só de teste fora da classe de produção, e dependa de interfaces em vez de implementações concretas onde quer que um teste precise substituir comportamento.

**Poluição de código (code pollution)** é uma classe de produção carregando uma flag ou um branch que existe puramente para se comportar diferente sob teste:

```java
public class Logger {
    private final boolean isTestEnvironment; // exists only for tests

    public Logger(boolean isTestEnvironment) {
        this.isTestEnvironment = isTestEnvironment;
    }

    public void log(String text) {
        if (isTestEnvironment) return; // exists only for tests
        /* write to file */
    }
}
```

Introduza uma interface em vez disso, e deixe o teste substituir uma implementação no-op; a mesma distinção stub/fake coberta em `test-doubles-stubs-and-mocking`:

```java
public interface Logger {
    void log(String text);
}

public class FileLogger implements Logger {          // production
    public void log(String text) { /* write to file */ }
}

public class FakeLogger implements Logger {          // test code only
    public void log(String text) { /* no-op */ }
}
```

`Controller` agora depende da interface `Logger`, nunca do `FileLogger` concreto, e não carrega conhecimento algum de que testes existem.

**Mockar classes concretas** é a mesma disciplina, do lado do mock. Um framework de mocking consegue tecnicamente criar um mock de uma classe concreta e stubar só parte dela (o `CALLS_REAL_METHODS` do Mockito se comporta assim), mas fazer isso costuma sinalizar que a classe está fazendo dois trabalhos de uma vez: falar com uma dependência fora de processo *e* segurar lógica de domínio:

```java
public class StatisticsCalculator {
    public Stats calculate(int customerId) {
        List<DeliveryRecord> records = getDeliveries(customerId); // I/O
        return new Stats(sumWeight(records), sumCost(records));   // logic
    }

    public List<DeliveryRecord> getDeliveries(int customerId) {
        /* call an out-of-process dependency */
        return List.of();
    }
}
```

Separar o gateway do cálculo remove a necessidade de mockar uma classe concreta por completo: o gateway vira uma interface, e a calculadora vira uma função pura que você consegue testar com valores simples:

```java
public interface DeliveryGateway {
    List<DeliveryRecord> getDeliveries(int customerId);
}

public class StatisticsCalculator {
    public Stats calculate(List<DeliveryRecord> records) {
        return new Stats(sumWeight(records), sumCost(records));
    }
}
```

### Trabalhando com tempo

Código que chama o relógio do sistema diretamente não pode ser testado de forma determinística; o valor lido durante o "act" e o valor calculado para o "assert" nunca têm garantia de coincidir:

```java
public class Inquiry {
    public void approve() {
        this.approvedAt = Clock.systemDefaultZone().instant(); // untestable
        this.approved = true;
    }
}
```

O `java.time.Clock` do Java existe para tornar isso uma dependência explícita e injetável, em vez de uma chamada ambiente. A produção conecta o relógio real do sistema; um teste conecta um relógio fixo:

```java
public class Inquiry {
    private boolean approved;
    private Instant approvedAt;

    public void approve(Clock clock) {
        this.approvedAt = Instant.now(clock);
        this.approved = true;
    }
}
```

```java
@Test
void approvingRecordsTheFixedInstant() {
    Instant fixed = Instant.parse("2020-01-01T00:00:00Z");
    Clock testClock = Clock.fixed(fixed, ZoneOffset.UTC);

    Inquiry inquiry = new Inquiry();
    inquiry.approve(testClock);

    assertEquals(fixed, inquiry.getApprovedAt());
}
```

```java
// production wiring, a normal @Bean, no test concept involved
Clock systemClock() {
    return Clock.systemDefaultZone();
}
```

`Clock.fixed(...)` dá a toda asserção o mesmo instante conhecido que o passo "act" usou, então o teste é determinístico sem nunca tocar uma fonte de tempo estática e ambiente.

## Trade-offs

- **Um método privado que "precisa dos próprios testes" é um sinal de abstração faltando, não uma lacuna de teste**: extraí-lo para sua própria classe com uma API pública (o exemplo `PriceCalculator` acima) dá a você uma costura legítima para testar, em vez de expor um detalhe de implementação ou recorrer a reflection.
- **Estado que nenhum chamador observa também não deveria ser observado por um teste**: antes de ampliar a visibilidade de um campo por causa de um teste, cheque se algum chamador de produção de fato o lê; se nenhum lê, afirme sobre o que os chamadores *de fato* observam (`getDiscount()`), não sobre o campo privado em si.
- **Fixe valores esperados, não os recalcule**: um teste que reimplementa a fórmula do SUT para derivar o "esperado" vai passar mesmo quando essa fórmula estiver errada, porque o bug é duplicado para dentro do teste. Pré-calcule expectativas de forma independente (à mão, com um especialista de domínio, ou a partir de uma execução legada confiável).
- **Interfaces em vez de booleanos para ramificação só de teste**: uma flag `isTestEnvironment` adiciona um branch em tempo de execução que pode ser atingido por acidente em produção; uma interface com uma implementação real e um fake de teste não adiciona essa superfície, já que interfaces não podem ter bugs próprios.
- **Mockar uma classe concreta para preservar parte dela costuma significar que a classe tem duas responsabilidades**: separar o I/O (uma interface de gateway) da lógica de domínio (uma calculadora simples) remove a necessidade de stubar parcialmente uma classe concreta, e cada metade se torna independente e totalmente testável.
- **Injete o tempo, não o chame**: `Clock.fixed(...)` em testes e `Clock.systemDefaultZone()` em produção dão exatamente a mesma costura que abstrações no estilo `DateTimeProvider` resolvem em outras linguagens, sem adicionar estado ambiente/estático compartilhado entre testes.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 11 "Unit testing anti-patterns", pp. 259-273
- [java.time.Clock: Java SE Platform API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Clock.html)
- [Mockito: CALLS_REAL_METHODS / mocking parcial](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html)
