---
version: 1.0
updatedAt: 2026-08-19
title: "Foreign Function and Memory API"
summary: A API java.lang.foreign, padrão desde o JDK 22, permite que Java puro chame funções de bibliotecas nativas e gerencie memória off-heap com ciclos de vida vinculados a arenas, substituindo o código C escrito à mão do JNI.
---
## Objective

A Foreign Function and Memory API (FFM), no pacote `java.lang.foreign`, permite que código Java puro chame funções em bibliotecas nativas compartilhadas (`.so`, `.dll`, `.dylib`) e leia e escreva memória fora do heap Java — sem código C de ligação para escrever e sem etapa extra de compilação. Entregue pelo Project Panama e finalizada como recurso padrão permanente no JDK 22 (JEP 454), ela substitui o JNI como a forma suportada de alcançar código nativo: em vez de declarar métodos `native` e compilar uma biblioteca stub C correspondente, você descreve a assinatura da função estrangeira em Java, obtém um `MethodHandle` para ela, e a invoca.

## Use Cases

- Chamar uma biblioteca C ou C++ existente (codecs de imagem, criptografia, compressão, CUDA/BLAS, SQLite, `libcurl`) diretamente do Java sem escrever uma biblioteca wrapper JNI.
- Alcançar uma API do sistema operacional — uma função da libc, uma chamada POSIX, um ponto de entrada Win32 — para algo que o JDK não expõe.
- Trabalhar com grandes buffers off-heap que precisam sobreviver a um único ciclo de GC ou ser compartilhados com código nativo, como um substituto tipado e com verificação de limites para `ByteBuffer` e `sun.misc.Unsafe`.
- Passar dados estruturados (structs C, arrays, ponteiros) através da fronteira usando layouts de memória explícitos em vez de arrays de bytes empacotados à mão.
- Deixar código nativo chamar *de volta* para Java (um upcall) — por exemplo, fornecendo uma função comparadora C para `qsort`.
- Consumir bindings gerados por máquina do `jextract`, que lê um header C e emite todo o boilerplate FFM para uma biblioteca inteira.

## Deep Dive

### Um downcall completo: chamando o `strlen` do C

`strlen` vive na biblioteca padrão C, que o processo da JVM já tem carregada, então este exemplo não precisa de biblioteca nativa customizada nem etapa de build:

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

void main() throws Throwable {
    Linker linker = Linker.nativeLinker();
    SymbolLookup stdlib = linker.defaultLookup();

    MethodHandle strlen = linker.downcallHandle(
        stdlib.findOrThrow("strlen"),
        FunctionDescriptor.of(ValueLayout.JAVA_LONG,   // size_t return
                              ValueLayout.ADDRESS));   // const char* argument

    try (Arena arena = Arena.ofConfined()) {
        MemorySegment cString = arena.allocateFrom("Hello");
        long len = (long) strlen.invokeExact(cString);
        System.out.println(len);   // 5
    }
}
```

Rode com acesso nativo habilitado:

```
java --enable-native-access=ALL-UNNAMED Strlen.java
```

Cinco peças fazem todo o trabalho: `Linker` (a ponte), `SymbolLookup` (encontrar o símbolo), `FunctionDescriptor` (descrever a assinatura), `MethodHandle` (o chamável), e `Arena` + `MemorySegment` (a memória off-heap segurando a string C).

### Linker e SymbolLookup: localizando a função

`Linker.nativeLinker()` retorna o linker para a ABI da plataforma. `defaultLookup()` busca nas bibliotecas que a JVM sempre tem (libc e afins); `SymbolLookup.libraryLookup(...)` carrega uma biblioteca compartilhada arbitrária e vincula seu ciclo de vida a uma arena:

```java
try (Arena arena = Arena.ofConfined()) {
    SymbolLookup myLib =
        SymbolLookup.libraryLookup("/opt/lib/hello.so", arena);   // unloaded when arena closes

    Optional<MemorySegment> maybe = myLib.find("greet");          // Optional form
    MemorySegment addr = myLib.findOrThrow("greet");              // throws NoSuchElementException
}
```

Um lookup retorna um `MemorySegment` de tamanho zero cujo *endereço* é o ponto de entrada da função — um ponteiro, não algo do qual você pode ler bytes.

### FunctionDescriptor: a assinatura C, reescrita em Java

Não há parsing de header em runtime, então você mesmo declara a assinatura. `FunctionDescriptor.of(returnLayout, argLayouts...)` descreve uma função que retorna um valor; `FunctionDescriptor.ofVoid(argLayouts...)` uma que não retorna:

```java
// size_t strlen(const char *s);
FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS);

// int printf(const char *fmt, ...);   -> variadic, see Linker.Option.firstVariadicArg
FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS);

// void free(void *p);
FunctionDescriptor.ofVoid(ValueLayout.ADDRESS);
```

Constantes de `ValueLayout` mapeiam carriers Java para tipos C: `JAVA_INT` (32 bits), `JAVA_LONG` (64 bits), `JAVA_DOUBLE`, `JAVA_CHAR`, `ADDRESS` para qualquer ponteiro. O próprio `int` e `long` do C *não* têm largura fixa — `long` tem 64 bits no LP64 do Linux/macOS mas 32 bits no LLP64 do Windows — então o layout que você escolhe é uma decisão de plataforma, não uma tradução mecânica.

Tipos compostos ganham um `StructLayout`, e `VarHandle`s derivados dele leem campos nomeados:

```java
// struct Point { int x; int y; };
StructLayout POINT = MemoryLayout.structLayout(
    ValueLayout.JAVA_INT.withName("x"),
    ValueLayout.JAVA_INT.withName("y"));

VarHandle xHandle = POINT.varHandle(MemoryLayout.PathElement.groupElement("x"));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment p = arena.allocate(POINT);
    xHandle.set(p, 0L, 42);
    System.out.println((int) xHandle.get(p, 0L));   // 42
}
```

### O MethodHandle do downcall é tipado com exatidão

`Linker.downcallHandle` retorna um `MethodHandle` cujo tipo é derivado do descritor. `invokeExact` significa exato: os tipos estáticos dos argumentos e o cast no resultado precisam corresponder, ou você recebe um `WrongMethodTypeException` em vez de uma conversão silenciosa.

```java
long ok  = (long) strlen.invokeExact(cString);   // matches JAVA_LONG return
int  bad = (int)  strlen.invokeExact(cString);   // WrongMethodTypeException
```

`invokeExact` é declarado `throws Throwable`, e é por isso que o método envolvente acima também declara isso. Use `invoke` em vez de `invokeExact` quando quiser que o handle aplique as conversões usuais de argumento.

### Arena e MemorySegment: memória off-heap com um ciclo de vida

`MemorySegment` é uma região de memória contígua e com verificação de limites. Uma `Arena` aloca segments e é dona do seu ciclo de vida: fechar a arena libera tudo que ela alocou de uma vez, então não há `free()` por segment para esquecer.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment cString = arena.allocateFrom("Killer Bunny");   // NUL-terminated UTF-8
    MemorySegment ints    = arena.allocate(ValueLayout.JAVA_INT, 4);

    ints.setAtIndex(ValueLayout.JAVA_INT, 0, 7);
    System.out.println(ints.getAtIndex(ValueLayout.JAVA_INT, 0));  // 7
    System.out.println(ints.byteSize());                           // 16
    System.out.println(cString.getString(0));                      // Killer Bunny
}   // all of it deallocated here
```

Limites são verificados, então um índice fora do lugar é uma exceção, não corrupção de memória:

```java
ints.getAtIndex(ValueLayout.JAVA_INT, 99);   // IndexOutOfBoundsException
```

Note os nomes: a preview do JDK 21 chamava isso de `allocateUtf8String` e `getUtf8String`; a API finalizada renomeou para `allocateFrom` e `getString`, então exemplos FFM mais antigos não compilam no JDK 22+.

### Escolhendo uma arena

| Factory | Fechável | Threads | Liberada quando |
| --- | --- | --- | --- |
| `Arena.ofConfined()` | sim | só a thread dona | `close()` |
| `Arena.ofShared()` | sim | qualquer thread | `close()`, por qualquer thread |
| `Arena.ofAuto()` | não | qualquer thread | o GC decide |
| `Arena.global()` | não | qualquer thread | nunca |

`ofConfined` em um try-with-resources é a escolha padrão: checagens de acesso mais baratas, liberação determinística. `ofAuto` quando o ciclo de vida de um segment é genuinamente difícil de delimitar; `global()` para uma alocação única que vive enquanto a JVM viver.

Uma arena confinada é vinculada à sua thread criadora — outra thread tocando nela falha rápido:

```java
Arena arena = Arena.ofConfined();
MemorySegment seg = arena.allocate(8);
Thread.ofPlatform().start(() -> seg.get(ValueLayout.JAVA_BYTE, 0)).join();
// WrongThreadException
```

### Uso após o close é uma exceção, não um crash

Essa é a garantia de segurança que JNI e `Unsafe` nunca deram. Um segment carrega o escopo da sua arena, e todo acesso o revalida:

```java
MemorySegment leaked;
try (Arena arena = Arena.ofConfined()) {
    leaked = arena.allocateFrom("Hello");
}   // memory freed here

leaked.getString(0);   // IllegalStateException: Already closed
```

O ponteiro pendurado ainda é capturado deterministicamente, na thread que acessa, com um stack trace — onde o equivalente em C seria comportamento indefinido.

### Ponteiros retornados do C: reinterpret

Quando uma função C retorna `char*`, a API FFM devolve um segment de tamanho zero: ela sabe o endereço mas não o tamanho, então ler dele falha. `reinterpret` anexa um tamanho (e opcionalmente uma arena e uma ação de limpeza) para que os bytes se tornem acessíveis:

```java
MethodHandle getenv = linker.downcallHandle(
    linker.defaultLookup().findOrThrow("getenv"),
    FunctionDescriptor.of(ValueLayout.ADDRESS, ValueLayout.ADDRESS));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment name = arena.allocateFrom("HOME");
    MemorySegment result = (MemorySegment) getenv.invokeExact(name);

    result.getString(0);                                    // IndexOutOfBoundsException: size 0
    System.out.println(result.reinterpret(Long.MAX_VALUE).getString(0));  // /home/you
}
```

`reinterpret` é onde você assume a responsabilidade de volta do runtime: você está afirmando um tamanho que a JVM não consegue verificar. Uma forma de três argumentos também registra uma ação de limpeza, que é como você conecta um `free()` nativo ao fechamento da arena:

```java
MemorySegment owned = result.reinterpret(1024, arena, seg -> freeHandle.invokeExact(seg));
```

### Upcalls: deixando o C chamar Java

`Linker.upcallStub` transforma um `MethodHandle` Java em um ponteiro de função nativo que o C pode invocar, válido enquanto durar a arena passada a ele:

```java
static int compare(MemorySegment a, MemorySegment b) {
    return Integer.compare(a.get(ValueLayout.JAVA_INT, 0),
                           b.get(ValueLayout.JAVA_INT, 0));
}

MethodHandle target = MethodHandles.lookup().findStatic(
    Sorter.class, "compare",
    MethodType.methodType(int.class, MemorySegment.class, MemorySegment.class));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment comparator = linker.upcallStub(
        target,
        FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS, ValueLayout.ADDRESS),
        arena);
    // comparator is now a C function pointer, passable to qsort
}
```

### Acesso nativo é uma operação restrita

`Linker.downcallHandle`, `Linker.upcallStub`, `SymbolLookup.libraryLookup`, e `MemorySegment.reinterpret` são *métodos restritos*: usados incorretamente, podem derrubar a JVM ou corromper memória, então a plataforma quer o risco declarado explicitamente.

```
java --enable-native-access=ALL-UNNAMED App.java        # code on the classpath
java --enable-native-access=my.module -m my.module/App  # a named module
```

Um JAR executável pode carregar a declaração no lugar, como um atributo `Enable-Native-Access: ALL-UNNAMED` no seu manifesto.

Sem isso, `--illegal-native-access` decide o que acontece. A partir do JDK 26 o padrão ainda é `warn` — a chamada prossegue e o módulo recebe um aviso:

```
WARNING: A restricted method in java.lang.foreign.Linker has been called
WARNING: java.lang.foreign.Linker::downcallHandle has been called by the unnamed module
WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module
```

`--illegal-native-access=deny` lança `IllegalCallerException` no lugar, e está previsto para se tornar o padrão em uma release futura — então trate o aviso de hoje como a falha de amanhã e passe a flag agora.

### O que isso substitui: JNI em um parágrafo

JNI exigia uma declaração de método `native` em Java, uma função C cujo nome codificava a classe e o método (`Java_pkg_Cls_method`), um header gerado a partir do arquivo de classe, um compilador C rodando por plataforma alvo, e uma biblioteca compartilhada distribuída junto com o JAR. Todo erro nessa cadeia — uma assinatura incompatível, um `ReleaseStringUTFChars` esquecido, uma referência local obsoleta — era indiagnosticável a partir do Java e tipicamente terminava em um crash da JVM. FFM mantém o mesmo alcance mas move a ligação inteira para dentro do código Java: nenhum C para escrever, nenhum build por plataforma, verificações de limites e de ciclo de vida em cada acesso, e falhas surgem como exceções Java comuns. JNI ainda funciona e não está deprecado, mas não é mais o caminho recomendado, e também agora emite avisos a menos que o acesso nativo esteja habilitado.

## Trade-offs

- **Memory-safe por padrão, mas não memory-safe de forma absoluta** — o escopo de arena transforma use-after-free em uma exceção determinística, mas `reinterpret` deliberadamente devolve a garantia:

```java
seg.reinterpret(Long.MAX_VALUE).get(ValueLayout.JAVA_BYTE, 0);  // no bounds check left to fail
```

- **Nenhum código de ligação, mas a assinatura não é verificada** — nada checa seu `FunctionDescriptor` contra a função C real. Errar o layout pode dar uma resposta errada ou um crash, sem compilador para pegar:

```java
// size_t strlen(const char*) described as returning int on an LP64 platform
FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS);  // reads half the return value
```

- **`invokeExact` é implacável** — o ganho é que o JIT pode fazer inline da chamada quase na velocidade nativa; o custo é que todo argumento e o cast do resultado precisam corresponder exatamente ao tipo do handle:

```java
strlen.invokeExact(cString);      // WrongMethodTypeException: expected (MemorySegment)long
```

- **Restrito por design** — todo deployment precisa de `--enable-native-access` (ou um atributo de manifesto) ou vai começar a falhar quando `deny` se tornar o padrão. Essa é mais uma preocupação em tempo de inicialização para bibliotecas que preferiam ser uma dependência plug-and-play:

```
java --illegal-native-access=deny App.java   # IllegalCallerException today, default later
```

- **Suposições de plataforma vazam para o código Java** — `int`, `long`, `size_t`, padding de struct e endianness do C diferem entre ABIs, então descritores e layouts escritos contra uma plataforma não são automaticamente portáveis, mesmo que o código Java compile em toda parte.
- **Verboso para qualquer coisa não trivial** — uma biblioteca real significa dezenas de descritores, layouts de struct e var handles. `jextract` os gera a partir de headers, mas é uma ferramenta separada distribuída fora do JDK, então adotar FFM em escala geralmente significa adotar também um gerador de código.
- **Ainda é uma fronteira** — FFM torna a chamada barata e segura, não gratuita. Dados que atravessam a fronteira precisam ser copiados para, ou dispostos em, memória off-heap, e o código nativo permanece fora do controle da JVM: ainda pode bloquear uma carrier thread, ignorar interrupções, e abortar o processo.

## Documentation Links

- [java.lang.foreign — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/package-summary.html) — doc
- [Arena — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/Arena.html) — doc
- [Linker — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/Linker.html) — doc
- [Foreign Function and Memory API — Java SE 26 Core Libraries Guide](https://docs.oracle.com/en/java/javase/26/core/foreign-function-and-memory-api.html) — doc
- [Restricted Methods — Java SE 26 Core Libraries Guide](https://docs.oracle.com/en/java/javase/26/core/restricted-methods.html) — doc
- [JEP 454: Foreign Function and Memory API](https://openjdk.org/jeps/454) — doc
