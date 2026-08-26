---
version: 1.0
updatedAt: 2026-08-13
title: Singletons e Classes Utilitárias Não Instanciáveis
summary: Compare as três formas de escrever um singleton em Java — campo público, static factory, enum de um único elemento — e o idioma do construtor privado para classes utilitárias não instanciáveis.
---
## Objective

Um singleton garante que exista exatamente uma instância de uma classe durante toda a vida da JVM — útil para componentes que são intrinsecamente únicos, como um registro de configuração ou um gerenciador de conexões. Java oferece três formas de construir um: um campo `public static final`, um método static factory, e um `enum` de um único elemento. Um problema relacionado, mas distinto, é a classe utilitária não instanciável — um agrupamento puro de membros `static`, como `java.lang.Math`, que nunca deveria ser instanciada. Ambos os problemas são resolvidos controlando o acesso ao construtor, mas só uma das três formas de singleton é realmente segura contra reflection.

## Use Cases

- Um único recurso compartilhado que não pode ter instâncias concorrentes — um gerenciador de thread pool, um cache em memória, um event bus de escopo da aplicação inteira.
- Modelar um componente de sistema que é intrinsecamente único, como um window manager ou uma interface de hardware, onde uma segunda instância não faria sentido.
- Agrupar métodos auxiliares sem estado sobre primitivos, arrays, ou uma família relacionada de objetos — `Math`, `Collections`, `Arrays` — onde instanciar não faria sentido.
- Qualquer classe construída inteiramente de métodos static factory para uma interface compartilhada, onde a própria classe nunca deve guardar estado.

## Deep Dive

### Três formas de escrever um singleton

As duas primeiras abordagens mantêm o construtor `private` e expõem a instância única através de um membro estático público — um campo ou um método:

```java
// Singleton with a public final field
public class Elvis {
    public static final Elvis INSTANCE = new Elvis();
    private Elvis() { }

    public void leaveTheBuilding() { }
}

// Singleton with a static factory method
public class Elvis {
    private static final Elvis INSTANCE = new Elvis();
    private Elvis() { }

    public static Elvis getInstance() { return INSTANCE; }

    public void leaveTheBuilding() { }
}
```

Ambas garantem exatamente uma instância em uso normal — o construtor privado roda exatamente uma vez, para inicializar o campo estático. A forma com método factory tem uma vantagem prática: ela pode mudar de estratégia depois (retornar uma instância por thread, um mock para testes, etc.) sem tocar nos pontos de chamada, já que os chamadores só veem `Elvis.getInstance()`.

A terceira forma, disponível desde o Java 5, é um `enum` de um único elemento:

```java
public enum Elvis {
    INSTANCE;

    public void leaveTheBuilding() { }
}
```

Isso é funcionalmente equivalente à forma com campo público, mas é a própria JVM que garante a propriedade de singleton, em vez de depender da disciplina do construtor — o que importa assim que reflection e serialização entram em cena.

### O ataque de reflection contra um construtor privado

`AccessibleObject.setAccessible(true)` permite que código contorne as checagens de acesso normais do Java e chame um construtor `private` diretamente. Contra o `Elvis` baseado em campo ou factory, isso cria uma segunda instância e quebra a garantia de singleton completamente:

```java
Constructor<Elvis> ctor = Elvis.class.getDeclaredConstructor();
ctor.setAccessible(true);           // suppress the access check
Elvis clone = ctor.newInstance();   // succeeds — a second Elvis now exists

System.out.println(Elvis.INSTANCE == clone);   // false
```

Desde o JDK 9, o sistema de módulos reduz essa superfície de ataque, mas não a fecha para o código de aplicação típico: `setAccessible(true)` lança `InaccessibleObjectException` só quando a classe alvo vive em um módulo nomeado cujo pacote não foi `opened` para o módulo do chamador. Código que não roda com fronteiras de `module-info.java` em vigor — o caso comum para lógica de aplicação/negócio vivendo no módulo não nomeado — não recebe essa proteção, e o ataque acima continua funcionando.

Defender as formas de campo/factory exige código extra dentro do próprio construtor:

```java
private Elvis() {
    if (INSTANCE != null) {
        throw new IllegalStateException("Already instantiated");
    }
}
```

Isso fecha a brecha, mas é uma disciplina que o autor precisa lembrar de adicionar — não é o padrão.

### Por que a forma enum não precisa dessa defesa

Chamar `Constructor.newInstance()` no construtor de uma constante enum não cria uma segunda instância como acontece com `Elvis` — falha imediatamente. Segundo a documentação de `Constructor.newInstance`, ela lança `IllegalArgumentException` sempre que o alvo "pertence a uma classe enum", independentemente de `setAccessible(true)` ter tido sucesso antes:

```java
public enum ElvisEnum { INSTANCE }

Constructor<?> ctor = ElvisEnum.class.getDeclaredConstructor(String.class, int.class);
ctor.setAccessible(true);
ElvisEnum clone = (ElvisEnum) ctor.newInstance("FAKE", 1);
// IllegalArgumentException: Cannot reflectively create enum objects
```

Essa checagem é aplicada pela própria API de reflection, independente de fronteiras de módulo — funciona da mesma forma em uma aplicação modular ou não modular. `Enum` também sobrescreve `clone()` para lançar `CloneNotSupportedException` incondicionalmente, fechando a outra forma comum de criar uma segunda instância, e seu construtor `protected Enum(String, int)` é documentado como sendo apenas para código gerado pelo compilador, não para uso do programador.

### Por que a forma enum também é segura contra serialização de graça

Fazer o `Elvis` baseado em campo ou factory implementar `Serializable` não basta, por si só, para preservar a garantia de singleton: deserializar um stream produz uma instância totalmente nova, construída a partir dos dados do stream, contornando o construtor completamente. A correção documentada é um método `readResolve` que troca pela instância canônica:

```java
private Object readResolve() {
    return INSTANCE;   // let the deserialized impersonator be garbage-collected
}
```

Todo campo também precisa ser marcado `transient`, ou uma referência vazada ao impostor ainda pode surgir antes de `readResolve` rodar. `Serializable` documenta isso como um dos vários métodos hook especiais de serialização (junto com `writeReplace`) que uma classe pode optar por usar.

Para tipos enum, nada disso é necessário. A documentação de `Serializable` afirma que tipos enum "recebem um tratamento definido pela Java Object Serialization Specification durante a serialização e a deserialização", e que "quaisquer declarações dos métodos especiais de tratamento discutidos acima são ignoradas para tipos enum" — um `readResolve` escrito em um enum simplesmente não tem efeito, porque a JVM já serializa uma constante enum escrevendo apenas seu nome e reconstruindo-a via `Enum.valueOf` na leitura, sem nunca rodar de novo um construtor. Não há impostor algum para resolver.

### Garantindo a não instanciabilidade de uma classe utilitária

Uma classe como `Math` ou `Collections` é um agrupamento puro de membros `static` e nunca foi pensada para ser instanciada. Deixá-la sem um construtor explícito não alcança isso — o compilador fornece silenciosamente um construtor público sem argumentos, então código no estilo `new Math()` compila mesmo sem fazer sentido algum:

```java
public class UtilityClass {
    // no constructor declared — compiler generates a public no-arg one
}

new UtilityClass();   // compiles, produces a pointless instance
```

Tornar a classe `abstract` também não resolve — ela ainda pode ser estendida, e a subclasse instanciada, o que também induz o leitor a pensar que a classe foi projetada para extensão. O idioma que funciona é um construtor `private` que lança exceção se for invocado, inclusive de dentro da própria classe:

```java
public class UtilityClass {
    // Suppress the default constructor; this class is not instantiable.
    private UtilityClass() {
        throw new AssertionError();
    }

    public static int square(int n) {
        return n * n;
    }
}

new UtilityClass();   // compile error: UtilityClass() has private access
```

Como o único construtor é `private`, nenhuma subclasse tem um construtor de superclasse acessível para chamar, então isso também bloqueia a criação de subclasses como efeito colateral. O `AssertionError` não é essencial para chamadores externos — eles já são bloqueados em tempo de compilação — mas ele protege contra uma chamada interna acidental (por exemplo, de outro construtor via `this()`) e documenta a intenção para quem lê o código-fonte.

## Trade-offs

- **O singleton por enum é a única forma imune a ambos os ataques sem código extra** — as formas de campo e factory precisam de uma guarda manual contra construção reflexiva e de um `readResolve` mais campos `transient` para sobreviver à serialização com segurança; a forma enum ganha ambas de graça, vindas da linguagem e da spec de serialização.
- **A sintaxe de enum lê de forma incomum para algo que conceitualmente não é um conjunto de constantes** — `public enum Elvis { INSTANCE; ... }` é um enum de um único elemento representando uma classe, o que pode parecer estranho da primeira vez, mesmo compilando para o mesmo tipo de tipo que qualquer outro enum.
- **A forma com método factory é a única que pode mudar sua estratégia de retorno sem uma mudança de API** — os chamadores só veem `Elvis.getInstance()`, então a implementação poderia depois devolver uma instância por thread ou um double de teste; um campo `public static final` compromete os chamadores com exatamente a mesma referência para sempre.
- **Um construtor privado que lança exceção também bloqueia a criação de subclasses, não só a instanciação** — isso geralmente é o objetivo para uma classe utilitária, mas significa que o padrão é inadequado para qualquer classe em que a extensão seja pretendida mais tarde.
  ```java
  public class SubUtility extends UtilityClass { }
  // compile error: implicit super() call has no accessible UtilityClass() to invoke
  ```
- **A restrição de módulo do `setAccessible` não é uma correção geral** — `InaccessibleObjectException` só protege classes dentro de um módulo nomeado cujo pacote não está aberto ao chamador; código no módulo não nomeado (o caso comum de código de aplicação sem `module-info.java`) não recebe proteção nenhuma disso, então não é um substituto para escolher a forma enum ou adicionar uma guarda explícita.

## Documentation Links

- [Enum — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html) — doc
- [Constructor.newInstance() — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Constructor.html#newInstance(java.lang.Object...)) — doc
- [AccessibleObject.setAccessible() — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AccessibleObject.html#setAccessible(boolean)) — doc
- [InaccessibleObjectException — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/InaccessibleObjectException.html) — doc
- [Serializable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [Java Object Serialization Specification](https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/index.html) — doc
