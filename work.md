# Ideias de melhoria — OCP Java Simulator

Levantamento a partir do estado atual do app (rotas, exam/course, XP, auth,
search) — não é um plano formal, é uma lista de ideias pra priorizar depois.

## Ajudam diretamente nos estudos

- [x] **Revisão de respostas erradas — feito (2026-08-02).** `ExamAttempt.answers`
      já era persistido, mas o `review` (pergunta + resposta dada + certa +
      explicação) só existia efêmero na resposta HTTP do `submit` — nunca
      salvo, então revisitar `/result/:attemptId` (refresh, ou uma futura
      tela de histórico) só sobrava o score agregado. Implementado:
      - **Backend:** nova coluna `review` (jsonb, nullable) em
        `exam_attempt` via migration
        (`backend/src/migrations/1764000000005-AddExamAttemptReview.ts`,
        testada de verdade — `up`/`down` rodados contra um Postgres real
        via Docker, `\d exam_attempt` conferido). `QuestionReview` (movido
        pra `exam-attempt.entity.ts`) agora inclui snapshot do conteúdo da
        pergunta (`text`/`code`/`options`), não só o gabarito — assim uma
        tela de revisão nunca precisa de N requests extras por pergunta,
        um único `GET` já traz tudo. `submitAttempt` salva o `review`
        calculado no attempt; novo endpoint `GET
        /exam/:examId/attempts/:id` (mesma regra de ownership do submit —
        403 se pertence a outro usuário, 404 se não existe ou é de outro
        exam) devolve o attempt completo, com `review: null` pra attempts
        antigos (antes desta coluna existir) ou ainda não submetidos.
        Testado ponta a ponta contra um backend real (fora dos specs
        automatizados): `docker run postgres:18-alpine` isolado, `nest
        start` apontado pra ele, `curl` no fluxo completo (start → submit
        → get antes/depois → 404 de attempt inexistente/exam errado) —
        bateu exatamente o esperado em todos os casos.
      - **Frontend:** nova página `/java/exam/:examId/review/:attemptId`
        (`app/src/app/pages/review/`), reaproveitando o `<app-quiz-question>`
        existente em modo `reviewing` (mesmo componente que já colore
        certo/errado no skill-check) — filtro "Wrong only" (default) vs.
        "All". Link "Review Answers" adicionado no result-page, só
        aparece quando `attempt.review` existe. Aproveitei pra corrigir de
        graça um bug adjacente: `result-page.ts` dependia de
        `router.getCurrentNavigation().extras.state` (perdido em qualquer
        refresh) com fallback pra `getAttempts()` (lista completa, sem
        review) — trocado pra usar o `getAttempt()` novo direto, então o
        breakdown por tópico agora sobrevive a um refresh também.
      - Testes: `backend/spec/exam.spec.ts` ganhou 5 casos novos pro
        endpoint (não rodados localmente sem o stack docker-compose
        completo, mas a lógica foi validada ao vivo via curl acima,
        exercitando exatamente os mesmos cenários). Frontend:
        `review-page.spec.ts` (4 casos) + `result-page.spec.ts` (3 casos,
        arquivo novo — a página não tinha spec antes), todos passando
        (41/41 relevantes, as 2 falhas restantes são as mesmas
        pré-existentes sem relação).
- [x] **Histórico de tentativas — feito (2026-08-02).** Nova tela
      `/java/exam/:examId/attempts` (`app/src/app/pages/attempts/`) — lista
      as tentativas finalizadas do usuário logado (score, %, pass/fail),
      cada linha linkando pro result-page daquela tentativa. Link "View
      past attempts" adicionado no banner do quiz no course-page (só
      aparece logado, já que tentativa anônima não é salva no histórico).
      - **Otimização de payload feita junto:** `GET /exam/:examId/attempts`
        (usado pela lista) devolvia `answers`/`review` completos de *toda*
        tentativa histórica — para um exame de 200 perguntas, isso é um
        payload gigante por tentativa só pra mostrar score+data numa
        lista. Adicionado `select` no TypeORM (`backend/src/exam/exam.service.ts`)
        pra devolver só os campos leves (`id`/`examId`/`startedAt`/
        `finishedAt`/`score`/`total`); a tela de detalhe/revisão continua
        usando o `GET .../attempts/:id` singular (não afetado, continua
        completo). Novo tipo `ExamAttemptSummary` no frontend pra refletir
        isso honestamente no TS (em vez de fingir que `answers`/`review`
        ainda existem no retorno da lista).
      - Testado ao vivo contra um backend real (mesmo processo de antes —
        Docker Postgres isolado + `nest start` + `curl`): confirmado que a
        lista vem só com os 6 campos leves e que o endpoint singular
        continua completo. **Achado de processo durante esse teste:** um
        processo `nest start` anterior tinha ficado vivo na porta 3000
        sem eu perceber (o `kill` não tinha realmente matado o processo
        filho) e respondia com código desatualizado — só percebi
        conferindo com `lsof -i :3000` depois do resultado não bater;
        salvo em memória pra próxima vez.
      - Specs: `backend/spec/exam.spec.ts` ganhou 1 caso novo confirmando
        que `answers`/`review` não aparecem na lista. Frontend:
        `attempts-page.spec.ts` (3 casos — prompt de login, lista
        filtrando tentativas não-finalizadas, estado vazio), todos
        passando (44/44 relevantes).
- [x] **Fila de revisão espaçada pros concepts — feito (2026-08-02).**
      Achado importante durante o design: **não existe uma tabela "read"
      separada** — hoje "lido" é só uma linha em `user_xp_entry` (mesma
      tabela do XP), deduplicada por `(userId, sourceType, sourceId)` via
      `INSERT ... ON CONFLICT DO NOTHING`. Isso não dá pra reaproveitar
      direto (nunca atualiza em cliques repetidos), então a feature exigiu
      uma tabela nova.
      - **Decisões tomadas com o usuário antes de implementar:** rating de
        4 níveis estilo Anki (Again/Hard/Good/Easy, SM-2 simplificado) em
        vez de binário lembrei/esqueci; página dedicada `/review`
        agregando os 5 módulos numa fila só, em vez de badge por lista.
      - **Backend:** novo módulo `backend/src/review/` — entidade
        `ReviewSchedule` (easeFactor/intervalDays/repetitions/dueAt/
        lastReviewedAt, única por `(userId, sourceType, sourceId)`),
        algoritmo SM-2 simplificado em `sm2.ts` (função pura, sem
        dependência de banco), e `review.constants.ts` como fonte única de
        verdade pro mapeamento módulo↔prefixo de sourceId (reaproveita
        exatamente a convenção que já existe nos 5 controllers de
        concepts — `spring:`/`db:`/`sysdesign:`/sem-prefixo — em vez de
        inventar uma segunda convenção).
        - `POST /review/schedule` (body `{module, slug}`) — agenda a
          primeira revisão pra 1 dia depois, idempotente.
        - `GET /review/due` — fila de itens vencidos do usuário, com
          título/rota resolvidos contra os 5 services de concept (sem
          reler markdown do disco — usa só `findAll()`, que é metadata em
          memória).
        - `POST /review/answer` (body `{sourceType, sourceId, rating}`) —
          recalcula o agendamento via SM-2 e devolve `{dueAt,
          intervalDays}`.
        - **Decisão de arquitetura pra evitar import circular:** o
          agendamento é disparado pelo *frontend* (uma segunda chamada
          depois do markRead), não pelo backend internamente — se os 5
          controllers de concept importassem `ReviewModule` pra chamar
          `ReviewService` diretamente, e `ReviewModule` precisa importar
          os 5 módulos de concept pra resolver títulos, isso criaria um
          ciclo de módulos do NestJS. Resolvido mantendo unidirecional:
          `ReviewModule` → 5 módulos de concept, nunca o contrário.
      - **Frontend:** nova página `/review` (`app/src/app/pages/review-queue/`,
        classe `ReviewQueuePage` — nome diferente do `ReviewPage` já
        existente da revisão de tentativas de exame, pra não colidir),
        fluxo tipo flashcard (item atual + link "abrir pra reler" + 4
        botões de rating, avança pro próximo ao responder). Link "Review"
        adicionado no header (só logado). Nos 5 detail pages, `onMarkRead()`
        agora também dispara `reviewService.scheduleReview(module, slug)`
        depois do sucesso do markRead (fire-and-forget, erro engolido —
        não deve bloquear o read-tracking que já funcionou).
      - **Testado ao vivo** contra Postgres real via Docker + `nest start`
        + `curl`: migration up/down confirmada, 401 sem sessão, 404 pra
        módulo desconhecido, agendamento não aparece na fila antes de
        vencer, aparece depois de forçar `dueAt` pro passado com título
        certo (testado com java-concepts *e* spring-concepts, confirmando
        o desprefixamento `spring:`), isolamento entre usuários, resposta
        avança o agendamento corretamente.
      - Specs: `sm2.spec.ts` (8 casos, incluindo conferência manual da
        matemática do algoritmo) + `review-constants.spec.ts` (7 casos,
        round-trip módulo↔sourceId pros 5 módulos) — ambos puros, sem
        banco. `review.spec.ts` (9 casos de integração, mesmo padrão do
        `exam.spec.ts`). Frontend: `review-queue-page.spec.ts` (5 casos).
        47/49 relevantes passando no frontend (as 2 falhas restantes são
        as mesmas pré-existentes sem relação); 270 testes de backend
        (specs sem banco) passando.
- [x] **26 lições "Practice" eram literalmente a mesma frase genérica, sem
      nenhum conteúdo por trás — as 26 estão feitas.** Todo módulo dos
      cursos `java-21`/`java-25`
      termina com um trio: slides → **"Practice: {Tópico}"** → "Skill Check:
      {Tópico}". O Skill Check já é real (`topic` setado, puxa perguntas de
      verdade via `SkillCheckView`). A lição Practice, não — em
      `backend/src/seed/data/java-21/course/modules/13-concurrency.json` (e
      nos outros 25 módulos), o JSON é sempre `"contentPath": null` e nem
      `topic` é setado. O front (`course-page.html:36-40`) então cai no
      branch `isPracticePlaceholder` e mostra a mesma frase pra Concurrency,
      Generics, I/O, qualquer tópico: "Work through the practice exercises
      for this topic on your own. When you're done, mark this lesson as
      completed." Não tem exercício nenhum atrás disso — é clicar em
      "completed" sem ter feito nada.
      - O mecanismo pra conteúdo real já existe e é reaproveitável: se
        `contentPath` fosse preenchido (igual nos slides), o mesmo
        `<app-lesson-content>` já renderizaria markdown de verdade — não
        precisa de infra nova, só escrever o `.md` de cada exercício e
        apontar o `contentPath`, do jeito que as 26 lições `slide` já
        fazem.
      - Não precisa ser um sandbox de código rodável (isso sim seria infra
        nova) — o ganho já vem de ter 1-3 exercícios reais em markdown por
        tópico (enunciado + código pra completar/prever output + resposta
        comentada), igual ao formato Problem/Solution que já é usado nos
        concepts vindos do SQL Cookbook.
      - **26 de 26 feitos — as duas trilhas (java-21 e java-25, 26
        módulos) estão 100% completas:**
        - `13-7-practice-concurrency.md` (java-21, Concurrency) — thread
          creation, race condition, `HashMap` sob parallel stream, deadlock,
          virtual threads + `try`-with-resources.
        - `8-7-practice-multithreading.md` (java-25, Multithreading) —
          `run()` vs `start()` em virtual thread, re-interrupt após
          `InterruptedException`, `ScopedValue`/`isBound()`, se
          `synchronized` ainda pina virtual thread no Java 25 (JEP 491 —
          não pina mais, desde o Java 24; corrige uma imprecisão da própria
          tabela do slide `8-5`, que ainda lista "sim" sem a ressalva de
          versão), `StructuredTaskScope.ShutdownOnFailure`.
        - `10-5-practice-streams.md` (java-21, Streams) — stream reusado
          (`IllegalStateException`), laziness/short-circuit com
          `peek`+`findFirst`, `Collectors.toMap` com chave duplicada,
          `reduce` com vs. sem identity num stream vazio,
          `partitioningBy`+`counting()`.
        - `9-4-practice-collections-and-generics.md` (java-21, Collections
          and Generics) — `List<? extends Number>` não aceita `add()`
          (PECS), `Set.add()` retornando `false` em duplicata + ordenação
          do `TreeSet`, `Map.merge` vs. `computeIfAbsent` (quando cada um
          chama a função), o mesmo `ArrayDeque` usado como pilha
          (`push`/`pop`) vs. fila (`offer`/`poll`), `unmodifiableList` como
          view (não cópia) + `binarySearch` em lista não ordenada
          (comportamento não especificado).
        - `8-6-practice-lambdas-and-functional-interfaces.md` (java-21,
          Lambdas and Functional Interfaces, 2026-08-02) — capturar a
          variável de um `for` clássico não compila (não é effectively
          final) vs. copiar pra uma variável nova por iteração, contagem de
          SAM (default/static/override de `Object` não contam pro
          `@FunctionalInterface`), tipo de method reference + resultado
          exato (`String::compareTo` vs. `prefix::concat`), ordem de
          `Function.andThen` vs. `compose`, `Predicate.and()` short-circuit
          evitando `NullPointerException`.
        - `6-9-practice-class-design.md` (java-21, Class Design, 2026-08-02)
          — hiding estático vs. override de instância (`v.category()`
          resolvido pelo tipo declarado, `v.topSpeed()` por dispatch
          dinâmico), classe listada em `permits` sem `final`/`sealed`/
          `non-sealed` não compila, identidade vs. igualdade de record
          (`equals` true, `==` false) + compact constructor lançando
          exceção, enum com corpo por constante não pode ser instanciado
          via `new` fora da declaração, subclasse anônima de classe
          abstrata compila mas `new AbstractClass()` direto não.
        - `7-7-practice-beyond-classes.md` (java-21, Beyond Classes,
          2026-08-02, escrito por sub-agente em paralelo — verificado) —
          diamond de default methods entre interfaces não relacionadas não
          compila sem override + `Interface.super.method()`, enum com corpo
          por constante + `EnumMap` sempre iterando em ordem de declaração
          (não de inserção), switch exaustivo sobre hierarquia sealed com
          ramo `non-sealed` (type pattern casa por assignability), record
          com construtor não-canônico precisa delegar via `this(...)`
          (atribuição direta só vale no canônico), inner class exige
          instância externa pra `new` (`outer.new Inner()`) enquanto nested
          `static` não acessa campo de instância sem qualificar.
        - `11-8-practice-exceptions-and-localization.md` (java-21,
          Exceptions and Localization, 2026-08-02, sub-agente em paralelo —
          verificado) — ordem de `catch` por hierarquia (tipo mais
          específico antes do genérico, senão não compila), `finally` com
          `return`/`throw` engolindo exceção em trânsito do `try`,
          multi-catch com variável implicitly final, try-with-resources
          (ordem reversa de fechamento + suppressed exceptions),
          `ResourceBundle` com fallback por chave (não só por arquivo).
        - `4-4-practice-exception-handling.md` (java-25, Exception
          Handling, 2026-08-02, sub-agente em paralelo — verificado) —
          `return` no `finally` sobrepondo `return` do `try`, exceção
          lançada dentro do `finally` substituindo (perdendo) a original,
          try-with-resources (ordem de fechamento + suppressed), variável
          de multi-catch implicitly final, encadeamento de construtor de
          exception checked customizada (`super(message, cause)` +
          `throws` obrigatório).
        - `6-7-practice-streams.md` (java-25, Streams, 2026-08-02,
          sub-agente em paralelo — verificado) — `gather()` +
          `Gatherers.windowFixed` (JEP 485, feature nova do Java 25, sem
          equivalente no track java-21), `Stream<Integer>` não tem
          `average()` (só `IntStream`, precisa `mapToInt`), `sorted()` é
          stateful (bufferiza tudo antes de emitir, ao contrário de
          `filter`/`map`), `Collectors.teeing` combinando dois collectors
          numa passada só, `forEach` numa `ArrayList` compartilhada em
          parallel stream é race condition de comportamento genuinamente
          não especificado (sem assumir valor errado específico).
        - `3-11-practice-oop.md` (java-25, OOP, 2026-08-02, sub-agente em
          paralelo — verificado) — ordem de resolução de overload
          (widening > boxing > varargs), Flexible Constructor Bodies (JEP
          492 — o que pode rodar antes do `super()`: só código que não
          toca em `this`), static hiding + field hiding + override de
          instância lado a lado no mesmo exemplo, switch exaustivo sobre
          sealed com `non-sealed` (mesmo padrão do Exercício 3 do Beyond
          Classes, mas com módulo/exemplo diferente), unnamed variables
          `_` (JEP 456) — múltiplos `_` coexistem, mas ler `_` não compila.
        - `3-7-practice-making-decisions.md` (java-21, Making Decisions,
          2026-08-02, sub-agente em paralelo — verificado) — variável de
          pattern matching definitivamente atribuída através de `!` +
          `||`, guarded pattern (`when`) nunca conta pra exhaustiveness
          mesmo que a negação pareça cobrir o resto, `case Object o` não
          casa com `null` num switch de pattern matching (`NullPointerException`
          em runtime sem `case null`), fall-through de switch clássico
          (labels empilhadas vs. fall-through real sem `break`), `continue`
          rotulado pulando pro loop externo.
        - `4-7-practice-core-apis.md` (java-21, Core APIs, 2026-08-02,
          sub-agente em paralelo — verificado) — string pool + `==` vs.
          `equals`/`intern()`, encadeamento mutável de `StringBuilder`
          (contraste com imutabilidade de `String`), array multidimensional
          com linhas não inicializadas (`null` por padrão, `NullPointerException`
          ao indexar), `Math.round`/`ceil`/`floor` em negativos +
          `Math.abs(Integer.MIN_VALUE)` estourando pra negativo,
          `LocalDate`/`Period` imutável (retorno descartado não muda o
          original) + `Period.toString()` omitindo componentes zerados.
        - `15-7-practice-jdbc.md` (java-21, JDBC, 2026-08-02, sub-agente em
          paralelo — verificado) — ordem de fechamento reversa em
          try-with-resources com `Connection`/`PreparedStatement`/`ResultSet`
          (+ cascata do `Statement` fechando seu `ResultSet`), índice de
          parâmetro do `PreparedStatement` começa em 1 (não 0) + contraste
          com SQL injection via `Statement` cru, `ResultSet` lança exceção
          se ler antes do primeiro `next()` mas permite reler a mesma
          coluna, `registerOutParameter` precisa vir antes de `execute()`
          no `CallableStatement`, fechar `Connection` em modo manual sem
          `commit()`/`rollback()` é rollback implícito (citação exata do
          exam tip do slide 15-6, conferida).
        - `14-8-practice-io.md` (java-21, I/O, 2026-08-02, sub-agente em
          paralelo — verificado) — navegação de `Path` (`getNameCount()`,
          `subpath()`, `resolve()` com argumento absoluto descarta a base),
          compatibilidade de wrapper byte-stream vs. character-stream (`
          BufferedInputStream(FileReader)` não compila, `FileReader` é
          `Reader` não `InputStream`), `BufferedWriter` sem `flush()`/
          `close()` não garante que os dados cheguem ao disco, serialização
          com superclasse não-`Serializable` (campo dela reinicializado via
          construtor no-arg, não recuperado do stream) + `transient`,
          ordem de fechamento em cadeia de streams decoradas (each
          `close()` cascateia pro `super.close()`).
        - `5-6-practice-collections.md` (java-25, Collections, 2026-08-02,
          sub-agente em paralelo — verificado) — `reversed()` é view viva,
          não cópia, `LinkedHashMap` implementa `SequencedMap` mas
          `HashMap` não compila como tal, covariância de array +
          `ArrayStoreException` em runtime, `Arrays.sort(int[], Comparator)`
          não existe (só pra arrays de objeto) + fórmula do insertion point
          negativo do `binarySearch`, métodos de navegação half-open do
          `TreeSet` (`headSet`/`tailSet`/`subSet`).
        - `1-10-practice-building-blocks.md` (java-21, Building Blocks,
          2026-08-02, sub-agente em paralelo — verificado) — regra de um
          único `public class` por arquivo, shadowing de campo por
          parâmetro vs. impossibilidade de shadowing entre variáveis
          locais no mesmo escopo, defaults de campo (inclusive array `null`
          por padrão) vs. variável local sem default, ordem exata de
          inicialização (field initializer → instance initializer block →
          corpo do construtor, uma vez só mesmo com `this(...)`
          encadeado), "ilha de isolamento" falsa em GC (referências mútuas
          que continuam alcançáveis por outra variável viva).
        - `2-7-practice-operators.md` (java-21, Operators, 2026-08-02,
          sub-agente em paralelo — verificado) — ordem de avaliação de
          pré/pós-incremento, cast de narrowing implícito no `+=`
          (overflow silencioso em `byte`), precedência entre aritmético/
          relacional/lógico, `&&`/`||` short-circuit vs. `&`/`|` sempre
          avaliando os dois lados (efeito colateral), promoção de tipo do
          ternário (mistura numérica vira `double`; `char`+`int` não
          constante vira `int`).
        - `5-7-practice-methods.md` (java-21, Methods, 2026-08-02,
          sub-agente em paralelo — verificado) — varargs só como último
          recurso na resolução de overload, `protected` entre pacotes só
          através do próprio tipo da subclasse (não de uma referência
          tipada como o pai), método `static` não lê campo de instância
          sem instância explícita + static hiding resolvido pelo tipo
          declarado, ordem completa de resolução de overload (widening →
          boxing → varargs), getter vazando referência mutável quebra
          encapsulamento mesmo com campo `private`.
        - `12-7-practice-modules.md` (java-21, Modules/JPMS, 2026-08-02,
          sub-agente em paralelo — verificado) — `requires` vs. `requires
          transitive` (readability implícita), `exports` vs. `exports ...
          to` (export qualificado), `opens` dá acesso via reflection mas
          não visibilidade em compile-time, `uses`/`provides ... with`
          ainda exige `requires` do módulo dono da interface do serviço,
          `module-info.java` não pode ter `package` (não pertence a
          nenhum pacote).
        - `16-8-practice-java25-new-features.md` (java-21, What's New in
          Java 25, 2026-08-02, sub-agente em paralelo — verificado) —
          `import module` com nomes ambíguos entre dois módulos, `import
          module` não substitui `requires` num módulo nomeado, imports
          automáticos só valem pra classes implícitas (JEP 512), ordem de
          prioridade dos 8 formatos de `main` (JEP 495, conferida contra o
          slide), Scoped Values preview no Java 21 vs. final no Java 25
          (por que 1Z0-830 não cobra e 1Z0-831 cobra) — evitou de propósito
          sobrepor Flexible Constructor Bodies e Stream Gatherers, já
          cobertos nos practice do track java-25.
        - `2-6-practice-flow-control.md` (java-25, Flow Control,
          2026-08-02, sub-agente em paralelo — verificado) — dangling
          `else` num `if` sem chaves (liga ao `if` desencontrado mais
          próximo), `do-while` executa o corpo antes de testar a condição
          (mais o `;` obrigatório depois do `while`), `yield` + fall-through
          num switch expression de sintaxe `:`, record deconstruction
          pattern + exhaustiveness sobre hierarquia sealed (ordem
          guarded-antes-de-unguarded), `break` sem label vs. `break`
          rotulado quando um switch está dentro de um loop.
        - `7-9-practice-packaging.md` (java-25, Packaging, 2026-08-02,
          sub-agente em paralelo — verificado) — derivação do nome de
          automatic module a partir do nome do JAR (só o sufixo de versão
          é removido), readability é via única entre módulo nomeado e
          unnamed module (`--add-reads ... =ALL-UNNAMED` como escape
          hatch), diferença entre JAR modular de verdade e um JAR sem
          `module-info` tratado como automatic module, `jlink` exige
          `--module-path` explícito (não escaneia o disco sozinho),
          provider de serviço só é descoberto se entrar no grafo resolvido
          como root module (`--add-modules`), não basta estar no module
          path.
        - `1-10-practice-values.md` (java-25, Values, 2026-08-02,
          sub-agente em paralelo — verificado) — indentação incidental de
          text block (o algoritmo do JEP 378, inclusive a linha do `"""`
          de fechamento contando pro mínimo), cache de `Integer`/`Long`
          (-128 a 127) fazendo `==` "funcionar" por acidente,
          `Instant.until()` truncando pra zero + `UnsupportedTemporalTypeException`
          ao aplicar `Duration` (baseado em tempo) a um `LocalDate`
          (baseado em data), overlap de DST no fim do horário de verão
          americano (mesmo `LocalDateTime`, `Instant` diferente conforme
          o offset escolhido), cast de narrowing do `+=` combinado com
          promoção de tipo do ternário.
        - `9-4-practice-io.md` (java-25, I/O, 2026-08-02, sub-agente em
          paralelo — verificado) — `Files.writeString` com opções
          explícitas substitui os defaults em vez de somar (armadilha do
          `APPEND` sem `TRUNCATE_EXISTING`), `Files.exists`/`notExists`
          não são complementares estritos (os dois podem retornar `false`
          se a existência não puder ser confirmada), campo `static` nunca
          é serializado nem restaurado (só reflete o estado atual da
          classe), `relativize()` entre paths de "tipo" diferente
          (absoluto vs. relativo) lança `IllegalArgumentException` em
          runtime, `normalize()` mantém um `..` literal quando não há
          root pra cancelar num path relativo.
        - `10-4-practice-localization.md` (java-25, Localization,
          2026-08-02, sub-agente em paralelo — verificado, exemplos
          testados de fato compilando/rodando no JDK 25) — `Locale.of()`
          normaliza case (idioma minúsculo, país maiúsculo) +
          `toString()` com underscore vs. `toLanguageTag()` BCP 47 com
          hífen, aspas duplas escapando apóstrofo no `MessageFormat` +
          semântica de limite do `ChoiceFormat` (`#` é `>=`, `<` é `>`
          estrito), `DecimalFormatSymbols` explícito por locale (separador
          de milhar/decimal invertidos no alemão), `ofPattern(pattern,
          locale)` só localiza o texto dos tokens sem reordenar a
          estrutura (contraste com `ofLocalizedDate().withLocale()`),
          `Currency.getDefaultFractionDigits()` guiando o arredondamento
          do `NumberFormat` de moeda (JPY sem casa decimal).
        **Nota de processo:** os 20 lotes-sub-agente no total (Beyond
        Classes, Exceptions/Localization java-21, Exception
        Handling/Streams/OOP java-25, Making Decisions/Core APIs/I-O/JDBC
        java-21 + Collections java-25, Building Blocks/Operators/Methods/
        Modules/Java 25 New Features java-21, e por fim Flow
        Control/Packaging/Values/I-O/Localization java-25) foram
        delegados em quatro lotes de 5 sub-agentes em paralelo, cada um
        restrito a escrever só o `.md` novo + o `contentPath` do seu
        próprio módulo (proibido tocar nos specs compartilhados ou no
        work.md, pra evitar conflito de edição simultânea). Todos os 20
        cumpriram o escopo à risca (confirmado via `git status` a cada
        lote — nenhum tocou fora do que foi pedido); o conteúdo de cada
        um foi lido e revisado antes de integrar, e a integração dos
        specs (`FILLED_PRACTICE_LESSONS` + `content.spec.ts`) foi feita
        manualmente depois, de uma vez por
        lote, com a mesma verificação de quebrar/restaurar pra confirmar
        que pega regressão.
        Testes de regressão dos dois lados, generalizados pra cobrir
        qualquer lição nova automaticamente: backend
        (`backend/spec/content.spec.ts` + `backend/spec/course-content-paths.spec.ts`
        — este último varre *todos* os módulos dos 2 cursos e falha se
        algum `contentPath` não-nulo apontar pra um arquivo inexistente,
        mais uma lista `FILLED_PRACTICE_LESSONS` travando cada lição já
        preenchida) e frontend (`app/src/app/pages/course/course-page.spec.ts`,
        cobre os dois estados: placeholder quando `contentPath` é `null`,
        conteúdo real quando não é — genérico, não precisa de teste novo por
        lição). Todos verificados pegando a regressão de verdade (quebrados
        de propósito e restaurados). **✅ Concluído (2026-08-02) — as 26
        lições "Practice" dos dois cursos (java-21 e java-25) têm conteúdo
        real. 4 lotes de 5 sub-agentes em paralelo + 2 escritas diretas
        (Concurrency, Class Design), 253 testes de backend + 34 de
        frontend passando, nenhum arquivo fora do escopo tocado em
        nenhuma rodada.**
- [x] **"Continuar de onde parei."** Não existe atalho pra retomar a última
      lição/exame em andamento. Hoje o usuário precisa navegar até
      `/java/exams` → escolher o exame → achar a lição de novo. Um botão
      "Continuar" na home/profile resolveria. **✅ Concluído (2026-08-02) —
      sem tabela/tracking novo: deriva do último `Progress` com
      `status: 'completed'` (mais recente por `updatedAt`) e acha a
      próxima lição na ordem de módulos/lições do curso
      (`findNextLesson`, função pura testada isoladamente). Backend:
      `GET /courses/resume` (rota registrada antes de `:id` pra não
      colidir), `CourseService.findResumePoint`. Frontend: banner
      "Continue where you left off" na landing page, linkando pra
      `/java/exam/:courseId/lesson/:lessonId` (ou pro curso, se a
      última lição concluída for a última do curso). Verificado ao
      vivo com Postgres real (Docker) + `curl` nos três casos: sem
      progresso → `null`, meio do curso → próxima lição certa, última
      lição do curso → `lessonId: null`. 397 testes de backend + 56 de
      frontend passando.**

## Podia ser mais claro

- [ ] **Duas buscas com o mesmo visual, comportamento bem diferente.** A
      busca do header (Meilisearch, indexa curso/lições/todos os concepts)
      e a busca dentro do sidebar do curso (`components/playlist/playlist.ts`,
      só `.includes()` local nos títulos das lições do curso atual) usam a
      mesma aparência de campo de busca. Fácil o usuário digitar algo geral
      na busca do playlist esperando resultado global e não achar nada. Vale
      diferenciar visualmente ou deixar explícito no placeholder
      ("Buscar nesta lista" vs "Buscar em tudo").
- [ ] **Categoria "Database" de exame existe só no modelo.** `Exam.category`
      aceita `'Language' | 'Database'` e `exam-list.ts` já tem até o ícone
      🗄️ pronto, mas nenhum exame de Database foi cadastrado — a categoria é
      morta hoje. Ou popula (faz sentido dado que já existe `database-concepts`
      como módulo de estudo) ou remove o branch morto do código.
- [x] **"Read" é autoavaliação, de propósito — não tracking passivo.** O
      botão "Got it!" é manual por design: a intenção é o usuário dizer
      "eu li isso até o fim e entendi", não o app tentar inferir isso por
      tempo na página ou scroll (confirmado com o usuário, 2026-08-01/02).
      Não é uma limitação a corrigir — é o comportamento certo pro caso de
      uso. Vale só ter em mente pra quem for construir em cima disso
      (ex.: revisão espaçada): o sinal é "usuário afirma que entendeu", não
      uma garantia objetiva de retenção — a diferença importa se algum dia
      quiser combinar isso com um quiz de verificação de fato.
- [ ] **Card "Java" da landing page pula direto pra Exams.**
      `landing-page.ts:12-18` — o card descreve três coisas ("Certification
      practice exams, Java Minute quick answers, and in-depth Java
      Concepts") mas o clique inteiro do card só tem um `routerLink` pra
      `/java/exams`, então Concepts e Java Minute ficam prometidos na
      descrição mas inacessíveis a partir do clique. O dropdown "Java" do
      header (`header.html:27-34`) já resolve exatamente esse problema —
      abre um menu com Exams/Spring/Concepts/Java Minute — então dá pra
      reaproveitar a mesma ideia aqui: ou o card "Java" vira um mini-menu
      igual ao do header, ou vira uma página intermediária de escolha de
      tópico dentro de Java, em vez de ir direto pra exams.
- [ ] **Tentativa de exame anônima é silenciosa.** `ExamAttempt.userId` é
      nullable — dá pra fazer o exame sem estar logado. Não é
      necessariamente errado (baixa fricção pra experimentar), mas hoje não
      há nenhum aviso no quiz avisando "faça login pra isso contar" — o
      usuário só descobre depois que o resultado não aparece no profile/XP.

## Funcionalidades que dariam pra adicionar

- [ ] **Streaks e leaderboard.** A infra de XP + 10 níveis
      (`backend/src/xp/levels.ts`) já existe, mas não tem nada de streak
      (dias seguidos estudando) nem comparação com outros usuários — é um
      sistema de XP sem nenhum gancho social ou de hábito. Streak é
      geralmente o que mais sustenta retorno diário num app de estudo (efeito
      Duolingo).
- [ ] **Meta diária.** Similar ao acima — hoje XP só acumula, não tem
      nenhum "hoje você já estudou X, faltam Y pra bater a meta".
- [ ] **Página de configurações.** `/profile` hoje é só leitura (XP, nível,
      atividade). Não tem onde trocar preferências — nem teóricas (tema,
      notificações) nem de conta (nome de exibição vem sempre do GitHub, sem
      override).
- [ ] **Duração da lição visível.** `Lesson.duration` existe no model mas
      não confirmei se aparece em algum lugar do `course-view`/`playlist` —
      vale checar e, se não aparecer, mostrar (ajuda a planejar quanto tempo
      separar pra uma sessão de estudo).
- [ ] **Exportar/compartilhar resultado de exame.** Hoje o result-page é só
      pra você ver. Um link compartilhável ou export (PDF/imagem) do
      resultado seria fácil de adicionar em cima do que já existe e ajudaria
      quem usa isso pra mostrar progresso (ex.: LinkedIn, portfolio).

## Notas de escopo

Isso foi levantado a partir de exploração do código em 2026-08-01/02 — antes
de agir em cima de qualquer item aqui, vale conferir se o comportamento
ainda é o mesmo (o app está mudando rápido essas últimas sessões).
