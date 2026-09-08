---
version: 1.0
updatedAt: 2026-08-13
title: "Teste Baseado em Saída, em Estado, e em Comunicação"
summary: "As três formas de um teste unitário verificar comportamento: checar uma saída retornada, checar o estado resultante, ou checar uma chamada feita a um colaborador, e por que o teste baseado em saída produz os testes de mais alta qualidade mas só funciona para código livre de efeitos colaterais, deixando o teste baseado em estado como o padrão razoável e o teste baseado em comunicação (mocks) como a exceção rara."
---
## Objective

Aprender as três formas pelas quais um teste unitário pode verificar que um pedaço de código fez a coisa certa: checando uma **saída (output)** retornada, checando o **estado (state)** resultante, ou checando que o SUT **se comunicou** com um colaborador de uma certa forma, e entender o ranking de Khorikov entre os três: o teste baseado em saída produz os testes de mais alta qualidade, o teste baseado em estado é o padrão razoável para todo o resto, e o teste baseado em comunicação (verificação de mock) deveria ser reservado para o caso raro.

## Use Cases

- Decidir, para um novo teste, qual dos três estilos de fato se encaixa no comportamento sendo verificado, em vez de usar por padrão o estilo que a classe de teste ao redor já usa.
- Reconhecer por que uma suíte de testes cheia de chamadas `verify(...)` tende a ser a mais cara de manter e a mais propensa a quebrar em refatorações inofensivas, sem precisar relitigar a fragilidade de mocks do zero.
- Explicar por que "simplesmente faça disso uma função pura" é um argumento de testabilidade, não só uma preferência de programação funcional; uma função pura é testável por saída quase por definição.

## Deep Dive

### Os três estilos, testando o mesmo comportamento de três formas

Os três estilos conseguem verificar exatamente o mesmo pedaço de comportamento (adicionar um item a um carrinho), mas checam três coisas diferentes: o valor que um método retorna, o estado deixado para trás depois, ou a chamada que um método faz a um colaborador.

**Baseado em saída**: a operação do carrinho é uma função pura. Alimente-a com uma entrada, cheque o que volta. Não há estado mutável a inspecionar; o valor de retorno é a *única* coisa que o teste precisa verificar.

```java
static List<String> addItem(List<String> items, String item) {
    List<String> result = new ArrayList<>(items);
    result.add(item);
    return result;
}

@Test
void addingAnItemReturnsAnExtendedList() {
    List<String> updated = addItem(List.of("bread"), "milk");

    assertEquals(List.of("bread", "milk"), updated);
}
```

**Baseado em estado**: o carrinho é um objeto com estado. A operação o muta, e o teste chama um método de consulta depois para inspecionar o que mudou.

```java
class Cart {
    private final List<String> items = new ArrayList<>();

    void addItem(String item) {
        items.add(item);
    }

    List<String> getItems() {
        return List.copyOf(items);
    }
}

@Test
void addingAnItemUpdatesTheCartState() {
    Cart cart = new Cart();

    cart.addItem("milk");

    assertEquals(List.of("milk"), cart.getItems());
}
```

**Baseado em comunicação**: o carrinho não guarda os itens ele mesmo, delega a um colaborador, e a única coisa que vale a pena checar é se essa delegação aconteceu corretamente.

```java
interface InventoryReserver {
    void reserve(String sku);
}

class Cart {
    private final InventoryReserver reserver;

    Cart(InventoryReserver reserver) {
        this.reserver = reserver;
    }

    void addItem(String sku) {
        reserver.reserve(sku);
    }
}

@ExtendWith(MockitoExtension.class)
class CartTest {
    @Mock
    InventoryReserver reserverMock;

    @Test
    void addingAnItemReservesInventory() {
        Cart cart = new Cart(reserverMock);

        cart.addItem("SKU-42");

        Mockito.verify(reserverMock).reserve("SKU-42");
    }
}
```

Mesma ideia subjacente ("adicionar um item"), três asserções diferentes: um valor de retorno, uma fotografia de estado, e uma chamada registrada.

### Por que o teste baseado em saída vence, e sua limitação real

Resistência à refatoração se resume a quanto do código de produção um teste está acoplado. Um teste baseado em saída se acopla a exatamente uma coisa: o mapeamento de entrada para saída do método sob teste. Não sabe nem se importa com como esse mapeamento é calculado internamente, então quase qualquer refatoração que preserve o mapeamento (renomear um helper, trocar um loop por um stream, reestruturar a classe inteira) deixa o teste verde. A única forma de um teste baseado em saída quebrar em uma refatoração é se o próprio método sob teste for um detalhe de implementação sendo renomeado ou removido, o que é um modo de falha muito mais estreito do que "o teste por acaso afirmava sobre algo que mudou".

Testes baseados em saída também vencem em manutenibilidade por um motivo estrutural: eles se resumem a "chame, cheque o valor de retorno", o que quase sempre são poucas linhas, e como o código subjacente não pode tocar estado compartilhado ou fora de processo, não há nada extra para preparar ou desmontar.

A pegadinha é a restrição que o Objective já nomeou: esse estilo só funciona quando o código sob teste não tem efeitos colaterais observáveis: nenhuma escrita em um campo, nenhuma chamada a um banco de dados, nenhuma mutação de um argumento. Essa é uma limitação real, não uma preferência de estilo. Um `Cart` que precisa rastrear quais itens estão nele, um `Order` que precisa se persistir, um `Controller` que precisa enviar um e-mail: nenhum desses pode ser verificado puramente pelo seu valor de retorno, porque seu valor de retorno não é o ponto de chamá-los. A maior parte do código orientado a objetos é escrita especificamente para causar algum efeito, que é exatamente o que o teste baseado em saída não consegue ver.

### Teste baseado em estado como padrão, e baseado em comunicação como exceção

Para o código que o teste baseado em saída não consegue alcançar, que, na maioria das bases de código, é a maior parte do código, o teste baseado em estado é o substituto razoável. Ele ainda checa um *resultado*: o estado do SUT (ou de um colaborador, ou de uma dependência fora de processo) depois que a operação rodou. É uma versão menor, mas real, do mesmo argumento de resistência à refatoração: o teste não sabe *como* `addItem` atualizou a lista, só que a lista agora contém o item. O custo aparece na manutenibilidade em vez disso: o estado pode ser grande, então verificar "a coisa certa aconteceu com o objeto inteiro" pode levar várias linhas de asserção onde um teste baseado em saída precisaria de uma (compare o bloco de asserção de quatro linhas que uma checagem de estado em uma coleção `Comments` precisa contra o único `assertEquals` que uma checagem baseada em saída equivalente precisaria). Value objects com igualdade adequada, ou pequenos helpers de asserção, conseguem reduzir essa verbosidade, mas não removem a diferença de tamanho subjacente.

Teste baseado em comunicação, verificar que o SUT chamou um colaborador de uma forma particular, como no exemplo `InventoryReserver` acima, deveria ser a exceção, não o padrão. O raciocínio se conecta diretamente a por que mockar detalhes de implementação torna os testes frágeis: um padrão de chamada normalmente não é o comportamento observável com que um cliente se importa, é como esse comportamento por acaso é implementado hoje. Recorra a uma verificação de mock só quando a própria interação cruza a fronteira da aplicação e *é* o efeito observável: enviar um e-mail, publicar um evento, escrever em uma API externa da qual o sistema de outra pessoa depende. Qualquer coisa mais profunda sobre esse trade-off pertence especificamente à fragilidade de mocks, não a esta comparação.

Lado a lado, através das duas métricas que de fato diferem entre os estilos:

| | Baseado em saída | Baseado em estado | Baseado em comunicação |
|---|---|---|---|
| Diligência necessária para resistência à refatoração | Baixa | Média | Média (alta se usado em excesso) |
| Custo de manutenibilidade | Baixo | Médio | Alto |

(Proteção contra regressões e velocidade de feedback não dependem de forma significativa do estilo escolhido; dependem de quanto código roda e quão rápido roda, o que qualquer um dos três consegue atingir.)

## Trade-offs

- **Baseado em saída é o teste mais barato de escrever, mas exige pureza que você pode não ter**: um método que só mapeia entrada para saída é trivial de testar e quase à prova de refatoração, mas muito comportamento real (persistir um pedido, atualizar um carrinho) é definido pelo seu efeito colateral, não pelo seu valor de retorno, então esse estilo simplesmente não se aplica ali.
- **O custo de verificação baseada em estado escala com o tamanho do estado que você está checando**: uma mudança de campo único é quase tão barata quanto uma checagem de saída, mas um objeto com múltiplos campos pode forçar várias linhas de asserção para um único comportamento:

  ```java
  assertEquals(1, article.getComments().size());
  assertEquals("Comment text", article.getComments().get(0).getText());
  assertEquals("John Doe", article.getComments().get(0).getAuthor());
  ```
  contra uma única linha se esse mesmo comentário fosse comparado como um value object com `assertEquals(expectedComment, article.getComments().get(0))`.
- **Testes baseados em comunicação são os mais caros de manter verdes**: todo mock precisa ser preparado, e todo `verify(...)` prende o teste a uma forma específica de chamada; cadeias de mock (um mock retornando um mock retornando um mock) multiplicam esse custo rápido e são um sinal de que o design, não só o teste, precisa de uma revisão.
- **Usar mocks em excesso não custa só manutenibilidade, pode esconder superficialidade**: um teste que mocka tudo, exceto uma fatia fina do SUT, ainda pode passar sem verificar quase nenhum comportamento real; isso é um sintoma de depender do teste baseado em comunicação como padrão, em vez de como ferramenta ocasional.
- **Os três estilos podem aparecer no mesmo teste, e tudo bem**: um teste pode chamar um método, checar seu valor de retorno, *e* inspecionar o estado que deixou para trás; o que importa é saber qual asserção está de fato fazendo o trabalho de capturar uma regressão, e qual está só de carona.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 6 "Styles of Unit Testing", pp. 119-128
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/)
- [java.util.List (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html)
