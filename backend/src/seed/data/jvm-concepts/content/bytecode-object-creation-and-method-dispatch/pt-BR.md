---
version: 1.0
updatedAt: 2026-08-19
title: "Bytecode: Criação de Objetos, Acesso a Campos e Despacho de Métodos"
summary: "Por que 'new' é alocar-e-depois-construir como duas instruções separadas, como o acesso a campos e arrays se divide em famílias distintas de opcodes, e por que o JVM tem cinco instruções invoke* diferentes em vez de uma — incluindo por que o javac moderno não emite mais invokespecial para chamadas de método privado."
---
## Objective

Entender as instruções de bytecode por trás de tudo que é orientado a objetos em Java: como `new` na verdade aloca e constrói um objeto como dois passos separados, como o acesso a campos se divide em quatro opcodes dependendo de instância vs. static, como arrays ganham sua própria família de instruções em vez de reaproveitar acesso a campos, e — o mais importante — por que o JVM tem **cinco** instruções diferentes de "chamar um método" em vez de uma, cada uma codificando uma estratégia diferente de resolução de método no nível do bytecode.

## Use Cases

- Ler a saída de `javap -c` para ver que `new Foo(...)` é `new` + `dup` + `invokespecial`, três instruções, não um opcode atômico único de "construir".
- Explicar por que `getfield`/`putfield` precisam de uma referência de objeto na stack, mas `getstatic`/`putstatic` não.
- Diagnosticar por que uma chamada que você esperava ser virtual aparece como `invokestatic` ou `invokeinterface` num disassembly, e o que isso implica sobre como ela é despachada.
- Entender por que `instanceof` é seguro para usar especulativamente enquanto `checkcast` pode lançar exceção — e por que o compilador insere um `checkcast` depois de toda chamada `get()` de coleção genérica.

## Deep Dive

### Criação de objetos: new, dup e invokespecial

`new` só **aloca** memória e empilha uma referência não inicializada — ele não chama o construtor. O compilador sempre o segue com `dup` (para que uma cópia da referência sobreviva à chamada do construtor para uso posterior) e um `invokespecial` mirando `<init>`:

```java
Person person = new Person("John");
```

```
0: new           #8     // class Person — allocate, push uninitialized reference
3: dup                   // duplicate it: one copy for <init>, one to keep
4: ldc           #13     // String John
6: invokespecial #15     // Method "<init>":(Ljava/lang/String;)V — consumes one copy
9: astore_1               // the surviving copy is stored into 'person'
```

O bytecode verifier garante que uma referência alocada por `new` não pode ser usada — passada como argumento, armazenada num campo, retornada — até que `invokespecial <init>` tenha sido chamado nela. Um objeto literalmente não pode existir num estado utilizável antes de seu construtor rodar, e essa garantia é checada no momento de carregamento da classe, não em runtime.

### Acesso a campos: instância vs. static

Acesso a campos de instância e static são quatro opcodes distintos, não um opcode com uma flag — porque acesso de instância precisa de uma referência de objeto na stack e acesso static não:

```java
private String name;

public String getName() { return name; }
public void setName(String newName) { this.name = newName; }
```

```
public java.lang.String getName();
    aload_0
    getfield      #7     // Field name:Ljava/lang/String; — needs 'this' on the stack
    areturn

public void setName(java.lang.String);
    aload_0
    aload_1
    putfield      #7     // consumes both 'this' and the new value
    return
```

`getstatic`/`putstatic` pulam completamente o `aload_0` — um campo static pertence à classe, não a nenhuma instância em particular, então não há nada para empilhar antes da referência ao campo.

### Arrays: criação, acesso e length

Arrays ganham sua própria família de instruções em vez de reaproveitar `getfield`/`putfield`, e a *criação* de arrays se divide pelo tipo do elemento — primitivos usam `newarray` com uma tag de tipo, referências a objeto usam `anewarray` com uma referência de classe, e arrays multidimensionais usam `multianewarray`:

```java
int[] nums = new int[3];
nums[0] = 42;
int len = nums.length;

String[] names = new String[2];
names[0] = "a";
```

```
iconst_3
newarray       int        // primitive array: element type is a tag, not a class reference
astore_1
aload_1
iconst_0
bipush        42
iastore                    // store into a primitive int array

aload_1
arraylength                // pushes the array's length — arrays don't expose it as a field
istore_2

iconst_2
anewarray     #7           // class java/lang/String — reference array: element type is a class
astore_3
aload_3
iconst_0
ldc           #9           // String a
aastore                    // store into a reference array
```

Todo tipo primitivo tem seu próprio par store/load (`bastore`/`baload` para byte *e* boolean, `castore`/`caload` para char, `sastore`/`saload` para short, `iastore`/`iaload` para int, `lastore`/`laload` para long, `fastore`/`faload`/`dastore`/`daload` para float/double), enquanto todo tipo de referência — independente de qual classe — compartilha o único par `aastore`/`aaload`, já que um array de referências só armazena ponteiros de tamanho uniforme.

### instanceof vs. checkcast

Ambas as instruções checam o tipo em runtime de um objeto contra uma referência de classe, mas respondem de forma diferente a um mismatch — `instanceof` empilha `0` e deixa a execução continuar, `checkcast` lança `ClassCastException`:

```java
Object o = names;
if (o instanceof String[]) {
    String[] cast = (String[]) o;
    ...
}
```

```
aload         4
instanceof    #11    // class "[Ljava/lang/String;" — pushes 1 or 0, never throws
ifeq          51
aload         4
checkcast     #11    // same class check — throws ClassCastException instead of pushing 0
astore        5
```

É por isso que `instanceof` é a forma segura de *sondar* um tipo antes de se comprometer com ele, enquanto um cast explícito só é seguro quando você já sabe — a partir de um check `instanceof`, de generics, ou de um contrato documentado — que ele vai funcionar.

### Despacho de métodos: cinco instruções, cinco estratégias de resolução

O JVM não tem uma única instrução genérica de "chamar método" — tem cinco, e o compilador escolhe entre elas com base no que é estaticamente conhecido sobre o target, não apenas na aparência da chamada no source:

```java
interface Greeter { String greet(); }

public class Dispatch implements Greeter {
    public String greet() { return helper(); }
    private String helper() { return "hi"; }
    public static void call(Greeter g) { System.out.println(g.greet()); }
    public static void main(String[] args) { call(new Dispatch()); }
}
```

```
public java.lang.String greet();
    aload_0
    invokevirtual #7     // Method helper:()Ljava/lang/String; — private, called on modern javac (11+)
    areturn

public static void call(Greeter);
    ...
    invokeinterface #21,  1   // InterfaceMethod Greeter.greet — target type is the interface, not a class
    ...

public static void main(java.lang.String[]);
    new           #8
    dup
    invokespecial #32    // Method "<init>":()V — constructor, never virtual
    invokestatic  #33    // Method call — no receiver at all
```

| instrução | usada para | despacho |
|---|---|---|
| `invokestatic` | métodos static | resolvido em tempo de compilação — sem receiver, sem polimorfismo |
| `invokespecial` | construtores (`<init>`) e chamadas explícitas `super.method()` | resolvido em tempo de compilação pelo tipo declarado, não sobrescrito em runtime |
| `invokevirtual` | métodos de instância chamados numa referência com tipo de classe | resolvido em runtime pela classe real do receiver (despacho virtual) |
| `invokeinterface` | métodos de instância chamados numa referência com tipo de interface | resolvido em runtime; carrega uma contagem explícita de argumentos já que o JVM não pode assumir um layout de vtable fixo entre implementadores não relacionados |
| `invokedynamic` | call sites resolvidos por um bootstrap method em vez do constant pool (lambdas, concatenação de strings desde o JEP 280, construção estilo `String.join` baseada em `invokedynamic`) | resolvido uma vez, de forma lazy, na primeira execução, depois cacheado no call site |

Um detalhe que vale a pena corrigir contra material mais antigo: chamar um método de instância `private` de dentro da mesma classe **não é** `invokespecial` no `javac` atual — compila para `invokevirtual`, como mostrado em `greet()` acima. Desde nestmates (JDK 11), um método `private` só pode ser invocado de dentro do seu nest, mas nada impede o JVM de resolvê-lo virtualmente, então o `javac` parou de tratá-lo como caso especial. `invokespecial` hoje significa especificamente "construtor, ou uma chamada `super` explícita" — ambos os casos onde despacho virtual estaria ativamente errado.

## Trade-offs

- **`new` + `invokespecial` como dois passos, não um** — isso permite ao verifier rejeitar qualquer uso de uma referência de objeto antes de seu construtor ter rodado, ao custo de toda construção de objeto ser uma sequência de 3+ instruções em vez de um único opcode atômico.
- **`invokeinterface` carrega uma contagem explícita de argumentos que as outras instruções `invoke*` não carregam** — porque uma referência de interface poderia ser implementada por qualquer classe não relacionada sem layout de vtable compartilhado, o JVM precisa dessa contagem para buscar a method table do target no call site, o que é parte do motivo pelo qual chamadas de interface eram historicamente mais lentas que `invokevirtual` antes que o inline caching do JIT fechasse essa diferença.
- **`checkcast` falha alto, `instanceof` falha em silêncio** — um `checkcast` malsucedido lança imediatamente no local do cast, então um cast ruim aparece como um stack trace apontando exatamente onde a suposição quebrou, enquanto confiar só em `instanceof` simplesmente pula o branch sem nenhum diagnóstico.

```java
Object o = "not an array";
String[] arr = (String[]) o;   // checkcast throws java.lang.ClassCastException here, at this line
```

- **`invokestatic` e `invokespecial` são o que torna uma chamada não sobrescrevível** — um método `static` ou uma chamada `private`/construtor resolvida por um desses opcodes é vinculada em tempo de compilação pelo tipo declarado, o que é exatamente por que métodos `static` não podem ser polimórficos e por que chamar um método aparentemente sobrescrevível de dentro de um construtor (via `invokevirtual` em `this`) pode observar os campos de uma subclasse antes deles serem inicializados.

## Documentation Links

- [Chapter 6: The Java Virtual Machine Instruction Set — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [Mastering the Java Virtual Machine — Chapter 3 source code (Packt Publishing)](https://github.com/PacktPublishing/Mastering-the-Java-Virtual-Machine/tree/main/chapter-03) — doc
