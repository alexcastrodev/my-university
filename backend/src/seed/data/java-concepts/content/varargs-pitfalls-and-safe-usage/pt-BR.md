---
version: 1.0
updatedAt: 2026-08-13
title: "Varargs: Custo de Performance e Heap Pollution com Generics"
summary: "Varargs alocam implicitamente um array em toda chamada e, combinados com generics, podem deixar um ClassCastException escapar do compilador — o motivo, e o que @SafeVarargs de fato promete."
---
## Objective

Um parâmetro varargs (`T... args`) permite que um método aceite zero ou mais argumentos de um tipo sem que o chamador construa um array explicitamente — mas o compilador constrói esse array de qualquer forma, em toda chamada, e quando `T` é um parâmetro de tipo genérico essa criação implícita de array é exatamente o tipo de operação que generics foram projetados para tornar impossível de errar. Saber para o que varargs se desaçucara explica tanto seu custo de performance em hot paths quanto os `ClassCastException`s em runtime que ele pode produzir quando combinado com generics.

## Use Cases

- APIs com uma lista de argumentos genuinamente de tamanho variável, onde a quantidade não é conhecida até o ponto de chamada — `String.format(fmt, Object... args)`, `Files.createDirectories(Path, FileAttribute<?>... attrs)`, invocação via reflection.
- Métodos fábrica de conveniência que reúnem argumentos em uma coleção — `List.of(E... elements)`, `Set.of(E... elements)`.
- Métodos em que pelo menos um argumento é obrigatório — declarados como um parâmetro fixo mais uma cauda varargs, de modo que uma chamada sem argumentos é um erro de compilação em vez de um `IllegalArgumentException` em runtime.

## Deep Dive

### Como varargs se desaçucara para um array

`args` dentro do corpo do método é um array comum — o `...` é puro açúcar sintático no ponto de chamada. O compilador reescreve toda chamada para construir esse array primeiro:

```java
static int sum(int... args) {
    int total = 0;
    for (int arg : args) total += arg;
    return total;
}

sum(1, 2, 3);
// compiles roughly to:
sum(new int[] { 1, 2, 3 });
```

`sum()` sem nenhum argumento é legal e passa um array de tamanho zero — `args.length == 0`, não `null`. Isso torna um `T...` irrestrito uma escolha ruim para "pelo menos um argumento é obrigatório": verificar `args.length == 0` e lançar em runtime funciona, mas transforma um erro do chamador em uma falha em runtime em vez de um erro de compilação. Declarar um parâmetro fixo à frente mais uma cauda varargs corrige isso sem custo essencialmente nenhum:

```java
// zero-argument call is now a compile error, not a runtime IllegalArgumentException
static int min(int first, int... rest) {
    int min = first;
    for (int r : rest) if (r < min) min = r;
    return min;
}
```

### A mitigação de performance: sobrecarregar para o caso comum

Toda chamada a um método varargs aloca e inicializa um array — inclusive uma chamada com um número fixo e pequeno de argumentos que poderiam ter sido passados como parâmetros comuns. Em um hot path essa alocação é puro overhead. A mitigação padrão é sobrecarregar os casos comuns de baixa aridade como métodos de parâmetros fixos e reservar a forma varargs para a chamada rara com N grande:

```java
public void foo() { }
public void foo(int a1) { }
public void foo(int a1, int a2) { }
public void foo(int a1, int a2, int a3) { }
public void foo(int a1, int a2, int a3, int... rest) { }
```

Se a esmagadora maioria das chamadas passa três ou menos argumentos, só as chamadas restantes pagam por uma alocação de array — o resto resolve para uma sobrecarga comum, sem array nenhum. As factories estáticas de `EnumSet` (`EnumSet.of(E)`, `EnumSet.of(E, E)`, ... até cinco sobrecargas de aridade explícita, e depois `EnumSet.of(E first, E... rest)`) usam exatamente esse padrão, porque `EnumSet` é pensado para ser um substituto competitivo em performance para constantes de bit-field e não pode se dar ao luxo de uma alocação de array em toda chamada.

### Varargs genéricos e heap pollution

`generics.md` cobre erasure por completo — a versão curta necessária aqui é que `List<String>` e `List<Integer>` sofrem erasure para o mesmo tipo em runtime, `List`. Um parâmetro varargs tipado como `List<String>... lists` é, por baixo, um `List[]` — um array de `List` raw, porque não existe algo como `List<String>[]` no nível de bytecode. Arrays, ao contrário de coleções genéricas, são *reificáveis*: eles conhecem e impõem seu tipo de elemento em runtime. Combinar um array (verificado em runtime) cujo tipo de elemento foi ele mesmo apagado (só em tempo de compilação) é exatamente a combinação que permite que uma chamada com varargs genérico deixe passar um objeto incompatível sem o compilador detectar — uma categoria de bug que a linguagem chama de **heap pollution**, em que uma variável de um tipo parametrizado acaba se referindo a um objeto que não é daquele tipo.

```java
// compiles with an "unchecked generics array creation" warning
static void dangerous(List<String>... stringLists) {
    List<Integer> intList = List.of(42);
    Object[] objects = stringLists;   // List<String>[] is-a Object[] — legal, arrays are covariant
    objects[0] = intList;             // heap pollution: objects[0] now really holds a List<Integer>
    String s = stringLists[0].get(0); // compiles fine — get() returns "String" per erasure...
    // ...but throws ClassCastException at runtime: the actual object is a List<Integer>
}
```

O `ClassCastException` não aparece em `objects[0] = intList` — essa linha compila e roda sem reclamar, porque arrays são covariantes e o erasure já apagou o tipo de elemento de `stringLists` para `List` raw no momento em que a JVM verifica a gravação no array. Ele aparece depois, em `stringLists[0].get(0)`, longe de onde o erro de fato foi cometido — o mesmo problema de "falha no ponto de chamada errado" que torna bugs de heap pollution difíceis de rastrear.

É também por isso que uma assinatura de varargs genérico irrestrita é uma das formas de método mais suspeitas da linguagem: `<T> ReturnType m(T... args)` aceita *qualquer* lista de argumentos sem nenhuma verificação em tempo de compilação entre eles, exatamente como `Object...` faria.

### `@SafeVarargs`: o contrato de fato

O compilador não consegue provar que um método varargs genérico nunca faz nada inseguro com seu array, então ele emite um aviso de "unchecked generics array creation" em todo ponto de chamada. `@SafeVarargs`, aplicado à declaração do método, é a afirmação do autor de que o aviso é um falso positivo para aquele método específico — ela não muda o que o método faz, só quais avisos o compilador suprime (tanto para o corpo do método quanto para seus chamadores).

```java
@SafeVarargs
static <T> List<T> listOf(T... elements) {
    return List.of(elements);   // only reads from the array — never stores into it, never leaks the reference
}
```

O contrato: um método só pode carregar `@SafeVarargs` se ele nem armazenar nada no array de varargs nem deixar uma referência a esse array escapar para código não confiável (retorná-lo, atribuí-lo a um campo visível, passá-lo para outro método que possa fazer qualquer uma das duas coisas). O `dangerous` acima continuaria inseguro mesmo com a anotação colada nele — `@SafeVarargs` suprime o aviso, não verifica a afirmação.

De acordo com a JLS e o Javadoc atuais, `@SafeVarargs` fica restrito a declarações que não podem ser sobrescritas — métodos `static`, métodos de instância `final`, métodos de instância `private`, e construtores — porque uma sobrescrita poderia reintroduzir comportamento inseguro por baixo de um chamador que confia na anotação da declaração base. Aplicá-la a um método varargs que não é `final`, não é `private`, não é `static` e não é construtor é um erro de compilação. Note a única mudança em relação aos primeiros releases da linguagem: métodos de instância `private` se tornaram um alvo legal a partir do Java 9 (eles não eram sobrescrevíveis desde o início, mas o compilador só passou a reconhecer isso a partir de então) — antes disso, um método varargs `private` que precisasse da anotação também tinha que ser marcado `final` para se qualificar.

## Trade-offs

- **A conveniência do varargs custa uma alocação de array em toda chamada.** Ok para `String.format` ou um método de configuração raramente chamado; vale medir antes de usar em um laço que roda milhões de vezes.
  ```java
  static int sum(int... args) { /* ... */ }
  sum(1, 2);   // allocates a new int[2] just for this call
  ```
- **Um parâmetro varargs genérico (`T...`) troca segurança de gravação em array em tempo de compilação por conveniência** — o array que o suporta só é verificado como `Object[]`/`List[]` raw no ponto em que é criado, não como `T[]`, então um bug pode compilar limpo e só falhar depois como um `ClassCastException`.
- **`@SafeVarargs` é uma promessa, não uma checagem.** Aplicá-la a um método que de fato armazena ou vaza seu array de varargs silencia o aviso sem remover o bug — trate-a como documentação que o autor supostamente verificou à mão, não como uma garantia imposta pelo compilador.
- **Adaptar uma API existente de parâmetro-array para varargs é uma porta de mão única para sua verificação de tipos.** `Arrays.asList(Object...)` aceita um único `int[]` como um único elemento em vez de rejeitá-lo, porque `int[]` faz autoboxing implícito em um `Object[]` de um elemento, produzindo `[[I@...]` em vez de um erro de compilação — um erro do chamador que antes falhava na compilação agora roda e produz uma saída silenciosamente errada.
  ```java
  int[] digits = {3, 1, 4, 1, 5};
  System.out.println(Arrays.asList(digits));  // prints something like [[I@1b6d3586], not the elements
  System.out.println(Arrays.toString(digits)); // the correct way: [3, 1, 4, 1, 5]
  ```

## Documentation Links

- [SafeVarargs — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/SafeVarargs.html) — doc
- [Java Language Specification — Chapter 8.4.1, Formal Parameters and Varargs](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.1) — doc
- [Arrays.asList — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#asList(T...)) — doc
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
