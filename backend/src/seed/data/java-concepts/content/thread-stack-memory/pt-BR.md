---
version: 1.0
updatedAt: 2026-08-19
title: "Memória de Stack de Thread: Locais, Frames e Por Que Não É Compartilhada"
summary: Por que a stack de cada thread — suas variáveis locais, parâmetros e frames de chamada — é privada daquela thread e nunca é fonte de condições de corrida, enquanto referências armazenadas na stack ainda podem apontar para estado compartilhado e sujeito a corrida na heap.
---
## Objective

Toda thread recebe sua própria stack: uma região de memória usada para executar o código que ela roda. Cada chamada de método empilha um novo *stack frame* contendo as variáveis locais, os parâmetros do método e o endereço de retorno daquela chamada; o frame é desempilhado quando o método retorna. Uma variável local de tipo referência armazena apenas uma referência — um valor do tamanho de um ponteiro — enquanto o objeto para o qual ela aponta vive na heap, a única região compartilhada por todas as threads da JVM. Essa divisão é o motivo pelo qual a stack não precisa de nenhuma sincronização: nada nela é visível para outra thread, então não há nada sobre o que competir. Tudo que *é* compartilhado — objetos da heap, campos estáticos — vive fora da stack, que é exatamente onde condições de corrida se tornam possíveis. O tamanho da stack também é fixo por thread, no nível da JVM/SO (tipicamente entre 512KB e 1MB por padrão, ajustável com `-Xss`), motivo pelo qual recursão sem limite eventualmente falha com `StackOverflowError` em vez de crescer para sempre.

## Use Cases

- Explicar por que duas threads executando exatamente o mesmo método nunca corrompem as variáveis locais uma da outra, mesmo sem nenhum `synchronized` ou lock em lugar nenhum daquele método.
- Diagnosticar um `StackOverflowError` em um algoritmo recursivo (parsing de uma estrutura profundamente aninhada, uma travessia recursiva de árvore) e saber que a correção é limitar a profundidade da recursão ou aumentar `-Xss`, não adicionar sincronização.
- Raciocinar sobre por que uma condição de corrida só pode acontecer em estado da heap (campos de instância, campos estáticos, conteúdo de array/coleção) — nunca nas variáveis locais de um método, seus parâmetros, ou o endereço de retorno do frame.
- Dimensionar um pool de threads para platform threads: cada platform thread reserva memória de stack antecipadamente, então milhares delas podem esgotar o espaço de endereçamento ou a memória física bem antes da CPU se tornar o gargalo — um dos motivos pelos quais virtual threads existem (conceito irmão `thread-model-legacy-vs-virtual-threads`).
- Ler um stack trace e entender que ele é um retrato literal dos stack frames daquela thread no momento da exceção, com a chamada mais recente primeiro.

## Deep Dive

### Um stack frame: locais, parâmetros e a cadeia de chamadas

```java
public class FrameDemo {
    static int addOne(int n) {
        int result = n + 1; // local variable, lives in addOne's frame
        return result;
    }

    public static void main(String[] args) {
        int x = 41;          // local variable, lives in main's frame
        int y = addOne(x);   // pushes a new frame for addOne
        System.out.println(y); // 42
    }
}
```

Chamar `addOne` empilha um frame em cima do frame de `main`, contendo o parâmetro `n` e a local `result`. Quando `addOne` retorna, seu frame é desempilhado e suas locais deixam de existir — o frame de `main`, com `x` e `y`, não é afetado porque nunca compartilhou memória com o frame de `addOne`, para começo de conversa. Esse aninhamento é exatamente o que um stack trace mostra: `main` na base, o método atualmente em execução no topo.

### Referências vivem na stack, os objetos para os quais apontam vivem na heap

```java
class Counter {
    int value;
}

static void bump(Counter c) {
    Counter local = c;   // a new stack slot: a *copy* of the reference
    local.value++;        // dereferences into the heap — same object as c
}
```

`local` é uma referência residente na stack — um ponteiro pequeno e de tamanho fixo para um objeto `Counter`. Copiá-la para `local` copia o ponteiro, não o objeto: `local` e `c` são dois slots de stack separados (possivelmente nas stacks de duas threads diferentes) que por acaso apontam para o mesmo objeto na heap. Reatribuir `local` para apontar para outro lugar não afetaria `c` de forma alguma — mas mutar `local.value` muta a única instância de `Counter` para a qual ambas as referências apontam. Esse objeto `Counter` é a parte que vive na heap, é visível para toda thread que detém uma referência a ele, e é a parte que precisa de sincronização sob mutação concorrente (veja o conceito irmão `visibility-and-safe-publication`).

### Sem stack compartilhada, sem corrida sobre locais

```java
static long factorial(int n) {
    long acc = 1; // acc lives in *this call's* frame only
    for (int i = 2; i <= n; i++) {
        acc *= i;
    }
    return acc;
}

// two threads, same method, no coordination needed:
new Thread(() -> System.out.println(factorial(10))).start();
new Thread(() -> System.out.println(factorial(12))).start();
```

Ambas as threads executam o mesmo bytecode idêntico de `factorial`, mas cada uma recebe seu próprio frame com seu próprio `acc` e `i` — a JVM aloca uma stack por thread precisamente para que isso seja verdade. Não há memória compartilhada entre as duas chamadas, então não há nada para travar, nenhum entrelaçamento a considerar, e nenhuma possibilidade de o `acc` de uma thread corromper o da outra. Esse é o lado oposto da heap: um campo `static` ou de instância mutado da mesma forma *seria* compartilhado e *precisaria* de sincronização.

### Tamanho fixo de stack e `StackOverflowError`

```java
static long recurse(int n) {
    return n == 0 ? 0 : 1 + recurse(n - 1); // no way out for a huge n
}

recurse(1_000_000); // throws java.lang.StackOverflowError
```

Cada chamada recursiva empilha mais um frame; sem um caso base alcançado antes que a capacidade fixa da stack se esgote, a JVM lança `StackOverflowError` em vez de deixar uma thread crescer sua stack indefinidamente e sufocar o espaço de endereçamento do resto do processo. O tamanho padrão de stack por thread depende da JVM/SO — comumente algumas centenas de KB a alguns MB — e pode ser alterado para o processo inteiro com a flag `-Xss<tamanho>` da JVM, ou por thread via o construtor `Thread(ThreadGroup, Runnable, String, long stackSize)`. Aumentá-lo adia o erro para uma dada profundidade de recursão; não remove o trade-off subjacente de tamanho fixo. Virtual threads (JEP 444) contornam isso de forma diferente: suas stacks começam minúsculas e crescem/encolhem na heap conforme necessário, o que é parte do motivo pelo qual a JVM consegue rodar milhões delas onde só conseguiria rodar milhares de platform threads.

## Trade-offs

- **Nenhuma sincronização necessária para locais — mas também nenhum compartilhamento.** As variáveis locais e os parâmetros de um método são invisíveis para toda outra thread por construção, o que é exatamente o motivo de não precisarem de lock; o mesmo isolamento significa que você não pode usar uma variável local para passar dados entre threads — só uma referência na heap (um campo, uma fila, uma variável capturada por um `Runnable`) atravessa essa fronteira.
- **O tamanho da stack é fixo, então a profundidade de recursão é limitada.** Um método recursivo com aparência correta ainda pode falhar em produção assim que as entradas ficam profundas o suficiente.
  ```java
  static long recurse(int n) {
      return n == 0 ? 0 : 1 + recurse(n - 1);
  }
  // recurse(50) succeeds, recurse(1_000_000) throws StackOverflowError
  ```
- **A stack de cada platform thread é memória comprometida antecipadamente.** Milhares de platform threads, cada uma reservando ~1MB de stack, somam pressão real de memória independente de quanto trabalho de CPU elas estão de fato fazendo — um motivo importante para preferir pools de threads em vez de criação irrestrita de threads, ou virtual threads quando a carga de trabalho é limitada por I/O e altamente concorrente.
- **Copiar uma referência não copia o objeto.** É fácil supor que passar um objeto "protege" ele de mutação concorrente porque a própria referência foi copiada para um novo stack frame — mas toda cópia ainda aponta para o mesmo objeto compartilhado na heap, que é onde o trabalho real de thread-safety precisa acontecer.

## Documentation Links

- [Chapter 2.5.2: Java Virtual Machine Stacks — JVM Specification (SE 25)](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.5.2) — doc
- [StackOverflowError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StackOverflowError.html) — doc
- [java — the `-Xss` option — Java SE Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
- [Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
