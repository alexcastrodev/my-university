---
version: 1.0
updatedAt: 2026-08-13
title: Fundamentos de Exception Handling
summary: "O mecanismo estruturado do Java para erros em tempo de execução — try/catch/finally, throw/throws, exceções checked vs. unchecked, subclasses de exceção customizadas, e exceções encadeadas."
---
## Objective

Exception handling é o mecanismo estruturado do Java para lidar com erros em
tempo de execução: em vez de um método retornar um código de erro que todo
chamador precisa lembrar de checar, uma operação que falha cria um objeto de
exceção e o *lança* (throw), transferindo o controle para o código mais
próximo que sabe tratar aquele tipo específico de falha. O mecanismo inteiro
é construído a partir de cinco palavras-chave — `try`, `catch`, `throw`,
`throws` e `finally` — e toda exceção, seja lançada pela própria JVM ou por
código de aplicação, é um objeto que descende de `java.lang.Throwable`.

## Use Cases

- Proteger um bloco de código que pode falhar em tempo de execução (divisão,
  acesso a array, parsing, I/O) em vez de checar manualmente pré-condições
  antes de toda operação arriscada.
- Distinguir condições de falha recuperáveis e esperadas (subclasses
  checked de `Exception`) de bugs de programação que o chamador não deveria
  precisar prever (subclasses unchecked de `RuntimeException`).
- Garantir que código de limpeza (fechar um arquivo, liberar um lock) rode
  seja o código protegido bem-sucedido, falhe, ou retorne antecipadamente,
  via `finally` ou try-with-resources.
- Definir uma subclasse de exceção customizada para sinalizar uma condição
  de falha específica do domínio da sua própria aplicação, em vez de
  sobrecarregar uma exceção genérica embutida.
- Preservar uma causa raiz de baixo nível (ex.: uma falha de I/O) enquanto
  levanta uma exceção de nível mais alto e mais significativa numa fronteira
  de API, via exceções encadeadas.

## Deep Dive

### try/catch e fluxo de controle

Código que pode falhar é envolto num bloco `try`; uma cláusula `catch`
imediatamente depois nomeia o tipo de exceção que sabe tratar:

```java
class Exc2 {
  public static void main(String[] args) {
    int d, a;

    try { // monitor a block of code.
      d = 0;
      a = 42 / d;
      System.out.println("This will not be printed.");
    } catch (ArithmeticException e) { // catch divide-by-zero error
      System.out.println("Division by zero.");
    }

    System.out.println("After catch statement.");
  }
}
```

Saída:

```
Division by zero.
After catch statement.
```

Assim que `42 / d` lança a exceção, o controle salta direto para o `catch`
correspondente — o resto do bloco `try` (o `println` logo depois da divisão)
nunca roda. `catch` não é *chamado* da forma como um método é, então a
execução nunca volta ao ponto do bloco `try` onde a exceção foi lançada; ela
retoma depois da unidade `try`/`catch` inteira. O código monitorado por
`try` precisa ser um bloco (`{ }`) — você não pode anexar `try` a uma única
instrução.

### Múltiplas cláusulas catch e ordenação

Um `try` pode ser seguido por várias cláusulas `catch`, cada uma para um
tipo de exceção diferente; a primeira cujo tipo dá match com a exceção
lançada roda, e as demais são puladas:

```java
catch (ArithmeticException e) {
  System.out.println("Divide by 0: " + e);
} catch (ArrayIndexOutOfBoundsException e) {
  System.out.println("Array index oob: " + e);
}
```

A ordem importa: um `catch` para um supertipo intercepta todo subtipo que,
de outra forma, chegaria a um `catch` mais específico abaixo dele, e o
compilador trata esse `catch` posterior, agora inalcançável, como um erro em
vez de simplesmente ignorá-lo silenciosamente:

```java
class SuperSubCatch {
  public static void main(String[] args) {
    try {
      int a = 0;
      int b = 42 / a;
    } catch (Exception e) {
      System.out.println("Generic Exception catch.");
    }
    // This catch is never reached because
    // ArithmeticException is a subclass of Exception.
    catch (ArithmeticException e) { // ERROR — unreachable
      System.out.println("This is never reached.");
    }
  }
}
```

Isso falha ao compilar com um erro de código inalcançável. Subclasses sempre
devem ser listadas antes de suas superclasses.

### Statements try aninhados

Um `try` pode estar dentro do bloco de outro `try` (diretamente, ou
indiretamente através de uma chamada de método). Se o `try` interno não
tiver um `catch` correspondente, a exceção se propaga para fora, para o
próximo `try` envolvente e seus handlers, e assim por diante, até que um dê
match ou o handler padrão assuma:

```java
class NestTry {
  public static void main(String[] args) {
    try {
      int a = args.length;
      int b = 42 / a; // throws if no args given

      System.out.println("a = " + a);

      try { // nested try block
        if (a == 1) a = a / (a - a);      // divide by zero
        if (a == 2) {
          int[] c = { 1 };
          c[42] = 99;                     // out-of-bounds
        }
      } catch (ArrayIndexOutOfBoundsException e) {
        System.out.println("Array index out-of-bounds: " + e);
      }

    } catch (ArithmeticException e) {
      System.out.println("Divide by 0: " + e);
    }
  }
}
```

Com zero argumentos de linha de comando, o `try` *externo* lança exceção
(dividindo por `args.length`, que é `0`); com um argumento, o `try` interno
lança um divide-by-zero que ele não captura, então é capturado pelo `catch
(ArithmeticException e)` externo; com dois argumentos, o `try` interno lança
uma exceção de out-of-bounds que seu próprio `catch` trata diretamente.

### throw, throws, e a divisão checked/unchecked

`throw` levanta uma exceção explicitamente — seja uma que você acabou de
construir, ou uma que você capturou e quer repassar (relançar):

```java
class ThrowDemo {
  static void demoproc() {
    try {
      throw new NullPointerException("demo");
    } catch (NullPointerException e) {
      System.out.println("Caught inside demoproc.");
      throw e; // rethrow the exception
    }
  }

  public static void main(String[] args) {
    try {
      demoproc();
    } catch (NullPointerException e) {
      System.out.println("Recaught: " + e);
    }
  }
}
```

Todo `Throwable` se encaixa sob um de dois ramos: `Exception`, para
condições que um programa deve capturar e tratar (o ramo que você
subclassifica para suas próprias exceções), e `Error`, para falhas da
JVM/ambiente de execução (como `StackOverflowError`) que código normal não
deve tentar capturar. Dentro de `Exception`, `RuntimeException` e suas
subclasses são **unchecked** — o compilador nunca força você a capturá-las
ou declará-las, porque elas tipicamente sinalizam um bug de programação
(índice de array ruim, dereferência de `null`, divisão por zero). Toda outra
subclasse de `Exception` é **checked**: se um método pode lançá-la e não a
captura, o método precisa declará-la com `throws`, ou o código não compila:

```java
// This program contains an error and will not compile.
class ThrowsDemo {
  static void throwOne() {
    System.out.println("Inside throwOne.");
    throw new IllegalAccessException("demo"); // checked exception, not declared
  }
  public static void main(String[] args) {
    throwOne();
  }
}
```

Declarar a exceção checked em `throwOne()` e tratá-la em `main` corrige
isso:

```java
class ThrowsDemo {
  static void throwOne() throws IllegalAccessException {
    System.out.println("Inside throwOne.");
    throw new IllegalAccessException("demo");
  }
  public static void main(String[] args) {
    try {
      throwOne();
    } catch (IllegalAccessException e) {
      System.out.println("Caught " + e);
    }
  }
}
```

### finally: limpeza garantida

Um bloco `finally` sempre roda depois que seu `try`/`catch` termina,
independentemente de como termina — conclusão normal, uma exceção não
capturada se propagando para fora, ou um `return` explícito:

```java
class FinallyDemo {
  static void procA() { // exception propagates out of the method
    try {
      System.out.println("inside procA");
      throw new RuntimeException("demo");
    } finally {
      System.out.println("procA's finally");
    }
  }

  static void procB() { // return from inside a try block
    try {
      System.out.println("inside procB");
      return;
    } finally {
      System.out.println("procB's finally");
    }
  }

  static void procC() { // try block runs normally, no error
    try {
      System.out.println("inside procC");
    } finally {
      System.out.println("procC's finally");
    }
  }
}
```

Todos os três caminhos de saída rodam seu bloco `finally` antes de
efetivamente sair: o `finally` de `procA` executa a caminho da saída
enquanto a `RuntimeException` se propaga, o de `procB` roda antes que o
`return` de fato devolva o controle ao chamador, e o de `procC` roda mesmo
que nada tenha dado errado. `finally` é opcional, mas todo `try` precisa de
pelo menos um `catch` ou um `finally`.

### Subclasses de exceção customizadas

Definir sua própria exceção é só subclassificar `Exception` (ou uma de suas
subclasses) — não há nada para implementar, o próprio tipo é o que a torna
utilizável em `throw`/`catch`:

```java
class MyException extends Exception {
  private int detail;

  MyException(int a) {
    detail = a;
  }

  public String toString() {
    return "MyException[" + detail + "]";
  }
}

class ExceptionDemo {
  static void compute(int a) throws MyException {
    System.out.println("Called compute(" + a + ")");
    if (a > 10)
      throw new MyException(a);
    System.out.println("Normal exit");
  }

  public static void main(String[] args) {
    try {
      compute(1);
      compute(20);
    } catch (MyException e) {
      System.out.println("Caught " + e);
    }
  }
}
```

`MyException` sobrescreve `toString()` (herdado de `Throwable` através de
`Exception`) para que `println(e)` e concatenação de string imprimam uma
mensagem limpa e sob medida em vez do formato padrão `NomeDaClasse:
mensagem`.

### Exceções encadeadas: preservando a causa raiz

Às vezes a exceção que um método precisa lançar não é a causa raiz de fato
— exceções encadeadas permitem anexar uma causa subjacente à exceção que
você lança, via construtores `Throwable(String, Throwable)` /
`Throwable(Throwable)`, ou `initCause()` quando a causa não foi definida no
momento da construção:

```java
class ChainExcDemo {
  static void demoproc() {
    // create an exception
    NullPointerException e =
      new NullPointerException("top layer");

    // add a cause
    e.initCause(new ArithmeticException("cause"));

    throw e;
  }

  public static void main(String[] args) {
    try {
      demoproc();
    } catch (NullPointerException e) {
      // display top level exception
      System.out.println("Caught: " + e);
      // display cause exception
      System.out.println("Original cause: " + e.getCause());
    }
  }
}
```

`getCause()` retorna `null` se nenhuma causa foi definida, e uma causa só
pode ser anexada uma vez por exceção — uma segunda chamada a `initCause()`
lança `IllegalStateException`, e chamá-la de qualquer forma é desnecessário
(e rejeitado) se a causa já foi fornecida através de um construtor. Cadeias
podem ir arbitrariamente fundo, mas uma cadeia longa demais geralmente é um
sinal de que o empilhamento de camadas é profundo demais para ser útil.

### Adições modernas: multi-catch e try-with-resources (Java 7+)

Tudo acima é essencialmente inalterado desde o Java 1.0. O JDK 7 adicionou
dois recursos que reduzem boilerplate em torno desse mecanismo original.
Multi-catch permite que uma cláusula `catch` trate vários tipos de exceção
não relacionados com um handler compartilhado, separados por `|`:

```java
class MultiCatch {
  public static void main(String[] args) {
    int a = 10, b = 0;
    int[] vals = { 1, 2, 3 };

    try {
      int result = a / b; // generates an ArithmeticException
      // vals[10] = 19;   // would generate an ArrayIndexOutOfBoundsException
    } catch (ArithmeticException | ArrayIndexOutOfBoundsException e) {
      System.out.println("Exception caught: " + e);
    }

    System.out.println("After multi-catch.");
  }
}
```

Cada parâmetro de multi-catch é implicitamente `final`. Try-with-resources
automatiza o fechamento de qualquer coisa que implemente `AutoCloseable`,
substituindo um bloco manual `finally { resource.close(); }`:

```java
try (BufferedReader br = new BufferedReader(new FileReader("test.txt"))) {
  String line = br.readLine();
  System.out.println(line);
} catch (IOException e) {
  System.out.println("I/O error: " + e);
}
```

`br` é declarado dentro dos parênteses do `try`, e a JVM o fecha
automaticamente quando o bloco termina — normalmente ou via exceção — sem
um `finally` explícito.

## Trade-offs

- **Exceções checked empurram uma decisão para todo chamador** — uma
  exceção checked na cláusula `throws` de um método força todo chamador ao
  longo da cadeia a capturá-la ou redeclará-la, que é exatamente a rede de
  segurança em tempo de compilação que mantém os pontos de chamada honestos
  sobre falhas — mas numa superfície de API grande isso também significa que
  um detalhe de implementação de baixo nível pode se propagar por camadas
  não relacionadas da pilha de chamadas como boilerplate de cláusulas
  `throws` ou blocos `catch` vazios.
- **Capturar de forma ampla (`Exception` ou `Throwable`) troca precisão por
  conveniência** — um único `catch` amplo é menos linhas, mas também
  absorve silenciosamente bugs que o código nunca previu:
  ```java
  try {
      riskyOperation();       // meant to guard an ArithmeticException
  } catch (Exception e) {     // also swallows an unrelated NullPointerException bug
      log("operation failed");
  }
  ```
- **Parâmetros de multi-catch são implicitamente final** — compartilhar um
  handler entre tipos significa que esse handler não pode tratar o
  parâmetro como uma variável local mutável:
  ```java
  catch (IOException | SQLException e) {
      e = null; // error: multi-catch parameter e is implicitly final
  }
  ```
- **try-with-resources evita o mascaramento de exceção que um `close()`
  manual dentro de `finally` pode causar** — se o bloco `try` lança exceção
  e um `close()` manual dentro de `finally` também lança, a exceção
  original é perdida, substituída pela do `close()`; try-with-resources, em
  vez disso, mantém a exceção original e anexa a falha do close como uma
  exceção suprimida, acessível via `getSuppressed()`.
- **Exceções não são uma ferramenta geral de controle de fluxo** — lançar e
  capturar custa mais que um condicional simples (construir um `Throwable`
  captura um stack trace), e usar exceções para rotear resultados comuns e
  esperados torna a lógica mais difícil de acompanhar do que um
  `if`/`return` seria; reserve-as para condições genuinamente excepcionais.

## Documentation Links

- [Exception (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html) — doc
- [Throwable (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html) — doc
- [The try-with-resources Statement — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html) — doc
- [Chapter 11. Exceptions — The Java Language Specification](https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html) — doc
