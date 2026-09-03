---
version: 1.0
updatedAt: 2026-09-03
question: Como inverter os elementos de uma lista?
---
## Question

# Como inverter os elementos de uma lista?

## Short Answer

É um pouco mais complicado do que parece.

## Less Short Answer

Existe um método de fábrica na classe utilitária `Collections` chamado simplesmente `reverse`, que faz exatamente isso.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Cid"));
Collections.reverse(names);
// names = ["Cid", "Bob", "Ana"]
```

Note que há várias armadilhas nesse método.

## Trap One: A List, Not a Collection

Esse método recebe uma `List`, não uma `Collection`, porque uma `Collection` não é ordenada, então não faz sentido tentar invertê-la.

## Trap Two: It Modifies Your List

Esse método modifica sua lista, então ela precisa ser modificável, e também precisa ter um `ListIterator` que suporte a operação `set`. É o caso de uma `ArrayList`, de uma `LinkedList`, e até da lista que você obtém ao chamar `Arrays.asList(...)` — mas isso ainda é algo que você precisa ter em mente se sua aplicação usar outras implementações.

```java
List<Integer> fixedSize = Arrays.asList(1, 2, 3);
Collections.reverse(fixedSize); // OK: fixedSize = [3, 2, 1]

List<Integer> immutable = List.of(1, 2, 3);
Collections.reverse(immutable); // lança UnsupportedOperationException
```

## A View Instead: `reversed()`

Você também tem o método `reversed()`, adicionado como parte da interface `SequencedCollection`, estendida por `List`. Esse método `reversed()` retorna uma *view* sobre sua lista original, sem modificá-la — então ele também funciona em listas não modificáveis.

```java
List<Integer> immutable = List.of(1, 2, 3);
List<Integer> view = immutable.reversed();
// view = [3, 2, 1], immutable permanece intacta
```

Note que essa view é modificável se a lista original também for, e nesse caso, modificar a view modifica a lista original.

```java
List<Integer> original = new ArrayList<>(List.of(1, 2, 3));
List<Integer> view = original.reversed();
view.set(0, 99);
// original = [1, 2, 99]
```

## One Last Word

Usar `Collections.reverse` pode ser custoso, pois ele precisa processar toda a sua lista para invertê-la. Criar uma view com `reversed()` é um processo leve, porque o que você recebe é um wrapper que opera de forma preguiçosa (lazy) sobre sua lista.

## References

- [Java Coding Tip #391: How Can You Reverse the Elements of a List?](https://youtube.com/shorts/zlEC4rVx6uA?is=jNVHRKysDO1etyh7) — video
- [Collections.reverse — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#reverse(java.util.List)) — doc
- [SequencedCollection.reversed — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html#reversed()) — doc
