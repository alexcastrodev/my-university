---
version: 1.0
updatedAt: 2026-08-05
title: Annotations: Retention, Meta-Annotations e Reflection
summary: Como @Retention/RetentionPolicy controlam se uma annotation sobrevive além do código-fonte, as meta-annotations @Target/@Inherited/@Repeatable, a leitura de annotations em tempo de execução via AnnotatedElement, e as annotations embutidas @Deprecated/@SafeVarargs/@FunctionalInterface/@Documented.
---
## Objective

Uma annotation embute metadados suplementares no código-fonte sem mudar a semântica do programa — é declarada com `@interface`, aplicada com `@Nome(...)` antes de uma declaração, e lida por ferramentas, pelo compilador, ou pelo seu próprio código via reflection. Annotations são construídas sobre o mecanismo de `interface`: toda annotation implicitamente estende `java.lang.annotation.Annotation`, e seus membros se comportam como campos somente-leitura em vez de métodos que você implementa.

## Use Cases

- Marcar uma intenção para o compilador verificar, como `@Override` capturando uma assinatura de método digitada errado que de outra forma se tornaria silenciosamente um overload em vez de um override.
- Direcionar frameworks que escaneiam classes na inicialização — injeção de dependência, mapeamento de entidades ORM, roteamento REST — onde a annotation carrega configuração (`@Column("user_id")`, `@RequestMapping("/users")`) lida via reflection.
- Suprimir ou documentar um warning conhecido do compilador no escopo mais restrito possível (`@SuppressWarnings("unchecked")`) em vez de desabilitá-lo no projeto inteiro.
- Construir seus próprios metadados leves para validação, serialização, ou frameworks de teste — por exemplo, um `@Test` ou `@NotNull` customizado que um runner ou validador inspeciona com `getAnnotation()`.

## Deep Dive

### Declarando uma annotation e suas três formas de uso

Um tipo de annotation é declarado como uma interface, prefixado com `@`:

```java
@interface MyAnno {
    String str();
    int val() default 1;
}
```

Os membros parecem métodos abstratos mas se comportam como campos quando a annotation é aplicada — sem corpo, sem parâmetros, e o tipo de retorno deve ser um primitivo, `String`, `Class`, um `enum`, outra annotation, ou um array de um desses.

Há três formas de aplicá-la, e qual delas você escreve depende apenas de quais membros existem:

```java
// normal form — every member named explicitly
@MyAnno(str = "Annotation Example", val = 100)
void myMeth() { }

// single-member form — legal only if the sole member (or the only one without
// a default) is named "value"; the name is then omitted at the call site
@interface MySingle { int value(); }

@MySingle(100)
void myMeth2() { }

// marker form — zero members, presence alone is the signal
@interface MyMarker { }

@MyMarker
void myMeth3() { }
```

Um membro pode declarar um `default`, então quem chama só precisa sobrescrever os que forem diferentes:

```java
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}

@MyAnno                          // both defaults
@MyAnno(str = "Hi")               // val defaults to 9000
@MyAnno(val = 88)                 // str defaults to "Testing"
@MyAnno(str = "Hi", val = 88)     // both explicit
```

### Meta-annotations: `@Retention`, `@Target`, `@Inherited`

Meta-annotations — annotations que anotam outras declarações de annotation — controlam como e onde uma annotation pode ser usada.

`@Target` restringe em quais tipos de declaração uma annotation é válida, usando constantes de `ElementType`:

```java
@Target({ ElementType.FIELD, ElementType.LOCAL_VARIABLE })
@interface FieldOnly { }
```

Sem um `@Target` explícito, a annotation é válida em qualquer **declaração** — classes, métodos, campos, parâmetros, até outras declarações de annotation — mas não em contextos de type-use (por exemplo, `List<@MyAnno String>`), o que raramente é o que se quer, então é boa prática sempre especificar um.

`@Inherited` afeta apenas annotations colocadas em declarações de classe: se uma subclasse não carrega a annotation por si mesma, uma busca sobe até a superclasse e retorna sua annotation marcada com `@Inherited` em vez de `null`.

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@interface Auditable { }

@Auditable
class Base { }

class Derived extends Base { }   // Derived.class.getAnnotation(Auditable.class) still finds it
```

### Políticas de retenção: SOURCE, CLASS, RUNTIME

`@Retention`, apoiado pelo enum `java.lang.annotation.RetentionPolicy`, decide por quanto tempo uma annotation sobrevive além do arquivo-fonte:

| Política | Sobrevive à compilação? | Visível para a JVM em tempo de execução? |
|---|---|---|
| `SOURCE` | Não — descartada assim que o compilador termina (por exemplo, `@Override`, `@SuppressWarnings`) | Não |
| `CLASS` (padrão se `@Retention` for omitido) | Sim, gravada no arquivo `.class` | Não |
| `RUNTIME` | Sim | Sim — consultável via reflection |

```java
@Retention(RetentionPolicy.RUNTIME)
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}
```

Apenas a retenção `RUNTIME` torna uma annotation alcançável via `getAnnotation()`/`getAnnotations()` — com retenção `SOURCE` ou `CLASS` essas chamadas simplesmente retornam `null` ou um array vazio, porque a JVM nunca carregou os dados da annotation em primeiro lugar.

### Lendo annotations em tempo de execução via reflection

`Class`, `Method`, `Field` e `Constructor` implementam todos `AnnotatedElement`, que declara `getAnnotation()`, `getAnnotations()`, e `isAnnotationPresent()`. O padrão é sempre: obter um objeto `Class`, obter o membro que interessa, e então consultá-lo.

```java
import java.lang.annotation.*;
import java.lang.reflect.*;

@Retention(RetentionPolicy.RUNTIME)
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}

class Meta {
    @MyAnno(str = "Annotation Example", val = 100)
    public static void myMeth() { }
}

public class AnnoDemo {
    public static void main(String[] args) throws NoSuchMethodException {
        Method m = Meta.class.getMethod("myMeth");

        if (m.isAnnotationPresent(MyAnno.class)) {
            MyAnno anno = m.getAnnotation(MyAnno.class);
            System.out.println(anno.str() + " " + anno.val());  // Annotation Example 100
        }
    }
}
```

`getMethod("myMeth")` precisa também dos objetos `Class` de quaisquer tipos de parâmetro — por exemplo, `getMethod("myMeth", String.class, int.class)` para um overload que recebe esses argumentos. `getAnnotation()` retorna `null` (não uma exceção) quando a annotation não está presente ou não tem retenção `RUNTIME`, então `isAnnotationPresent()` — ou uma checagem de null — deve proteger a chamada.

Uma annotation pode aparecer mais de uma vez no mesmo elemento se for marcada com `@Repeatable`, apontando para uma annotation-contêiner cujo `value()` guarda um array dela:

```java
@Retention(RetentionPolicy.RUNTIME)
@Repeatable(MyRepeatedAnnos.class)
@interface MyAnno2 {
    String str() default "Testing";
}

@Retention(RetentionPolicy.RUNTIME)
@interface MyRepeatedAnnos {
    MyAnno2[] value();
}

class Repeated {
    @MyAnno2(str = "First")
    @MyAnno2(str = "Second")
    public static void myMeth() { }
}

// reading them back:
Method m = Repeated.class.getMethod("myMeth");
for (MyAnno2 a : m.getAnnotationsByType(MyAnno2.class)) {
    System.out.println(a.str());   // First, then Second
}
```

`getAnnotation(MyRepeatedAnnos.class)` também funciona e retorna o contêiner segurando ambas, mas `getAnnotationsByType(MyAnno2.class)` lê através do contêiner automaticamente e devolve a annotation repetível diretamente.

### Annotations embutidas: `@Deprecated`, `@SafeVarargs`, `@FunctionalInterface`, `@Documented`

O JDK vem com várias annotations que não precisam de uma declaração customizada. `@Deprecated` marca um elemento como obsoleto e, desde o JDK 9, aceita dois elementos opcionais que tornam a própria depreciação legível por máquina:

```java
@Deprecated(since = "9", forRemoval = true)
public void oldMethod() { }
```

`since` registra a versão em que o elemento se tornou depreciado; `forRemoval = true` sinaliza a intenção de realmente removê-lo em uma versão futura (em contraste com uma API "depreciada mas que permanece") — ferramentas como `javac -Xlint:removal` e IDEs exibem essa distinção de forma diferente de um `@Deprecated` simples.

`@SafeVarargs` suprime o warning de "heap pollution" em um método/construtor varargs cujo parâmetro varargs tem um tipo genérico ou parametrizado, afirmando que o método não faz nada inseguro com esse array — válido apenas em métodos ou construtores `static`/`final`/`private`, já que sobrescrever poderia quebrar a garantia de segurança. `@FunctionalInterface` documenta (e faz o compilador reforçar) que uma interface declara exatamente um método abstrato, para que uma lambda ou method reference possa implementá-la — não muda o comportamento, mas um segundo método abstrato adicionado depois se torna um erro de compilação em vez de uma quebra silenciosa. `@Documented` marca uma annotation para que, quando aplicada a um elemento, ferramentas como `javadoc` a incluam na documentação gerada desse elemento — sem `@Documented`, a annotation continua totalmente funcional em compilação/execução, apenas fica invisível na documentação de API gerada.

## Trade-offs

- **A retenção `RUNTIME` custa uma sobrecarga pequena mas real de reflection toda vez que uma annotation é consultada** — tudo bem para um escaneamento único na inicialização (containers de DI, descoberta de testes), custoso se chamado em um hot loop. Prefira retenção `SOURCE` ou `CLASS` para annotations que só ferramentas ou o compilador precisam.
- **`getAnnotation()` retorna `null` em vez de lançar exceção quando a annotation está ausente ou tem a política de retenção errada**, o que produz silenciosamente uma `NullPointerException` duas linhas depois se você pular a checagem de presença.
  ```java
  MyAnno a = m.getAnnotation(MyAnno.class);   // null if retention isn't RUNTIME
  a.val();                                     // NullPointerException, not "annotation missing"
  ```
- **Omitir `@Target` torna uma annotation válida em qualquer tipo de declaração**, o que se lê como "anexe isso a qualquer coisa" mesmo quando apenas um posicionamento foi pretendido — uma forma fácil de acabar com uma annotation aplicada erroneamente a um campo quando ela foi projetada para métodos.
- **O tipo-contêiner de uma annotation repetível é uma declaração separada que você precisa manter em sincronia** — renomear ou reajustar o escopo da annotation repetível sem atualizar seu contêiner referenciado por `@Repeatable` quebra a compilação, não apenas no local de uso mas na própria declaração.
- **Valores de annotation precisam ser constantes em tempo de compilação** (primitivos, `String`, literais de `Class`, constantes de enum, ou arrays/annotations desses) — não há como passar um valor calculado em tempo de execução, o que empurra qualquer configuração dinâmica para fora da annotation e para o que quer que a leia.

## Documentation Links

- [java.lang.annotation package — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/package-summary.html) — doc
- [Retention — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Retention.html) — doc
- [RetentionPolicy — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/RetentionPolicy.html) — doc
- [Target — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Target.html) — doc
- [Repeatable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Repeatable.html) — doc
- [AnnotatedElement — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html) — doc
- [Deprecated — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Deprecated.html) — doc
- [Annotations (dev.java tutorials)](https://dev.java/learn/annotations/) — doc
