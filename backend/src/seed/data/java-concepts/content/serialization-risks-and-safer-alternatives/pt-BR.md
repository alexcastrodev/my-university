---
version: 1.0
updatedAt: 2026-08-13
title: "Serialization: Por Que É Perigosa e Como Conter o Risco"
summary: "Implementar Serializable ignora as checagens de invariantes do construtor da sua classe e expõe seus internos como API permanente — veja por que, e como disciplina no readObject, o padrão serialization proxy e o ObjectInputFilter contêm esse risco."
---
## Objective

`implements Serializable` parece uma decisão de uma linha só, mas é uma decisão permanente: a forma serializada padrão expõe o layout de campos privados de uma classe como parte da sua API para sempre, e — o problema mais grave — a deserialização fabrica objetos diretamente a partir de um byte stream sem nunca rodar o construtor da classe. Qualquer invariante que o construtor deveria garantir precisa ser reforçado manualmente, contra uma entrada totalmente controlada por um atacante. Isso não é uma nota de rodapé histórica; deserialização insegura de dados não confiáveis continua sendo uma classe de vulnerabilidade ativa hoje (ainda está nas categorias de risco da OWASP), e o JDK inclui um mecanismo de filtragem dedicado, `ObjectInputFilter`, especificamente para conter isso.

## Use Cases

- Decidir se uma classe nova deveria sequer implementar `Serializable` — classes de valor e simples carregadores de dados são candidatos razoáveis; classes que representam recursos ativos (thread pools, conexões) raramente deveriam.
- Reforçar qualquer classe que já implementa `Serializable` e tem invariantes (um campo não-nulo, uma checagem de intervalo, uma restrição de ordenação) que um byte stream forjado à mão poderia violar.
- Escolher entre lógica defensiva de `readObject` escrita manualmente e o padrão serialization proxy quando uma classe precisa continuar tanto serializável quanto segura contra entrada maliciosa.
- Configurar `ObjectInputFilter` em qualquer `ObjectInputStream` que vá deserializar dados de fora do processo atual — entrada de rede, arquivos enviados por upload, payloads de outro serviço.

## Deep Dive

### Por que `Serializable` é um compromisso maior do que parece

Dois custos se somam. Primeiro, a forma serializada padrão espelha os campos privados de uma classe, então esses campos viram parte da sua API exportada — reestruturar a representação interna depois pode quebrar silenciosamente a compatibilidade com instâncias já serializadas por uma versão anterior. Segundo, e mais perigoso: `ObjectInputStream.readObject()` constrói um objeto diretamente a partir de bytes e nunca chama o construtor da classe. Qualquer validação que o construtor faz é simplesmente pulada.

```java
public final class Range implements Serializable {
    private final int value;

    public Range(int value) {
        if (value <= 0) {
            throw new IllegalArgumentException("value must be positive");
        }
        this.value = value;
    }

    public int value() { return value; }
}
```

`new Range(-5)` não pode existir — o construtor proíbe isso. Mas um byte stream nunca passa por `new Range(...)`. Se você serializar um `Range` válido e depois corrigir manualmente os quatro bytes que contêm seu campo `int` antes de deserializar, `ObjectInputStream` devolve um `Range` com `value` negativo, sem nenhuma exceção lançada:

```java
byte[] bytes = serialize(new Range(1));      // a normal, valid instance
bytes[bytes.length - 1] = (byte) -5;         // hand-edit the trailing int byte

Range corrupted = (Range) new ObjectInputStream(
        new ByteArrayInputStream(bytes)).readObject();

System.out.println(corrupted.value());       // -5 — the constructor's check never ran
```

Isso espelha o ataque documentado do `Period` (Effective Java, Item 76): uma classe com um invariante real (`start` antes de `end`) se torna construível em um estado inválido apenas editando seus bytes serializados, porque quem de fato produz a instância é o `readObject` — não o construtor.

### `readObject` defensivo

`readObject` é efetivamente outro construtor público, então precisa da mesma disciplina: validar invariantes, e copiar defensivamente qualquer campo que segure uma referência a um objeto mutável ao qual o chamador não deveria conseguir chegar.

```java
public final class Period implements Serializable {
    private Date start;
    private Date end;

    public Period(Date start, Date end) {
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.compareTo(this.end) > 0) {
            throw new IllegalArgumentException(start + " after " + end);
        }
    }

    private void readObject(ObjectInputStream s)
            throws IOException, ClassNotFoundException {
        s.defaultReadObject();

        // defensively copy — otherwise a crafted stream can hand the caller
        // a live reference to these Date fields and mutate Period after the fact
        start = new Date(start.getTime());
        end = new Date(end.getTime());

        // re-check the invariant the constructor enforces
        if (start.compareTo(end) > 0) {
            throw new InvalidObjectException(start + " after " + end);
        }
    }
}
```

As duas etapas importam, e nessa ordem: copiar primeiro, validar as cópias depois — validar antes de copiar deixa uma janela onde uma segunda referência, ainda mutável, aos campos originais pode ser extraída do stream antes que a checagem rode. Sem a cópia, um atacante que consiga anexar referências extras ao stream pode obter os objetos `Date` vivos por trás de `start`/`end` e mutar um `Period` depois da construção, mesmo que seus campos pareçam imutáveis pela API pública.

### O padrão serialization proxy

`readObject` defensivo ainda precisa ser feito corretamente para cada invariante, e campos `final` não podem ser reatribuídos dentro dele — o exemplo `Period` acima teve que abrir mão de `final` para tornar a cópia possível. O padrão serialization proxy contorna isso: uma classe estática aninhada privada captura o estado lógico da classe externa, e a classe externa delega toda construção real de volta pelo seu construtor normal, que já reforça os invariantes.

```java
public final class Period implements Serializable {
    private final Date start;
    private final Date end;

    public Period(Date start, Date end) {
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.compareTo(this.end) > 0) {
            throw new IllegalArgumentException(start + " after " + end);
        }
    }

    // serialize the proxy instead of this instance
    private Object writeReplace() {
        return new SerializationProxy(this);
    }

    // block a forged stream from producing a Period directly
    private void readObject(ObjectInputStream stream) throws InvalidObjectException {
        throw new InvalidObjectException("Proxy required");
    }

    private static class SerializationProxy implements Serializable {
        private final Date start;
        private final Date end;

        SerializationProxy(Period p) {
            this.start = p.start;
            this.end = p.end;
        }

        // rebuild through the real constructor — invariants enforced normally
        private Object readResolve() {
            return new Period(start, end);
        }

        private static final long serialVersionUID = 234098243823485285L;
    }
}
```

Como o `readResolve` do proxy chama `new Period(start, end)`, a deserialização passa exatamente pela mesma validação que o construtor já faz — não há uma lógica de checagem de invariante separada para manter sincronizada, e `start`/`end` podem continuar `final`. O padrão não se aplica a classes que os clientes podem estender, e não pode ser usado se reconstruir o objeto dentro de `readResolve` exigir chamar um método em um objeto que ainda não está totalmente construído — mas, para uma classe final e autocontida com invariantes reais, ele elimina toda a categoria de ataques de stream forjado e roubo de campo descrita acima, sem checagens defensivas escritas à mão.

### A mitigação atual, nativa do JDK: `ObjectInputFilter`

Os ataques acima assumem que o atacante só consegue corromper dados pertencentes a uma classe que você já espera. Uma variante pior — execução remota de código baseada em deserialização via "gadget chains" — encadeia métodos `readObject` de classes já presentes no classpath para executar código arbitrário, e nenhuma quantidade de código defensivo dentro das suas próprias classes impede isso, porque o comportamento malicioso vive na classe de outra pessoa. É por isso que a orientação atual da Oracle sobre codificação segura trata deserializar dados não confiáveis como inerentemente perigoso, independentemente de quão cuidadosamente qualquer classe individual tenha sido escrita.

A resposta do JDK é `ObjectInputFilter`, adicionado no JDK 9 pela JEP 290 ("Filter Incoming Serialization Data"). Ele permite que um `ObjectInputStream` rejeite classes, tamanhos de array, profundidade de grafo ou tamanho de stream antes que um objeto seja instanciado:

```java
ObjectInputFilter filter =
        ObjectInputFilter.Config.createFilter("com.example.*;java.base/*;!*");

ObjectInputStream ois = new ObjectInputStream(inputStream);
ois.setObjectInputFilter(filter);   // reject anything not explicitly allowed
```

O padrão `com.example.*;java.base/*;!*` permite classes em `com.example` e no módulo `java.base`, e rejeita (`!*`) tudo o mais — uma allowlist em vez de uma blocklist, que é o padrão mais seguro para entrada não confiável.

O JDK 17 estendeu isso com a JEP 415 ("Context-Specific Deserialization Filters"), que adicionou uma *factory* de filtro configurável, em escopo de processo — um `BinaryOperator<ObjectInputFilter>` invocado sempre que qualquer `ObjectInputStream` é criado, para que uma aplicação possa instalar uma política global (ou variá-la por contexto) em vez de precisar lembrar de chamar `setObjectInputFilter` em cada stream individualmente:

```java
ObjectInputFilter.Config.setSerialFilterFactory(
        (current, next) -> next != null ? next : globalDefaultFilter);
```

Um filtro estático, em escopo de processo, também pode ser definido sem tocar em nenhum código, via `-Djdk.serialFilter=...` na linha de comando ou a system property `jdk.serialFilter` — útil para travar a deserialização em código cujo fonte você não controla.

## Trade-offs

- **Aceitar a forma serializada padrão trava seu layout interno de campos como API pública.** Renomear ou reestruturar um campo depois pode quebrar a deserialização de instâncias escritas por uma versão anterior da classe.
- **`readObject` defensivo exige abrir mão de `final` em qualquer campo que você precise reatribuir depois de copiar** — `start`/`end` de `Period` tiveram que deixar de ser `final` no exemplo do Effective Java especificamente para que `readObject` pudesse rebindá-los a novas cópias de `Date`.
- **O padrão serialization proxy não funciona para classes extensíveis ou grafos de objetos autorreferenciados** — ele exige que a classe externa seja efetivamente final, e `readResolve` não pode chamar de volta com segurança um objeto ainda não reconstruído.
- **Allowlists do `ObjectInputFilter` precisam ser mantidas conforme o grafo de classes muda** — um padrão de filtro como `com.example.*;java.base/*;!*` precisa ser atualizado sempre que uma classe legitimamente deserializada é adicionada, ou a deserialização passa a falhar também para dados válidos.
- **Um enum de um único elemento continua sendo a forma preferida de manter um singleton serializável seguro contra streams forjados** — escrever um `readResolve` manual em um singleton que não seja enum é frágil (o ataque `ElvisStealer` do Effective Java mostra um stream forjado roubando uma referência à instância "impostora" antes que `readResolve` rode); veja a cobertura de singleton por enum em `singleton-and-noninstantiable-classes` em vez de reintroduzir esse mecanismo aqui.

## Documentation Links

- [Serializable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [ObjectInputStream — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
- [ObjectInputFilter — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html) — doc
- [JEP 290: Filter Incoming Serialization Data](https://openjdk.org/jeps/290) — doc
- [JEP 415: Context-Specific Deserialization Filters](https://openjdk.org/jeps/415) — doc
- [Java Object Serialization Specification](https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/index.html) — doc
- [Secure Coding Guidelines for Java SE — Serialization](https://docs.oracle.com/pls/topic/lookup?ctx=javase25&id=secure_coding_guidelines_javase) — doc
