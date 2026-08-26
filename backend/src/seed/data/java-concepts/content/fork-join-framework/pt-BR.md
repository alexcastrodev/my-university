---
version: 1.0
updatedAt: 2026-08-13
title: O Fork/Join Framework
summary: Um motor de divisão-e-conquista para paralelismo real em múltiplos núcleos, onde um ForkJoinPool executa RecursiveAction/RecursiveTask divididos recursivamente via work-stealing.
---
## Objective

O Fork/Join Framework (`java.util.concurrent`, adicionado no JDK 7) é o motor do Java para execução verdadeiramente paralela em múltiplos núcleos de CPU, construído em torno de uma estratégia recursiva de divisão-e-conquista: uma task se divide em subtasks menores, essas subtasks rodam concorrentemente (e se dividem ainda mais se ainda estiverem grandes demais), e os resultados se combinam de volta. É um problema diferente da multithreading clássica — uma `Thread` em uma única CPU deixa uma task rodar enquanto outra espera por I/O ou entrada do usuário, compartilhando um núcleo ao longo do tempo; Fork/Join, em vez disso, precisa de dois ou mais núcleos realmente disponíveis para valer a pena, porque todo o seu propósito é rodar pedaços da mesma computação simultaneamente. Um `ForkJoinPool` gerencia um pequeno número de worker threads que executam um número potencialmente grande de `ForkJoinTask`s leves, usando work-stealing para manter todo núcleo ocupado.

## Use Cases

- Transformar, ordenar ou buscar em um grande array ou coleção em memória dividindo-o em metades (ou pedaços menores) e processando cada pedaço em seu próprio núcleo.
- Qualquer algoritmo recursivo de divisão-e-conquista — merge sort, multiplicação de matrizes, travessia de árvore/grafo — onde os subproblemas são naturalmente independentes.
- O próprio mecanismo sobre o qual `parallelStream()` é construído: streams paralelos submetem seu trabalho ao `ForkJoinPool` comum em vez de implementar seu próprio gerenciamento de threads.
- Disparar trabalho CPU-bound de forma assíncrona com `execute()` quando a thread chamadora tem seu próprio trabalho para continuar fazendo, em vez de bloquear em `invoke()`.
- Trabalho que precisa de cancelamento ou checagem de status de conclusão (`cancel()`, `isCompletedAbnormally()`) além do que um `Runnable`/`Callable` comum submetido a um `ExecutorService` expõe.

## Deep Dive

### Divisão-e-conquista e work-stealing

O padrão é: continue dividindo uma task ao meio até que o pedaço restante seja pequeno o suficiente para simplesmente ser computado diretamente (o *limiar sequencial*), então deixe os pedaços rodarem concorrentemente e combine seus resultados. É por isso que as duas classes que você de fato estende se chamam `RecursiveAction` e `RecursiveTask<V>` — recursão é o mecanismo, não apenas uma escolha de estilo.

`ForkJoinPool` executa isso de forma eficiente através de **work-stealing**: toda worker thread mantém sua própria fila de tasks, e sempre que a fila de uma thread esvazia, ela rouba uma task da fila de outra thread em vez de ficar ociosa. Isso importa mais quando as subtasks têm tamanhos desiguais — um thread pool de tamanho fixo que distribui pedaços de tamanho igual antecipadamente não tem como se rebalancear se um pedaço acaba sendo mais barato que outro, enquanto work-stealing mantém todo núcleo alimentado independentemente disso.

### As classes centrais

```
ForkJoinTask<V>       an abstract class that defines a task
ForkJoinPool          manages the execution of ForkJoinTasks
RecursiveAction        a subclass of ForkJoinTask<V> for tasks that do not return values
RecursiveTask<V>       a subclass of ForkJoinTask<V> for tasks that return values
```

`ForkJoinTask<V>` representa uma *task* leve, não uma thread de execução — um `ForkJoinPool` pode gerenciar muito mais tasks do que threads worker reais que ele possui. Seus métodos centrais:

```java
final ForkJoinTask<V> fork()   // schedules this task for async execution; caller keeps running
final V join()                  // blocks until this task finishes, then returns its result
final V invoke()                // fork + join in one call: start the task and wait for it
static void invokeAll(ForkJoinTask<?>... taskList)  // run several tasks, wait for all of them
```

Você estende `RecursiveAction` quando a task não produz resultado e sobrescreve `protected abstract void compute()`; você estende `RecursiveTask<V>` quando ela produz um `V` e sobrescreve `protected abstract V compute()`. De qualquer forma, `compute()` é onde vive a lógica de divisão-e-conquista — e a checagem do limiar.

### RecursiveAction: dividir até ficar pequeno, depois só computar

Este exemplo (adaptado do `SqrtTransform` do livro) transforma cada elemento de um `double[]` em sua raiz quadrada in place, dividindo o array ao meio em cada nível até que um pedaço fique abaixo de `seqThreshold`:

```java
class SqrtTransform extends RecursiveAction {
    // Threshold is arbitrary here; in real code it's tuned by profiling.
    final int seqThreshold = 1000;

    double[] data;
    int start, end;

    SqrtTransform(double[] vals, int s, int e) {
        data = vals;
        start = s;
        end = e;
    }

    protected void compute() {
        if ((end - start) < seqThreshold) {
            // Small enough: just do the work sequentially.
            for (int i = start; i < end; i++) {
                data[i] = Math.sqrt(data[i]);
            }
        } else {
            // Still too big: split in half and run both halves,
            // waiting for both to finish before this call returns.
            int middle = (start + end) / 2;
            invokeAll(new SqrtTransform(data, start, middle),
                      new SqrtTransform(data, middle, end));
        }
    }
}

ForkJoinPool fjp = new ForkJoinPool();
double[] nums = new double[100_000];
for (int i = 0; i < nums.length; i++) nums[i] = (double) i;

SqrtTransform task = new SqrtTransform(nums, 0, nums.length);
fjp.invoke(task);   // blocks until the whole tree of subtasks completes
```

`invokeAll` aqui faz o fork *e* a espera por ambas as metades em uma única chamada — conveniente para o caso "sem resultado", onde não há nada para agregar.

### RecursiveTask<V>: retornando e agregando um resultado

Quando subtasks retornam valores, você tipicamente chama `fork()` em cada uma explicitamente, depois `join()` em cada uma para coletar e combinar os resultados você mesmo, em vez de confiar em `invokeAll()`. Este exemplo soma um `double[]`:

```java
class Sum extends RecursiveTask<Double> {
    final int seqThreshold = 500;
    double[] data;
    int start, end;

    Sum(double[] vals, int s, int e) {
        data = vals;
        start = s;
        end = e;
    }

    protected Double compute() {
        double sum = 0;
        if ((end - start) < seqThreshold) {
            for (int i = start; i < end; i++) sum += data[i];
        } else {
            int middle = (start + end) / 2;
            Sum subTaskA = new Sum(data, start, middle);
            Sum subTaskB = new Sum(data, middle, end);

            // Start both subtasks asynchronously...
            subTaskA.fork();
            subTaskB.fork();

            // ...then wait for each and combine their results.
            sum = subTaskA.join() + subTaskB.join();
        }
        return sum;
    }
}

ForkJoinPool fjp = new ForkJoinPool();
double[] nums = new double[5000];
for (int i = 0; i < nums.length; i++) nums[i] = (i % 2 == 0) ? i : -i;

Sum task = new Sum(nums, 0, nums.length);
double summation = fjp.invoke(task);   // invoke() returns the task's result here
```

Duas outras formas válidas de rodar o par: `subTaskA.fork(); sum = subTaskB.invoke() + subTaskA.join();` (iniciar A assincronamente, rodar B na thread atual), ou até fazer B chamar `compute()` diretamente em vez de `fork()`/`join()` de forma alguma — útil quando B é barato o suficiente para que iniciar agendamento assíncrono para ela não valha a pena.

### O common pool: geralmente nenhum pool para construir

Desde o JDK 8, você raramente precisa de `new ForkJoinPool()` você mesmo. `ForkJoinPool.commonPool()` retorna um pool estático e compartilhado que fica automaticamente disponível, e chamar `fork()`, `invoke()`, ou `invokeAll()` em uma task *fora* do contexto computacional de qualquer pool automaticamente a roteia através do common pool:

```java
SqrtTransform task = new SqrtTransform(nums, 0, nums.length);
task.invoke();   // no ForkJoinPool variable needed — runs on the common pool
```

Esse é também o mecanismo do qual `parallelStream()` depende: um pipeline de stream paralelo submete seu trabalho de divisão-e-combinação ao `ForkJoinPool.commonPool()` em vez de manter seu próprio pool de worker threads.

### Execução assíncrona, cancelamento e status de conclusão

`invoke()` bloqueia a thread chamadora até a task terminar. Para iniciar uma task e deixar a thread chamadora continuar, use `ForkJoinPool.execute()` em vez disso:

```java
void execute(ForkJoinTask<?> task)
void execute(Runnable task)   // bridges traditional Runnable-based code into the pool
```

Como as worker threads de um `ForkJoinPool` são daemon threads, um programa cuja thread principal sai antes de uma task iniciada com `execute()` terminar vai encerrar sem que essa task jamais termine.

Uma task em execução pode ser cancelada a partir de código externo (uma task não precisa se cancelar sozinha — ela pode simplesmente retornar):

```java
boolean cancel(boolean interruptOK)  // true if this call cancelled the task
boolean isCancelled()                 // true if cancelled before completion
```

e seu resultado checado depois com `isCompletedNormally()` (terminou, sem exceção, não cancelada) ou `isCompletedAbnormally()` (cancelada ou lançou exceção). Uma task terminada normalmente geralmente não pode rodar de novo, mas `reinitialize()` reseta seu estado interno para que possa ser resubmetida — embora quaisquer efeitos colaterais que ela já tenha causado em dados compartilhados (como o array que modificou) não sejam desfeitos.

## Trade-offs

- **O tamanho do limiar é um knob de ajuste real, não uma formalidade.** Baixo demais, e o pool gasta mais tempo criando e agendando tasks do que fazendo trabalho de verdade; alto demais, e não há pedaços independentes suficientes para manter todo núcleo ocupado. A regra prática da documentação da API `ForkJoinTask` é algo entre 100 e 10.000 passos computacionais por task — mas o valor certo ainda depende de fazer profiling da carga de trabalho real, e errar para cima é mais seguro do que errar para baixo.
- **Work-stealing compensa mais com subtasks de tamanhos desiguais.** Um thread pool de tamanho fixo que distribui pedaços de tamanho igual antecipadamente não tem como se rebalancear quando um pedaço acaba sendo mais barato que outro; os workers ociosos de um `ForkJoinPool` roubam dos ocupados em vez de ficar parados.
- **Fork/Join precisa de múltiplos núcleos para valer a pena.** Em uma máquina com uma única CPU não há execução paralela a ganhar — multithreading tradicional baseada em `Thread` (esconder latência de I/O/entrada) é um problema diferente com uma solução diferente, e Fork/Join não a substitui.
- **Uma `ForkJoinTask` deve evitar I/O bloqueante e sincronização externa.** Métodos `compute()` que usam blocos `synchronized`, esperam por I/O, ou de outra forma bloqueiam seguram uma worker thread que o pool espera que continue ocupada computando, o que anula as premissas de eficiência do pool.
- **Streams paralelos rodam no common pool compartilhado — a contenção também é compartilhada.** Como `parallelStream()` submete ao `ForkJoinPool.commonPool()` por padrão, uma task de bloqueio longo ou intensa em I/O colocada dentro de um pipeline de stream paralelo pode faminizar *outro* código não relacionado em algum lugar da mesma JVM que também depende do common pool para seu próprio trabalho paralelo.

## Documentation Links

- [ForkJoinPool — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html) — doc
- [ForkJoinTask — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinTask.html) — doc
- [RecursiveAction — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveAction.html) — doc
- [RecursiveTask — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveTask.html) — doc
- [Fork/Join — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/concurrency/forkjoin.html) — doc
