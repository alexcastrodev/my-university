---
version: 1.2
updatedAt: 2026-08-19
title: O Formato de Arquivo .class: Header, Constant Pool, Fields e Methods
summary: Como o javac transforma código-fonte Java em um arquivo .class binário estruturado — magic number e versão no header, a tabela de referências simbólicas do constant pool, access flags, como fields e methods são organizados para o JVM carregar e executar, e os códigos de descriptor de uma letra (B/C/D/F/I/J/S/Z, L...;, [) que codificam cada tipo no arquivo.
---
## Objective

Entender o arquivo `.class`: o formato binário que o `javac` produz a partir do código-fonte Java e a única coisa que o JVM efetivamente carrega — uma sequência fixa de seções (magic number, versão, constant pool, access flags, fields, methods, attributes) que permite ao JVM verificar e interpretar uma classe sem nunca ver o código `.java` original.

## Use Cases

- Ler a saída de `javap -v` para entender para o que uma classe realmente foi compilada, em vez de adivinhar pelo código-fonte.
- Diagnosticar `UnsupportedClassVersionError` sabendo o que o número da major version do arquivo `.class` significa e como ele mapeia para uma release do Java.
- Entender por que decompiladores, bibliotecas de manipulação de bytecode (ASM, ByteBuddy) e frameworks que fazem classpath scanning todos começam analisando o mesmo layout fixo.
- Explicar por que os nomes de field ou method de um objeto aparecem em mensagens de erro e stack traces mesmo que o JVM "não entenda Java" — eles ficam armazenados como entradas UTF-8 no constant pool.
- Ler um descriptor bruto como `[[Ljava/lang/String;` ou `(II)I` direto de um stack trace ou disassembly, sem precisar do `javap` para traduzir em português claro.
- Explicar por que `List<String>` e `List<Integer>` são indistinguíveis no nível de bytecode — ambos compilam para o mesmo descriptor apagado (erased).

## Deep Dive

### Do source ao bytecode: o pipeline do compilador

O JVM nunca lê o source `.java`. O `javac` compila para um arquivo `.class`, e é esse arquivo binário — não o código original — que o class loader lê:

```
HelloWorld.java  →  javac  →  HelloWorld.class  →  JVM class loader  →  execução
```

Todo arquivo `.class`, independente de como era o source, é organizado na mesma sequência fixa de seções: magic number, versão, constant pool, access flags, this class / super class, interfaces, fields, methods, attributes.

### Magic Number: identificando um class file válido

Os primeiros 4 bytes de todo arquivo `.class` são uma assinatura fixa, `CAFEBABE`, verificada antes de qualquer outra coisa ser interpretada. Ela é visível em um dump hexadecimal bruto, mas não aparece como uma linha `Magic:` rotulada na saída de `javap -v` nos JDKs atuais — o `javap` verbose relata os metadados do arquivo em disco (data de última modificação, tamanho e um checksum SHA-256 dos bytes), e vai direto para a declaração da classe:

```
$ xxd HelloWorld.class | head -1
00000000: cafe babe 0000 0041 0013 0a00 0200 0307  .......A........
```

```
$ javap -v HelloWorld.class | head -4
Classfile /home/user/HelloWorld.class
  Last modified Aug 19, 2026; size 428 bytes
  SHA-256 checksum 3a1f...e29c
  Compiled from "HelloWorld.java"
```

Se esses primeiros 4 bytes não baterem — um download truncado, um arquivo de texto renomeado para `.class` — o JVM lança `ClassFormatError` antes de tentar ler qualquer outra coisa no arquivo. A linha SHA-256 do `javap` (adicionada via `-sysinfo`, que `-v` implica) é uma conveniência para confirmar a integridade do arquivo — ela não tem papel nenhum no carregamento da classe em si; só as próprias verificações do verifier, começando pelo magic number, decidem se o JVM aceita o arquivo.

### Version: minor e major

Logo após o magic number vêm dois campos de 2 bytes, `minor_version` e `major_version`. `major_version` identifica o formato do bytecode e aumenta a cada release do Java que o introduziu:

| major | Java |
|---|---|
| 52 | Java 8 |
| 55 | Java 11 |
| 61 | Java 17 |
| 65 | Java 21 |

```
$ javap -v HelloWorld.class | grep version
  minor version: 0
  major version: 65
```

O JVM compara esse número com o que ele suporta no momento do carregamento, antes de executar uma única instrução do arquivo.

### Constant Pool: a tabela de referências simbólicas da classe

O **constant pool** é uma tabela com todo nome de classe, assinatura de method, nome de field, string literal e constante numérica que a classe referencia. Nada mais no arquivo armazena esses valores diretamente — todos são referenciados por índice nessa tabela:

```java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

```
$ javap -v HelloWorld.class
Constant pool:
   #1 = Methodref          #6.#15         // java/lang/Object."<init>":()V
   #2 = Fieldref           #16.#17        // java/lang/System.out:Ljava/io/PrintStream;
   #3 = String             #18            // Hello
   #4 = Methodref           #19.#20        // java/io/PrintStream.println:(Ljava/lang/String;)V
   #5 = Class               #21            // HelloWorld
   ...
```

O bytecode de `main` não contém a string `"Hello"` nem o nome da classe `java.io.PrintStream` inline — ele referencia as entradas `#3` e `#2` do constant pool por índice. O pool é um catálogo que outras seções do arquivo apontam, não o programa em si.

### Access Flags

`access_flags` é uma bitmask logo após o constant pool descrevendo a própria classe:

```
$ javap -v HelloWorld.class | grep flags
  flags: (0x0021) ACC_PUBLIC, ACC_SUPER
```

| flag | significado |
|---|---|
| `ACC_PUBLIC` | a classe é public |
| `ACC_FINAL` | a classe não pode ser estendida |
| `ACC_SUPER` | flag histórica que afeta a resolução de `invokespecial` para chamadas de method da superclasse |
| `ACC_INTERFACE` | o arquivo descreve uma interface, não uma classe |
| `ACC_ABSTRACT` | a classe é abstract |
| `ACC_SYNTHETIC` | a classe foi gerada pelo compilador, não escrita diretamente no source |

### Fields: instance vs. static

A entrada de um field (`field_info`) armazena um índice de nome e um índice de descriptor no constant pool, além de suas próprias `access_flags`. Comparar um instance field com um `static` mostra que a única diferença estrutural é essa flag:

```java
public class Counter {
    int value;              // instance field
    static int instances;   // class field
}
```

```
$ javap -p -v Counter.class | grep -A2 'value\|instances'
  int value;
    descriptor: I
    flags: (0x0000)

  static int instances;
    descriptor: I
    flags: (0x0008) ACC_STATIC
```

Um **instance field** ganha seu próprio armazenamento por objeto — cada `Counter` tem seu próprio `value`. Um **static field** fica armazenado uma única vez na classe e é compartilhado por todas as instâncias — é exatamente isso que `ACC_STATIC` diz ao JVM para fazer de forma diferente ao alocar e resolver esse field.

### Methods: parâmetros, tipo de retorno e bytecode

A entrada de um method armazena seu nome, descriptor (tipos dos parâmetros + tipo de retorno, codificados como uma string), access flags e — para qualquer method com corpo — um attribute `Code` contendo as instruções de bytecode reais:

```java
public int add(int a, int b) {
    return a + b;
}
```

```
$ javap -v Calc.class | grep -A6 'public int add'
  public int add(int, int);
    descriptor: (II)I
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=2, locals=3, args_size=3
         0: iload_1
         1: iload_2
         2: iadd
         3: ireturn
```

O descriptor `(II)I` diz "recebe dois `int`s, retorna um `int`" — `V` nessa posição significa `void`, e tipos de referência usam a forma totalmente qualificada `Lpackage/Class;`, como visto antes em `(Ljava/lang/String;)V` para `println`. O attribute `Code` é o que o JVM efetivamente executa; tudo mais no arquivo existe para permitir que o JVM resolva e verifique isso corretamente.

### Descriptors de field e method: o alfabeto de códigos de tipo

Todo descriptor de field e method no constant pool é construído a partir de um pequeno conjunto fixo de códigos de uma letra para primitivos, mais dois prefixos estruturais para tudo que não é primitivo:

| código | tipo |
|---|---|
| `B` | `byte` |
| `C` | `char` |
| `D` | `double` |
| `F` | `float` |
| `I` | `int` |
| `J` | `long` |
| `S` | `short` |
| `Z` | `boolean` |
| `L ClassName ;` | um reference type — totalmente qualificado, separado por barra, terminado por `;` |
| `[` | uma dimensão de array — prefixado no descriptor de qualquer que seja o tipo do elemento |

Compilar uma classe de exemplo e ler seus descriptors de field mostra o padrão diretamente — tipos de array simplesmente empilham `[` na frente do descriptor do elemento, uma vez por dimensão:

```java
byte b;
int[] intArray;
String[][] stringMatrix;
```

```
byte b;
    descriptor: B
int[] intArray;
    descriptor: [I
java.lang.String[][] stringMatrix;
    descriptor: [[Ljava/lang/String;
```

Generics não têm sintaxe de descriptor própria — `List<String>` e `List<Integer>` compilam para o mesmo descriptor bruto `Ljava/util/List;`. O argumento de tipo genérico é preservado separadamente, num attribute `Signature` opcional (`Ljava/util/List<Ljava/lang/String;>;`) que só ferramentas como `javac` e reflection consultam; o próprio bytecode, e o verifier, só veem o `Ljava/util/List;` apagado. Isso é a type erasure feita concreta no nível do descriptor: o JVM não tem instrução ou código de descriptor que distinga um `List<String>` de um `List<Integer>`.

## Trade-offs

- **Indireção vs. tamanho** — toda referência simbólica no bytecode é um índice do constant pool em vez de um valor inline, o que permite reutilizar a mesma string ou referência de method em várias instruções em vez de duplicá-la, ao custo de um lookup no momento de link/resolução.

```
2: invokevirtual #4   // Method println:(Ljava/lang/String;)V — resolvido pelo pool, não inline
```

- **A checagem de versão é unidirecional** — um JVM se recusa a carregar um class file cujo `major_version` seja mais novo do que ele suporta, mas carrega sem problemas um arquivo compilado para uma release mais antiga:

```
$ java HelloWorld
Error: HelloWorld has been compiled by a more recent version of the Java Runtime
(class file version 65.0), this version of the Java Runtime only recognizes
class file versions up to 61.0
```

- **`ACC_SUPER` é um bit de compatibilidade histórico** — toda classe compilada desde o Java 1.0.2 tem essa flag setada automaticamente, existindo só para que um JVM moderno continue resolvendo corretamente chamadas `invokespecial` da forma como class files pré-1.0.2 esperavam; não há razão para se preocupar com isso em código escrito hoje.
- **Entradas do constant pool começam em 1 e nunca existe a entrada `#0`** — o índice `0` é reservado como um valor explícito de "sem referência" (usado, por exemplo, por uma classe sem superclasse), então as entradas do pool sempre começam a contar em `#1`, o que costuma pegar quem escreve um parser à mão assumindo indexação baseada em 0.

## Documentation Links

- [The class File Format — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html) — doc
- [4.3. Descriptors and Signatures — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.3) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [ClassFormatError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassFormatError.html) — doc
- [UnsupportedClassVersionError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/UnsupportedClassVersionError.html) — doc
