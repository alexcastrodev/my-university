---
version: 1.0
updatedAt: 2026-08-07
title: A Classe LinkedList
summary: Como o armazenamento baseado em nós do LinkedList inverte o trade-off do ArrayList — acesso indexado O(n) em troca de inserção/remoção baratas — enquanto implementa List, Deque e Queue ao mesmo tempo.
---
## Objective

Entender o `LinkedList`, uma collection baseada em lista duplamente ligada que implementa `List`, `Deque` e `Queue` ao mesmo tempo — o mesmo objeto pode ser tratado como uma sequência indexável, uma fila de duas pontas ou uma FIFO/pilha, dependendo de quais métodos o chamador usa.

## Use Cases

- Inserção ou remoção frequente em ambas as pontas, ou no meio quando já posicionado ali, sem o custo de deslocamento que o `ArrayList` paga.
- Usar um único tipo de collection como pilha, fila ou lista posicional, sem escolher uma classe diferente para cada papel.
- Implementar algoritmos que percorrem a lista sequencialmente (via `Iterator`/`ListIterator`) em vez de pular para índices arbitrários.

## Deep Dive

### LinkedList estende AbstractSequentialList

```java
class LinkedList<E>
```

`LinkedList` implementa `List<E>`, `Deque<E>` e (transitivamente, através de `Deque`) `Queue<E>`. Dois construtores:

```java
LinkedList<String> ll = new LinkedList<>();
LinkedList<String> ll2 = new LinkedList<>(List.of("a", "b"));
```

```mermaid
classDiagram
    class Collection { <<interface>> }
    class List { <<interface>> }
    class Queue { <<interface>> }
    class Deque { <<interface>> }
    class AbstractSequentialList { <<abstract>> }
    class LinkedList
    Collection <|-- List
    Collection <|-- Queue
    Queue <|-- Deque
    List <|.. AbstractSequentialList
    AbstractSequentialList <|-- LinkedList
    Deque <|.. LinkedList
```

### Métodos de Deque em uma List

Como `LinkedList` implementa `Deque`, ambas as pontas são endereçáveis diretamente, em vez de apenas através das posições de índice-0/índice-`size()-1` de `List`:

```java
LinkedList<String> ll = new LinkedList<>();
ll.add("F"); ll.add("B"); ll.add("D"); ll.add("E"); ll.add("C");
ll.addLast("Z");
ll.addFirst("A");
ll.add(1, "A2");          // List-style positional insert
// ll: [A, A2, F, B, D, E, C, Z]

ll.remove("F");            // Collection-style remove by value
ll.remove(2);               // List-style remove by index
ll.removeFirst();
ll.removeLast();
```

`getFirst()`/`peekFirst()` e `getLast()`/`peekLast()` espelham a divisão entre lançar exceção e apenas reportar que `Deque` usa em todo lugar.

### Veja acontecendo: addFirst() crescendo a partir da cabeça

Cada `addFirst()` cai na frente — o slot 0 abaixo é a cabeça, uma inserção O(1) já que é só um novo nó sendo ligado, não um deslocamento de todos os outros elementos como faria `ArrayList.add(0, e)`:

```viz
type: formula
capacity = count
slot = capacity - 1 - index
---
A
B
C
D
```

O último a entrar (`D`) fica no slot 0. Compare isso com a viz do `ArrayList` — mesmos quatro elementos, regra de posicionamento oposta.

### O acesso posicional ainda funciona, só que não com eficiência

```java
String val = ll.get(2);
ll.set(2, val + " Changed");
```

`get`/`set` continuam disponíveis porque `LinkedList` implementa `List`, e continuam validando o índice da mesma forma que os do `ArrayList` — a diferença está em como o elemento é localizado, não no contrato do método.

## Trade-offs

- **`get(index)` é O(n), não O(1)** — o `LinkedList` não tem um array de acesso aleatório para pular direto; alcançar o índice `i` significa percorrer `i` nós a partir da ponta mais próxima:

  ```java
  LinkedList<Integer> ll = new LinkedList<>();
  for (int i = 0; i < 100_000; i++) ll.add(i);
  ll.get(99_999); // walks the list to get there — no shortcut
  ```

  Esse é o espelho exato do trade-off do `ArrayList`.
- **`LinkedList` não implementa `RandomAccess`** — código que decide seu comportamento com `instanceof RandomAccess` (como alguns algoritmos do JDK em `Collections` fazem) cai para percorrimento baseado em iterator em vez de loops baseados em índice quando recebe um `LinkedList`.
- **Todo elemento é envolvido em um objeto nó**, carregando referências prev/next junto com o valor — mais overhead de memória por elemento do que o array de suporte plano do `ArrayList`, independentemente de quantos elementos estejam armazenados.
- **Não é sincronizado**, assim como o `ArrayList` — modificação estrutural concorrente (inclusive durante a iteração) não é segura e tipicamente aparece como `ConcurrentModificationException`.

## Lab

Neste lab você recebe a classe `PlaybackQueue`, que embrulha um `LinkedList<String>`, e usa o `LinkedList` como `List` e como `Deque` ao mesmo tempo. A ideia central é que a mesma estrutura serve para uma fila comum (esperar a vez) e para "tocar a seguir" (furar a fila), porque oferece operações nas duas pontas além das posicionais.

**O cenário**

Uma fila de reprodução tem a faixa da frente tocando agora. Faixas novas esperam no fim, algumas pulam para o começo, e pular uma faixa remove a atual.

- `PlaybackQueue.java`: guarda `queue` (um `LinkedList<String>`). `size()` já está pronto. Os outros métodos você implementa.

**O que você vai fazer, passo a passo**

1. **Entrar no fim da fila (TODO-00).** Em `enqueue()`, adicione a faixa ao final: a adição normal, de quem espera a vez.
2. **Furar a fila (TODO-01).** Em `playNext()`, adicione a faixa ao INÍCIO, para que toque logo depois da que está tocando agora, à frente de tudo que já estava enfileirado. Pense qual método de `Deque` faz isso em uma só operação.
3. **Espiar a faixa atual (TODO-02).** Em `nowPlaying()`, devolva a faixa da frente SEM removê-la. Se a fila estiver vazia, deixe a exceção natural acontecer, sem capturar e relançar.
4. **Pular (TODO-03).** Em `skip()`, remova e devolva a faixa da frente, também deixando a exceção natural em caso de fila vazia. A diferença entre os métodos que lançam e os que devolvem `null` é justamente o ponto: escolha a variante que lança.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar a diferença entre `nowPlaying()` e `skip()` em termos de quem muda a fila, e o que acontece com uma fila vazia em cada um.

**Desafios opcionais**

- **TODO-04:** implemente `insertAt()`, inserindo a faixa na posição dada (0 é a frente) com a inserção posicional de `List` que o `LinkedList` também oferece.

**Pré-requisitos:** sintaxe básica de Java e familiaridade com `List` e `Deque`.

**Como rodar:** clone o repositório, entre em `java-concepts/linked-list` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/linked-list test`). Os métodos pendentes lançam `UnsupportedOperationException("Not implemented yet.")` com um comentário `TODO-NN`, então os testes vermelhos são o seu checklist.

## Documentation Links

- *Java: The Complete Reference*, 12th Edition (Herbert Schildt) — Chapter 20, pp. 589–590 — book
- [LinkedList — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedList.html) — doc
- [Deque — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
