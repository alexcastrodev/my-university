# Minuto Java — plano de implementação

Feature nova: página própria "Minuto Java", separada do conteúdo de curso existente. Sem entidade/migration nova (conteúdo editorial estático, seguindo o padrão de `seed/course.data.ts` + `content.controller.ts`).

Rota/endpoint/pastas em inglês (`java-minute`); título exibido e conteúdo continuam em português ("Minuto Java").

## Backend

- [ ] `backend/src/seed/data/java-minute/episodes.json` — metadata: `slug`, `order`, `question`, `publishedAt`, `references`
- [ ] `backend/src/seed/data/java-minute/content/context-switching.md` — corpo do episódio 1 (8 seções, texto abaixo)
- [ ] `backend/src/java-minute/java-minute.service.ts` — lê `episodes.json` + `.md`, faz split das 8 seções por `##`, monta DTO
- [ ] `backend/src/java-minute/java-minute.controller.ts` — `GET /java-minute` (lista) e `GET /java-minute/:slug` (detalhe). Validar `slug` contra a lista finita carregada de `episodes.json` (allowlist por dado), **não** replicar a allowlist de filesystem/regex do `ContentController` — aquele controller é código morto em produção (shadowed pelo nginx), então seu padrão de "servir markdown cru por path" nunca é de fato exercitado; o `java-minute` roda de verdade e não deve herdar esse modelo.
- [ ] `backend/src/java-minute/java-minute.module.ts` — registra controller/service, sem `TypeOrmModule.forFeature`
- [ ] Editar `backend/src/app.module.ts` — importar `JavaMinuteModule`
- [ ] Teste `backend/spec/java-minute.spec.ts` — seguir o padrão dominante do repo: E2E via `fetch` contra a app rodando (helpers de `backend/spec/`), sem `@nestjs/testing`/`TestingModule` (não usado em nenhum outro spec do projeto). `content.spec.ts` é uma exceção unitária por causa do shadowing do nginx — não é o padrão a copiar aqui.

## Frontend

- [ ] `app/src/app/shared/markdown.ts` — util `parseMarkdown(sanitizer, raw)` extraído de `lesson-content.ts`. Extrair **junto** o `wikiLinkExtension` e o `marked.use({ extensions: [wikiLinkExtension] })` (hoje em module scope no topo de `lesson-content.ts`) — senão o parsing de `[[slug]]` fica duplicado/quebrado se `java-minute` também precisar da sintaxe.
- [ ] Editar `app/src/app/components/lesson-content/lesson-content.ts` — usar o util novo (evita duplicar lógica de `marked`+sanitize)
- [ ] `app/src/app/models/java-minute.model.ts` — interface `JavaMinuteEpisode` (8 seções + `references`)
- [ ] `app/src/app/services/java-minute.service.ts` — chamadas HTTP para lista/detalhe
- [ ] `app/src/app/components/java-minute-episode/java-minute-episode.ts` + `.html` + `.css` — componente apresentacional via `templateUrl`/`styleUrl` (padrão do projeto — todos os componentes existentes já foram migrados de template/styles inline para arquivos separados), 8 seções em ordem fixa + lista de referências (doc/vídeo); título exibido "Minuto Java"
- [ ] `app/src/app/pages/java-minute/java-minute-list.ts` + `.html` + `.css` — lista de episódios (`templateUrl`/`styleUrl`)
- [ ] `app/src/app/pages/java-minute/java-minute-detail.ts` + `.html` + `.css` — detalhe por `slug` (`templateUrl`/`styleUrl`)
- [ ] Editar `app/src/app/app.routes.ts` — rotas `java-minute` e `java-minute/:slug`
- [ ] Editar `app/src/app/components/header/header.ts` — link "Minuto Java" apontando para `/java-minute` no nav

## Conteúdo do episódio 1 (Context Switching)

```markdown
---
version: 1.0
updatedAt: 2026-07-20
---
## Pergunta

# O que é context switching?

## Resposta Curta

Context switching é a troca de contexto que o sistema operacional faz entre threads em um mesmo núcleo de CPU. É algo que, em geral, devemos **evitar**: está diretamente relacionado à concorrência e, quando acontece com frequência, prejudica a performance da aplicação.

## O que é

Uma thread roda em um núcleo (core) da CPU. Enquanto está em execução, ela carrega o que chamamos de **contexto**: os dados que está manipulando, o código sendo executado, o conteúdo de cache e os registradores da CPU.

Quando o sistema operacional decide que outra thread precisa rodar naquele mesmo núcleo, ele precisa **pausar a thread atual** para dar lugar à próxima. Isso significa remover o contexto da thread pausada do núcleo e, mais tarde, quando for a vez dela rodar de novo, devolver esse contexto para o núcleo — como se fosse "desempacotar" tudo de novo.

## O Processo

1. O SO decide interromper a thread em execução (ex: fim de fatia de tempo, ou a thread ficou bloqueada esperando algo).
2. O contexto da thread (registradores, dados, estado) é salvo fora do núcleo.
3. O núcleo fica livre e o SO carrega o contexto de outra thread pronta para rodar.
4. Essa nova thread executa.
5. Quando chega a vez da thread original voltar a rodar, seu contexto é recarregado no núcleo — praticamente do zero.

## Impacto na Performance

Cada troca de contexto leva, em média, cerca de **100 microssegundos**. Pode parecer pouco, mas para os padrões de uma CPU é um tempo considerado **alto**: nesse intervalo, o núcleo não está fazendo trabalho útil para nenhuma das duas threads, só salvando e restaurando estado.

Em aplicações com muitas threads concorrentes disputando poucos núcleos, esse custo se repete constantemente e pode consumir uma fatia relevante do tempo de CPU — tempo que deveria ir para processamento real, não para "trocar de roupa" entre threads.

## Exemplo Prático

O cenário mais comum: uma thread faz uma chamada de rede (por exemplo, uma requisição HTTP para outro serviço) e essa chamada é **bloqueante** — a thread fica parada esperando a resposta chegar.

Enquanto essa thread espera, ela não está fazendo nada útil, mas ainda ocupa um núcleo. Para não desperdiçar esse núcleo, o SO frequentemente faz context switching: tira essa thread bloqueada dali e coloca outra no lugar. Quando a resposta da rede finalmente chega, é preciso trazer a thread de volta — outro context switching.

## Solução e Conclusão

A recomendação prática é usar **virtual threads**. Como virtual threads não ocupam uma kernel thread de forma exclusiva enquanto esperam uma operação bloqueante (como I/O de rede), o bloqueio de uma virtual thread não trava a kernel thread por trás dela.

Isso evita boa parte do context switching desnecessário e, como consequência prática, reduz bugs relacionados à concorrência que costumam surgir da complexidade de gerenciar muitas threads tradicionais competindo por poucos núcleos.

## Referências

- [Minuto Java: Context Switching](https://www.youtube.com/shorts/m7HvmcRAvac) — vídeo
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
```

`episodes.json`:
```json
[
  {
    "slug": "context-switching",
    "order": 1,
    "question": "O que é context switching?",
    "publishedAt": "2026-07-20",
    "references": [
      { "label": "Minuto Java: Context Switching", "url": "https://www.youtube.com/shorts/m7HvmcRAvac", "type": "video" },
      { "label": "JEP 444: Virtual Threads", "url": "https://openjdk.org/jeps/444", "type": "doc" },
      { "label": "java.lang.Thread — Java SE 25 API", "url": "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html", "type": "doc" }
    ]
  }
]
```

## Verificação

- [ ] Backend: `curl /java-minute` (lista) e `curl /java-minute/context-switching` (detalhe) retornam JSON esperado
- [ ] Frontend: navegar `/java-minute` → card do episódio → `/java-minute/context-switching` renderiza as 8 seções com estilo consistente
- [ ] Link "Minuto Java" aparece no header em todas as páginas
- [ ] Suite de testes do backend passando
