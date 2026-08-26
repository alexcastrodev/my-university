---
version: 1.0
updatedAt: 2026-08-13
title: Classes Imutáveis e Cópia Defensiva
summary: Tornar uma classe verdadeiramente imutável exige mais do que campos final — significa copiar argumentos mutáveis na entrada e campos mutáveis na saída, para que nenhuma outra referência ao estado do objeto jamais escape.
---
## Objective

Uma classe imutável é aquela cujas instâncias não podem ser modificadas após a construção — todo campo é fixo pela vida inteira do objeto. Chegar lá exige mais do que marcar campos como `final`: uma classe só conta como imutável se nada, nem mesmo a própria classe, puder algum dia mudar o que uma instância contém. Essa última parte é a que as pessoas deixam passar — uma classe pode satisfazer toda regra sobre seus próprios campos e ainda assim ser mutável do ponto de vista externo, porque um de seus campos aponta para um objeto mutável (`java.util.Date`, um array, uma `List`) para o qual algum outro trecho de código ainda guarda uma referência. Fechar essa brecha é a cópia defensiva: copiar um valor mutável na entrada de um construtor, e copiá-lo de novo na saída de um acessor, de modo que nenhuma outra referência ao estado do seu objeto jamais exista.

## Use Cases

- Tipos de valor pequenos — uma janela de tempo, um valor monetário, uma coordenada — que deveriam se comportar como `String` ou `Integer`: passe-os para qualquer lugar, compartilhe-os livremente, nunca se preocupe com outro código mudando-os por baixo do seu pé.
- Qualquer construtor ou setter que armazena em um campo um `Date`, array, `List`, `Map` ou outro objeto mutável fornecido pelo chamador — a referência do chamador precisa ser neutralizada, ou vira uma porta dos fundos para o estado do seu objeto.
- Qualquer acessor que retorna um campo que guarda um objeto mutável — a referência retornada é uma segunda porta dos fundos, dessa vez do *próprio objeto* de volta para o chamador.
- Projetar tipos thread-safe sem sincronização: um objeto que verdadeiramente não pode mudar após a construção pode ser entregue a qualquer número de threads sem nenhum lock, porque não há mutação para as threads disputarem.

## Deep Dive

### A receita de cinco regras para uma classe verdadeiramente imutável

```java
public final class TimeWindow {                 // rule 2: can't be subclassed

    private final Date start;                    // rules 3 & 4: final, private
    private final Date end;

    public TimeWindow(Date start, Date end) {
        // rule 5: defensive copy on the way IN — don't store the caller's reference
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.after(this.end)) {
            throw new IllegalArgumentException(start + " is after " + end);
        }
    }

    public Date start() {
        return new Date(start.getTime());         // rule 5: defensive copy on the way OUT
    }

    public Date end() {
        return new Date(end.getTime());
    }
    // rule 1: no setStart(...), no setEnd(...) — no mutators at all
}
```

Cinco regras, todas presentes acima:

1. **Sem mutadores.** Sem `setStart`/`setEnd` — nada que mude o estado depois da construção.
2. **A classe não pode ser estendida.** `final` na classe impede que uma subclasse adicione métodos mutadores ou sobrescreva um método para se comportar como se o estado tivesse mudado. A alternativa a `final` é um construtor privado/package-private mais métodos de fábrica estáticos públicos — como um pacote externo não consegue estender uma classe sem construtor acessível, a classe é *efetivamente* final para seus clientes mesmo sem a palavra-chave.
3. **Todos os campos são `final`.** Isso é garantido pelo compilador, não apenas uma convenção, e também é o que garante que uma referência a uma instância recém-construída é segura para entregar a outra thread sem sincronização extra (semântica de campos `final`, JLS §17.5).
4. **Todos os campos são `private`.** Um campo `public final` é tecnicamente seguro se guarda um primitivo ou uma referência a um objeto imutável, mas trava a representação interna para sempre — não há como mudá-la em uma versão futura sem quebrar a compatibilidade de código-fonte.
5. **Acesso exclusivo a qualquer componente mutável.** É a regra que as outras quatro não cobrem, e é o assunto dos dois próximos subtópicos.

As regras 1 a 4 são o que uma classe ganha automaticamente por ser pequena e disciplinada. A regra 5 é a que exige trabalho ativo — e pulá-la é exatamente como uma classe que *parece* imutável acaba não sendo.

### O ataque da cópia defensiva ausente: mutando estado depois da construção

Pegue a mesma classe, mas pule a regra 5 — armazene a referência `Date` do chamador diretamente em vez de copiá-la:

```java
public final class BrokenTimeWindow {
    private final Date start;
    private final Date end;

    public BrokenTimeWindow(Date start, Date end) {
        if (start.after(end)) {
            throw new IllegalArgumentException(start + " is after " + end);
        }
        this.start = start;   // stores the caller's reference — no copy
        this.end = end;
    }

    public Date start() { return start; }
    public Date end() { return end; }
}
```

Todo campo é `final`, a classe é `final`, ambos os campos são `private` — e ela ainda é mutável, porque o chamador manteve uma referência para o mesmo objeto `Date` que agora está dentro da instância:

```java
Date start = new Date();
Date end = new Date();
BrokenTimeWindow window = new BrokenTimeWindow(start, end);

end.setTime(0L);              // mutating a reference we still hold...
window.end();                 // ...changed window's internal state — no API of
                               // BrokenTimeWindow was ever called to do it
```

Nada em `window` foi chamado depois da construção. O estado do objeto mudou mesmo assim, porque `start`/`end` dentro de `window` e as variáveis `start`/`end` do chamador eram, e continuaram sendo, os mesmos dois objetos `Date`. O conserto é o construtor do primeiro subtópico: copiar os valores de entrada antes de armazená-los, de modo que a instância acabe guardando objetos que o chamador nunca teve referência —

```java
this.start = new Date(start.getTime());   // a new object; caller's reference is now irrelevant
this.end = new Date(end.getTime());
```

— e validar as *cópias*, não os argumentos originais. Se a validação rodasse em `start`/`end` antes da cópia, outra thread ainda poderia mutá-los na brecha entre a checagem e a cópia (uma janela de time-of-check/time-of-use); copiar primeiro e validar o resultado fecha essa brecha.

Mais uma armadilha na cópia em si: não faça a cópia chamando `start.clone()`. `Date` não é `final`, então `clone()` não tem garantia de retornar um `java.util.Date` de verdade — uma subclasse hostil poderia sobrescrever `clone()` para retornar uma instância que continua se registrando em algum lugar controlado pelo atacante. `new Date(start.getTime())` contorna a questão inteira ao depender apenas do timestamp `long`, não do tipo em runtime de `start`.

### Cópia defensiva na saída: acessores

O conserto do construtor acima impede código externo de alcançar o objeto por dentro. Ele não faz nada quanto aos acessores — se `start()` retorna o campo diretamente, o chamador passa a ter uma referência viva exatamente para o objeto `Date` que vive dentro da instância:

```java
// leaks the internal object
public Date end() {
    return end;
}

Date leaked = window.end();
leaked.setTime(0L);       // window's real internal state just changed
```

O conserto espelha o do construtor: retornar uma cópia, não o campo.

```java
public Date end() {
    return new Date(end.getTime());
}
```

Arrays precisam do mesmo tratamento e é fácil esquecer, porque retornar um campo array parece retornar um valor:

```java
private final int[] scores;               // constructor already defensively copied this

public int[] scores() {
    return scores.clone();                 // NOT `return scores;`
}
```

Todo array de tamanho não zero é mutável — não existe um array `final` cujo *conteúdo* seja protegido por essa palavra-chave — então qualquer acessor que devolve um verbatim entregou uma forma de reescrever os internos do objeto. `clone()` é seguro aqui especificamente porque o tipo em runtime do campo é conhecido com exatidão (`int[]`, não um tipo de referência que pode ser subclasseado); é o `clone()` estilo `Date` que é inseguro, não o clone de array.

Os tipos de `java.time` contornam esse subtópico inteiro. `LocalDate`, `Instant` e o resto de `java.time` são imutáveis — todo "mutador" (`plusDays`, `withYear`, ...) retorna uma nova instância e deixa a original intacta — então um campo do tipo `LocalDate` não precisa de cópia defensiva no construtor nem de cópia defensiva no acessor: retornar o campo diretamente é seguro, porque não existe operação capaz de mutar o que o chamador recebe. `java.util.Date` precisa da cópia especificamente *porque* é mutável de um jeito que `java.time` deliberadamente não é.

## Trade-offs

- **Um `record` te dá quatro das cinco regras de graça, mas não a quinta.** Declarar um componente torna seu campo `private` e `final` sem mutador gerado, e a classe é implicitamente `final` — as regras 1 a 4 saem de graça só de usar `record`. A cópia defensiva ainda é algo que você mesmo precisa escrever: um construtor compacto que não copia um componente mutável, ou um acessor que não é sobrescrito para retornar uma cópia, vaza exatamente como o `BrokenTimeWindow` vazava. Veja `records-and-sealed-types` para o quão superficial é de fato a imutabilidade de um record.
  ```java
  record Window(Date start, Date end) {}          // no compact constructor: no defensive copy

  var d = new Date();
  var w = new Window(d, new Date());
  d.setTime(0L);                                   // mutates w.start() too — record didn't help
  ```
- **A cópia defensiva custa uma alocação a cada chamada, e nem sempre vale a pena pagar por ela.** Dentro de um pacote onde a classe e seu chamador são mantidos juntos, ou em uma fronteira onde a API documenta que ela assume posse do argumento (um "handoff" — o chamador promete não tocar mais no objeto), pular a cópia e documentar a exigência em vez disso pode ser a decisão certa. É uma decisão a se tomar deliberadamente, não um padrão para recorrer só porque copiar é inconveniente.
- **Copie antes de validar, não depois.** Validar os argumentos originais do chamador e só copiar depois deixa uma janela em que outra thread pode mutar o argumento entre a checagem e a cópia. Copie primeiro, depois valide a cópia — como no construtor de `TimeWindow` acima — e essa janela se fecha.
- **A imutabilidade força um novo objeto para cada estado distinto**, o que pode ser um custo real para valores grandes ou "alterados" com frequência — `BigInteger.flipBit` em um valor de um milhão de bits aloca um valor inteiro novo de um milhão de bits para uma mudança de um único bit, enquanto um `BitSet` mutável faz a mesma edição conceitual em tempo constante. Esse é um motivo para alguns tipos (builders em massa, acumuladores) serem deliberadamente deixados mutáveis, não um motivo para evitar imutabilidade em tipos de valor comuns.

## Documentation Links

- [java.util.Date](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Date.html) — doc
- [java.time.LocalDate](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html) — doc
- [Object#clone()](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#clone()) — doc
- [JLS §17.5 — Final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
