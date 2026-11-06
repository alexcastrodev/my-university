---
version: 1.0
updatedAt: 2026-11-04
title: "Capstone: Avaliando uma Interface Real de Ponta a Ponta"
summary: "Uma interface real avaliada com toda a disciplina: análise de tarefas, avaliação heurística, um pequeno teste de usabilidade pontuado com SUS, uma checagem de WCAG e uma lista priorizada de achados."
---
## Objetivos de Aprendizagem

- Planejar uma avaliação que declare seus usuários, tarefas, contexto e o que ela não cobre.
- Combinar análise de tarefas, avaliação heurística, teste de usabilidade e checagem de WCAG, e dizer que tipo de evidência cada um dá.
- Separar o que uma ferramenta mediu, o que um avaliador julgou e o que só um teste com pessoas pode mostrar.
- Transformar achados mistos em uma única lista priorizada, com severidade, evidência e correção.
- Relatar os limites de uma avaliação com a mesma clareza dos achados.

## Contexto e Motivação

Uma lista de problemas sem evidência acaba descartada numa discussão, e uma nota de acessibilidade sem tarefa por trás acaba confundida com usabilidade. Este capstone aplica os métodos da disciplina a uma interface real: a página da lição de FP-Growth deste site, `https://university.kurz.fyi/computer-science/ai-theory/data-mining/fp-growth`, como estava em 2026-11-04. O leitor pode abrir a página e repetir as checagens. O site pode ter mudado desde então, porque uma avaliação é uma afirmação datada sobre uma versão.

Os limites vêm primeiro, porque moldam todo o resto. Um avaliador fez uma passada. Nenhum participante tomou parte. Nenhum leitor de tela foi usado. O escopo é inglês, tema claro e um leitor sem login.

## Teoria Central

### Quatro métodos, quatro tipos de evidência

| Método | Precisa de | Pode mostrar | Não pode mostrar |
|---|---|---|---|
| Análise de tarefas (`user-research-interviews-personas-task-analysis`) | Um objetivo e a interface | Passos, planos, caminhos longos | Qual caminho as pessoas escolhem |
| Avaliação heurística (`nielsens-ten-heuristics-and-heuristic-evaluation`) | Vários avaliadores | Problemas prováveis frente a princípios conhecidos | Se as pessoas esbarram neles |
| Teste de usabilidade (`usability-testing-and-the-system-usability-scale`) | Participantes | Falhas observadas, tempo, avaliações | Conformidade |
| Checagem de WCAG (`accessibility-and-wcag`) | Uma ferramenta e checagens manuais | Falhas em critérios nomeados | Que a página é fácil de usar |

Os métodos se sobrepõem pouco, e é por isso que vale combiná-los. Nesta avaliação, a ferramenta achou o zoom bloqueado e não viu o estouro horizontal, e nem a ferramenta nem as heurísticas dizem se um leitor entende a página.

### Rotule a evidência

Cada linha de um relatório deve dizer de onde veio. Este usa três rótulos: **medido** (um script ou ferramenta devolveu), **julgado** (a leitura de um avaliador sobre a interface) e **fictício** (inventado para mostrar a conta). Uma linha medida pode ser pouco importante e uma linha julgada pode estar certa, mas o leitor precisa poder pesá-las de modo diferente.

### Da severidade à prioridade

A severidade na escala de 0 a 4 de Nielsen combina frequência, impacto e persistência, e as notas são mais fortes quando vêm de vários avaliadores. A prioridade acrescenta o custo: entre dois problemas de mesma severidade, a correção barata vem primeiro. Uma exigência pode passar por cima das duas, por exemplo quando um contrato ou uma lei pede WCAG AA.

## Exemplos Resolvidos

### Passo 1: escopo

- **Usuários:** um estudante lendo sozinho, como em `what-hci-studies-users-tasks-and-context`, em notebook ou celular.
- **Objetivo:** chegar aos exemplos resolvidos de uma lição cujo assunto é conhecido, e lê-los.
- **Contexto:** 1280 por 800 no desktop, 390 e 320 de largura no celular, sem login.
- **Fora do escopo:** recursos com login, tema escuro, tablets e pt-BR além de uma execução automática.

### Passo 2: análise de tarefas

Análise hierárquica de tarefas, com planos:

```text
0. Chegar aos exemplos resolvidos de FP-Growth   Plano 0: faça 1, depois 2
1. Abrir a lição                                 Plano 1: se o nome é conhecido, 1.1; senão 1.2
   1.1 Buscar: abrir com Cmd+K, digitar "fp-growth", pressionar Enter
   1.2 Navegar: a partir de /computer-science, abrir Data Mining, abrir FP-Growth
2. Chegar à seção: rolar até "Worked Examples"
```

**Medido.** O caminho 1.1 levou 11 acionamentos de tecla: o atalho, 9 letras e Enter. O primeiro resultado veio pré-selecionado e era a lição certa. O caminho 1.2 levou 2 cliques. O custo está no passo 2:

```text
viewport     altura da página   "Worked Examples" em   telas de rolagem
1280x800              8012 px                2410 px                3.0
390x844              13687 px                4523 px                5.4
```

A página não tem sumário, e seus elementos `h2` não têm `id`, então o leitor não consegue saltar para uma seção nem criar um link para ela.

### Passo 3: avaliação heurística

**Julgado**, por um avaliador em uma passada, então as severidades são uma opinião, e `nielsens-ten-heuristics-and-heuristic-evaluation` explica por que vários avaliadores acham mais. A evidência de cada linha foi medida ou lida na página.

| ID | Heurística | Observação | Severidade |
|---|---|---|---|
| H1 | Visibilidade do status do sistema | Um leitor sem login vê um botão "Got it!" desabilitado. O motivo, "Log in to mark this concept as read", existe só em `title` e `aria-label`, e um botão desabilitado não recebe foco pelo teclado, enquanto o celular não tem hover | 2 |
| H2 | Consistência e padrões | O "Track" da barra do celular abre `/computer-science`, que a barra lateral do desktop chama de "Computer Science", e o desktop ainda tem outro item, "Tracks" | 1 |
| H3 | Reconhecer em vez de lembrar | O chip de bandeira e sinal de mais ao lado dos parágrafos não tem texto visível. Seu significado, "Start a discussion on this paragraph", está só no nome acessível, e a chave "Markers" que controla os chips não os explica | 2 |
| H4 | Flexibilidade e eficiência de uso | Nenhum sumário ou link de seção numa página em que os exemplos ficam a 3 ou 5 telas | 2 |
| H5 | Controle e liberdade do usuário | Esc fecha o diálogo de busca, mas o foco cai em `body`, e não no botão que o abriu | 2 |

Pontos positivos também entram no relatório. A busca funciona bem pelo teclado, a dica do atalho mostra `⌘K` em teclados Apple e Ctrl nos demais, e a barra lateral mostra onde o leitor está entre as 16 lições.

### Passo 4: o teste de usabilidade que não foi feito

Nenhum teste foi feito para esta lição, então nada aqui relata comportamento. Este é o plano que uma equipe executaria. Ele é formativo: cinco leitores do público-alvo, think-aloud concorrente e três tarefas.

1. Achar a lição que explica lift.
2. A partir dela, achar o exemplo que o calcula e dizer o que o número significa.
3. Compartilhar a localização desse exemplo com um colega.

A tarefa 3 testa H4 diretamente. As medidas são sucesso, tempo, erros e SUS. Cinco leitores acham a maioria dos problemas só sob as premissas de `usability-testing-and-the-system-usability-scale`, então um problema raro ainda pode passar.

Para mostrar a conta do SUS, aqui estão cinco conjuntos de respostas. **Eles são fictícios: ninguém os respondeu, e nenhum achado abaixo os usa.**

```text
       itens 1 a 10          SUS
R1     4 2 4 2 4 1 4 2 4 2   77.5
R2     3 3 3 2 3 2 4 3 3 3   57.5
R3     5 1 5 2 4 2 5 1 5 1   92.5
R4     3 2 4 3 3 3 3 2 3 4   55.0
R5     4 2 4 1 4 2 4 2 4 2   77.5
média 72.0, s 15.7, intervalo de 95% de 52.6 a 91.4
```

Mesmo com respostas reais, um intervalo tão largo inclui a média de 68 tão citada, então cinco pessoas não separariam esta página de uma média. O SUS aqui acrescentaria uma nota, e as observações pesariam mais.

### Passo 5: checagem de WCAG

**Medido.** O axe-core 4.14.0 rodou no Chrome com as tags A e AA de WCAG 2.0, 2.1 e 2.2, em três páginas a 1280 por 800:

```text
página                                       regras aprovadas   violadas
/computer-science/ai-theory/.../fp-growth                  25          4
/computer-science                                          23          5
/computer-science/ai-theory/data-mining                    19          3
```

Na página da lição, o axe deixou ainda 10 resultados de contraste como incompletos, que precisam de uma pessoa. A página da lição em pt-BR deu as mesmas quatro regras violadas. As falhas, junto com as checagens manuais:

| Critério | Nível | Evidência | Achado por |
|---|---|---|---|
| 1.4.4 Resize Text | AA | A tag viewport define `maximum-scale=1, user-scalable=no` | axe |
| 1.4.3 Contrast (Minimum) | AA | `#9ca3af` sobre `#f9fafb`, texto de 12 px, $2{,}43{:}1$ contra $4{,}5{:}1$, em 42 nós da página da lição | axe |
| 1.3.1 Info and Relationships | A | `ul` com filhos `button`; em `/computer-science`, um papel de linha sem o pai e os filhos exigidos | axe |
| 2.5.3 Label in Name | A | Texto visível ausente do nome acessível, 5 nós | axe |
| 1.4.10 Reflow | AA | Com 320 de largura a página rola 12 px para o lado, porque um `code` em linha com uma chamada longa não quebra | Manual |

A fórmula dá 2,43 e o axe imprime 2,42, uma diferença de arredondamento. Trocar a cor por `#6b7280` dá $4{,}63{:}1$ sobre o mesmo fundo.

Algumas checagens passaram. O `lang` está certo nas duas línguas, e as 12 paradas de Tab medidas tinham contorno ou sombra no estilo computado, o que mostra que existe um estilo de foco, e não que ele seja visível o bastante. O leitor passa por 11 paradas de Tab antes do primeiro link de conteúdo, e não há skip link nem landmark `main`. A WCAG aceita outros modos de atender a 2.4.1, entre eles os cabeçalhos, então isso fica registrado como problema de usabilidade, e não como falha.

O foco também fica em `body` depois que a busca navega para uma lição. O que um leitor de tela anuncia nesse momento é desconhecido, porque nenhum foi usado.

### Passo 6: achados priorizados

| # | Achado | Evidência | Severidade | Correção | Custo |
|---|---|---|---|---|---|
| 1 | Zoom bloqueado | Medido, AA | 3 | Remover as duas configurações do viewport | Uma linha |
| 2 | Contraste baixo | Medido, AA | 3 | Escurecer um token de cor | Um token, depois rodar de novo |
| 3 | Estrutura de lista e papéis | Medido, A | 3 | Mover botões para dentro de `li`, completar os papéis ou usar tabela | Pequeno |
| 4 | Rótulo no nome | Medido, A | 2 | Colocar o texto visível no nome acessível | Pequeno |
| 5 | Rolagem lateral em 320 | Medido, AA | 2 | `overflow-wrap: anywhere` em código em linha | Uma regra |
| 6 | Foco perdido depois da busca | Medido, julgado | 2 | Devolver o foco ao fechar, movê-lo para o `h1` ao navegar | Pequeno |
| 7 | Sem navegação por seções | Medido, julgado | 2 | Adicionar `id`s e um sumário | Médio |
| 8 | Motivo do "Got it!" escondido | Julgado | 2 | Mostrar o motivo em texto | Pequeno |
| 9 | Sem skip link nem `main` | Medido | 2 | Adicionar os dois | Pequeno |
| 10 | Chip de discussão sem rótulo | Julgado | 2 | Adicionar rótulo visível ou dica de primeiro uso | Pequeno |
| 11 | "Track" e "Tracks" | Julgado | 1 | Usar um só vocabulário | Pequeno |

Os itens 1 e 2 vêm na frente porque são baratos, afetam a própria leitura e falham em AA. O item 7 tem a mesma severidade do item 8 e fica acima dele porque afeta a tarefa do Passo 2 em toda lição longa, e essa ordem também é um julgamento. O passo seguinte é testar de novo: rodar os mesmos scripts depois das correções e confirmar que as falhas sumiram e que nada novo apareceu.

## Equívocos Comuns e Armadilhas

- **"Uma execução limpa do axe significa que a página é acessível."** O axe não viu a rolagem lateral, o foco perdido nem as 11 paradas antes do conteúdo. Veja `accessibility-and-wcag`.
- **"Avaliação heurística substitui o teste com pessoas."** Ela prevê problemas. Se leitores esbarram em H3 é uma pergunta aberta aqui, já que ninguém foi observado.
- **"Um avaliador basta para um relatório real."** Basta para mostrar o método. Uma equipe deve juntar passadas independentes.
- **"Números inventados são melhores que nenhum."** A tabela de SUS acima mostra a conta e não sustenta nada. Um relatório que a misturasse aos achados seria falso.
- **"Severidade é uma medida."** É um julgamento feito numa escala, e é por isso que este relatório mantém a evidência ao lado dela.
- **"Ordene por severidade e pronto."** Sem o custo, uma correção de uma linha espera atrás de um redesenho.

## Resumo

Esta avaliação combinou quatro métodos em uma página datada, e cada um achou o que os outros não podiam achar. A análise de tarefas mediu a distância até os exemplos resolvidos, 3 telas no desktop e 5,4 no celular. Uma passada heurística levantou cinco problemas. O teste de usabilidade foi planejado e não executado, então sua tabela de SUS é fictícia e não informa nada. O axe e as checagens manuais acharam falhas em cinco critérios de níveis A e AA, entre elas zoom bloqueado e contraste de $2{,}43{:}1$. O resultado é uma única lista que mantém juntos evidência, severidade, correção e custo, e que declara seus limites: um avaliador, nenhum participante, nenhum leitor de tela. O próximo passo honesto é corrigir, rodar de novo e colocar a página diante de leitores.

## Documentation Links

- [W3C, Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/): os critérios de sucesso e níveis citados no Passo 5.
- [W3C, Understanding SC 2.4.1: Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html): os modos aceitos de atender a 2.4.1.
- [Deque, axe-core](https://github.com/dequelabs/axe-core): o motor de regras usado no Passo 5.
- [Nielsen Norman Group, 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/): as heurísticas aplicadas no Passo 3.
- [Nielsen Norman Group, Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): a escala de 0 a 4 e o que ela combina.
- [MeasuringU, Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): a pontuação do SUS e a média de 68.
