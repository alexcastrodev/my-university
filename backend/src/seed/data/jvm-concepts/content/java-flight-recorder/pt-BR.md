---
version: 1.0
updatedAt: 2026-08-13
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

## Trade-offs

- **Overhead abaixo de 1% é um padrão, não uma garantia** — isso vale para o conjunto de eventos e limites padrão; habilitar mais tipos de evento (especialmente profiling de alocação com um limite baixo) troca overhead de volta por detalhe, então trate "o quanto estou habilitando" como um controle de verdade, não algo para maximizar por padrão.
- **O buffer circular de uma gravação contínua só guarda o passado *recente*** — dimensionado por `maxage`/`maxsize`, então é excelente para "algo acabou de dar errado, descarregue os últimos minutos", mas inútil para um incidente que aconteceu horas antes de alguém pensar em olhar, a menos que o buffer tenha sido dimensionado generosamente o suficiente para cobrir essa janela.
- **Book vs today**: no JDK 8, o JFR exigia tanto `-XX:+UnlockCommercialFeatures` quanto `-XX:+FlightRecorder` porque era um recurso licenciado exclusivo da Oracle — **nada disso se aplica mais**. O JFR é totalmente open source e está disponível em toda build mainstream do JDK desde o JDK 11, e em JDKs atuais `jcmd <pid> JFR.start` funciona sem nenhuma flag de unlock. Também pouco enfatizado pelo enquadramento do livro, centrado em GUI: a **ferramenta de CLI `jfr`** empacotada (`jfr print`, `jfr summary`) permite inspecionar o conteúdo de um arquivo `.jfr` direto do terminal — sem precisar da GUI do Java Mission Control — o que importa mais hoje do que em 2020, já que containers headless e pipelines de CI são um lugar muito mais comum para estar depurando um JVM do que um desktop com GUI disponível.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 3 "A Java Performance Toolbox", "Java Flight Recorder", pp. 74-88 — book
- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [jfr — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html) — doc
