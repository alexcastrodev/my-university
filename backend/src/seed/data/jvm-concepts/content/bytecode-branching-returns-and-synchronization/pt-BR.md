---
version: 1.1
updatedAt: 2026-08-19
title: "Bytecode: Branching, Returns e Synchronization"
summary: "Como branches condicionais sempre compilam para o inverso da condição do source, por que == em objetos é if_acmpeq (identidade, nunca equals()), por que um switch compila para tableswitch ou lookupswitch dependendo da densidade dos labels, por que return é seis instruções específicas de tipo em vez de uma, e por que um bloco synchronized custa uma exception table gerada pelo compilador que um método synchronized nunca precisa."
---
## Objective

Entender as instruções de bytecode que controlam o fluxo de execução em vez de computar valores: os branches condicionais que implementam `if`/`while`/`for` (incluindo comparações de identidade de referência), as duas instruções diferentes para as quais um `switch` pode compilar, as instruções específicas de tipo que retornam de um método, e como `synchronized` compila para dois mecanismos completamente diferentes dependendo de ser um modificador de método ou um bloco — incluindo o maquinário de tratamento de exceção que o compilador insere silenciosamente para tornar um bloco `synchronized` exception-safe.

## Use Cases

- Ler a saída de `javap -c` para rastrear qual branch um `if`/`else` compilado realmente toma, e casar jump targets (`ifne 6`, `goto 27`) de volta às linhas do source.
- Explicar por que `==` em dois objetos nunca chama `equals()` — é `if_acmpeq`/`if_acmpne`, uma comparação de identidade, do início ao fim no nível do bytecode.
- Reconhecer se um `switch` compilou para `tableswitch` (labels de case densos, jump table O(1)) ou `lookupswitch` (labels esparsos, busca binária O(log n)) ao ler um disassembly.
- Explicar por que o `return` de um método sempre compila para um opcode específico do tipo, e por que um mismatch (por exemplo, `ireturn` num método declarado para retornar `long`) é rejeitado pelo bytecode verifier, não só um erro em runtime.
- Entender por que um **bloco** `synchronized` sempre compila para mais instruções que um **método** `synchronized`, e por que o bytecode desse bloco contém um exception handler que você nunca escreveu no source.
- Reconhecer `athrow` num disassembly como a única instrução para a qual todo `throw` — checked ou unchecked, seu ou uma `NullPointerException` do próprio JVM — compila.

## Deep Dive

### Branches condicionais: comparar contra zero vs. comparar dois valores

O JVM tem duas famílias de jump condicional. Uma compara um único valor contra zero (`ifeq`, `ifne`, `iflt`, `ifle`, `ifgt`, `ifge`, mais `ifnull`/`ifnonnull` para referências); a outra compara dois valores diretamente da stack (`if_icmpeq`, `if_icmpne`, `if_icmplt`, `if_icmple`, `if_icmpgt`, `if_icmpge` para `int`, e `if_acmpeq`/`if_acmpne` para referências). As duas existem para que o compilador nunca precise sintetizar um zero para comparar quando já tem dois valores vivos na stack:

```java
static int classify(int x) {
    if (x == 0) return 0;
    if (x > 0) return 1;
    return -1;
}

static boolean sameOrder(int a, int b) {
    return a < b;
}
```

```
static int classify(int);
    iload_0
    ifne          6      // x == 0 reduces to a single zero-comparison
    iconst_0
    ireturn
    iload_0
    ifle          12     // x > 0 is still a zero-comparison, just a different one
    iconst_1
    ireturn
    iconst_m1
    ireturn

static boolean sameOrder(int, int);
    iload_0
    iload_1
    if_icmpge     9       // a < b compares two live stack values directly, no zero involved
    iconst_1
    goto          10
    iconst_0
    ireturn
```

Todo operador de comparação é compilado para seu branch *inverso* — `x == 0` vira `ifne` (pula quando **não** igual), `a < b` vira `if_icmpge` (pula quando **não** menor) — porque um branch-na-condição-inversa deixa o caminho "verdadeiro" passar direto sem um `goto`, e só o caminho "falso" precisa de um jump explícito.

`ifnull`/`ifnonnull` seguem a mesma família de comparação-com-zero para referências — uma referência `null` é representada da mesma forma que um `int` zero no nível do bytecode, e é por isso que `s == null` compila de forma idêntica em formato a `x == 0`:

```
static boolean isNull(java.lang.String);
    aload_0
    ifnonnull     8
    iconst_1
    goto          9
    iconst_0
    ireturn
```

`if_acmpeq`/`if_acmpne` são a contraparte de referência da família de dois valores para `if_icmpeq`/`if_icmpne` — elas comparam **identidade**, não conteúdo, que é exatamente por que `==` em dois objetos significa "mesma referência" no nível do bytecode, independentemente do que `equals()` diria:

```java
static boolean refEquals(Object a, Object b) { return a == b; }
```

```
static boolean refEquals(java.lang.Object, java.lang.Object);
    aload_0
    aload_1
    if_acmpne     9      // a == b compiles to "jump away if references differ"
    iconst_1
    goto          10
    iconst_0
    ireturn
```

Não existe equivalente de `if_acmpeq`/`if_acmpne` que chame `.equals()` — comparação de conteúdo é sempre uma chamada `invokevirtual` explícita que o código-fonte tem que escrever, nunca algo que o operador `==` dispara por conta própria para tipos de referência.

### Branching multi-way: tableswitch vs. lookupswitch

Um `switch` em `int` (ou um tipo que reduz para `int` — `char`, `byte`, `short`, ou o ordinal de um `enum`) compila para uma de duas instruções dedicadas, escolhida pelo compilador com base em como os labels de case estão distribuídos, não por nada visível na sintaxe do source:

```java
static int denseSwitch(int x) {
    switch (x) {
        case 0: return 10;
        case 1: return 20;
        case 2: return 30;
        default: return -1;
    }
}

static int sparseSwitch(int x) {
    switch (x) {
        case 1: return 1;
        case 100: return 2;
        case 10000: return 3;
        default: return -1;
    }
}
```

```
static int denseSwitch(int);
    iload_0
    tableswitch   { // 0 to 2
                0: 28
                1: 31
                2: 34
          default: 37
    }
    ...

static int sparseSwitch(int);
    iload_0
    lookupswitch  { // 3
                1: 36
              100: 38
            10000: 40
          default: 42
    }
    ...
```

`tableswitch` é uma jump table indexada diretamente — é O(1): o próprio valor do case é o offset num array contíguo de branch targets, o que é exatamente por que só funciona quando os labels são densos o bastante para que construir esse array não seja um desperdício. `lookupswitch` armazena pares explícitos (valor, target) ordenados por valor e o JVM faz busca binária neles — O(log n), mas sem entradas de tabela desperdiçadas para os vãos entre `1`, `100` e `10000`. O compilador escolhe o que custa menos espaço para a distribuição real dos labels; ambos compilam a mesma construção do source, então nada sobre qual você recebe está sob controle do programador.

### Instruções de return específicas por tipo

Assim como a aritmética, `return` não é uma instrução — são seis, uma por categoria de valor, e um método `void` usa uma sétima que não retorna nenhum valor:

```
ireturn   // int, boolean, byte, short, char
lreturn   // long
freturn   // float
dreturn   // double
areturn   // object reference
return    // void — no value on the stack to return
```

O verifier checa o tipo do valor retornado contra o descriptor de retorno declarado do método no momento de carregamento da classe — um método compilado (por bytecode montado à mão, já que o `javac` nunca geraria isso) com `ireturn` onde o descriptor diz `J` (long) é rejeitado antes mesmo do método poder rodar, da mesma forma que um arquivo `.class` com o magic number errado é rejeitado antes de suas instruções serem lidas.

### synchronized: uma flag de método vs. um par explícito de monitor

Um **método** `synchronized` não adiciona nenhuma instrução de bytecode ao corpo do método — ele define a access flag `ACC_SYNCHRONIZED`, e o JVM adquire o monitor como parte da invocação do método:

```java
public synchronized void incSynchronizedMethod() {
    count++;
}
```

```
public synchronized void incSynchronizedMethod();
    flags: (0x0021) ACC_PUBLIC, ACC_SYNCHRONIZED
    Code:
      ...            // ordinary field-increment bytecode — no monitorenter/monitorexit here
```

Um **bloco** `synchronized`, em contraste, não tem access flag para se apoiar — o escopo do monitor é arbitrário, decidido no nível do source — então o compilador emite instruções explícitas `monitorenter`/`monitorexit` ao redor dele:

```java
public void incSynchronizedBlock() {
    synchronized (lock) {
        count++;
    }
}
```

```
public void incSynchronizedBlock();
    Code:
       0: aload_0
       1: getfield      #7          // Field lock:Ljava/lang/Object;
       4: dup
       5: astore_1
       6: monitorenter               // acquire the lock
       7: aload_0
       8: dup
       9: getfield      #13          // Field count:I
      12: iconst_1
      13: iadd
      14: putfield      #13
      17: aload_1
      18: monitorexit                // release the lock — normal exit
      19: goto          27
      22: astore_2
      23: aload_1
      24: monitorexit                // release the lock — exceptional exit
      25: aload_2
      26: athrow
      27: return
    Exception table:
       from    to  target type
           7    19    22   any
          22    25    22   any
```

Essa exception table — que nunca aparece no source — é o que torna um bloco `synchronized` exception-safe: o compilador gera uma **segunda cópia** de `monitorexit`, coberta por um handler catch-all sobre todo o corpo do bloco, especificamente para que um lock adquirido por `monitorenter` ainda seja liberado por `monitorexit` se `count++` (ou qualquer coisa dentro do bloco) lançar uma exceção. Não há nenhum `try`/`finally` escrito no nível do source aqui — o compilador insere o equivalente de um automaticamente, puramente porque um lock com escopo de bloco não tem outra forma de garantir liberação em todo caminho de saída.

### athrow

Todo `throw` em Java — exceção checked, unchecked, ou uma `NullPointerException` que o próprio JVM levanta para uma desreferência inválida — compila para a única instrução `athrow`, que desempilha uma referência `Throwable` da stack e transfere o controle para o handler correspondente mais próximo na exception table do método (ou desenrola o frame se não houver nenhum):

```java
public void fail() {
    throw new IllegalStateException("bad state");
}
```

```
public void fail();
    Code:
       0: new           #17    // class java/lang/IllegalStateException
       3: dup
       4: ldc           #19    // String bad state
       6: invokespecial #21    // Method IllegalStateException."<init>":(Ljava/lang/String;)V
       9: athrow
```

Construir a exceção é apenas a já familiar sequência de criação de objeto `new`/`dup`/`invokespecial` — o `athrow` em si não faz nada além de entregar o objeto já construído para o maquinário de despacho de exceção do JVM.

## Trade-offs

- **Todo branch é compilado invertido** — o compilador sempre emite o oposto da condição do source (`==` vira `ifne`, `<` vira `if_icmpge`) para que o caminho "verdadeiro" comum passe direto sem um jump; isso torna a leitura manual de condicionais desmontados contraintuitiva até você internalizar que o branch target é sempre o caminho *else*, não o *then*.
- **Um método `synchronized` não paga nada extra em bytecode, um bloco `synchronized` paga pela própria segurança contra exceções** — a forma de método é um único bit de access flag que o JVM trata no momento da invocação, enquanto a forma de bloco custa um `monitorexit` duplicado e uma exception table gerada pelo compilador, porque o JVM não tem um equivalente de "libere esse monitor quando essa região arbitrária de código sair, de qualquer forma que ela saia" sem esse maquinário explícito.

```java
synchronized (lock) {
    doSomethingThatThrows();   // monitorexit still runs — the compiler's exception table guarantees it
}
```

- **O verifier exige um `Throwable` em `athrow`, não nenhum tipo de exceção em particular** — qualquer objeto atribuível a `java.lang.Throwable` pode ser lançado, o que é por que o `athrow` sozinho não consegue distinguir uma exceção checked de uma unchecked; essa distinção é um conceito de nível `javac`, não de nível bytecode — o compilador checa cláusulas `throws` em tempo de compilação, mas nada no arquivo `.class` reverifica isso em runtime.
- **`jsr`/`ret` são documentadas na JVMS mas nenhum `javac` desde o Java 6 as emite, e nenhum JVM desde a versão 51 de class file (Java 7) sequer as carrega** — material mais antigo (e ferramentas antigas de manipulação de bytecode) ainda as descrevem como o mecanismo para o qual blocos `finally` costumavam compilar: uma chamada de subrotina (`jsr`) que empilhava um endereço de retorno para o `ret` pular de volta, deixando uma única cópia do corpo do `finally` servir todo caminho de saída. O `javac` passou a duplicar o corpo do `finally` inline em cada saída em vez disso, e a especificação agora proíbe `jsr`/`ret` completamente — um class file mirando um release moderno que ainda as contivesse falharia na verificação, não rodaria com performance reduzida. `goto_w` (a contraparte de offset de 32 bits do `goto`) não é afetada por isso e continua legal, mas só é emitida para um corpo de método grande o bastante para que um offset de branch de 16 bits não alcance o target — efetivamente nunca, fora de código gerado.

## Documentation Links

- [Chapter 6: The Java Virtual Machine Instruction Set — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [Mastering the Java Virtual Machine — Chapter 3 source code (Packt Publishing)](https://github.com/PacktPublishing/Mastering-the-Java-Virtual-Machine/tree/main/chapter-03) — doc
