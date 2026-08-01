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
      - **3 de 26 feitos:**
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
        - `10-5-practice-streams.md` (java-21, Streams, 2026-08-02) — stream
          reusado (`IllegalStateException`), laziness/short-circuit com
          `peek`+`findFirst`, `Collectors.toMap` com chave duplicada,
          `reduce` com vs. sem identity num stream vazio,
          `partitioningBy`+`counting()`.
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
        de propósito e restaurados). **Restam 23 módulos** sem o "Practice"
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
