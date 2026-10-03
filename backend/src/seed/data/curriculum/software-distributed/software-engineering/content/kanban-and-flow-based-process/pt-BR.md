---
version: 1.0
updatedAt: 2026-09-08
title: "Kanban e Processo Baseado em Fluxo"
summary: "O Método Kanban substitui o timebox fixo do Sprint do Scrum por um sistema de puxar contínuo: o trabalho se move por estágios nomeados, e um limite explícito de trabalho-em-progresso (WIP) em cada estágio é o mecanismo de fato que faz surgir um gargalo, forçando uma decisão visível no momento em que um estágio enche; o seu trade-off contra o Scrum é genuíno e simétrico."
---
## Objetivos de Aprendizagem

- Descrever o mecanismo central do Método Kanban: um sistema de puxar contínuo limitado por limites explícitos de trabalho-em-progresso (WIP) em cada estágio, sem nenhum timebox fixo.
- Explicar por que um limite de WIP, não um gráfico burndown ou uma checagem de status diária, é o mecanismo de fato que faz surgir um gargalo.
- Ler um diagrama de fluxo cumulativo e identificar um estágio estagnado a partir dele antes de ele se tornar um prazo perdido.
- Contrastar o trade-off de fluxo-contínuo do Kanban diretamente contra o trade-off de timebox-fixo do Scrum, e identificar quais condições de projeto reais favorecem cada um.

## Contexto e Motivação

`agile-processes-scrum-in-practice` nomeou o trade-off central do Scrum precisamente: um timebox fixo compra cadência previsível ao custo de adiar trabalho recém-descoberto. O Método Kanban de David Anderson, formalizado no seu livro de 2010 depois de experiência real e prática aplicando sistemas kanban de estilo de manufatura ao trabalho de conhecimento na Corbis e depois na Microsoft, é construído em torno de escolher o lado oposto exatamente desse trade-off: nenhum timebox fixo de forma alguma, e um mecanismo inteiramente diferente, limites de trabalho-em-progresso, para manter o esforço da equipe focado e os problemas visíveis. Entender o Kanban honestamente significa entender que ele não é simplesmente "Scrum sem Sprints"; ele é um mecanismo de controle genuinamente diferente construído sobre um modelo subjacente diferente de como o trabalho de fato flui por uma equipe.

## Teoria Central

### O sistema de puxar e os limites explícitos de WIP

O Kanban organiza o trabalho como uma sequência de estágios (por exemplo: Backlog, Em Progresso, Em Revisão, Concluído), visualizados como colunas num quadro, com um número máximo explícito de itens permitidos em cada estágio em progresso a qualquer momento, o limite de trabalho-em-progresso (WIP). O trabalho é puxado para um estágio só quando esse estágio tem capacidade sob o seu próprio limite de WIP, nunca empurrado para dentro independentemente da prontidão a jusante:

```text
Backlog  ->  Em Progresso (limite WIP: 3)  ->  Em Revisão (limite WIP: 2)  ->  Concluído

Se "Em Progresso" já guarda 3 itens, nenhum novo item pode ser puxado
para ele, mesmo se um membro da equipe está ocioso, até um item atualmente
em "Em Progresso" se mover para "Em Revisão".
```

Este é um mecanismo genuinamente diferente do Sprint Backlog do Scrum, que é planejado uma vez no início de um timebox fixo; o Kanban não tem nenhum evento de planejamento equivalente fixando uma leva de trabalho de antemão, o trabalho simplesmente flui continuamente, um item por vez, restringido só pelos limites de WIP em cada estágio.

### Por que um limite de WIP faz surgir um gargalo que uma checagem de status perderia

O insight genuíno por trás do limite de WIP é o que acontece quando o limite de um estágio é alcançado e permanece alcançado: ele força uma decisão visível e imediata. Se "Em Revisão" está preso no seu limite de WIP porque as revisões estão se acumulando, nenhum novo item pode entrar em "Em Progresso" além do que "Em Revisão" consiga eventualmente absorver, o que significa que a capacidade ociosa mais cedo no pipeline se torna visível e inegável em vez de silenciosamente absorvida em iniciar mais um item que vai só se acumular no mesmo gargalo depois. Uma checagem de status diária perguntando "todos estão ocupados" reportaria todos como ocupados, já que os membros da equipe simplesmente iniciariam itens novos adicionais em vez de confrontar a restrição de fato; um limite de WIP rígido remove essa opção e força o próprio gargalo à vista.

### Lendo um diagrama de fluxo cumulativo

Um diagrama de fluxo cumulativo plota, ao longo do tempo, a contagem cumulativa de itens em cada estágio, empilhada. Um fluxo saudável mostra bandas aproximadamente paralelas, subindo de forma constante; um estágio estagnado mostra a sua própria banda alargando enquanto o estágio depois dele permanece plano, um sinal visual direto de que o trabalho está se acumulando entrando num estágio mais rápido do que está saindo dele:

```text
contagem
  |        ___________________  Concluído (plano = nada terminando)
  |       /
  |      /  ___________________  Em Revisão (ALARGANDO = acumulando)
  |     /  /
  |    /  /___________________   Em Progresso
  |   /  /
  |__/__/____________________________ tempo
```

Este diagrama torna um gargalo visível dias ou semanas antes de ele de outra forma surgir como um prazo perdido, precisamente porque ele rastreia o fluxo do próprio trabalho em vez do status reportado de qualquer pessoa única.

### O trade-off do Kanban contra o do Scrum, enunciado honestamente

O Kanban compra responsividade contínua: um item genuinamente urgente pode ser puxado assim que a capacidade permite, sem necessidade de esperar por um limite de Sprint ou forçar um cancelamento de Sprint disruptivo. Ele custa a cadência previsível e fixa que o Sprint do Scrum compra para planejamento e revisão de stakeholder; sem um limite de Sprint, uma equipe tem de construir a sua própria disciplina em torno de quando revisar prioridades e refletir sobre o processo, já que o próprio Kanban não prescreve nenhum equivalente à Sprint Review ou à Sprint Retrospective como eventos fixos (muitas equipes Kanban reais adotam uma revisão de cadência periódica mesmo assim, pegando emprestada a ideia sem pegar emprestada a estrutura de Sprint-fixo do Scrum). Nenhum trade-off é universalmente correto; uma equipe com interrupções genuínas frequentes (uma equipe de suporte ou pesada em operações) é um ajuste muito melhor para a responsividade contínua do Kanban do que para o compromisso de Sprint do Scrum, enquanto uma equipe construindo um recurso grande e planejado com necessidades de revisão de stakeholder previsíveis é frequentemente um ajuste melhor do outro jeito.

## Exemplos Resolvidos

### Exemplo 1: um limite de WIP forçando uma decisão real

O estágio "Em Revisão" de uma equipe tem um limite de WIP de 2, e ambos os slots estão atualmente ocupados por pull requests esperando pelo único engenheiro sênior disponível para revisá-los. Um desenvolvedor termina uma terceira peça de trabalho e quer iniciar um quarto item do backlog. O limite de WIP diz não: em vez disso, a escolha de fato e visível da equipe se torna ou ajudar a desbloquear uma das duas revisões pendentes (talvez um segundo engenheiro, geralmente não um revisor, entra) ou aceitar que o novo trabalho genuinamente tem de esperar. Sem o limite, o desenvolvedor simplesmente iniciaria um quarto item, e o gargalo de revisão continuaria crescendo invisivelmente até itens suficientes se acumularem que o tempo de ciclo geral da equipe visivelmente degradasse, dias ou semanas depois.

### Exemplo 2: lendo uma estagnação real de um diagrama de fluxo cumulativo

O diagrama de fluxo cumulativo de uma equipe mostra a banda "Em Progresso" alargando de forma constante ao longo de duas semanas enquanto "Concluído" permanece essencialmente plano. Lido literalmente, isto significa que os itens estão entrando em "Em Progresso" mais rápido do que estão saindo dele, um gargalo real e atual, mesmo que todo membro da equipe reporte estar totalmente ocupado durante esse mesmo período, porque estar ocupado e fazer progresso não são o mesmo fato, e o diagrama está rastreando o segundo, não o primeiro.

### Exemplo 3: escolhendo Kanban em vez de Scrum por uma razão genuína

Uma equipe de suporte de plataforma trata um fluxo contínuo e imprevisível de incidentes recebidos ao lado de trabalho de melhoria planejado. Adotar o Scrum para esta equipe significaria que todo incidente recebido ou espera pelo próximo Sprint Planning ou força um replanejamento de Sprint disruptivo, nenhum dos quais corresponde a como o trabalho real da equipe de fato chega. O puxar contínuo do Kanban, com limites de WIP mantendo o trabalho de melhoria planejado e a resposta a incidentes de não se sobrecarregarem, corresponde ao padrão de chegada de fato da equipe diretamente, uma razão concreta e real para escolher o trade-off do Kanban em vez do do Scrum em vez de escolher qualquer processo por tendência ou preferência sozinha.

## Equívocos Comuns e Armadilhas

- **"Kanban é só Scrum sem Sprints, a mesma coisa de resto."** O mecanismo de controle central do Kanban, limites explícitos de WIP impostos continuamente, não tem equivalente no Scrum, que controla o trabalho por meio de planejamento de Sprint e um timebox fixo em vez disso; os dois são mecanismos genuinamente diferentes, não a mesma ideia com um recurso removido.
- **"Um quadro Kanban sem limites de WIP impostos ainda está 'fazendo Kanban'."** Um quadro com colunas mas sem limite imposto sobre quantos itens podem ficar "Em Progresso" perde o exato mecanismo (Exemplo 1) que faz surgir gargalos; um quadro visual sozinho, sem o limite de fato sendo imposto, é uma lista de tarefas com colunas extras, não o Método Kanban.
- **"Tempo de ciclo e estar ocupado são o mesmo sinal."** O Exemplo 2 mostra que uma equipe pode estar total e genuinamente ocupada enquanto um diagrama de fluxo cumulativo revela que o trabalho está ativamente se acumulando em algum lugar no pipeline; "todos estão ocupados" responde uma pergunta diferente de "o trabalho está de fato fluindo".

## Resumo

O Método Kanban, formalizado por David Anderson em 2010 a partir de prática real na Corbis e na Microsoft, substitui o timebox fixo do Sprint do Scrum por um sistema de puxar contínuo: o trabalho se move por estágios nomeados, e um limite explícito de trabalho-em-progresso em cada estágio é o mecanismo de fato que faz surgir um gargalo, forçando uma decisão visível no momento em que um estágio enche, em vez de deixar a capacidade ociosa em outro lugar silenciosamente absorver o problema. Um diagrama de fluxo cumulativo torna um estágio estagnado visível diretamente, como uma banda alargando enquanto o estágio depois dele permanece plano, dias ou semanas antes de o mesmo problema de outra forma surgir como um prazo perdido. O trade-off do Kanban contra o do Scrum é genuíno e simétrico: responsividade contínua ao trabalho recém-chegado, ao custo da cadência fixa de planejamento e revisão que um limite de Sprint fornece, que é exatamente por que o padrão de fato de trabalho recebido de uma equipe, não a moda ou a preferência, deveria decidir qual processo encaixa.

## Documentation Links

- [Anderson (2010): Kanban, Successful Evolutionary Change for Your Technology Business](https://archive.org/details/kanbansuccessful0000ande): o livro original formalizando o Método Kanban para trabalho de conhecimento, tirado da experiência real de Anderson aplicando-o na Corbis e na Microsoft.
- [ACM/IEEE: CS2013 Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/): lista modelos de processo ágil e baseado em fluxo dentro da mesma unidade de conhecimento de Processos de Software à qual este conceito e `agile-processes-scrum-in-practice` ambos pertencem.
