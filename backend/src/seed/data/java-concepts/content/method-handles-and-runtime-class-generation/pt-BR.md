---
version: 1.0
updatedAt: 2026-08-19
title: "Method Handles e Geração de Classes em Runtime"
summary: "Além da reflection de inspecionar-e-invocar: method handles com verificações de acesso em tempo de lookup, setAccessible contra o InaccessibleObjectException do sistema de módulos e --add-opens, e três formas de fabricar uma classe em runtime — um ClassLoader customizado, o JavaCompiler em memória e a API padrão Class-File do java.lang.classfile."
---
## Objective

A reflection clássica (`Class.forName`, `getMethod`, `Method.invoke`) é a camada de *inspecionar e chamar*. Por baixo e ao lado dela existem três capacidades mais profundas: os **method handles** de `java.lang.invoke`, que movem a verificação de acesso para o tempo de lookup e dão ao JIT algo que ele consegue inlinear; `setAccessible(true)`, que alcança membros privados — e a barreira do sistema de módulos (`InaccessibleObjectException`, `--add-opens`) que hoje se coloca à sua frente; e a capacidade de fabricar uma classe que nunca existiu em código-fonte, seja a partir de bytes brutos via um `ClassLoader`, a partir de código-fonte gerado via o `javax.tools.JavaCompiler` em memória, ou — desde o JDK 24 — a partir da **Class-File API** padrão em `java.lang.classfile`.

## Use Cases

- Substituir uma chamada quente de `Method.invoke` em um serializer, mapper ou avaliador de expressões por um `MethodHandle` em cache cuja verificação de acesso já aconteceu.
- Escrever um teste ou ferramenta de debug que precisa ler um campo privado da classe sob teste, e entender por que o mesmo truque lança exceção em classes do `java.base`.
- Carregar classes de plugin de um local que não está no classpath — um blob de banco de dados, um stream de rede, um diretório por tenant — cada uma no seu próprio namespace, de forma que dois plugins possam ter uma classe com o mesmo nome.
- Gerar código de accessor/adapter em alto volume na inicialização (proxies de framework, wrappers de AOP, accessors de campo de ORM) em vez de pagar o custo da reflection a cada acesso.
- Construir ou reescrever arquivos `.class` programaticamente — um linter em nível de bytecode, um renomeador de pacote (`javax.*` para `jakarta.*`), um agente de instrumentação — com uma API do JDK em vez de empacotar o ASM.
- Ler o que está de fato dentro de um arquivo `.class` (versão, atributos, tabela de anotações) sem carregar a classe na JVM.

## Deep Dive

### `Method.invoke` versus um `MethodHandle`

A reflection clássica encontra um método pelo nome mais um array de objetos `Class` de parâmetro, e então o invoca com um `Object[]`:

```java
Method m = String.class.getMethod("substring", int.class, int.class);
String s = (String) m.invoke("Antidisestablishmentarianism", 7, 20);   // "establishment"
```

O equivalente em method handle descreve a assinatura antecipadamente como um `MethodType` (tipo de retorno primeiro, depois os tipos de parâmetro), faz o lookup através de um objeto `Lookup`, e invoca diretamente — sem `Object[]`, sem boxing dos argumentos `int`:

```java
import java.lang.invoke.*;

MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodType mt = MethodType.methodType(String.class, int.class, int.class);
MethodHandle mh = lookup.findVirtual(String.class, "substring", mt);

String s = (String) mh.invokeExact("Antidisestablishmentarianism", 7, 20);   // "establishment"
System.out.println(mh.type());   // (String,int,int)String
```

Note `findVirtual` em um método de instância: o receiver se torna o argumento *líder* do handle, então o tipo do handle é `(String,int,int)String` mesmo que o `MethodType` tenha listado só os dois `int`s. `findStatic` não tem receiver líder:

```java
MethodType ofType = MethodType.methodType(LocalDate.class, int.class, int.class, int.class);
MethodHandle of = lookup.findStatic(LocalDate.class, "of", ofType);
LocalDate d = (LocalDate) of.invokeExact(2026, 8, 19);
```

A diferença substantiva é *quando* a verificação de acesso acontece. O javadoc de `MethodHandles.Lookup` afirma isso diretamente: verificações de acesso são aplicadas nos métodos de fábrica de `Lookup`, quando o handle é criado — "uma diferença chave em relação à Core Reflection API, já que `java.lang.reflect.Method.invoke` faz a verificação de acesso contra cada chamador, a cada chamada." Um lookup que falha lança uma `ReflectiveOperationException` checada (`NoSuchMethodException`, `NoSuchFieldException`, ou `IllegalAccessException`) em tempo de lookup, e não em tempo de chamada.

### `invokeExact` versus `invoke`: o cast faz parte da chamada

`invokeExact` e `invoke` são *signature-polymorphic*: o compilador não usa sua assinatura declarada, ele deriva o descritor de tipo simbólico da chamada a partir das expressões de argumento reais **e do cast aplicado ao resultado**. Então o cast não é cosmético — ele faz parte do que a JVM confere contra o tipo do handle. Fazer boxing dos argumentos `int` e remover o cast `(String)` faz `invokeExact` falhar:

```java
Object o = mh.invokeExact("Antidisestablishmentarianism", Integer.valueOf(7), Integer.valueOf(20));
// java.lang.invoke.WrongMethodTypeException: handle's method type (String,int,int)String
//   but found (String,Integer,Integer)Object
```

O `invoke` simples é o irmão permissivo: em caso de incompatibilidade, ele adapta o handle como se fosse por `asType` — fazendo unboxing, widening, cast do retorno — e então o chama:

```java
String s = (String) mh.invoke("Antidisestablishmentarianism", Integer.valueOf(7), Integer.valueOf(20));
// "establishment" — invoke unboxes for you; invokeExact would not
```

Ambos os invokers são declarados `throws Throwable`, então um call site precisa declarar ou capturar isso:

```java
public static void main(String[] a) {
    String s = (String) mh.invokeExact("x", 1, 2);
    // error: unreported exception Throwable; must be caught or declared to be thrown
}
```

### Acessando membros privados: `setAccessible`, e a barreira dos módulos

`Field`, `Method` e `Constructor` estendem todos `AccessibleObject`, cujo `setAccessible(true)` suprime a verificação de acesso para aquele objeto reflexivo:

```java
class Vault {
    private int code = 42;
    private String secret() { return "s3cret"; }
}

Method m = Vault.class.getDeclaredMethod("secret");
m.setAccessible(true);
System.out.println(m.invoke(new Vault()));   // s3cret

for (Field f : Vault.class.getDeclaredFields()) {
    f.setAccessible(true);                    // bye-bye "private"
    System.out.println(f.getName() + " == " + f.get(new Vault()));   // code == 42
}
```

Isso funciona porque `Vault` está no mesmo módulo sem nome (unnamed module) do chamador. Apontar o mesmo código para uma classe do JDK faz o sistema de módulos barrar — a JEP 403 encapsulou fortemente os internals do JDK no JDK 17, e a escapatória `--illegal-access` foi removida ao mesmo tempo:

```java
Field f = String.class.getDeclaredField("value");
f.setAccessible(true);
// java.lang.reflect.InaccessibleObjectException: Unable to make field
//   private final byte[] java.lang.String.value accessible:
//   module java.base does not "opens java.lang" to unnamed module @2f490758
```

A única forma de contorno suportada é uma abertura (*open*) explícita daquele pacote específico, na linha de comando ou via o atributo `Add-Opens` do manifest do JAR:

```
$ java --add-opens java.base/java.lang=ALL-UNNAMED T1.java
ok
```

A concessão é por pacote, por módulo alvo: `--add-opens <source-module>/<package>=<target-module>`, com `ALL-UNNAMED` significando código do classpath. Um módulo seu declara a mesma coisa no próprio descritor com `opens some.pkg;` (ou `opens some.pkg to some.framework;`).

### Acesso privado à moda dos method handles: `privateLookupIn` e `unreflect`

Um `MethodHandles.lookup()` simples carrega os direitos de acesso da classe que o chamou, então ele não consegue enxergar o método privado de outra classe de jeito nenhum:

```java
MethodHandles.lookup().findVirtual(Vault.class, "secret", MethodType.methodType(String.class));
// java.lang.IllegalAccessException: no such method: Vault.secret()String/invokeVirtual
```

`MethodHandles.privateLookupIn` teleporta um lookup para dentro de uma classe alvo, concedendo acesso privado — mas só se o módulo do alvo abrir seu pacote para o módulo do chamador, a mesma regra que `setAccessible` obedece:

```java
MethodHandles.Lookup priv = MethodHandles.privateLookupIn(Vault.class, MethodHandles.lookup());

MethodHandle mh = priv.findVirtual(Vault.class, "secret", MethodType.methodType(String.class));
System.out.println((String) mh.invokeExact(new Vault()));   // s3cret

VarHandle vh = priv.findVarHandle(Vault.class, "code", int.class);
System.out.println((int) vh.get(new Vault()));              // 42
```

```java
MethodHandles.privateLookupIn(String.class, MethodHandles.lookup());
// java.lang.IllegalAccessException: module java.base does not open java.lang to unnamed module @3c9d0b9d
```

Existe também uma ponte na direção oposta: uma vez que um `Method` já teve `setAccessible(true)` aplicado, `Lookup.unreflect` o converte em um `MethodHandle` que herda essa verificação suprimida — útil para migrar incrementalmente um cache baseado em reflection existente para handles:

```java
Method m = Vault.class.getDeclaredMethod("secret");
m.setAccessible(true);
MethodHandle mh = MethodHandles.lookup().unreflect(m);
System.out.println((String) mh.invokeExact(new Vault()));   // s3cret
```

### Carregando uma classe a partir de bytes brutos com um `ClassLoader` customizado

`ClassLoader` é abstrata; o ponto de extensão suportado é `findClass`, que precisa obter os bytes de onde quer que eles estejam e entregá-los ao `defineClass` protegido — a única porta para a maquinaria de criação de classes da JVM:

```java
class ByteDirLoader extends ClassLoader {
    private final Path dir;

    ByteDirLoader(Path dir, ClassLoader parent) { super(parent); this.dir = dir; }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        try {
            byte[] b = Files.readAllBytes(dir.resolve(name.replace('.', '/') + ".class"));
            return defineClass(name, b, 0, b.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

Cada instância de loader é seu próprio namespace, que é o motivo real para escrever um: dois web apps ou dois plugins podem cada um distribuir `plug.Hi` sem colidir:

```java
ClassLoader l1 = new ByteDirLoader(Path.of("plugins"), getClass().getClassLoader());
ClassLoader l2 = new ByteDirLoader(Path.of("plugins"), getClass().getClassLoader());

Class<?> c1 = l1.loadClass("plug.Hi");
Class<?> c2 = l2.loadClass("plug.Hi");

System.out.println(c1.getName().equals(c2.getName()));   // true  — same name
System.out.println(c1 == c2);                            // false — different runtime classes
```

`c1` e `c2` não são compatíveis por atribuição; um cast entre eles lança `ClassCastException` mesmo que os bytes sejam idênticos. A identidade em runtime é (loader, nome), não só o nome.

Se os bytes vêm simplesmente de URLs, não escreva um loader — `java.net.URLClassLoader` já faz isso:

```java
ClassLoader cl = new URLClassLoader(new URL[]{ new File("out").toURI().toURL() });
Class<?> c = Class.forName("generated.Greeter", true, cl);
```

### Gerando código-fonte e compilando em memória com `JavaCompiler`

Quando o que você quer em runtime é mais fácil de expressar como *código-fonte*, a Compiler API (`javax.tools`, presente desde o Java 6) compila uma `String`. Implemente `SimpleJavaFileObject` para servir o código-fonte, e então execute a `CompilationTask` — que também é um `Callable<Boolean>`, então pode ir para um `ExecutorService` se quiser:

```java
static class StringSource extends SimpleJavaFileObject {
    private final String code;

    StringSource(String className, String code) {
        super(URI.create("string:///" + className.replace('.', '/') + ".java"), Kind.SOURCE);
        this.code = code;
    }

    @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return code; }
}
```

```java
String src = """
    package generated;
    public class Greeter {
        public static String greet(String who) { return "Hello, " + who; }
    }
    """;

JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
if (compiler == null) {
    throw new IllegalStateException("No compiler in this image — fall back to reflection");
}

Callable<Boolean> task = compiler.getTask(
        null, null, null,                       // out, fileManager, diagnosticListener
        List.of("-d", "out"),                   // ordinary javac options
        null,                                   // classes for annotation processing
        List.of(new StringSource("generated.Greeter", src)));

if (task.call()) {
    ClassLoader cl = new URLClassLoader(new URL[]{ new File("out").toURI().toURL() });
    Class<?> c = Class.forName("generated.Greeter", true, cl);
    System.out.println(c.getMethod("greet", String.class).invoke(null, "world"));   // Hello, world
}
```

`ToolProvider.getSystemJavaCompiler()` retorna `null` em uma imagem de runtime construída sem o módulo `jdk.compiler`, então a checagem de null não é uma cautela extra — é o sinal documentado para desistir ou usar um fallback.

### Construindo e transformando arquivos `.class` com a Class-File API

A Class-File API em `java.lang.classfile` é a resposta do próprio JDK ao ASM: ela foi apresentada como preview pela **JEP 457 no JDK 22**, re-apresentada pela **JEP 466 no JDK 23**, e finalizada como API padrão pela **JEP 484 no JDK 24** — então em um JDK atual ela não precisa de `--enable-preview`, diferente dos exemplos da era de preview que ainda circulam por aí. Tudo começa a partir de `ClassFile.of()`, e as formas que ela manipula são os records `ClassModel` / `ClassElement` mais `ClassDesc` e `MethodTypeDesc` de `java.lang.constant`.

O parsing é um `switch` sobre elementos — note que isso lê *bytes*, nunca carrega a classe, então nenhum inicializador estático roda:

```java
byte[] original = Files.readAllBytes(Path.of("Target.class"));
ClassModel model = ClassFile.of().parse(original);

System.out.println("thisClass=" + model.thisClass().asInternalName());
for (ClassElement e : model) {
    switch (e) {
        case MethodModel m -> System.out.println("Method " + m.methodName().stringValue()
                                                + m.methodType().stringValue());
        case FieldModel f  -> System.out.println("Field " + f.fieldName().stringValue());
        default            -> System.out.println("Other: " + e);
    }
}
// thisClass=Target
// Other: AccessFlags[flags=33]
// Other: ClassFileVersion[majorVersion=69, minorVersion=0]
// Other: Superclass[superclassEntry=java/lang/Object]
// Other: Interfaces[interfaces=]
// Method <init>()V
// Method work()V
// Method debugOnly()V
// Other: Attribute[name=SourceFile]
```

Construir emite uma classe que não tem arquivo-fonte em lugar nenhum — um class builder `clb` para a estrutura, um code builder `cob` para bytecodes individuais:

```java
import java.lang.classfile.*;
import java.lang.constant.*;
import static java.lang.constant.ConstantDescs.*;

ClassDesc CD_Hello       = ClassDesc.of("notapackage.Hello");
ClassDesc CD_System      = ClassDesc.of("java.lang.System");
ClassDesc CD_PrintStream = ClassDesc.of("java.io.PrintStream");
MethodTypeDesc MTD_void_String      = MethodTypeDesc.of(CD_void, CD_String);
MethodTypeDesc MTD_void_StringArray = MethodTypeDesc.of(CD_void, CD_String.arrayType());

byte[] bytes = ClassFile.of().build(CD_Hello, clb -> clb
    .withFlags(ClassFile.ACC_PUBLIC)
    // every class needs a constructor; INIT_NAME is the special name "<init>"
    .withMethod(INIT_NAME, MTD_void, ClassFile.ACC_PUBLIC,
        mb -> mb.withCode(cob -> cob.aload(0)
                                    .invokespecial(CD_Object, INIT_NAME, MTD_void)
                                    .return_()))
    // public static void main(String[])
    .withMethod("main", MTD_void_StringArray,
        ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC,
        mb -> mb.withCode(cob -> cob.getstatic(CD_System, "out", CD_PrintStream)
                                    .ldc("Hello from generated bytecode")
                                    .invokevirtual(CD_PrintStream, "println", MTD_void_String)
                                    .return_())));

System.out.println("generated " + bytes.length + " bytes");   // generated 365 bytes
```

Esses bytes são um arquivo de classe comum: escreva-os em disco para o `javap`, ou passe-os diretamente para `defineClass` e chame:

```java
public class CreateLoadAndRun extends ClassLoader {   // to reach protected defineClass
    void run(byte[] bytes) throws Exception {
        Class<?> c = defineClass("notapackage.Hello", bytes, 0, bytes.length);
        c.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
        // Hello from generated bytecode
    }
}
```

O terceiro modo é *transformação* — ler um arquivo de classe, emitir um modificado. `ClassTransform.dropping` remove elementos que casam com um predicado; outras transformações reescrevem corpos de métodos ou instruções individuais, que é como um rename de pacote ou um wrapper de AOP é implementado:

```java
ClassModel model = ClassFile.of().parse(original);
byte[] stripped = ClassFile.of().transformClass(model,
        ClassTransform.dropping(e -> e instanceof MethodModel m
                                     && m.methodName().equalsString("debugOnly")));

for (MethodModel m : ClassFile.of().parse(stripped).methods()) {
    System.out.println("kept: " + m.methodName().stringValue());
}
// kept: <init>
// kept: work
```

### Classes ocultas: definindo uma classe sem um namespace de loader

Se a classe gerada é um detalhe de implementação pontual — um adapter no estilo de lambda, uma expressão compilada — um `ClassLoader` inteiro é mais maquinaria do que necessário. `Lookup.defineHiddenClass` (JEP 371, JDK 15) define uma classe que não é descobrível por nome e pode ser descarregada independentemente do loader que a definiu:

```java
byte[] bytes = ClassFile.of().build(ClassDesc.of("Hi"), clb -> clb
    .withFlags(ClassFile.ACC_PUBLIC)
    .withMethod("hi", MethodTypeDesc.of(CD_String),
        ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC,
        mb -> mb.withCode(cob -> cob.ldc("hi from a hidden class").areturn())));

MethodHandles.Lookup hidden = MethodHandles.lookup().defineHiddenClass(bytes, true);
Class<?> hc = hidden.lookupClass();
System.out.println(hc.getName() + " isHidden=" + hc.isHidden());
// Hi/0x000007f00115a000 isHidden=true

MethodHandle mh = hidden.findStatic(hc, "hi", MethodType.methodType(String.class));
System.out.println((String) mh.invokeExact());   // hi from a hidden class

Class.forName(hc.getName());
// java.lang.ClassNotFoundException: Hi/0x000007f00115a000
```

Os bytes precisam nomear uma classe no mesmo pacote da classe do lookup, e o `Lookup` retornado é o único handle sobre ela — que é exatamente por que nada mais na JVM consegue fazer link contra ela pelo nome.

## Trade-offs

- **Method handles compensam quando são cacheados, não quando são criados por chamada** — o custo se move para o tempo de lookup, então um handle cujo lookup é feito dentro do próprio método que o invoca é mais lento que `Method.invoke`, não mais rápido. O idiom é um `static final MethodHandle` inicializado uma vez, que também é o que permite ao JIT tratá-lo como uma constante e inlinear através dele.

```java
private static final MethodHandle SUBSTRING;
static {
    try {
        SUBSTRING = MethodHandles.lookup().findVirtual(String.class, "substring",
                MethodType.methodType(String.class, int.class, int.class));
    } catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
}
```

- **`invokeExact` é type-safe de uma forma que surpreende as pessoas** — o compilador deriva o descritor da chamada a partir das expressões de argumento e do cast do resultado, então um cast omitido ou um argumento acidentalmente boxed é um `WrongMethodTypeException` em runtime, não um erro de compilação:

```java
Object o = mh.invokeExact("Anti...", Integer.valueOf(7), Integer.valueOf(20));
// WrongMethodTypeException: handle's method type (String,int,int)String
//   but found (String,Integer,Integer)Object
```

- **`invoke` troca essa precisão por conveniência** — ele insere silenciosamente conversões `asType` (boxing, widening, casts de retorno), o que é mais amigável mas reintroduz trabalho de adaptação por chamada e esconde desvios de assinatura até que algo lance um `ClassCastException` dentro do adapter em vez de no call site.

- **Ambos os invokers são `throws Throwable`, o que infecta todo call site** — você precisa declarar `throws Throwable` para cima ou escrever um catch que relança as exceções legais e envelopa o resto; não existe um tipo checado mais estreito para capturar:

```java
String s = (String) mh.invokeExact("x", 1, 2);
// error: unreported exception Throwable; must be caught or declared to be thrown
```

- **`setAccessible(true)` é uma dependência de deployment, não só um code smell** — no momento em que o alvo está em outro módulo que não abre seu pacote, a chamada lança exceção e o conserto vive fora do código-fonte, em uma flag de JVM ou atributo de manifest que todo script de inicialização, test runner e imagem de container precisa repetir:

```java
String.class.getDeclaredField("value").setAccessible(true);
// InaccessibleObjectException: module java.base does not "opens java.lang" to unnamed module
// fix lives here instead: java --add-opens java.base/java.lang=ALL-UNNAMED ...
```

- **Quebrar o encapsulamento te vincula a nomes privados de outra classe** — um campo privado renomeado em um patch release vira um `NoSuchFieldException` em runtime, sem nenhum aviso do compilador antes. É por isso que o JDK enquadra `setAccessible` como uma facilidade para construtores de ferramentas (IDEs, debuggers, bibliotecas de serialização e de teste), não para código de aplicação.

- **Gerar classes em runtime custa tempo de startup e observabilidade** — código gerado não tem arquivo-fonte, então stack traces apontam para uma classe que nenhum editor consegue abrir, breakpoints não têm onde se prender, e o `JavaCompiler` em particular arrasta uma compilação completa para dentro do seu caminho de startup. Ele só compensa em velocidade se o accessor gerado for chamado com frequência suficiente para amortizar a geração.

- **A Class-File API é acoplada a versão por design** — ela acompanha o formato de arquivo de classe da JVM Specification, então ela faz parsing e emite o formato do JDK em que está embarcada, e nenhum mais novo. Esse é o objetivo (ela substitui uma cópia embutida do ASM que precisava ser atualizada a cada release), mas significa que um build que precisa emitir bytecode para um alvo *mais novo* que o JDK em execução ainda precisa de uma biblioteca externa:

```java
// the class file version emitted/parsed follows the running JDK
// Other: ClassFileVersion[majorVersion=69, minorVersion=0]   // JDK 25
```

- **`JavaCompiler` pode simplesmente não estar lá** — `ToolProvider.getSystemJavaCompiler()` retorna `null` em uma imagem de runtime gerada com `jlink` sem `jdk.compiler`, uma forma comum em deployments de container, então qualquer design que dependa de compilação em runtime precisa de um fallback de verdade, não de uma assertion.

## Documentation Links

- [MethodHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandle.html) — doc
- [MethodHandles.Lookup — access checking at lookup time (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.Lookup.html) — doc
- [MethodHandles.privateLookupIn — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.html#privateLookupIn(java.lang.Class,java.lang.invoke.MethodHandles.Lookup)) — doc
- [MethodType — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodType.html) — doc
- [AccessibleObject.setAccessible — java.lang.reflect API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AccessibleObject.html#setAccessible(boolean)) — doc
- [JEP 403: Strongly Encapsulate JDK Internals](https://openjdk.org/jeps/403) — doc
- [ClassLoader — java.lang API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassLoader.html) — doc
- [javax.tools.JavaCompiler — Compiler API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.compiler/javax/tools/JavaCompiler.html) — doc
- [java.lang.classfile package — Class-File API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/classfile/package-summary.html) — doc
- [JEP 484: Class-File API (standard in JDK 24)](https://openjdk.org/jeps/484) — doc
- [JEP 371: Hidden Classes](https://openjdk.org/jeps/371) — doc
