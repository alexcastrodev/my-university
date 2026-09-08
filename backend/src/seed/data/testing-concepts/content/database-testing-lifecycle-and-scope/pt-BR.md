---
version: 1.0
updatedAt: 2026-08-17
title: "Ciclo de Vida dos Dados de Teste e o que Testar na Camada de Banco de Dados"
summary: "Por que limpar os dados de teste no início compensa mais do que no fim, por que bancos em memória ainda não pertencem a testes de integração apesar de o Testcontainers mudar o trade-off do overhead de containers, e por que leituras e repositórios merecem uma régua de qualidade mais baixa do que escritas."
---
## Objective

Além de acertar as transações (veja o conceito irmão `database-testing-prerequisites-and-transactions`), uma suíte de testes de integração de banco de dados precisa de uma política para mais três coisas: como impedir que os testes interfiram nos dados uns dos outros, como manter as seções de arrange/act/assert de cada teste curtas sem reintroduzir o acoplamento entre testes, e (uma decisão genuinamente opinativa e ainda debatida) quais partes da camada de dados realmente valem a pena testar.

## Use Cases

- Escolher como limpar os dados de teste remanescentes entre execuções, e reconhecer por que "limpar no final" é o padrão errado mesmo parecendo mais natural.
- Decidir se um banco de dados em memória (H2, SQLite) é um substituto aceitável para o motor de banco de dados de produção em testes de integração.
- Encurtar as seções de arrange/act/assert de um teste de integração inchado sem reintroduzir o acoplamento entre testes que o anti-padrão de fixture baseado em construtor causa (veja `reusing-test-fixtures-and-parameterized-tests`).
- Decidir se uma classe de repositório precisa de um teste próprio e dedicado, separado dos testes de integração que já a exercitam indiretamente.

## Deep Dive

### Rode os testes de integração sequencialmente, e limpe no início, não no fim

Paralelizar testes de integração contra um banco de dados compartilhado é possível, mas raramente vale o custo: exige dados de teste globalmente únicos (para que testes concorrentes não colidam em restrições ou acidentalmente leiam as linhas uns dos outros) e complica bastante a limpeza. É mais prático rodar os testes de integração sequencialmente em seu próprio grupo/tag de teste (o `@Tag` do JUnit 5, combinado com uma configuração de Maven/Gradle que desabilita execução paralela para essa tag, é o equivalente direto da "coleção de testes" separada em xUnit que o livro usa), separados dos testes unitários, que podem continuar paralelos.

Quatro formas de remover dados remanescentes entre execuções, em ordem:

1. **Restaurar um backup do banco antes de cada teste**: a corretude é trivial, mas de longe a opção mais lenta; o custo se acumula rápido em uma suíte inteira.
2. **Limpar ao final do teste**: rápido, mas pulável: um build que trava, uma sessão de debugger interrompida no meio do teste ou qualquer saída não graciosa deixa os dados para trás, contaminando a próxima execução.
3. **Envolver o teste inteiro em uma única transação não commitada**: resolve o problema da limpeza pulada, mas reintroduz exatamente o descompasso de "uma única transação compartilhada entre seções" contra o qual o conceito irmão alerta; a produção não roda dentro de uma transação ambiente que sempre sofre rollback, então isso pode esconder a mesma classe de bug.
4. **Limpar no início do teste, a opção recomendada por padrão.** Rápida, imune a ser pulada por uma falha (sempre roda como parte do setup do *próximo* teste, independentemente de como o anterior terminou) e não distorce o comportamento transacional sob teste. Coloque o script de exclusão em uma classe base compartilhada para que rode automaticamente antes de cada teste de integração, e apague as linhas em uma ordem que respeite as restrições de chave estrangeira: escreva o SQL à mão em vez de recorrer a um algoritmo genérico de exclusão que resolve dependências; é mais simples de ler e dá mais controle. O script de exclusão deve remover apenas dados regulares, nunca dados de referência, que permanecem sob controle exclusivo das migrações. Isso também elimina a necessidade de uma fase de teardown separada: a limpeza vira parte do próprio passo de arrange do *próximo* teste.

### Evite bancos de dados em memória, e saiba como o Testcontainers muda essa conta

O livro argumenta contra trocar o banco de dados real nos testes por SQLite (ou outro motor em memória): é mais rápido e não precisa de limpeza, mas um vendor diferente significa peculiaridades diferentes de dialeto SQL, imposição de restrições diferente, comportamento diferente nas bordas, exatamente onde os testes de integração deveriam pegar bugs reais. Uma suíte que passa contra SQLite mas falharia contra o Postgres de produção é um falso negativo esperando para surgir depois do deploy. **Esta parte do conselho não mudou**: continue usando o mesmo vendor de banco de dados em testes e em produção (a versão/edição pode diferir, o vendor não deveria).

> **Livro vs. hoje**: o livro (2020) é cético quanto a rodar testes contra um banco de dados real dentro de um container, citando o ônus operacional (gerenciar imagens, provisionar um container por teste, batching, teardown) e chega à conclusão de "simplesmente dar a cada desenvolvedor sua própria instância local persistente". **O Testcontainers desde então se tornou a resposta padrão, amplamente adotada, para exatamente esse trade-off**: ele sobe o motor de banco de dados real (o vendor de fato, não um substituto em memória) em Docker por classe ou suíte de teste, e os frameworks de teste do ecossistema JVM (o `@Testcontainers`/`@Container` do JUnit 5) hoje cuidam do gerenciamento de ciclo de vida que preocupava o livro. O princípio subjacente do livro (não substitua o motor de banco de dados por velocidade) permanece inalterado e é, na verdade, a razão de existir do Testcontainers; apenas a conclusão específica de "containers são ônus operacional demais" está datada.

### Encurtando arrange, act e assert sem reacoplar os testes

Extraia o boilerplate técnico (não relacionado ao negócio) de cada seção em métodos privados na classe de teste, espelhando o padrão Object Mother do conceito irmão sobre reutilização de fixtures, aplicado às três seções AAA em vez de só ao arrange:

```java
// Arrange: fábrica no estilo Object Mother:
User user = createUser("user@mycorp.com", UserType.EMPLOYEE);
createCompany("mycorp.com", 1);

// Act: um método decorador que é dono de abrir/fechar o EntityManager:
String result = execute(controller -> controller.changeEmail(user.getId(), "new@gmail.com"));

// Assert: uma interface fluente sobre a entidade consultada:
User userFromDb = queryUser(user.getId());
assertThat(userFromDb).hasEmail("new@gmail.com").hasType(UserType.CUSTOMER);
```

A interface fluente da seção de assert é um pequeno builder feito à mão (ou uma subclasse `Assert` customizada do AssertJ) envolvendo o objeto de domínio, a mesma motivação de "ler como uma frase" do ponto `assertThat(...).isEqualTo(...)` do conceito irmão, só que estendida a uma asserção customizada com múltiplos campos. Isso significa que o teste já bastante encurtado agora abre mais sessões separadas de banco de dados do que o original (uma por chamada de método de fábrica, mais uma para o act, mais uma para o assert); aceite isso como uma troca deliberada entre velocidade de execução dos testes e manutenibilidade; é um banco pequeno e local na máquina do desenvolvedor, e o ganho de manutenibilidade vale mais que os milissegundos. Coloque os métodos de fábrica na própria classe de teste por padrão; só os promova para uma classe auxiliar compartilhada quando uma duplicação real entre classes de teste justificar, e nunca os coloque na classe base compartilhada reservada para a lógica de limpeza que precisa rodar em todo teste.

### O que realmente vale a pena testar na camada de banco de dados

**Leituras precisam de um padrão muito mais alto do que escritas.** Uma escrita ruim pode corromper dados com efeitos em cascata por todo o sistema (e por outros sistemas, se o dado corrompido chegar a sair da fronteira); uma leitura ruim costuma ser apenas uma saída errada, detectada e corrigida com um dano colateral muito menor. Teste apenas as leituras mais complexas ou importantes e pule o resto, e pule também construir um modelo de domínio para leituras, já que um modelo de domínio existe para preservar invariantes em *escritas*; uma leitura sem encapsulamento a proteger não ganha benefício nenhum com um. Prefira SQL puro em vez de um ORM especificamente para leituras: é mais rápido (sem camada de mapeamento desnecessária) e não há benefício de encapsulamento sendo sacrificado.

**Não teste repositórios diretamente.** É tentador (mapear objetos de domínio de e para o banco de dados é exatamente o tipo de lugar onde um erro se esconde), mas um repositório se encaixa no quadrante "controller" do mapa de complexidade de código (fala com uma dependência fora de processo, tem pouca lógica própria; veja o conceito irmão `testing-by-code-type`), então um teste dedicado de repositório carrega todo o custo de manutenção de um teste de integração enquanto majoritariamente reprova algo que a suíte mais ampla de testes de integração já cobre. Extraia qualquer complexidade real de mapeamento que um repositório tenha para uma classe separada e pura de fábrica/mapper, e teste unitariamente *essa classe* isoladamente (foi o que o `UserFactory`/`CompanyFactory` do exemplo original de CRM fez); note, porém, que essa separação nem sempre é possível com um ORM completo, já que a lógica de mapeamento do JPA/Hibernate está atrelada ao próprio contexto de persistência. Onde não for possível, aceite a cobertura de repositório como efeito colateral dos testes de integração mais amplos, em vez de escrever testes de repositório de propósito.

## Trade-offs

- **Limpar no início em vez de no fim parece invertido na primeira vez que se vê**: o ganho (imunidade a uma execução anterior travada ou interrompida por um debugger) só fica visível depois que a versão "limpar no final" já tiver prejudicado alguém com dados contaminados de uma execução falha.
- **O Testcontainers remove a objeção *operacional* que o livro declarava contra containers por teste, mas não remove o custo em tempo de execução**: um boot completo de container por classe de teste ainda é mais lento do que uma instância local compartilhada e persistente; o trade-off muda de "isso vale o ônus operacional" (em grande parte resolvido) para "isso vale os segundos extras por execução de teste" (ainda uma decisão real, específica do projeto).
- **Extrair a lógica de mapeamento de um repositório para uma classe de fábrica independente é elegante, mas genuinamente impossível com um ORM completo**: o mapeamento de entidades do Hibernate/JPA está inerentemente acoplado ao contexto de persistência, então "testar o mapeamento isoladamente" é uma diretriz a aplicar onde a arquitetura permite, não uma regra para forçar em toda parte.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 10 "Testing the database", Seções 10.3-10.5, pp. 243-254 (book)
- [Testcontainers for Java](https://java.testcontainers.org/) (doc)
- [JUnit 5 User Guide: Parallel Execution](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parallel-execution) (doc)
