---
version: 1.0
updatedAt: 2026-08-19
title: "jlink e jdeps: Imagens de Runtime Customizadas"
summary: O jlink liga módulos do JDK e da aplicação em uma imagem de runtime autocontida contendo só o que é alcançável, com o jdeps descobrindo primeiro a lista real de módulos — distribuindo um runtime Java enxuto em vez de um JDK completo.
---
## Objective

`jlink` é o *linker* do JDK: ele pega um conjunto de módulos — módulos do JDK mais os seus próprios — e escreve uma imagem de runtime Java autocontida e executável que contém só esses módulos e nada mais. `jdeps` é seu analisador complementar: ele lê código compilado e reporta quais módulos esse código realmente precisa, em uma forma que o `jlink` aceita diretamente. Juntos eles respondem a uma questão de deployment, não de linguagem: em vez de distribuir uma aplicação e exigir um JDK ou JRE completo na máquina alvo, você distribui um diretório que contém um Java enxuto mais sua aplicação, e ele roda em uma máquina sem Java instalado nenhum. Este é o ganho prático do [Java Platform Module System](/java-concepts/java-platform-module-system) — o `jlink` só funciona porque o próprio JDK foi dividido em módulos com dependências declaradas, então um grafo de dependências pode ser resolvido e as partes inalcançáveis deixadas de fora.

## Use Cases

- Construir uma imagem de container que carrega um runtime de ~35–50 MB em vez de um JDK de ~380 MB, cortando o tempo de pull do registry e o custo de cold-start em CI e em deployments com autoscaling.
- Distribuir uma ferramenta desktop ou CLI para usuários que não podem ser obrigados a instalar ou gerenciar uma versão de Java eles mesmos (geralmente via `jpackage`, que chama o `jlink` internamente).
- Descobrir do que um JAR *realmente* depende com `jdeps --print-module-deps`, incluindo se ele alcança APIs internas do JDK, antes de comprometer-se com uma lista de módulos de runtime.
- Produzir imagens de runtime por plataforma para Linux, macOS e Windows a partir de uma única máquina de build — sujeito à ressalva de disponibilidade de JMOD abaixo.
- Congelar um runtime conhecidamente bom com flags de JVM embutidas e um archive CDS gerado, para que o comportamento de startup seja idêntico em todo lugar onde a imagem é implantada.

## Deep Dive

### Uma aplicação modular mínima

`jlink` precisa de módulos, então o ponto de partida é um `module-info.java` e um JAR modular. Essa é a única parte que se apoia no JPMS em si — veja o [conceito do sistema de módulos](/java-concepts/java-platform-module-system) para o que as diretivas significam.

```java
// src/demo/module-info.java
module demo {
    // java.base is implicit; nothing else is needed for this app
}
```

```java
// src/demo/com/example/demo/Hello.java
package com.example.demo;

public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello from a linked runtime, on Java "
            + System.getProperty("java.version"));
    }
}
```

Compile e empacote como um JAR modular — o `module-info.class` na raiz do JAR é o que o torna um módulo em vez de uma biblioteca comum:

```bash
javac -d mods/demo $(find src/demo -name '*.java')
jar --create --file demo.jar --main-class com.example.demo.Hello -C mods/demo .
```

### jdeps: descubra a lista real de módulos

Nunca chute a lista de módulos. `jdeps` lê o bytecode e reporta as dependências que encontra:

```bash
$ jdeps --module-path . demo.jar
demo
 [file:///home/dev/jlink-demo/./demo.jar]
   requires mandated java.base (@25.0.3)
demo -> java.base
   com.example.demo -> java.io            java.base
   com.example.demo -> java.lang          java.base
   com.example.demo -> java.lang.invoke   java.base
```

Para a versão que você de fato passa ao `jlink`, use `--print-module-deps`, que imprime uma lista já reduzida, separada por vírgulas:

```bash
$ jdeps --print-module-deps --module-path . demo.jar
java.base
```

Uma aplicação realista imprime algo mais parecido com `java.base,java.logging,java.naming,java.sql,java.xml`. Duas flags relacionadas importam na prática: `--list-deps` também nomeia quaisquer pacotes *internos* do JDK que o código toca (uma bandeira vermelha de portabilidade), e `--ignore-missing-deps` deixa a análise terminar em uma árvore de dependências que não resolve completamente — essencial para o caso de classpath abaixo.

### jlink: ligar a imagem

```bash
jlink --module-path "$JAVA_HOME/jmods:." \
      --add-modules demo \
      --launcher rundemo=demo/com.example.demo.Hello \
      --strip-debug --no-header-files --no-man-pages \
      --compress=zip-6 \
      --output mini-java
```

- `--module-path` é onde o `jlink` procura módulos: o diretório `jmods` do próprio JDK mais onde quer que seus módulos vivam. Em um JDK construído com o suporte a linkable runtime da JEP 493 (veja abaixo), a parte `jmods` é dispensada — o `jlink` lê os módulos do JDK de dentro da imagem em execução em vez disso.
- `--add-modules` é o conjunto *raiz*. Arestas `requires` transitivas são resolvidas automaticamente, e é exatamente por isso que a saída do `jdeps` pode ser colada literalmente.
- `--launcher name=module/mainclass` escreve um script executável `bin/name`, então usuários nunca precisam digitar um comando `java`.
- `--compress` aceita `zip-0` até `zip-9` (padrão `zip-6`) desde o JDK 21; os antigos valores numéricos `--compress=0|1|2` estão deprecados e planejados para remoção, então um `--compress=2` em um script antigo deveria virar `--compress=zip-6`.

O resultado é um diretório de runtime completo:

```bash
$ ./mini-java/bin/rundemo
Hello from a linked runtime, on Java 25.0.3

$ ./mini-java/bin/java --list-modules
demo
java.base@25.0.3

$ du -sh mini-java "$JAVA_HOME"
32M     mini-java
377M    /usr/lib/jvm/jdk-25
```

`--list-modules` é a auditoria honesta: se um módulo que você esperava está ausente, a falha vai chegar como uma `ClassNotFoundException` em tempo de execução, não em tempo de link.

### Service providers não são ligados por padrão

A resolução de módulos do `jlink` deliberadamente ignora arestas `provides`. Um módulo que só é alcançável como um provider do `ServiceLoader` é silenciosamente omitido:

```bash
$ ./mini-java/bin/java -m demo/com.example.demo.Hello
Exception in thread "main" java.util.NoSuchElementException   # no provider was linked
```

Duas correções, e a segunda é quase sempre a certa:

```bash
# see what providers the current module set could use
jlink --module-path "$JAVA_HOME/jmods:." --add-modules demo --suggest-providers

# link them all in (blunt: pulls in every observable provider, inflating the image)
jlink ... --bind-services --output mini-java

# or name the providers you actually want as extra roots (precise)
jlink ... --add-modules demo,com.example.demo.provider --output mini-java
```

Essa é a causa mais comum de uma imagem que liga sem erro e depois morre em tempo de execução — providers de charset, drivers JDBC, backends de logging, e dados de locale chegam todos por esse caminho.

### O problema da dependência não modular

Essa restrição *não* afrouxou. Tudo no grafo resolvido precisa ser um módulo de verdade com um `module-info.class`. Um **módulo automático** — um JAR comum colocado no module path, que o runtime tolera para `java` — é explicitamente rejeitado pelo `jlink`:

```bash
$ jlink --module-path libs:mods --add-modules com.example.app --output image
Error: automatic module cannot be used with jlink: jackson.databind from
  file:///home/dev/app/libs/jackson-databind-2.19.0.jar
```

`--add-modules ALL-MODULE-PATH` não salva isso. Ele só amplia o *conjunto raiz* para todo módulo observável no module path; módulos automáticos entre eles ainda são rejeitados. A partir do JDK 24 ele também não define mais um module-path padrão, então o atalho mais antigo falha de vez:

```bash
$ jlink --add-modules ALL-MODULE-PATH --output image
Error: --module-path option must be specified with --add-modules ALL-MODULE-PATH
```

Há exatamente dois caminhos honestos a seguir.

**Opção A — modularizar a dependência.** Gere um `module-info.java` para o JAR problemático, compile-o, e reaplique. Isso funciona, e é um fardo de manutenção que você agora carrega para uma biblioteca que não controla:

```bash
jdeps --ignore-missing-deps --generate-module-info generated \
      --module-path libs libs/jackson-databind-2.19.0.jar
javac --patch-module jackson.databind=libs/jackson-databind-2.19.0.jar \
      --module-path libs -d patched generated/jackson.databind/module-info.java
jar --update --file libs/jackson-databind-2.19.0.jar -C patched module-info.class
```

**Opção B — ligar só o JDK, manter a aplicação no classpath.** É isso que praticamente todo build de container real faz, e evita modularizar a aplicação por completo. `jdeps` analisa o classpath, `--ignore-missing-deps` absorve as inevitáveis dependências opcionais, e a imagem resultante não contém nenhum módulo de aplicação:

```bash
$ jdeps --ignore-missing-deps --multi-release 25 --print-module-deps \
        --class-path 'libs/*' app.jar
java.base,java.logging,java.management,java.naming,java.sql

$ jlink --add-modules java.base,java.logging,java.management,java.naming,java.sql \
        --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
        --output jre

$ ./jre/bin/java -cp 'app.jar:libs/*' com.example.app.Main
```

Note `--multi-release`: sem ele, `jdeps` lê o ramo pré-9 de um JAR multi-release e pode reportar o conjunto de módulos errado. O custo da Opção B é que `--ignore-missing-deps` esconde problemas reais tão prontamente quanto os espúrios, então a lista de módulos resultante precisa ser validada de fato rodando a aplicação contra o runtime ligado — idealmente a suíte de testes completa, não um smoke test.

### Builds de container: onde isso compensa hoje

O uso dominante do `jlink` em 2026 é um build de imagem multi-stage. O JDK nunca chega à camada final:

```dockerfile
FROM eclipse-temurin:25-jdk AS link
WORKDIR /build
COPY app.jar libs/ ./
RUN DEPS=$(jdeps --ignore-missing-deps --multi-release 25 \
             --print-module-deps --class-path 'libs/*' app.jar) && \
    jlink --add-modules "$DEPS" \
          --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
          --output /jre

FROM debian:trixie-slim
COPY --from=link /jre /opt/jre
COPY app.jar libs/ /opt/app/
ENTRYPOINT ["/opt/jre/bin/java", "-cp", "/opt/app/app.jar:/opt/app/libs/*", \
            "com.example.app.Main"]
```

Duas outras opções valem a pena embutir aqui, já que a imagem é reconstruída a cada deploy de qualquer forma: `--generate-cds-archive` produz um archive de class-data sharing dentro da imagem para startup mais rápido, e `--add-options` congela flags de JVM no launcher para que ninguém precise decorá-las (`--add-options` é uma opção de plugin, então aparece sob `jlink --list-plugins` em vez de na saída principal de `--help`):

```bash
jlink --add-modules "$DEPS" --generate-cds-archive \
      --add-options "-XX:+UseSerialGC -Xshare:auto" \
      --output /jre
```

### Ligação cross-platform, e como a JEP 493 mudou isso

`jlink` não pode compilar para outra plataforma da forma que um cross-compiler C consegue, mas pode *montar* uma imagem para uma, porque os binários específicos da plataforma vivem nos arquivos JMOD do JDK alvo. Descompacte o JDK da plataforma alvo e coloque seu `jmods` no module path; `jlink` detecta a plataforma alvo a partir desses módulos:

```bash
tar xzf jdk-25_linux-x64_bin.tar.gz -C /tmp/target
jlink --module-path /tmp/target/jdk-25/jmods:mods \
      --add-modules com.example.app \
      --output linux-x64-image
```

O `jlink` do JDK host e o JDK alvo precisam ser da mesma feature release. E há uma ressalva real de 2026: **a JEP 493 (JDK 24) permite que um JDK seja construído sem arquivos JMOD nenhum**, com o `jlink` lendo o conteúdo dos módulos de dentro da própria imagem de runtime. Esse build é ~35% menor como download, e várias distribuições o adotam — o Eclipse Temurin o habilitou a partir do JDK 24, então seu tarball padrão não tem diretório `jmods`. Confira qual modo você tem:

```bash
$ jlink --help | grep -i "run-time image"
Linking from run-time image enabled
```

Quando essa linha está presente, ligação de plataforma única simples funciona bem sem nenhuma entrada de `--module-path` para o JDK, mas ligação cruzada é impossível a partir só desse download: os executáveis e bibliotecas nativas para a outra plataforma simplesmente não estão lá. A correção é buscar o pacote de JMODs separado da plataforma alvo (a Adoptium publica um via sua API) e apontar `--module-path` para ele. Um `jlink` sem JMOD também não consegue produzir uma imagem que contenha o próprio `jlink`.

## Trade-offs

- **Não há mecanismo de atualização para uma imagem ligada** — uma imagem de runtime é uma cópia congelada do JDK a partir do qual foi ligada. Quando um CVE aparece em `java.base`, corrigir significa re-ligar e reimplantar a imagem inteira, não atualizar um pacote de JDK. Isso não é problema para um serviço reconstruído a cada commit e é uma responsabilidade real para software instalado em máquinas de clientes, onde uma atualização de segurança agora exige um re-download completo.
- **Todo módulo no grafo precisa ser um módulo de verdade** — módulos automáticos são rejeitados de vez, então uma aplicação modular com uma dependência não modular não pode ser ligada sem ou corrigir essa dependência ou abandonar o deployment por module-path para ela:

```bash
Error: automatic module cannot be used with jlink: jackson.databind from ...
```

- **Service providers são omitidos a menos que você diga o contrário** — a resolução ignora `provides`, então a imagem liga com sucesso e depois falha em tempo de execução por causa de um charset, driver, ou dados de locale faltando:

```bash
jlink ... --suggest-providers          # audit first
jlink ... --bind-services              # or name providers explicitly as roots
```

- **A economia é real mas tem um piso** — só o `java.base` já é a maior parte do piso, então uma aplicação de servidor típica fica em torno de 45–70 MB em vez de algo dramaticamente menor. Meça antes de construir um pipeline em torno disso:

```bash
$ jlink --add-modules java.base --strip-debug --no-man-pages \
        --no-header-files --compress=zip-6 --output floor
$ du -sh floor
44M     floor
```

- **`--ignore-missing-deps` troca um erro em tempo de link por um em tempo de execução** — é inevitável em classpaths reais cheios de dependências opcionais, mas significa que a lista de módulos é uma hipótese, não uma prova. Só rodar a aplicação contra a imagem ligada a valida.
- **Ligação cross-platform agora depende da distribuição** — a antiga receita de "descompacte o JDK do outro SO, aponte para seus `jmods`" silenciosamente parou de funcionar em builds JDK 24+ sem JMOD, então um script de build que funcionou por anos pode quebrar em um upgrade de JDK com um erro confuso de módulo não encontrado em vez de um diagnóstico claro.
- **Para distribuição desktop, `jlink` é a camada por baixo, não a ferramenta que você dirige** — `jpackage` roda o `jlink` para você e embrulha o resultado em um instalador nativo da plataforma (`msi`, `dmg`, `deb`, `rpm`), tratando o caso não modular colocando JARs em um diretório de app. Chamar o `jlink` diretamente vale a pena para containers e para controle preciso; para uma instalação de usuário final, recorrer a ele primeiro significa reimplementar o `jpackage`.

## Documentation Links

- [The jlink Command — Java SE 25 Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
- [The jdeps Command — Java SE 25 Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html) — doc
- [JEP 282: jlink: The Java Linker](https://openjdk.org/jeps/282) — doc
- [JEP 493: Linking Run-Time Images without JMODs](https://openjdk.org/jeps/493) — doc
- [Creating Runtime and Application Images with jlink — dev.java](https://dev.java/learn/jlink/) — doc
