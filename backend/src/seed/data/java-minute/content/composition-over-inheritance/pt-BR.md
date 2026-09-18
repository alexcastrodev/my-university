---
version: 1.0
updatedAt: 2026-09-18
question: Por que você deveria preferir composição a herança?
---
## Question

# Por que você deveria preferir composição a herança?

## Short Answer

Porque está escrito no manual.

## Less Short Answer

Você leu o manual, não leu? A pergunta que você deve se fazer é a seguinte: quando você precisa adicionar um determinado comportamento a um objeto, você deve criar um método nesse objeto, ou deve criar um delegate que implemente esse comportamento?

Imagine que é 2005, e você precisa serializar seu objeto para XML.

- Solução um: você cria um método `toXML()` nessa classe.
- Solução dois: você cria esse método `toXML()` numa classe de fábrica em outro lugar.

Agora é 2025, vinte anos depois, e você não precisa mais de XML. O que você precisa é de JSON. Na solução um, você adiciona um método `toJSON()`, mas a pergunta real é: o que você faz com o método `toXML()`, agora inútil? Do ponto de vista funcional, isso é código morto. As chances são de que você vai decidir mantê-lo, porque seria muito custoso refatorar sua aplicação para remover todas as chamadas a esse método. Na solução dois, você simplesmente descarta a classe, porque ninguém deveria mais estar chamando ela.

## Por que isso importa

Composição facilita muito o desacoplamento dos diferentes módulos da sua aplicação. E se você pensa que isso é só sobre organizar sua aplicação de uma forma melhor, pense de novo: isso é sobre tornar seu código mais fácil de descartar quando você não precisa mais dele, evitando que código morto fique lá, contaminando sua aplicação.

## One Last Word

Isso foi escrito no manual há mais de trinta anos. O livro do GoF foi publicado em 1994. E mesmo que seja sempre melhor entender completamente as regras que você segue, às vezes é mais importante simplesmente segui-las, mesmo sem entendê-las por completo.

## References

- [Java Coding Tip #396: Why Should You Favor Composition Over Inheritance?](https://youtube.com/shorts/DIZTQxkOsy4) — video
- [Design Patterns: Elements of Reusable Object-Oriented Software (Gamma, Helm, Johnson, Vlissides, Addison-Wesley, 1994)](https://en.wikipedia.org/wiki/Design_Patterns) — doc
