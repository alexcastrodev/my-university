---
version: 1.0
updatedAt: 2026-10-09
title: "Project Leyden: AOT Cache, Warm-up e Startup"
summary: Como o AOT cache do Project Leyden guarda classes, perfis de métodos, objetos e (em breve) código compilado de uma execução de treino para encurtar startup e warm-up sem abandonar a JVM dinâmica, e o que cada JEP entrega de fato hoje.
---
## Objective

O Project Leyden ataca os dois motivos pelos quais um programa Java é lento nos primeiros segundos sem abrir mão da JVM dinâmica: o **startup** (ler, interpretar, carregar, ligar e inicializar milhares de classes) e o **warm-up** (rodar no interpretador enquanto o JIT coleta perfis, antes de existir código otimizado). O mecanismo é o **AOT cache**, um arquivo produzido por uma *execução de treino* da sua aplicação e consumido por toda *execução de produção* seguinte. O trabalho que antes se repetia a cada inicialização é feito uma vez e guardado. Não é outro runtime: reflection, carregamento dinâmico de classes, agentes e o JIT continuam funcionando, e o JIT ainda assume quando a carga difere da execução de treino. O projeto é entregue como uma sequência de JEPs, cada uma acrescentando um tipo de dado ao mesmo cache, então saber *o que está no cache hoje* e *o que ainda é só proposta* é o núcleo do assunto.

## Use Cases

- Reduzir o tempo até a primeira requisição de um serviço que precisa escalar rápido, onde cada instância nova paga todo o custo de carregamento de classes e warm-up.
- Baratear JVMs de vida curta: ferramentas de linha de comando, tooling de build, workers de teste e funções serverless que nunca vivem o bastante para aquecer.
- Obter boa parte do ganho de startup de um executável nativo mantendo uma JVM normal, de modo que frameworks pesados em reflection não precisem de metadados em tempo de build.
- Raciocinar sobre regressões de startup: saber qual de "classes", "perfis", "objetos" ou "código" um cache contém diz o que ainda é pago em tempo de execução.

## Deep Dive

### Startup e warm-up são custos diferentes

Uma JVM fria paga duas vezes. Primeiro ela carrega e liga toda classe que o programa toca, o que, numa aplicação com framework, significa milhares de classes. Depois executa esse código no interpretador enquanto o HotSpot conta invocações e registra *perfis* (qual desvio é tomado, quais tipos de receptor aparecem em um ponto de chamada) para que C1 e C2 saibam o que otimizar. O desempenho de pico só chega depois dos dois. Um runtime que quer otimizar de forma agressiva *porque* observa o programa real é estruturalmente lento no começo, e esse é o preço do desenho descrito em [JIT Tiered Compilation](/jvm-concepts/jit-tiered-compilation). O Leyden move a observação da execução de produção para uma execução de treino.

### O que o AOT cache guarda, uma JEP por vez

```
JEP 483  JDK 24  classes já lidas, interpretadas, carregadas e ligadas   (entregue)
JEP 514  JDK 25  comandos de um passo para criar o cache                 (entregue)
JEP 515  JDK 25  perfis de métodos da execução de treino                 (entregue)
JEP 516  JDK 26  objetos Java em cache utilizáveis com qualquer GC       (entregue)
JEP 544  JDK 28  código nativo compilado de métodos quentes              (planejada, ainda não lançada)
```

Cada JEP estende o *mesmo* cache e os mesmos comandos, então nada no seu script de inicialização muda quando uma JEP posterior chega. O exemplo da própria JEP 515 mostra o que os perfis compram: um programa curto com Stream foi de 90 ms para 73 ms, por cerca de 250 KB a mais de cache. A JEP 544 é o passo que remove a maior parte do warm-up restante, porque o código compilado, e não só a informação necessária para compilá-lo, vem do cache.

### Criando e usando um cache

```java
public class Main {
    public static void main(String[] args) {
        long total = java.util.stream.IntStream.range(0, 1_000).boxed()
            .map(i -> i * 2).filter(i -> i % 3 == 0)
            .mapToLong(i -> i).sum();
        System.out.println(total);
    }
}
```

```
# JDK 25+, um passo (JEP 514): roda a app e escreve app.aot ao terminar
$ java -XX:AOTCacheOutput=app.aot -cp app.jar Main

# toda execução seguinte
$ java -XX:AOTCache=app.aot -cp app.jar Main
```

A forma do JDK 24 divide a mesma coisa em duas etapas, útil quando a máquina que treina e a que monta o cache são diferentes, ou quando a memória é curta (a forma de um passo precisa de cerca do dobro do heap do treino enquanto monta o cache):

```
$ java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -cp app.jar Main
$ java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -cp app.jar Main
```

### Quando um cache é válido

O cache só é usado se a JVM de produção combina com a que treinou: mesma versão do JDK, arquitetura e sistema operacional, um class path compatível (JARs extras podem ser acrescentados no fim, diretórios não são suportados) e as mesmas opções de módulo. Agentes que reescrevem arquivos de classe o invalidam. Se qualquer regra for violada, o HotSpot imprime um aviso e roda normalmente sem o cache, então um cache velho custa tempo de startup em silêncio em vez de falhar. Para transformar esse silêncio em falha, use `-XX:AOTMode=required` (escrito `-XX:AOTMode=on` antes do JDK 27).

```
$ java -XX:AOTCache=app.aot -XX:AOTMode=required -cp other.jar Main
# termina com erro em vez de cair para um start frio
```

### Objetos e garbage collectors

Os primeiros caches guardavam objetos do heap num layout preso a coletores específicos, então o ZGC não podia usá-los. A JEP 516 acrescentou um formato independente de GC que é *transmitido* para o heap por uma thread em segundo plano, em vez de mapeado em memória. Ele é escolhido automaticamente (por exemplo, quando o treino rodou com ZGC ou com heap acima de 32 GB) e `-XX:+AOTStreamableObjects` o força. O streaming quer um núcleo de CPU sobrando, o que pesa em limites pequenos de container.

### Onde o Leyden para

O Leyden mantém a JVM, então o ganho é uma fração do que um executável nativo dá e o consumo de memória não encolhe. A JEP 483 reporta cerca de 42% de startup mais rápido tanto para uma demo pequena com Stream quanto para o Spring PetClinic, com caches de 11 MB e 130 MB respectivamente. Quando o requisito é um processo no ar em milissegundos e com pegada pequena, compare com [GraalVM Native Image Compilation](/java-concepts/graalvm-native-image-compilation). Quando o requisito é "a mesma aplicação, perceptivelmente mais rápida para subir", o AOT cache é o primeiro passo mais barato. Reduzir o que você distribui é outra alavanca: veja [jlink e jdeps: Imagens de Runtime Customizadas](/java-concepts/jlink-custom-runtime-images).

## Trade-offs

- **O cache é tão bom quanto a execução de treino**: classes que o treino nunca tocou não entram no cache, e classes que ele tocou sem necessidade incham o cache. Usar mocks de rede ou de banco durante o treino carrega classes que a produção nunca usa.

```
# treino contra um banco stubado: as classes do stub entram no cache, as do driver real não
$ java -XX:AOTCacheOutput=app.aot -Dspring.profiles.active=test -jar app.jar
```

- **Um cache está preso a um JDK e a um class path exatos**: atualize o JDK ou mude uma dependência e o cache é ignorado com um aviso, então o cache deve ser reconstruído a cada build, não commitado.

```
$ java -XX:AOTCache=app.aot -cp app-v2.jar Main
# o HotSpot avisa que não pode usar o cache e sobe sem ele (o texto da mensagem varia por JDK)
```

- **`AOTMode=required` troca lentidão silenciosa por falha dura**: ótimo num pipeline que precisa perceber um cache velho, arriscado em produção, onde adicionar um agente de monitoramento que intercepta o carregamento de classes impediria a aplicação de subir.

- **Não aumenta o throughput de pico**: o JIT ainda produz o código do regime permanente, então um serviço de longa duração é tão rápido quanto antes depois do warm-up; só o caminho até lá fica mais curto.

- **O conjunto de recursos ainda está se movendo**: o cache de código compilado (JEP 544) está planejado, não lançado, e flags foram renomeadas entre versões (`AOTMode=on` virou `required` no JDK 27). Fixe a versão do JDK no build e trate as flags de inicialização como parte do contrato dessa versão.

## Documentation Links

- [JEP 483: Ahead-of-Time Class Loading & Linking](https://openjdk.org/jeps/483) - doc
- [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514) - doc
- [JEP 515: Ahead-of-Time Method Profiling](https://openjdk.org/jeps/515) - doc
- [JEP 516: Ahead-of-Time Object Caching with Any GC](https://openjdk.org/jeps/516) - doc
- [JEP 544: Ahead-of-Time Code Compilation](https://openjdk.org/jeps/544) - doc
- [Project Leyden - OpenJDK](https://openjdk.org/projects/leyden/) - doc
