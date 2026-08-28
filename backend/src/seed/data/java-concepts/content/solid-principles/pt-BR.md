---
version: 1.0
updatedAt: 2026-08-28
title: SOLID: Cinco Princípios de Design Orientado a Objetos
summary: Cinco regras — responsabilidade única, aberto/fechado, substituição de Liskov, segregação de interfaces e inversão de dependência — para manter uma hierarquia de classes barata de mudar e segura de estender.
---
## Objective

SOLID é um mnemônico para cinco princípios de design orientado a objetos — Responsabilidade Única, Aberto/Fechado, Substituição de Liskov, Segregação de Interfaces e Inversão de Dependência — que descrevem como estruturar classes e interfaces para que uma base de código continue barata de mudar: cada unidade muda por um único motivo, um comportamento novo é adicionado em vez de editar o existente, subtipos continuam de fato intercambiáveis com o tipo base, clientes dependem apenas dos métodos que realmente chamam, e código de política de alto nível não se conecta diretamente a detalhes de implementação de baixo nível.

## Use Cases

- Uma classe continua mudando por motivos que não têm relação entre si (uma mudança de regra de preço e uma mudança de formato de relatório mexem no mesmo arquivo) — sintoma de Responsabilidade Única.
- Adicionar um caso novo significa editar uma cadeia de `if`/`else` ou `switch` já testada, em vez de adicionar uma implementação nova — sintoma de Aberto/Fechado.
- Uma subclasse sobrescreve um método para lançar exceção ou mudar silenciosamente o comportamento documentado do tipo base — sintoma de Substituição de Liskov.
- Uma implementação de interface está cheia de métodos que só fazem `throw new UnsupportedOperationException()` — sintoma de Segregação de Interfaces.
- Uma classe de alto nível constrói suas próprias dependências concretas com `new` em vez de receber uma abstração — sintoma de Inversão de Dependência.

## Deep Dive

### S — Single Responsibility Principle

Uma classe deve ter um único motivo para mudar — um único eixo de mudança, idealmente rastreável a um único stakeholder. A `Invoice` abaixo responde a dois: o financeiro (como o total é calculado) e o relatório (como ela é salva e impressa).

```java
class Invoice {
    private final List<LineItem> items;

    Invoice(List<LineItem> items) { this.items = items; }

    double total() {
        return items.stream().mapToDouble(LineItem::price).sum();
    }

    void saveToDatabase() { /* chamadas JDBC */ }
    void printToPdf() { /* renderização de PDF */ }
}
```

Separando a persistência e a impressão em colaboradores próprios, `Invoice` fica com exatamente um motivo para mudar — como o total é calculado:

```java
class Invoice {
    private final List<LineItem> items;
    Invoice(List<LineItem> items) { this.items = items; }
    double total() { return items.stream().mapToDouble(LineItem::price).sum(); }
}

class InvoiceRepository {
    void save(Invoice invoice) { /* chamadas JDBC */ }
}

class InvoicePrinter {
    void printToPdf(Invoice invoice) { /* renderização de PDF */ }
}
```

### O — Open/Closed Principle

Um módulo deve estar aberto para extensão, mas fechado para modificação. Uma calculadora de desconto construída como uma cadeia crescente de `if`/`else` precisa ser editada — e retestada — toda vez que surge um novo nível de cliente:

```java
double discount(String customerType, double amount) {
    if (customerType.equals("REGULAR")) return amount * 0.95;
    else if (customerType.equals("PREMIUM")) return amount * 0.90;
    // um novo nível significa mais um branch aqui
    return amount;
}
```

Substituir o branch por uma abstração `DiscountPolicy` faz com que um novo nível seja uma classe nova — o próprio `discount()` nunca mais muda:

```java
interface DiscountPolicy {
    double apply(double amount);
}

class RegularDiscount implements DiscountPolicy {
    public double apply(double amount) { return amount * 0.95; }
}

class PremiumDiscount implements DiscountPolicy {
    public double apply(double amount) { return amount * 0.90; }
}

double discount(DiscountPolicy policy, double amount) {
    return policy.apply(amount);
}
```

### L — Liskov Substitution Principle

Um subtipo precisa ser substituível pelo seu tipo base: qualquer código escrito contra `Rectangle` deve continuar funcionando, sem alterações, ao receber um `Square`. Fazer `Square` estender `Rectangle` sobrescrevendo os dois setters para manter os lados iguais quebra essa garantia:

```java
class Rectangle {
    protected int width, height;
    void setWidth(int w) { this.width = w; }
    void setHeight(int h) { this.height = h; }
    int area() { return width * height; }
}

class Square extends Rectangle {
    @Override void setWidth(int w) { width = height = w; }
    @Override void setHeight(int h) { width = height = h; }
}

Rectangle r = new Square(0, 0);
r.setWidth(5);
r.setHeight(4);
System.out.println(r.area()); // 20 num Rectangle de verdade, mas 16 aqui
```

As mesmas duas chamadas dão uma resposta diferente dependendo do tipo concreto escondido atrás da referência `Rectangle` — `Square` compila como `Rectangle`, mas não se comporta como um. Modelar os dois como implementações independentes de uma abstração `Shape` mais estreita evita essa falsa relação de "é um" por completo:

```java
interface Shape {
    int area();
}

record Rectangle(int width, int height) implements Shape {
    public int area() { return width * height; }
}

record Square(int side) implements Shape {
    public int area() { return side * side; }
}
```

### I — Interface Segregation Principle

Nenhum cliente deve ser forçado a depender de métodos que não usa. Uma única interface `Worker` obriga todo implementador a responder por `eat()` e `sleep()`, mesmo um que não tem uso algum para eles:

```java
interface Worker {
    void work();
    void eat();
    void sleep();
}

class RobotWorker implements Worker {
    public void work() { /* ... */ }
    public void eat() { throw new UnsupportedOperationException(); }
    public void sleep() { throw new UnsupportedOperationException(); }
}
```

Dividir `Worker` em interfaces de papel permite que cada implementador dependa só do que de fato faz:

```java
interface Workable { void work(); }
interface Feedable { void eat(); }
interface Sleepable { void sleep(); }

class RobotWorker implements Workable {
    public void work() { /* ... */ }
}

class HumanWorker implements Workable, Feedable, Sleepable {
    public void work() { /* ... */ }
    public void eat() { /* ... */ }
    public void sleep() { /* ... */ }
}
```

### D — Dependency Inversion Principle

Um módulo de alto nível não deveria depender dos detalhes concretos de um módulo de baixo nível — ambos deveriam depender de uma abstração que o módulo de alto nível define. O `OrderService` abaixo é a política, mas se conecta diretamente a uma tecnologia de armazenamento específica:

```java
class OrderService {
    private final MySqlOrderRepository repository = new MySqlOrderRepository();

    void placeOrder(Order order) {
        repository.save(order);
    }
}
```

Introduzir uma abstração `OrderRepository` e injetá-la inverte a seta de dependência: `MySqlOrderRepository` agora depende da interface que `OrderService` define, e não o contrário.

```java
interface OrderRepository {
    void save(Order order);
}

class OrderService {
    private final OrderRepository repository;

    OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    void placeOrder(Order order) {
        repository.save(order);
    }
}

class MySqlOrderRepository implements OrderRepository {
    public void save(Order order) { /* chamadas JDBC */ }
}
```

Trocar por um `InMemoryOrderRepository` em um teste agora não exige nenhuma mudança em `OrderService`.

## Trade-offs

- **Mais tipos para o mesmo comportamento** — Responsabilidade Única e Segregação de Interfaces trocam deliberadamente uma classe ou interface grande por várias pequenas e focadas; uma God class é um único arquivo para dar `grep`, cinco colaboradores são vários para navegar.
- **Aberto/Fechado só compensa quando a costura é a certa** — transformar um branch em uma abstração `DiscountPolicy` só vale a pena se mais níveis realmente estiverem por vir; errar a aposta deixa uma abstração sem uso ao lado de um branch que continua crescendo em outro lugar.
- **Violações de Liskov compilam sem erro** — o compilador não consegue detectar um contrato de comportamento quebrado, só uma assinatura de tipo quebrada, então um `Square extends Rectangle` sobrescrito passa em toda checagem de compilação e só quebra no ponto de chamada:

```java
Rectangle r = new Square(0, 0);
r.setWidth(5);
r.setHeight(4);
System.out.println(r.area()); // 16, não os 20 que um chamador de Rectangle espera
```

- **Inversão de Dependência não elimina o `new`, apenas o realoca** — a abstração ainda precisa de um único lugar, um composition root, que constrói a implementação concreta e a entrega para todo o resto:

```java
OrderService service = new OrderService(new MySqlOrderRepository());
```

## Documentation Links

- [UnsupportedOperationException — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/UnsupportedOperationException.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
