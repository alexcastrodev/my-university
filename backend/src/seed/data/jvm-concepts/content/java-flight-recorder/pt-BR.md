---
version: 1.1
updatedAt: 2026-10-09
title: Java Flight Recorder: Profiling de Produção com Baixo Overhead
summary: Como a gravação baseada em eventos do JFR, com overhead abaixo de 1%, permite fazer profile de um JVM de produção ao vivo continuamente, e como controlá-lo inteiramente pela linha de comando.
---
## Objective

Entender o Java Flight Recorder (JFR): um profiler embutido no JVM, baseado em eventos, projetado para rodar em produção continuamente com overhead abaixo de 1%, para que você tenha dados reais do incidente em vez de tentar reproduzi-lo depois.

## Use Cases

- Diagnosticar uma lentidão intermitente em produção sem anexar um profiler de sampling pesado que perturba a própria medição.
- Descartar automaticamente uma gravação quando algo dá errado (uma requisição que leva mais de 5 minutos, um pico inesperado de exceptions) em vez de torcer para pegar o momento ao vivo.
- Ler o conteúdo de uma gravação a partir de um container headless ou ambiente de CI onde nenhuma ferramenta gráfica está disponível.

## Deep Dive

### Profiling baseado em eventos, não só sampling

O JFR funciona registrando *eventos* — uma thread bloqueada esperando um lock, uma pausa de GC, uma alocação de objeto que ultrapassa um limite de tamanho, um method amostrado como em execução no momento — num stream, seja mantido num buffer circular em memória ou escrito num arquivo. Como está embutido no próprio JVM em vez de anexado externamente, ele consegue capturar coisas que um profiler externo não vê de forma barata, como os limites exatos de uma pausa de GC e eventos de compilação JIT, a um custo projetado para ficar abaixo de 1% do throughput da aplicação por padrão.

### Gravação contínua vs. de duração fixa

```
Duração fixa    — inicia a gravação, roda um teste de carga ou reproduz um cenário, para.
                  Melhor para análise *proativa*: você sabe quando o trabalho interessante acontece.

Contínua        — sempre rodando, buffer circular mantém só os eventos mais recentes dentro de um
                  orçamento de tamanho/tempo. Melhor para análise *reativa*: descarte o conteúdo do
                  buffer no momento em que algo der errado, e você já tem dados de logo antes de
                  acontecer — sem precisar reproduzir o problema sob demanda.
```

### Iniciando uma gravação com jcmd

A forma mais portável de controlar o JFR — funciona identicamente numa workstation ou via SSH dentro de um container — é o `jcmd` contra o process id de um JVM em execução:

```
% jcmd <pid> JFR.start name=diag duration=60s filename=recording.jfr
% jcmd <pid> JFR.check                     # lista gravações ativas
% jcmd <pid> JFR.dump name=diag filename=snapshot.jfr   # descarrega uma gravação contínua sob demanda
% jcmd <pid> JFR.stop name=diag
```

`-XX:StartFlightRecording=<options>` inicia uma gravação desde o momento em que o JVM sobe, o que é o que você quer quando o comportamento interessante pode ser o próprio startup, não só o regime permanente.

### Lendo uma gravação sem GUI: `jfr view`

O `jfr view` agrega eventos em tabelas prontas, então a primeira olhada num arquivo `.jfr` é um comando no terminal. `jfr summary` mostra quais tipos de evento existem, `jfr view all-views` lista os views do seu JDK, e o nome de um view pode ser trocado por qualquer nome de tipo de evento:

```
$ jfr summary recording.jfr              # tipos de evento e contagens
$ jfr view all-views recording.jfr       # todos os views que este JDK conhece
$ jfr view hot-methods recording.jfr     # onde o tempo amostrado foi parar
$ jfr view gc-pauses recording.jfr
$ jfr view allocation-by-site recording.jfr
$ jfr view contention-by-site recording.jfr
```

Como a saída é texto puro (e `jfr print --json` entrega dados estruturados), uma gravação também pode ser entregue a um script, ou a um agente de IA, para análise sem nenhuma sessão do Mission Control.

### Seus próprios eventos: telemetria da aplicação pelo mesmo mecanismo

Uma aplicação pode emitir eventos que caem na mesma gravação, com os mesmos timestamps e informações de thread dos eventos da própria JVM. Estenda `jdk.jfr.Event`, marque os campos e envolva o trabalho com `begin()` e `commit()`:

```java
import jdk.jfr.*;

@Name("shop.OrderPlaced")
@Label("Order Placed")
@Category("Shop")
@StackTrace(false)
class OrderPlaced extends Event {
    @Label("Order Id") long orderId;
    @Label("Items") int items;
}

static void place(long id, int items) throws InterruptedException {
    OrderPlaced e = new OrderPlaced();
    e.begin();
    Thread.sleep(items * 5L);        // o trabalho real
    e.orderId = id;
    e.items = items;
    e.commit();                      // duração = momento do commit menos momento do begin
}
```

```
$ java -XX:StartFlightRecording=filename=orders.jfr Orders.java
$ jfr view shop.OrderPlaced orders.jfr

Start Time Duration Event Thread Stack Trace Order Id Items
---------- -------- ------------ ----------- -------- -----
15:48:46    11.3 ms main         N/A                1     2
15:48:46    18.8 ms main         N/A                2     3
15:48:46    25.1 ms main         N/A                3     4
```

### Onde foram o tempo e a CPU: novidades do JDK 25

Três JEPs do JDK 25 aumentam o quanto uma gravação diz sobre o código:

- **Cooperative sampling (JEP 518)** muda como o sampler captura stacks: ele registra apenas o program counter e o stack pointer, e a própria thread alvo monta seu stack trace no próximo safepoint. Isso substitui as heurísticas de percorrer a stack que a thread do sampler usava.
- **CPU-time profiling (JEP 509, experimental, só Linux)** amostra cada thread que executa código Java em intervalos fixos de tempo de *CPU*, usando o timer de CPU do kernel, e atribui o tempo gasto em código nativo ao método Java chamador. O evento vem desligado por padrão:

```
$ java -XX:StartFlightRecording=jdk.CPUTimeSample#enabled=true,filename=profile.jfr -jar app.jar
$ jfr view cpu-time-hot-methods profile.jfr
```

- **Method timing e tracing (JEP 520)** instrumenta os métodos que você nomeia e reporta contagem exata de invocações e tempo mínimo, médio e máximo (`jdk.MethodTiming`), ou um evento com stack trace por chamada (`jdk.MethodTrace`). Os alvos são `classe`, `classe::metodo`, `::metodo` ou `@anotacao`, separados por ponto e vírgula:

```
$ java -XX:StartFlightRecording=filename=orders.jfr,method-timing=Orders::place Orders.java
$ jfr view method-timing orders.jfr

Timed Method            Invocations Minimum Time Average Time Maximum Time
----------------------- ----------- ------------ ------------ ------------
Orders.place(long, int)          40  6.270000 ms 23.100000 ms 40.500000 ms

$ jcmd <pid> JFR.start method-timing=@jakarta.ws.rs.GET    # numa JVM em execução
```

## Trade-offs

- **Overhead abaixo de 1% é um padrão, não uma garantia** — isso vale para o conjunto de eventos e limites padrão; habilitar mais tipos de evento (especialmente profiling de alocação com um limite baixo) troca overhead de volta por detalhe, então trate "o quanto estou habilitando" como um controle de verdade, não algo para maximizar por padrão.
- **Eventos customizados são baratos de desligar e não são grátis de ligar**: um tipo de evento desligado foi projetado para custar muito pouco, mas, ligado, cada `commit()` grava um registro. Chame `end()` e proteja a computação cara de campos com `shouldCommit()`, que é falso quando o evento está desabilitado ou sua duração está abaixo do limite configurado:

```java
OrderPlaced e = new OrderPlaced();
e.begin();
// ... trabalho ...
e.end();
if (e.shouldCommit()) {          // falso se desabilitado ou abaixo do limite de duração
    e.orderId = id;              // só agora paga para preencher os campos
    e.commit();
}
```

- **CPU-time sampling é experimental e só roda em Linux; method timing instrumenta bytecode**: `jdk.CPUTimeSample` só está disponível em Linux, e um filtro amplo de method timing (um pacote inteiro, ou uma anotação comum) instrumenta muitos métodos de uma vez, então gasta overhead como qualquer outro detalhe que você habilita. Nomeie os poucos métodos que você suspeita.

- **O buffer circular de uma gravação contínua só guarda o passado *recente*** — dimensionado por `maxage`/`maxsize`, então é excelente para "algo acabou de dar errado, descarregue os últimos minutos", mas inútil para um incidente que aconteceu horas antes de alguém pensar em olhar, a menos que o buffer tenha sido dimensionado generosamente o suficiente para cobrir essa janela.
- **Book vs today**: no JDK 8, o JFR exigia tanto `-XX:+UnlockCommercialFeatures` quanto `-XX:+FlightRecorder` porque era um recurso licenciado exclusivo da Oracle — **nada disso se aplica mais**. O JFR é totalmente open source e está disponível em toda build mainstream do JDK desde o JDK 11, e em JDKs atuais `jcmd <pid> JFR.start` funciona sem nenhuma flag de unlock. Também pouco enfatizado pelo enquadramento do livro, centrado em GUI: a **ferramenta de CLI `jfr`** empacotada (`jfr print`, `jfr summary`) permite inspecionar o conteúdo de um arquivo `.jfr` direto do terminal — sem precisar da GUI do Java Mission Control — o que importa mais hoje do que em 2020, já que containers headless e pipelines de CI são um lugar muito mais comum para estar depurando um JVM do que um desktop com GUI disponível.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 3 "A Java Performance Toolbox", "Java Flight Recorder", pp. 74-88 — book
- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [jfr — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html) — doc
- [JEP 509: JFR CPU-Time Profiling (Experimental)](https://openjdk.org/jeps/509) - doc
- [JEP 518: JFR Cooperative Sampling](https://openjdk.org/jeps/518) - doc
- [JEP 520: JFR Method Timing & Tracing](https://openjdk.org/jeps/520) - doc
