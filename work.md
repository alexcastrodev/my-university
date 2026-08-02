# Ideias de melhoria — OCP Java Simulator

Levantamento a partir do estado atual do app (rotas, exam/course, XP, auth,
search) — não é um plano formal, é uma lista de ideias pra priorizar depois.

## Ajudam diretamente nos estudos

- [ ] **Revisão de respostas erradas.** `ExamAttempt.answers` já é persistido
      no backend (`backend/src/exam/`), mas depois do result-page ninguém
      mais consegue ver *quais* perguntas errou e por quê — só o score
      agregado. Uma tela "revisar essa tentativa" com pergunta + resposta
      dada + resposta certa + explicação seria o maior ganho de estudo
      possível aqui, e a maior parte do dado já existe.
- [ ] **Histórico de tentativas.** O backend já expõe
      `GET /api/exam/:id/attempts` com o histórico completo, mas o frontend
      só usa isso como fallback pra achar 1 attempt (`result-page.ts:56`).
      Não tem nenhuma tela "minhas tentativas anteriores" — dá pra ver
      evolução de score ao longo do tempo, comparar tentativas, etc.
- [ ] **Fila de revisão espaçada pros concepts.** Hoje "read" é só um
      booleano (lido/não lido). Pra um app de estudo, "marcado como lido" e
      "eu realmente lembro disso" são coisas bem diferentes. Uma revisão tipo
      Anki simplificada (perguntar de novo em N dias, priorizar o que faz
      mais tempo que não é revisitado) aproveitaria a infra de "read" que já
      existe em todos os 5 módulos de concepts.
- [ ] **26 lições "Practice" são literalmente a mesma frase genérica, sem
      nenhum conteúdo por trás — piloto feito, faltam 25.** Todo módulo dos
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
      - **21 de 26 feitos — track java-21 (16 módulos) completo:**
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
        **Nota de processo:** os últimos 15 (Beyond Classes,
        Exceptions/Localization java-21, Exception Handling/Streams/OOP
        java-25, Making Decisions/Core APIs/I-O/JDBC java-21 + Collections
        java-25, e por fim Building Blocks/Operators/Methods/Modules/Java
        25 New Features java-21) foram delegados em três lotes de 5
        sub-agentes em paralelo, cada um restrito a escrever só o `.md`
        novo + o `contentPath` do seu próprio módulo (proibido tocar nos
        specs compartilhados ou no work.md, pra evitar conflito de edição
        simultânea). Todos os 15 cumpriram o escopo à risca (confirmado
        via `git status` a cada lote — nenhum tocou fora do que foi
        pedido); o conteúdo de cada um foi lido e revisado antes de
        integrar, e a integração dos specs (`FILLED_PRACTICE_LESSONS` +
        `content.spec.ts`) foi feita manualmente depois, de uma vez por
        lote, com a mesma verificação de quebrar/restaurar pra confirmar
        que pega regressão. **O track java-21 (16 módulos) está 100%
        completo** — todo o que resta é o track java-25 (5 módulos:
        Values, Flow Control, Packaging, I/O, Localization).
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
        de propósito e restaurados). **Restam 5 módulos** sem o "Practice"
        preenchido — mesmo formato, uma sessão de conteúdo por vez, como o
        workflow dos livros em `tmp/book/`.
- [ ] **"Continuar de onde parei."** Não existe atalho pra retomar a última
      lição/exame em andamento. Hoje o usuário precisa navegar até
      `/java/exams` → escolher o exame → achar a lição de novo. Um botão
      "Continuar" na home/profile resolveria.

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
