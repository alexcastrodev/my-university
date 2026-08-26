---
version: 1.0
updatedAt: 2026-08-13
title: "ZGC Coleta Concorrente: Colored Pointers e Allocation Stalls"
---
## Objective

Entender o mecanismo que permite ao ZGC manter pausas sub-milissegundo independentemente do tamanho do heap — colored pointers e o load barrier — o que o ZGC generacional mudou, e por que "allocation stall" (não uma pausa stop-the-world) é a métrica a acompanhar quando o ZGC é o coletor em uso.

## Use Cases

- Decidir se as pausas sub-milissegundo do ZGC valem o custo de throughput e footprint para um serviço específico sensível a latência, em vez de adotá-lo só porque o número de pausa parece bom isoladamente.
- Explicar por que um serviço pode parecer perfeito num dashboard de pausas de GC sob ZGC enquanto requisições estão de fato bloqueadas — porque o modo de falha não é uma pausa.
- Saber qual versão do JDK o ZGC generacional realmente exige, já que o design não generacional pré-JDK-21 tem um perfil de performance real e diferente em serviços com alocação intensa.

## Deep Dive

### Colored pointers e o load barrier

A parte difícil da coleta concorrente não é a marcação, é a movimentação: se o coletor realoca um objeto enquanto threads da aplicação ainda seguram referências para o endereço antigo, essas referências agora estão erradas. O G1 evita isso fazendo toda realocação dentro de uma pausa stop-the-world. O ZGC não pode, então uma referência de 64 bits guarda metadados do coletor nos bits sobressalentes — se o objeto foi marcado no ciclo atual, se o ponteiro foi remapeado desde a última realocação. Toda leitura de um campo de referência então passa por um **load barrier**: uma verificação inline desses bits que, no caso comum, confirma que o ponteiro está bom e segue em frente, e no caso incomum corrige na hora, atualizando a referência em memória (self-healing) para que a próxima leitura seja rápida.

```
G1:  write barrier em escritas de referência (mantém remembered sets) + realocação stop-the-world
ZGC: load barrier em leituras de referência (colored pointers) + realocação concorrente
```

O G1 paga pela realocação com tempo de pausa; o ZGC paga por ela com throughput espalhado finamente por toda leitura de referência que a aplicação faz. Nenhum dos dois coletores faz menos trabalho — eles cobram isso de forma diferente, e o ZGC cobra continuamente em vez de numa pausa.

### Por que o ZGC original não era generacional

O ZGC antes do JDK 21 coletava o heap inteiro a cada ciclo — sem uma geração jovem separada. Isso significa que a hipótese generacional fraca (a maioria dos objetos morre jovem), que é o que torna uma coleta jovem do G1 barata, não trazia nada pro ZGC: todo ciclo percorria o conjunto vivo inteiro, incluindo dados de vida longa não tocados há uma hora, então o custo por ciclo era proporcional ao total de dados vivos em vez de aos dados recém-alocados. Para um serviço com um conjunto vivo pequeno isso é ok; para um serviço alocando pesado contra um conjunto vivo de vários gigabytes, significava travessias completas repetidas só para recuperar lixo de requisição de vida curta que o G1 teria tratado numa pausa jovem de 40 ms — as pausas continuavam minúsculas, exatamente como anunciado, mas o custo de CPU e a frequência de coleta subiam bastante.

### O rollout do ZGC generacional

```
JDK 21  JEP 439  ZGC Generacional lança, opt-in via -XX:+ZGenerational
JDK 23  JEP 474  Modo generacional vira o padrão
JDK 24  JEP 490  Modo não generacional removido completamente
```

O ZGC generacional adiciona uma geração jovem com a propriedade usual de que a maioria das coletas olha só objetos recém-alocados, e precisa de store barriers além de load barriers para rastrear referências de objetos velhos para objetos jovens — o mesmo problema de referência entre gerações que o G1 resolve com remembered sets, resolvido de forma diferente. No JDK 21 ou 22, o ZGC sem `-XX:+ZGenerational` é o design antigo não generacional; no JDK 23+, o generacional é o que realmente está rodando.

### Allocation stalls: o modo de falha sem uma pausa

Todo coletor falha de alguma forma quando a alocação ultrapassa a coleta. No G1 é evacuation failure e uma compactação completa stop-the-world. O ZGC não tem fallback stop-the-world: quando uma thread quer memória que ainda não está disponível porque o coletor concorrente não terminou de liberá-la, essa thread simplesmente espera.

```
Allocation Stall (payment-worker-7) 42.118ms
Allocation Stall (http-nio-8080-exec-24) 39.882ms
GC(214) Major Collection (Allocation Rate) 3894M(95%)->1204M(29%)
```

A métrica de pausa continua exatamente como anunciada — genuinamente sub-milissegundo — enquanto requisições continuam bloqueadas mesmo assim, travadas na alocação em vez de paradas num safepoint. Um dashboard construído em torno da duração da pausa vai mostrar o ZGC como perfeito até o ponto exato em que o serviço fica inutilizável; o `jdk.ZAllocationStall` (um evento JFR desde o JDK 15) é o que realmente precisa ser monitorado.

### SoftMaxHeapSize

`-XX:SoftMaxHeapSize` diz ao ZGC para tentar ficar abaixo de um teto suave coletando de forma mais ávida, deixando o máximo rígido de `-Xmx` disponível para picos genuínos:

```
-XX:+UseZGC
-XX:+ZGenerational
-XX:SoftMaxHeapSize=2g
-Xmx4g
```

É uma ferramenta específica para containers: separa "o tamanho que eu quero em regime estável" de "o tamanho que eu posso alcançar antes de falhar", algo que um único `-Xmx` não consegue expressar. É exclusivo do ZGC — o G1 não tem flag equivalente.

## Trade-offs

- **O tempo de pausa do ZGC não escala com o tamanho do heap ou do conjunto vivo — mas isso não significa que o ZGC faz menos trabalho total, só que o custo saiu da pausa.** Um serviço limitado por CPU pode ver throughput *pior* sob ZGC mesmo com seu p99 melhorando, porque as threads de GC concorrentes competem com as threads de requisição pelos mesmos núcleos.
- **Monitorar só a duração da pausa é ativamente enganoso sob ZGC.** A métrica que revela o modo de falha real do ZGC é a contagem/duração de allocation stall, não a contagem de pausa — um serviço pode estar falhando enquanto todo dashboard baseado em pausa mostra verde.
- **Uma configuração de percentual de memória ou headroom de heap ajustada para o footprint do G1 não se transfere para o ZGC.** O ZGC mantém mais metadados e quer mais headroom para rodar seu ciclo concorrente confortavelmente; reutilizar um `-XX:MaxRAMPercentage` escolhido para o G1 pode faminar tudo que o ZGC precisa fora do heap, produzindo um OOM-kill do container que o próprio gráfico de heap da JVM nunca mostra como problema.
- **Livro vs hoje**: um livro de 2020 descrevendo o ZGC como "experimental" e comparando-o com o G1 para cargas de trabalho com alocação intensa está descrevendo o design pré-generacional. O ZGC generacional (padrão desde o JDK 23, JEP 474) fechou boa parte dessa lacuna específica — reavalie em vez de confiar num veredito pré-JDK-21.

## Documentation Links

- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [JEP 474: ZGC: Generational Mode by Default](https://openjdk.org/jeps/474) — doc
- [JEP 490: ZGC: Remove the Non-Generational Mode](https://openjdk.org/jeps/490) — doc
- [The Z Garbage Collector — HotSpot GC Tuning Guide, Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html) — doc
