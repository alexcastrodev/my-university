---
version: 1.0
updatedAt: 2026-08-13
title: Os Contratos de equals(), hashCode() e toString()
summary: Os contratos documentados por trás dos três métodos mais sobrescritos de Object, por que quebrar a simetria ou pular hashCode() falha silenciosamente em vez de na compilação, e como records satisfazem os três de graça.
---
## Objective

`Object.equals()`, `Object.hashCode()` e `Object.toString()` vêm cada um com um contrato documentado, não apenas uma implementação padrão. Sobrescrever um sem honrar seu contrato — ou sobrescrever `equals()` deixando `hashCode()` intocado — compila normalmente e falha silenciosamente em tempo de execução: buscas quebradas em coleções, objetos que deixam de ser iguais a si mesmos sob composição, saída de log ilegível. Este conceito cobre o que cada contrato realmente exige e como satisfazer os três corretamente.

## Use Cases

- Dar a uma classe igualdade *lógica* em vez da igualdade por identidade que `Object` fornece por padrão — duas instâncias separadas que representam o mesmo valor (um ponto, um valor monetário, um ID) deveriam comparar como iguais.
- Tornar uma classe segura para uso como chave de `HashMap` ou elemento de `HashSet`, onde a correção depende de `equals()` e `hashCode()` concordarem entre si.
- Produzir um `toString()` que transforma uma linha de log ou uma expressão de watch no debugger de `Order@1a2b3c` em algo que uma pessoa consiga realmente ler.
- Reconhecer quando *não* sobrescrever `equals()` de forma alguma — classes com identidade inerente (como `Thread`), ou aquelas em que o `equals()` de uma superclasse já é correto.

## Deep Dive

### O contrato de equals(), e como a simetria quebra primeiro

`Object.equals(Object)` é documentado como uma relação de equivalência. Para quaisquer referências não nulas `x`, `y`, `z`:

- **Reflexivo** — `x.equals(x)` deve ser `true`.
- **Simétrico** — `x.equals(y)` deve ser `true` se e somente se `y.equals(x)` for `true`.
- **Transitivo** — se `x.equals(y)` e `y.equals(z)` são ambos `true`, então `x.equals(z)` deve ser `true`.
- **Consistente** — chamadas repetidas de `x.equals(y)` retornam o mesmo resultado, desde que o estado comparado de nenhum dos objetos mude.
- **Não-nulo** — `x.equals(null)` deve ser `false`.

O requisito que quebra primeiro na prática é a simetria, e o gatilho clássico é uma subclasse que adiciona um campo que o `equals()` da superclasse não conhece:

```java
public class Point {
    private final int x, y;

    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Point p)) return false;
        return p.x == x && p.y == y;
    }
}

public class ColorPoint extends Point {
    private final Color color;

    public ColorPoint(int x, int y, Color color) {
        super(x, y);
        this.color = color;
    }

    // Broken — violates symmetry
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ColorPoint cp)) return false;
        return super.equals(o) && cp.color == color;
    }
}
```

```java
Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, Color.RED);

p.equals(cp);   // true  — Point.equals only looks at x and y
cp.equals(p);   // false — ColorPoint.equals requires a ColorPoint
```

Tentar "consertar" isso fazendo `ColorPoint.equals()` cair de volta para uma comparação que ignora a cor quando o argumento é um `Point` simples restaura a simetria, mas quebra a transitividade no lugar — dois `ColorPoint`s de cores diferentes podem cada um ser igual ao mesmo `Point` em (1, 2) sem serem iguais entre si. Não há como adicionar um componente de valor em uma subclasse e preservar o contrato completo enquanto ainda se estende uma classe concreta e instanciável. As duas saídas são: não adicionar um componente de valor na subclasse, ou não estender — dar a `ColorPoint` um campo `Point` (composição) em vez de uma superclasse `Point`.

Um `equals()` correto segue a mesma forma independentemente disso: comparar por referência primeiro (`this == o`) como um atalho barato, depois usar `instanceof` — que retorna `false` para `null` e para o tipo errado em uma única checagem, cobrindo tanto o requisito de não-nulidade quanto a checagem de tipo sem uma guarda de `null` separada:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Point p)) return false;
    return p.x == x && p.y == y;
}
```

Para campos que podem ser `null` eles mesmos, `Objects.equals(a, b)` faz a comparação null-safe (`true` se ambos forem `null`, senão `a.equals(b)`) em vez de escrever isso à mão para cada campo.

### equals() e hashCode() são um contrato só, não dois

`Object.hashCode()` é documentado com suas próprias regras, mas a que importa aqui é: **se dois objetos são iguais segundo `equals()`, eles devem retornar o mesmo `hashCode()`.** Nada na linguagem impõe isso — uma classe pode sobrescrever `equals()` e deixar `hashCode()` intocado, e isso compila sem aviso. O que quebra é toda coleção baseada em hash construída sobre a premissa de que os dois métodos concordam.

```java
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Point p)) return false;
        return p.x == x && p.y == y;
    }
    // no hashCode() override — inherits Object's identity-based hash
}
```

```java
Map<Point, String> labels = new HashMap<>();
labels.put(new Point(1, 2), "origin-ish");

labels.get(new Point(1, 2)); // null — not "origin-ish"
```

Ambas as instâncias de `Point` são iguais por `equals()`, mas cada uma carrega seu próprio `hashCode()` derivado de identidade, então `put()` e `get()` quase certamente caem em buckets diferentes — e mesmo no caso raro em que colidem, `HashMap` armazena em cache o hash de cada entrada e pula completamente a checagem de `equals()` quando os hashes não coincidem. A busca falha sem lançar nada; simplesmente não encontra silenciosamente o que obviamente "está lá".

Um `hashCode()` correto segue uma receita simples: comece com uma constante diferente de zero, e para cada campo também usado em `equals()`, incorpore-o com `result = 31 * result + fieldHash`:

```java
@Override
public int hashCode() {
    int result = 17;
    result = 31 * result + x;
    result = 31 * result + y;
    return result;
}
```

`java.util.Objects` fornece um atalho que faz a mesma incorporação para qualquer número de campos, a um pequeno custo de varargs/boxing:

```java
@Override
public int hashCode() {
    return Objects.hash(x, y);
}
```

A regra que realmente importa para a correção é mais estreita do que "faça hash de todo campo": todo campo lido por `equals()` também deve ser lido por `hashCode()`. Deixar um de fora arrisca que objetos iguais tenham hashes diferentes; incluir um campo que `equals()` ignora só adiciona ruído. Quaisquer que sejam os campos incluídos, `hashCode()` precisa derivá-los da mesma forma toda vez que o objeto não mudar — veja a Consistência no contrato de `equals()` acima — do contrário um campo mutável usado no hash quebra buscas no momento em que é mutado após a inserção (veja a mecânica de buckets de hash no conceito de HashMap para ver como isso se parece do lado do bucket).

### toString(): o que Object oferece, e por que não é suficiente

A implementação padrão de `Object.toString()` retorna o nome da classe, `@`, e o hash code em hexadecimal — `Point@7229724f`. Não está errado, apenas inútil: não diz nada sobre *qual* ponto é este. `toString()` é invocado automaticamente por `println`, concatenação de strings, `String.format`/`printf`, mensagens de `assert`, e a maioria dos debuggers — então uma classe que nunca sobrescreve esse método produz saída ilegível em todos esses lugares sem que ninguém precise pedir:

```java
System.out.println("Failed to connect: " + phoneNumber);
// no override: Failed to connect: PhoneNumber@1a2b3c
// overridden:  Failed to connect: (707) 867-5309
```

Sobrescrevê-lo é uma decisão em duas partes: o que colocar na string, e se deve documentar o *formato* dela como parte da API da classe. Documentar um formato exato (como `BigInteger` e `BigDecimal` fazem) dá aos chamadores uma representação estável e analisável — e vale a pena combiná-la com um método de fábrica estático ou construtor que a interprete de volta. Deixar o formato não especificado mantém a liberdade de mudá-lo depois, ao custo de os chamadores não terem nenhum contrato textual em que se apoiar. De qualquer forma, a classe ainda deve expor os dados subjacentes através de acessores reais — uma saída de `toString()` é um substituto pobre para uma API, e interpretá-la de volta anula o propósito de escrever código estruturado em primeiro lugar.

```java
/**
 * Returns this point's coordinates, formatted as "(x, y)".
 */
@Override
public String toString() {
    return "(" + x + ", " + y + ")";
}
```

### Records: os mesmos três métodos, gerados corretamente

Um `record` gera `equals()`, `hashCode()` e `toString()` para cada componente automaticamente, e os gera de forma *consistente entre si* por construção — não há como acabar com um record cujos `equals()` e `hashCode()` discordem, porque ambos são derivados da mesma lista de componentes pelo compilador, não escritos à mão duas vezes:

```java
record Point(int x, int y) {}

Point a = new Point(1, 2);
Point b = new Point(1, 2);
a.equals(b);      // true  — structural equality over every component
a.hashCode() == b.hashCode(); // true — always, for equal records
a.toString();     // "Point[x=1, y=2]"
```

Para um tipo de valor simples, isso substitui toda a receita acima por zero código escrito à mão. Mas não substitui o julgamento — o problema de simetria no estilo `ColorPoint` ainda se aplica se um record for comparado com um tipo de formato diferente, e a ressalva de "referência própria vs. conteúdo mutável" sobre campos de record ainda se aplica ao que está dentro deles. A mecânica geral de records (construtores compactos, hierarquias seladas com records) é coberta no conceito Records e Tipos Selados; este aqui é só o ângulo equals/hashCode/toString.

## Trade-offs

- **`instanceof` vs. `getClass()` em `equals()` troca simetria por substituibilidade.** Uma checagem `instanceof` permite que uma subclasse seja igual à sua superclasse (desde que a subclasse não adicione nenhum componente de valor), que foi o que o exemplo `Point`/`ColorPoint` acima precisou para evitar. Uma checagem `getClass()` contorna esse problema específico de simetria exigindo correspondência exata de tipo — mas então quebra o princípio de substituição de Liskov para subclasses inofensivas que não adicionam estado nenhum (por exemplo, uma que só conta quantas instâncias foram criadas), porque essa instância de subclasse nunca pode ser igual a uma instância de superclasse por outro lado idêntica.
  ```java
  // getClass()-based equals: exact type match only
  @Override
  public boolean equals(Object o) {
      if (o == null || o.getClass() != getClass()) return false;
      Point p = (Point) o;
      return p.x == x && p.y == y;
  }
  // a Set<Point> built with new Point(...) instances will never
  // report true for contains() on an equal CounterPoint instance,
  // even though CounterPoint adds no comparable state
  ```
- **Sobrescrever `equals()` sem `hashCode()` compila sem erro nem aviso.** Nada no sistema de tipos liga os dois métodos, então o erro só aparece como uma coleção se comportando mal silenciosamente em tempo de execução, não como uma falha de build.
  ```java
  Set<Point> seen = new HashSet<>();
  seen.add(new Point(1, 2));
  seen.add(new Point(1, 2)); // equal by equals(), but no hashCode() override
  seen.size(); // 2, not 1 — the "duplicate" landed in a different bucket
  ```
- **Um `hashCode()` que ignora a terceira cláusula do contrato ainda é legal, só que ruim.** Retornar uma constante satisfaz "objetos iguais têm hash codes iguais" — trivialmente, já que todo objeto tem o mesmo hash — mas colapsa todo bucket em um só, transformando operações O(1) em média de tabela hash em O(n).
  ```java
  @Override
  public int hashCode() { return 42; } // legal, atrocious
  ```
- **Especificar o formato exato de `toString()` é uma porta sem volta.** Dá aos chamadores algo estável para interpretar e usar em logs, mas uma vez publicado e dependido, mudá-lo é uma mudança que quebra compatibilidade — do mesmo jeito que mudar a assinatura de um método público seria. Deixar o formato não especificado mantém essa liberdade, mas significa que quem interpretar a saída mesmo assim está confiando em um detalhe explicitamente não documentado.

## Documentation Links

- [Object — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html) — doc
- [Objects — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html) — doc
- [Record — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html) — doc
