---
version: 1.0
updatedAt: 2026-08-13
title: "Sobrecarga de Métodos: Resolução em Tempo de Compilação e Suas Armadilhas"
summary: A resolução de sobrecarga acontece em tempo de compilação, com base no tipo declarado dos argumentos, e não no tipo em runtime — diferente do que ocorre com overriding — e essa diferença molda como as assinaturas de métodos deveriam ser projetadas.
---
## Objective

Overloading escolhe um método em **tempo de compilação**, com base no tipo *declarado* (estático) dos argumentos — não no tipo em runtime deles. Overriding, ao contrário, é resolvido em **runtime**, com base na classe real do objeto. Confundir os dois é a origem de uma surpresa clássica e reproduzível, e também molda como os parâmetros de um método deveriam ser projetados desde o início: prefira interfaces a classes concretas, e prefira enums a `boolean` quando o call site ficaria ilegível de outra forma.

## Use Cases

- Depurar uma chamada a um método sobrecarregado que "escolhe a versão errada" quando o argumento chega como uma variável tipada como supertipo (`Collection<?>`, `Object`, um número boxed).
- Decidir se um novo método deveria ser uma sobrecarga de um nome já existente ou um método com nome totalmente diferente.
- Projetar a assinatura de um método público de API: quantos parâmetros, quais tipos, `boolean` vs. enum.
- Revisar um PR que sobrecarrega um método com parâmetros `int` e `long`/`Integer`, e raciocinar sobre quais call sites são de fato seguros.

## Deep Dive

### Resolução de sobrecarga é estática; resolução de override é dinâmica

```java
public class CollectionClassifier {
    public static String classify(Set<?> s) {
        return "Set";
    }

    public static String classify(Collection<?> c) {
        return "Unknown Collection";
    }

    public static void main(String[] args) {
        Collection<?>[] collections = {
            new HashSet<String>(),
            new ArrayList<String>()
        };

        for (Collection<?> c : collections) {
            System.out.println(classify(c));   // both print "Unknown Collection"
        }
    }
}
```

A variável do loop `c` é *declarada* como `Collection<?>`, e esse tipo declarado é tudo o que o compilador olha ao resolver `classify(c)`. Não importa que o primeiro elemento seja, de fato, um `HashSet` em runtime — a única sobrecarga que o compilador consegue provar que se aplica a uma expressão tipada `Collection<?>` é `classify(Collection<?>)`, então é essa que fica gravada no bytecode em *ambos* os call sites. O resultado: `Unknown Collection` duas vezes, mesmo com um `Set` ali, bem na frente, em runtime.

Compare isso com overriding, que resolve exatamente ao contrário — pela classe real do objeto, ignorando o tipo declarado da variável:

```java
class Wine {
    String name() { return "wine"; }
}

class SparklingWine extends Wine {
    @Override String name() { return "sparkling wine"; }
}

public class Overriding {
    public static void main(String[] args) {
        Wine[] wines = { new Wine(), new SparklingWine() };
        for (Wine wine : wines) {
            System.out.println(wine.name());   // "wine", then "sparkling wine"
        }
    }
}
```

Aqui, toda variável do loop tem o *mesmo* tipo declarado, `Wine`, mas as duas chamadas imprimem coisas diferentes — porque `name()` é sobrescrito (overridden), e métodos sobrescritos despacham pelo tipo em runtime do receiver. Overloading faz o oposto: toda chamada acima compartilha o mesmo *comportamento* em runtime porque compartilha o mesmo tipo declarado, independentemente do tipo em runtime do argumento.

Se a intenção é realmente ramificar com base no tipo em runtime de um objeto, overloading não entrega isso — uma checagem explícita com `instanceof` sim:

```java
public static String classify(Collection<?> c) {
    return c instanceof Set ? "Set" : "Unknown Collection";
}
```

### Evitando a armadilha: não deixe a escolha de overload mudar o comportamento

O bug acima não é realmente sobre `Collection` — é sobre escrever sobrecargas com o mesmo nome que fazem coisas *significativamente diferentes* e depois chamá-las por uma variável tipada como um supertipo comum. Duas saídas possíveis:

**1. Dar nomes diferentes.** `ObjectOutputStream` não sobrecarrega `write` para cada tipo primitivo — ele expõe `writeBoolean(boolean)`, `writeInt(int)`, `writeLong(long)`, etc. Ninguém pode ser surpreendido sobre qual método roda, porque o call site já nomeia explicitamente qual é.

**2. Se precisarem compartilhar o nome, faça-as se comportarem de forma idêntica.** `String.contentEquals(StringBuffer)` é anterior a `CharSequence`; quando `CharSequence` foi adicionada, `String` ganhou também `contentEquals(CharSequence)`. As duas sobrecargas coexistem com segurança só porque a mais específica repassa para a mais genérica, em vez de fazer algo diferente:

```java
public boolean contentEquals(StringBuffer sb) {
    return contentEquals((CharSequence) sb);
}
```

Um caller que não consegue saber qual sobrecarga disparou ainda assim recebe a mesma resposta de qualquer jeito — então a ambiguidade é inofensiva.

Autoboxing torna essa armadilha mais fácil de cair do que costumava ser, porque `int` e `Integer` já não são "radicalmente diferentes" em um call site do jeito que `int` e `String` são:

```java
List<Integer> a = new ArrayList<>(List.of(10, 20, 30));
a.remove(1);                 // calls remove(int index) -> removes index 1, a is now [10, 30]

List<Integer> b = new ArrayList<>(List.of(10, 20, 30));
b.remove((Integer) 1);       // calls remove(Object o)   -> removes the value 1; not present, b unchanged
```

`List<E>` sobrecarrega `remove(int index)` e `remove(E)` (erasure para `remove(Object)`). Um argumento `int` resolve para a sobrecarga `int` sem sequer precisar de autoboxing, então `list.remove(1)` remove *pela posição*, não pelo valor — uma fonte comum de confusão quando uma lista contém `Integer`s e o caller esperava "remova esse valor."

### Design de assinatura: enum em vez de boolean, interface em vez de classe

Um parâmetro `boolean` é opaco no call site — quem lê precisa ir procurar o que `true` significa:

```java
Thermometer.newInstance(true);                             // true meaning what, exactly?
```

Um enum de dois elementos se autodocumenta, e deixa espaço para crescer:

```java
public enum TemperatureScale { FAHRENHEIT, CELSIUS }

Thermometer.newInstance(TemperatureScale.CELSIUS);         // unambiguous
```

Adicionar `KELVIN` depois é uma mudança de uma linha no enum; um parâmetro `boolean` não tem equivalente para um terceiro estado sem quebrar a assinatura do método.

Os *tipos* de parâmetro merecem o mesmo escrutínio: prefira uma interface a uma classe concreta sempre que o método depender apenas do comportamento da interface.

```java
// Ties every caller to HashMap specifically
void printAll(HashMap<String, Integer> map) { ... }

// Accepts HashMap, TreeMap, a submap view, or any future Map implementation
void printAll(Map<String, Integer> map) { ... }
```

Declarar o parâmetro como `HashMap` obriga um caller que tem um `TreeMap` (ou qualquer outro `Map`) a copiá-lo para um `HashMap` só para chamar o método — uma conversão desnecessária e potencialmente cara que a versão tipada com a interface nunca exige.

## Trade-offs

- **Overloading por tipo declarado é invisível no call site** — quem lê não consegue saber qual sobrecarga roda sem conhecer o tipo *estático* de cada argumento, não apenas o que o objeto de fato é em runtime. Reserve overloading para os casos em que os tipos de parâmetro são radicalmente diferentes (um `int` e uma `Collection` jamais podem ser confundidos) ou em que toda sobrecarga é garantidamente equivalente em comportamento.
- **Sobrecargas com a mesma aridade são a forma mais arriscada.** Uma regra conservadora e mecânica: nunca exponha duas sobrecargas com o mesmo número de parâmetros a menos que um tipo de parâmetro em cada par seja impossível de converter para o outro. `ArrayList(int)` vs. `ArrayList(Collection<?>)` é segura nesse sentido; `remove(int)` vs. `remove(E)` em `List<Integer>` não é, porque `int` converte para `Integer` via autoboxing.
  ```java
  new ArrayList<>(List.of(10, 20, 30)).remove(1);                    // removes index 1 -> [10, 30]
  new ArrayList<>(List.of(10, 20, 30)).remove(Integer.valueOf(20));  // removes the value 20 -> [10, 30]
  ```
- **Um parâmetro `boolean` lê bem para quem escreveu e opaco para todo o resto.** O custo de um enum é uma declaração de tipo a mais; o retorno é um call site que não precisa de comentário e uma assinatura que pode crescer uma terceira opção sem quebrar a API.
- **Um parâmetro tipado como interface não custa nada quando o método só chama métodos da interface, e evita forçar callers a uma implementação específica.** O único motivo legítimo para exigir uma classe concreta é quando o método realmente precisa de algo que a interface não expõe (ex.: um método específico da classe) — fora isso, é uma restrição desnecessária.

## Documentation Links

- [JLS 15.12 — Method Invocation Expressions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.12) — doc
- [JLS 8.4.9 — Overloading](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.9) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
