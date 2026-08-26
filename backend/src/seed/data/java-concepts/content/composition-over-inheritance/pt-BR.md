---
version: 1.0
updatedAt: 2026-08-13
title: Composição em vez de Herança, e Interfaces vs. Classes Abstratas
summary: Estender uma classe que você não controla é frágil porque depende de padrões internos de "auto-uso" não documentados, e composição com forwarding evita esse risco — a mesma limitação de herança única também explica por que interfaces, e não classes abstratas, costumam ser a forma certa de definir um tipo público.
---
## Objective

Estender uma classe concreta que você não controla é frágil: a subclasse depende silenciosamente do "auto-uso" não documentado da superclasse — quais dos seus próprios métodos chamam quais outros internamente — e esse detalhe pode mudar de uma versão para outra, quebrando a subclasse sem que o código de nenhuma das duas classes tenha sido tocado. Composição mais forwarding (um wrapper/decorator que implementa a mesma interface e guarda uma instância do tipo envolvido, delegando para ele) evita esse problema por completo. A mesma limitação de herança única que torna o subclassing arriscado também molda uma decisão separada: quando uma API pública define um *tipo* feito para ter múltiplas implementações, uma interface quase sempre é a escolha melhor do que uma classe abstrata, porque uma classe pode implementar qualquer número de interfaces mas estender apenas uma classe — uma lacuna que métodos `default` (Java 8+) diminuem mas não fecham.

## Use Cases

- Adicionar instrumentação, logging ou validação a um `Set`, `List` ou `Map` sem fazer subclassing direto de `HashSet`/`ArrayList` e herdar seus padrões internos de chamada.
- Envolver uma classe de uma biblioteca que você não controla para adicionar comportamento, sem depender de detalhes de implementação que não fazem parte do seu contrato.
- Projetar um tipo de API pública que muitas classes não relacionadas vão precisar implementar — opte por uma interface, não por uma classe base abstrata, para que os implementadores não sejam forçados a abrir mão da única chance de usar `extends`.
- Adaptar uma classe existente com uma nova capacidade (do jeito que `Comparable` é adicionado a classes depois do fato) — só possível com uma interface, já que você não pode inserir uma nova superclasse abstrata numa hierarquia já publicada.
- Dar aos implementadores de uma interface não trivial um ponto de partida com uma implementação abstrata esquelética (`AbstractSet`, `AbstractList`, `AbstractMap`), deixando-os livres para implementar a interface diretamente caso não possam estender.

## Deep Dive

### A classe base frágil: fazendo subclassing de HashSet

Suponha que você queira um `Set` que rastreie quantos elementos já foram inseridos. A jogada óbvia — estender `HashSet` e sobrescrever os dois métodos capazes de adicionar — parece razoável:

```java
public class InstrumentedHashSet<E> extends HashSet<E> {
    private int addCount = 0;

    @Override
    public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }

    public int getAddCount() {
        return addCount;
    }
}
```

```java
InstrumentedHashSet<String> s = new InstrumentedHashSet<>();
s.addAll(List.of("Snap", "Crackle", "Pop"));
System.out.println(s.getAddCount()); // 6 — not 3
```

`HashSet` não declara seu próprio `addAll`; ele herda de `AbstractCollection`, cuja implementação é um loop que chama `add(e)` uma vez por elemento. Essa chamada é virtual, então ela resolve para `InstrumentedHashSet.add()` — o mesmo método que já está incrementando `addCount`. A sobrescrita em `addAll` adiciona 3 pelo lote, e então `super.addAll(c)` dispara mais três chamadas ao `add` sobrescrito, adicionando mais 3: cada elemento do lote é contado duas vezes. Nada disso é documentado como uma garantia — é simplesmente como `AbstractCollection.addAll` está escrito hoje, o que é exatamente por que depender disso é frágil. (Se uma classe *é* projetada para ser estendida com segurança, ela diz isso explicitamente — veja o Javadoc de `AbstractCollection.remove`, que explica em prosa "This implementation iterates over the collection...". `HashSet` não faz essa promessa sobre `add`/`addAll`, e uma classe não documentada para herança deveria geralmente ser ou deixada em paz, ou declarada `final`.)

### O conserto: composição e forwarding

Em vez de estender `HashSet`, dê à nova classe uma referência privada para um `Set` e implemente `Set` delegando cada chamada a ele. Os próprios métodos do wrapper nunca dependem de como o objeto envolvido se implementa internamente:

```java
public class ForwardingSet<E> implements Set<E> {
    private final Set<E> s;
    public ForwardingSet(Set<E> s) { this.s = s; }

    public int size()                                { return s.size(); }
    public boolean isEmpty()                          { return s.isEmpty(); }
    public boolean contains(Object o)                 { return s.contains(o); }
    public Iterator<E> iterator()                     { return s.iterator(); }
    public Object[] toArray()                         { return s.toArray(); }
    public <T> T[] toArray(T[] a)                     { return s.toArray(a); }
    public boolean add(E e)                           { return s.add(e); }
    public boolean remove(Object o)                   { return s.remove(o); }
    public boolean containsAll(Collection<?> c)       { return s.containsAll(c); }
    public boolean addAll(Collection<? extends E> c)  { return s.addAll(c); }
    public boolean retainAll(Collection<?> c)         { return s.retainAll(c); }
    public boolean removeAll(Collection<?> c)         { return s.removeAll(c); }
    public void clear()                               { s.clear(); }
    @Override public boolean equals(Object o)         { return s.equals(o); }
    @Override public int hashCode()                   { return s.hashCode(); }
    // removeIf, stream, parallelStream, forEach, spliterator: not forwarded —
    // they're default methods on Collection, built on top of iterator()/size()
    // above, so they work correctly without being written here at all.
}

public class InstrumentedSet<E> extends ForwardingSet<E> {
    private int addCount = 0;

    public InstrumentedSet(Set<E> s) { super(s); }

    @Override public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }

    public int getAddCount() { return addCount; }
}
```

```java
Set<String> s = new InstrumentedSet<>(new HashSet<>());
s.addAll(List.of("Snap", "Crackle", "Pop"));
System.out.println(((InstrumentedSet<String>) s).getAddCount()); // 3, correctly
```

`InstrumentedSet.addAll` adiciona 3, e então chama `super.addAll(c)`, que é `ForwardingSet.addAll` — ele encaminha diretamente para o `addAll` do *próprio* conjunto envolvido. O que quer que essa instância envolvida faça internamente (fazer um loop e chamar seu próprio `add`, ou algo totalmente diferente) acontece na vtable do próprio objeto envolvido, nunca na de `InstrumentedSet`, então isso não pode voltar em loop para a sobrescrita que já contou o lote. Isso também é chamado de padrão Decorator: `InstrumentedSet` "decora" qualquer `Set` que receber — um `TreeSet`, um `HashSet`, até um que já esteja em uso (`new InstrumentedSet<>(existingSet)` no meio de um método) — sem precisar de um construtor separado por implementação envolvida, diferente da versão por herança.

### Interfaces vs. classes abstratas, hoje

Tanto interfaces quanto classes abstratas permitem definir um tipo com múltiplas implementações, mas só uma delas custa ao implementador sua única chance de usar `extends`:

```java
public interface Greeter {
    String name();

    default String greet() {                 // behavior, not just a signature
        return "Hello, " + name() + "!";
    }
}

public class Robot implements Greeter, AutoCloseable {
    private final String name;
    public Robot(String name) { this.name = name; }

    @Override public String name() { return name; }
    @Override public void close() { /* release resources */ }
}
```

`Robot` implementa duas interfaces não relacionadas e ganha de graça o corpo de `greet()`. Se `Greeter` fosse uma classe abstrata, `Robot` não poderia estender mais nada além dela — Java permite apenas herança única de implementação, então comprometer um tipo público com uma base abstrata é uma escolha bem mais restritiva do que comprometê-lo com uma interface. Essa assimetria também é por que interfaces funcionam como mixins (`Comparable`, `AutoCloseable`, o `Greeter` acima — capacidades "opcionais" acopladas ao tipo primário de uma classe) e por que uma classe existente pode ser adaptada para implementar uma interface totalmente nova (adicionar os métodos, adicionar a cláusula `implements`) mas essencialmente nunca pode ser adaptada para uma nova superclasse abstrata sem perturbar toda a hierarquia acima dela.

Métodos `default` (Java 8+) fecham boa parte dessa lacuna histórica: uma interface agora pode trazer comportamento de verdade, e — de forma crítica — o próprio JDK usou exatamente isso para expandir `Collection`. `stream()`, `forEach()` e `removeIf()` foram todos adicionados a `Collection` como métodos `default` para que toda implementação pré-existente, incluindo aquelas escritas anos antes por terceiros, continuasse compilando em vez de quebrar. Métodos `private` de interface (Java 9+) vão além, permitindo que métodos `default` compartilhem lógica auxiliar sem expor isso como API pública. O que métodos `default` ainda não conseguem fazer é dar estado a uma instância de interface: a lógica de um método `default` tem que ser expressa inteiramente em termos dos próprios métodos abstratos da interface, porque interfaces não podem declarar campos de instância.

```java
interface Counter {
    int get();
    default String describe() { return "count=" + get(); } // fine — reads via get()
    // default int next() { return count++; }               // won't compile — no `count` field to hold
}
```

Onde a reutilização de implementação entre muitos implementadores realmente importa, o padrão do próprio JDK é uma implementação abstrata esquelética ao lado da interface — `AbstractSet`, `AbstractList`, `AbstractMap` ao lado de `Set`, `List`, `Map`. A interface ainda define o tipo; a classe `AbstractXxx` é um atalho opcional para implementadores que não precisam estender outra coisa. `ForwardingSet` acima é a mesma ideia por outro ângulo: ele implementa `Set` por completo, então qualquer um que *não possa* estender uma classe esquelética (porque já está estendendo outra coisa, ou está envolvendo uma instância existente) ainda ganha uma implementação funcional para delegar.

## Trade-offs

- **Forwarding custa uma chamada virtual extra por método delegado.** Todo método de `ForwardingSet` é mais um salto antes de chegar à implementação real. Na prática esse overhead é insignificante perto do que a própria coleção faz, mas não é literalmente de graça como o dispatch direto da herança é.
- **Classes wrapper são invisíveis para APIs baseadas em callback (o "problema do SELF").** O objeto envolvido não tem ideia de que foi envolvido, então se ele em algum momento entregar `this` para outro objeto para um callback posterior, esse callback ignora totalmente o comportamento adicionado pelo wrapper:

  ```java
  class Publisher {
      void subscribe(Consumer<Publisher> onEvent) { onEvent.accept(this); } // passes the raw Publisher
  }
  class LoggingPublisher extends ForwardingPublisher {
      LoggingPublisher(Publisher p) { super(p); }
      // any callback registered through subscribe() gets the unwrapped Publisher —
      // LoggingPublisher's logging never runs for it
  }
  ```
- **Escolher uma classe abstrata como seu tipo público é uma decisão de mão única e alto custo.** Uma vez que os implementadores comecem a estendê-la, eles gastaram permanentemente sua única chance de `extends` — Java não tem herança múltipla de estado para recorrer:

  ```java
  class A {}
  class B {}
  class C extends A, B {}   // does not compile — a class extends at most one class
  ```
- **Expandir uma interface já lançada sem um default quebra todo implementador existente, imediatamente.** Essa era toda a razão pela qual interfaces eram consideradas mais difíceis de evoluir do que classes abstratas antes do Java 8 — e isso ainda é verdade para qualquer método abstrato novo adicionado sem um:

  ```java
  interface Foo { void a(); }
  // adding `void b();` here with no default body means every
  // pre-existing `implements Foo` class stops compiling until it adds b()
  ```
- **Métodos default adicionam comportamento, não estado, então não podem substituir campos.** Um método `default` só consegue calcular a partir do que os métodos abstratos da interface expõem — ele não tem onde guardar dados privados por instância, diferente de um campo numa classe abstrata. Veja o exemplo `Counter` no Deep Dive: `describe()` compila porque só lê através de `get()`; um `next()` com estado não tem campo para incrementar.

## Documentation Links

- [Set — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html) — doc
- [AbstractCollection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractCollection.html) — doc
- [Default Methods — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html) — doc
- [Java Language Specification — Chapter 9.4, Interface Method Declarations](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4) — doc
