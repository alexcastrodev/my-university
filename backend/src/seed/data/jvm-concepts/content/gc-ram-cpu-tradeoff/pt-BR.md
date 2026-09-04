---
version: 1.0
updatedAt: 2026-09-04
---
## Objective

Entender por que os coletores geracionais e de compactação da JVM nunca de fato "liberam" um objeto como `malloc`/`free` ou um GC de contagem de referências fazem — eles compactam os objetos ainda alcançáveis e simplesmente deixam o resto para trás — e por que esse design troca RAM por CPU de propósito. A JVM precisa de um gerenciador de memória porque a abstração da própria SO, memória virtual, é vazada: ela não sabe onde suas referências vivem, então não pode reciclar memória por você.

## Use Cases

- Diagnosticar por que o custo de CPU do GC de um serviço subiu — e distinguir "a taxa de alocação aumentou" de "o headroom do heap encolheu", que pedem correções diferentes.
- Justificar um headroom generoso de heap para um cache em memória usando a fórmula de custo geracional em vez de um palpite sobre o que "parece" desperdício.
- Explicar com precisão por que um coletor de compactação "não tem `free()`" em uma entrevista de performance/system-design, em vez de um vago "GC é lento".
- Reconhecer quando uma afirmação sobre o comportamento do GC pertence a um coletor *específico* (Parallel, G1, ZGC) versus ao design geracional/de compactação compartilhado que todos eles usam como base.

## Deep Dive

### Quatro formas de gerenciar memória de heap, quatro formatos de custo diferentes

Todo programa não trivial precisa reciclar memória de heap, e a estratégia usada para isso determina o que você paga por ela:

```
manual (malloc/free — C, Zig)
  footprint == live set (o mínimo possível)
  custo de CPU  ∝ taxa de alocação   (toda alocação é eventualmente casada com um free)

contagem de referências (Swift, CPython, C++ shared_ptr, Rust Rc)
  footprint == live set (também o mínimo — objetos morrem no instante em que ficam inalcançáveis)
  custo de CPU  ∝ taxa de alocação   (mesmo formato do manual: um "malloc e free" por objeto,
                                       mais overhead de atualização de contador, pior entre threads)

arena / bump allocation, sem coletor (ergonômico em Zig; incômodo em C, Rust, C++)
  footprint == capacidade da arena, liberada de uma vez quando a arena/escopo termina
  custo de CPU  ≈ quase zero por alocação, mas nada é reciclado individualmente antes disso

GC de compactação / geracional (todo coletor da JDK)
  footprint == live set + headroom de heap H
  custo de CPU  ∝ (live set × taxa de alocação) / H     onde H = capacidade do heap − live set
```

As duas primeiras estratégias otimizam para o menor footprint possível e pagam isso em CPU: dobre a taxa de alocação e você dobra a CPU gasta gerenciando memória, ponto final — não há um botão para reverter isso além de alocar menos. (`Box` do Rust e `unique_ptr` do C++ contornam o contador de referências inteiramente para valores com exatamente um dono, e alguns compiladores conseguem provar que um contador é desnecessário e removê-lo — mas o formato do custo não muda para nada que *seja* compartilhado.) Uma arena contorna a contabilidade por objeto por completo, reciclando tudo de uma vez, ao custo de nunca reciclar um objeto individual de vida longa antes da hora. Um coletor de compactação aceita um footprint maior que qualquer um desses de propósito, porque esse headroom extra `H` fica no denominador do seu custo — e headroom é um botão que você controla diretamente com `-Xmx`.

### O que um coletor de compactação de fato faz durante um ciclo de coleta

Um coletor de compactação nunca inspeciona um objeto morto — ele simplesmente não o vê. Um ciclo de coleta tem duas fases: **mark** (percorrer a partir das raízes — locais, campos estáticos — para encontrar todo objeto ainda alcançável) e **compact** (copiar esses objetos vivos para o início do heap, e então continuar alocando por bump-pointer a partir dali). Tudo que não foi alcançado pela fase de mark simplesmente fica para trás quando os objetos vivos são copiados; não existe uma etapa de "identificar o lixo e reciclá-lo" como `free()` ou um contador de referências chegando a zero implicam:

```
antes do GC:  [ vivo ][ morto ][ vivo ][ morto ][ morto ][ vivo ][ ... espaço livre ... ]
depois do GC: [ vivo ][ vivo ][ vivo ][ ......... espaço livre, aloque por bump-pointer aqui ......... ]
```

É por isso que dobrar a taxa de alocação e dobrar o headroom do `-Xmx` se cancelam: o numerador da fórmula de custo (live set × taxa de alocação) dobrou, mas o denominador (`H`) também, então a CPU gasta por ciclo de coleta permanece a mesma — você apenas recomprou o throughput com RAM em vez de com menos lixo.

### Coleta geracional: transformando multiplicação em soma

A fórmula acima ainda tem uma propriedade incômoda: o custo cresce também com o tamanho do live set, o que é uma má notícia para qualquer coisa que queira manter muitos dados em cache na RAM. A coleta geracional resolve isso dividindo o heap em duas partes e explorando a **hipótese geracional fraca**: a maioria dos objetos morre jovem:

```
geração jovem (pequena)        geração antiga (grande)
  live set ≈ pequeno (ε_y)       taxa de alocação ≈ baixa (ε_o)
  coletada com frequência         coletada raramente
       │  sobrevive a alguns ciclos →  promovido
       └──────────────────────────────────────►
```

Uma **write barrier** registra sempre que uma mutação grava uma referência jovem dentro de um objeto antigo, de modo que uma coleta jovem possa tratar o (pequeno) conjunto registrado mais as raízes de costume como seus pontos de partida, em vez de re-escanear toda a geração antiga a cada minor GC. Com essa divisão, a fórmula de custo passa de multiplicativa para aditiva:

```
custo ≈ (liveSet_jovem × taxaAlocação_jovem) / H_jovem   +   (liveSet_antigo × taxaAlocação_antigo) / H_antigo
          └── liveSet_jovem é minúsculo (ε) ──┘                └── taxaAlocação_antigo é minúsculo (ε) ──┘
```

Dobrar a *taxa de alocação* ainda dobra o custo (como deve acontecer com qualquer estratégia) — mas dobrar o *live set* (por exemplo, aumentando um cache em memória) quase não move o ponteiro, porque esse crescimento aterrissa quase inteiramente na geração antiga, onde o que é pequeno é a taxa de alocação, não o live set. Esse é o mecanismo que torna barato manter um cache maior residente, ao contrário do `malloc`/`free` ou da contagem de referências, onde o custo acompanha a taxa de alocação independentemente do que você está cacheando.

Isso também explica por que um cache em memória é a exceção a um padrão que, fora isso, se mantém: para dados normais de programa, uma carga de trabalho com menos CPU costuma significar tanto uma taxa de alocação menor quanto um live set menor, porque ler mais dados exige mais processamento. Um cache quebra essa relação — ele é computacionalmente inerte, apenas fica ali esperando ser lido — então seu live set não encolhe junto com o uso de CPU do jeito que o resto encolhe. O headroom da geração antiga do GC geracional é exatamente o que torna acessível carregar esse live set inerte.

Uma ressalva honesta sobre a própria fórmula: ela parece prever um custo de CPU infinito conforme o headroom `H` se aproxima de zero, o que parece alarmante mas é só um artefato de assumir uma taxa de alocação constante. Na realidade, conforme o GC consome mais e mais CPU, o programa fica com menos ciclos sobrando para alocar, então a própria taxa de alocação cai antes que a singularidade da fórmula seja de fato alcançada. Trate-a como um modelo útil de primeira ordem da troca, não como uma lei física.

### Escalando núcleos sem escalar o heap

Um padrão concreto torna a fórmula tangível: adicione threads ou núcleos a uma carga de trabalho, e a taxa de alocação sobe junto — se o `-Xmx` ficar fixo, a atividade de GC sobe bastante junto com ela, já que o denominador `H` não se mexeu enquanto o numerador se mexeu. Adicione cerca de 100 MB de heap extra por núcleo adicionado, porém — bem menos que o >1 GB por núcleo que o hardware por trás já disponibiliza — e a sobrecarga de GC volta a estabilizar, aproximando-se de uma linha de base manual ou de contagem de referências. Mais núcleos adicionam taxa de alocação independente do live set (exatamente o termo ε da geração antiga visto acima), então escalar o headroom junto com a contagem de núcleos é o que mantém a proporção da fórmula — e, portanto, a fatia de CPU do GC — mais ou menos constante.

## Trade-offs

- **GC de compactação/geracional troca RAM por CPU de propósito — esse é todo o design.** Mais headroom de heap é uma alavanca direta e mecânica sobre a fórmula de custo acima, não um vago "jogar hardware no problema":
  ```
  mesmo live set de 200 MB, mesma taxa de alocação:
    malloc/free ou contagem de referências   footprint ≈ 200 MB      CPU: paga malloc+free por objeto, fixo
    GC de compactação geracional              footprint ≈ 200 MB + H  CPU: cai conforme H cresce — um botão, não um fato
  ```
  Se essa troca costuma ser a economicamente correta dado o preço real de hardware é uma pergunta separada — veja [Sizing the JVM Heap: RAM/CPU Economics in Practice](/jvm-concepts/heap-sizing-economics).
- **Passar um ponteiro de objeto cru pela fronteira de FFI é mais difícil com um coletor de compactação**, já que um ciclo de GC pode realocar o objeto no meio da chamada — uma razão real pela qual linguagens de baixo nível e embarcadas historicamente se apoiaram em gerenciamento manual de memória, mesmo custando mais CPU. É também por isso que a [Foreign Function and Memory API](/java-concepts/foreign-function-and-memory-api) precisa fixar (pin) ou copiar a memória que entrega para código nativo, em vez de passar uma referência Java crua para o outro lado.
- **Um coletor de compactação/geracional de nível de produção é um investimento de engenharia de escala de uma década**, motivo pelo qual só as runtimes com mais recursos têm um (a JDK, o CLR do .NET, o V8). Uma linguagem com um time menor e sem um desses tem uma alavanca real, porém menor, disponível: alocar mais agressivamente na stack para baixar a taxa de alocação logo de cara — que é o que o Go faz. Isso só encolhe o numerador da fórmula, porém; não muda o formato de custo subjacente do jeito que o denominador de headroom de um coletor de compactação muda.
- **As futuras value classes do Java (Project Valhalla) costumam ser vistas como uma otimização de alocação em stack para reduzir pressão de GC — não são.** A motivação principal delas é o *layout* no heap: achatar os campos de um objeto dentro de seu container em vez de guardar um ponteiro para uma instância alocada separadamente, o que remove uma indireção de ponteiro e um header por objeto, independentemente de onde o objeto acabe vivendo.
- **Todo esse cálculo assume que a stack continua sendo uma fatia pequena de memória perto do heap** — verdade para uma contagem normal de threads, mas virtual threads podem existir às centenas de milhares, cada uma com sua própria stack. Se isso muda de forma relevante a troca RAM/CPU está fora do escopo deste conceito, mas vale não assumir que memória de stack é sempre desprezível.
- **Coletores totalmente concorrentes de nível de produção, sem pausas stop-the-world, são tecnologia bem nova.** O primeiro a rodar em hardware comum foi o da Zing, lançado em 2010 mas proprietário; o primeiro de código aberto, o Generational ZGC, só foi lançado na JDK 21 (2023, [JEP 439](https://openjdk.org/jeps/439)). Uma reclamação sobre pausas do Java baseada em experiência bem mais antiga provavelmente é anterior ao coletor que resolveu exatamente essa reclamação.

## Documentation Links

- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html) — doc
- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [Andrew W. Appel, "Garbage Collection Can Be Faster Than Stack Allocation", Information Processing Letters 25(4), 1987](https://www.cs.princeton.edu/~appel/papers/45.pdf) — doc
