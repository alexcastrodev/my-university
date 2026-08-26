---
version: 1.0
updatedAt: 2026-08-21
title: "Object.clone() e o Anti-Padrão Cloneable"
summary: Object.clone() e a interface marcadora Cloneable realizam uma cópia rasa que ignora o construtor, com armadilhas estruturais envolvendo herança e campos final, que copy constructors e static factories evitam.
---
## Objective

`Object` declara um método `protected native`, `clone()`, que produz uma cópia campo a campo de um objeto sem chamar nenhum construtor. `Cloneable` é a interface marcadora que habilita uma classe a usar esse mecanismo — ela não declara método algum, então implementá-la não muda nada na API de uma classe; ela apenas ativa uma checagem em tempo de execução dentro de `Object.clone()`. A cópia padrão que `clone()` realiza é *rasa*: campos primitivos são copiados por valor, mas qualquer campo que contenha uma referência — uma `List`, um `Map`, um array — acaba compartilhado entre o original e o clone, o que raramente é o que se deseja. Fazer um clone correto e profundo significa sobrescrever `clone()` manualmente, e mesmo assim o mecanismo tem problemas estruturais — construtores ignorados, fragilidade na herança e um conflito direto com campos `final` mutáveis — que o tornam uma escolha padrão ruim para código novo.

## Use Cases

- Ler código legado ou interno do JDK que ainda implementa `Cloneable` — `ArrayList`, `HashMap` e `Date` implementam — e precisar saber o que `someList.clone()` de fato copia e o que deixa compartilhado.
- Clonar um array rapidamente: `int[] copy = original.clone();` é um dos poucos lugares onde o mecanismo embutido é genuinamente idiomático, sem boilerplate.
- Questões no estilo de certificação (OCP) que testam se o entendimento de aliasing por cópia rasa está correto — mutar o campo de lista de um clone e observar que o original também muda.
- Reconhecer quando o `clone()` sobrescrito de uma classe é inseguro, para poder substituí-lo por um copy constructor ou por uma static factory de cópia, em vez de confiar nele como está.

## Deep Dive

### Cloneable é uma interface marcadora — não declara métodos

```java
public interface Cloneable {
}
```

Essa é a interface inteira — sem método `clone()`, sem membros abstratos, nada. Implementar `Cloneable` não dá à classe um método `clone()` nem obriga a escrever um; `clone()` já existe em todo objeto, herdado de `Object`. O que `Cloneable` de fato faz é puramente um sinal em tempo de execução: a implementação nativa de `Object.clone()` verifica `this instanceof Cloneable` antes de copiar qualquer coisa, e reage de forma diferente dependendo da resposta.

### clone() é protected e native — pular Cloneable lança exceção em tempo de execução, não de compilação

```java
public class Team {
    private String name;

    public Team(String name) {
        this.name = name;
    }

    @Override
    public Team clone() throws CloneNotSupportedException {
        return (Team) super.clone();   // compiles fine — Team does NOT implement Cloneable
    }
}
```

Sobrescrever `clone()` e ampliar sua visibilidade para `public` compila sem reclamação — Java permite que uma sobrescrita relaxe o acesso, e declarar `throws CloneNotSupportedException` satisfaz a exceção checada que `Object#clone()` declara. O problema só aparece quando o código roda:

```java
new Team("Backend").clone();
// throws java.lang.CloneNotSupportedException: Team
```

O código nativo de `Object.clone()` realiza a checagem `instanceof Cloneable` e lança `CloneNotSupportedException` quando ela falha. Nada relacionado à interface ausente é capturado pelo `javac` — `Team` compila, faz o link, e só falha na primeira vez que `clone()` de fato executa.

### A cópia padrão é rasa — campos de referência acabam compartilhados

Implementar `Cloneable` resolve a exceção, mas a cópia de `super.clone()` continua sendo campo a campo: um campo de referência é copiado como referência, não como um novo objeto.

```java
public class Team implements Cloneable {
    private String name;
    private List<String> members;

    public Team(String name, List<String> members) {
        this.name = name;
        this.members = new ArrayList<>(members);
    }

    public void addMember(String member) { members.add(member); }
    public List<String> members()        { return members; }

    @Override
    public Team clone() {
        try {
            return (Team) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);   // can't happen — this class implements Cloneable
        }
    }
}
```

```java
Team original = new Team("Backend", List.of("Ana"));
Team copy = original.clone();

copy.addMember("Bo");

original.members();   // ["Ana", "Bo"] — mutating the clone changed the original too
```

`super.clone()` copiou o campo `members` da mesma forma que copiou `name`: por valor. Para `name` esse valor é uma referência `String` a um objeto imutável, então compartilhá-lo é inofensivo. Para `members` o valor é uma referência ao *mesmo* `ArrayList`, então `original` e `copy` são, logo após a clonagem, dois objetos apontando para uma lista mutável em comum. `copy.addMember("Bo")` muta essa lista compartilhada, e `original` vê a mudança mesmo que nada tenha sido chamado nele diretamente.

### Corrigindo o alias: clonar também o campo mutável

```java
@Override
public Team clone() {
    try {
        Team copy = (Team) super.clone();
        copy.members = new ArrayList<>(this.members);   // deep-copy the mutable field
        return copy;
    } catch (CloneNotSupportedException e) {
        throw new AssertionError(e);
    }
}
```

```java
Team original = new Team("Backend", List.of("Ana"));
Team copy = original.clone();

copy.addMember("Bo");

original.members();   // ["Ana"] — copy now owns its own List
copy.members();        // ["Ana", "Bo"]
```

Isso só funciona porque `members` não é `final` aqui — `copy.members = ...` é uma simples reatribuição de campo depois que `super.clone()` já rodou. Todo campo de referência que é mutável precisa ser encontrado e recopiado manualmente dessa forma; `super.clone()` não ajuda em nada a identificar quais campos precisam disso, e esquecer um deles reintroduz o bug de aliasing silenciosamente.

### clone() nunca executa um construtor — invariantes garantidas nele são puladas

```java
public class Team implements Cloneable {
    private static int instancesCreated = 0;

    private final String id;
    private String name;

    public Team(String name) {
        this.name = name;
        this.id = "team-" + (++instancesCreated);   // invariant: every Team gets a fresh, unique id
    }

    @Override
    public Team clone() {
        try {
            return (Team) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

```java
Team original = new Team("Backend");
Team copy = original.clone();

copy.id.equals(original.id);   // true — copy got original's id verbatim, no new one was minted
```

`instancesCreated` não é incrementado pelo clone, e `id` não é regenerado — `super.clone()` copia o que quer que `id` já contivesse. A linha `this.id = "team-" + (++instancesCreated)` só roda dentro de `new Team(...)`, e um clone nunca passa por `new`. Qualquer lógica que um construtor seja responsável por garantir — atribuir um id, registrar a instância em algum lugar, validar argumentos — é silenciosamente ignorada para todo clone.

### Frágil em hierarquias de herança: a cadeia só funciona se toda subclasse cooperar

```java
public class ProjectTeam extends Team {
    private String projectCode;

    public ProjectTeam(String name, List<String> members, String projectCode) {
        super(name, members);
        this.projectCode = projectCode;
    }

    @Override
    public ProjectTeam clone() {
        // does NOT call super.clone() — builds a fresh instance through the constructor instead
        return new ProjectTeam(name(), members(), projectCode);
    }
}
```

Isso compila e até "parece" razoável, mas quebra o padrão do qual `Team.clone()` depende: passa de novo pelo construtor (reintroduzindo o problema de regeneração de id, só que para essa subclasse), e qualquer código mais abaixo na hierarquia que espere que `super.clone()` tenha produzido uma cópia byte a byte de `Object.clone()` dos próprios campos recebe outra coisa em vez disso. Nada obriga que toda sobrescrita em uma hierarquia chame `super.clone()` com o tipo de retorno covariante — uma única subclasse que não o faça quebra a cadeia para todas as classes abaixo dela, e o compilador não avisa em nenhum dos dois casos.

### Campos mutáveis final não podem ser profundamente copiados dentro de clone()

```java
public class Team implements Cloneable {
    private final List<String> tags;

    public Team(List<String> tags) {
        this.tags = new ArrayList<>(tags);
    }

    @Override
    public Team clone() {
        try {
            Team copy = (Team) super.clone();
            copy.tags = new ArrayList<>(this.tags);   // does not compile
            return copy;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

```
error: cannot assign a value to final variable tags
            copy.tags = new ArrayList<>(this.tags);
                ^
```

`super.clone()` já atribuiu `tags` uma vez — copiando a referência de forma rasa — e `tags` é `final`, então `clone()` não pode reatribuí-lo a uma cópia profunda depois. As únicas saídas são remover `final` de `tags` (perdendo a garantia de que o campo nunca muda após a construção) ou aceitar a referência compartilhada e aliasável que `super.clone()` produziu. De qualquer forma, o campo não pode ser ao mesmo tempo `final` e clonado com segurança dentro de `clone()`.

## Trade-offs

- **`clone()` força boilerplate de exceção e cast em toda sobrescrita, onde um copy constructor não precisa de nenhum.** `Object#clone()` é declarado para lançar a exceção checada `CloneNotSupportedException`, então uma implementação que nunca pode de fato encontrá-la ainda tem que capturá-la e relançar como algo unchecked:
  ```java
  catch (CloneNotSupportedException e) { throw new AssertionError(e); }
  // vs. a copy constructor, which needs no try/catch at all:
  public Team(Team other) { this.name = other.name; this.members = new ArrayList<>(other.members); }
  ```
- **Clonar pula o construtor por completo, então invariantes garantidas nele não rodam em um clone** — mostrado acima com o campo `id` nunca sendo regenerado. Toda classe que depende do construtor para validação ou setup precisa duplicar essa lógica dentro de `clone()`, ou aceitar que clones podem não satisfazê-la.
- **O mecanismo só continua correto se toda classe na cadeia de herança chamar `super.clone()`** — uma subclasse que constrói uma instância nova com `new` em vez disso quebra a cadeia para tudo abaixo dela, e nada na linguagem detecta o erro.
- **Um campo mutável `final` não pode ser profundamente copiado dentro de `clone()`** — `super.clone()` já o atribuiu uma vez, e reatribuir um campo `final` depois é um erro de compilação, então o campo fica preso compartilhando uma referência com o original:
  ```java
  copy.tags = new ArrayList<>(this.tags);
  // error: cannot assign a value to final variable tags
  ```
- **Arrays são o único lugar onde `clone()` é genuinamente idiomático.** `array.clone()` retorna uma cópia independente e com tipo covariante, sem nenhum do boilerplate acima — `int[] copy = original.clone();` é mais simples do que qualquer alternativa manual, justamente porque arrays não têm construtor a ignorar nem subclassing a se preocupar.
- **Um copy constructor ou uma static factory de cópia é a escolha padrão preferível para classes comuns.** `new Team(existing)` ou `Team.copyOf(existing)` passam pelo construtor de verdade — invariantes rodam, campos `final` podem ser atribuídos livremente porque é o construtor quem está atribuindo, e nenhum `Cloneable`, nenhum cast e nenhuma cooperação de subclasses é necessária. Veja "Immutable Classes and Defensive Copying" para como copiar um campo mutável com segurança na entrada, e "Static Factory Methods and the Builder Pattern" para as convenções de nomenclatura que um método de fábrica que produz cópias deve seguir.

## Documentation Links

- [Object#clone()](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#clone()) — doc
- [Cloneable](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Cloneable.html) — doc
- [CloneNotSupportedException](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/CloneNotSupportedException.html) — doc
