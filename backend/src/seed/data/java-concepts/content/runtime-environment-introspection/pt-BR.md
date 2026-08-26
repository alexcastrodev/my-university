---
version: 1.0
updatedAt: 2026-08-19
title: Introspecção do Ambiente de Execução: System Properties, Variáveis de Ambiente e Runtime
summary: System.getenv() (ambiente do SO, herdado por processos filhos), System.getProperty() (escopo da JVM, definido via -D) e Runtime (fatos ao vivo como availableProcessors() e Runtime.version()) são três canais distintos para perguntar a uma JVM em que ela está rodando e como foi configurada.
---
## Objective

Uma JVM em execução consegue responder "no que estou rodando, e como fui configurada?" através de três canais genuinamente diferentes: **variáveis de ambiente** (`System.getenv`) — definidas pelo shell do SO, herdadas por todo processo filho; **system properties** (`System.getProperty`) — pares chave/valor com escopo de JVM, definidos com `-D`, visíveis apenas para essa JVM a menos que sejam explicitamente encaminhados; e a **classe `Runtime`** — fatos ao vivo sobre essa instância específica da JVM (processadores disponíveis, uso de heap, a versão exata da plataforma). Confundir esses três canais, ou recorrer a parsing de string quando já existe uma API estruturada, é o erro recorrente que este conceito existe para evitar.

## Use Cases

- Ler configuração no estilo twelve-factor (`DATABASE_URL`, `PORT`) a partir do ambiente em um serviço containerizado, em vez de uma flag `-D` específica da JVM que um orquestrador de containers precisaria saber definir.
- Dimensionar um thread pool ou um work-stealing pool pelo número de CPUs realmente disponíveis para o processo — que, em um container, não é necessariamente a contagem de núcleos físicos da máquina host.
- Detectar na inicialização se uma dependência opcional ou recurso de plataforma está presente, e falhar com uma mensagem clara em vez de um confuso `NoClassDefFoundError` no meio de código não relacionado.
- Escrever uma manipulação de caminho ou de fim de linha que se comporte corretamente tanto em Unix quanto em Windows sem fixar `/` ou `\n` no código.
- Diagnosticar um problema de memória lendo os números de heap ao vivo do `Runtime`, ou comparando `Runtime.version()` contra uma build de JDK conhecida como boa ou ruim durante um incidente.

## Deep Dive

### Variáveis de ambiente vs. system properties: não é o mesmo canal

```java
String path = System.getenv("PATH");                 // from the OS environment
Map<String, String> allEnv = System.getenv();         // immutable snapshot, whole environment

String version = System.getProperty("java.version");  // from the JVM's own Properties object
System.getProperties().forEach((k, v) -> System.out.println(k + "=" + v));
```

```
$ java -Dpencil.color="Deep Sea Green" -cp . App
```

A distinção que realmente importa: **variáveis de ambiente são herdadas por todo processo filho** que a JVM lança (via `ProcessBuilder`, `Runtime.exec`, ou um script shell que inicia a própria JVM), enquanto uma **system property `-D` é visível apenas dentro dessa JVM** — ela não é automaticamente encaminhada para um subprocesso. Um valor de configuração que um subprocesso precisa tem que ser uma variável de ambiente, ou ser explicitamente copiado para o ambiente/argumentos do próprio subprocesso via `ProcessBuilder.environment()` ou um argumento de linha de comando.

`System.getenv()` é sensível a maiúsculas/minúsculas em algumas plataformas e insensível em outras (Windows) — código que lê um nome de variável específico não deve assumir que qualquer um dos dois comportamentos vale em todas as plataformas. Properties cujo nome começa com `sun.` (`sun.boot.library.path`, `sun.arch.data.model`) são internas, não documentadas, e já desapareceram ou mudaram entre releases sem aviso — trate-as como curiosidades de debug, nunca como algo do qual código de produção depende.

### Detectando a plataforma e seus recursos

```java
String spec = System.getProperty("java.specification.version");   // "25"
String os   = System.getProperty("os.name");                       // "Linux", "Mac OS X", "Windows 11"
```

Para qualquer coisa além de exibição, `Runtime.version()` (JDK 9+, JEP 223) é a API que vale a pena usar em vez de fazer parsing manual da string `java.version`:

```java
Runtime.Version v = Runtime.version();
v.feature();     // 25 — the feature release number (what most people mean by "Java 25")
v.interim();     // 0
v.update();      // 1  (for "25.0.1")

if (Runtime.version().feature() >= 21) {
    // safe to use a feature that requires JDK 21+
}
```

`Runtime.Version` implementa `Comparable<Runtime.Version>`, então comparações de versão são uma chamada de método, não uma regex sobre uma string que mudou de forma entre releases do JDK (`"1.8.0_202"` vs. `"17.0.1"` vs. `"25"`).

Para "essa classe/biblioteca opcional está de fato no classpath", uma sondagem grosseira mas eficaz é:

```java
try {
    Class.forName("javax.swing.JButton");
} catch (ClassNotFoundException e) {
    System.err.println("This build needs a JRE with Swing available.");
}
```

Isso só diz que a classe é carregável, não que um método ou campo específico existe nela — para essa verificação mais fina, ou para uma resposta real de "essa dependência está presente" em nível de módulo, em vez de uma sondagem ad hoc, veja os conceitos `classpath-scanning-via-reflection` e `java-platform-module-system`.

### Constantes dependentes de plataforma, tornadas independentes de plataforma

```java
File.separator;         // "/" on Unix/macOS, "\" on Windows
File.separatorChar;
File.pathSeparator;     // ":" on Unix/macOS, ";" on Windows — the PATH-list delimiter
System.lineSeparator();  // "\n", "\r\n", ...
```

O próprio código de manipulação de arquivos do Java aceita tanto `/` quanto `\` no Windows, então barras normais fixas no código costumam funcionar por acidente — mas código que *constrói* um caminho para exibição, ou que o escreve em um arquivo que outro programa vai analisar de forma estrita, deve usar essas constantes (ou melhor ainda, `java.nio.file.Path`, que nunca precisa que um caractere separador seja escrito por extenso) em vez de assumir que o acidente se sustenta em todo lugar.

### `Runtime`: fatos ao vivo sobre essa JVM

```java
Runtime rt = Runtime.getRuntime();

rt.availableProcessors();   // CPUs visible to this process — container-aware since JDK 10
rt.totalMemory();           // bytes currently allocated to the JVM's heap
rt.freeMemory();            // bytes free within that allocated heap
rt.maxMemory();              // bytes the heap is allowed to grow to (-Xmx)
```

`availableProcessors()` é o número contra o qual dimensionar um thread pool, não a contagem de núcleos físicos da máquina host — desde o JDK 10 (JDK-8146115), a JVM lê a cota de CPU do cgroup do container quando rodando sob Docker/Kubernetes com um limite de CPU definido, então um pod limitado a 2 CPUs reporta `2` aqui mesmo em um nó host de 64 núcleos. Dimensionar `ForkJoinPool`/`ExecutorService` com base nesse número, em vez de uma constante fixa, é o que faz a mesma imagem de container se autodimensionar corretamente não importa onde seja agendada.

`rt.exec(...)` e `Runtime.addShutdownHook(...)` também existem aqui, mas `ProcessBuilder` é a forma moderna e mais controlável de lançar um processo (coberta em `java-lang-essential-utility-types`), e a mecânica e a ordem dos shutdown hooks são cobertas em profundidade em `executor-shutdown-and-jvm-exit` — ambos são referenciados em vez de reexplicados aqui.

## Trade-offs

- **Properties `sun.*` são um detalhe de implementação, não uma API** — elas já apareceram, mudaram de forma e desapareceram entre releases sem um ciclo de depreciação, porque nunca foram um contrato suportado para começo de conversa. Ler `os.name`/`java.specification.version`/`file.separator` é seguro; ler qualquer coisa sob `sun.` em código de produção é um bug de portabilidade latente.
- **Variáveis de ambiente e system properties resolvem problemas de propagação diferentes.** Recorrer a uma flag `-D` quando a necessidade real é "esse subprocesso também precisa ver esse valor" produz código que funciona na linha de comando e quebra silenciosamente no momento em que essa lógica roda dentro de um subprocesso lançado por `ProcessBuilder` — verifique qual dos dois um valor realmente precisa alcançar antes de escolher um.
- **A consciência de container de `availableProcessors()` é um comportamento dependente da versão da JVM, não algo que o próprio número declara.** Código que dimensiona um pool com base nesse valor em um JDK antigo (pré-10), ou sem limites de cgroup definidos, recebe a contagem bruta de CPU do host — o número só é tão significativo quanto a plataforma que o reporta.
- **A sondagem com `Class.forName` só diz que uma classe carregou, nada mais.** Uma classe que carrega mas não tem um método que seu código chama em seguida ainda falha, só que mais tarde e com um `NoSuchMethodError` menos óbvio — é uma verificação grosseira de presença, não uma verificação real de capacidade, e uma fronteira de módulo real (`requires`/`uses`/`provides`, veja `java-platform-module-system`) é a ferramenta mais precisa quando você controla o empacotamento da dependência.
- **`totalMemory()`/`freeMemory()` descrevem a região do heap atualmente alocada, não o teto real de memória da JVM** — `totalMemory()` pode estar bem abaixo de `maxMemory()` se o heap ainda não cresceu, então uma razão ingênua `freeMemory()/maxMemory()` pode parecer "quase cheia" logo após a inicialização mesmo que o heap tenha bastante espaço ainda para crescer.

## Documentation Links

- [System — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html) — doc
- [Runtime — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runtime.html) — doc
- [Runtime.Version — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runtime.Version.html) — doc
- [JEP 223: New Version-String Scheme](https://openjdk.org/jeps/223) — doc
- [File — Java SE 25 API (separator, pathSeparator fields)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/File.html) — doc
- [JDK-8146115: Docker container CPU/memory awareness](https://bugs.openjdk.org/browse/JDK-8146115) — doc
