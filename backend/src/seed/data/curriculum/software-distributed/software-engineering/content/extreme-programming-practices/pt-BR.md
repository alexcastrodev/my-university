---
version: 1.0
updatedAt: 2026-11-03
title: "Práticas de Extreme Programming"
summary: "As práticas concretas do XP (pair programming, test-first, integração contínua, refactoring e small releases) vistas como um conjunto que se reforça mutuamente, com a evidência real sobre pair programming e uma avaliação honesta de quais práticas viraram prática comum."
---
## Objetivos de Aprendizagem

- Nomear as práticas do XP tanto na lista plana de Kent Beck, de 1999, quanto na lista agrupada de doze, que veio depois, mapear os nomes entre elas e dizer qual problema cada grupo ataca.
- Explicar por que as práticas foram desenhadas para se reforçarem umas às outras, usando a distinção de Martin Fowler entre práticas habilitadoras e práticas que tiram proveito delas, e a ideia de uma curva de custo de mudança achatada.
- Avaliar o pair programming pela evidência experimental real, incluindo os limites dessa evidência, e não por slogans a favor ou contra.
- Separar o que o Scrum prescreve do que o XP prescreve, e dizer quais práticas do XP se tornaram comuns fora dele.

## Contexto e Motivação

`agile-processes-scrum-in-practice` apresentou o Scrum como um framework para organizar decisões e feedback: quem ordena o trabalho, quando o time planeja, inspeciona e adapta. O Scrum Guide de 2020 afirma que o Scrum se fundamenta em "empirismo e lean thinking", mas o texto dele nunca menciona testes, integração, pairing ou refactoring. O Scrum deliberadamente não diz nada sobre como o código é escrito. O Extreme Programming (XP) é o método ágil que responde exatamente a essa pergunta, e responde com práticas de engenharia concretas.

O XP nasceu do projeto de folha de pagamento Chrysler Comprehensive Compensation System (C3), em que Beck virou líder do projeto em março de 1996 e pediu ao time, nas palavras dele, para "colocar todos os botões no 10 nas coisas que eu achava essenciais e deixar de fora todo o resto". O livro *Extreme Programming Explained* saiu em outubro de 1999 (datas conforme o artigo da Wikipedia sobre XP).

`continuous-integration`, `test-driven-development` (`software-construction`) e `refactoring` (`software-construction`) já têm lição própria, e esta não as repete. A pergunta aqui é o que o XP acrescenta: por que as práticas vêm como um conjunto, como é o resto do conjunto e o que sobreviveu.

## Teoria Central

### Duas listas de práticas

O artigo de Beck "Embracing Change with Extreme Programming" (IEEE Computer, outubro de 1999) traz uma lista plana de treze práticas: planning game, small releases, metaphor, simple design, tests, refactoring, pair programming, continuous integration, collective ownership, on-site customer, 40-hour weeks, open workspace e "just rules". A forma agrupada citada com mais frequência depois disso tem doze práticas em quatro grupos. A wiki C2 liga essa lista à primeira edição do livro de Beck (1999) e a Wikipedia a reproduz, com algumas práticas renomeadas:

```text
FEEDBACK EM ESCALA FINA:     Pair programming, Planning game,
                             Test-driven development, Whole team
PROCESSO CONTÍNUO:           Continuous integration, Design improvement,
                             Small releases
ENTENDIMENTO COMPARTILHADO:  Coding standard, Collective code
                             ownership, Simple design, System metaphor
BEM-ESTAR DOS PROGRAMADORES: Sustainable pace
```

O mapeamento entre as duas: tests virou test-driven development, on-site customer virou Whole team (a wiki C2 registra o nome antigo), 40-hour weeks virou sustainable pace, refactoring virou design improvement e metaphor virou system metaphor. A lista agrupada acrescenta coding standard e deixa de fora open workspace e just rules. Os valores são comunicação, simplicidade, feedback e coragem; respeito foi acrescentado na segunda edição, de 2004.

Livro vs hoje: a segunda edição trocou as doze por práticas "primárias" e "corolárias" (como Sit Together, Weekly Cycle, Ten-Minute Build e Test-First Programming), e a Wikipedia registra que o XP hoje aceita práticas modificadas, desde que os objetivos continuem sendo atendidos. Até a última prática do artigo de 1999, "just rules", deixa o time mudar as regras se concordar sobre como avaliar os efeitos. Trate qualquer lista como um retrato histórico, não como um checklist.

### Por que as práticas vêm em conjunto: a curva de mudança

O argumento clássico para projetar tudo antecipadamente se apoia em uma curva de custo de mudança que sobe muito ao longo do projeto (veja `the-cost-of-defects-found-late`). O artigo de Beck de 1999 chama o waterfall de "uma reação racional à medição chocante de que o custo de alterar um software crescia dramaticamente com o tempo" e diz que o XP "explora a redução do custo de alterar software". O artigo "Is Design Dead?" de Fowler (versão de maio de 2004) enuncia a suposição contrária do XP: "A suposição fundamental por trás do XP é que é possível achatar a curva de mudança o suficiente para fazer o design evolutivo funcionar". Ele então distingue dois papéis entre as práticas:

```text
HABILITADORAS (achatam a curva):
    testes, integração contínua, refactoring
QUE EXPLORAM A CURVA ACHATADA:
    design evolutivo, simple design e
    "you aren't going to need it" (YAGNI)
```

O aviso dele é a chave de todo o método: não dá para fazer as partes do XP que exploram a curva achatada sem fazer as que permitem o achatamento. Muitos críticos, observa Fowler, atacam as práticas que exploram a curva depois de tentá-las sem as habilitadoras. Ele também faz uma ressalva: na empresa dele, só testes e integração contínua já trouxeram uma melhoria marcante, o bastante para "questionar seriamente a afirmação do XP de que se precisa de todas as práticas para obter uma grande melhoria".

### Pair programming e sua evidência

No pair programming, uma pessoa controla o teclado e pensa no código em detalhe, enquanto a outra revisa continuamente e pensa na direção maior. Elas trocam de papel em intervalos de minutos a horas, e os pares rodam. É `code-review` (`software-construction`) levada ao extremo: a revisão acontece enquanto o código está sendo digitado.

A evidência mais conhecida é um experimento controlado de 1999 na University of Utah, relatado por Cockburn e Williams (2000). Participaram alunos avançados de graduação de uma disciplina de engenharia de software; um terço da turma trabalhou sozinho e o restante em pares. Depois de um período inicial de adaptação, os pares gastaram cerca de 15% mais tempo por programa que os indivíduos, e o artigo afirma que o código deles teve "cerca de 15% menos defeitos". A única medida que ele traça (Figura 2) são os casos de teste pós-desenvolvimento que passaram, "essencialmente o percentual dos casos de teste do instrutor que passaram", e o texto não dá os percentuais. Uma diferença nas taxas de aprovação não é o mesmo que uma queda de 15% na contagem de defeitos, então o número é a leitura dos autores do resultado. O resumo acrescenta melhor qualidade de design, menor risco de pessoal, melhor comunicação e mais prazer no trabalho, tudo "em níveis estatisticamente significativos". A qualidade do design se apoia em parte no experimento (os pares escreveram a mesma funcionalidade em menos linhas), e o prazer de trabalhar em pesquisas anônimas.

Os limites importam: os sujeitos eram estudantes, os programas eram trabalhos de curso e os autores defendem a prática. Uma meta-análise posterior de experimentos publicados (Hannay e colegas, 2009) relata "um pequeno efeito positivo geral significativo do pair programming sobre a qualidade", um efeito médio sobre a duração a favor dos pares e um efeito negativo médio sobre o esforço. A complexidade da tarefa modera os três: os pares foram mais rápidos em tarefas simples e produziram código de maior qualidade em tarefas complexas, com esforço consideravelmente maior. Os autores também encontraram grande variação entre estudos e sinais de viés de publicação, e concluem que os fatores moderadores merecem mais atenção. Isso afeta diretamente o argumento dos 15%: a troca entre tempo e qualidade depende da tarefa, então nem "sempre" nem "nunca" é sustentado.

### Planning game, small releases e sustainable pace

O planning game divide o planejamento em dois. No release planning, os clientes escrevem histórias em cartões, os desenvolvedores as estimam e os dois lados acordam o que entra no próximo release. No iteration planning, os desenvolvedores quebram as histórias escolhidas em tarefas. O objetivo é "conduzir o projeto" (steer) até a entrega, em vez de prever datas exatas. As iterações duram de uma a três semanas. O sustainable pace ecoa um princípio do Manifesto Ágil: patrocinadores, desenvolvedores e usuários "devem ser capazes de manter um ritmo constante indefinidamente".

### O que sobreviveu e virou prática comum

As fontes usadas aqui não medem adoção, então estas observações são cautelosas:

- O texto do Scrum não contém nenhuma das práticas de engenharia do XP. Mary Poppendieck (2015) observa que o Scrum institucionalizou iterações e times multifuncionais, mas deixou de fora o test-driven development e a integração contínua. Um time pode seguir os eventos do Scrum e ainda assim não ter as práticas que tornam a mudança frequente segura.
- Integração contínua, test-driven development e refactoring hoje circulam como práticas independentes. Fowler descreve o TDD como "desenvolvido por Kent Beck no fim dos anos 1990 como parte do Extreme Programming".
- Pair programming, o cliente no local (on-site customer, Whole team na lista agrupada) e a system metaphor são as contestadas. Críticos dizem que o cliente no local pode virar um ponto único de falha, e a evidência sobre pairing é mista. Nada do que é citado aqui resolve o destino delas.

## Exemplos Resolvidos

### Exemplo 1: o balanço do pair programming, recalculado

Cockburn e Williams apresentam um modelo de custo ilustrativo, com premissas próprias. Um programa de 50.000 linhas é escrito a 50 linhas por hora. Os programadores injetam 100 defeitos por mil linhas, e um processo rigoroso remove cerca de 70% deles.

```text
Indivíduos:  50.000 / 50 = 1.000 horas
             5.000 defeitos injetados, 30% restam = 1.500
Pares:       1.000 x 1,15 = 1.150 horas (150 horas a mais)
             defeitos 15% menores: 1.500 x 0,85 = 1.275 restam
Evitados:    1.500 - 1.275 = 225 defeitos
A 10 horas de teste e correção por defeito: 225 x 10 = 2.250 horas
2.250 / 150 = 15 vezes o custo extra do pairing
```

O modelo toma o "cerca de 15% menos defeitos" do artigo como uma redução na contagem de defeitos, o que, como visto acima, é a leitura dos autores de um resultado em taxa de aprovação. Nessas premissas, o pairing se paga quinze vezes. Os dados de entrada, incluindo os 15%, vêm do artigo, que chama 10 horas por defeito de "um fator bastante conservador" e cita uma faixa de 4 a 16 horas em teste de sistema; as linhas acima apenas refazem a aritmética.

### Exemplo 2: quão frágil é essa conclusão

Tudo depende do custo de um defeito. A variação a seguir não vem do artigo. Mantenha as 150 horas extras e os 225 defeitos evitados, e varie as horas por defeito, inclusive para valores abaixo da faixa do artigo:

```text
10 horas por defeito:   2.250 horas economizadas (15 vezes o custo)
 1 hora  por defeito:     225 horas economizadas (1,5 vez o custo)
0,5 hora por defeito:   112,5 horas economizadas (0,75 vez o custo)
```

A redução de defeitos de equilíbrio é 1% a 10 horas, 10% a 1 hora e 20% a meia hora. Um time cujos testes e integração contínua tornam os defeitos baratos de corrigir recebe menos retorno do pairing. Isso decorre da aritmética e não é uma conclusão do artigo, mas mostra por que as práticas do XP não podem ser avaliadas uma a uma: cada uma muda o preço das outras.

### Exemplo 3: explorar sem habilitar

Um time adota a metade atraente do XP: simple design, YAGNI e releases de três semanas. Pula os testes automatizados e só integra antes do release. Na segunda semana, uma pessoa precisa alterar uma rotina de desconto usada em quatro lugares. Sem testes, ninguém sabe dizer se a mudança quebrou algo, então as pessoas evitam mexer em código compartilhado, a duplicação cresce e os revisores passam a exigir um design escrito antes de cada mudança. O time reconstruiu o design antecipado por autodefesa: as práticas que exploram a curva rodaram sobre uma curva que nada havia achatado.

## Equívocos Comuns e Armadilhas

- **"XP significa não fazer design."** Fowler diz que a impressão externa de que o XP é só testar, codificar e refatorar está errada: na prática há "um novo equilíbrio entre design antecipado e refactoring", com espaço para projetar antes de codificar.
- **"Fazer Scrum é fazer XP."** O texto do Scrum não contém nenhuma dessas práticas. Um time Scrum precisa escolher suas práticas de engenharia separadamente.
- **"Pair programming dobra o custo."** No experimento de Utah, os pares levaram cerca de 15% mais tempo, não 100%. O Exemplo 2 mostra que até esse resultado depende do custo de um defeito, e a meta-análise achou que o benefício não é uniforme.
- **"Escolha só as práticas de que você gosta."** Os Exemplos 2 e 3 mostram que as práticas dependem umas das outras. Dá para escolher, como a experiência de Fowler com testes mais integração mostra, mas com as dependências à vista.

## Resumo

O Extreme Programming, desenvolvido por Kent Beck a partir de 1996 e publicado em 1999, fornece o que o Scrum deixa de fora: práticas de engenharia concretas, treze no artigo de Beck de 1999 e doze na lista agrupada posterior. No relato de Fowler, testes, integração contínua e refactoring achatam o custo da mudança, o que permite que design evolutivo, simple design e YAGNI funcionem; tire as práticas habilitadoras e as que exploram a curva falham. O pair programming mostra como ler evidência com honestidade: um experimento de 1999 com estudantes relatou cerca de 15% mais tempo por cerca de 15% menos defeitos, se isso compensa depende do custo de um defeito, e uma meta-análise posterior achou que os efeitos dependem da tarefa. Integração contínua, test-driven development e refactoring viraram práticas independentes, enquanto pairing, cliente no local (Whole team) e system metaphor continuam contestados. `lean-principles-for-software` explica os princípios a que essas práticas servem.

## Documentation Links

- [Fowler: Is Design Dead?](https://martinfowler.com/articles/designDead.html): a curva de mudança e a distinção entre práticas habilitadoras e as que a exploram.
- [Cockburn & Williams (2000): The Costs and Benefits of Pair Programming](https://web.eecs.umich.edu/~weimerw/2018-481/readings/pairprogramming.pdf): o experimento de Utah e o modelo de custo recalculado nos Exemplos 1 e 2.
- [Wikipedia: Extreme programming](https://en.wikipedia.org/wiki/Extreme_programming): origem no C3, os valores e as críticas; fonte secundária.
- [Wikipedia: Extreme programming practices](https://en.wikipedia.org/wiki/Extreme_programming_practices): as doze práticas por grupo, com as fases do planning game.
- [Beck (1999): Embracing Change with Extreme Programming](https://chsasank.github.io/classic_papers/extreme-programming-embrace-change.html): uma cópia de leitura do artigo da IEEE Computer, com a lista plana de práticas.
- [C2 wiki: Extreme Programming Core Practices](https://c2.com/xp/ExtremeProgrammingCorePractices.html): a lista agrupada, os nomes antigos e as práticas da segunda edição.
- [Hannay et al. (2009): The effectiveness of pair programming, a meta-analysis (abstract)](https://ebse.webspace.durham.ac.uk/ebse-bibliography/the-effectiveness-of-pair-programming-a-meta-analysis/): efeitos sobre qualidade, duração e esforço, e o moderador de complexidade da tarefa.
- [Fowler: Test Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html): atribui o TDD a Beck e ao XP.
- [Poppendieck: Lean Software Development, The Backstory](https://www.leanessays.com/2015/06/lean-software-development-history.html): a observação de que o Scrum deixou de fora o test-driven development e a integração contínua.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): o texto de 2020, sem práticas de engenharia.
- [Agile Manifesto: Principles](https://agilemanifesto.org/principles.html): o princípio de desenvolvimento sustentável por trás do sustainable pace.
