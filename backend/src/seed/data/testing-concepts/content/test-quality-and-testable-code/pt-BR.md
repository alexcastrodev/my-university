---
version: 1.0
updatedAt: 2026-08-06
title: "Qualidade de Teste e Código Testável"
summary: "Medindo cobertura com JaCoCo, escrevendo código testável (Lei de Demeter, composição em vez de condicionais), e como TDD/BDD/teste de mutação se encaixam no ciclo de desenvolvimento, do JUnit in Action, Third Edition, Cap. 6."
---
## Objective

`Qualidade de teste` não é só "os testes existem"; é se o código está estruturado de modo que os testes sejam fáceis de escrever para começo de conversa, e se um número de `cobertura de código` de fato reflete uma verificação significativa. O livro combina um punhado de princípios de código testável (contratos em vez de implementação, a Lei de Demeter, favorecer composição/polimorfismo) com ferramentas (JaCoCo) para medir cobertura, e então posiciona tanto TDD quanto BDD como disciplinas do ciclo de desenvolvimento que produzem código bem testado como efeito colateral de como é escrito, em vez de como uma reflexão tardia.

## Use Cases

- Medir quais linhas/branches uma suíte de testes de fato exercita com o JaCoCo, integrado a um build Maven/Gradle.
- Refatorar um construtor que acessa um objeto grande de `Context`/config só para pegar uma dependência, de modo que a classe peça exatamente o que usa.
- Preferir um construtor ou setter que recebe a dependência concreta de que uma classe precisa, em vez de um saco de estado sem relação que a classe então precisa navegar.
- Escrever um teste que falha primeiro (red-green-refactor do TDD) para que a implementação seja conduzida por uma expectativa explícita e verificável, em vez de testes parafusados depois.
- Introduzir cenários Given/When/Then no estilo BDD para que os critérios de aceitação fiquem inequívocos antes de a implementação começar.
- Usar teste de mutação para checar se a suíte de testes de fato capturaria um bug introduzido deliberadamente, em vez de confiar de olhos fechados em um percentual alto de cobertura.

## Deep Dive

### Medindo cobertura de código com JaCoCo

O `JaCoCo` instrumenta o bytecode de classe para reportar quais linhas e branches rodaram durante uma suíte de testes, integrado ao Maven via um plugin:

```xml
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals><goal>prepare-agent</goal></goals>
        </execution>
        <execution>
            <id>report</id>
            <phase>test</phase>
            <goals><goal>report</goal></goals>
        </execution>
    </executions>
</plugin>
```

O relatório HTML gerado destaca linhas cobertas em verde e não cobertas em vermelho, até o nível de branches individuais dentro de um `if`; útil para encontrar casos de borda não testados, mas um percentual alto só significa que as linhas foram *executadas*, não que as asserções certas rodaram contra elas.

### A Lei de Demeter (Princípio do Menor Conhecimento)

"Fale com seus amigos imediatos, não fale com estranhos": uma classe deveria pedir só pelos objetos de que precisa diretamente, não alcançar através de outro objeto para encontrá-los. Este exemplo a viola: `Car` precisa saber que `Context` por acaso expõe um método `getDriver()`:

```java
class Car {
    private Driver driver;

    Car(Context context) {
        this.driver = context.getDriver(); // reaching through Context to get Driver
    }
}
```

Testar esse construtor agora exige construir um `Context` válido (ou mockar um) só para satisfazer uma dependência que `Car` na verdade não usa para nada, além de extrair `Driver`. Passar o objeto necessário diretamente remove essa indireção por completo:

```java
class Car {
    private Driver driver;

    Car(Driver driver) {
        this.driver = driver; // requires exactly what it needs, nothing more
    }
}
```

### Favorecendo composição e polimorfismo em vez de condicionais

Código testável tende a evitar longas cadeias condicionais que codificam diferenças de comportamento, substituindo-as por polimorfismo, de modo que cada comportamento seja sua própria unidade testável:

```java
// Harder to test in isolation: one method, growing branches
double area(Shape shape) {
    if (shape.getType() == ShapeType.CIRCLE) return Math.PI * shape.getRadius() * shape.getRadius();
    if (shape.getType() == ShapeType.RECTANGLE) return shape.getLength() * shape.getWidth();
    throw new IllegalArgumentException();
}
```

```java
// Each shape tests its own area() independently
interface Shape { double area(); }
class Circle implements Shape {
    private final double radius;
    public double area() { return Math.PI * radius * radius; }
}
```

### Desenvolvimento orientado a testes: red, green, refactor

O TDD inverte a ordem usual: escreva um teste que falha para um comportamento que ainda não existe (**red**), escreva apenas o código suficiente para passá-lo (**green**), então limpe a implementação com o teste como rede de segurança (**refactor**), repetindo em passos pequenos em vez de escrever a funcionalidade inteira antes de qualquer teste:

```java
// Red: this test doesn't compile/pass yet, Account.withdraw doesn't exist
@Test
void withdrawReducesBalance() {
    Account account = new Account("1", 100);
    account.withdraw(30);
    assertEquals(70, account.getBalance());
}
```

```java
// Green: minimal implementation to pass
class Account {
    private int balance;
    void withdraw(int amount) { balance -= amount; }
}
```

### Desenvolvimento orientado a comportamento

O BDD constrói sobre o TDD expressando o cenário de teste em uma linguagem compartilhada e legível pelo negócio (Given/When/Then) antes de o teste ou a implementação existirem, de modo que o próprio cenário se torne o ponto de acordo entre desenvolvedores e partes interessadas:

```
Given an account with balance 100
When the customer withdraws 30
Then the account balance is 70
```

### Teste de mutação

O teste de mutação verifica a própria suíte de testes: uma ferramenta introduz automaticamente pequenos bugs ("mutantes", trocando um `>` por `>=`, mudando um `+` por `-`) no código compilado e reexecuta os testes. Um mutante que sobrevive (os testes continuam passando apesar do bug injetado) revela uma lacuna que a cobertura sozinha não mostraria: a linha foi *executada* por um teste, mas nada de fato afirmou sobre o valor que mudou.

## Trade-offs

- **Cobertura de linha alta não significa qualidade alta de asserção**: um teste que chama um método, mas não afirma nada significativo sobre seu resultado, aparece como "coberto" no JaCoCo enquanto não captura nada; o teste de mutação existe especificamente para expor essa lacuna.
- **Aplicar a Lei de Demeter pode significar mais parâmetros de construtor**: passar exatamente o que é necessário, em vez de um objeto de contexto único, evita acoplamento oculto, mas uma classe com muitas dependências pequenas acaba com uma assinatura de construtor mais longa do que uma que simplesmente acessa um objeto compartilhado.
- **A disciplina de passos pequenos do TDD tem uma curva de aprendizado**: escrever o teste primeiro exige conhecer a forma da API antes de ela existir, o que é uma forma diferente (e inicialmente mais lenta) de pensar do que escrever a implementação e testá-la depois.
- **Teste de mutação é caro de rodar**: por recompilar e reexecutar a suíte uma vez por mutante, ele não cabe em um loop rápido de desenvolvimento interno da forma como os testes unitários cabem; costuma ser uma checagem periódica ou só de CI, não uma ferramenta de rodar a cada gravação de arquivo.

## Documentation Links

- [JaCoCo: site oficial](https://www.jacoco.org) (doc)
- [PIT (Pitest): teste de mutação para Java](https://pitest.org) (doc)
- [JUnit in Action, 3rd Ed., Cap. 6, "Test quality," pp. 101-121 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
