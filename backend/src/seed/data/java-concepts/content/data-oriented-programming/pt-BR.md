---
version: 1.0
updatedAt: 2026-08-19
title: Data-Oriented Programming
summary: Data-Oriented Programming separa deliberadamente dados imutáveis e transparentes (records dentro de uma hierarquia sealed) da lógica que atua sobre eles, de modo que um switch exaustivo com record patterns permite ao compilador garantir que toda variante seja tratada.
---
## Objective

Data-Oriented Programming (DOP) não é um recurso novo da linguagem — é uma
nomeação, feita pelo próprio arquiteto de linguagem do Java, Brian Goetz, de
uma forma de combinar três recursos que já existem (records, tipos sealed e
pattern matching) numa disciplina deliberada de modelagem. A OOP clássica
encapsula estado *e* comportamento juntos dentro de uma classe; DOP pede que
você os separe de propósito — modele dados como records simples,
transparentes e imutáveis, e coloque a lógica que atua sobre esses dados em
código separado que faz pattern matching sobre eles. Não é um substituto
para OOP, assim como pipelines de stream de estilo funcional não são; é um
padrão diferente para o problema específico de modelar um conjunto fechado de
formas de dados relacionadas e processá-las exaustivamente.

## Use Cases

- Modelar um domínio com um pequeno número de variantes relacionadas mas
  distintas — métodos de pagamento, tipos de evento, nós de AST, formas de
  resposta de API — onde você quer que o compilador garanta que toda
  variante seja tratada.
- Fazer parsing de entrada externa (um corpo de requisição, um formato de
  arquivo, uma mensagem de protocolo) para uma forma explícita e tipada uma
  única vez na fronteira, em vez de passar um `Map` ou DTO fracamente tipado
  para mais fundo no código.
- Qualquer lugar em que você esteja atualmente escrevendo um `switch` sobre
  um campo "type" do tipo `String`, ou uma cadeia de `instanceof` com um
  `else` manual protegendo contra "algum tipo que eu esqueci" — uma
  hierarquia sealed transforma essa proteção manual num erro de compilação.
- Código estilo billing/ledger/event-sourcing, onde records como
  `Order`/`Refund`/`Transaction` são naturalmente fatos imutáveis em vez de
  entidades mutáveis com métodos próprios.
- Código pesado em interop (serialização, persistência, RPC) onde a forma
  fixa e inspecionável de um record é exatamente o que uma biblioteca de
  mapeamento quer ver.

## Deep Dive

### O movimento central: sele a forma, mantenha os dados burros

```java
sealed interface Transaction permits Order, Refund {}

record Order(String product, int quantity, double price) implements Transaction {}
record Refund(String reason, double amount) implements Transaction {}

record Customer(String name, String address, List<Transaction> history) {}
```

Nada aqui faz nada. `Order` e `Refund` são dados puros — nenhum método de
negócio vive em nenhum dos dois. O comportamento vive em outro lugar, como
uma função dos dados:

```java
double balanceFor(Customer c) {
    double balance = 0;
    for (Transaction tx : c.history()) {
        balance += switch (tx) {
            case Order(var product, var qty, var price) -> qty * price;
            case Refund(var reason, var amount)          -> -amount;
        };
    }
    return balance;
}
```

`switch` desestrutura os componentes de cada record diretamente no rótulo do
case (record patterns), e — como `Transaction` é `sealed` com exatamente
duas implementações permitidas — o compilador consegue provar que esse
`switch` é exaustivo. Sem ramo `default`, e nenhum é necessário: adicione um
terceiro tipo a `permits` em `Transaction` amanhã, e este método **deixa de
compilar** até que você adicione um `case` correspondente, em todo `switch`
sobre `Transaction` na base de código. Esse é o ganho de fato — o
compilador, não um revisor de código, encontra todo lugar onde uma nova
variante precisa ser tratada.

### Por que separar os dados das operações, afinal

O instinto contra o qual DOP empurra é: "um `Refund` deveria ter um método
`.apply(Ledger)`, é para isso que serve a OOP." Duas coisas dão errado em
escala se todo record cresce com o próprio comportamento:

1. **O record deixa de ser reutilizável entre contextos.** Um `Refund`
   usado para billing e um `Refund` usado para lógica de revisão de fraude
   querem operações diferentes sobre os mesmos dados; colocar os dois
   conjuntos de métodos no record acopla duas preocupações não relacionadas
   a uma classe.
2. **Você perde o poder da garantia de exaustividade.** Se
   `Refund.process()` é um método entre muitos, adicionar um novo subtipo de
   `Transaction` significa dar grep por toda classe que tem um método
   correspondente — exatamente o problema "eu tratei todo caso?" que tipos
   sealed + `switch` foram feitos para resolver em tempo de compilação,
   reintroduzido à mão.

O enquadramento original de quatro princípios de Goetz (2022) era: modele os
dados, todo o dado, e nada além do dado; torne o dado imutável; torne
estados ilegais irrepresentáveis; valide na fronteira. Um enquadramento "v1.1"
atualizado (2024), depois de mais uso no mundo real, reorganizou isso e
trocou "valide na fronteira" por um quarto princípio explícito —
**separe operações de dados** — declarado como sua própria regra em vez de
um efeito colateral dos outros: operações pertencem a código dedicado, não
como métodos de instância no record que modela o dado.

### Tornando estados ilegais irrepresentáveis

Um record com um campo `String` irrestrito para "type" é exatamente a forma
contra a qual DOP argumenta — nada impede que quem chama construa um `Order`
com uma `quantity` negativa, ou uma string `status` com um erro de digitação.
Dois mecanismos fecham essa lacuna:

```java
record Order(String product, int quantity, double price) implements Transaction {
    Order {                                    // compact constructor
        if (quantity <= 0) throw new IllegalArgumentException("quantity must be positive");
        if (price < 0)     throw new IllegalArgumentException("price cannot be negative");
    }
}
```

O compact constructor valida todo caminho de construção — não há um segundo
construtor para esquecer de proteger. E a própria hierarquia sealed é o
segundo mecanismo: `Transaction` só *pode* ser `Order` ou `Refund`, então
"algum outro tipo de transação não modelado" não é um estado que o sistema
de tipos deixará existir de forma alguma, ao contrário de um campo
`String kind` que tecnicamente aceita qualquer coisa.

### Onde uma union discriminada costumava precisar de um workaround

Antes de tipos sealed + record patterns (Java 21), a mesma ideia existia mas
precisava de uma hierarquia estilo visitor pattern (muito boilerplate para
um conjunto fechado de formas) ou uma "tagged union" mantida manualmente com
enum-mais-campos, sem ajuda do compilador para distinguir quais campos são
válidos para qual tag. A combinação `sealed interface` + `record` + `switch`
exaustivo dá a mesma garantia — todo caso tratado, nenhuma combinação
ilegal representável — sem nenhuma dessa cerimônia, que é o motivo concreto
pelo qual esse padrão hoje é o padrão idiomático para esse tipo de
modelagem, em vez de uma técnica de nicho.

## Trade-offs

- **DOP é adequado para problemas fechados e em forma de dados — não é um
  substituto geral para OOP.** Código com invariantes genuinamente
  encapsuladas que precisam ser mantidas ao longo de muitas operações
  mutantes durante o ciclo de vida de um objeto (um connection pool, um
  cache com política de eviction) ainda é melhor servido por classes que
  escondem seu estado e expõem comportamento — DOP é especificamente para o
  problema "aqui está um conjunto fixo de formas de dados, processe-as".
- **Exaustividade só é uma garantia enquanto a hierarquia permanece
  `sealed` e dentro de uma fronteira de módulo/pacote que você controla.**
  Ela não dá nada para formas de dados que vêm de uma fonte que você não
  possui (uma API externa, um sistema de plugins) — essas ainda precisam de
  um fallback de "caso desconhecido" em runtime, não um em tempo de
  compilação.
- **Separar dados de operações pode espalhar lógica que se lê melhor
  junta.** Um `Refund` com uma interpretação pesada em validação que é
  genuinamente central ao que um `Refund` *é* (em oposição ao que um
  consumidor específico faz com ele) pode se ler de forma mais clara como
  uma invariante de compact constructor no record do que como código
  externo — DOP não argumenta contra métodos que pertencem à própria
  definição do dado, só contra métodos que codificam o processo de negócio
  de um chamador específico.
- **O próprio enquadramento do princípio ainda está em movimento.** O time
  do próprio Goetz revisou os quatro princípios uma vez (2022 → o "v1.1" de
  2024), o que vale a pena saber antes de tratar qualquer lista numerada
  específica como a declaração final e canônica da ideia, em vez da melhor
  articulação atual dela.
- **Records + tipos sealed + pattern matching são os pré-requisitos, não a
  DOP em si** — uma base de código que já usa os três individualmente não
  "fez DOP" automaticamente; a disciplina é escolher manter os dados e a
  lógica separados de propósito, o que pattern matching sobre records
  permite mas não impõe.

## Documentation Links

- [Data Oriented Programming in Java — Brian Goetz, InfoQ](https://www.infoq.com/articles/data-oriented-programming-java/) — doc
- [Data-Oriented Programming in Java, Version 1.1 — Inside.java](https://inside.java/2024/05/23/dop-v1-1-introduction/) — doc
- [Why Update Data-Oriented Programming to Version 1.1? — Inside.java](https://inside.java/2024/06/26/dop-v1-1-why-update/) — doc
- [Separate Operations From Data — Data-Oriented Programming v1.1 — Inside.java](https://inside.java/2024/06/05/dop-v1-1-separate-operations/) — doc
- [JEP 440: Record Patterns](https://openjdk.org/jeps/440) — doc
- [JEP 409: Sealed Classes](https://openjdk.org/jeps/409) — doc
