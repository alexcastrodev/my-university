---
version: 1.0
updatedAt: 2026-08-19
title: Compilação Nativa com GraalVM Native Image
summary: O GraalVM reúne um JIT (o compilador Graal) mais o native-image, um compilador ahead-of-time que transforma uma aplicação Java em um executável nativo autocontido — trocando uma premissa de mundo fechado sobre reflection, proxies e recursos por startup quase instantâneo e uma pegada muito menor.
---
## Objective

GraalVM é duas coisas diferentes usando um único nome: uma **distribuição de JDK** cujo compilador just-in-time é o compilador Graal em vez do C2 da HotSpot, e o **`native-image`**, um compilador ahead-of-time (AOT) que transforma uma aplicação Java em um único executável nativo autocontido, sem JVM para iniciar. É o segundo que faz a maioria das equipes instalar o GraalVM. O `native-image` compra startup quase instantâneo e uma pegada de memória muito menor fazendo o trabalho em tempo de build — mas só consegue fazer isso assumindo um **mundo fechado**: toda classe, método, recurso e proxy que o programa algum dia vai tocar precisa ser conhecido quando o binário é construído, então reflection, proxies dinâmicos, JNI e carregamento de recursos precisam de metadados explícitos ou falham em runtime.

## Use Cases

- Funções serverless / FaaS (AWS Lambda, Cloud Run, Azure Functions) onde a latência de cold-start é cobrada e visível ao usuário, e um boot de JVM de 2 segundos é inaceitável.
- Serviços Kubernetes que escalam a zero ou escalam rápido: um pod nativo fica pronto em milissegundos e ocupa uma fração do RSS, então cabem mais réplicas por nó.
- Ferramentas de linha de comando escritas em Java que precisam parecer um comando de shell — sem `java -jar`, sem warm-up, sem exigir que o usuário instale um JRE.
- Imagens de container pequenas: um binário nativo com link estático em uma base distroless ou `scratch` remove dezenas de megabytes de JDK da imagem.
- Builds nativos com suporte de framework que tornam isso prático em aplicações reais: o processamento AOT do Spring Boot, o Quarkus (projetado native-image-first), Micronaut, Helidon SE.
- Jobs em lote de curta duração e sidecars, onde o JIT nunca roda tempo suficiente para atingir o pico de performance de qualquer forma, então abrir mão dele não custa nada.
- Embedding poliglota (GraalJS, GraalPy, linguagens Truffle) — um uso secundário, e a direção que a Oracle disse que é o futuro do GraalVM independente de Java.

## Deep Dive

### GraalVM é um JDK, e o `native-image` vem embutido nele

Uma instalação do GraalVM se comporta como qualquer outro JDK — `java`, `javac`, `jar`, `jshell` funcionam todos:

```
$ sdk install java 25.0.2-graal          # or download from graalvm.org/downloads
$ java -version
java version "25.0.2" 2026-01-20
Java(TM) SE Runtime Environment Oracle GraalVM 25.0.2+9.1 (build 25.0.2+9-LTS-jvmci-b01)
Java HotSpot(TM) 64-Bit Server VM Oracle GraalVM 25.0.2+9.1 (build 25.0.2+9-LTS-jvmci-b01, mixed mode, sharing)
```

Dois detalhes que tutoriais mais antigos erram:

```
$ gu install native-image
zsh: command not found: gu
$ native-image --version           # already there, nothing to install
```

O passo do `gu` (GraalVM Updater) desapareceu a partir do GraalVM para JDK 21 — `native-image` e os runtimes de linguagem já vêm empacotados no download. A distribuição também se dividiu em duas: **Oracle GraalVM**, sob o GraalVM Free Terms and Conditions (grátis para produção e redistribuição, embora atualizações de CPU para versões mais antigas tenham migrado para a licença OTN), e **GraalVM Community Edition**, sob GPLv2 com Classpath Exception no GitHub. **Mandrel** da Red Hat e **Liberica NIK** da BellSoft são builds downstream baseados na CE; o Quarkus usa o Mandrel por padrão.

O `native-image` precisa de uma toolchain C local, porque ele efetivamente linka um executável de verdade:

```
# Linux (Debian/Ubuntu)
$ sudo apt-get install build-essential zlib1g-dev
# macOS
$ xcode-select --install
# Windows
$ winget install --id Microsoft.VisualStudio.2022.BuildTools
```

### Do `javac` a um executável nativo

```java
// Hello.java
import java.time.LocalDate;

public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello on " + LocalDate.now());
    }
}
```

```
$ javac Hello.java
$ native-image Hello -o hello
========================================================================
GraalVM Native Image: Generating 'hello' (executable)...
========================================================================
[1/8] Initializing...                                    (2.8s @ 0.15GB)
[2/8] Performing analysis...                             (5.1s @ 0.55GB)
[3/8] Building universe...                               (0.6s @ 0.60GB)
[4/8] Parsing methods...                                 (0.5s @ 0.63GB)
[5/8] Inlining methods...                                (0.4s @ 0.58GB)
[6/8] Compiling methods...                               (8.2s @ 0.72GB)
[7/8] Laying out methods...                              (0.6s @ 0.70GB)
[8/8] Creating image...                                  (0.9s @ 0.66GB)
Finished generating 'hello' in 21.3s.
```

O build é lento e verboso; `--silent` reduz a saída. O retorno vem em runtime:

```
$ time java Hello
Hello on 2026-08-19
real    0m0.28s

$ time ./hello
Hello on 2026-08-19
real    0m0.006s
```

Aproximadamente duas ordens de grandeza no startup para um programa trivial, porque não há bootstrap de JVM, nem carregamento e verificação de classes, nem warm-up de interpretador — o binário contém só as classes de aplicação alcançáveis, as classes do JDK alcançáveis, e um runtime pequeno chamado Substrate VM (GC, escalonamento de threads etc.). Para um JAR ou um módulo, aponte para eles em vez disso:

```
$ native-image -jar app.jar -o app
$ native-image --module com.example.app/com.example.app.Main -o app
```

### A premissa de mundo fechado, e o que quebra

A análise estática decide o que entra no binário. Qualquer coisa que a análise não consegue enxergar não está lá. Este programa roda de boa na JVM:

```java
import java.lang.reflect.Method;

public class Reflect {
    record Greeter() { public String greet() { return "hi"; } }

    public static void main(String[] args) throws Exception {
        Class<?> c = Class.forName(args[0]);          // name only known at run time
        Method m = c.getMethod("greet");
        System.out.println(m.invoke(c.getDeclaredConstructor().newInstance()));
    }
}
```

```
$ java Reflect 'Reflect$Greeter'
hi
```

Compilado com `native-image` e sem metadados, `Reflect$Greeter` nunca foi provado alcançável, então foi descartado:

```
$ ./reflect 'Reflect$Greeter'
Exception in thread "main" org.graalvm.nativeimage.MissingReflectionRegistrationError:
  The program tried to reflectively access class Reflect$Greeter without it being
  registered for runtime reflection. Add Reflect$Greeter to the reflection metadata
  to solve this problem.
```

O mesmo modo de falha atinge `Proxy.newProxyInstance` (classes proxy não podem ser geradas em runtime), `getResourceAsStream` (recursos não são embutidos a menos que declarados), serialização Java, membros acessados via JNI, e qualquer biblioteca que varre o classpath. Note o outro lado da moeda: quando o argumento é uma constante de compilação, a análise *consegue* enxergá-lo e o registra automaticamente —

```java
Class<?> ok = Class.forName("java.util.ArrayList");   // constant: auto-registered, works natively
```

— o que explica exatamente por que reflection "às vezes funciona" em imagens nativas e produz relatos de bug confusos.

### Metadados de alcançabilidade (reachability metadata)

Os metadados são JSON embarcados no artefato em `META-INF/native-image/<groupId>/<artifactId>/reachability-metadata.json`, então uma biblioteca pode declarar suas próprias necessidades e todo build nativo downstream os capta automaticamente:

```json
{
  "reflection": [
    {
      "condition": { "typeReached": "com.example.App" },
      "type": "com.example.Greeter",
      "allDeclaredConstructors": true,
      "methods": [
        { "name": "greet", "parameterTypes": [] }
      ]
    },
    { "type": { "proxy": ["com.example.Service", "java.io.Serializable"] } }
  ],
  "resources": [
    { "glob": "messages/*.properties" },
    { "bundle": "com.example.Messages" }
  ],
  "jni": [
    { "type": "com.example.NativeBridge", "fields": [ { "name": "handle" } ] }
  ]
}
```

`condition.typeReached` mantém o metadado (e as classes que ele arrasta) fora da imagem a menos que aquele tipo seja de fato alcançado. Esse formato de arquivo único substituiu os antigos arquivos separados `reflect-config.json` / `proxy-config.json` / `resource-config.json` / `jni-config.json` / `serialization-config.json`, que ainda são aceitos por compatibilidade.

Escrever isso à mão é um jogo perdido, então colete rodando a aplicação na JVM com o tracing agent:

```
$ java -agentlib:native-image-agent=config-output-dir=src/main/resources/META-INF/native-image \
       -cp target/classes com.example.App
```

O agente registra toda chamada reflexiva, busca de recurso e proxy que a execução realizou — o que significa que o metadado só é tão completo quanto a cobertura de testes daquela execução. Para achar os buracos antes que a produção o faça, faça o build com verificação exata ou rebaixe as falhas a avisos:

```
$ native-image --exact-reachability-metadata -cp target/classes com.example.App
$ ./app -XX:MissingRegistrationReportingMode=Warn     # log every miss instead of throwing
```

A Oracle também publica um repositório compartilhado de metadados para bibliotecas populares (`oracle/graalvm-reachability-metadata`), que os plugins de build nativo do Gradle/Maven consomem automaticamente.

### Flags de build que decidem o resultado

```
$ native-image --no-fallback -jar app.jar -o app
```

`--no-fallback` é a mais importante: por padrão, se a análise encontra recursos que não consegue tratar, o `native-image` pode silenciosamente emitir uma *imagem de fallback* — um launcher que exige uma JVM, anulando todo o exercício. `--no-fallback` transforma isso em uma falha de build.

```
$ native-image -Ob -jar app.jar          # quick build mode: builds much faster, slower binary
$ native-image -O3 -jar app.jar          # highest optimization for production
$ native-image --gc=G1 -jar app.jar      # G1 instead of the default Serial GC (Oracle GraalVM)
$ native-image --enable-monitoring=jfr,jvmstat,heapdump -jar app.jar
$ native-image --static --libc=musl -jar app.jar   # fully static binary for scratch/distroless
```

Use `-Ob` em máquinas de desenvolvimento e ciclos de feedback de CI, `-O3` para o artefato que você vai enviar para produção. A otimização guiada por perfil (profile-guided optimization, `--pgo-instrument` seguido de `--pgo`) recupera boa parte da vantagem de pico de throughput do JIT, mas é um recurso do Oracle GraalVM, não da Community Edition.

### Spring Boot: o processamento AOT preenche a lacuna

Todo o modelo do Spring — component scanning, avaliação de `@Conditional`, proxies cglib, binding de `@Value` — é reflection em runtime, exatamente o que o mundo fechado proíbe. O Spring Boot 3+ resolve isso movendo esse trabalho para o build como **processamento AOT do Spring**, que gera código puro de registro de beans mais os arquivos de hint do GraalVM:

```xml
<plugin>
  <groupId>org.graalvm.buildtools</groupId>
  <artifactId>native-maven-plugin</artifactId>
</plugin>
<plugin>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-maven-plugin</artifactId>
  <executions>
    <execution>
      <id>process-aot</id>
      <phase>process-classes</phase>
      <goals><goal>process-aot</goal></goals>
    </execution>
  </executions>
</plugin>
```

```
$ mvn -Pnative native:compile        # native executable in target/
$ mvn -Pnative spring-boot:build-image   # or a container image via Paketo buildpacks
$ ./gradlew nativeCompile
```

O par `@Configuration`/`@Bean` que você escreveu vira código-fonte gerado sob `target/spring-aot/main/sources`:

```java
public class MyConfiguration__BeanDefinitions {
    public static BeanDefinition getMyBeanBeanDefinition() {
        RootBeanDefinition beanDefinition = new RootBeanDefinition(MyBean.class);
        beanDefinition.setInstanceSupplier(BeanInstanceSupplier
                .<MyBean>forFactoryMethod(MyConfiguration.class, "myBean")
                .withGenerator(rb -> rb.getBeanFactory()
                        .getBean(MyConfiguration.class).myBean()));
        return beanDefinition;
    }
}
```

A consequência a internalizar: **o grafo de beans fica congelado em tempo de build**. Profiles e `@ConditionalOnProperty` são avaliados durante o build AOT, não no startup, então mudar uma propriedade em produção não consegue adicionar um bean que não foi compilado. Sua própria reflection precisa de um `RuntimeHintsRegistrar`:

```java
public class MyHints implements RuntimeHintsRegistrar {
    @Override
    public void registerHints(RuntimeHints hints, ClassLoader cl) {
        hints.reflection().registerType(Greeter.class, MemberCategory.INVOKE_PUBLIC_METHODS);
        hints.resources().registerPattern("messages/*.properties");
    }
}
```

```java
@Configuration
@ImportRuntimeHints(MyHints.class)
class AppConfig {}
```

### Quarkus: native-image-first por design

O Quarkus foi construído em torno dessa restrição, em vez de adaptado a ela depois. Suas extensões fazem *build-time augmentation* — lendo configuração, ligando CDI e registrando o bytecode resultante em tempo de build — então sobra pouca reflection em runtime para o `native-image` engasgar:

```
$ ./mvnw install -Dnative
$ ./mvnw install -Dnative -Dquarkus.native.container-build=true   # build in a container
$ ./mvnw verify -Dnative                # runs @QuarkusIntegrationTest against the binary
$ quarkus build --native                # CLI equivalent
```

`quarkus.native.container-build=true` roda o build dentro de uma imagem builder do Mandrel, o que também contorna a limitação de cross-compilation abaixo: produz um binário Linux a partir de uma workstation macOS ou Windows. O executável resultante reporta startup em milissegundos de um único dígito:

```
$ ./target/getting-started-1.0.0-runner
INFO  [io.quarkus] getting-started 1.0.0 native (powered by Quarkus 3.x) started in 0.009s.
```

### A resposta do próprio JDK: o AOT cache

Native image não é mais a única forma de atacar o startup. O Project Leyden trouxe um **AOT cache** para o JDK padrão — JEP 483 no JDK 24, depois JEP 514 (ergonomia de linha de comando) e JEP 515 (profiling de método AOT) no JDK 25. Ele registra carregamento de classes, linkagem e perfis de método de uma execução de treino e os reproduz em execuções posteriores:

```
# JDK 24 two-step form
$ java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -cp app.jar App
$ java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -cp app.jar App

# JDK 25, one step (JEP 514)
$ java -XX:AOTCacheOutput=app.aot -cp app.jar App

# then use it
$ java -XX:AOTCache=app.aot -cp app.jar App
```

Esse é um trato diferente: uma JVM comum, então reflection, carregamento dinâmico de classes, agentes e observabilidade completa continuam funcionando, e o ganho é uma fração do do native image — dezenas de por cento a menos no startup, não duas ordens de grandeza, e nenhuma redução na pegada de memória ou no tamanho da imagem. Quando o problema é "o startup está meio lento", recorra primeiro ao AOT cache; quando o requisito é "um container precisa estar de pé em 10 ms e ocupar 40 MB", aí é terreno do native image.

## Trade-offs

- **Startup e pegada vs. throughput de pico** — o JIT perfila o programa em execução e pode superotimizar um binário AOT em um loop de servidor de longa duração e "quente"; uma imagem nativa começa na sua velocidade final e nunca fica mais rápida. O PGO reduz essa diferença:

```
$ native-image --pgo-instrument -jar app.jar -o app-inst   # Oracle GraalVM only
$ ./app-inst ...                                            # produces default.iprof
$ native-image --pgo=default.iprof -jar app.jar -o app
```

- **O mundo fechado é uma restrição real, não um botão de ajuste** — qualquer biblioteca que faz reflection sobre nomes calculados em runtime precisa de metadados, e você descobre a lacuna em runtime, não em build:

```
$ ./app
org.graalvm.nativeimage.MissingReflectionRegistrationError: The program tried to
  reflectively access class com.example.Greeter without it being registered for
  runtime reflection.
```

- **Imagens de fallback silenciosas** — sem `--no-fallback`, um build "bem-sucedido" pode entregar um binário que ainda precisa de uma JVM, então o deployment silenciosamente perde todo benefício que você buildou para obter:

```
$ native-image --no-fallback -jar app.jar     # fail the build instead of degrading
```

- **O custo de build migra para a CI** — o `native-image` leva minutos e gigabytes de RAM onde o `javac` leva segundos, e roda por plataforma de destino. Reserve orçamento para isso, e mantenha o `-Ob` no loop interno:

```
$ native-image -Ob -jar app.jar    # quick build: much faster build, slower binary
```

- **Um binário por SO e arquitetura** — não existe mais write-once-run-anywhere; um build macOS não roda em Linux, e o `native-image` não faz cross-compile, então artefatos Linux vêm de uma máquina Linux ou de um container builder:

```
$ ./mvnw install -Dnative -Dquarkus.native.container-build=true   # Linux binary from any host
```

- **Testes precisam rodar contra o binário** — passar nos testes unitários da JVM não prova nada sobre o artefato nativo, já que as falhas são falhas de metadado que só existem depois da compilação. Execuções de teste nativas (`mvn -PnativeTest test`, `./gradlew nativeTest`, `./mvnw verify -Dnative`) são a única forma de pegá-las, e são bem mais lentas que os testes na JVM.

- **Observabilidade e ferramental são reduzidos** — sem dynamic attach, sem `-javaagent`, e profilers, agentes de APM e bibliotecas de instrumentação de bytecode geralmente não funcionam. JFR, jvmstat e heap dumps estão disponíveis, mas só se você os compilou com `--enable-monitoring`, uma decisão de tempo de build que não dá para revisitar em um processo de produção já rodando.

- **Moldado pelo framework, não livre-forma** — grafos de beans em tempo de build significam que uma configuração que antes era só trocar uma propriedade em runtime vira um rebuild; o Spring avalia profiles e `@ConditionalOnProperty` durante o processamento AOT, então uma imagem nativa não pode ser reconfigurada em uma aplicação diferente do jeito que um deployment na JVM pode.

- **Edições e direção estratégica** — os melhores recursos de throughput (PGO, G1 em imagens nativas, ofuscação avançada) são exclusivos do Oracle GraalVM, enquanto a Community Edition e seus builds downstream (Mandrel, Liberica NIK) carregam o resto. A Oracle também descontinuou o Graal JIT opcional que vinha no Oracle JDK 23/24, direcionando esses usuários para o C2 e o AOT cache do JDK, e afirmou que o roadmap do GraalVM está se desacoplando do trem de releases do Java para focar nos runtimes poliglotas — algo a considerar em uma aposta de longo prazo, mesmo que o Native Image em si continue em desenvolvimento ativo.

## Documentation Links

- [Native Image — GraalVM Reference Manual](https://www.graalvm.org/latest/reference-manual/native-image/) — doc
- [Reachability Metadata — GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/metadata/) — doc
- [Collect Metadata with the Tracing Agent — GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/metadata/AutomaticMetadataCollection/) — doc
- [Graal JIT Compiler (Java on GraalVM) — GraalVM Reference Manual](https://www.graalvm.org/latest/reference-manual/java/) — doc
- [Download GraalVM — editions and licensing](https://www.graalvm.org/downloads/) — doc
- [Introducing GraalVM Native Images — Spring Boot Reference](https://docs.spring.io/spring-boot/reference/packaging/native-image/introducing-graalvm-native-images.html) — doc
- [Building a Native Executable — Quarkus Guides](https://quarkus.io/guides/building-native-image) — doc
- [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514) — doc
