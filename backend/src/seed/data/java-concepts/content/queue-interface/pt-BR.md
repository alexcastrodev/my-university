---
version: 1.0
updatedAt: 2026-07-27
title: A Interface Queue
summary: Por que Queue define duas famílias paralelas de métodos — uma que lança exceção em caso de falha, outra que reporta a falha — e o que isso significa para filas vazias e de tamanho fixo.
---
## Objective

Entender `Queue`: uma `Collection` que declara o comportamento de uma fila — frequentemente first-in, first-out, embora algumas implementações ordenem elementos por outros critérios (uma `PriorityQueue`, por exemplo, ordena por prioridade, não por ordem de chegada). `Queue` é construída em torno de dois pares de métodos paralelos: uma família lança exceção em caso de falha, a outra reporta a falha através de um valor de retorno.

## Use Cases

- Modelar uma fila de trabalho onde itens são processados na ordem em que chegam.
- Espiar o próximo item sem se comprometer a removê-lo, antes de decidir como tratá-lo.
- Trabalhar com uma fila limitada ou de tamanho fixo, onde "a fila está cheia" é uma condição esperada a ser tratada, não excepcional.
- Escolher entre uma operação que lança exceção em uma fila vazia e uma que retorna `null`, dependendo se "vazio" é um bug ou um estado normal para o chamador.
- Construir um pipeline de processamento ordenado por prioridade ou por outra ordenação customizada, ainda trabalhando contra o tipo genérico `Queue`.

## Deep Dive

### Queue estende Collection

```java
interface Queue<E>
```

`E` especifica o tipo de objetos que a fila vai conter. Vários dos métodos de `Queue` lançam `ClassCastException` quando um objeto é incompatível com os elementos já na fila, `NullPointerException` quando `null` não é permitido, e `IllegalArgumentException` se um argumento inválido é usado — o mesmo vocabulário de exceções que `Collection` usa em outros lugares.

```mermaid
classDiagram
    class Collection { <<interface>> }
    class Queue { <<interface>> }
    class Deque { <<interface>> }
    class LinkedList
    class ArrayBlockingQueue
    class PriorityQueue
    Collection <|-- Queue
    Queue <|-- Deque
    Queue <|.. LinkedList
    Queue <|.. ArrayBlockingQueue
    Queue <|.. PriorityQueue
```

### Adicionando: add() vs. offer()

`add()` (herdado de `Collection`) lança exceção se não conseguir adicionar o elemento. `offer()` é o método próprio de `Queue` para o mesmo trabalho, mas ele reporta a falha em vez de lançar exceção:

```java
Queue<Integer> q = new ArrayBlockingQueue<>(1); // fixed capacity: 1
q.add(10);          // true, added
q.add(20);           // IllegalStateException: queue full
```

```java
Queue<Integer> q = new ArrayBlockingQueue<>(1);
q.add(10);
boolean added = q.offer(20); // false — reports the failure instead of throwing
```

### Olhando sem remover: element() vs. peek()

Ambos retornam o elemento na cabeça da fila sem removê-lo. Eles diferem só em como tratam uma fila vazia:

```java
Queue<String> q = new LinkedList<>();
q.element(); // NoSuchElementException — queue is empty
q.peek();    // null — queue is empty
```

### Removendo: remove() vs. poll()

Ambos removem e retornam o elemento na cabeça da fila. A mesma divisão em relação a vazio:

```java
Queue<String> q = new LinkedList<>();
q.remove(); // NoSuchElementException — queue is empty
q.poll();   // null — queue is empty
```

### Escolhendo um par com base em como "vazio" ou "cheio" deve ser tratado

As duas famílias existem para que um chamador possa escolher o modo de falha que se encaixa na situação: `add()`/`remove()`/`element()` são apropriados quando uma fila vazia ou cheia é um bug que o chamador quer ver surgir imediatamente; `offer()`/`poll()`/`peek()` são apropriados quando é um resultado esperado sobre o qual o chamador vai ramificar.

```java
if (queue.offer(item)) {
    // handle success
} else {
    // queue full — handle without a try/catch
}
```

## Trade-offs

- **O par que lança exceção e o par que retorna null/false não são intercambiáveis** — trocar `element()`/`remove()` por `peek()`/`poll()` (ou vice-versa) muda como uma fila vazia é reportada, de uma exceção para um valor sentinela:

  ```java
  Queue<String> q = new LinkedList<>();
  q.element(); // NoSuchElementException
  q.peek();    // null
  ```
- **Uma fila de tamanho fixo faz add() lançar exceção onde offer() apenas reportaria false** — isso só aparece quando a fila é de fato limitada (ex.: `ArrayBlockingQueue`), não com uma ilimitada como `LinkedList`:

  ```java
  Queue<Integer> q = new ArrayBlockingQueue<>(1);
  q.add(1);
  q.add(2); // IllegalStateException: queue full
  ```
- **null dobra como o sentinela de "fila vazia" para peek()/poll()**, então uma fila que de fato armazenasse `null` como elemento tornaria "vazio" indistinguível de "cabeça é null". A maioria das implementações de `Queue` evita a ambiguidade proibindo `null` completamente:

  ```java
  Queue<String> q = new LinkedList<>();
  q.add(null); // NullPointerException — null elements are not allowed
  ```
- **FIFO é uma convenção que algumas implementações escolhem, não uma garantia que a própria `Queue` faz** — uma `PriorityQueue` implementa a mesma interface mas ordena elementos por prioridade em vez de ordem de inserção, então código que assume comportamento first-in-first-out estrito só pelo tipo `Queue` está assumindo mais do que a interface promete.

## Lab

Neste lab você recebe `TicketCounter`, uma fila de atendimento com capacidade fixa, com quatro métodos vazios. Seu trabalho é implementá-los escolhendo, em cada caso, a variante certa de `Queue`. A ideia central é sentir as duas famílias paralelas de métodos: as que lançam exceção quando falham e as que avisam por valor de retorno (`false` ou `null`).

**O cenário**

Uma fila de clientes com limite de tamanho.

- `TicketCounter`: guarda a fila em `line`, uma `ArrayBlockingQueue<String>` criada com a capacidade informada no construtor. `waiting()` (quantos esperam) já está pronto.
- `tryEnqueue(customer)`: tenta entrar na fila.
- `nextInLine()`: espia quem é o próximo, sem tirar da fila.
- `serveNext()`: atende o próximo e o remove.
- `serveNextOrNull()`: o mesmo, mas sem lançar exceção.

Como a fila é limitada, "cheia" e "vazia" são situações reais, e os testes exercitam as duas.

**O que você vai fazer, passo a passo**

1. **Entrar sem estourar (TODO-00).** Use `offer()`, que devolve `false` quando a fila está cheia em vez de lançar `IllegalStateException` como o `add()` faria.
2. **Espiar a cabeça (TODO-01).** Use `peek()`, que devolve `null` se a fila está vazia e não remove ninguém.
3. **Atender com exceção (TODO-02).** Use `remove()`, que lança `NoSuchElementException` numa fila vazia. Aqui a fila vazia é bug de quem chamou.
4. **Atender sem exceção (TODO-03).** Use `poll()`, que faz o mesmo trabalho, mas devolve `null` quando não há ninguém.

**Como saber que terminou**

`mvn test` fica todo verde, incluindo a ordem FIFO (primeiro a entrar, primeiro a sair). Você deve conseguir dizer quando prefere cada família: exceção quando o estado inválido é erro de programação, retorno especial quando ele é uma situação normal.

**Desafios opcionais**

- **BONUS-00:** implemente `drainAll()`, devolvendo um `List<String>` com todos os clientes restantes, em ordem, esvaziando a fila com `poll()` repetido até acabar.

**Pré-requisitos:** sintaxe básica de Java e a interface `Collection`. O projeto usa Java 21 e Maven.

**Como rodar:** clone o repositório, entre em `java-concepts/queue-interface` e rode `mvn test` (da raiz: `mvn -pl java-concepts/queue-interface test`). Os métodos começam lançando `UnsupportedOperationException("Not implemented yet.")` e os comentários `TODO-NN` trazem dicas, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Queue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
