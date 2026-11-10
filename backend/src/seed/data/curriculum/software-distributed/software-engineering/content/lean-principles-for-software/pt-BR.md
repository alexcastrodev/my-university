---
version: 1.0
updatedAt: 2026-11-03
title: "Princípios Lean para Software"
summary: "Os princípios Lean aplicados a software pelos Poppendiecks (eliminar desperdício, adiar compromissos até o último momento responsável e enxergar o todo), com fluxo, filas e a relação com o Kanban, o XP e o Scrum."
---
## Objetivos de Aprendizagem

- Enunciar os sete princípios do Lean software development como os Poppendiecks os apresentaram em 2003, e nomear os desperdícios de software para os quais o primeiro princípio aponta.
- Explicar "decidir o mais tarde possível" como o Last Responsible Moment e distingui-lo de procrastinação.
- Calcular a eficiência de fluxo (flow efficiency) de um item de trabalho e relacionar trabalho em andamento, vazão e o tempo que o trabalho passa no sistema.
- Situar o Lean em relação ao Extreme Programming, ao Scrum e ao Kanban: qual é um conjunto de princípios, qual é um método e o que cada um toma emprestado.

## Contexto e Motivação

O Scrum Guide diz que o Scrum "se fundamenta em empirismo e lean thinking" e que "o lean thinking reduz desperdício e foca no essencial". `extreme-programming-practices` descreveu um método de engenharia concreto, e `kanban-and-flow-based-process` descreveu um método de fluxo concreto, com limites de WIP. O Lean fica um nível abaixo dos dois: é o corpo de ideias que explica por que essas práticas funcionam. Mary e Tom Poppendieck o levaram ao software no livro de 2003 *Lean Software Development: An Agile Toolkit*, que organiza o material em sete princípios e 22 "ferramentas de pensamento" (descrição da editora).

O termo "lean" vem da manufatura. O artigo de John Krafcik de 1988, "Triumph of the Lean Production System" (Sloan Management Review), é geralmente creditado como a origem de "lean production", e o estudo do MIT sobre a indústria automobilística, de Womack e colegas (1990), *The Machine that Changed the World*, popularizou o termo (Poppendieck, escrevendo em 2015, atribui ao livro a origem do termo para a área). Os Poppendiecks argumentam que a versão para software precisou ser adaptada, não copiada, e essa adaptação é o que esta lição mais tenta preservar.

## Teoria Central

### Os sete princípios

O sumário de 2003 traz sete capítulos, um por princípio:

```text
1. Eliminate Waste           5. Empower the Team
2. Amplify Learning          6. Build Integrity In
3. Decide as Late as         7. See the Whole
   Possible
4. Deliver as Fast as
   Possible
```

Livro vs hoje: os nomes variam entre as fontes. O capítulo de Poppendieck de 2015 escreve "Build quality in" para o princípio 6, e a Wikipedia lista "Optimize the whole" para o 7. O título do capítulo de 2003 é "See the Whole", e esta lição usa os nomes de 2003. "Otimizar o todo" nomeia a mesma ideia.

### Eliminar desperdício, e o que conta como desperdício

O capítulo 1 mapeia os desperdícios da manufatura para o software. Os títulos do livro são partially done work, extra processes, extra features, task switching, waiting, motion e defects, seguidos de um título sobre atividades de gestão. A tabela da Wikipedia os pareia com os termos da manufatura: estoque vira trabalho parcialmente feito, superprodução vira funcionalidades extras, transporte vira troca de tarefa e movimentação vira passagens de bastão (hand-offs). O menos familiar é o trabalho parcialmente feito: código escrito mas não integrado, testado ou lançado é estoque que custou dinheiro e não rendeu nada, e que envelhece. O YAGNI do XP (funcionalidades extras) e a `continuous-integration` (trabalho parcialmente feito) podem ser lidos como eliminação de desperdício nesse sentido.

### Amplificar o aprendizado e decidir o mais tarde possível

Desenvolver software é um processo de aprendizado, então ciclos de feedback mais curtos (iterações, testes, releases) aumentam o que se aprende por semana. O mesmo fato move o princípio 3. Em "Concurrent Development" (2003), um trecho do livro deles, os Poppendiecks definem o **Last Responsible Moment** como "o momento em que não tomar uma decisão elimina uma alternativa importante" e avisa que, depois dele, "as decisões são tomadas por omissão". As táticas deles são práticas: compartilhar projetos parcialmente completos, colaborar diretamente em vez de por passagens de bastão, esconder a implementação atrás de módulos e interfaces e "desenvolver capacidade de resposta rápida", porque "quanto mais devagar você responde, mais cedo precisa decidir".

A cautela é igualmente explícita: procrastinar não é o mesmo que decidir no Last Responsible Moment, e adiar decisões dá trabalho; um viés para o compromisso tardio não pode degenerar em um viés para nenhum compromisso. Algumas decisões, como as camadas da arquitetura e a escolha da linguagem, é melhor tomar cedo.

O trecho também revisita o argumento do custo de mudança de `the-cost-of-defects-found-late`. Ele cita o fator de 100 vezes de Boehm (1987) e a observação dele, em 2001, de que o fator pode ficar mais perto de 5:1 em sistemas pequenos. Para produtos físicos, cita uma estimativa antiga de 1000:1 e argumenta que o próprio processo sequencial poderia ser a causa de uma razão dessas. Para software, diz que umas poucas decisões básicas de arquitetura, como a escolha da linguagem ou das camadas, "podem ter a razão de escalada de custo de 100:1", que "um único fator ou curva de escalada de custo é enganoso" e que "é a abordagem sequencial que faz o custo da maioria das mudanças escalar exponencialmente", porque o desenvolvimento sequencial "enfatiza tomar todas as decisões o mais cedo possível". Trate isso como argumento dos autores, não como resultado estabelecido.

### Entregar o mais rápido possível: fluxo, filas e pull

Poppendieck (2015) reformula o Lean como **eficiência de fluxo**: a fração do tempo decorrido em que alguém está de fato trabalhando no item. A ilustração dela é uma coroa dentária quebrada. O conserto dela levou duas semanas (336 horas) para 1,5 hora de dentista, uma eficiência de fluxo de 1,5 / 336, cerca de 0,45%. O conserto do marido, na mesma situação, levou oito horas: 1,5 / 8 = 18,75%, e 42 vezes mais rápido. Citando Modig e Ahlstrom, ela diz que o Lean não é o tipo de eficiência que "procura manter todo recurso ocupado o tempo todo", porque recursos plenamente ocupados criam filas. Só como orientação, ela estima (caracterização dela, não um resultado medido) que o desenvolvimento tradicional de software costuma ter menos de 10% de eficiência de fluxo, as práticas ágeis de 30 a 40% e as empresas de internet bem-sucedidas perto de 70% ou mais.

As filas ligam isso ao Kanban. Para uma fila limitada do tipo primeiro a entrar, primeiro a sair, ela afirma, o tempo na fila é o número de itens dividido pela taxa média de conclusão. Aplicada a tudo que está em andamento, a mesma divisão dá o tempo médio que um item passa no sistema, trabalho mais espera. Pull systems e teoria das filas já eram ferramentas do capítulo 4 do livro de 2003; em 2015 ela credita ao *Kanban* de Anderson (2010) dar às equipes "um método visual poderoso para gerenciar e limitar o trabalho em andamento" justo quando iterações de duas semanas começavam a parecer lentas. Ou seja, o Kanban aplica ideias do Lean, e o limite de WIP de `kanban-and-flow-based-process` é uma forma de controlar o termo da fila nessa fórmula.

### Ver o todo

Poppendieck argumenta que o ágil "focou em otimizar o desenvolvimento de software, que muitas vezes não era a restrição do sistema", enquanto o Lean olha toda a cadeia de valor "do conceito ao dinheiro" (expressão do subtítulo da continuação de 2006, coerente com o trabalho de Taiichi Ohno). Um time que dobra a velocidade de codificação ganha pouco se um processo de release manual segura cada mudança por um mês.

Ela também avisa contra importar a prática de fábrica sem adaptação: transferir práticas lean da manufatura para o desenvolvimento "levou a alguns resultados desastrosos", por exemplo porque a produção lean reduz a variação, enquanto o desenvolvimento de produto precisa de variação para explorar alternativas.

## Exemplos Resolvidos

### Exemplo 1: eficiência de fluxo de uma funcionalidade

Números inventados, em dias úteis. Para cada etapa, "espera" é o tempo em fila antes de o trabalho começar.

```text
Etapa      toque  espera
análise      2      8
desenvolv.   6     10
revisão      1      5
QA           3      9
release      1      4
Total       13     36   decorrido: 49 dias
Eficiência de fluxo = 13 / 49 = 26,5%
```

O time encurta a revisão (revisões em até um dia: espera de 5 vira 1), move as verificações de regressão para o pipeline (espera do QA de 9 vira 3) e automatiza o release (espera de 4 vira 0,5). O tempo de toque continua 13 dias, o tempo decorrido cai para 35,5 dias e a eficiência de fluxo vira 13 / 35,5 = 36,6%. O lead time fica cerca de 28% menor sem que ninguém digite mais rápido. Isso é "entregar o mais rápido possível" obtido removendo espera.

### Exemplo 2: WIP, vazão e tempo no sistema

Um time termina 3 itens por semana e mantém 12 itens em andamento. O tempo médio que um item passa no sistema, trabalhando e esperando, é itens em andamento divididos pela taxa de conclusão: 12 / 3 = 4 semanas. Reduzir o trabalho em andamento para 6 dá 6 / 3 = 2 semanas. Se o limite menor custar um pouco de vazão, digamos 2,5 por semana porque às vezes há gente ociosa, o resultado é 6 / 2,5 = 2,4 semanas, ainda 40% menos que 4 semanas. A relação vale para médias em regime estacionário e supõe que o limite não deixe o gargalo sem trabalho.

### Exemplo 3: achando o Last Responsible Moment

Um time de checkout precisa escolher entre dois provedores de pagamento. A primeira história que chama o provedor começa na semana 9, e o onboarding e a certificação levam 3 semanas, então a escolha não pode passar da semana 9 - 3 = semana 6. Decidir na semana 1 seria compromisso precoce com pouca informação; decidir depois da semana 6 atrasaria a história. Até lá, o time escreve o checkout contra uma interface, faz um spike curto em cada provedor na semana 4 e decide na semana 5 ou 6, com evidência. O prazo veio da aritmética das dependências, não de um palpite.

## Equívocos Comuns e Armadilhas

- **"Lean significa manter todo mundo ocupado e cortar custos."** Poppendieck, citando Modig e Ahlstrom, diz o oposto: o foco em eficiência de recursos "quase sempre destrói a eficiência geral", por causa das filas. O Exemplo 1 melhorou sem ninguém trabalhar mais.
- **"Decidir o mais tarde possível é empurrar com a barriga."** O Exemplo 3 mostra que o momento é calculado a partir de dependências e lead times, e Poppendieck diz que adiar dá trabalho. Passar do momento transforma a decisão em decisão por omissão.
- **"Lean software é a fábrica da Toyota aplicada a código."** Ela avisa que copiar práticas de fábrica deu "resultados desastrosos". Os princípios se transferem; as práticas precisam ser reconstruídas para o desenvolvimento.
- **"Lean e Kanban são a mesma coisa."** O Lean é um conjunto de princípios de 2003. O Kanban é um método específico, com limites de WIP, formalizado em 2010, que implementa alguns deles. Um time pode seguir princípios Lean sem quadros Kanban.

## Resumo

O Lean software development, introduzido por Mary e Tom Poppendieck em 2003, adapta o pensamento da manufatura lean em sete princípios: eliminar desperdício, amplificar o aprendizado, decidir o mais tarde possível, entregar o mais rápido possível, empoderar o time, embutir integridade e ver o todo. Poppendieck o apresenta como um arcabouço teórico para práticas ágeis; o YAGNI do XP e a `continuous-integration`, os limites de WIP do Kanban e, pela própria declaração do Scrum Guide, o próprio Scrum se conectam a ele. Seus movimentos distintivos são medir a eficiência de fluxo em vez da utilização de recursos, usar filas para explicar o tempo de espera, adiar o compromisso até o Last Responsible Moment sem escorregar para a indecisão e olhar toda a cadeia de valor, não só a etapa de codificação. `user-stories-epics-and-the-product-backlog` trata dos itens de trabalho que fluem por essa cadeia.

## Documentation Links

- [Poppendieck: Lean Software Development, The Backstory (2015)](https://www.leanessays.com/2015/06/lean-software-development-history.html): as origens do lean, os sete princípios, a eficiência de fluxo e o contraste entre ágil e lean.
- [Poppendieck & Poppendieck (2003): Concurrent Development (trecho do livro)](https://www.leanessays.com/2003/08/concurrent-development.html): o Last Responsible Moment, táticas para adiar compromissos e o argumento sobre a escalada de custo.
- [Lean Blog: The term lean production is 25 years old](http://www.leanblog.org/2013/09/the-term-lean-production-is-25-years-old-my-thoughts-on-the-original-article/): o crédito ao artigo de Krafcik de 1988 pelo termo "lean production".
- [Poppendieck: When Demand Exceeds Capacity (2022)](https://www.leanessays.com/2022/06/when-demand-exceeds-capacity.html): a relação entre tamanho da fila, taxa de conclusão e tempo na fila.
- [InformIT: Lean Software Development, An Agile Toolkit](https://www.informit.com/store/lean-software-development-an-agile-toolkit-9780321150783): a descrição da editora e o sumário completo do livro de 2003.
- [Wikipedia: Lean software development](https://en.wikipedia.org/wiki/Lean_software_development): os nomes dos princípios e a tabela de mapeamento dos desperdícios; fonte secundária.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): a declaração de que o Scrum se fundamenta em empirismo e lean thinking.
