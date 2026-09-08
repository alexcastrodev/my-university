---
version: 1.0
updatedAt: 2026-08-06
title: "Modelo de Extensão do JUnit 5"
summary: "Os cinco pontos de extensão (execução condicional, callbacks de ciclo de vida, resolução de parâmetros, tratamento de exceções, pós-processamento de instância) por trás do @ExtendWith, o mesmo mecanismo que MockitoExtension e SpringExtension usam, do JUnit in Action, Third Edition, Cap. 14."
---
## Objective

Onde o JUnit 4 tinha dois mecanismos de extensão separados (runners, `@RunWith`, um por classe, e rules, campos `@Rule`), o JUnit 5 unifica os dois em um único conceito: a API `Extension`. `Extension` é uma interface marcadora sem métodos próprios; uma classe implementa uma de suas subinterfaces (`ExecutionCondition`, `BeforeEachCallback`, `ParameterResolver`, ...) para se conectar a um `ponto de extensão` específico no ciclo de vida do teste, e `@ExtendWith` a registra em uma classe ou método de teste, o mesmo mecanismo que `MockitoExtension` e `SpringExtension` já usam.

## Use Cases

- Desabilitar um teste condicionalmente com base em ambiente/configuração (por exemplo, não rodar testes sensíveis a carga durante um período de negócio de "pico") via `ExecutionCondition`.
- Injetar um recurso nos parâmetros de um método de teste (uma conexão de banco de dados, um ID gerado) sem que o teste o construa por conta própria, via `ParameterResolver`.
- Rodar lógica de setup/teardown compartilhada em muitas classes de teste não relacionadas implementando `BeforeEachCallback`/`AfterEachCallback` uma única vez, em vez de duplicar métodos `@BeforeEach`.
- Traduzir um tipo específico de exceção para um resultado de teste diferente (por exemplo, tratar uma exceção conhecida de infraestrutura instável como "abortado" em vez de "falhou") via um ponto de extensão de tratamento de exceção.
- Entender ao que `@ExtendWith(MockitoExtension.class)` ou `@ExtendWith(SpringExtension.class)` de fato se conectam, em vez de tratá-los como anotações opacas.

## Deep Dive

### Os cinco pontos de extensão

Uma extensão do JUnit 5 se conecta a um de cinco momentos no ciclo de vida de um teste:

- **Execução condicional de teste**: controla se um teste roda ou não (`ExecutionCondition`).
- **Callback de ciclo de vida**: reage a eventos de ciclo de vida (`BeforeEachCallback`, `AfterEachCallback`, `BeforeAllCallback`, `AfterAllCallback`).
- **Resolução de parâmetro**: fornece um valor para um parâmetro de método de teste em tempo de execução (`ParameterResolver`).
- **Tratamento de exceção**: define o que acontece quando um teste lança um tipo específico de exceção (`TestExecutionExceptionHandler`).
- **Pós-processamento de instância de teste**: roda logo depois que uma instância de teste é construída, antes de qualquer callback de ciclo de vida (`TestInstancePostProcessor`).

Qualquer uma dessas interfaces pode ser implementada isoladamente ou combinada em uma classe; o JUnit chama a extensão registrada automaticamente assim que seu ponto de extensão é alcançado.

### Escrevendo uma extensão de execução condicional

Implementar `ExecutionCondition` permite que uma classe de teste opte por rodar ou não com base em algo externo ao próprio teste, aqui, um arquivo `context.properties` que diz se o sistema está em um período de carga `regular`, `low` ou `peak`:

```java
public class ExecutionContextExtension implements ExecutionCondition {
    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        Properties properties = new Properties();
        try {
            properties.load(ExecutionContextExtension.class
                    .getClassLoader()
                    .getResourceAsStream("context.properties"));
            String executionContext = properties.getProperty("context");
            if (!"regular".equalsIgnoreCase(executionContext) && !"low".equalsIgnoreCase(executionContext)) {
                return ConditionEvaluationResult.disabled("Test disabled outside regular and low contexts");
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        return ConditionEvaluationResult.enabled("Test enabled");
    }
}
```

Registrá-la em uma classe de teste usa o mesmo `@ExtendWith` usado para Mockito ou Spring:

```java
@ExtendWith(ExecutionContextExtension.class)
public class PassengerTest {
    @Test
    void testPassenger() {
        Passenger passenger = new Passenger("123-456-789", "John Smith");
        assertEquals("Passenger John Smith with identifier: 123-456-789", passenger.toString());
    }
}
```

Quando `context.properties` contém `context=peak`, todo teste dessa classe é reportado como desabilitado com o motivo informado, em vez de rodar; nenhuma mudança no código de teste, apenas na avaliação da extensão.

### Desativando condições quando necessário

Definir o parâmetro de configuração `junit.jupiter.conditions.deactivate` com um padrão (por exemplo, `*` para todas as condições) contorna extensões `ExecutionCondition` por completo, forçando todo teste a rodar independentemente do que qualquer condição registrada decidiria; útil para uma passada de diagnóstico avulsa do tipo "rodar tudo".

### Extensões são compostas, diferente dos runners do JUnit 4

Como `@ExtendWith` é repetível, uma classe pode combinar múltiplas implementações independentes de extensão, cada uma responsável por uma preocupação diferente (execução condicional, mocking, contexto Spring) sem que uma precise subclassificar ou envolver a outra:

```java
@ExtendWith(ExecutionContextExtension.class)
@ExtendWith(MockitoExtension.class)
class PassengerServiceTest {
    @Mock
    private PassengerRepository repository;
    // both extensions apply independently
}
```

## Trade-offs

- **`Extension` é uma interface marcadora, o contrato de verdade vive em suas subinterfaces**: implementar apenas `Extension` não faz nada; o comportamento vem de qual interface específica (`ExecutionCondition`, `ParameterResolver`, ...) uma classe realmente implementa, então escolher a errada registra silenciosamente uma extensão que nunca dispara.
- **Extensões condicionais podem ser sobrescritas globalmente**: `junit.jupiter.conditions.deactivate=*` desabilita toda `ExecutionCondition` em uma execução, o que é útil para diagnóstico, mas significa que a garantia de "isto não deve rodar neste ambiente" de uma suíte de testes não é absoluta se esse parâmetro de configuração estiver definido:

```
junit.jupiter.conditions.deactivate=*
# every @ExtendWith(ExecutionCondition) now runs its test regardless of the condition
```

- **Múltiplas extensões em uma classe não têm ordenação garantida por padrão**: combinar várias anotações `@ExtendWith` compõe bem para preocupações independentes, mas se duas extensões precisam rodar em uma ordem específica (por exemplo, uma configura estado do qual a outra depende), essa ordem precisa ser declarada explicitamente (`@Order` nas extensões registradas), em vez de assumida pela ordem das anotações.
- **Uma extensão customizada é mais código de antemão do que um `@BeforeEach` inline**: escrever uma classe `Extension` compensa quando a mesma lógica é reutilizada em muitas classes de teste, mas para uma necessidade de setup pontual em uma única classe, um método `@BeforeEach` simples continua sendo mais simples.

## Documentation Links

- [JUnit 5 User Guide: Modelo de Extensão](https://docs.junit.org/current/user-guide/#extensions) (doc)
- [JUnit 5 Jupiter API: `Extension`](https://junit.org/junit5/docs/current/api/org.junit.jupiter.api/org/junit/jupiter/api/extension/Extension.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 14, "JUnit 5 extension model," pp. 263-280 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
