---
version: 1.0
updatedAt: 2026-08-13
title: "Coleções Concorrentes: Por Que Thread-Safe Não Basta, e o Que o ConcurrentHashMap Faz Diferente"
summary: "Por que uma ação composta construída a partir de chamadas thread-safe numa coleção sincronizada ainda pode ter race condition, e como ConcurrentHashMap e CopyOnWriteArrayList resolvem isso com iteração fracamente consistente e métodos de ação composta atômicos em vez disso."
---
## Objective

`Collections.synchronizedList`/`synchronizedMap` e os clássicos `Vector`/`Hashtable`
tornam thread-safe cada chamada de método *individual* envolvendo-a num lock sobre a
própria coleção. Essa garantia para na fronteira do método: uma **ação composta**
— duas ou mais chamadas que juntas precisam se comportar como uma única operação,
como "colocar um valor só se a chave estiver ausente" ou "iterar todo elemento" —
não se torna atômica só porque cada chamada dentro dela é. Este conceito cobre onde
essa lacuna morde (ações compostas, e iterators atrapalhados por modificação
concorrente, incluindo através de iteração "escondida" que você não vê no ponto de
chamada), e como `ConcurrentHashMap` e `CopyOnWriteArrayList` fecham essa lacuna
com um design diferente em vez de pedir para quem chama adicionar mais locking.

## Use Cases

- Implementar lógica "get or create" / "put if absent" num cache ou registro
  compartilhado — session stores, connection pools, lookups memoizados — sem uma
  race de atualização perdida entre a checagem e a escrita.
- Iterar uma coleção compartilhada (explicitamente, ou implicitamente via
  `toString()`, logging, `equals()`/`hashCode()`, ou `containsAll`) enquanto outra
  thread pode estar adicionando ou removendo elementos, sem risco de
  `ConcurrentModificationException`.
- Escolher `ConcurrentHashMap` em vez de um `HashMap` envolto por `synchronizedMap`
  para qualquer map que muitas threads leem e escrevem concorrentemente — caches,
  contadores, tabelas de lookup compartilhadas.
- Manter uma lista de listener/observer que é disparada (iterada) constantemente
  mas registrada/desregistrada raramente — o ponto forte do `CopyOnWriteArrayList`.

## Deep Dive

### 1. A armadilha da ação composta

`Collections.synchronizedMap` faz lock no map a cada chamada individual, então
`containsKey`, `get` e `put` são cada uma segura isoladamente. Encadear várias
delas para expressar "buscar ou criar" não é:

```java
Map<String, Session> sessions = Collections.synchronizedMap(new HashMap<>());

static Session getOrCreateSession(String userId) {
    if (!sessions.containsKey(userId)) {     // call #1 — safe on its own
        sessions.put(userId, new Session(userId)); // call #2 — safe on its own
    }
    return sessions.get(userId);             // call #3 — safe on its own
}
```

Cada chamada segura o lock do map só pela sua própria duração, depois o libera.
Se as threads A e B chamam ambas `getOrCreateSession("alice")` e suas chamadas se
intercalam entre `containsKey` e `put`, ambas veem que não há entrada existente,
ambas constroem uma nova `Session`, e ambas chamam `put` — o segundo `put`
silenciosamente descarta a primeira `Session`. Se o construtor de `Session` tiver
um efeito colateral (abre um socket, incrementa um contador, envia um evento de
boas-vindas), esse efeito colateral agora roda duas vezes para o que quem chamou
esperava ser uma criação única por usuário.

A correção a partir do design do wrapper sincronizado é o **locking do lado do
cliente**: adquirir o mesmo lock que o wrapper usa — a própria instância do wrapper
— em volta da ação composta inteira, não só cada chamada individual:

```java
static Session getOrCreateSession(String userId) {
    synchronized (sessions) {               // the exact lock synchronizedMap guards each call with
        Session s = sessions.get(userId);
        if (s == null) {
            s = new Session(userId);
            sessions.put(userId, s);
        }
        return s;
    }
}
```

Isso só funciona porque `Collections.synchronizedMap`/`synchronizedList` documentam
qual lock protege a coleção (o próprio objeto wrapper retornado) — essa política
documentada é exatamente o que torna possível o locking do lado do cliente. Também
significa que todo outro acesso sincronizado precisa passar por chamadas que usam o
*mesmo* lock, ou o bloco `synchronized` extra não realiza nada.

### 2. Iterators escondidos e ConcurrentModificationException

Iterar um `synchronizedList`/`synchronizedMap` ainda precisa do mesmo lock do lado
do cliente, porque os iterators fail-fast que essas coleções retornam detectam
mudanças estruturais concorrentes e lançam `ConcurrentModificationException` — o
lock precisa ser segurado pela iteração *inteira*, não só a cada chamada de
`next()`:

```java
List<String> names = Collections.synchronizedList(new ArrayList<>());

synchronized (names) {
    for (String n : names) {   // holding the lock for the whole loop prevents CME
        process(n);
    }
}
```

A armadilha é que a iteração muitas vezes é invisível no ponto de chamada.
Concatenação de strings, logging, `toString()`, `equals()`/`hashCode()`, e métodos
como `containsAll`/`removeAll`/`retainAll` todos iteram a coleção internamente:

```java
public class SessionRegistry {
    private final Set<String> activeUsers = Collections.synchronizedSet(new HashSet<>());

    public void login(String userId)  { activeUsers.add(userId); }
    public void logout(String userId) { activeUsers.remove(userId); }

    public void logSnapshot() {
        // no explicit loop anywhere in this method...
        log.info("Active users: " + activeUsers); // ...but string concatenation calls
    }                                              // activeUsers.toString(), which iterates it
}
```

Se `login`/`logout` rodarem em outra thread enquanto `logSnapshot` está no meio de
`toString()`, a chamada pode lançar `ConcurrentModificationException` de dentro do
que parece uma linha de log simples, sem nenhum loop `for` à vista. Quanto mais
longe um pedaço de estado estiver do código que sincroniza sobre ele, mais fácil é
alcançar esse estado através de uma iteração que ninguém lembrou de proteger.

### 3. ConcurrentHashMap: iteração fracamente consistente, ações compostas atômicas

Os iterators do `ConcurrentHashMap` são **weakly consistent** (fracamente
consistentes), não fail-fast: eles nunca lançam `ConcurrentModificationException`,
refletem o estado do map em algum ponto no momento ou depois de o iterator ter sido
criado, e `get`/leituras em geral nunca bloqueiam, mesmo enquanto outras threads
estão escrevendo.

```java
ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

for (String userId : sessions.keySet()) {   // safe even if another thread adds/removes
    log.info(userId);                        // concurrently — never throws CME
}
```

Como um `ConcurrentHashMap` deliberadamente não pode ser travado para acesso
exclusivo da forma que `synchronizedMap` pode, o locking do lado do cliente não é
uma opção para construir novas ações compostas sobre ele — então, em vez disso, ele
expõe as ações compostas comuns como métodos atômicos únicos na interface
`ConcurrentMap`, mais os métodos default que `Map` ganhou no Java 8:

```java
ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

// "get or create" as one atomic call — no external lock needed
Session s = sessions.computeIfAbsent(userId, id -> new Session(id));

sessions.putIfAbsent(userId, new Session(userId));      // insert only if absent
sessions.replace(userId, oldSession, newSession);       // replace only if still == oldSession
sessions.remove(userId, staleSession);                  // remove only if still == staleSession
sessions.compute(userId, (id, s2) -> s2 == null ? new Session(id) : s2.touch());
sessions.merge(userId, freshSession, (old, incoming) -> old.mergeWith(incoming));
```

`putIfAbsent` por si só antecede `computeIfAbsent`/`compute`/`merge`, que foram
adicionados no Java 8 como métodos default de `Map` e são implementados pelas
próprias implementações atômicas do `ConcurrentHashMap`, em vez de um default que
faz lock em volta de duas chamadas.

Internamente, a estratégia de locking mudou desde que a classe foi introduzida. Em
vez de um conjunto fixo de segmentos travados separadamente, os JDKs atuais
espalham entradas por muitos bins endereçáveis independentemente numa única
tabela: inserir num bin vazio é feito com um CAS livre de lock, e só um bin que já
tem uma entrada colidindo faz lock — restrito ao nó de cabeça daquele bin, não a
tabela inteira ou um segmento fixo — enquanto há disputa. É por isso que
arbitrariamente muitos leitores podem prosseguir concorrentemente com escritores e
uns com os outros, e por que o nível de concorrência escala com a própria tabela em
vez de um número fixo de faixas. Uma consequência desse design permanece
inalterada: métodos agregados como `size()` e `isEmpty()` só conseguem retornar uma
estimativa sob modificação concorrente, já que quando a contagem é calculada ela já
pode estar desatualizada; `mappingCount()` retorna o mesmo tipo de estimativa como
`long`, para maps grandes demais para o resultado `int` de `size()`.

### 4. CopyOnWriteArrayList: leituras nunca bloqueiam, escritas copiam tudo

`CopyOnWriteArrayList` faz o trade-off oposto ao `ConcurrentHashMap`: toda mutação
(`add`, `remove`, `set`) copia o array de apoio *inteiro*, publica o novo array, e
deixa qualquer iteração em andamento intocada porque ela ainda está olhando para o
array antigo. Iterators nunca lançam `ConcurrentModificationException` e nunca
precisam de um lock, porque estão lendo um snapshot que, por construção, não pode
mudar por baixo deles:

```java
private final List<PropertyChangeListener> listeners = new CopyOnWriteArrayList<>();

void addListener(PropertyChangeListener l) { listeners.add(l); } // copies the whole array

void fireChange(PropertyChangeEvent e) {
    for (PropertyChangeListener l : listeners) { // iterates a stable snapshot — never blocks,
        l.propertyChange(e);                      // never throws CME, even if another thread
    }                                              // registers/unregisters a listener right now
}
```

Essa é exatamente a forma de uma lista de listener/observer: registro e
desregistro são raros, disparar um evento para todo listener acontece
constantemente, e nenhum callback de listener deveria conseguir disparar
`ConcurrentModificationException` só porque ele adiciona outro listener no meio da
notificação.

## Trade-offs

- **Uma coleção thread-safe não torna uma ação composta thread-safe** — toda
  chamada individual de `containsKey`/`get`/`put` num `synchronizedMap` é segura,
  mas uma sequência "checar, depois agir" construída a partir delas ainda pode ter
  race condition, a menos que a sequência inteira esteja envolta em `synchronized`
  sobre o mesmo lock que o wrapper já usa.
  ```java
  if (!map.containsKey(k)) map.put(k, v); // two safe calls, one unsafe combination
  ```
- **A iteração é fácil de disparar por acidente** — `toString()`, logar uma
  coleção, `equals()`/`hashCode()`, e operações em bloco como `containsAll` todas
  iteram internamente, então `ConcurrentModificationException` pode aparecer em
  código sem nenhum loop visível. A correção é o mesmo lock do lado do cliente,
  só aplicado em algum lugar menos óbvio.
- **`ConcurrentHashMap` troca locking exclusivo por escalabilidade** — ele não tem
  equivalente para travar o map inteiro para uma operação atômica de múltiplos
  passos da forma que `Hashtable`/`synchronizedMap` permitem; se uma aplicação
  genuinamente precisa congelar o map inteiro para várias operações em sequência,
  `ConcurrentHashMap` não pode ser um substituto direto para esse caso específico,
  mesmo que geralmente seja para tudo mais.
- **Iteração fracamente consistente não é a mesma garantia que um snapshot forte**
  — um iterator de `ConcurrentHashMap` pode ou não refletir uma mudança feita
  depois de ele ter sido criado, então código que depende de ver (ou não ver) uma
  atualização concorrente durante a iteração não pode contar com nenhum dos dois
  resultados; não deve ser usado onde semânticas de ponto-no-tempo exato importam.
- **`CopyOnWriteArrayList` só é uma boa troca quando leituras dominam escritas** —
  todo `add`/`remove`/`set` copia o array de apoio inteiro, então uma lista mutada
  com frequência paga uma cópia O(n) em toda mutação individual; ela se encaixa
  numa lista de listeners raramente alterada, não numa fila ou buffer escrito tanto
  quanto lido.

## Documentation Links

- [ConcurrentHashMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [ConcurrentMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html) — doc
- [CopyOnWriteArrayList — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html) — doc
- [Collections — Java SE 25 API (synchronizedMap/synchronizedList)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [ConcurrentModificationException — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html) — doc
