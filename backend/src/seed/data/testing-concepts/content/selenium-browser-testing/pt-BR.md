---
version: 1.0
updatedAt: 2026-08-06
title: "Testes de Navegador com Selenium"
summary: "Controlando um navegador real pela interface WebDriver: busca de elementos, testes parametrizados entre navegadores, e o modelo Page Object, com notas sobre o que mudou do Selenium 3 do livro para o Selenium 4 de hoje, do JUnit in Action, Third Edition, Cap. 15."
---
## Objective

Teste de camada de apresentação conduz a aplicação da forma como um usuário real faria, pelo navegador, em vez de chamar métodos Java diretamente. O livro cobre duas ferramentas: `HtmlUnit`, um navegador headless emulado na mesma JVM dos testes, e `Selenium`, que controla um processo de navegador *real* (Chrome, Firefox, ...) pela interface `WebDriver`. O ponto forte do Selenium é a fidelidade: por automatizar um navegador nativo, o comportamento do teste fica o mais próximo possível da interação real de um usuário, ao custo de ser mais lento que um emulador in-VM.

## Use Cases

- Verificar o título, conteúdo ou navegação de uma página web de ponta a ponta contra um navegador real, não apenas a saída HTML do servidor.
- Testar um fluxo de autenticação (login bem-sucedido e falho) visualmente, seguindo o comportamento real de redirecionamento/mensagem instantânea que um usuário veria.
- Rodar o mesmo teste de UI contra múltiplos navegadores (Chrome, Firefox, Edge) a partir de um único teste parametrizado.
- Estruturar testes de UI com o modelo Page Object, para que o teste se leia como intenção (`openFormAuthentication().loginWith(...)`) e os seletores vivam em um único lugar.
- Escolher entre um emulador headless (HtmlUnit, mais rápido, independente de sistema operacional) e um driver de navegador real (Selenium, fidelidade máxima, comportamento específico do navegador) para uma dada suíte.

## Deep Dive

### O ciclo de vida do WebDriver

`WebDriver` é a interface que todo driver de navegador implementa. Um teste abre uma página com `get(...)`, a consulta, e precisa chamar `quit()` depois para fechar o navegador e liberar o processo, um encaixe natural para `@BeforeEach`/`@AfterEach`:

```java
public class ChromeSeleniumTest {
    private WebDriver driver;

    @BeforeEach
    void setUp() {
        driver = new ChromeDriver();
    }

    @Test
    void testChromeManning() {
        driver.get("https://www.manning.com/");
        assertThat(driver.getTitle(), is("Manning | Home"));
    }

    @AfterEach
    void tearDown() {
        driver.quit(); // closes all browser windows; driver becomes garbage-collectible
    }
}
```

### Encontrando e interagindo com elementos

Localizar um elemento usa `findElement(By...)`, que retorna um `WebElement` que pode ser consultado (`isDisplayed()`) ou acionado (`click()`):

```java
driver.get("https://en.wikipedia.org/");
WebElement contents = driver.findElement(By.linkText("Contents"));
assertTrue(contents.isDisplayed());
contents.click();
assertThat(driver.getTitle(), is("Wikipedia:Contents - Wikipedia"));
```

> **Livro vs. hoje**: o livro de 2020 (Selenium 3) chama `driver.findElementByLinkText("Contents")` e até declara o campo como `RemoteWebDriver` especificamente para alcançar esses métodos de conveniência `findElementBy*`, que a interface base `WebDriver` não expunha. O Selenium 4 **removeu** a família `findElementBy*`; a forma portável sempre foi `findElement(By.linkText(...))`, e é a única forma hoje, então não há mais motivo para ampliar o tipo do campo para `RemoteWebDriver` só para busca de elementos.

### Teste entre navegadores com um teste parametrizado

Alimentar um `@MethodSource` de instâncias de driver em um `@ParameterizedTest` roda o mesmo cenário contra cada navegador sem duplicar o teste:

```java
static Collection<WebDriver> browsers() {
    return List.of(new FirefoxDriver(), new ChromeDriver());
}

@ParameterizedTest
@MethodSource("browsers")
void loginWithValidCredentials(WebDriver webDriver) {
    new Homepage(webDriver)
        .openFormAuthentication()
        .loginWith("tomsmith", "SuperSecretPassword!")
        .thenLoginSuccessful();
}
```

### O modelo Page Object

Em vez de espalhar seletores CSS pelos testes, cada página vira uma classe que expõe métodos nomeados por intenção que retornam a próxima página; o teste se lê como uma jornada do usuário, e uma mudança de seletor toca uma única classe:

```java
public class Homepage {
    private final WebDriver webDriver;

    public Homepage(WebDriver webDriver) { this.webDriver = webDriver; }

    public LoginPage openFormAuthentication() {
        webDriver.get("https://the-internet.herokuapp.com/");
        webDriver.findElement(By.cssSelector("[href=\"/login\"]")).click();
        return new LoginPage(webDriver);
    }
}
```

O livro também faz um ponto de segurança que vale manter: os testes usam uma conta de teste descartável e dedicada (`tomsmith` / `SuperSecretPassword!`), nunca credenciais reais de usuário; colocar credenciais reais em um teste é uma violação de segurança.

### Configuração de driver: antes vs. agora

> **Livro vs. hoje**: o livro (Selenium 3) exige baixar manualmente o binário exato do driver de navegador que corresponde à versão do navegador instalado, e adicionar sua pasta ao `PATH` do sistema operacional, e avisa que o Chrome 79 só funciona com o driver 79. O Selenium 4.6+ traz o **Selenium Manager**, que detecta automaticamente o navegador e baixa/gerencia o driver correspondente, então `new ChromeDriver()` simplesmente funciona sem configuração de `PATH` e sem biblioteca de terceiros `WebDriverManager`. As instruções de download manual do livro estão, na prática, obsoletas.

## Trade-offs

- **Fidelidade de navegador real vs. velocidade**: o Selenium controla um navegador nativo, então o comportamento corresponde ao de usuários reais, mas cada teste inicia um processo de navegador e é mais lento que o HtmlUnit, que emula um navegador de forma headless na mesma JVM:

```java
driver = new ChromeDriver();  // spawns a real Chrome process, realistic, but heavier than an in-VM emulator
```

- **O acoplamento driver/navegador era um custo de manutenção real (hoje em grande parte extinto)**: no fluxo do Selenium 3 do livro, um navegador se atualizando automaticamente além do driver fixado quebrava a suíte até alguém baixar de novo o driver; o Selenium Manager remove esse modo de falha resolvendo o driver automaticamente.
- **O protocolo W3C substituiu o JSON Wire Protocol**: a descrição de arquitetura do Selenium 3 do livro (cliente Selenium, JSON Wire Protocol sobre HTTP, driver de navegador, navegador) é hoje o protocolo W3C WebDriver no Selenium 4, que todo navegador moderno implementa nativamente com menos instabilidade; o modelo mental de quatro componentes (biblioteca cliente, protocolo, driver de navegador, navegador) continua válido.
- **HtmlUnit vs. Selenium é uma decisão de fidelidade/independência**: use HtmlUnit quando a aplicação for independente de comportamento específico de sistema operacional/navegador e você quiser velocidade e um ambiente headless; use Selenium quando precisar de validação contra sistemas operacionais/navegadores reais específicos, ou a aplicação depender de uma implementação específica de navegador. O HtmlUnit é pouco familiar para times padronizados em ferramentas de navegador real (Selenium/Playwright/Cypress), o que é um motivo para ser menos comum hoje.

## Documentation Links

- [Selenium WebDriver: documentação oficial](https://www.selenium.dev/documentation/webdriver/) (doc)
- [Selenium Manager: gerenciamento automático de driver](https://www.selenium.dev/documentation/selenium_manager/) (doc)
- [Os modelos Page Object: documentação do Selenium](https://www.selenium.dev/documentation/test_practices/encouraged/page_object_models/) (doc)
- [JUnit in Action, 3rd Ed., Cap. 15.4-15.6, "Presentation-layer testing" (Selenium), pp. 294-309 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
