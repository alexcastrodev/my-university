---
version: 1.0
updatedAt: 2026-08-13
title: "Design de Exceções: Quando Lançar, e Checked vs. Unchecked Como Escolha"
summary: Como decidir se uma falha deveria sequer ser modelada como exceção, e se um novo tipo de exceção deveria ser checked ou unchecked.
---
## Objective

Saber a sintaxe de `try`/`catch`/`throw` não diz quando uma exceção é a ferramenta certa, nem que tipo de exceção projetar. Duas decisões ficam acima da mecânica: se uma falha deveria ser modelada como exceção, e não como lógica comum, e — uma vez decidido que um novo tipo de exceção é justificado — se ele deveria ser checked (o compilador força todo chamador a confrontá-la) ou unchecked (uma `RuntimeException` que ninguém é obrigado a capturar). Ambas são decisões de design de API com consequências reais para o quão agradável, ou doloroso, é chamar o seu código.

## Use Cases

- Decidir se uma operação dependente de estado (uma que só pode ter sucesso sob certas condições) deveria lançar exceção em caso de falha, ou expor uma verificação de estado que o chamador pode consultar antes.
- Definir um novo tipo de exceção para uma biblioteca ou fronteira de módulo e precisar de uma regra para checked vs. unchecked, em vez de escolher por hábito.
- Revisar uma API existente onde todo call site envolve o método em um `try`/`catch` que não faz nada útil, para decidir se a exceção checked deveria ser removida.
- Projetar caminhos de falha recuperáveis (I/O que pode ser tentado de novo, fundos insuficientes, entrada de usuário inválida) versus não recuperáveis (uma pré-condição de método violada, um bug).

## Deep Dive

### Exceções são para condições excepcionais, não para controle de fluxo

Exceções parecem controle de fluxo comum — um `throw` transfere o controle igual a um `return` ou `break` — mas uma JVM não otimiza o caminho de exceção da mesma forma que otimiza branches normais, e construir um `Throwable` captura um stack trace, o que custa tempo real. Um anti-padrão hoje clássico explora (e abusa) dessa forma: usar uma exceção de índice fora dos limites para terminar um loop em vez de testar o limite diretamente.

```java
// Anti-pattern — do not do this.
int i = 0;
try {
  while (true) {
    process(items[i++]);
  }
} catch (ArrayIndexOutOfBoundsException e) {
  // "normal" loop termination
}
```

contra o idioma que todo desenvolvedor Java reconhece de cara:

```java
for (int i = 0; i < items.length; i++) {
  process(items[i]);
}
```

A versão baseada em exceção não é só mais difícil de ler — ela é mensuravelmente mais lenta, já que o bloco `try` inibe otimizações da JVM disponíveis para loops comuns, e o próprio caminho de exceção não é feito para velocidade. Pior, ela nem sequer é confiavelmente correta: se `process` em si contém um bug que lança uma `ArrayIndexOutOfBoundsException` não relacionada (digamos, indexando um array *diferente* dentro dessa chamada), o `catch` engole a exceção e a reporta erroneamente como término normal do loop. Uma checagem de limite simples nunca pode confundir um bug real com uma saída normal; a versão baseada em exceção pode, silenciosamente.

O mesmo princípio molda o design de APIs, não só idiomas de loop: uma API bem projetada não deveria forçar seus chamadores a usar exceções para resultados comuns e esperados. `Iterator` é o exemplo padrão — `hasNext()` é um método de verificação de estado que permite ao chamador checar se é seguro chamar `next()`, então o idioma normal de iteração nunca precisa de um `try`/`catch`:

```java
Iterator<String> it = list.iterator();
while (it.hasNext()) {
  String s = it.next();
  // ...
}
```

Sem `hasNext()`, os chamadores ficariam presos capturando `NoSuchElementException` só para detectar o fim de uma coleção — exatamente o abuso mostrado acima, só que embutido em uma API em vez de em um loop. Ao projetar um método que só pode ser chamado com segurança em certos estados, prefira expor um método de verificação de estado (ou retornar um sentinela/`Optional`) a fazer da falha a única forma de descobrir isso.

### Escolhendo checked vs. unchecked ao definir um novo tipo de exceção

Java te dá duas escolhas reais para um novo tipo de exceção: subclassear `Exception` (checked — o compilador exige que todo chamador a capture ou a declare) ou subclassear `RuntimeException` (unchecked — o compilador não exige nada). O teste de design é simples: **o chamador pode razoavelmente se recuperar dessa condição?** Se sim, checked; se a condição sinaliza um bug — uma pré-condição violada, um estado interno inválido — unchecked.

Uma exceção checked para uma condição sobre a qual o chamador pode agir:

```java
public class InsufficientFundsException extends Exception {
  private final BigDecimal shortfall;

  public InsufficientFundsException(BigDecimal shortfall) {
    super("Short by " + shortfall);
    this.shortfall = shortfall;
  }

  public BigDecimal getShortfall() {
    return shortfall;
  }
}

public void withdraw(BigDecimal amount) throws InsufficientFundsException {
  if (amount.compareTo(balance) > 0) {
    throw new InsufficientFundsException(amount.subtract(balance));
  }
  balance = balance.subtract(amount);
}
```

O chamador tem um caminho de recuperação real — pedir um valor menor, oferecer um top-up — e o accessor `getShortfall()` da exceção checked lhe dá os dados para isso. Forçar todo chamador a pelo menos reconhecer esse resultado é uma vantagem, não um atrito, porque ignorá-lo silenciosamente seria um bug real.

Uma exceção unchecked para uma violação de pré-condição — um erro de programação, não um resultado de negócio:

```java
public void withdraw(BigDecimal amount) {
  if (amount.signum() < 0) {
    throw new IllegalArgumentException("amount must not be negative: " + amount);
  }
  // ...
}
```

Não há nada que um chamador possa "se recuperar" de forma significativa aqui — passar um valor negativo é um bug no próprio código do chamador, e o conserto é mudar esse código, não capturar uma exceção em tempo de execução. Tornar isso checked forçaria todo call site a envolver uma chamada em `try`/`catch` para uma condição que nunca deveria acontecer se o chamador estiver correto. `IllegalArgumentException`, `IllegalStateException` e `NullPointerException` são os tipos unchecked padrão que o próprio JDK usa exatamente para esse propósito — recorra a eles (ou a uma subclasse própria de `RuntimeException`) antes de inventar uma exceção checked para uma condição de bug. Quando genuinamente não está claro se uma falha é recuperável, prefira unchecked por padrão: uma exceção checked desnecessária tem um custo real, coberto a seguir.

### Por que uma exceção checked desnecessária é pior que nenhuma

Uma exceção checked é um mandato: todo chamador precisa tratá-la ou propagá-la. Isso vale a pena quando há algo útil a fazer em resposta — é um imposto sem retorno quando não há. Um teste decisivo para saber se uma exceção checked está valendo a pena: imagine o melhor bloco `catch` que um chamador poderia realisticamente escrever. Se ele se parece com isto,

```java
try {
  configLoader.reload();
} catch (ConfigReloadException e) {
  throw new AssertionError("can't happen", e); // caller has no real recovery
}
```

ou isto,

```java
try {
  configLoader.reload();
} catch (ConfigReloadException e) {
  e.printStackTrace(); // oh well
}
```

a exceção checked não está comprando segurança, está comprando boilerplate — todo call site ou fabrica um wrapper de "não pode acontecer" ou descarta silenciosamente a falha, o que é pior do que não forçar um `catch` de forma alguma. Existem dois designs melhores dependendo de quão excepcional a falha realmente é:

Redesenhado com uma exceção unchecked, quando falhas de reload realmente são um problema de bug/ambiente sobre o qual o chamador não pode agir por chamada:

```java
public void reload() {
  if (!configFile.exists()) {
    throw new ConfigReloadException("missing config file: " + configFile);
  }
  // ...
}
// ConfigReloadException extends RuntimeException — no throws clause,
// no forced catch; callers that can meaningfully react still may.
```

Ou, quando existem genuinamente dois resultados comuns em vez de um comum e um excepcional, pule a exceção inteiramente e retorne um `Optional`:

```java
public Optional<Config> tryReload() {
  if (!configFile.exists()) {
    return Optional.empty();
  }
  return Optional.of(parse(configFile));
}

// call site reads as plain control flow, no try/catch anywhere
tryReload().ifPresentOrElse(
    this::applyConfig,
    () -> log.warn("no config file, keeping previous settings")
);
```

Ambas as alternativas removem o `try`/`catch` forçado de todo call site, ao mesmo tempo em que continuam expondo a falha para chamadores que realmente querem verificá-la — a forma que retorna `Optional` é estritamente um encaixe melhor do que checked ou unchecked quando "config faltando" é um resultado normal e esperado, não um bug ou uma falha rara.

## Trade-offs

- **Uma exceção checked é uma promessa sobre a qual o chamador pode agir — garanta que isso seja verdade antes de adicionar uma.** Antes de subclassear `Exception`, escreva o melhor bloco `catch` realista para ela; se ele só pode relançar, logar-e-sair, ou afirmar "não pode acontecer", a condição provavelmente pertence a um tipo unchecked.
- **Métodos de verificação de estado evitam exceções por completo para resultados esperados, mas só quando o estado não pode mudar entre a checagem e a chamada.** `hasNext()`/`next()` funciona porque nada externo muta o iterador entre as duas chamadas em uso single-threaded; sob acesso concorrente sem sincronização externa, o estado poderia mudar entre a checagem e a ação, então um valor de retorno distinto (ou capturar a exceção) é a única opção segura:
  ```java
  // unsafe under concurrent access: state may change between the two calls
  if (queue.hasNext()) {
    Item i = queue.next(); // could still throw if another thread drained it
  }
  ```
- **Exceções unchecked trocam a exigência em tempo de compilação por uma API mais leve — e essa troca não é reversível de forma casual.** Uma vez que chamadores dependem de um método *não* forçar um `catch`, tornar essa exceção checked depois quebra todo esse call site em tempo de compilação; decidir checked-vs-unchecked é mais fácil de acertar na primeira vez que um novo tipo de exceção é introduzido.
- **Uma única exceção checked em um método que de outra forma seria livre de `try` custa mais do que a mesma exceção em um método que já tem outras.** Se um método lança duas exceções checked, o chamador já está em um bloco `try` por causa da primeira, e a segunda só adiciona um `catch`; se for a única, a exceção checked sozinha força o chamador a envolver uma chamada que de outra forma seria direta — vale a pena pesar quando um método lança exatamente um tipo checked.
- **`Optional` comunica "sem resultado" de forma limpa, mas não é um substituto direto para exceção quando a falha precisa de uma explicação.** `Optional.empty()` não carrega nenhuma informação sobre *por quê* — sem valor de shortfall, sem código de erro — então ele se encaixa em um resultado genuinamente binário de presente/ausente, não em uma falha que um chamador precisa diagnosticar ou exibir.

## Documentation Links

- [Exception (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html) — doc
- [RuntimeException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html) — doc
- [Optional (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) — doc
- [Iterator (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) — doc
- [Unchecked Exceptions — The Controversy — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/exceptions/runtime.html) — doc
