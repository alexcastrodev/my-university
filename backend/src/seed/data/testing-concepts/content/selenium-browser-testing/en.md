---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Presentation-layer testing drives the application the way a real user would — through the browser — instead of calling Java methods directly. The book covers two tools: `HtmlUnit`, a headless browser emulated in the same JVM as the tests, and `Selenium`, which drives a *real* browser process (Chrome, Firefox, …) through the `WebDriver` interface. Selenium's strength is fidelity: because it automates a native browser, test behavior is as close as possible to real user interaction, at the cost of being slower than an in-VM emulator.

## Use Cases

- Verifying a web page's title, content, or navigation end-to-end against a real browser, not just the server's HTML output.
- Testing an authentication flow (successful and failed login) visually, following the real redirect/flash-message behavior a user would see.
- Running the same UI test against multiple browsers (Chrome, Firefox, Edge) from one parameterized test.
- Structuring UI tests with the Page Object model, so the test reads as intent (`openFormAuthentication().loginWith(...)`) and selectors live in one place.
- Choosing between a headless emulator (HtmlUnit — faster, OS-independent) and a real-browser driver (Selenium — highest fidelity, browser-specific behavior) for a given suite.

## Deep Dive

### The WebDriver lifecycle

`WebDriver` is the interface every browser driver implements. A test opens a page with `get(...)`, queries it, and must call `quit()` afterward to close the browser and free the process — a natural fit for `@BeforeEach`/`@AfterEach`:

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

### Finding and interacting with elements

Locating an element uses `findElement(By...)`, which returns a `WebElement` you can query (`isDisplayed()`) or act on (`click()`):

```java
driver.get("https://en.wikipedia.org/");
WebElement contents = driver.findElement(By.linkText("Contents"));
assertTrue(contents.isDisplayed());
contents.click();
assertThat(driver.getTitle(), is("Wikipedia:Contents - Wikipedia"));
```

> **Book vs. today:** the 2020 book (Selenium 3) calls `driver.findElementByLinkText("Contents")` and even declares the field as `RemoteWebDriver` specifically to reach those `findElementBy*` convenience methods, which the base `WebDriver` interface didn't expose. Selenium 4 **removed** the `findElementBy*` family — the portable form was always `findElement(By.linkText(...))`, and that's the only form today, so there's no longer a reason to widen the field type to `RemoteWebDriver` just for element lookup.

### Cross-browser testing with a parameterized test

Feeding a `@MethodSource` of driver instances into a `@ParameterizedTest` runs the same scenario against each browser without duplicating the test:

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

### The Page Object model

Rather than scatter CSS selectors across tests, each page becomes a class exposing intent-named methods that return the next page — the test reads as a user journey, and a selector change touches one class:

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

The book also makes a security point worth keeping: tests use a dedicated throwaway test account (`tomsmith` / `SuperSecretPassword!`), never real user credentials — putting real credentials in a test is a security breach.

### Driver setup: then vs. now

> **Book vs. today:** the book (Selenium 3) requires manually downloading the exact browser driver binary matching your installed browser version and adding its folder to the OS `PATH` — and warns that Chrome 79 only works with driver 79. Selenium 4.6+ ships **Selenium Manager**, which auto-detects the browser and downloads/manages the matching driver, so `new ChromeDriver()` just works with no `PATH` setup and no third-party `WebDriverManager` library. The manual-download instructions in the book are effectively obsolete.

## Trade-offs

- **Real browser fidelity vs. speed** — Selenium drives a native browser, so behavior matches real users, but every test launches a browser process and is slower than HtmlUnit, which emulates a browser headlessly in the same JVM:

```java
driver = new ChromeDriver();  // spawns a real Chrome process — realistic, but heavier than an in-VM emulator
```

- **Driver/browser version coupling was a real maintenance cost (now mostly gone)** — under the book's Selenium 3 workflow, a browser auto-updating past its pinned driver broke the suite until someone re-downloaded the driver; Selenium Manager removes that failure mode by resolving the driver automatically.
- **W3C protocol replaced the JSON Wire Protocol** — the book's Selenium 3 architecture description (Selenium client → JSON Wire Protocol over HTTP → browser driver) is now the W3C WebDriver protocol in Selenium 4, which every modern browser implements natively for less flakiness; the four-component mental model (client library, protocol, browser driver, browser) still holds.
- **HtmlUnit vs. Selenium is a fidelity/independence call** — use HtmlUnit when the app is independent of OS/browser-specific behavior and you want speed and a headless environment; use Selenium when you need validation against specific real browsers/OSs or the app depends on a browser-specific implementation. HtmlUnit is unfamiliar to teams standardized on real-browser tooling (Selenium/Playwright/Cypress), which is a reason it's less common today.

## Documentation Links

- [Selenium WebDriver — official documentation](https://www.selenium.dev/documentation/webdriver/) — doc
- [Selenium Manager — automatic driver management](https://www.selenium.dev/documentation/selenium_manager/) — doc
- [The Page Object Models — Selenium docs](https://www.selenium.dev/documentation/test_practices/encouraged/page_object_models/) — doc
- [JUnit in Action, 3rd Ed. — Ch. 15.4–15.6, "Presentation-layer testing" (Selenium), pp. 294–309 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
