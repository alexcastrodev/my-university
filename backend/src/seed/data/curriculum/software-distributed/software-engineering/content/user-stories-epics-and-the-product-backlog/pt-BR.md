---
version: 1.0
updatedAt: 2026-11-03
title: "User Stories, Epics e o Product Backlog"
summary: "User stories e seus critérios de aceitação, a divisão de epics em fatias verticais e a ordenação de um product backlog, como a contrapartida ágil de uma especificação de requisitos, com o que o Scrum Guide define e o que não define."
---
## Objetivos de Aprendizagem

- Descrever uma user story como um cartão, uma conversa e uma confirmação, e verificar uma história contra os critérios INVEST de Bill Wake.
- Distinguir os critérios de aceitação de uma história da Definition of Done que o Scrum define para o Increment.
- Dividir um epic em fatias verticais que entregam valor cada uma, e reconhecer a divisão por camada técnica como uma falha.
- Ordenar um Product Backlog usando valor, tamanho, risco e dependências, e dizer exatamente o que o Scrum Guide exige e não exige sobre ele.

## Contexto e Motivação

`requirements-elicitation-specification-and-validation` ensinou três atividades: a elicitação descobre a necessidade, a especificação a escreve numa forma precisa o bastante para que dois engenheiros diferentes lendo-a construam a mesma coisa, e a validação confere o resultado escrito contra a necessidade real. Esse modelo sugere um documento terminado antes da construção. Os métodos ágeis mantêm as três atividades, mas as espalham no tempo, e a user story é o dispositivo que torna isso possível.

O texto de 2020 do Scrum Guide não contém as expressões "user story", "epic", "acceptance criteria" nem "estimate". Ele define o Product Backlog e deixa em aberto o formato de um item. As histórias vêm do Extreme Programming: como escreve Martin Fowler, Kent Beck introduziu o termo como parte do XP para estimular um estilo mais informal e conversacional de elicitação de requisitos do que as longas especificações escritas. Por isso esta lição trata histórias como uma escolha comum de item de backlog, não como parte do Scrum.

## Teoria Central

### Uma história é um cartão, uma conversa e uma confirmação

Fowler descreve user stories como "pedaços de comportamento desejado de um sistema de software", usados para dividir a funcionalidade em partes para planejamento. A essência de uma história cabe em um cartão, e as histórias deliberadamente não são detalhadas até estarem prontas para serem desenvolvidas: basta entendimento suficiente para priorizá-las contra as outras. Uma formulação comum tem três cláusulas, "Como ...", "Eu quero ..." e "para que ...", que dizem quem quer, o que quer e por quê. O "para que" dá o contexto que ajuda o time a ir do que o cliente acha que quer até o que ele de fato precisa.

Bill Wake (2003) credita a Ron Jeffries as três partes de uma história: o **cartão** (card), a **conversa** (conversation) e a **confirmação** (confirmation), isto é, os testes. Wake alerta que é fácil confundir o cartão com a história inteira. A confirmação costuma ser escrita como critérios de aceitação ou exemplos. Mapeando para a lição de requisitos: a conversa é a elicitação, a confirmação é a especificação verificável e a Sprint Review é a validação, cada uma feita em pequenos pedaços, na hora certa.

### Critérios de aceitação versus Definition of Done

Os dois são frequentemente confundidos. Critérios de aceitação pertencem a uma história e descrevem o que precisa ser verdade para ela. A **Definition of Done** do Scrum Guide é "uma descrição formal do estado do Increment quando ele atende às medidas de qualidade exigidas para o produto", aplicada a todos os itens: "Se um item do Product Backlog não atende à Definition of Done, ele não pode ser liberado nem apresentado na Sprint Review". Uma história só está pronta quando satisfaz seus próprios critérios e a definição compartilhada.

### INVEST

O mnemônico de Wake descreve uma história fácil de planejar:

```text
Independent  pode ser agendada em qualquer ordem (nem sempre possível)
Negotiable   detalhes são co-criados, não é um contrato
Valuable     precisa ser valiosa para o cliente
Estimable    o time consegue dimensioná-la grosso modo
Small        no máximo algumas pessoas-semana de trabalho (veja abaixo)
Testable     dá para dizer como verificá-la
```

Sobre o tamanho, Wake escreve que as histórias "tipicamente representam no máximo algumas pessoas-semana de trabalho" e que algumas equipes as restringem a alguns dias-pessoa; o resumo de Fowler diz "geralmente questão de dias-pessoa". Wake também nota que, se o cliente não sabe dizer como testar uma história, ela pode estar pouco clara, pode não ser valiosa para ele, ou o cliente pode só precisar de ajuda para testar.

### Epics e divisão

Um **epic** é, na definição de Mike Cohn, uma história grande, útil para lembrar uma capacidade antes de se conhecerem os detalhes e que deve ser dividida antes do desenvolvimento. A palavra é vocabulário comum, não um termo do Scrum. O que o Scrum Guide diz é que "itens do Product Backlog que podem ser concluídos (Done) pelo Scrum Team dentro de um Sprint são considerados prontos para seleção", então tudo que for maior precisa ser dividido.

Como dividir importa mais do que se dividir. Wake aconselha que "o melhor jeito é fatiar verticalmente pelas camadas", para que cada pedaço entregue valor ao cliente, e o checklist de Cohn para trazer uma história a um Sprint pergunta se o time evitou dividi-la apenas por camada técnica. Uma fatia vertical atravessa interface, lógica e armazenamento para um comportamento estreito. Formas úteis de achar fatias incluem dividir por etapa do fluxo, por variação de regra de negócio, pelo caso simples primeiro e as exceções depois, ou por variação de dados. Uma divisão por camada gera pedaços que não podem ser demonstrados nem validados até que todos estejam prontos.

### O Product Backlog

O Scrum Guide define o Product Backlog como "uma lista emergente e ordenada do que é necessário para melhorar o produto", a fonte única de trabalho. O Product Owner é responsável por ele, inclusive por ordenar os itens, mas pode delegar o trabalho. O **refinamento** é "o ato de quebrar e definir melhor os itens do Product Backlog em itens menores e mais precisos", acrescentando descrição, ordem e tamanho, e quem dimensiona são os Developers que farão o trabalho. O **Product Goal** é o objetivo de longo prazo contra o qual o backlog é planejado.

Como o detalhe é acrescentado na hora certa, os itens do topo são pequenos e bem entendidos, e os do fundo são grosseiros e podem ser epics. A regra prática de Cohn é detalhe suficiente para a próxima decisão.

O Guide não dá fórmula de ordenação. Entradas comuns são valor, tamanho, risco, dependências e custo do atraso (uma das 22 ferramentas do *Lean Software Development* de 2003, veja `lean-principles-for-software`). O release planning do XP ordena as histórias por valor e depois por risco (Wikipedia). Valor por tamanho é uma primeira passada conveniente, mas é o julgamento do Product Owner que ordena o backlog.

## Exemplos Resolvidos

### Exemplo 1: de um pedido vago a uma boa história

Um stakeholder diz: "Os sócios precisam renovar livros." Como cartão avulso, "Renovar livros" deixa em aberto Valuable e Testable: nada diz o que o sócio ganha nem como alguém verificaria uma renovação. Reescrita:

```text
Como sócio da biblioteca, eu quero renovar um empréstimo online
para que eu possa ficar com um livro que ainda estou lendo sem ir até a biblioteca.

Confirmação (critérios de aceitação):
- Um empréstimo pode ser renovado uma vez, por 14 dias, antes do vencimento.
- A renovação é recusada se outro sócio reservou o livro,
  e a tela informa isso.
- Um empréstimo já vencido não pode ser renovado.
```

Verificação: Independent só em parte (precisa de Emprestar, e o segundo critério precisa de Reservar, então a ordem importa, como o Exemplo 3 mostra), Negotiable (telas e textos estão em aberto), Valuable (o sócio fica com o livro), Estimable, Small, Testable (três casos concretos). Um quarto caso achado na conversa, como a equipe da biblioteca poder ignorar o limite, vira uma nova história.

### Exemplo 2: dividindo um epic verticalmente

O epic "Empréstimos da biblioteca" é grande demais para um Sprint. Uma divisão vertical, com tamanhos relativos inventados:

```text
Emprestar um livro disponível          5
Renovar um empréstimo                  2
Reservar um livro emprestado           5
Multas por devolução atrasada          8
E-mails de lembrete antes do prazo     3
Relatório de atrasos do bibliotecário  3
Total                                 26
```

Cada fatia passa por tela, lógica e banco de dados, então cada uma pode ser mostrada a um bibliotecário. A alternativa que falha é "Tabela de empréstimos", "API de empréstimos" e "Tela de empréstimos" como três itens: depois de dois deles nada pode ser demonstrado, e uma suposição errada por trás da tabela só aparece quando a tela chega.

### Exemplo 3: ordenando por valor por tamanho, depois por julgamento

O Product Owner atribui valores relativos (inventados, de 1 a 13) às fatias do Exemplo 2 e o time fornece os tamanhos:

```text
História             valor  tam.  valor/tam.  depende de
Emprestar livro        13     5      2,6      -
Renovar empréstimo      5     2      2,5      Emprestar, Reservar
Relatório de atrasos    5     3      1,7      Emprestar
Reservar livro          8     5      1,6      Emprestar
Multas                  8     8      1,0      Emprestar
E-mails de lembrete     3     3      1,0      Emprestar
```

A ordem pela razão é só um ponto de partida, e aqui ela quebra uma dependência: Renovar fica em segundo, mas o segundo critério dela (recusar a renovação quando o livro está reservado) precisa de Reservar, que fica em quarto. O Product Owner move Reservar para antes de Renovar. A alternativa é dividir Renovar e construir a verificação de reserva depois. A ordem de trabalho, com o tamanho acumulado, fica assim:

```text
Emprestar 5 (5), Reservar 5 (10), Renovar 2 (12), Relatório de atrasos 3 (15),
Multas 8 (23), E-mails de lembrete 3 (26)
```

Multas ficam em posição baixa, mas escondem uma pergunta de política sem resposta (qual a taxa e há um teto?), o que é um risco. O Product Owner coloca uma investigação curta (digamos, um ponto) antes de Multas, para que a resposta seja conhecida antes de o time construí-las. Essa resposta pode mudar o tamanho ou as regras, então os 8 pontos são provisórios. Por fim, os Developers fazem a previsão do que cabe: se o desempenho passado sugere cerca de 24 pontos por Sprint, o primeiro Sprint poderia comportar tudo até Multas mais a investigação (23 + 1 = 24), com E-mails de lembrete em seguida, mas só se a resposta mantiver os 8 pontos; se eles crescerem, Multas sai da previsão. O Product Owner decide a ordem, e os Developers decidem quanto prever.

## Equívocos Comuns e Armadilhas

- **"Uma user story é um documento de requisitos que cabe num cartão."** Wake alerta contra confundir o cartão com a história. No Exemplo 1, os critérios e a conversa carregam o requisito.
- **"O Scrum exige user stories, epics e story points."** O Scrum Guide de 2020 não menciona nenhum deles. Ele descreve um Product Backlog ordenado, diz que itens que podem ser concluídos (Done) dentro de um Sprint são "considerados prontos para seleção" e é omisso quanto ao formato de um item.
- **"Todo item do backlog precisa estar totalmente especificado desde o início."** O refinamento é contínuo. Especificar demais o fundo do backlog repete o erro do waterfall descrito em `software-process-models-waterfall-and-its-real-history`.
- **"Critérios de aceitação e Definition of Done são a mesma coisa."** Os critérios são específicos de uma história; a Definition of Done é a barra de qualidade compartilhada por todo Increment.
- **"Dividir por camada é só boa decomposição técnica."** O Exemplo 2 mostra o que isso custa em feedback. Tarefas são úteis dentro de uma história, mas tarefas não são histórias (Cohn lista dividir histórias em tarefas como um erro comum).

## Resumo

Uma user story, introduzida por Kent Beck no Extreme Programming, é um substituto deliberadamente pequeno e conversacional de uma longa especificação: um cartão que lembra o time de uma necessidade, uma conversa que preenche os detalhes na hora certa e uma confirmação na forma de critérios de aceitação. O INVEST (Wake, 2003) testa se uma história é planejável. Um epic é uma história grande demais para um Sprint e deve ser dividido verticalmente para que cada fatia entregue valor. O Scrum Guide não define nada desse vocabulário. Ele define o Product Backlog como uma lista emergente e ordenada, ordenada pelo Product Owner, refinada para que os itens do topo possam ser concluídos dentro de um Sprint e dimensionada pelos Developers. A ordenação é julgamento informado por valor, tamanho, risco, dependências e custo do atraso. `agile-metrics-velocity-burndown-burnup` mostra como os tamanhos desses itens alimentam previsões.

## Documentation Links

- [Fowler: User Story](https://martinfowler.com/bliki/UserStory.html): a origem do termo com Beck, a essência de um cartão, a forma "Como, eu quero, para que" e o INVEST.
- [Wake (2003): INVEST in Good Stories, and SMART Tasks](https://xp123.com/invest-in-good-stories-and-smart-tasks/): o INVEST original e a atribuição de cartão, conversa, confirmação a Jeffries.
- [Mountain Goat Software: User Stories](https://www.mountaingoatsoftware.com/agile/user-stories): o guia de Mike Cohn sobre detalhe, epics como histórias grandes, divisão e erros comuns; site de uma empresa de treinamento, usado só para definições.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): o Product Backlog, o refinamento, o Product Goal e a Definition of Done.
- [Wikipedia: Extreme programming practices](https://en.wikipedia.org/wiki/Extreme_programming_practices): o planning game, com histórias em cartões ordenadas por valor e risco.
