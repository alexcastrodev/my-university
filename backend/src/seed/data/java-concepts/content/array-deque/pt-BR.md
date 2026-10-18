---
version: 1.0
updatedAt: 2026-08-12
title: A Classe ArrayDeque
summary: Como o armazenamento em array, sem restrição de capacidade, do ArrayDeque o torna a escolha recomendada pelo JDK para pilha/fila em vez do Stack legado ou LinkedList quando elementos nulos não são necessários.
---
## Objective

Entender `ArrayDeque`, uma implementação de `Deque` com array redimensionável e sem restrição de capacidade — utilizável como pilha (LIFO, via `push`/`pop`) ou fila (FIFO, via `offer`/`poll`), e geralmente a escolha recomendada pelo JDK em vez da classe legada `Stack` ou de uma `LinkedList` para qualquer um dos dois papéis.

## Use Cases

- Implementar uma pilha sem recorrer à classe `Stack`, legada e sincronizada.
- Implementar uma fila FIFO sem a sobrecarga de alocação por nó da `LinkedList`.
- Cargas de trabalho de duas pontas que adicionam/removem de ambas as extremidades.
- Um buffer redimensionável sem capacidade fixa, ao contrário de implementações de `Deque` com capacidade limitada.

## Deep Dive

### ArrayDeque estende AbstractCollection

```java
class ArrayDeque<E>
```

Implementa `Deque<E>` e não adiciona métodos próprios — tudo o que oferece vem de `Deque`. Três construtores:

```java
ArrayDeque<String> a = new ArrayDeque<>();          // empty, capacity sufficient for 16 elements
ArrayDeque<String> b = new ArrayDeque<>(100);        // pre-sized for 100 elements
ArrayDeque<String> c = new ArrayDeque<>(List.of("x", "y")); // initialized from a collection
```

A capacidade cresce automaticamente à medida que elementos são adicionados — `Deque` permite implementações com capacidade restrita, mas `ArrayDeque` não é uma delas.

```mermaid
classDiagram
    class Collection { <<interface>> }
    class Queue { <<interface>> }
    class Deque { <<interface>> }
    class AbstractCollection { <<abstract>> }
    class ArrayDeque
    Collection <|-- Queue
    Queue <|-- Deque
    Collection <|.. AbstractCollection
    AbstractCollection <|-- ArrayDeque
    Deque <|.. ArrayDeque
```

### Usando como pilha

```java
ArrayDeque<String> stack = new ArrayDeque<>();
stack.push("A"); stack.push("B"); stack.push("D"); stack.push("E"); stack.push("F");
while (stack.peek() != null) {
    System.out.print(stack.pop() + " "); // F E D B A — last pushed, first popped
}
```

`push`/`pop` são os aliases orientados a pilha do `Deque` para `addFirst`/`removeFirst`.

### Veja acontecendo: push() construindo uma pilha

Cada `push()` cai no início — o slot 0 abaixo é o topo da pilha, o próximo alvo de `pop()`:

```viz
type: formula
capacity = count
slot = capacity - 1 - index
---
A
B
D
E
F
```

Sem colisões aqui, diferente de uma tabela hash — cada push ganha seu próprio slot, e o último a entrar (`F`) fica no slot 0, exatamente de onde `pop()` lê primeiro.

### Usando como fila

```java
ArrayDeque<String> queue = new ArrayDeque<>();
queue.offer("A"); queue.offer("B"); queue.offer("C");
queue.poll(); // "A" — first offered, first polled
```

`offer`/`poll` aqui funcionam identicamente aos métodos de `Queue` descritos no conceito da interface Queue — `ArrayDeque` satisfaz `Queue` através de `Deque`.

## Trade-offs

- **Elementos `null` são proibidos** (`NullPointerException` na inserção) — diferente de `LinkedList`, que permite `null` já que não é dedicada exclusivamente ao uso estilo `Deque`:

  ```java
  ArrayDeque<String> dq = new ArrayDeque<>();
  dq.add(null); // NullPointerException
  ```
- **Sem restrição de capacidade e sem comportamento de bloqueio** — se uma fila limitada, que produz backpressure, é o requisito real, `ArrayDeque` é a ferramenta errada; é para isso que existem implementações com capacidade restrita como `ArrayBlockingQueue`.
- **Não sincronizada** — mesma ressalva das demais classes cobertas aqui; acesso concorrente de múltiplas threads precisa de sincronização externa ou de uma collection concorrente.
- **O armazenamento baseado em array evita a alocação por nó da `LinkedList`**, motivo pelo qual a documentação do JDK recomenda `ArrayDeque` em vez de `LinkedList` para uso como pilha/fila quando elementos `null` não são necessários — o trade-off é o mesmo custo de redimensionamento amortizado que `ArrayList` paga, em troca de nenhuma sobrecarga de nó por elemento.

## Lab

Neste lab você recebe a classe `DequeToolkit`, uma coleção de utilitários sobre strings em que cada um é resolvido naturalmente com um deque. Você usa o `ArrayDeque` como pilha (`push` e `pop`) para casar parênteses e inverter texto, e depois usa as DUAS pontas do mesmo deque ao mesmo tempo para verificar um palíndromo.

**O cenário**

Três problemas clássicos, uma estrutura só.

- `DequeToolkit.isBalanced()`: diz se todo `(`, `[` e `{` tem o fechamento correspondente na ordem certa. `"([{}])"` é balanceada, `"([)]"` e `"("` não.
- `DequeToolkit.isPalindrome()`: diz se o texto é igual lido de trás para frente.
- `DequeToolkit.reverse()`: devolve os caracteres do texto invertidos, como `List<Character>`.
- `DequeToolkit.rotateLeft()`: opcional, rotaciona um deque no lugar.

**O que você vai fazer, passo a passo**

1. **Balancear colchetes (TODO-00).** Use um `ArrayDeque<Character>` como pilha. Empilhe cada abertura. Em cada fechamento, desempilhe e confira se combina: pilha vazia ou par errado significa desbalanceada. No fim a pilha precisa estar vazia. Ignore qualquer caractere que não seja um dos seis colchetes.
2. **Verificar palíndromo (TODO-01).** Carregue todos os caracteres em um `ArrayDeque<Character>` e compare repetidamente `pollFirst()` com `pollLast()`, até restarem menos de 2 caracteres. É o deque sendo consumido pelas duas pontas ao mesmo tempo.
3. **Inverter (TODO-02).** Empilhe cada caractere em ordem com `push()` e depois `pop()` tudo para a lista de resultado. O último a entrar é o primeiro a sair, e é isso que inverte o texto.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar por que `"([)]"` falha mesmo tendo o mesmo número de aberturas e fechamentos, e por que a pilha e as duas pontas do deque são ferramentas diferentes sobre a mesma classe.

**Desafios opcionais**

- **TODO-03:** implemente `rotateLeft()`, rotacionando o conteúdo do deque recebido para a esquerda em `positions` posições, NO LUGAR: os primeiros elementos vão para o fim, mantendo a ordem relativa. Rotacionar `[1,2,3,4,5]` por 2 dá `[3,4,5,1,2]`. A dica é fazer `pollFirst()` seguido de `offerLast()` do valor, `positions` vezes.

**Pré-requisitos:** sintaxe básica de Java e noções de arrays e `char[]`.

**Como rodar:** clone o repositório, entre em `java-concepts/array-deque` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/array-deque test`). Os métodos pendentes lançam `UnsupportedOperationException("Not implemented yet.")` com um comentário `TODO-NN`, então os testes vermelhos são o seu checklist.

## Documentation Links

- *Java: The Complete Reference*, 12th Edition (Herbert Schildt) — Chapter 20, pp. 594–595 — book
- [ArrayDeque — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html) — doc
- [Deque — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html) — doc
