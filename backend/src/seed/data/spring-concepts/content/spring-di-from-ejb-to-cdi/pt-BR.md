---
version: 1.0
updatedAt: 2026-08-05
title: Injeção de Dependência — do EJB ao Jakarta CDI
summary: Como a injeção de dependência gerenciada por container evoluiu dos deployment descriptors XML do EJB para a especificação formal Jakarta CDI, e por que @Autowired/@Component e @Inject/@Named são dois dialetos do mesmo modelo subjacente no Spring e no Quarkus.
---
## Objective

`@Autowired` e `@Inject` fazem a mesma coisa — isso não é coincidência, é o
fim de uma linhagem. A injeção de dependência no Java enterprise não
começou como uma feature do Spring: ela surgiu dos componentes gerenciados
por container do EJB no fim dos anos 1990, amadureceu até virar uma
especificação formal e independente de framework (Jakarta CDI — Contexts
and Dependency Injection), e hoje Spring, Quarkus e todo servidor Jakarta
EE sério implementam (ou interoperam com) os mesmos conceitos subjacentes:
beans, tipos de bean, qualifiers e escopos. Entender o CDI como o
vocabulário compartilhado — não uma ideia específica do Spring — explica
por que `@Inject`/`@Autowired`, `@Named`/`@Component` e `@Qualifier`
existem lado a lado e significam quase a mesma coisa.

## Use Cases

- Ler código Jakarta EE / Quarkus desconhecido que usa
  `@Inject`/`@ApplicationScoped`/`@Singleton` e reconhecer que é o mesmo
  modelo mental do `@Autowired`/`@Component`/beans singleton do Spring, só
  escrito de forma diferente.
- Desambiguar múltiplas implementações da mesma interface com um qualifier
  (`@Qualifier`/anotação customizada no CDI, `@Qualifier`/`@Primary` no
  Spring) em vez de recorrer a nomes de bean baseados em string.
- Decidir se as dependências de um componente devem ser resolvidas
  eagerly na inicialização (fail-fast, maior custo de memória/startup) ou
  lazily no primeiro uso (startup mais rápido, adia falhas) — uma escolha
  arquitetural de verdade, não apenas um default de framework a aceitar
  cegamente.
- Escrever código de DI portável (`jakarta.inject.@Inject`/`@Named`/`@Singleton`)
  quando uma base de código pode precisar rodar em mais de um container,
  em vez de se comprometer com anotações proprietárias de framework em
  todo lugar.

## Deep Dive

### De onde veio a DI: EJB e o deployment descriptor

Antes das anotações, o gerenciamento de dependências no Java EE era
declarado inteiramente em XML. O tipo de um EJB, o comportamento
transacional e o papel de segurança viviam em `ejb-jar.xml`, separados do
código-fonte Java:

```xml
<ejb-jar>
  <enterprise-beans>
    <session>
      <ejb-name>OrderService</ejb-name>
      <ejb-class>com.company.ejb.OrderServiceBean</ejb-class>
      <session-type>Stateless</session-type>
      <transaction-type>Container</transaction-type>
    </session>
  </enterprise-beans>
</ejb-jar>
```

O container EJB cuidava da instanciação, ciclo de vida, transações e
segurança para o desenvolvedor — uma implementação antiga e funcional de
Inversão de Controle — mas cada pequena mudança significava editar XML,
recompilar e fazer redeploy. O Java EE 5 (2006) substituiu isso por
anotações diretamente na classe:

```java
@Stateless
public class OrderServiceBean {
    @PersistenceContext
    private EntityManager em;

    public void processOrder(Order order) {
        em.persist(order);
    }
}
```

Mesmo comportamento, sem arquivo externo — o container lê `@Stateless` e
`@PersistenceContext` diretamente da classe no momento do deploy.

### CDI: injeção de dependência como especificação, não como feature de framework

O Jakarta CDI formaliza o que significa "o container resolve suas
dependências", independentemente de quem o implementa. Seu vocabulário
central:

- **Bean** — qualquer classe que o container gerencia (instancia,
  acompanha o ciclo de vida, injeta onde necessário).
- **Bean Type** — todo tipo pelo qual um bean pode ser injetado (suas
  interfaces, superclasses e ele mesmo).
- **Qualifier** — uma anotação que desambigua entre múltiplos beans do
  mesmo tipo.
- **Scope** — por quanto tempo uma instância de bean vive
  (`@ApplicationScoped`, `@RequestScoped`, `@Dependent`, ...).

```java
public interface PaymentProcessor {
    void process(Payment payment);
}

@ApplicationScoped
public class PaypalProcessor implements PaymentProcessor { /* ... */ }

@Inject
PaymentProcessor processor;  // container resolves this to a PaypalProcessor instance
```

O código consumidor nunca nomeia a classe concreta — ele declara a
abstração de que precisa, e o container fornece uma instância. Quando mais
de uma implementação existe, uma anotação marcada com `@Qualifier`
desambigua:

```java
@Qualifier
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.TYPE, ElementType.METHOD})
public @interface Paypal {}

@Paypal @ApplicationScoped
public class PaypalProcessor implements PaymentProcessor { /* ... */ }

@Inject @Paypal
PaymentProcessor processor;   // now unambiguous
```

### Spring e Quarkus: duas relações diferentes com a mesma especificação

O Spring é anterior à padronização do CDI — ele construiu seu próprio
container IoC e suas próprias anotações (`@Autowired`, `@Component`,
`@Service`, `@Repository`) antes de o CDI existir. Em vez de ficar isolado,
o Spring depois adicionou suporte às anotações equivalentes do JSR-330
(`jakarta.inject`), então os dois estilos funcionam hoje e são
funcionalmente equivalentes dentro de um `ApplicationContext`:

```java
// Spring's own annotation
@Autowired
private PaymentProcessor processor;

// The CDI/JSR-330 equivalent — resolves the same way
@Inject
private PaymentProcessor processor;
```

O Quarkus seguiu o caminho oposto: foi construído desde o início dentro da
era Jakarta EE e implementa o CDI diretamente através da sua própria
implementação de container, o Arc, otimizado para startup rápido e baixo
consumo de memória em vez do perfil clássico de application server. Código
Quarkus usando `@Inject`/`@ApplicationScoped`/`@Singleton` é, por design,
portável para qualquer container CDI compatível (Payara, WildFly, TomEE)
com pouca ou nenhuma mudança — a compatibilidade do Spring é um suporte
adicional mais pragmático do que uma implementação nativa.

### Instanciação eager vs. lazy de beans

Os dois frameworks também têm, por padrão, estratégias de instanciação
opostas para beans com escopo singleton, e isso é um trade-off deliberado,
não um acidente:

- **Spring**: eager por padrão — o `ApplicationContext` instancia todo bean
  singleton na inicialização. Erros de configuração (uma implementação
  faltando, uma dependência insatisfazível) surgem imediatamente no boot em
  vez de em tempo de requisição, ao custo de um startup mais longo e mais
  memória usada de antemão, independentemente de todo bean chegar a ser
  usado.
- **Quarkus (modo dev/lazy)**: adia a instanciação até que um bean seja de
  fato necessário pela primeira vez. O startup é mais rápido e o uso de
  memória menor, mas um grafo de dependências quebrado pode não ser
  descoberto até que o caminho de código que precisa dele de fato rode.

## Trade-offs

- **`@Inject` (JSR-330) é um subconjunto estrito do comportamento do
  `@Autowired`** — `@Inject` não tem atributo `required`; uma dependência
  insatisfazível sempre falha. Para expressar "injete se presente, senão
  ignore", `@Autowired(required = false)` tem uma resposta direta de uma
  linha, enquanto o equivalente em `@Inject` significa envolver a
  dependência em `Optional<T>` ou anotá-la com `@Nullable`.
```java
@Autowired(required = false)
private PaymentProcessor optionalProcessor;   // no equivalent one-liner in plain @Inject
```
- **`@Named` não é componível da forma que `@Component` é** — o Spring
  permite construir anotações de estereótipo customizadas em cima de
  `@Component` (por exemplo, um `@RestService` específico do projeto
  meta-anotado com `@Component`); `@Named` não suporta esse padrão, então
  times que padronizam puramente em anotações JSR-330 perdem essa
  extensibilidade.
- **O escopo default do JSR-330 é prototype, o do Spring é singleton** —
  um bean anotado com `@Named` sem escopo explícito se comporta diferente
  sob a semântica estrita do JSR-330 (uma instância nova por injeção) do
  que a mesma classe anotada com `@Component` (um singleton compartilhado),
  a menos que o escopo seja declarado explicitamente — uma fonte sutil de
  bugs ao misturar os dois estilos de anotação em uma mesma base de código.
- **Instanciação eager troca custo de startup por detecção mais cedo de
  falhas** — o default do Spring pega um grafo de dependências quebrado no
  boot (discutivelmente mais seguro para produção), enquanto o default lazy
  do Quarkus favorece iteração rápida em modo dev; nenhum dos dois é
  universalmente "correto", e a escolha deveria combinar com o contexto de
  deploy (um servidor de vida longa vs. uma função serverless de escala
  rápida).
- **Livro vs. hoje**: o material de origem deste conceito cita "Jakarta CDI
  4.0". A especificação atual liberada é a **CDI 4.1**, distribuída com o
  **Jakarta EE 11**; a **CDI 5.0** já está em desenvolvimento para o
  próximo Jakarta EE 12. Nenhum dos conceitos descritos aqui (Bean Types,
  Qualifiers, Scopes) mudou entre a 4.0 e a 4.1 — isso é uma correção de
  número de versão, não uma mudança de comportamento.

## Documentation Links

- [Jakarta Contexts and Dependency Injection (CDI) — specification page](https://jakarta.ee/specifications/cdi/) — doc
- [Spring Framework Reference — Using JSR 330 Standard Annotations](https://docs.spring.io/spring-framework/reference/core/beans/standard-annotations.html) — doc
- [Spring Framework Reference — Autowiring Collaborators (@Autowired)](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html) — doc
- [Quarkus — Introduction to Contexts and Dependency Injection (Arc)](https://quarkus.io/guides/cdi) — doc
