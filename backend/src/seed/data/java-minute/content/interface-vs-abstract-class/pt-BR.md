---
version: 1.0
updatedAt: 2026-08-26
question: Qual é a diferença entre uma interface e uma classe abstrata?
---
## Question

# Qual é a diferença entre uma interface e uma classe abstrata?

## Short Answer

Bom, não é a mesma coisa.

## Less Short Answer

Existem duas diferenças principais. Primeiro, uma classe abstrata tem um construtor, que é chamado para construir seu objeto final — isso não acontece com uma interface. Segundo, uma classe abstrata pode carregar um estado mutável, o que também não é o caso de uma interface.

```java
abstract class Vehicle {
    private int speed; // estado mutável

    protected Vehicle(int speed) { // construtor
        this.speed = speed;
    }
}

interface Movable {
    // sem construtor, sem estado mutável permitido
}
```

## A Word of Caution

Essa pergunta pode parecer uma pegadinha, porque você pode ter métodos estáticos e de instância tanto em classes abstratas quanto em interfaces. Esse é um recurso que foi adicionado às interfaces no Java 8, em 2014.

## One Last Word

Agora você deve estar se perguntando: quando devemos usar classes abstratas ou interfaces? Por padrão, prefira interfaces. Por quê? Bom, isso fica para uma próxima vez.

## References

- [Java Coding Tip #156: What Is the Difference Between an Interface and an Abstract Class?](https://www.youtube.com/watch?v=f5hKXYeJ90s) — video
- [Interfaces — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html) — doc
- [Abstract Methods and Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/abstract.html) — doc
