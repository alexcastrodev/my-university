---
version: 1.0
updatedAt: 2026-08-18
title: O Java Platform Module System (JPMS)
summary: O que module-info.java realmente declara — requires, requires transitive, exports, opens, uses/provides — e por que um pacote não exportado é invisível para outros módulos mesmo quando todo tipo dentro dele é público. Cobre o módulo sem nome (onde a maior parte do código de aplicação ainda roda, sem nenhuma dessas garantias), módulos automáticos como ponte de migração, jlink para imagens de runtime mínimas, e os trade-offs honestos: pacotes divididos proibidos, a tensão entre opens e encapsulamento forte, e o quão lenta tem sido a adoção no mundo real.
---
## Objective

Entenda o Java Platform Module System (JPMS, JDK 9+): um **módulo** é uma unidade de empacotamento que fica acima do pacote e abaixo do classpath, declarando em um arquivo `module-info.java` exatamente quais dos seus pacotes são expostos (`exports`) e de quais outros módulos ele depende (`requires`). Diferente do classpath plano — onde `public` significava público para todo mundo, em todo lugar, e "esse pacote é interno" era documentação mais esperança — o compilador e o runtime de fato **impõem** essas fronteiras: acesso ilegal é erro de compilação, e acesso reflexivo ilegal é exceção em tempo de execução.

## Use Cases

- Publicar uma biblioteca cujo pacote de API pública é alcançável enquanto seus pacotes de implementação são genuinamente inacessíveis aos consumidores, em vez de apenas desencorajados por uma convenção de nome tipo `.internal.`.
- Declarar um grafo de dependências verificado por máquina entre os próprios módulos de uma aplicação, de forma que uma dependência ausente falhe em tempo de compilação ou no lançamento, em vez de aparecer como um `NoClassDefFoundError` em produção.
- Rodar `jlink` para montar uma imagem de runtime customizada contendo apenas os módulos do JDK que a aplicação realmente usa — uma alavanca real sobre o tamanho da imagem de container e o tempo de startup.
- Ler um `IllegalAccessError` ou `InaccessibleObjectException` cuja mensagem menciona módulos, e saber que é uma decisão de encapsulamento falando, não um mistério genérico de classpath.

## Deep Dive

### module-info.java: a declaração do módulo

Um módulo é declarado por um único `module-info.java` na raiz da sua árvore de código-fonte. Ele nomeia o módulo e lista suas diretivas:

```java
module com.example.orders {
    requires com.example.catalog;
    requires transitive java.sql;

    exports com.example.orders.api;

    opens com.example.orders.model to com.fasterxml.jackson.databind;

    uses com.example.orders.spi.PricingStrategy;
    provides com.example.orders.spi.PricingStrategy
        with com.example.orders.internal.DefaultPricingStrategy;
}
```

Nada aqui é metadado opcional: cada diretiva muda o que compila e o que roda.

### requires: uma dependência verificada

`requires` declara uma dependência que vale em tempo de compilação *e* em tempo de execução. Sem ela, o código deste módulo simplesmente não consegue referenciar um tipo do outro módulo — não há fallback tolerante:

```java
// in module com.example.orders, whose module-info.java omits `requires com.example.catalog;`
import com.example.catalog.Product;   // error: package com.example.catalog is not visible
                                      //   (package com.example.catalog is declared in module
                                      //    com.example.catalog, but module com.example.orders
                                      //    does not read it)
```

Todo módulo requer implicitamente `java.base`; todo o resto — incluindo `java.sql`, `java.xml`, `java.desktop` — precisa ser pedido pelo nome.

### requires transitive: repassando uma dependência

`requires transitive M` diz "quem requer *a mim* também lê M". Isso importa sempre que um tipo de `M` aparece na própria API exportada deste módulo:

```java
module com.example.orders {
    requires transitive java.sql;      // Connection leaks into the exported signature below
    exports com.example.orders.api;
}
```

```java
package com.example.orders.api;

import java.sql.Connection;

public interface OrderStore {
    void writeTo(Connection connection);   // consumers must be able to name Connection
}
```

Com `transitive`, um consumidor só precisa de `requires com.example.orders;`. Sem isso, todo consumidor teria que adicionar seu próprio `requires java.sql;` redundante só para chamar um método que este módulo já entregou a ele.

Também existe `requires static M`, uma dependência obrigatória em tempo de compilação mas opcional em tempo de execução — a escolha usual para processadores de anotação e integrações opcionais.

### exports: a aplicação de fato

`exports` torna os tipos `public` de um pacote legíveis por outros módulos. Um pacote que *não* é exportado é invisível fora do módulo, mesmo que todo tipo e método nele seja `public`:

```java
module com.example.orders {
    exports com.example.orders.api;
    // com.example.orders.internal is deliberately NOT exported
}
```

```java
// in another module
import com.example.orders.internal.DefaultPricingStrategy;
// error: package com.example.orders.internal is not visible
//   (package com.example.orders.internal is declared in module com.example.orders,
//    which does not export it)
```

Esse é todo o ponto do sistema: `public` agora significa "público para os módulos que eu escolhi", não "público para o mundo". Uma forma qualificada, `exports com.example.orders.internal to com.example.reporting;`, restringe a audiência a módulos nomeados específicos — útil para dividir um componente lógico em vários módulos sem abrir seus internals para todo mundo.

### opens: acesso reflexivo, concedido explicitamente

`exports` concede acesso em tempo de compilação a membros públicos. Isso **não** concede reflexão profunda em membros privados. Frameworks que setam campos privados diretamente — Jackson, Hibernate, Spring — precisam de `opens`:

```java
module com.example.orders {
    opens com.example.orders.model;                              // to every module
    opens com.example.orders.model to com.fasterxml.jackson.databind;  // or just to one
}
```

Sem isso, uma reflexão que funcionaria silenciosamente no classpath agora falha em tempo de execução:

```java
Field f = Order.class.getDeclaredField("total");
f.setAccessible(true);
// java.lang.reflect.InaccessibleObjectException: Unable to make field
//   private java.math.BigDecimal com.example.orders.model.Order.total accessible:
//   module com.example.orders does not "opens com.example.orders.model" to unnamed module @1b6d3586
```

Um `open module com.example.orders { ... }` abre todos os pacotes de uma vez — a válvula de escape bruta para migração. Note que `opens` e `exports` são independentes: um pacote pode ser aberto para reflexão sem ser exportado para `import`, o que é exatamente a forma certa para um pacote de entidades JPA ou DTOs que um framework precisa introspectar, mas contra o qual quem chama não deveria compilar.

### uses / provides: ServiceLoader, verificado pelo compilador

O module system absorve o padrão `ServiceLoader`. `uses` declara que este módulo consome uma interface de serviço; `provides X with Y` declara uma implementação concreta:

```java
module com.example.orders {
    uses com.example.orders.spi.PricingStrategy;
    provides com.example.orders.spi.PricingStrategy
        with com.example.orders.internal.DefaultPricingStrategy;
}
```

```java
ServiceLoader<PricingStrategy> loader = ServiceLoader.load(PricingStrategy.class);
PricingStrategy strategy = loader.findFirst()
    .orElseThrow(() -> new IllegalStateException("No PricingStrategy on the module path"));
```

A classe provedora não precisa ser exportada — o module system faz a conexão sozinho. Isso substitui o antigo arquivo de texto `META-INF/services/com.example.orders.spi.PricingStrategy`, cujo conteúdo nenhum compilador jamais validava, por uma declaração que o compilador verifica (o provider precisa existir, ser público, implementar o serviço, e ter um construtor sem argumentos ou um método estático `provider()`).

### Encapsulamento forte e o ataque ao singleton

Essa é a aplicação que o conceito [Singletons and Noninstantiable Utility Classes](/java-concepts/singleton-and-noninstantiable-classes) menciona de passagem. O ataque reflexivo de "clonar o singleton" —

```java
Constructor<Elvis> ctor = Elvis.class.getDeclaredConstructor();
ctor.setAccessible(true);
Elvis clone = ctor.newInstance();
```

— lança `InaccessibleObjectException` **somente** quando `Elvis` vive em um módulo nomeado cujo pacote não foi `opens`ado para o módulo de quem chama. Essa é uma condição estreita, e não é um recurso de segurança em que você deva se apoiar: é um efeito colateral de uma decisão de empacotamento tomada pelo autor da classe. O ponto que vale levar é que o encapsulamento aqui é *opt-in via fronteiras de módulo*, e é precisamente por isso que o conceito de singleton conclui que a forma enum (ou uma guarda explícita no construtor) é a defesa real.

### O módulo sem nome

Código carregado do classpath, sem nenhum `module-info.java`, cai no **módulo sem nome** (unnamed module). Suas regras são deliberadamente permissivas para que código pré-9 continue rodando:

- ele lê todo outro módulo, e pode usar todo pacote que esses módulos exportam;
- nenhum módulo pode fazer `requires` dele, porque ele não tem nome para escrever;
- e as proteções reflexivas descritas acima em grande parte não o afetam da forma que afetam módulos nomeados.

Esse último ponto é a lacuna que `singleton-and-noninstantiable-classes` aponta. É também o motivo pelo qual a história de enforcement soa teórica para a maioria dos desenvolvedores Java: a esmagadora maioria do código de aplicação — incluindo a maior parte dos serviços Spring Boot em 2026 — ainda é distribuída como JARs simples no classpath, no módulo sem nome, sem nenhum `module-info.java` em lugar algum do build. A adoção do JPMS *dentro do JDK* é total; a adoção para código de aplicação tem sido lenta e continua opcional.

### Módulos automáticos: a ponte de migração

Um JAR simples, sem `module-info.java`, colocado no **module path** (em vez do classpath), torna-se um **módulo automático**. O runtime lhe dá um nome e permissões implícitas amplas — ele lê todo outro módulo, e exporta e abre todos os seus pacotes — de forma que módulos reais e JARs não modularizados possam interoperar durante a migração:

```bash
java --module-path libs:mods --add-modules com.example.orders -m com.example.orders/com.example.orders.Main
```

O nome vem de um de dois lugares. Se o manifest do JAR declara um, ele prevalece:

```
Automatic-Module-Name: com.fasterxml.jackson.databind
```

Essa é a opção intencional e estável, e a que um mantenedor de biblioteca deveria fornecer bem antes de escrever um `module-info.java` de verdade. Caso contrário, o nome é derivado do nome do arquivo: remove-se a extensão `.jar`, remove-se um sufixo de versão no final, e as sequências restantes de caracteres não-alfanuméricos viram pontos — então `jackson-databind-2.17.0.jar` produz o nome de módulo `jackson.databind`. Um nome derivado é um risco, porque muda se o arquivo for renomeado, e pode colidir ou ser rejeitado de vez (um nome de arquivo que se reduz a um identificador Java inválido simplesmente falha ao carregar como módulo).

### jlink: um runtime com só o que você precisa

Como o próprio JDK é modularizado, `jlink` consegue resolver o grafo de módulos de uma aplicação e emitir uma imagem de runtime contendo apenas esses módulos:

```bash
jlink --module-path $JAVA_HOME/jmods:mods \
      --add-modules com.example.orders \
      --launcher orders=com.example.orders/com.example.orders.Main \
      --compress=zip-6 --no-header-files --no-man-pages \
      --output custom-runtime

./custom-runtime/bin/orders
```

O resultado roda sem um JDK instalado separadamente, e tipicamente é uma fração do tamanho de um JDK completo. Isso não é curiosidade: é um passo rotineiro em builds de container onde tamanho de imagem e tempo de cold-start importam, e é possivelmente o retorno mais amplamente realizado do module system.

## Trade-offs

- **Pacotes divididos são proibidos, e isso realmente quebra árvores de dependência reais.** Nenhum dos dois módulos no module path pode conter o mesmo pacote. Quando duas bibliotecas distribuem classes sob o mesmo nome de pacote (um resultado comum de JARs "extras" ou "compat"), o grafo de módulos se recusa a resolver, e não há uma saída limpa a não ser que as bibliotecas culpadas sejam reempacotadas:

```
java.lang.module.ResolutionException: Modules lib.core and lib.extras export package com.example.util to module app
```

- **`opens` e encapsulamento forte estão em tensão não resolvida.** Um ORM que seta campos privados, ou um serializador que percorre todo campo declarado, precisa de `opens` exatamente nos pacotes que você mais queria encapsular, e uma declaração `open module` entrega a garantia por completo:

```java
open module com.example.orders { }   // every package reflectively open to everyone
```

- **A adoção para código de aplicação tem sido lenta, e fingir o contrário engana.** O JDK está totalmente modularizado, mas a maioria das aplicações ainda roda no classpath, no módulo sem nome, onde nenhuma dessas garantias se aplica. Trate o JPMS como valioso primeiro para bibliotecas e para deployment baseado em `jlink`; um `module-info.java` em um serviço Spring Boot típico compra atrito antes de comprar garantias.
- **`requires transitive` é fácil de errar nas duas direções.** Omiti-lo força todo consumidor a redeclarar redundantemente uma dependência que suas próprias assinaturas exportadas já os obrigam a ter, enquanto marcar tudo como transitive vaza suas escolhas de dependência internas para o grafo de compilação deles — exatamente o vazamento de implementação que o module system existe para prevenir. A regra que de fato vale: torne transitive quando, e só quando, os tipos da dependência aparecem na sua API exportada.
- **Falhas reflexivas migram de tempo de compilação para tempo de execução.** Um `requires` ausente é pego pelo compilador, mas um `opens` ausente não é; ele aparece na primeira vez que um framework toca a classe, o que pode acontecer bem no meio do startup ou dentro de uma requisição:

```java
f.setAccessible(true);   // InaccessibleObjectException — nothing flagged this at compile time
```

- **As válvulas de escape de linha de comando facilitam nunca modularizar de verdade.** `--add-exports`, `--add-opens` e `--add-modules` existem para desbloquear migração, mas um build que acumula uma dúzia delas assumiu uma configuração permanente em troca do encapsulamento que deveria ter ganhado:

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED -jar app.jar
```

## Documentation Links

- [Understanding the Module System — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html) — doc
- [JEP 261: Module System](https://openjdk.org/jeps/261) — doc
- [jlink — Java SE Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
