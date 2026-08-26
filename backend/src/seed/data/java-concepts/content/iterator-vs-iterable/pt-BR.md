---
version: 1.0
updatedAt: 2026-07-25
title: Iterator vs Iterable
summary: O que cada interface faz, por que Iterable te obriga a implementar Iterator, e por que as coleções do JDK são construídas dessa forma.
---
## Objective

Entender a diferença entre `Iterable` e `Iterator`: `Iterable` é um contrato que diz "eu posso ser iterado" e obriga você a fornecer um `Iterator`, enquanto `Iterator` é o objeto que de fato percorre os elementos, um por um, através de `hasNext()` e `next()`.

## Use Cases

- Tornar uma classe personalizada percorrível em um loop `for-each` implementando `Iterable`.
- Expor uma travessia somente leitura e unidirecional sobre uma estrutura de dados sem vazar sua representação interna (array, lista encadeada, árvore, ...).
- Remover elementos com segurança durante a iteração, usando `Iterator.remove()` em vez de mutar a coleção diretamente.
- Construir um objeto de travessia independente (implementando só `Iterator`) quando o suporte a `for-each` não é necessário.
- Entender por que toda coleção do JDK (`ArrayList`, `LinkedList`, `HashSet`, ...) pode ser usada em um loop `for-each`.

## Deep Dive

### Iterable: o contrato

`Iterable<T>` declara um único método abstrato:

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

Ao implementar `Iterable`, uma classe é obrigada a produzir um `Iterator` — esse é todo o propósito da interface. Em troca, ela ganha suporte a `for-each` de graça, já que o loop é desaçucarado pelo compilador em chamadas a `iterator()`, `hasNext()` e `next()`.

```java
public class MyCollection implements Iterable<String> {
    private final String[] items = new String[10];

    @Override
    public Iterator<String> iterator() {
        return new MyIterator();
    }
}
```

Se você remover o método `iterator()` aqui, o compilador reclama — implementar `Iterable` sem fornecer um `Iterator` não é permitido.

### Iterator: o trabalhador

`Iterator<E>` é onde a lógica de travessia de fato mora, através de dois métodos que você precisa implementar mais um opcional:

```java
public interface Iterator<E> {
    boolean hasNext();
    E next();
    default void remove() { ... } // optional
}
```

- `hasNext()` — checa se há outro elemento disponível antes de você acessá-lo.
- `next()` — retorna o elemento atual e avança o cursor.
- `remove()` — opcional; remove o último elemento retornado por `next()` da coleção subjacente.

```java
private class MyIterator implements Iterator<String> {
    private int cursor = 0;

    @Override
    public boolean hasNext() {
        return cursor < items.length && items[cursor] != null;
    }

    @Override
    public String next() {
        return items[cursor++];
    }
}
```

### Iterator sem Iterable

`Iterator` não precisa de `Iterable` para existir. Uma classe pode implementar `Iterator` diretamente e ser usada de forma independente:

```java
public class CustomIterator implements Iterator<String> {
    private final List<String> elements = List.of("element one", "element two", "element three");
    private int cursor = 0;

    public boolean hasNext() { return cursor < elements.size(); }
    public String next() { return elements.get(cursor++); }
}
```

Isso funciona de boa com chamadas manuais a `hasNext()` / `next()`, mas como não é `Iterable`, não pode ser usado em um loop `for-each` — o compilador não tem em quê chamar `iterator()`.

### Por que o JDK os junta

Toda coleção do JDK segue esse mesmo padrão: `Collection` estende `Iterable`, então `List`, `Set` e toda implementação (`ArrayList`, `LinkedList`, `HashSet`, ...) precisa fornecer um `iterator()`. `ArrayList.iterator()`, por exemplo, retorna uma classe interna privada implementando `Iterator<E>` com seus próprios `hasNext()`, `next()` e `remove()` — exatamente a mesma forma mostrada acima. Isso também é uma aplicação de livro-texto do padrão de design Iterator: acesso sequencial a elementos sem expor a estrutura subjacente.

## Trade-offs

- **Acoplamento vs. conveniência** — implementar `Iterable` acopla sua classe a `Iterator`, mas o retorno (`for-each`) quase sempre vale a pena para qualquer coisa parecida com uma coleção.
- **`Iterator` independente perde o `for-each`** — pular `Iterable` é mais simples quando você só precisa de uma travessia manual de uma única vez, mas os chamadores perdem a capacidade de usar `for-each` e qualquer API que espera um `Iterable`:

  ```java
  CustomIterator it = new CustomIterator();
  for (String s : it) { ... } // error: CustomIterator is not Iterable
  ```
- **Mutar durante a iteração** — remover diretamente de uma coleção dentro de um loop `for-each` lança `ConcurrentModificationException`, porque o contador de modificação interno da coleção muda por baixo do iterator. `Iterator.remove()` é a única forma segura de excluir elementos no meio da travessia:

  ```java
  for (String s : list) {
      if (s.isEmpty()) list.remove(s); // ConcurrentModificationException
  }

  Iterator<String> it = list.iterator();
  while (it.hasNext()) {
      if (it.next().isEmpty()) it.remove(); // safe
  }
  ```
- **`remove()` é opcional** — muitas implementações de `Iterator` (por exemplo, sobre estruturas imutáveis ou de tamanho fixo) lançam `UnsupportedOperationException` a partir de `remove()`, então não dá para contar com ele universalmente:

  ```java
  Iterator<String> it = List.of("a", "b").iterator();
  it.next();
  it.remove(); // UnsupportedOperationException
  ```

## Documentation Links

- [Iterable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html) — doc
- [Iterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
