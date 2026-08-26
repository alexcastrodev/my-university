---
version: 1.0
updatedAt: 2026-08-14
question: O que é o construtor canônico?
---
## Question

# O que é o construtor canônico?

## Short Answer

Um construtor — mas o termo só faz sentido de verdade no contexto de records.

## What It Is

Quando você declara um record, você não escreve o construtor dele. Você só declara os componentes do record, e o compilador gera um construtor que recebe exatamente esses componentes pra você. Esse construtor gerado — o que recebe todos os componentes, na ordem — é o que chamamos de **construtor canônico**.

## The Guarantee

Records são projetados de forma que você não consegue criar uma instância de record sem passar pelo construtor canônico. Mesmo que você adicione outros construtores ao seu record, cada um deles precisa, eventualmente, delegar para o construtor canônico. A desserialização segue a mesma regra: também não consegue contorná-lo.

Isso significa que, se você colocar lógica de validação no construtor canônico, você tem a garantia de que essa validação roda para **toda** instância do record — sem exceções, sem atalhos.

## Practical Example

```java
record Range(int min, int max) {

    // construtor canônico compacto: valida antes dos campos serem atribuídos
    Range {
        if (min > max) {
            throw new IllegalArgumentException("min must be <= max");
        }
    }

    // um construtor secundário ainda precisa chegar até o canônico
    Range(int max) {
        this(0, max); // delega para Range(int, int)
    }
}

new Range(1, 5);   // ok
new Range(5, 1);   // lança IllegalArgumentException — a validação sempre roda
new Range(10);     // também delega para o construtor canônico
```

## Why Regular Classes Can't Do This

Pense bem: um record é o único tipo de classe que oferece essa garantia. Numa classe comum, a desserialização não chama nenhum construtor — o objeto é reconstruído diretamente a partir do stream. Então não existe um único ponto de passagem onde você poderia colocar lógica de validação e ter certeza de que ela sempre roda, como acontece com o construtor canônico de um record.

## Solution and Conclusion

O construtor canônico é simplesmente o construtor que o compilador gera a partir dos componentes de um record. Como toda forma de criar uma instância do record — construtores extras, desserialização, tudo — é forçada a passar por ele, esse é o único lugar garantido para colocar verificações de invariantes daquele record.

## References

- [Java Coding Tip #386: What Is the Canonical Constructor?](https://youtube.com/shorts/V_dVhb8QZuA?is=TA5Nv32YeS1Ap6J0) — video
- [Java SE Language Documentation — Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Record — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html) — doc
- [ObjectInputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
