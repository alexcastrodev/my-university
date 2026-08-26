---
version: 1.0
updatedAt: 2026-08-21
title: "Classloading: O Modelo de Delegação e Class Loaders Customizados"
summary: Como a JVM carrega, faz o linking e inicializa classes através de uma hierarquia de delegação parent-first, e o que acontece quando você escreve um class loader customizado ou carrega a mesma classe duas vezes.
---
## Objective

Entender como a JVM transforma um arquivo `.class` em um tipo vivo e utilizável: **loading** (carregamento) encontra os bytes e cria um objeto `Class`, **linking** (linkedição) verifica e prepara a classe, e **initialization** (inicialização) executa seus inicializadores estáticos — três fases distintas, disparadas em momentos diferentes e muitas vezes surpreendentes. O carregamento de classes também é delegado através de uma **hierarquia** de instâncias de `ClassLoader` que, por padrão, sempre perguntam primeiro ao seu pai — uma regra que existe especificamente para que código de aplicação não consiga substituir silenciosamente classes core do JDK. Esse é o mecanismo por baixo do module system coberto em [Java Platform Module System](/java-concepts/java-platform-module-system); o JPMS muda *quais* pacotes um loader tem permissão de enxergar, não o pipeline de loading/linking/initialization em si.

## Use Cases

- Explicar por que acessar uma constante `static final` nunca dispara o inicializador estático de uma classe, mas chamar um de seus métodos estáticos sempre dispara.
- Ler um stack trace que diz `NoClassDefFoundError` e saber procurar por um `ExceptionInInitializerError` anterior, ou por um JAR que estava presente em tempo de compilação mas está ausente do classpath em runtime — em vez de confundir isso com `ClassNotFoundException`.
- Escrever um `ClassLoader` customizado para carregar plugins de aplicação a partir de um diretório, isolar as classes de cada plugin das demais, ou dar suporte a hot-reload de uma classe sem reiniciar a JVM.
- Diagnosticar um `ClassCastException` entre dois objetos que imprimem exatamente o mesmo nome de tipo — um sintoma clássico da mesma classe ter sido carregada duas vezes, por dois class loaders diferentes, em um app server ou sistema de plugins.
- Decidir se uma dependência sensível a segurança ou isolamento precisa do próprio loader, ou se basta ser mais uma entrada no classpath da aplicação.

## Deep Dive

### As três fases: loading, linking, initialization

A JVM Specification (§5.3–§5.5) divide a transformação de um nome de classe em um tipo pronto para uso em três fases. **Loading** lê os bytes da classe e cria um objeto `Class`. **Linking** é, em si, três etapas: verificação (o bytecode é estrutural e type-safe), preparação (campos estáticos recebem seus valores padrão zero/`null`, a memória é alocada) e resolução (referências simbólicas a outros tipos são opcionalmente resolvidas, muitas vezes de forma preguiçosa). **Initialization** é a fase que os desenvolvedores realmente veem: ela executa blocos de inicialização estática e atribuições de campos estáticos, e acontece de forma preguiçosa, no primeiro "uso ativo" — não no momento do loading:

```java
class Lazy {
    static final int MAX = 100;           // compile-time constant, inlined by javac

    static {
        System.out.println("Lazy initialized");
    }

    static void ping() {
        System.out.println("ping");
    }
}

public class Demo {
    public static void main(String[] args) {
        int max = Lazy.MAX;   // no output at all: javac inlined the literal 100
                               // into Demo's own bytecode; Lazy is never touched
        Lazy.ping();           // NOW Lazy is initialized: prints "Lazy initialized"
                               // then "ping"
    }
}
```

`MAX` é uma expressão constante em tempo de compilação (JLS §15.29), então o compilador copia seu valor diretamente em cada ponto de chamada, e a classe que a referencia nem precisa carregar `Lazy` para lê-la. Já uma chamada a um *método* `static`, em contraste, não pode ser eliminada por inlining — ela força o loading, linking e initialization de `Lazy` antes que a chamada prossiga. O mesmo vale para `new Lazy()`, para acessar um campo estático não-constante, ou para invocar reflexivamente um método estático.

### A hierarquia de delegação: bootstrap, platform, application

A JVM padrão vem com uma pequena hierarquia de loaders, cada um com seu próprio escopo:

```java
public class LoaderChain {
    public static void main(String[] args) {
        System.out.println(String.class.getClassLoader());
        // null — String is loaded by the bootstrap loader, which has no
        // Java-side ClassLoader object at all

        System.out.println(java.sql.Driver.class.getClassLoader());
        // jdk.internal.loader.ClassLoaders$PlatformClassLoader@... —
        // a platform module (java.sql), loaded by the platform loader

        ClassLoader cl = LoaderChain.class.getClassLoader();
        while (cl != null) {
            System.out.println(cl);
            cl = cl.getParent();
        }
        // jdk.internal.loader.ClassLoaders$AppClassLoader@...      (this class)
        // jdk.internal.loader.ClassLoaders$PlatformClassLoader@... (its parent)
        // (loop ends: the platform loader's parent is bootstrap, reported as null)
    }
}
```

Antes do Java 9, esse loader se chamava **extension** class loader e cobria `jre/lib/ext`; o JPMS o reaproveitou como loader **platform**, responsável pelos próprios módulos de plataforma do JDK (`java.sql`, `java.desktop` e similares). O loader **application** (também chamado "system") é o que carrega tudo que está no classpath ou module path que o seu próprio código distribui — é o que `Class.getSystemClassLoader()` retorna, e o pai padrão de qualquer loader customizado que você escrever.

### Delegação parent-first: por que ela existe, como funciona

`ClassLoader.loadClass(String, boolean)` implementa a estratégia padrão **parent-first**: antes de um loader tentar encontrar e definir uma classe por conta própria, ele pede ao seu pai para tentar primeiro, até chegar ao bootstrap. Só se todos os ancestrais falharem em encontrar a classe é que o loader recorre ao seu próprio `findClass`. O objetivo é proteção, não conveniência: isso impede que código de aplicação sombreie uma classe core como `java.lang.String` só por distribuir uma classe com o mesmo nome no classpath.

Mesmo um loader customizado que deliberadamente inverte a ordem para *child-first* — checando a si mesmo antes de delegar — não consegue redefinir um pacote pertencente ao JDK, porque o próprio `defineClass` recusa:

```java
public class ChildFirstLoader extends ClassLoader {
    public ChildFirstLoader(ClassLoader parent) { super(parent); }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        if (name.startsWith("java.")) {
            return super.loadClass(name, resolve);   // still must delegate for java.*
        }
        // child-first for everything else — try to define it ourselves before asking the parent
        try {
            return findClass(name);
        } catch (ClassNotFoundException e) {
            return super.loadClass(name, resolve);
        }
    }
}
```

Se esse loader tentasse fazer `defineClass("java.lang.String", bytes, 0, bytes.length)` mesmo assim, a JVM rejeitaria de imediato:

```
java.lang.SecurityException: Prohibited package name: java.lang
```

A ordem de delegação é uma escolha de política que um loader pode sobrepor; a proibição de definir classes em pacotes de sistema protegidos é aplicada de forma independente, no próprio `defineClass`.

### Escrevendo um ClassLoader customizado: findClass, defineClass e um loader de plugins

Um loader customizado quase sempre sobrescreve `findClass`, não `loadClass` — isso mantém intacta a lógica de delegação parent-first e só muda *de onde vêm os bytes* quando a delegação falha. O objeto `Class` propriamente dito é criado com o `defineClass` herdado:

```java
public class PluginClassLoader extends ClassLoader {
    private final Path pluginDir;

    public PluginClassLoader(Path pluginDir, ClassLoader parent) {
        super(parent);
        this.pluginDir = pluginDir;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        Path classFile = pluginDir.resolve(name.replace('.', '/') + ".class");
        try {
            byte[] bytes = Files.readAllBytes(classFile);
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

```java
PluginClassLoader loader = new PluginClassLoader(Path.of("plugins/report-exporter"), 
                                                   PluginClassLoader.class.getClassLoader());
Class<?> pluginClass = loader.loadClass("com.example.plugin.ReportExporterPlugin");
Plugin plugin = (Plugin) pluginClass.getDeclaredConstructor().newInstance();
plugin.run();
```

Essa é a forma padrão de uma arquitetura de plugins: cada plugin ganha seu próprio loader, então dois plugins podem depender cada um de uma versão diferente da mesma biblioteca sem colidir. Criar uma *nova* instância de `PluginClassLoader` e recarregar o mesmo nome de classe também é como funciona o hot-reload — a JVM não "recarrega" uma classe no lugar; uma nova definição do mesmo nome, carregada por uma nova instância de loader, é simplesmente um objeto `Class` distinto vivendo ao lado (ou substituindo todas as referências a) do antigo, que se torna elegível para garbage collection assim que nada mais o referenciar.

### ClassNotFoundException vs. NoClassDefFoundError

`ClassNotFoundException` é uma exceção checked lançada quando código explicitamente *pede* para carregar uma classe pelo nome e esse nome não consegue ser resolvido — tipicamente `Class.forName(...)` ou `ClassLoader.loadClass(...)`:

```java
try {
    Class.forName("com.example.MissingPlugin");
} catch (ClassNotFoundException e) {
    // the requested class genuinely does not exist anywhere on the search path
}
```

`NoClassDefFoundError` é um `Error` unchecked, lançado quando a JVM tenta carregar uma classe *implicitamente* — como efeito colateral de executar outro código que a referencia — e essa tentativa falha, mesmo que a classe existisse e tivesse feito o linking corretamente em tempo de compilação. A causa mais comum na prática é um JAR de dependência presente em tempo de compilação, mas ausente do classpath em runtime. Uma causa mais sutil é uma classe cujo inicializador estático já falhou uma vez:

```java
class Broken {
    static {
        if (true) throw new RuntimeException("boom");
    }
}

public class Demo {
    public static void main(String[] args) {
        try {
            new Broken();                      // first attempt: static init runs and throws
        } catch (ExceptionInInitializerError e) {
            System.out.println("first: " + e.getCause());
        }
        try {
            new Broken();                      // second attempt: init is NOT retried
        } catch (NoClassDefFoundError e) {
            System.out.println("second: " + e.getMessage());
            // second: Could not initialize class Broken
        }
    }
}
```

Depois que a inicialização de uma classe falha, a JVM a marca como permanentemente errônea — ela nunca tenta rodar o inicializador estático de novo, e toda tentativa posterior de usar a classe lança `NoClassDefFoundError` em vez de reexecutar (e falhar de novo) o mesmo código.

### ClassCastException entre dois loaders: identidade inclui o loader

A noção da JVM de "o mesmo tipo" é `(nome totalmente qualificado, ClassLoader que o define)`, não só o nome. Carregue os mesmos bytes `.class` através de duas instâncias de loader diferentes e você obtém dois tipos distintos e mutuamente incompatíveis:

```java
ClassLoader loaderA = new PluginClassLoader(pluginDir, parent);
ClassLoader loaderB = new PluginClassLoader(pluginDir, parent);

Class<?> widgetA = loaderA.loadClass("com.example.Widget");
Class<?> widgetB = loaderB.loadClass("com.example.Widget");

Object instance = widgetA.getDeclaredConstructor().newInstance();

widgetB.cast(instance);
// java.lang.ClassCastException: class com.example.Widget cannot be cast to class
//   com.example.Widget (com.example.Widget is in unnamed module of loader
//   PluginClassLoader @1b6d3586; com.example.Widget is in unnamed module of loader
//   PluginClassLoader @4f2a9c11)
```

Ambas as classes se chamam `com.example.Widget`, compiladas exatamente do mesmo código-fonte — a JVM ainda assim as trata como tipos não relacionados porque foram definidas por instâncias de loader diferentes. Esse é o modo de falha clássico em application servers e sistemas de plugins estilo OSGi: uma interface compartilhada carregada uma única vez por um ancestral comum funciona bem, mas uma classe de implementação carregada por acidente duas vezes — uma vez por loader de plugin em vez de uma única vez, compartilhada — quebra qualquer código que tente fazer cast entre as duas cópias.

## Trade-offs

- **Quebrar a delegação parent-first para sombrear uma classe do JDK não funciona de fato** — mesmo um loader child-first é bloqueado de definir uma classe em um pacote protegido como `java.lang`:

```
java.lang.SecurityException: Prohibited package name: java.lang
```

- **Um class loader vivo mantém tudo que carregou vivo** — todo `Class` que um loader definiu, e todo campo estático que essas classes mantêm, permanece alcançável enquanto o próprio loader for alcançável. Um sistema de plugins que esquece de soltar sua última referência a um `PluginClassLoader` depois de descarregar um plugin vaza o grafo de classes inteiro do plugin e seu estado estático pela vida inteira da JVM; essa é uma causa real e recorrente de `OutOfMemoryError: Metaspace` em app servers de longa duração que recarregam plugins ou aplicações web repetidamente.
- **A mesma classe carregada por dois loaders é dois tipos incompatíveis** — um bug sutil e difícil de identificar quando um serviço "singleton" ou uma interface compartilhada acaba sendo carregada duas vezes em vez de uma:

```java
widgetB.cast(instance); // ClassCastException, even though both classes are named identically
```

- **`NoClassDefFoundError` depois de um inicializador estático que falhou pode enganar a depuração** — o *primeiro* stack trace (`ExceptionInInitializerError`, com a causa real) é o que vale a pena guardar; todo `NoClassDefFoundError: Could not initialize class ...` subsequente para a mesma classe é só a JVM se recusando a tentar de novo, e perseguir esse em vez da causa original é perda de tempo.
- **Chamadas customizadas a `defineClass` aceitam bytecode arbitrário** — um loader de plugins que lê arquivos `.class` de um diretório com permissão de escrita é, na prática, uma superfície de execução de código arbitrário; a verificação (a fase de "linking") pega bytecode estruturalmente malformado, mas não diz nada sobre o que uma classe bem formada, porém maliciosa, foi projetada para fazer em runtime.
- **Inicialização preguiçosa é fácil de raciocinar errado** — assumir que referenciar uma classe sempre executa seu inicializador estático leva a surpresas com constantes de tempo de compilação, que são incorporadas por inlining no ponto de chamada e nunca disparam o carregamento da classe que as declara.

## Documentation Links

- [The Java Virtual Machine Specification — Chapter 5: Loading, Linking, and Initializing](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html) — doc
- [ClassLoader — Java SE 25 API Documentation](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassLoader.html) — doc
