---
version: 1.0
updatedAt: 2026-08-30
question: Por que você deveria favorecer a imutabilidade?
---
## Question

# Por que você deveria favorecer a imutabilidade?

## Short Answer

Por muitos bons motivos.

## Less Short Answer

Quando seus objetos são não modificáveis, você não precisa se preocupar com o estado que eles carregam — é o estado com o qual você os criou. Então a depuração fica muito mais simples, porque você não precisa rastrear quando esse estado foi modificado.

## Mais Simples em Ambientes Concorrentes

Também é mais simples em um ambiente concorrente. A não modificabilidade vem com thread safety embutida: condições de corrida só podem ocorrer quando você tem uma operação de escrita, e aqui a única operação de escrita que você tem é a criação do seu objeto. Então, se você está usando records, ou classes com campos de instância `final`, a criação dos seus objetos fica protegida contra condições de corrida.

```java
public record Point(int x, int y) {} // campos implicitamente final
```

A não modificabilidade torna seu trabalho muito mais fácil na hora de caçar bugs nas suas aplicações.

## One Last Word

A imutabilidade vai trazer até uma performance melhor quando o Valhalla entregar as value classes. E pare de zoar dizendo que o Valhalla nunca vai chegar — porque ele está chegando mais cedo do que você imagina.

## References

- [Java Coding Tip #390: Why Should You Favor Immutability?](https://www.youtube.com/shorts/p9jdVv0BOzI) — video
- [Record Classes — The Java Tutorials](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [JEP 401: Value Classes and Objects (Preview)](https://openjdk.org/jeps/401) — doc
