---
version: 1.0
updatedAt: 2026-08-06
title: "Princípios de Teste de Software"
summary: "Teste unitário vs. integração vs. sistema vs. aceitação, e caixa-preta vs. caixa-branca: o vocabulário por trás de como uma suíte de testes é organizada, do JUnit in Action, Third Edition, Cap. 5."
---
## Objective

Além de "o JUnit roda este teste", o livro estabelece o vocabulário que os times usam para falar sobre escopo e técnica de teste: **unitário**, **integração**, **sistema** e **aceitação** diferem em quanto da aplicação exercitam, enquanto **caixa-preta** e **caixa-branca** diferem em se o teste depende de conhecimento de implementação. Nenhum dos dois eixos é específico do JUnit, mas ambos moldam como uma suíte de testes JUnit deveria ser organizada.

## Use Cases

- Decidir se um cenário de falha pertence a um teste unitário (uma classe, colaboradores substituídos), um teste de integração (vários objetos reais, colaborando) ou um teste de sistema (a aplicação integrada inteira).
- Escrever testes de aceitação como cenários Given/When/Then que uma parte interessada não desenvolvedora consegue ler e confirmar que correspondem ao requisito de negócio.
- Escolher ferramentas caixa-preta (Selenium, um cliente HTTP acessando um endpoint) quando só a especificação funcional está disponível e a implementação ainda não está pronta.
- Escolher testes caixa-branca ao cobrir caminhos de execução específicos (um branch específico, uma exceção específica) que só alguém que conhece a implementação pensaria em alvejar.
- Explicar a um time por que "100% de cobertura de teste unitário" não prova, por si só, que o sistema funciona de ponta a ponta; para isso servem os testes de integração/sistema/aceitação.

## Deep Dive

### Testes unitário, de integração, de sistema e de aceitação

O livro delimita o escopo de cada tipo de teste por quanto do sistema real participa:

```java
// Unit test: one class, one collaborator replaced by a double
@Test
void transferMovesBalanceBetweenAccounts() {
    AccountService service = new AccountService();
    service.setAccountManager(mockAccountManager); // double, not the real thing
    service.transfer("1", "2", 50);
    assertEquals(150, sender.getBalance());
}
```

```java
// Integration test: real, collaborating objects, no doubles
@Test
void customerIsAssignedToOfferOnce() {
    Customer customer = new Customer("1");
    Offer offer = new Offer("economy");
    offer.addCustomer(customer);           // real Offer, real Customer
    assertTrue(customer.getOffers().contains(offer));
}
```

O teste de **sistema** roda a aplicação completa e integrada para checar se ela atende seus requisitos especificados como um todo, mais próximo de ponta a ponta do que de uma única classe. O teste de **aceitação** é o mais amplo: verifica se a aplicação faz a coisa certa do ponto de vista do negócio, frequentemente expresso com `Given`/`When`/`Then`:

```
Given that there is an economy offer,
When we have a regular customer,
Then we can add them to and remove them from the offer.

Given that there is an economy offer,
When we have a VIP customer,
Then we can add them to the offer but not remove them from it.
```

### Teste caixa-preta

Um teste caixa-preta não tem conhecimento dos internos do sistema; trata o sistema como uma caixa fechada com um contrato conhecido de entrada/saída, verificado puramente pela interface externa. Só precisa da especificação funcional, que tipicamente existe cedo em um projeto, então testes caixa-preta podem começar antes de os detalhes de implementação estarem fechados. Ferramentas como o Selenium controlam uma UI web exatamente como um usuário faria, sem saber o que está por trás:

```java
@Test
void loginFormAcceptsValidCredentials() {
    driver.get("https://app.example.com/login");
    driver.findElement(By.id("username")).sendKeys("alice");
    driver.findElement(By.id("password")).sendKeys("secret");
    driver.findElement(By.id("submit")).click();
    assertEquals("Welcome, alice", driver.findElement(By.id("greeting")).getText());
}
```

### Teste caixa-branca

O teste caixa-branca (ou glass-box) usa conhecimento da implementação para alvejar caminhos de execução específicos, então o mesmo cenário Given/When/Then acima vira um teste escrito contra a API real, por alguém que sabe que `Customer`/`Offer` cooperam através de `addCustomer`/`removeCustomer`:

```java
@Test
void vipCustomerCannotBeRemovedFromOffer() {
    Offer offer = new Offer("economy");
    Customer vip = new Customer("2", CustomerType.VIP);
    offer.addCustomer(vip);
    assertThrows(UnsupportedOperationException.class, () -> offer.removeCustomer(vip));
}
```

Testes caixa-branca podem ser escritos mais cedo do que os testes de UI caixa-preta (nenhuma UI necessária) e conseguem cobrir muito mais caminhos de execução, mas exigem o conhecimento de quem implementou a API para sequer serem escritos.

## Trade-offs

- **Escopo mais amplo significa testes mais lentos e mais instáveis**: um teste unitário com doubles roda em milissegundos e falha por um único motivo; um teste de sistema ou aceitação exercita infraestrutura real e pode falhar por razões sem relação com a funcionalidade sendo testada (soluço de rede, dados de teste compartilhados).
- **Testes caixa-preta precisam de uma UI suficientemente pronta, testes caixa-branca não**: um teste Selenium caixa-preta não pode rodar até existir uma página para controlar, enquanto um teste caixa-branca contra a camada de serviço pode começar assim que a API existir, independente da UI.
- **A cobertura caixa-branca exige conhecimento de implementação que envelhece**: um teste caixa-branca escrito contra a estrutura interna de API de hoje pode quebrar em uma refatoração que não muda comportamento nenhum visível externamente, algo que um teste caixa-preta do mesmo cenário não faria.
- **Testes de aceitação se leem como documentação, mas não são de graça**: cenários Given/When/Then comunicam bem a intenção a não desenvolvedores, mas ainda precisam de implementações reais de passo, ligadas ao sistema de fato, para serem mais do que prosa.

## Documentation Links

- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) (doc)
- [Selenium: site oficial](https://www.selenium.dev) (doc)
- [JUnit in Action, 3rd Ed., Cap. 5, "Software testing principles," pp. 87-98 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
