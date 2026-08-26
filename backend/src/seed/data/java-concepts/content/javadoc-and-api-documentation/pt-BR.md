---
version: 1.0
updatedAt: 2026-08-14
title: Escrevendo Doc Comments para Elementos de API Exportados
summary: Como escrever doc comments (comentários de documentação) eficazes do Javadoc — contratos, tags, descrições resumo e herança — para toda classe, método e campo exportados.
---
## Objective

Para que uma API seja utilizável, ela precisa ser documentada. A ferramenta Javadoc gera documentação de API automaticamente a partir do código-fonte com comentários de documentação especialmente formatados, mais conhecidos como doc comments. Para documentar uma API adequadamente, toda classe, interface, construtor, método e campo exportados devem ser precedidos por um doc comment. Na ausência de um doc comment, o melhor que o Javadoc consegue fazer é reproduzir a própria declaração como única documentação daquele elemento — o que é frustrante e propenso a erros para quem tiver que usar a API. Para código de fácil manutenção, também vale a pena escrever doc comments para a maioria das classes, interfaces, construtores, métodos e campos não exportados.

## Use Cases

- Descrever o contrato de um método para seus clientes: pré-condições, pós-condições e efeitos colaterais.
- Documentar todo parâmetro, valor de retorno e exceção que um método pode lançar.
- Escrever a descrição resumo de uma linha que identifica um elemento de API na documentação gerada e nos tooltips da IDE.
- Documentar parâmetros de tipo em classes e métodos genéricos.
- Documentar constantes de enum e membros de tipos de anotação.
- Reutilizar um doc comment de um supertipo ou interface em vez de duplicá-lo.
- Escrever documentação em nível de pacote.

## Deep Dive

### O contrato de um método: @param, @return, @throws

O doc comment de um método deve descrever sucintamente o contrato entre o método e seu cliente — o que o método faz, não como ele faz (exceto para métodos em classes projetadas para herança). Ele deve enumerar as pré-condições do método (o que precisa ser verdade para um cliente poder invocá-lo) e pós-condições (o que será verdade depois que a invocação for concluída com sucesso). Pré-condições são tipicamente descritas implicitamente por tags `@throws` para exceções não verificadas — cada exceção não verificada corresponde a uma violação de pré-condição — e também podem ser especificadas junto com os parâmetros afetados em suas tags `@param`. Métodos também devem documentar quaisquer efeitos colaterais: uma mudança observável no estado do sistema que não é obviamente necessária para atingir a pós-condição (por exemplo, se um método inicia uma thread em background, a documentação deveria dizer isso).

Para descrever completamente o contrato de um método, o doc comment deve ter uma tag `@param` para cada parâmetro, uma tag `@return` a menos que o método tenha tipo de retorno `void`, e uma tag `@throws` para cada exceção que o método pode lançar, verificada ou não. Por convenção:

- O texto após `@param` ou `@return` deve ser uma frase nominal descrevendo o valor.
- O texto após `@throws` deve ser a palavra "if" seguida de uma oração descrevendo as condições sob as quais a exceção é lançada.
- Nenhuma dessas frases ou orações termina com ponto final.

```java
/**
 * Returns the element at the specified position in this list.
 *
 * <p>This method is <i>not</i> guaranteed to run in constant
 * time. In some implementations it may run in time proportional
 * to the element position.
 *
 * @param index index of element to return; must be
 *         non-negative and less than the size of this list
 * @return the element at the specified position in this list
 * @throws IndexOutOfBoundsException if the index is out of range
 *         ({@code index < 0 || index >= this.size()})
 */
E get(int index);
```

Repare nas tags HTML `<p>` e `<i>` — o Javadoc traduz doc comments para HTML, e elementos HTML arbitrários dentro de um doc comment acabam no documento HTML gerado. Repare também na palavra "this" no doc comment: por convenção, "this" sempre se refere ao objeto sobre o qual o método é invocado, quando usado no doc comment de um método de instância.

### {@code} e {@literal}

A tag `{@code}` em torno do fragmento de código na cláusula `@throws` acima serve a dois propósitos: renderiza o fragmento em fonte de código, e suprime o processamento de marcação HTML e tags Javadoc aninhadas dentro dele. Essa segunda propriedade é o que permite que o sinal de menor-que (`<`) apareça no fragmento mesmo que `<` seja um metacaractere HTML — `{@code}` elimina a necessidade de escapar metacaracteres HTML, então as tags HTML mais antigas `<code>` ou `<tt>` não são mais necessárias em doc comments. Para incluir um exemplo de código de múltiplas linhas, envolva uma tag `{@code}` dentro de uma tag HTML `<pre>`: preceda o exemplo com `<pre>{@code` e o siga com `}</pre>`.

A documentação gerada ainda precisa de tratamento especial para metacaracteres HTML como `<`, `>` e `&` que *não* estejam envolvidos em `{@code}`. A forma de colocar esses caracteres na documentação é envolvê-los com a tag `{@literal}`, que — assim como `{@code}` — suprime o processamento de marcação HTML e tags Javadoc aninhadas, exceto que ela não renderiza o texto em fonte de código:

```java
* The triangle inequality is {@literal |x + y| < |x| + |y|}.
```

Isso produz a documentação "The triangle inequality is |x + y| < |x| + |y|." A tag `{@literal}` poderia ter sido colocada só em torno do sinal de menor-que em vez da desigualdade inteira, com a mesma documentação resultante — mas o doc comment ficaria menos legível no código-fonte. Isso ilustra o princípio geral: doc comments devem ser legíveis tanto no código-fonte quanto na documentação gerada; quando os dois não podem ser alcançados simultaneamente, a legibilidade da documentação gerada vence.

### A descrição resumo

A primeira "frase" de um doc comment se torna a descrição resumo do elemento que ele documenta. No exemplo de `get(int index)` acima, a descrição resumo é "Returns the element at the specified position in this list." A descrição resumo precisa se sustentar sozinha — nenhum membro ou construtor de uma classe ou interface deve compartilhar a mesma descrição resumo, o que exige cuidado especial para métodos sobrecarregados (é frequentemente natural, mas inaceitável em doc comments, reutilizar a mesma primeira frase em prosa entre sobrecargas).

Tenha cuidado quando o resumo pretendido contém um ponto final — o resumo termina no primeiro ponto seguido de espaço, tab ou fim de linha (ou na primeira tag de bloco). Um doc comment começando com "A college degree, such as B.S., M.S. or Ph.D." produziria o resumo truncado "A college degree, such as B.S., M.S." porque o ponto em "M.S." é seguido de espaço. A correção é envolver o ponto problemático e o texto ao redor dele em `{@literal}` para que o ponto deixe de ser seguido de espaço em branco no código-fonte:

```java
/**
 * A college degree, such as B.S., {@literal M.S.} or Ph.D.
 * College is a fountain of knowledge where many go to drink.
 */
public class Degree { ... }
```

A descrição resumo raramente deve ser uma frase completa:

- Para métodos e construtores, deve ser uma frase verbal completa (incluindo qualquer objeto) descrevendo a ação realizada — ex.: `ArrayList(int initialCapacity)` — "Constructs an empty list with the specified initial capacity," ou `Collection.size()` — "Returns the number of elements in this collection."
- Para classes, interfaces e campos, deve ser uma frase nominal descrevendo a coisa representada — ex.: `TimerTask` — "A task that can be scheduled for one-time or repeated execution by a Timer," ou `Math.PI` — "The double value that is closer than any other to pi, the ratio of the circumference of a circle to its diameter."

### Generics, enums e anotações

Ao documentar um tipo ou método genérico, documente cada parâmetro de tipo com uma tag `@param <TypeParam>`:

```java
/**
 * An object that maps keys to values. A map cannot contain
 * duplicate keys; each key can map to at most one value.
 *
 * (Remainder omitted)
 *
 * @param <K> the type of keys maintained by this map
 * @param <V> the type of mapped values
 */
public interface Map<K, V> {
    ... // Remainder omitted
}
```

Ao documentar um tipo enum, documente as constantes assim como o tipo e seus métodos públicos. Um doc comment inteiro pode ficar em uma linha se for curto:

```java
/**
 * An instrument section of a symphony orchestra.
 */
public enum OrchestraSection {
    /** Woodwinds, such as flute, clarinet, and oboe. */
    WOODWIND,

    /** Brass instruments, such as french horn and trumpet. */
    BRASS,

    /** Percussion instruments, such as timpani and cymbals */
    PERCUSSION,

    /** Stringed instruments, such as violin and cello. */
    STRING;
}
```

Ao documentar um tipo de anotação, documente quaisquer membros assim como o tipo em si, tratando membros como campos (frases nominais). Para a descrição resumo do tipo, use uma frase verbal dizendo o que significa um elemento de programa carregar aquela anotação:

```java
/**
 * Indicates that the annotated method is a test method that
 * must throw the designated exception to succeed.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ExceptionTest {
    /**
     * The exception that the annotated test method must throw
     * in order to pass. (The test is permitted to throw any
     * subtype of the type described by this class object.)
     */
    Class<? extends Exception> value();
}
```

### Herdando doc comments com {@inheritDoc}

O Javadoc pode "herdar" comentários de métodos. Se um elemento de API não tem doc comment próprio, o Javadoc procura pelo doc comment aplicável mais específico, preferindo interfaces a superclasses. Partes de um doc comment também podem ser herdadas explicitamente com a tag `{@inheritDoc}`, permitindo que uma classe reutilize doc comments das interfaces que implementa em vez de copiá-los. Isso pode reduzir o esforço de manter múltiplos conjuntos de doc comments quase idênticos, mas é complicado de usar e tem algumas limitações.

### Thread safety, serializabilidade e documentação em nível de pacote

Dois aspectos da API exportada de uma classe frequentemente negligenciados são thread safety e serializabilidade. Independentemente de uma classe ser thread-safe ou não, seu doc comment deve documentar seu nível de thread safety. Se uma classe é serializável, seu doc comment deve documentar sua forma serializada. Doc comments em nível de pacote pertencem a um arquivo chamado `package-info.java`; além do doc comment de nível de pacote, `package-info.java` pode (mas não é obrigado a) conter uma declaração de pacote e anotações de pacote.

## Trade-offs

- **Obrigatório, não opcional, para elementos exportados** — sem um doc comment, o Javadoc só consegue reproduzir a declaração crua, o que é frustrante e propenso a erros para quem consome a API. Trate doc comments como obrigatórios para toda classe, interface, construtor, método e campo exportados.
- **Metacaracteres HTML precisam de tratamento explícito** — `<`, `>` e `&` dentro de um doc comment precisam ser escapados ou envolvidos em `{@literal}`/`{@code}`, ou o HTML gerado quebra.
  ```java
  * The triangle inequality is {@literal |x + y| < |x| + |y|}.
  ```
- **A fraseologia de `@param`/`@return`/`@throws` é uma convenção, não algo aplicado pelo compilador** — frases nominais para `@param`/`@return`, uma oração com "if" para `@throws`, sem ponto final. Nada impede um doc comment de quebrar essa convenção, mas é a consistência que torna a documentação gerada previsível de ler.
- **Métodos sobrecarregados não podem compartilhar uma descrição resumo** — é natural em prosa descrever sobrecargas com a mesma primeira frase, mas doc comments exigem que o resumo de cada membro seja distinto, o que exige redação deliberada.
- **`{@inheritDoc}` economiza duplicação mas é complicado** — permite que uma classe reutilize o doc comment de uma interface em vez de copiá-lo, reduzindo o esforço de manutenção de comentários quase idênticos, mas as regras de busca de herança têm limitações e casos extremos reais a se ter cuidado.
- **Legibilidade no código-fonte vs. legibilidade gerada** — um trecho `{@literal}` ou `{@code}` pode ser delimitado de forma estreita, só em torno do caractere problemático, ou de forma ampla, em torno de uma frase inteira; a delimitação mais estreita pode ficar pior de ler no código-fonte. Quando os dois objetivos conflitam, favoreça a legibilidade da documentação gerada.

## Documentation Links

- [javadoc tool guide](https://docs.oracle.com/en/java/javase/25/javadoc/javadoc.html) — doc
- [Java SE 25 API documentation](https://docs.oracle.com/en/java/javase/25/docs/api/index.html) — doc
