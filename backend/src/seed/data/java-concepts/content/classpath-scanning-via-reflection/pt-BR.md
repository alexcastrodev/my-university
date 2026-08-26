---
version: 1.0
updatedAt: 2026-08-05
title: Classpath Scanning via Reflection
summary: "Como um component scan funciona de fato por baixo dos panos: uma varredura recursiva de diretórios sobre arquivos .class compilados, Class.forName + isAnnotationPresent para achar classes marcadas por anotação, e por que frameworks de verdade leem metadados de bytecode via ASM em vez de carregar toda classe candidata."
---
## Objective

"Component scan" soa como mágica de framework, mas o mecanismo é uma varredura recursiva de diretórios direta ao ponto: encontrar todo arquivo `.class` compilado sob um pacote base, carregá-lo e checar se ele carrega uma anotação marcadora. É literalmente assim que um framework minimalista descobre seus próprios controllers/services sem nenhum arquivo de configuração — e entender a versão ingênua (uma busca em profundidade — DFS — sobre `target/classes` mais `Class.forName` mais `isAnnotationPresent`) deixa óbvio por que frameworks de verdade como o Spring fazem o trabalho equivalente de forma diferente: não porque a abordagem ingênua esteja errada, mas porque ela não escala bem para classpaths grandes.

## Use Cases

- Construir um pequeno sistema de plugins que descobre implementações por anotação em vez de exigir uma lista explícita de registro.
- Escrever um harness de testes leve ou uma ferramenta de CLI que precisa encontrar "toda classe anotada com `@X`" sem trazer um framework inteiro.
- Entender o que uma linha de log de startup de um container DI como "found N components" está de fato fazendo por baixo.
- Reconhecer por que o component scanning tem um custo por pacote (`@ComponentScan(basePackages = ...)` reduz isso) — ele é proporcional a quantos arquivos `.class` existem sob a raiz escaneada.

## Deep Dive

### Um scanner de classpath DFS minimalista

```java
public class ClassExplorer {
    private static String BASE_PACKAGE;

    public static void explore(Class<?> mainClass) {
        BASE_PACKAGE = mainClass.getPackage().getName();
        String basePath = "target/classes/" + BASE_PACKAGE.replace(".", "/");
        File root = new File(basePath);
        searchRecursively(root, BASE_PACKAGE);
    }

    private static void searchRecursively(File directory, String currentPackage) {
        for (File file : Objects.requireNonNull(directory.listFiles())) {
            if (file.isDirectory()) {
                searchRecursively(file, currentPackage + "." + file.getName());   // descend
            } else if (file.getName().endsWith(".class")) {
                String className = currentPackage + "." + file.getName().replace(".class", "");
                try {
                    Class<?> clazz = Class.forName(className);                    // load it
                    if (clazz.isAnnotationPresent(SimpleController.class)) {       // inspect it
                        ControllersMap.registerController(clazz);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

Três passos por arquivo: descer para subdiretórios (DFS, então estruturas de pacote aninhadas como `app.controllers.user` são encontradas independentemente da profundidade), reconstruir o nome totalmente qualificado da classe a partir do caminho do arquivo e — o passo real de "descoberta" — `Class.forName()` para carregá-la seguido de `isAnnotationPresent()` para checar a anotação marcadora. Toda classe que der match é registrada em um mapa (interface/marcador → implementação) que o resto do framework consulta em tempo de requisição, em vez de qualquer coisa estar hardcoded.

### Por que `Class.forName()` é a parte cara

`Class.forName(className)` não apenas lê metadados — ela **carrega e inicializa** a classe: executando inicializadores estáticos, resolvendo as próprias dependências da classe e registrando-a com o class loader da JVM. Para uma checagem de anotação marcadora que pode rejeitar 95% das classes escaneadas, isso significa pagar o custo total de carregamento de classe para classes que acabam não sendo controllers/services de forma alguma — incluindo quaisquer efeitos colaterais que esses inicializadores estáticos tenham, independentemente de a classe acabar sendo usada ou não.

### A alternativa moderna: ler bytecode sem carregar a classe

```java
// Conceptually, what ASM-based scanning does instead:
ClassReader reader = new ClassReader(classBytes);   // parse .class bytes directly
reader.accept(new AnnotationVisitor() { ... }, 0);   // visit annotations without loading the class
```

O `ClassPathScanningCandidateComponentProvider` do Spring (a maquinaria por trás do `@ComponentScan`) lê metadados de classe via ASM — uma biblioteca de manipulação de bytecode — em vez de chamar `Class.forName()` em cada candidata. Isso significa que o Spring consegue checar `@Component`/`@Service`/`@Repository`/`@Controller` fazendo o parse da tabela de anotações do bytecode compilado diretamente, sem nunca carregar (e, portanto, sem disparar inicializadores estáticos ou efeitos colaterais de classloading para) classes que não deem match. Só classes que passam na checagem de metadados são de fato carregadas na JVM. Bibliotecas de terceiros como ClassGraph ou Reflections adotam a mesma abordagem de base — ler metadados primeiro, carregar de forma preguiçosa — pelo mesmo motivo.

## Trade-offs

- **Escaneamento via `Class.forName()` por arquivo tem efeitos colaterais reais, não só um custo de performance** — carregar uma classe executa seus inicializadores estáticos, então um scanner ingênuo pode disparar código (um bloco estático que abre um recurso, registra algo globalmente ou lança uma exceção) puramente como efeito colateral de checar se a classe está anotada, mesmo para classes que acabam não dando match.
```java
class NotAController {
    static { System.out.println("side effect on scan, even though this isn't a controller"); }
}
// A Class.forName()-based scanner prints this line just by walking past the file —
// an ASM-based scanner reading bytecode metadata directly would not.
```
- **DFS sobre `target/classes` só funciona para classpaths "explodidos", não JARs empacotados** — percorrer uma árvore de `File` assume que as classes existem como arquivos `.class` soltos em disco; um deployment de produção rodando a partir de um fat JAR não tem esse diretório para percorrer, que é um dos motivos pelos quais scanners de verdade (o do Spring incluso) resolvem entradas de classpath de forma genérica (URLs de JAR, module paths) em vez de assumir um diretório de sistema de arquivos.
- **Descoberta baseada em reflection troca tempo de startup por configuração zero** — nenhum arquivo XML/properties lista quais classes são controllers, o que é conveniente, mas todo o classpath (ou os pacotes base escaneados) precisa ser percorrido no startup para descobrir isso; reduzir `@ComponentScan(basePackages = ...)` à menor lista de pacotes suficiente reduz esse custo diretamente, o mesmo princípio da constante `BASE_PACKAGE` do scanner ingênuo.

## Documentation Links

- [Class.forName() — java.lang API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html#forName(java.lang.String)) — doc
- [AnnotatedElement.isAnnotationPresent() — java.lang.reflect API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html#isAnnotationPresent(java.lang.Class)) — doc
- [Spring Framework Reference — Classpath Scanning and Managed Components](https://docs.spring.io/spring-framework/reference/core/beans/classpath-scanning.html) — doc
- [ASM — a Java bytecode manipulation and analysis framework](https://asm.ow2.io/) — doc
